import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each(["tab", "right"])("%s accepts a full-conversation suggestion into the draft", async (key) => {
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const session = {
    id: "ses_" + crypto.randomUUID(),
    projectID: "proj_test",
    location: { directory },
    title: "Prompt suggestions",
    time: { created: 1, updated: 4 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const user = (id: string, text: string) => ({ id, type: "user", text, time: { created: 1 } })
  const reply = (id: string, text: string) => ({
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "opencode", id: "coding-model" },
    content: [
      { type: "text", text },
      { type: "reasoning", text: "Internal reasoning" },
    ],
    time: { created: 2, completed: 3 },
  })
  const first = [user("msg_1", "Use a dry run"), reply("msg_2", "I will use one")]
  const recent = [user("msg_3", "What is next?"), reply("msg_4", "Should I run the checks?")]
  const requests: unknown[] = []
  const generated = Promise.withResolvers<void>()
  let submitted = 0
  let codingCalls = 0
  let connected = false
  const suggestion = "Yes, run the dry-run checks."
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/inbox`) {
        if (request.method === "POST") submitted++
        return json({ data: [] })
      }
      if (url.pathname === `/api/session/${session.id}/message`) {
        if (url.searchParams.get("order") === "asc") return json({ data: first, cursor: { next: "older" } })
        return json({
          data: url.searchParams.has("cursor") ? recent : recent.toReversed(),
          cursor: {},
        })
      }
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "opencode",
              name: "OpenCode Console",
              methods: [],
              connections: connected
                ? [{ type: "credential", id: "cred_console", label: "Console", method: "key" }]
                : [],
            },
          ],
        })
      if (url.pathname === "/api/rpc/opencode.prompt-suggestions/available") return json({ output: true })
      if (url.pathname === "/api/rpc/opencode.prompt-suggestions/predict") {
        requests.push(await request.json())
        generated.resolve()
        return json({ output: { text: suggestion } })
      }
      if (url.pathname === "/api/experimental/generate/text") {
        codingCalls++
        return json({ data: { text: "Unexpected coding call" } })
      }
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Should I run the checks?"))
  expect(requests).toHaveLength(0)
  connected = true
  setup.events.emit({
    id: "evt_suggestion_connection",
    created: 1,
    type: "integration.updated",
    location: { directory },
    data: {},
  })
  await generated.promise
  await setup.waitForFrame((frame) => frame.includes("[Tab/Right] " + suggestion))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toEqual({
    input: {
      turns: [
        { name: "User", content: "Use a dry run" },
        { name: "Coding assistant", content: "I will use one" },
        { name: "User", content: "What is next?" },
        { name: "Coding assistant", content: "Should I run the checks?" },
      ],
    },
  })

  if (key === "tab") setup.mockInput.pressTab()
  else setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes(suggestion) && !frame.includes("[Tab/Right] " + suggestion))
  expect(submitted).toBe(0)
  expect(codingCalls).toBe(0)
})
