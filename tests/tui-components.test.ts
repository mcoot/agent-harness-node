import { describe, expect, it } from "vitest";
import { TUI, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { Composer } from "../src/tui/components/composer.js";
import { StatusLine } from "../src/tui/components/status-line.js";
import { Transcript } from "../src/tui/components/transcript.js";
import { renderTraceEntries } from "../src/tui/components/trace-block.js";
import type { TuiState } from "../src/tui/state.js";
import { traceEventToDisplayEntries } from "../src/tui/trace-log.js";

function assertWidths(lines: string[], width: number) {
  for (const line of lines) expect(visibleWidth(line), line).toBeLessThanOrEqual(width);
}

function state(filters: TuiState["filters"]): TuiState {
  const entries = [
    ...traceEventToDisplayEntries({ type: "tool-call", toolName: "repl", input: { code: "x = 1\n# FULL_CODE_MARKER\nx" } }),
    ...traceEventToDisplayEntries({ type: "tool-result", toolName: "repl", output: { stdout: "STDOUT_FULL_MARKER\n", stderr: "", resultPreview: "RESULT_FULL_MARKER", finalSet: true } }),
    ...traceEventToDisplayEntries({ type: "assistant-text-delta", text: "ASSISTANT_TRACE_MARKER" }),
    ...traceEventToDisplayEntries({ type: "assistant-reasoning-delta", text: "REASONING_MARKER" }),
  ];
  return {
    filters,
    items: [
      { kind: "user", turnId: "t", text: "hello ".repeat(20), at: new Date(0) },
      { kind: "trace-group", turnId: "t", entries, at: new Date(0) },
      { kind: "assistant-final", turnId: "t", markdown: "# Heading\n\n- item\n\n```py\nprint(1)\n```", at: new Date(0) },
    ],
  };
}

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  start(): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

describe("TUI components", () => {
  it("keeps rendered lines within width", () => {
    for (const width of [18, 40, 100]) {
      assertWidths(new Transcript(state({ showReasoning: true, showAssistantTrace: true, showToolDetails: true })).render(width), width);
      assertWidths(new StatusLine(state({ showReasoning: false, showAssistantTrace: false, showToolDetails: false }), "model".repeat(20)).render(width), width);
    }
  });

  it("collapses and expands tool details via filters", () => {
    const collapsed = new Transcript(state({ showReasoning: false, showAssistantTrace: false, showToolDetails: false })).render(80).join("\n");
    expect(collapsed).toContain("[repl] x = 1");
    expect(collapsed).toContain("[repl final-set] stdout + result + final");
    expect(collapsed).not.toContain("FULL_CODE_MARKER");
    expect(collapsed).not.toContain("STDOUT_FULL_MARKER");
    expect(collapsed).not.toContain("ASSISTANT_TRACE_MARKER");
    expect(collapsed).not.toContain("REASONING_MARKER");

    const expanded = new Transcript(state({ showReasoning: true, showAssistantTrace: true, showToolDetails: true })).render(120).join("\n");
    expect(expanded).toContain("FULL_CODE_MARKER");
    expect(expanded).toContain("stdout: STDOUT_FULL_MARKER");
    expect(expanded).toContain("resultPreview: RESULT_FULL_MARKER");
    expect(expanded).toContain("finalSet: true");
    expect(expanded).toContain("ASSISTANT_TRACE_MARKER");
    expect(expanded).toContain("REASONING_MARKER");
  });

  it("renders final markdown to stable visible text", () => {
    const rendered = new Transcript(state({ showReasoning: false, showAssistantTrace: false, showToolDetails: false })).render(80).join("\n");
    expect(rendered).toContain("Heading");
    expect(rendered).toContain("item");
    expect(rendered).toContain("print(1)");
  });

  it("supports composer submit aliases", () => {
    const tui = new TUI(new FakeTerminal());
    const composer = new Composer(tui);
    const submitted: string[] = [];
    composer.onSubmit = (text) => submitted.push(text);
    composer.setText("hello");
    composer.handleInput("\x18");
    expect(submitted).toEqual(["hello"]);
    expect(composer.getText()).toBe("");
  });

  it("trace block filtering can be tested directly", () => {
    const entries = state({ showReasoning: true, showAssistantTrace: true, showToolDetails: true }).items[1];
    expect(entries?.kind).toBe("trace-group");
    if (entries?.kind === "trace-group") {
      const hidden = renderTraceEntries(entries.entries, { showReasoning: false, showAssistantTrace: false, showToolDetails: false }, 80).join("\n");
      expect(hidden).not.toContain("REASONING_MARKER");
      const shown = renderTraceEntries(entries.entries, { showReasoning: true, showAssistantTrace: false, showToolDetails: false }, 80).join("\n");
      expect(shown).toContain("REASONING_MARKER");
    }
  });
});
