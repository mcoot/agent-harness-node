import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { TraceFilters } from "../state.js";
import { highlightCode, highlightInlineCode } from "../syntax-highlight.js";
import { tuiStyle, type StyleFn } from "../style.js";
import type { TraceDisplayEntry } from "../trace-log.js";

function safeWidth(width: number): number {
  return Math.max(1, Math.floor(width));
}

function wrapLine(text: string, width: number): string[] {
  const w = safeWidth(width);
  const wrapped = wrapTextWithAnsi(text, w);
  return wrapped.length === 0 ? [""] : wrapped.map((line) => truncateToWidth(line, w));
}

function styledWrapLine(text: string, width: number, style: StyleFn): string[] {
  return wrapLine(style(text), width);
}

function detailLines(detail: string, width: number, options?: { language?: string; indent?: string; style?: StyleFn }): string[] {
  const indent = options?.indent ?? "  ";
  const highlighted = options?.language === undefined ? detail.split("\n") : highlightCode(detail, options.language);
  return highlighted.flatMap((line) => wrapLine(`${indent}${options?.style === undefined ? line : options.style(line)}`, width));
}

function toolResultStyle(status: Extract<TraceDisplayEntry, { kind: "tool-result" }>["status"]): StyleFn {
  switch (status) {
    case "error":
    case "stderr":
      return tuiStyle.error;
    case "final-set":
      return tuiStyle.toolSuccess;
    case "ok":
      return tuiStyle.toolResult;
  }
}

function toolCallSummary(entry: Extract<TraceDisplayEntry, { kind: "tool-call" }>): string {
  if (entry.toolName !== "repl") return entry.summary;
  return highlightInlineCode(entry.summary, "python");
}

function entryLines(entry: TraceDisplayEntry, filters: TraceFilters, width: number): string[] {
  switch (entry.kind) {
    case "assistant-text":
      return filters.showAssistantTrace ? styledWrapLine(`assistant trace: ${entry.text}`, width, tuiStyle.assistantTrace) : [];
    case "reasoning":
      return filters.showReasoning ? styledWrapLine(`thinking: ${entry.text}`, width, tuiStyle.reasoning) : [];
    case "step":
      return styledWrapLine(`[step ${entry.label}${entry.stepNumber === undefined ? "" : ` ${entry.stepNumber}`}]`, width, tuiStyle.muted);
    case "tool-input":
      return filters.showToolDetails ? styledWrapLine(`[${entry.toolName} input] ${entry.text}`, width, tuiStyle.toolInput) : [];
    case "tool-call": {
      const lines = wrapLine(`${tuiStyle.toolHeader(`[${entry.toolName}]`)} ${toolCallSummary(entry)}`, width);
      if (filters.showToolDetails && entry.detail !== undefined) {
        if (entry.toolName === "repl") {
          lines.push(...styledWrapLine("python:", width, tuiStyle.muted));
          lines.push(...detailLines(entry.detail, width, { language: "python" }));
        } else {
          lines.push(...styledWrapLine("input:", width, tuiStyle.muted));
          lines.push(...detailLines(entry.detail, width, { style: tuiStyle.toolInput }));
        }
      }
      return lines;
    }
    case "tool-result": {
      const style = toolResultStyle(entry.status);
      const lines = styledWrapLine(`[${entry.toolName} ${entry.status}] ${entry.summary}`, width, style);
      if (filters.showToolDetails && entry.detail !== undefined) {
        lines.push(...detailLines(entry.detail, width, { style: entry.status === "error" || entry.status === "stderr" ? tuiStyle.error : tuiStyle.muted }));
      }
      return lines;
    }
    case "finish":
      return styledWrapLine("[finish]", width, tuiStyle.muted);
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
