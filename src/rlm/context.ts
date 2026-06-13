import type { AgentConversationEntry } from "../agent.js";

export const PREVIEW_LIMIT = 500;
export const TOOL_OUTPUT_LIMIT = 4000;

export type RlmContext = {
  userInput: string;
  history: readonly AgentConversationEntry[];
};

export function truncateWithMarker(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…[truncated, total ${value.length} chars]`;
}

export function createContextPreview(context: RlmContext): string {
  const userInputPreview = JSON.stringify(truncateWithMarker(context.userInput, PREVIEW_LIMIT));
  const historyJson = JSON.stringify(context.history);
  const historyPreview = JSON.stringify(truncateWithMarker(historyJson, PREVIEW_LIMIT));
  return [
    "A Python REPL has been initialized with context.",
    "context is a dict with keys:",
    `- userInput: ${userInputPreview}`,
    `- history: ${historyPreview}`,
    "Use the repl tool to inspect context. You must call FINAL(...) or FINAL_VAR(...) when done.",
  ].join("\n");
}

export function pythonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function pythonContextSetupSource(context: RlmContext): string {
  const historyItems = context.history
    .map((entry) => `{\"role\": ${pythonStringLiteral(entry.role)}, \"content\": LimitedString(${pythonStringLiteral(entry.content)})}`)
    .join(", ");

  return `
_PREVIEW_LIMIT = ${PREVIEW_LIMIT}

def _truncate(value, limit=_PREVIEW_LIMIT):
    value = str(value)
    if len(value) <= limit:
        return value
    return value[:limit] + "…[truncated, total " + str(len(value)) + " chars]"

class LimitedString:
    def __init__(self, value):
        self._value = str(value)
    def preview(self, limit=_PREVIEW_LIMIT):
        return _truncate(self._value, limit)
    def slice(self, start=None, end=None):
        return _truncate(self._value[slice(start, end)], _PREVIEW_LIMIT)
    def find(self, substring):
        return self._value.find(str(substring))
    def search(self, substring, context=100):
        index = self.find(substring)
        if index < 0:
            return None
        start = max(0, index - int(context))
        end = min(len(self._value), index + len(str(substring)) + int(context))
        return self.slice(start, end)
    def __len__(self):
        return len(self._value)
    def __str__(self):
        return self.preview()
    def __repr__(self):
        return repr(self.preview())
    def __getitem__(self, key):
        if isinstance(key, slice):
            return _truncate(self._value[key], _PREVIEW_LIMIT)
        return self._value[key]

class LimitedHistory:
    def __init__(self, entries):
        self._entries = list(entries)
    def __len__(self):
        return len(self._entries)
    def __getitem__(self, key):
        return self._entries[key]
    def __iter__(self):
        return iter(self._entries)
    def __repr__(self):
        parts = []
        for entry in self._entries[:5]:
            parts.append("{role=" + repr(entry.get("role")) + ", content=" + repr(entry.get("content")) + "}")
        suffix = "" if len(self._entries) <= 5 else ", …[truncated, total " + str(len(self._entries)) + " entries]"
        return "LimitedHistory([" + ", ".join(parts) + suffix + "])"

context = {
    "userInput": LimitedString(${pythonStringLiteral(context.userInput)}),
    "history": LimitedHistory([${historyItems}]),
}
`;
}
