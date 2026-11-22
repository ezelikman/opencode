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

export const maxSessions = 3
export const maxPrompts = 3
export const maxPromptLength = 512

const priorPrompts = Schema.Array(
  Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maxPromptLength))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maxPrompts),
  ),
).check(Schema.isMaxLength(maxSessions))

export const Request = Schema.Struct({
  priorPrompts: Schema.optionalKey(priorPrompts),
  turns: Schema.Array(Schema.Struct({ name: Schema.Literals(["User", "Coding assistant"]), content: Schema.String })),
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
