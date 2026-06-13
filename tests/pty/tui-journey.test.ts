import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as pty from "node-pty";

const stripAnsi = (text: string) => text
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
  .replace(/\x1b[_P][\s\S]*?(?:\x07|\x1b\\)/g, "")
  .replace(/\r/g, "");

let child: pty.IPty | undefined;
let output = "";

function visible(): string {
  return stripAnsi(output);
}

async function waitForText(text: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (visible().includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}. Captured:\n${visible()}`);
}

async function waitForExit(timeoutMs = 3000): Promise<number | undefined> {
  if (child === undefined) return undefined;
  const proc = child;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for exit. Captured:\n${visible()}`)), timeoutMs);
    proc.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}

function ensureNodePtyHelperExecutable(): void {
  const helper = join("node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (existsSync(helper)) chmodSync(helper, 0o755);
}

function spawnFixture(): void {
  ensureNodePtyHelperExecutable();
  output = "";
  child = pty.spawn(process.execPath, ["tests/fixtures/fake-tui-cli.mjs"], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color", FORCE_COLOR: "0" },
  });
  child.onData((data) => { output += data; });
}

afterEach(() => {
  if (child !== undefined) {
    try { child.kill(); } catch {}
    child = undefined;
  }
});

describe("TUI PTY journey", () => {
  it("covers startup, submit, multiline fallback, tool detail toggle, and exit", async () => {
    spawnFixture();
    await waitForText("RLM Harness");
    await waitForText("Model: fake-model");

    child?.write("hello");
    child?.write("\r");
    await waitForText("You:");
    await waitForText("hello");
    await waitForText("[repl] prompt =");
    await waitForText("fake answer: hello");
    expect(visible().indexOf("hello")).toBeLessThan(visible().indexOf("fake answer: hello"));
    expect(visible()).not.toContain("FULL_PYTHON_DETAIL");

    child?.write("\x14"); // Ctrl+T
    await waitForText("FULL_PYTHON_DETAIL");
    await waitForText("stdout: stdout for hello");
    await waitForText("resultPreview: result for hello");

    child?.write("first\\");
    child?.write("\r");
    child?.write("second");
    child?.write("\r");
    await waitForText("fake answer: first");
    await waitForText("second");

    child?.write("/exit");
    child?.write("\r");
    await expect(waitForExit()).resolves.toBe(0);
  }, 15_000);
});
