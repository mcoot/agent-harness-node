import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { runCli } from "../src/main.js";
import type { AgentRunner } from "../src/session/agent-runner.js";
import { runPiTuiApp } from "../src/tui/pi-tui-app.js";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b[_P][\s\S]*?(?:\x07|\x1b\\)/g, "");

class FakeTerminal implements Terminal {
  columns = 100;
  rows = 30;
  kittyProtocolActive = false;
  output = "";
  stopped = false;
  private input?: (data: string) => void;
  private resize?: () => void;

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.input = onInput;
    this.resize = onResize;
  }
  stop(): void { this.stopped = true; }
  async drainInput(): Promise<void> {}
  write(data: string): void { this.output += data; }
  send(data: string): void { this.input?.(data); }
  resizeTo(columns: number, rows: number): void { this.columns = columns; this.rows = rows; this.resize?.(); }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  visible(): string { return stripAnsi(this.output); }
}

async function waitFor(predicate: () => boolean, message: () => string): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message());
}

function fakeRunner(): AgentRunner {
  return {
    async runTurn(_history, input, callbacks) {
      await callbacks.onTrace({ type: "tool-call", toolName: "repl", input: { code: `# prompt\n${input}` } });
      await callbacks.onTrace({ type: "tool-result", toolName: "repl", output: { stdout: "ok\n", stderr: "", resultPreview: "42", finalSet: true } });
      return { text: `answer: ${input}`, messages: [{ role: "user", content: input }, { role: "assistant", content: `answer: ${input}` }] };
    },
  };
}

describe("CLI/TUI integration", () => {
  it("fails clearly for forced TUI on non-TTY and selects plain mode for auto pipes", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = false;
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as Writable & { isTTY?: boolean };
    output.isTTY = false;

    await expect(runCli({ argv: ["--tui"], env: {}, streams: { input, output }, createRunner: fakeRunner })).rejects.toThrow("--tui requires");

    let plainCalled = false;
    await runCli({
      argv: [],
      env: {},
      streams: { input, output },
      createRunner: fakeRunner,
      runPlain: async () => { plainCalled = true; },
      runTui: async () => { throw new Error("should not use tui"); },
    });
    expect(plainCalled).toBe(true);
  });

  it("renders session events and exits through /exit", async () => {
    const terminal = new FakeTerminal();
    const app = runPiTuiApp({ runner: fakeRunner(), model: "fake", terminal });

    await waitFor(() => terminal.visible().includes("RLM Harness"), () => terminal.visible());
    for (const ch of "hello") terminal.send(ch);
    terminal.send("\r");
    await waitFor(() => terminal.visible().includes("answer: hello") && terminal.visible().includes("[repl] # prompt"), () => terminal.visible());
    expect(terminal.output.length).toBeGreaterThan(0);

    for (const ch of "/exit") terminal.send(ch);
    terminal.send("\r");
    await app;
    expect(terminal.stopped).toBe(true);
  });
});
