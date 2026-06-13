import { describe, expect, it } from "vitest";
import { traceEventToDisplayEntries } from "../src/tui/trace-log.js";

describe("TUI trace display mapping", () => {
  it("maps text, reasoning, steps, inputs, finish, and errors", () => {
    expect(traceEventToDisplayEntries({ type: "assistant-text-delta", text: "hi" })).toEqual([{ kind: "assistant-text", text: "hi" }]);
    expect(traceEventToDisplayEntries({ type: "assistant-reasoning-delta", text: "why" })).toEqual([{ kind: "reasoning", text: "why" }]);
    expect(traceEventToDisplayEntries({ type: "step-start", stepNumber: 2 })).toEqual([{ kind: "step", label: "start", stepNumber: 2 }]);
    expect(traceEventToDisplayEntries({ type: "step-finish" })).toEqual([{ kind: "step", label: "finish" }]);
    expect(traceEventToDisplayEntries({ type: "tool-input-start", toolName: "repl" })[0]).toMatchObject({ kind: "tool-input", text: "input start" });
    expect(traceEventToDisplayEntries({ type: "tool-input-delta", toolName: "repl", text: "{" })[0]).toMatchObject({ kind: "tool-input", text: "{" });
    expect(traceEventToDisplayEntries({ type: "tool-input-end", toolName: "repl" })[0]).toMatchObject({ kind: "tool-input", text: "input end" });
    expect(traceEventToDisplayEntries({ type: "tool-error", toolName: "repl", error: new Error("bad") })[0]).toMatchObject({ kind: "tool-result", status: "error", summary: "bad" });
    expect(traceEventToDisplayEntries({ type: "finish" })).toEqual([{ kind: "finish" }]);
  });

  it("summarizes REPL code from the first non-empty line and preserves detail", () => {
    const [entry] = traceEventToDisplayEntries({ type: "tool-call", toolName: "repl", input: { code: "\n  x = 1\n  x" }, toolCallId: "t" });
    expect(entry).toEqual({ kind: "tool-call", toolName: "repl", summary: "x = 1", detail: "\n  x = 1\n  x", toolCallId: "t" });
    expect(traceEventToDisplayEntries({ type: "tool-call", toolName: "repl", input: { code: "  \n\t" } })[0]).toMatchObject({ summary: "<empty code>" });
  });

  it("classifies REPL output summaries and details", () => {
    expect(traceEventToDisplayEntries({ type: "tool-result", toolName: "repl", output: { stdout: "hi\n", stderr: "", resultPreview: "2", finalSet: false } })[0]).toMatchObject({ status: "ok", summary: "stdout + result" });
    expect(traceEventToDisplayEntries({ type: "tool-result", toolName: "repl", output: { stdout: "", stderr: "oops", finalSet: true } })[0]).toMatchObject({ status: "stderr", summary: "stderr + final" });
    const [finalSet] = traceEventToDisplayEntries({ type: "tool-result", toolName: "repl", output: { stdout: "", stderr: "", finalSet: true } });
    expect(finalSet).toMatchObject({ status: "final-set", summary: "final" });
    expect(finalSet?.kind === "tool-result" ? finalSet.detail : "").toContain("finalSet: true");
  });

  it("falls back safely for unknown payloads and truncates long values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const [call] = traceEventToDisplayEntries({ type: "tool-call", toolName: "other", input: circular });
    expect(call).toMatchObject({ kind: "tool-call", toolName: "other" });
    const [result] = traceEventToDisplayEntries({ type: "tool-result", toolName: "other", output: "x".repeat(3000) });
    expect(result?.kind === "tool-result" ? result.summary.length : 0).toBeLessThan(2100);
  });
});
