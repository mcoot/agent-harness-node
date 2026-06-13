export type AgentTraceEvent =
  | { type: "assistant-text-delta"; text: string }
  | { type: "assistant-reasoning-delta"; text: string }
  | { type: "tool-input-start"; toolName: string; toolCallId?: string }
  | { type: "tool-input-delta"; toolName: string; text: string; toolCallId?: string }
  | { type: "tool-input-end"; toolName: string; toolCallId?: string }
  | { type: "tool-call"; toolName: string; input: unknown; toolCallId?: string }
  | { type: "tool-result"; toolName: string; output: unknown; toolCallId?: string }
  | { type: "tool-error"; toolName: string; error: unknown; toolCallId?: string }
  | { type: "step-start"; stepNumber?: number }
  | { type: "step-finish"; stepNumber?: number }
  | { type: "finish" };

function idFrom(part: Record<string, unknown>): string | undefined {
  const id = part.id ?? part.toolCallId;
  return typeof id === "string" ? id : undefined;
}

function toolNameFrom(part: Record<string, unknown>): string | undefined {
  const name = part.toolName;
  return typeof name === "string" ? name : undefined;
}

function withOptionalToolCallId(
  event: Record<string, unknown>,
  toolCallId: string | undefined,
): AgentTraceEvent {
  return (toolCallId === undefined ? event : { ...event, toolCallId }) as AgentTraceEvent;
}

export function normalizeTextStreamPart(part: unknown): AgentTraceEvent[] {
  if (typeof part !== "object" || part === null) return [];
  const record = part as Record<string, unknown>;

  switch (record.type) {
    case "text-delta":
      return typeof record.text === "string"
        ? [{ type: "assistant-text-delta", text: record.text }]
        : [];
    case "reasoning-delta":
      return typeof record.text === "string"
        ? [{ type: "assistant-reasoning-delta", text: record.text }]
        : [];
    case "tool-input-start": {
      const toolName = toolNameFrom(record);
      return toolName === undefined ? [] : [withOptionalToolCallId({ type: "tool-input-start", toolName }, idFrom(record))];
    }
    case "tool-input-delta": {
      const toolName = toolNameFrom(record);
      const text = typeof record.delta === "string" ? record.delta : typeof record.text === "string" ? record.text : undefined;
      return toolName === undefined || text === undefined ? [] : [withOptionalToolCallId({ type: "tool-input-delta", toolName, text }, idFrom(record))];
    }
    case "tool-input-end": {
      const toolName = toolNameFrom(record) ?? "unknown";
      return [withOptionalToolCallId({ type: "tool-input-end", toolName }, idFrom(record))];
    }
    case "tool-call": {
      const toolName = toolNameFrom(record);
      return toolName === undefined ? [] : [withOptionalToolCallId({ type: "tool-call", toolName, input: record.input }, idFrom(record))];
    }
    case "tool-result": {
      const toolName = toolNameFrom(record);
      return toolName === undefined ? [] : [withOptionalToolCallId({ type: "tool-result", toolName, output: record.output }, idFrom(record))];
    }
    case "tool-error": {
      const toolName = toolNameFrom(record);
      return toolName === undefined ? [] : [withOptionalToolCallId({ type: "tool-error", toolName, error: record.error }, idFrom(record))];
    }
    case "start-step":
      return [{ type: "step-start" }];
    case "finish-step":
      return [{ type: "step-finish" }];
    case "finish":
      return [{ type: "finish" }];
    case "error":
      return [{ type: "tool-error", toolName: "stream", error: record.error }];
    default:
      return [];
  }
}
