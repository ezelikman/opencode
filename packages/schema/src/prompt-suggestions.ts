export * as PromptSuggestions from "./prompt-suggestions.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

export const path = "/api/v2/prompt-suggestions"
export const capabilityHeader = "x-opencode-prompt-suggestions"

export function suggestionText(value: string | null) {
  const text = value?.trim()
  if (!text || /^NO_SUGGESTION$/i.test(text) || /^[!/]/.test(text)) return null
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text) || Array.from(text).length > 200) return null
  return text
}

export const maxPriorChats = 8
export const maxPriorMessages = 64
export const maxChatLength = 8192

export const Turn = Schema.Struct({ name: Schema.Literals(["User", "Coding assistant"]), content: Schema.String })
const priorChat = Schema.Array(Turn).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(maxPriorMessages),
  Schema.makeFilter((turns) => turns.reduce((size, turn) => size + turn.content.length, 0) <= maxChatLength),
)

export const Request = Schema.Struct({
  priorConversations: Schema.optionalKey(Schema.Array(priorChat).check(Schema.isMaxLength(maxPriorChats))),
  turns: Schema.Array(Turn),
})
export const Response = Schema.Struct({ text: Schema.NullOr(Schema.String) })

export const Definition = Rpc.define({
  id: "opencode.prompt-suggestions",
  methods: {
    available: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Boolean),
    },
    predict: {
      input: Schema.toStandardSchemaV1(Request),
      output: Schema.toStandardSchemaV1(Response),
    },
  },
  events: {},
})
