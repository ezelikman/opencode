import { expect, test } from "bun:test"
import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { promptSuggestions } from "../src/route"

function request(body: unknown, method = "POST") {
  return new Request("http://localhost" + PromptSuggestions.path, {
    method,
    body: method === "POST" ? JSON.stringify(body) : undefined,
    headers: { authorization: "Bearer console-token", "x-org-id": "demo" },
  })
}

const transcript = { turns: [{ name: "Coding assistant", content: "Shall I run the tests?" }] }

test("authorizes first and rejects invalid input before contacting Persimmon", async () => {
  const options = {
    apiKey: "service-key",
    definitionID: "definition",
    fetch: () => {
      throw new Error("unexpected fetch")
    },
  }
  const denied = promptSuggestions({ ...options, authorize: () => new Response(null, { status: 403 }) })
  expect((await denied(request({}))).status).toBe(403)
  const route = promptSuggestions({ ...options, authorize: () => undefined })
  expect((await route(request({}, "GET"))).status).toBe(405)
  for (const input of [
    null,
    { turns: [] },
    { turns: [{ name: "Tool", content: "output" }] },
    { ...transcript, priorPrompts: [["x".repeat(513)]] },
    { ...transcript, priorPrompts: [["a", "b", "c", "d"]] },
    { ...transcript, priorPrompts: [["a"], ["b"], ["c"], ["d"]] },
  ])
    expect((await route(request(input))).status).toBe(400)
})

test("sends all turns in order and requests only the user's next turn", async () => {
  const prefix = "a".repeat(65_535) + "🙂"
  const seen: string[] = []
  const route = promptSuggestions({
    apiKey: "service-key",
    definitionID: "definition",
    authorize: (request) => {
      seen.push(request.headers.get("authorization")!)
    },
    fetch: async (url, init) => {
      seen.push(url)
      expect(init.headers).toEqual({ authorization: "Bearer service-key", "content-type": "application/json" })
      expect(init.redirect).toBe("error")
      expect(JSON.parse(String(init.body))).toEqual({
        turns: [
          { name: "Earlier conversations", content: JSON.stringify([["Use dry runs."], ["Ask before committing."]]) },
          { name: "User", content: prefix },
          { name: "User", content: "tail" },
          ...transcript.turns,
        ],
        speaker: "User",
        tier: "standard",
        max_tokens: 96,
      })
      return Response.json({ finish_reason: "stop", content: "Yes, please." })
    },
  })
  const result = await route(
    request({
      turns: [{ name: "User", content: prefix + "tail" }, ...transcript.turns],
      priorPrompts: [["Use dry runs."], ["Ask before committing."]],
    }),
  )
  expect(result.status).toBe(200)
  expect(result.headers.get("cache-control")).toBe("no-store")
  expect(await result.json()).toEqual({ text: "Yes, please." })
  expect(seen).toEqual(["Bearer console-token", "https://api.persimmon.humansand.ai/v1/conversations/definition/turns"])
})

test("handles abstention, truncated output, and upstream errors without exposing upstream bodies", async () => {
  for (const [response, status] of [
    [Response.json({ finish_reason: "stop", content: "NO_SUGGESTION" }), 200],
    [Response.json({ finish_reason: "stop", content: "/exit" }), 200],
    [Response.json({ finish_reason: "length", content: "Yes, and" }), 200],
    [Response.json({ error: "private details" }), 502],
    [new Response("private details", { status: 429 }), 429],
  ] as const) {
    const route = promptSuggestions({
      apiKey: "service-key",
      definitionID: "definition",
      authorize: () => undefined,
      fetch: async () => response,
    })
    const output = await route(request(transcript))
    expect(output.status).toBe(status)
    if (status === 200) expect(await output.json()).toEqual({ text: null })
    else expect(await output.text()).toBe("")
  }
})
