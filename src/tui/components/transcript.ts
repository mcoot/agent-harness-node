import { Markdown, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { TuiState, TranscriptItem } from "../state.js";
import { tuiStyle } from "../style.js";
import { createMarkdownTheme } from "./markdown-theme.js";
import { renderTraceEntries } from "./trace-block.js";

function safeWidth(width: number): number {
  return Math.max(1, Math.floor(width));
}

function wrap(text: string, width: number): string[] {
  const w = safeWidth(width);
  const lines = wrapTextWithAnsi(text, w);
  return (lines.length === 0 ? [""] : lines).map((line) => truncateToWidth(line, w));
}

function renderItem(item: TranscriptItem, state: TuiState, width: number): string[] {
  switch (item.kind) {
    case "user":
      return [truncateToWidth(tuiStyle.userLabel("You:"), safeWidth(width)), ...item.text.split("\n").flatMap((line) => wrap(`  ${line}`, width))];
    case "trace-group":
      return renderTraceEntries(item.entries, state.filters, width).map((line) => truncateToWidth(`  ${line}`, safeWidth(width)));
    case "assistant-final": {
      const markdown = new Markdown(item.markdown, 0, 0, createMarkdownTheme(), { color: tuiStyle.finalText });
      return [truncateToWidth(tuiStyle.finalLabel("Assistant:"), safeWidth(width)), ...markdown.render(safeWidth(width)).map((line) => truncateToWidth(`  ${line}`, safeWidth(width)))];
    }
    case "error":
      return wrap(tuiStyle.error(`Agent error: ${item.message}`), width);
  }
}

export class Transcript implements Component {
  constructor(private state: TuiState) {}

  setState(state: TuiState): void {
    this.state = state;
  }

  render(width: number): string[] {
    const w = safeWidth(width);
    if (this.state.items.length === 0) return [truncateToWidth(tuiStyle.muted("RLM harness ready."), w)];
    const lines: string[] = [];
    for (const item of this.state.items) {
      if (lines.length > 0) lines.push("");
      lines.push(...renderItem(item, this.state, w));
    }
    return lines.map((line) => truncateToWidth(line, w));
  }

  invalidate(): void {}
}
