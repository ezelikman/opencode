import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client"
import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

type Exchange = { sessionID: string; replyID: string; directory: string }

function sameExchange(first?: Exchange, second?: Exchange) {
  return (
    first !== undefined &&
    first.sessionID === second?.sessionID &&
    first.replyID === second.replyID &&
    first.directory === second.directory
  )
}

export function latestReply(messages: readonly SessionMessageInfo[]) {
  const user = messages.findLastIndex((message) => message.type === "user")
  const index = messages.findLastIndex(
    (message) =>
      message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text.trim()),
  )
  if (user < 0 || index <= user) return
  const reply = messages[index]
  if (reply.type === "assistant" && reply.time.completed) return reply.id
}

export function createSuggestion(client: OpenCodeClient, exchange: Accessor<Exchange | undefined>) {
  const [result, setResult] = createSignal<{ exchange: Exchange; text?: string }>()
  createEffect(
    on(exchange, (current) => {
      if (!current || sameExchange(result()?.exchange, current)) return
      const abort = new AbortController()
      onCleanup(() => abort.abort())
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)])
      void predict(client, current, signal)
        .catch(() => undefined)
        .then((text) => {
          if (abort.signal.aborted) return
          setResult({ exchange: current, text })
        })
    }),
  )
  return () => {
    const suggestion = result()
    if (suggestion && sameExchange(suggestion.exchange, exchange())) return suggestion.text
  }
}

async function predict(client: OpenCodeClient, exchange: Exchange, signal: AbortSignal) {
  const rpc = client.rpc(PromptSuggestions.Definition)
  const options = { location: { directory: exchange.directory }, signal }
  if (!(await rpc.available({}, options))) return

  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = await client.message.list(
      { sessionID: exchange.sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) },
      { signal },
    )
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  if (latestReply(messages) !== exchange.replyID) return

  const turns = messages.flatMap<(typeof PromptSuggestions.Request.Type)["turns"][number]>((message) => {
    if (message.type === "user" && message.text.trim()) return [{ name: "User", content: message.text }]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    return content.trim() ? [{ name: "Coding assistant", content }] : []
  })
  const result = await rpc.predict({ turns }, options)
  const text = result.text?.trim()
  if (!text || /^NO_SUGGESTION$/i.test(text) || /^[!/]/.test(text)) return
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text) || Array.from(text).length > 200) return
  return text
}
