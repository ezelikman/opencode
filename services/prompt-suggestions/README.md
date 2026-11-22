# Console prompt suggestions

This handler predicts the user's next OpenCode prompt from the visible user and assistant turns in the current session. Tab or Right Arrow accepts the suggestion into the draft. The coding model continues to handle submitted prompts.

With a locally managed OpenCode server, suggestions can use up to 50 distinct prompts across projects in the local profile. The prompts can come from one chat or many. OpenCode starts with the TUI’s 50-entry recall history and matches plain, submitted user messages of up to 512 UTF-16 code units each. It searches the 51 most recently updated, unarchived top-level chats and checks up to 50 recent user messages per eligible chat. OpenCode skips the active chat, forks, and reverted chats. The lookup has a 1.5-second deadline and uses any matches found by then. Persimmon receives these examples grouped by conversation and uses them for the user’s writing style. The active conversation supplies the task and its facts.

Turn off **Use prior chats for suggestions** in Experiments to use just the current conversation. Explicit server connections also use just the current conversation. If earlier chats are unavailable, autocomplete can still use the active chat.

## Run the live demo

From a checkout with the workspace dependencies installed, run the following in a terminal. Pass a file containing a Persimmon API key, or set `USER_MODEL_API_KEY` and omit the file argument.

```sh
bun run --cwd services/prompt-suggestions demo /path/to/persimmon-key
```

The demo starts a loopback Console, imports two earlier chats across two projects and a synthetic four-message session into a temporary OpenCode profile, and opens the fork's TUI. The Console holds the Persimmon key and makes a billed standard-tier request. After the last reply, the suggestion appears as faint text in the empty prompt. Press Tab or Right Arrow to edit it. A model can abstain. Exit OpenCode to close the server and remove the demo profile.

## Mount in Console

Mount `promptSuggestions({ apiKey, definitionID, authorize })` from `src/route.ts` at `POST /api/v2/prompt-suggestions` in the hosted Console router. Supply the service key from Console's secret store. Run `createDefinition(apiKey)` once and save the returned ID in deployment configuration. This definition includes a read-only “Earlier conversations” participant and allows only the User to generate text. When upgrading an existing deployment, provision a new definition ID to pick up the cross-project writing-style instructions. Each prediction supplies its own history.

Use the Console's existing workspace authentication, entitlement and usage controls in `authorize`. Return a denial response or return `undefined` to proceed. Advertise `x-opencode-prompt-suggestions: 1` on the authenticated config response only for eligible workspaces. The fork's loopback server exercises both routes with a temporary workspace credential. Production Console routing and deployment are maintained outside this repository.

The endpoint returns `{ "text": "..." }` or `{ "text": null }`. Upstream throttling returns 429, upstream failures return 502, and a timeout returns 504. OpenCode leaves the prompt available in all cases.
