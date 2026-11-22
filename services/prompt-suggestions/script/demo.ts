import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { createDefinition, promptSuggestions } from "../src/route"

const keyFile = process.argv[2]
const apiKey = (keyFile ? await Bun.file(keyFile).text() : process.env.USER_MODEL_API_KEY)?.trim()
if (!apiKey) throw new Error("Pass a Persimmon key file or set USER_MODEL_API_KEY for the local Console demo.")
const definition = process.env.PERSIMMON_DEFINITION_ID || (await createDefinition(apiKey))
const key = crypto.randomUUID()
const orgID = "workspace_demo"
function authorize(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${key}`) return new Response(null, { status: 401 })
  if (request.headers.get("x-org-id") !== orgID) return new Response(null, { status: 403 })
}
const predict = promptSuggestions({ apiKey, definitionID: definition, authorize })
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  maxRequestBodySize: 8 * 1024 * 1024,
  routes: {
    "/api/v2/config": {
      GET: (request) =>
        authorize(request) ??
        Response.json(
          { providers: {} },
          {
            headers: { [PromptSuggestions.capabilityHeader]: "1", "cache-control": "no-store" },
          },
        ),
    },
    [PromptSuggestions.path]: predict,
  },
  fetch: () => new Response(null, { status: 404 }),
})

const root = await realpath(await mkdtemp(path.join(tmpdir(), "opencode-suggestions-")))
const cli = path.resolve(import.meta.dir, "../../../packages/cli")
const env = {
  PATH: process.env.PATH,
  TERM: process.env.TERM,
  COLORTERM: process.env.COLORTERM,
  LANG: process.env.LANG,
  HOME: root,
  OPENCODE_TEST_HOME: root,
  OPENCODE_DB: path.join(root, "demo.db"),
  XDG_CONFIG_HOME: root,
  XDG_STATE_HOME: root,
  XDG_CACHE_HOME: root,
  XDG_DATA_HOME: root,
  OPENCODE_CONFIG_DIR: path.join(root, "config"),
  OPENCODE_DISABLE_MODELS_FETCH: "true",
}

async function run(args: string[], stdin: "inherit" | Blob = "inherit") {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--standalone", ...args], {
    cwd: cli,
    env,
    stdin,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await child.exited) !== 0) throw new Error(`OpenCode exited with status ${child.exitCode}`)
}

try {
  await run(
    ["auth", "import"],
    new Blob([
      JSON.stringify([
        {
          id: "cred_demo",
          integrationID: "opencode",
          label: "Local Console",
          active: true,
          value: { type: "key", key, metadata: { orgID, server: server.url.origin } },
        },
      ]),
    ]),
  )
  const sessionID = "ses_suggestions_demo"
  const sessionFile = path.join(root, "session.json")
  const model = { id: "demo", providerID: "demo" }
  const info = {
    id: sessionID,
    projectID: "global",
    location: { directory: root },
    title: "Persimmon autocomplete demo",
    time: { created: 1, updated: 4 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const messages = [
    { id: "msg_1", type: "user", text: "Use dry-run mode and the label TEAL-2841.", time: { created: 1 } },
    {
      id: "msg_2",
      type: "assistant",
      agent: "build",
      model,
      content: [{ type: "text", text: "I have the label and will use dry-run mode." }],
      time: { created: 2, completed: 2 },
    },
    { id: "msg_3", type: "user", text: "What is next?", time: { created: 3 } },
    {
      id: "msg_4",
      type: "assistant",
      agent: "build",
      model,
      content: [{ type: "text", text: "Shall I run the validation with your earlier settings?" }],
      time: { created: 4, completed: 4 },
    },
  ]
  const previous = [
    ["quick version pls, how did the docs review go?", "The setup example needs one correction."],
    ["Show me a dry run before changing files.", "The dry run found two files to update."],
  ]
  const otherProject = path.join(root, "docs-project")
  await Bun.$`git init --quiet ${otherProject}`
  await Bun.$`git -C ${otherProject} remote add origin https://example.invalid/demo/docs.git`
  for (const [index, [text, reply]] of previous.entries()) {
    const directory = index === 0 ? otherProject : root
    const id = "ses_demo_prior_" + index
    await Bun.write(
      sessionFile,
      JSON.stringify({
        info: { ...info, id, location: { directory }, title: "Previous chat" },
        messages: [
          { id: "msg_demo_prior_user_" + index, type: "user", text, time: { created: 1 } },
          {
            id: "msg_demo_prior_reply_" + index,
            type: "assistant",
            agent: "build",
            model,
            content: [{ type: "text", text: reply }],
            time: { created: 2, completed: 2 },
          },
        ],
      }),
    )
    await run(["session", "import", sessionFile, "--directory", directory])
  }
  await Bun.write(sessionFile, JSON.stringify({ info, messages }))
  await run(["session", "import", sessionFile, "--directory", root])
  await run([root, "--session", sessionID])
} finally {
  await server.stop(true)
  await rm(root, { recursive: true, force: true })
  if (!process.env.PERSIMMON_DEFINITION_ID) {
    const response = await fetch(
      `https://api.persimmon.humansand.ai/v1/conversations/${encodeURIComponent(definition)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) console.error(`Could not archive the demo definition (HTTP ${response.status}).`)
  }
}
