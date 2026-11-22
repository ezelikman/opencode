# Console prompt suggestions

This handler predicts the user's next OpenCode prompt from the visible user and assistant turns in the current session. Tab or Right Arrow accepts the suggestion into the draft. The coding model continues to handle submitted prompts.

## Run the live demo

From a checkout with the workspace dependencies installed, run the following in a terminal. Pass a file containing a Persimmon API key, or set `USER_MODEL_API_KEY` and omit the file argument.

```sh
bun run --cwd services/prompt-suggestions demo /path/to/persimmon-key
```

The demo starts a loopback Console, imports a synthetic four-message session into a temporary OpenCode profile, and opens the fork's TUI. The Console holds the Persimmon key and makes a billed standard-tier request. After the last reply, look for `[Tab/Right]` in the prompt and press either key to edit the suggestion. A model can abstain. Exit OpenCode to close the server and remove the demo profile.

## Mount in Console

Mount `promptSuggestions({ apiKey, definitionID, authorize })` from `src/route.ts` at `POST /api/v2/prompt-suggestions` in the hosted Console router. Supply the service key from Console's secret store. Run `createDefinition(apiKey)` once and save the returned ID in deployment configuration. This definition fixes the participants and allows only the User to generate text. Each prediction supplies its own history.

Use the Console's existing workspace authentication, entitlement and usage controls in `authorize`. Return a denial response or return `undefined` to proceed. Advertise `x-opencode-prompt-suggestions: 1` on the authenticated config response only for eligible workspaces. The fork's loopback server exercises both routes with a temporary workspace credential. Production Console routing and deployment are maintained outside this repository.

The endpoint returns `{ "text": "..." }` or `{ "text": null }`. Upstream throttling returns 429, upstream failures return 502, and a timeout returns 504. OpenCode leaves the prompt available in all cases.
