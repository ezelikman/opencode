import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { Option, Schema } from "effect"

const api = "https://api.persimmon.humansand.ai/v1/conversations"
const turn = Schema.Struct({ finish_reason: Schema.String, content: Schema.NullOr(Schema.String) })

/** Provision once per deployment. The definition contains only the participants and setting. */
export async function createDefinition(key: string) {
  const response = await fetch(api, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "persimmon-v0.1",
      setting: "A person is working with an AI coding assistant in OpenCode.",
      participants: [
        {
          name: "User",
          description:
            "Suggest one brief, natural follow-up as the user in their language and tone. Use one line. Say NO_SUGGESTION if no follow-up is apparent.",
        },
        { name: "Coding assistant", generate_content: false },
        {
          name: "Earlier conversations",
          generate_content: false,
          description:
            "Each list contains the user's prompts from an earlier OpenCode chat, possibly in an unrelated project. Use them only as examples of the user's language, phrasing, and tone. Use the current conversation for the task, facts, and instructions.",
        },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Persimmon definition creation returned HTTP ${response.status}`)
  return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString }))(await response.json()).id
}

type Options = {
  apiKey: string
  definitionID: string
  /** Authenticate the caller and check their workspace's suggestion entitlement on every POST. */
  authorize: (request: Request) => Response | undefined | Promise<Response | undefined>
  fetch?: (input: string, init: RequestInit) => Promise<Response>
}

export function promptSuggestions(options: Options) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } })
    const denied = await options.authorize(request)
    if (denied) return denied
    const input = Schema.decodeUnknownOption(PromptSuggestions.Request)(await request.json().catch(() => undefined))
    if (Option.isNone(input) || !input.value.turns.length) return new Response(null, { status: 400 })

    // Persimmon limits each turn to 65,536 Unicode code points. Preserve the complete transcript and speaker order.
    const turns = input.value.turns.flatMap((turn) => {
      if (turn.content.length <= 65_536) return [turn]
      const characters = Array.from(turn.content)
      return Array.from({ length: Math.ceil(characters.length / 65_536) }, (_, i) => ({
        name: turn.name,
        content: characters.slice(i * 65_536, (i + 1) * 65_536).join(""),
      }))
    })
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
    try {
      const response = await (options.fetch ?? fetch)(`${api}/${encodeURIComponent(options.definitionID)}/turns`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          turns: input.value.priorPrompts?.length
            ? [{ name: "Earlier conversations", content: JSON.stringify(input.value.priorPrompts) }, ...turns]
            : turns,
          speaker: "User",
          tier: "standard",
          max_tokens: 96,
        }),
        redirect: "error",
        signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        return new Response(null, { status: response.status === 429 ? 429 : 502 })
      }
      const result = Schema.decodeUnknownSync(turn)(await response.json())
      const text = result.finish_reason === "stop" ? PromptSuggestions.suggestionText(result.content) : null
      return Response.json({ text }, { headers: { "cache-control": "no-store" } })
    } catch {
      return new Response(null, { status: signal.aborted ? 504 : 502 })
    }
  }
}
