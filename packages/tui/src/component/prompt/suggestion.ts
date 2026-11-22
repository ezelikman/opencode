import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client"
import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

type Exchange = { sessionID: string; replyID: string; directory: string; includeHistory: boolean }

function sameExchange(first?: Exchange, second?: Exchange) {
  return (
    first !== undefined &&
    first.sessionID === second?.sessionID &&
    first.replyID === second.replyID &&
    first.directory === second.directory &&
    first.includeHistory === second.includeHistory
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

  const [messages, priorConversations] = await Promise.all([
    readTranscript(client, exchange.sessionID, signal),
    exchange.includeHistory ? readPriorConversations(client, exchange.sessionID, signal).catch(() => []) : [],
  ])
  if (latestReply(messages) !== exchange.replyID) return

  const result = await rpc.predict(
    {
      turns: visibleTurns(messages),
      ...(priorConversations.length ? { priorConversations } : {}),
    },
    options,
  )
  return PromptSuggestions.suggestionText(result.text) ?? undefined
}

function visibleTurns(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap<typeof PromptSuggestions.Turn.Type>((message) => {
    if (message.type === "user" && message.text.trim()) return [{ name: "User", content: message.text }]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    return content.trim() ? [{ name: "Coding assistant", content }] : []
  })
}

async function readTranscript(client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = await client.message.list(
      { sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) },
      { signal },
    )
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return messages
}

async function readPriorConversations(client: OpenCodeClient, sessionID: string, parentSignal: AbortSignal) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(1500)])
  const recent = await client.session.list({ order: "desc", archived: false, parentID: null, limit: 50 }, { signal })
  const sessions = recent.data
    .filter((s) => s.id !== sessionID && !s.parentID && !s.fork && !s.revert && s.time.archived === undefined)
    .slice(0, PromptSuggestions.maxPriorChats)
  const chats = await Promise.all(
    sessions.map(async (session) => {
      const page = await client.message
        .list({ sessionID: session.id, order: "desc", limit: PromptSuggestions.maxPriorMessages }, { signal })
        .catch(() => undefined)
      if (!page) return []
      const excerpt: (typeof PromptSuggestions.Turn.Type)[] = []
      let remaining = PromptSuggestions.maxChatLength
      for (const turn of visibleTurns(page.data)) {
        if (!remaining) break
        // Leave room for the other side of the exchange even when one reply is very long.
        const limit = Math.min(remaining, PromptSuggestions.maxChatLength / 2)
        const content =
          turn.content.length <= limit
            ? turn.content
            : turn.content.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "") + "…"
        excerpt.push({ name: turn.name, content })
        remaining -= content.length
      }
      return excerpt.reverse()
    }),
  )
  return chats.filter((chat) => chat.length).reverse()
}
