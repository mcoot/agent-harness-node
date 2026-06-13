import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RlmContext } from "../src/rlm/context.js";
import type { FinalOutput } from "../src/rlm/final-output.js";
import type { RlmReplSession } from "../src/rlm/repl.js";

const streamTextMock = vi.fn();

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ model }),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: (count: number) => ({ count }),
  };
});

const { runAgentTurn } = await import("../src/agent.js");

class FakeSession implements RlmReplSession {
  executions: string[] = [];
  disposed = false;
  final: FinalOutput | undefined;

  async execute(code: string) {
    this.executions.push(code);
    if (code.includes('FINAL("ok")')) {
      this.final = { kind: "string", value: "ok", text: "ok" };
    }
    return { stdout: "", stderr: "", finalSet: this.final !== undefined };
  }

  async getFinalOutput() {
    return this.final;
  }

  async dispose() {
    this.disposed = true;
  }
}

async function* parts(items: unknown[]) {
  for (const item of items) yield item;
}

describe("RLM agent orchestration", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
  });

  it("uses only the repl tool and returns FINAL output instead of assistant text", async () => {
    const session = new FakeSession();
    streamTextMock.mockImplementation((options) => {
      expect(Object.keys(options.tools)).toEqual(["repl"]);
      void options.tools.repl.execute({ code: 'FINAL("ok")' });
      return {
        fullStream: parts([{ type: "text-delta", text: "ordinary assistant text" }]),
        response: Promise.resolve({ messages: [] }),
      };
    });

    const traces: unknown[] = [];
    const turn = await runAgentTurn([], "secret full input", {
      model: "test-model",
      createReplSession: async (_context: RlmContext) => session,
      onTrace: (event) => traces.push(event),
    });

    expect(turn.text).toBe("ok");
    expect(turn.messages).toEqual([
      { role: "user", content: "secret full input" },
      { role: "assistant", content: "ok" },
    ]);
    expect(traces).toContainEqual({ type: "assistant-text-delta", text: "ordinary assistant text" });
    expect(session.disposed).toBe(true);
  });

  it("sends a bounded preview instead of long raw user input", async () => {
    const session = new FakeSession();
    const long = "s".repeat(700);
    streamTextMock.mockImplementation((options) => {
      const content = options.messages[0].content;
      expect(content).toContain("context is a dict with keys");
      expect(content).toContain("…[truncated, total 700 chars]");
      expect(content).not.toContain(long);
      session.final = { kind: "string", value: "done", text: "done" };
      return { fullStream: parts([]), response: Promise.resolve({ messages: [] }) };
    });

    await expect(runAgentTurn([], long, { model: "test", createReplSession: async () => session })).resolves.toMatchObject({ text: "done" });
  });

  it("retries missing finalization exact total attempts and then throws", async () => {
    const session = new FakeSession();
    streamTextMock.mockReturnValue({ fullStream: parts([{ type: "finish" }]), response: Promise.resolve({ messages: [] }) });

    await expect(
      runAgentTurn([], "hello", { model: "test", createReplSession: async () => session, maxFinalizationAttempts: 2 }),
    ).rejects.toThrow("did not call FINAL");

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0].messages[0].content).toContain("You did not call FINAL");
    expect(session.disposed).toBe(true);
  });
});
