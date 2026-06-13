import type { AgentTraceEvent } from "../trace.js";

export type TraceDisplayEntry =
  | { kind: "assistant-text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "step"; label: "start" | "finish"; stepNumber?: number }
  | { kind: "tool-input"; toolName: string; text: string; toolCallId?: string }
  | { kind: "tool-call"; toolName: string; summary: string; detail?: string; toolCallId?: string }
  | { kind: "tool-result"; toolName: string; status: "ok" | "stderr" | "final-set" | "error"; summary: string; detail?: string; toolCallId?: string }
  | { kind: "finish" };

const MAX_FALLBACK_LENGTH = 2_000;

function safeJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, limit = MAX_FALLBACK_LENGTH): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalId(toolCallId: string | undefined): { toolCallId?: string } {
  return toolCallId === undefined ? {} : { toolCallId };
}

function replCode(input: unknown): string | undefined {
  return isRecord(input) && typeof input.code === "string" ? input.code : undefined;
}

function firstCodeLine(code: string): string {
  return code.split("\n").map((line) => line.trim()).find(Boolean) ?? "<empty code>";
}

function looksLikeReplResult(output: unknown): output is { stdout?: unknown; stderr?: unknown; resultPreview?: unknown; finalSet?: unknown } {
  return isRecord(output) && ("stdout" in output || "stderr" in output || "resultPreview" in output || "finalSet" in output);
}

function labeled(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return `${label}: ${String(value)}`;
}

function mapToolCall(event: Extract<AgentTraceEvent, { type: "tool-call" }>): TraceDisplayEntry {
  if (event.toolName === "repl") {
    const code = replCode(event.input);
    if (code !== undefined) {
      return {
        kind: "tool-call",
        toolName: event.toolName,
        summary: firstCodeLine(code),
        detail: code,
        ...optionalId(event.toolCallId),
      };
    }
  }
  const text = truncate(safeJson(event.input));
  return { kind: "tool-call", toolName: event.toolName, summary: text, detail: text, ...optionalId(event.toolCallId) };
}

function mapToolResult(event: Extract<AgentTraceEvent, { type: "tool-result" }>): TraceDisplayEntry {
  if (event.toolName === "repl" && looksLikeReplResult(event.output)) {
    const stdout = typeof event.output.stdout === "string" ? event.output.stdout : String(event.output.stdout ?? "");
    const stderr = typeof event.output.stderr === "string" ? event.output.stderr : String(event.output.stderr ?? "");
    const resultPreview = event.output.resultPreview == null ? undefined : String(event.output.resultPreview);
    const finalSet = event.output.finalSet === true;
    const status = stderr.length > 0 ? "stderr" : finalSet ? "final-set" : "ok";
    const markers = [
      stdout.length > 0 ? "stdout" : undefined,
      stderr.length > 0 ? "stderr" : undefined,
      resultPreview !== undefined && resultPreview.length > 0 ? "result" : undefined,
      finalSet ? "final" : undefined,
    ].filter((item): item is string => item !== undefined);
    const summary = markers.length === 0 ? "ok" : markers.join(" + ");
    const detail = [
      labeled("stdout", stdout),
      labeled("stderr", stderr),
      labeled("resultPreview", resultPreview),
      `finalSet: ${finalSet}`,
    ].filter((item): item is string => item !== undefined).join("\n");
    return { kind: "tool-result", toolName: event.toolName, status, summary, detail, ...optionalId(event.toolCallId) };
  }
  const text = truncate(safeJson(event.output));
  return { kind: "tool-result", toolName: event.toolName, status: "ok", summary: text, detail: text, ...optionalId(event.toolCallId) };
}

function mapToolError(event: Extract<AgentTraceEvent, { type: "tool-error" }>): TraceDisplayEntry {
  const text = truncate(event.error instanceof Error ? event.error.message : safeJson(event.error));
  return { kind: "tool-result", toolName: event.toolName, status: "error", summary: text, detail: text, ...optionalId(event.toolCallId) };
}

export function traceEventToDisplayEntries(event: AgentTraceEvent): TraceDisplayEntry[] {
  switch (event.type) {
    case "assistant-text-delta":
      return event.text.length === 0 ? [] : [{ kind: "assistant-text", text: event.text }];
    case "assistant-reasoning-delta":
      return event.text.length === 0 ? [] : [{ kind: "reasoning", text: event.text }];
    case "step-start":
      return [{ kind: "step", label: "start", ...(event.stepNumber === undefined ? {} : { stepNumber: event.stepNumber }) }];
    case "step-finish":
      return [{ kind: "step", label: "finish", ...(event.stepNumber === undefined ? {} : { stepNumber: event.stepNumber }) }];
    case "tool-input-start":
      return [{ kind: "tool-input", toolName: event.toolName, text: "input start", ...optionalId(event.toolCallId) }];
    case "tool-input-delta":
      return [{ kind: "tool-input", toolName: event.toolName, text: event.text, ...optionalId(event.toolCallId) }];
    case "tool-input-end":
      return [{ kind: "tool-input", toolName: event.toolName, text: "input end", ...optionalId(event.toolCallId) }];
    case "tool-call":
      return [mapToolCall(event)];
    case "tool-result":
      return [mapToolResult(event)];
    case "tool-error":
      return [mapToolError(event)];
    case "finish":
      return [{ kind: "finish" }];
  }
}
