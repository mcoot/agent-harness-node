import { describe, expect, it } from "vitest";
import { parseCliArgs, shouldUseTui } from "../src/cli/args.js";

const env = { AI_MODEL: "env-model" } as NodeJS.ProcessEnv;

describe("CLI argument parsing", () => {
  it("defaults to auto mode and AI_MODEL", () => {
    expect(parseCliArgs([], env)).toEqual({ mode: "auto", model: "env-model" });
    expect(parseCliArgs([], {})).toEqual({ mode: "auto", model: "claude-haiku-4-5" });
  });

  it("parses mode and model flags", () => {
    expect(parseCliArgs(["--tui"], env)).toEqual({ mode: "tui", model: "env-model" });
    expect(parseCliArgs(["--no-tui", "--model", "m"], env)).toEqual({ mode: "no-tui", model: "m" });
    expect(parseCliArgs(["--model=m2"], env)).toEqual({ mode: "auto", model: "m2" });
  });

  it("rejects conflicting and unknown flags", () => {
    expect(() => parseCliArgs(["--tui", "--no-tui"], env)).toThrow("both --tui and --no-tui");
    expect(() => parseCliArgs(["--wat"], env)).toThrow("Unknown flag --wat");
    expect(() => parseCliArgs(["positional"], env)).toThrow("Unexpected argument positional");
  });
});

describe("TUI mode selection", () => {
  it("uses TUI only for auto with both TTY streams", () => {
    expect(shouldUseTui("auto", { stdinIsTTY: true, stdoutIsTTY: true })).toBe(true);
    expect(shouldUseTui("auto", { stdinIsTTY: false, stdoutIsTTY: true })).toBe(false);
    expect(shouldUseTui("auto", { stdinIsTTY: true, stdoutIsTTY: false })).toBe(false);
  });

  it("honors forced modes", () => {
    expect(shouldUseTui("tui", { stdinIsTTY: false, stdoutIsTTY: false })).toBe(true);
    expect(shouldUseTui("no-tui", { stdinIsTTY: true, stdoutIsTTY: true })).toBe(false);
  });
});
