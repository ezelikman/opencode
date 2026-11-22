# Console prompt suggestions

This handler predicts the user's next OpenCode prompt from the visible user and assistant turns in the current session. Tab or Right Arrow accepts the suggestion into the draft. The coding model continues to handle submitted prompts.

With a locally managed OpenCode server, suggestions also draw on up to three recent top-level chats in the same directory. From each, OpenCode considers the last 12 user messages and sends up to three distinct prompts of at most 512 UTF-16 code units each. Each must match a plain normal-mode entry in the local TUI’s 50-entry prompt history. Archived, forked, and reverted chats are skipped. Persimmon receives the earlier prompts grouped by conversation, separately from the current transcript.

Turn off **Use prior chats for suggestions** in Experiments to use just the current conversation. Explicit server connections also use just the current conversation. If earlier chats are unavailable, autocomplete can still use the active chat.

## Run the live demo

From a checkout with the workspace dependencies installed, run the following in a terminal. Pass a file containing a Persimmon API key, or set `USER_MODEL_API_KEY` and omit the file argument.

```sh
bun run --cwd services/prompt-suggestions demo /path/to/persimmon-key
```

The demo starts a loopback Console, imports two earlier chats and a synthetic four-message session into a temporary OpenCode profile, and opens the fork's TUI. The Console holds the Persimmon key and makes a billed standard-tier request. After the last reply, the suggestion appears as faint text in the empty prompt. Press Tab or Right Arrow to edit it. A model can abstain. Exit OpenCode to close the server and remove the demo profile.

## Mount in Console

Mount `promptSuggestions({ apiKey, definitionID, authorize })` from `src/route.ts` at `POST /api/v2/prompt-suggestions` in the hosted Console router. Supply the service key from Console's secret store. Run `createDefinition(apiKey)` once and save the returned ID in deployment configuration. This definition includes a read-only “Earlier conversations” participant and allows only the User to generate text. When upgrading from the two-participant definition, provision a new definition ID. Each prediction supplies its own history.

Use the Console's existing workspace authentication, entitlement and usage controls in `authorize`. Return a denial response or return `undefined` to proceed. Advertise `x-opencode-prompt-suggestions: 1` on the authenticated config response only for eligible workspaces. The fork's loopback server exercises both routes with a temporary workspace credential. Production Console routing and deployment are maintained outside this repository.

The endpoint returns `{ "text": "..." }` or `{ "text": null }`. Upstream throttling returns 429, upstream failures return 502, and a timeout returns 504. OpenCode leaves the prompt available in all cases.
