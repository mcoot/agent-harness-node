import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../src/session/agent-runner.js";
import { runNoTui } from "../src/cli/no-tui.js";

function captureWritable(): Writable & { isTTY?: boolean; output: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  }) as Writable & { isTTY?: boolean; output: () => string };
  stream.output = () => text;
  return stream;
}

function fakeRunner(finalText = "ok", fail = false): AgentRunner & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    inputs,
    async runTurn(history, input, callbacks) {
      inputs.push(input);
      await callbacks.onTrace({ type: "step-start", stepNumber: history.length + 1 });
      if (fail) throw new Error("boom");
      return { text: finalText, messages: [...history, { role: "user", content: input }, { role: "assistant", content: finalText }] };
    },
  };
}

describe("no-TUI runner", () => {
  it("runs an interactive turn and exits on command", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const output = captureWritable();
    output.isTTY = true;
    const runner = fakeRunner("done");

    const promise = runNoTui({ runner, model: "test-model", input, output });
    input.write("hello\n/exit\n");
    await promise;

    expect(output.output()).toContain("Minimal agent harness");
    expect(output.output()).toContain("Model: test-model");
    expect(output.output()).toContain("> ");
    expect(output.output()).toContain("[step start]");
    expect(output.output()).toContain("done");
    expect(runner.inputs).toEqual(["hello"]);
  });

  it("renders agent errors and continues until exit", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const output = captureWritable();
    output.isTTY = true;
    const runner = fakeRunner("unused", true);

    const promise = runNoTui({ runner, model: "m", input, output });
    input.write("hello\n/exit\n");
    await promise;

    expect(output.output()).toContain("Agent error: boom");
    expect(runner.inputs).toEqual(["hello"]);
  });

  it("runs non-TTY stdin exactly once and strips one trailing line ending", async () => {
    const input = Readable.from(["hello\n"]) as Readable & { isTTY?: boolean };
    input.isTTY = false;
    const output = captureWritable();
    const runner = fakeRunner("answer");

    await runNoTui({ runner, model: "m", input, output });

    expect(runner.inputs).toEqual(["hello"]);
    expect(output.output()).toContain("answer");
  });

  it("ignores empty piped stdin", async () => {
    const input = Readable.from(["\n"]) as Readable & { isTTY?: boolean };
    input.isTTY = false;
    const output = captureWritable();
    const runner = fakeRunner("answer");

    await runNoTui({ runner, model: "m", input, output });

    expect(runner.inputs).toEqual([]);
    expect(output.output()).toBe("");
  });
});
