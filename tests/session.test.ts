import { describe, expect, it } from "vitest";
import type { AgentConversationEntry, AgentTurn } from "../src/agent.js";
import type { AgentRunner } from "../src/session/agent-runner.js";
import { RlmSession, type HarnessSessionEvent } from "../src/session/rlm-session.js";
import type { AgentTraceEvent } from "../src/trace.js";

function dates() {
  let n = 0;
  return () => new Date(Date.UTC(2025, 0, 1, 0, 0, n++));
}

function runner(fn: AgentRunner["runTurn"]): AgentRunner {
  return { runTurn: fn };
}

describe("RlmSession", () => {
  it("emits deterministic success events, trace order, and updates history", async () => {
    const traces: AgentTraceEvent[] = [
      { type: "step-start", stepNumber: 1 },
      { type: "tool-call", toolName: "repl", input: { code: "FINAL('ok')" }, toolCallId: "a" },
    ];
    const messages: AgentConversationEntry[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ];
    const events: HarnessSessionEvent[] = [];
    const session = new RlmSession({
      runner: runner(async (history, input, callbacks): Promise<AgentTurn> => {
        expect(history).toEqual([]);
        expect(input).toBe("hi");
        for (const trace of traces) await callbacks.onTrace(trace);
        return { text: "ok", messages };
      }),
      now: dates(),
      createTurnId: () => "turn-x",
    });
    session.subscribe((event) => events.push(event));

    await expect(session.submit("hi")).resolves.toEqual({ status: "accepted", turnId: "turn-x" });

    expect(events.map((event) => event.type)).toEqual(["turn-started", "trace", "trace", "turn-final", "turn-finished"]);
    expect(events[0]).toMatchObject({ type: "turn-started", turnId: "turn-x", input: "hi" });
    expect(events[1]).toMatchObject({ type: "trace", event: traces[0] });
    expect(events[2]).toMatchObject({ type: "trace", event: traces[1] });
    expect(events[3]).toMatchObject({ type: "turn-final", text: "ok" });
    expect(session.getHistory()).toEqual(messages);
    expect(session.isBusy()).toBe(false);
  });

  it("emits errors, leaves history unchanged, and clears busy", async () => {
    const events: HarnessSessionEvent[] = [];
    const session = new RlmSession({
      runner: runner(async () => { throw new Error("boom"); }),
      now: dates(),
      createTurnId: () => "err",
    });
    session.subscribe((event) => events.push(event));

    await expect(session.submit("hi")).resolves.toEqual({ status: "accepted", turnId: "err" });

    expect(events.map((event) => event.type)).toEqual(["turn-started", "turn-error", "turn-finished"]);
    expect(events[1]).toMatchObject({ type: "turn-error", message: "boom" });
    expect(session.getHistory()).toEqual([]);
    expect(session.isBusy()).toBe(false);
  });

  it("rejects concurrent submissions without emitting events", async () => {
    let resolveTurn!: (turn: AgentTurn) => void;
    const events: HarnessSessionEvent[] = [];
    const session = new RlmSession({
      runner: runner(() => new Promise<AgentTurn>((resolve) => { resolveTurn = resolve; })),
      now: dates(),
      createTurnId: () => "busy",
    });
    session.subscribe((event) => events.push(event));

    const first = session.submit("first");
    expect(session.isBusy()).toBe(true);
    expect(await session.submit("second")).toEqual({ status: "rejected", reason: "busy" });
    expect(events.map((event) => event.type)).toEqual(["turn-started"]);
    resolveTurn({ text: "done", messages: [{ role: "user", content: "first" }, { role: "assistant", content: "done" }] });
    await first;
  });

  it("handles empty input, commands, and CRLF normalization", async () => {
    const received: string[] = [];
    const session = new RlmSession({
      runner: runner(async (_history, input) => {
        received.push(input);
        return { text: "ok", messages: [] };
      }),
    });
    const events: HarnessSessionEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.submit("  \t\n")).resolves.toEqual({ status: "ignored", reason: "empty" });
    await expect(session.submit(" /QuIt \n")).resolves.toEqual({ status: "exit", command: "/quit" });
    await expect(session.submit(" /EXIT ")).resolves.toEqual({ status: "exit", command: "/exit" });
    await session.submit("a\r\nb\rc");

    expect(received).toEqual(["a\nb\nc"]);
    expect(events[0]).toMatchObject({ type: "turn-started", input: "a\nb\nc" });
  });
});
