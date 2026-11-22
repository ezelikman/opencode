# Console prompt suggestions

This handler predicts the user's next OpenCode prompt from the visible user and assistant turns in the current session. Tab or Right Arrow accepts the suggestion into the draft. The coding model continues to handle submitted prompts.

With a locally managed OpenCode server, suggestions include recent conversations stored in the local profile across projects. OpenCode reads the visible user messages and assistant replies directly from session history. Each excerpt keeps its original speakers and message order. Tool output, hidden reasoning, attachment payloads, and system messages are excluded.

OpenCode selects up to eight earlier top-level chats from the 50 most recently updated unarchived sessions, skipping forks and reverted chats. It reads the latest 64 messages per selected chat, with a 1.5-second deadline for local history reads. The newest visible turns take priority within an 8,192 UTF-16 code unit budget per chat. A single historical message can use up to half that budget. These limits apply only to earlier chats. Console sends the complete visible active transcript. Persimmon manages long histories within its documented 16,384-token model context. [Persimmon API limits](https://persimmon.humansand.ai/docs)

Turn off **Use prior chats for suggestions** in Experiments to use just the current conversation. Explicit server connections also use just the current conversation. If earlier chats are unavailable, autocomplete can still use the active chat.

## How Persimmon receives the conversation

The definition describes the setting and the participants. For each prediction, Console sends the ordered turns with their original speaker names and explicitly requests the next turn from `User`. The coding assistant and OpenCode supply their own text. The standard tier suits an interactive suggestion because it has lower latency than the higher-compute tiers. [Persimmon REST API](https://persimmon.humansand.ai/docs) · [Official SDK guide and tier notes](https://pypi.org/project/humansand/)

OpenCode adds a marker before each earlier chat and at the start of the current one. This is an application convention. It lets Persimmon see what prompted each earlier response while the current exchange supplies the task. A suggested turn enters conversation history only when the user submits it.

## Run the live demo

From a checkout with the workspace dependencies installed, run the following in a terminal. Pass a file containing a Persimmon API key, or set `USER_MODEL_API_KEY` and omit the file argument.

```sh
bun run --cwd services/prompt-suggestions demo /path/to/persimmon-key
```

The demo starts a loopback Console, imports two earlier chats across two projects and a synthetic four-message session into a temporary OpenCode profile, and opens the fork's TUI. The Console holds the Persimmon key and makes a billed standard-tier request. After the last reply, the suggestion appears as faint text in the empty prompt. Press Tab or Right Arrow to edit it. A model can abstain. Exit OpenCode to close the server and remove the demo profile.

## Mount in Console

Mount `promptSuggestions({ apiKey, definitionID, authorize })` from `src/route.ts` at `POST /api/v2/prompt-suggestions` in the hosted Console router. Supply the service key from Console's secret store. Run `createDefinition(apiKey)` once and save the returned ID in deployment configuration. This definition includes the application-supplied `OpenCode` boundary participant and permits only `User` to generate text. Provision a new definition ID when upgrading from the earlier prompt-only preview. Each prediction supplies its own history.

Use the Console's existing workspace authentication, entitlement and usage controls in `authorize`. Return a denial response or return `undefined` to proceed. Advertise `x-opencode-prompt-suggestions: 1` on the authenticated config response only for eligible workspaces. The fork's loopback server exercises both routes with a temporary workspace credential. Production Console routing and deployment are maintained outside this repository.

The endpoint returns `{ "text": "..." }` or `{ "text": null }`. Upstream throttling returns 429, upstream failures return 502, and a timeout returns 504. OpenCode leaves the prompt available in all cases.
