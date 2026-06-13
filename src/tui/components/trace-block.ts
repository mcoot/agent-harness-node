import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { TraceFilters } from "../state.js";
import type { TraceDisplayEntry } from "../trace-log.js";

function safeWidth(width: number): number {
  return Math.max(1, Math.floor(width));
}

function wrapLine(text: string, width: number): string[] {
  const w = safeWidth(width);
  const wrapped = wrapTextWithAnsi(text, w);
  return wrapped.length === 0 ? [""] : wrapped.map((line) => truncateToWidth(line, w));
}

function entryLines(entry: TraceDisplayEntry, filters: TraceFilters, width: number): string[] {
  switch (entry.kind) {
    case "assistant-text":
      return filters.showAssistantTrace ? wrapLine(`assistant: ${entry.text}`, width) : [];
    case "reasoning":
      return filters.showReasoning ? wrapLine(`reasoning: ${entry.text}`, width) : [];
    case "step":
      return wrapLine(`[step ${entry.label}${entry.stepNumber === undefined ? "" : ` ${entry.stepNumber}`}]`, width);
    case "tool-input":
      return filters.showToolDetails ? wrapLine(`[${entry.toolName} input] ${entry.text}`, width) : [];
    case "tool-call": {
      const lines = wrapLine(`[${entry.toolName}] ${entry.summary}`, width);
      if (filters.showToolDetails && entry.detail !== undefined) {
        lines.push(...wrapLine("code:", width));
        for (const line of entry.detail.split("\n")) lines.push(...wrapLine(`  ${line}`, width));
      }
      return lines;
    }
    case "tool-result": {
      const lines = wrapLine(`[${entry.toolName} ${entry.status}] ${entry.summary}`, width);
      if (filters.showToolDetails && entry.detail !== undefined) {
        for (const line of entry.detail.split("\n")) lines.push(...wrapLine(`  ${line}`, width));
      }
      return lines;
    }
    case "finish":
      return wrapLine("[finish]", width);
  }
}

export function renderTraceEntries(entries: readonly TraceDisplayEntry[], filters: TraceFilters, width: number): string[] {
  return entries.flatMap((entry) => entryLines(entry, filters, width));
}

export class TraceBlock implements Component {
  constructor(
    private entries: readonly TraceDisplayEntry[],
    private filters: TraceFilters,
  ) {}

  setEntries(entries: readonly TraceDisplayEntry[]): void {
    this.entries = entries;
  }

  setFilters(filters: TraceFilters): void {
    this.filters = filters;
  }

  render(width: number): string[] {
    return renderTraceEntries(this.entries, this.filters, width);
  }

  invalidate(): void {}
}
