import { jsonSchema, tool } from "ai";
import type { RlmReplSession, ReplExecutionResult } from "../rlm/repl.js";

export type ReplToolInput = {
  code: string;
};

const replInputSchema = jsonSchema<ReplToolInput>({
  type: "object",
  properties: {
    code: {
      type: "string",
      description: "Python code to execute in the initialized REPL session.",
    },
  },
  required: ["code"],
  additionalProperties: false,
});

export function createReplTool(session: RlmReplSession) {
  return tool<ReplToolInput, ReplExecutionResult>({
    description:
      "Execute Python code in the turn-scoped REPL. context is already available. Prefer targeted small reads from context. The user-visible final answer must be provided by calling FINAL(...) or FINAL_VAR(...).",
    inputSchema: replInputSchema,
    execute: async (input) => session.execute(input.code),
  });
}
