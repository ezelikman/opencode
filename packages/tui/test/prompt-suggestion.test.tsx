import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test.each([
  { name: "cross-project local history", key: "tab", local: true, enabled: true },
  { name: "remote server", key: "right", local: false, enabled: true },
  { name: "disabled history", key: "tab", local: true, enabled: false },
])("$name accepts a suggestion with $key", async ({ key, local, enabled }) => {
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
  const prior = Array.from({ length: 4 }, (_, i) => [
    { name: "User", content: `How did project ${i} go?` },
    { name: "Coding assistant", content: i ? `Project ${i} passed.` : "x".repeat(4095) + "…" },
    { name: "User", content: "show me the diff" },
  ])
  const chats = prior.map((_, i) => ({
    ...session,
    id: "ses_prior_" + i,
    projectID: "proj_" + i,
    location: { directory: "/project-" + i },
  }))
  await using state = await tmpdir()
  const historyReads: string[] = []
  const requests: unknown[] = []
  const generated = Promise.withResolvers<void>()
  let submitted = 0
  let codingCalls = 0
  let connected = false
  const suggestion = "Yes, run the dry-run checks."
  await using setup = await createAppFixture({
    state: state.path,
    localServer: local,
    width: 100,
    height: 30,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" }, experimental: { "prompt-suggestion-history": enabled } },
    fetch: async (url, request) => {
      if (
        url.pathname === "/api/session" &&
        url.searchParams.get("limit") === "50" &&
        url.searchParams.get("order") === "desc"
      ) {
        historyReads.push("list")
        expect(url.searchParams.has("directory")).toBe(false)
        expect(url.searchParams.has("project")).toBe(false)
        return json({
          data: [
            session,
            { ...session, id: "ses_empty" },
            {
              ...session,
              id: "ses_fork",
              fork: { sessionID: session.id, boundary: { type: "through", messageID: "msg_1" } },
            },
            ...chats.toReversed(),
          ],
          cursor: {},
        })
      }
      if (url.pathname === "/api/session/ses_empty/message") {
        return json({ data: [], cursor: {} })
      }
      const chat = chats.findIndex((s) => url.pathname === `/api/session/${s.id}/message`)
      if (chat >= 0) {
        historyReads.push(url.pathname)
        expect(url.searchParams.has("type")).toBe(false)
        expect(url.searchParams.get("order")).toBe("desc")
        return json({
          data: [
            user("msg_followup", prior[chat][2].content),
            { id: "msg_system", type: "system", text: "Invisible instruction", time: { created: 2 } },
            reply("msg_reply", chat ? prior[chat][1].content : "x".repeat(4095) + "🙂long reply"),
            user("msg_question", prior[chat][0].content),
          ],
          cursor: {},
        })
      }
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
  await setup.waitForFrame((frame) => frame.includes(suggestion))
  const editor = setup.renderer.currentFocusedEditor
  if (!(editor instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  expect(editor.placeholder).toBe(suggestion)
  expect(editor.plainText).toBe("")
  expect(historyReads.toSorted()).toEqual(
    local && enabled ? [...chats.map((s) => `/api/session/${s.id}/message`), "list"] : [],
  )
  expect(requests).toHaveLength(1)
  expect(requests[0]).toEqual({
    input: {
      ...(local && enabled ? { priorConversations: prior } : {}),
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
  await setup.waitFor(() => editor.plainText === suggestion)
  expect(submitted).toBe(0)
  expect(codingCalls).toBe(0)
})
