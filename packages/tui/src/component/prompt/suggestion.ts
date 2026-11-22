import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client"
import { PromptSuggestions } from "@opencode/schema/prompt-suggestions"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { useHistoryEntries, type PromptInfo } from "../../prompt/history"

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
  const history = useHistoryEntries()
  const [result, setResult] = createSignal<{ exchange: Exchange; text?: string }>()
  createEffect(
    on(
      () => {
        const current = exchange()
        return current?.includeHistory && !history.loaded() ? undefined : current
      },
      (current) => {
        if (!current || sameExchange(result()?.exchange, current)) return
        const abort = new AbortController()
        onCleanup(() => abort.abort())
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)])
        void predict(client, current, history.entries, signal)
          .catch(() => undefined)
          .then((text) => {
            if (abort.signal.aborted) return
            setResult({ exchange: current, text })
          })
      },
    ),
  )
  return () => {
    const suggestion = result()
    if (suggestion && sameExchange(suggestion.exchange, exchange())) return suggestion.text
  }
}

async function predict(
  client: OpenCodeClient,
  exchange: Exchange,
  history: readonly PromptInfo[],
  signal: AbortSignal,
) {
  const rpc = client.rpc(PromptSuggestions.Definition)
  const options = { location: { directory: exchange.directory }, signal }
  if (!(await rpc.available({}, options))) return

  const [messages, priorPrompts] = await Promise.all([
    readTranscript(client, exchange.sessionID, signal),
    exchange.includeHistory ? readPriorPrompts(client, exchange.sessionID, history, signal).catch(() => []) : [],
  ])
  if (latestReply(messages) !== exchange.replyID) return

  const turns = messages.flatMap<(typeof PromptSuggestions.Request.Type)["turns"][number]>((message) => {
    if (message.type === "user" && message.text.trim()) return [{ name: "User", content: message.text }]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    return content.trim() ? [{ name: "Coding assistant", content }] : []
  })
  const result = await rpc.predict({ turns, ...(priorPrompts.length ? { priorPrompts } : {}) }, options)
  return PromptSuggestions.suggestionText(result.text) ?? undefined
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

async function readPriorPrompts(
  client: OpenCodeClient,
  sessionID: string,
  history: readonly PromptInfo[],
  parentSignal: AbortSignal,
) {
  // Recall history also includes cleared drafts and shell commands. Require a matching user message in another chat.
  const local = new Set(
    history
      .slice(-PromptSuggestions.maxPriorPrompts)
      .filter(
        (item) =>
          item.mode === "normal" &&
          item.text.trim() &&
          item.text.length <= PromptSuggestions.maxPromptLength &&
          !item.pasted.length &&
          !item.files?.length &&
          !item.text.trimStart().startsWith("/"),
      )
      .map((item) => item.text),
  )
  if (!local.size) return []
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(1500)])
  const recent = await client.session.list(
    {
      order: "desc",
      archived: false,
      parentID: null,
      limit: PromptSuggestions.maxPriorPrompts + 1,
    },
    { signal },
  )
  const sessions = recent.data.filter(
    (s) => s.id !== sessionID && !s.parentID && !s.fork && !s.revert && s.time.archived === undefined,
  )
  const groups: string[][] = []
  // Read in bounded batches so a large profile does not fan out a request for every chat at once.
  const batchSize = 6
  for (let i = 0; i < sessions.length && local.size && !signal.aborted; i += batchSize) {
    const pages = await Promise.all(
      sessions
        .slice(i, i + batchSize)
        .map((session) =>
          client.message
            .list(
              { sessionID: session.id, type: "user", order: "desc", limit: PromptSuggestions.maxPriorPrompts },
              { signal },
            )
            .catch(() => undefined),
        ),
    )
    for (const page of pages) {
      const group = page?.data.flatMap((m) => (m.type === "user" && local.delete(m.text) ? [m.text] : []))
      if (group?.length) groups.push(group.reverse())
    }
  }
  return groups.reverse()
}
