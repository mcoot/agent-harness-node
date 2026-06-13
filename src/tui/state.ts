import type { HarnessSessionEvent } from "../session/rlm-session.js";
import { traceEventToDisplayEntries, type TraceDisplayEntry } from "./trace-log.js";

export type TraceFilters = {
  showReasoning: boolean;
  showAssistantTrace: boolean;
  showToolDetails: boolean;
};

export type TranscriptItem =
  | { kind: "user"; turnId: string; text: string; at: Date }
  | { kind: "trace-group"; turnId: string; entries: TraceDisplayEntry[]; at: Date }
  | { kind: "assistant-final"; turnId: string; markdown: string; at: Date }
  | { kind: "error"; turnId: string; message: string; at: Date };

export type TuiState = {
  items: TranscriptItem[];
  filters: TraceFilters;
  runningTurnId?: string;
  statusMessage?: string;
};

export type TuiAction =
  | { type: "session-event"; event: HarnessSessionEvent }
  | { type: "toggle-reasoning" }
  | { type: "toggle-assistant-trace" }
  | { type: "toggle-tool-details" }
  | { type: "set-status"; message?: string };

export const defaultTraceFilters: TraceFilters = {
  showReasoning: false,
  showAssistantTrace: false,
  showToolDetails: false,
};

export function createInitialTuiState(): TuiState {
  return { items: [], filters: { ...defaultTraceFilters } };
}

function updateTraceGroup(items: TranscriptItem[], turnId: string, entries: TraceDisplayEntry[], at: Date): TranscriptItem[] {
  let found = false;
  const next = items.map((item) => {
    if (item.kind !== "trace-group" || item.turnId !== turnId) return item;
    found = true;
    return { ...item, entries: [...item.entries, ...entries] };
  });
  if (!found) next.push({ kind: "trace-group", turnId, entries, at });
  return next;
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "toggle-reasoning":
      return { ...state, filters: { ...state.filters, showReasoning: !state.filters.showReasoning } };
    case "toggle-assistant-trace":
      return { ...state, filters: { ...state.filters, showAssistantTrace: !state.filters.showAssistantTrace } };
    case "toggle-tool-details":
      return { ...state, filters: { ...state.filters, showToolDetails: !state.filters.showToolDetails } };
    case "set-status": {
      if (action.message === undefined) {
        const { statusMessage: _statusMessage, ...rest } = state;
        return rest;
      }
      return { ...state, statusMessage: action.message };
    }
    case "session-event": {
      const event = action.event;
      switch (event.type) {
        case "turn-started":
          return {
            ...(() => {
              const { statusMessage: _statusMessage, ...rest } = state;
              return rest;
            })(),
            items: [
              ...state.items,
              { kind: "user", turnId: event.turnId, text: event.input, at: event.at },
              { kind: "trace-group", turnId: event.turnId, entries: [], at: event.at },
            ],
            runningTurnId: event.turnId,
          };
        case "trace": {
          const entries = traceEventToDisplayEntries(event.event);
          if (entries.length === 0) return state;
          return { ...state, items: updateTraceGroup(state.items, event.turnId, entries, event.at) };
        }
        case "turn-final":
          return { ...state, items: [...state.items, { kind: "assistant-final", turnId: event.turnId, markdown: event.text, at: event.at }] };
        case "turn-error":
          return { ...state, items: [...state.items, { kind: "error", turnId: event.turnId, message: event.message, at: event.at }] };
        case "turn-finished": {
          if (state.runningTurnId !== event.turnId) return state;
          const { runningTurnId: _runningTurnId, ...rest } = state;
          return rest;
        }
      }
    }
  }
}
