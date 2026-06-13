import { describe, expect, it } from "vitest";
import { createInitialTuiState, tuiReducer } from "../src/tui/state.js";

const at = new Date("2025-01-01T00:00:00Z");

describe("TUI state reducer", () => {
  it("tracks turn lifecycle and preserves hidden trace entries", () => {
    let state = createInitialTuiState();
    expect(state.filters).toEqual({ showReasoning: false, showAssistantTrace: false, showToolDetails: false });

    state = tuiReducer(state, { type: "session-event", event: { type: "turn-started", turnId: "t1", input: "hello", at } });
    expect(state.runningTurnId).toBe("t1");
    expect(state.items.map((item) => item.kind)).toEqual(["user", "trace-group"]);

    state = tuiReducer(state, { type: "session-event", event: { type: "trace", turnId: "t1", event: { type: "assistant-text-delta", text: "hidden" }, at } });
    state = tuiReducer(state, { type: "session-event", event: { type: "trace", turnId: "t1", event: { type: "assistant-reasoning-delta", text: "secret" }, at } });
    const trace = state.items.find((item) => item.kind === "trace-group");
    expect(trace?.kind === "trace-group" ? trace.entries.map((entry) => entry.kind) : []).toEqual(["assistant-text", "reasoning"]);

    state = tuiReducer(state, { type: "session-event", event: { type: "turn-final", turnId: "t1", text: "answer", at } });
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-finished", turnId: "t1", at } });
    expect(state.runningTurnId).toBeUndefined();
    expect(state.items.map((item) => item.kind)).toEqual(["user", "trace-group", "assistant-final"]);
  });

  it("appends errors after traces and clears matching running turn", () => {
    let state = createInitialTuiState();
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-started", turnId: "t1", input: "hello", at } });
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-error", turnId: "t1", message: "boom", at } });
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-finished", turnId: "other", at } });
    expect(state.runningTurnId).toBe("t1");
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-finished", turnId: "t1", at } });
    expect(state.runningTurnId).toBeUndefined();
    expect(state.items.at(-1)).toMatchObject({ kind: "error", message: "boom" });
  });

  it("toggles filters without mutating trace history and sets status", () => {
    let state = createInitialTuiState();
    state = tuiReducer(state, { type: "session-event", event: { type: "turn-started", turnId: "t1", input: "hello", at } });
    const items = state.items;
    state = tuiReducer(state, { type: "toggle-tool-details" });
    state = tuiReducer(state, { type: "toggle-assistant-trace" });
    state = tuiReducer(state, { type: "toggle-reasoning" });
    expect(state.filters).toEqual({ showReasoning: true, showAssistantTrace: true, showToolDetails: true });
    expect(state.items).toBe(items);
    state = tuiReducer(state, { type: "set-status", message: "busy" });
    expect(state.statusMessage).toBe("busy");
  });
});
