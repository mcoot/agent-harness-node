import { describe, expect, it } from "vitest";
import { normalizeTextStreamPart } from "../src/trace.js";
import { ANSI_GREY, ANSI_RESET, formatFinalAnswer, formatTraceEvent } from "../src/trace-renderer.js";

describe("trace normalization", () => {
  it("normalizes representative AI SDK stream parts", () => {
    expect(normalizeTextStreamPart({ type: "text-delta", text: "hi" })).toEqual([
      { type: "assistant-text-delta", text: "hi" },
    ]);
    expect(normalizeTextStreamPart({ type: "reasoning-delta", text: "why" })).toEqual([
      { type: "assistant-reasoning-delta", text: "why" },
    ]);
    expect(normalizeTextStreamPart({ type: "tool-input-start", toolName: "repl", id: "1" })).toEqual([
      { type: "tool-input-start", toolName: "repl", toolCallId: "1" },
    ]);
    expect(normalizeTextStreamPart({ type: "tool-input-delta", toolName: "repl", delta: "{}", id: "1" })).toEqual([
      { type: "tool-input-delta", toolName: "repl", text: "{}", toolCallId: "1" },
    ]);
    expect(normalizeTextStreamPart({ type: "tool-call", toolName: "repl", input: { code: "1+1" }, id: "1" })).toEqual([
      { type: "tool-call", toolName: "repl", input: { code: "1+1" }, toolCallId: "1" },
    ]);
    expect(normalizeTextStreamPart({ type: "tool-result", toolName: "repl", output: { resultPreview: "2" }, id: "1" })).toEqual([
      { type: "tool-result", toolName: "repl", output: { resultPreview: "2" }, toolCallId: "1" },
    ]);
    expect(normalizeTextStreamPart({ type: "unknown" })).toEqual([]);
  });
});

describe("trace rendering", () => {
  it("renders trace in grey and final answer without grey", () => {
    expect(formatTraceEvent({ type: "assistant-text-delta", text: "hello" })).toBe(`${ANSI_GREY}hello${ANSI_RESET}`);
    expect(formatTraceEvent({ type: "tool-call", toolName: "repl", input: {} })).toContain("repl");
    expect(formatFinalAnswer("done")).toBe("\ndone\n\n");
  });
});
