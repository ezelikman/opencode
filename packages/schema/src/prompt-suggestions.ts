export * as PromptSuggestions from "./prompt-suggestions.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

export const Request = Schema.Struct({
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
