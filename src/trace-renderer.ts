import type { Writable } from "node:stream";
import type { AgentTraceEvent } from "./trace.js";

export const ANSI_GREY = "\u001b[90m";
export const ANSI_RESET = "\u001b[0m";

function inspect(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatTraceEvent(event: AgentTraceEvent): string {
  switch (event.type) {
    case "assistant-text-delta":
    case "assistant-reasoning-delta":
      return `${ANSI_GREY}${event.text}${ANSI_RESET}`;
    case "tool-input-start":
      return `${ANSI_GREY}\n[tool ${event.toolName} input start]\n${ANSI_RESET}`;
    case "tool-input-delta":
      return `${ANSI_GREY}${event.text}${ANSI_RESET}`;
    case "tool-input-end":
      return `${ANSI_GREY}\n[tool ${event.toolName} input end]\n${ANSI_RESET}`;
    case "tool-call":
      return `${ANSI_GREY}\n[tool ${event.toolName} call ${inspect(event.input)}]\n${ANSI_RESET}`;
    case "tool-result":
      return `${ANSI_GREY}\n[tool ${event.toolName} result ${inspect(event.output)}]\n${ANSI_RESET}`;
    case "tool-error":
      return `${ANSI_GREY}\n[tool ${event.toolName} error ${inspect(event.error)}]\n${ANSI_RESET}`;
    case "step-start":
      return `${ANSI_GREY}\n[step start]\n${ANSI_RESET}`;
    case "step-finish":
      return `${ANSI_GREY}\n[step finish]\n${ANSI_RESET}`;
    case "finish":
      return `${ANSI_GREY}\n[finish]\n${ANSI_RESET}`;
  }
}

export function formatFinalAnswer(text: string): string {
  return `\n${text}\n\n`;
}

export function renderTraceEvent(stream: Pick<Writable, "write">, event: AgentTraceEvent): void {
  stream.write(formatTraceEvent(event));
}
