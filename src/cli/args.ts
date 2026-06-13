export type CliMode = "auto" | "tui" | "no-tui";
export type ParsedArgs = { mode: CliMode; model: string };

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let forceTui = false;
  let forceNoTui = false;
  let model = env.AI_MODEL ?? "claude-haiku-4-5";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tui") {
      forceTui = true;
    } else if (arg === "--no-tui") {
      forceNoTui = true;
    } else if (arg === "--model") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--model requires a model name, for example --model claude-haiku-4-5");
      }
      model = value;
      i += 1;
    } else if (arg?.startsWith("--model=")) {
      const value = arg.slice("--model=".length);
      if (value.length === 0) throw new Error("--model requires a non-empty model name");
      model = value;
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown flag ${arg}. Supported flags: --tui, --no-tui, --model <name>.`);
    } else if (arg !== undefined) {
      throw new Error(`Unexpected argument ${arg}. Use --model <name> to select a model.`);
    }
  }

  if (forceTui && forceNoTui) {
    throw new Error("Cannot pass both --tui and --no-tui. Choose one mode.");
  }

  return { mode: forceTui ? "tui" : forceNoTui ? "no-tui" : "auto", model };
}

export function shouldUseTui(
  mode: CliMode,
  streams: { stdinIsTTY?: boolean; stdoutIsTTY?: boolean },
): boolean {
  if (mode === "tui") return true;
  if (mode === "no-tui") return false;
  return streams.stdinIsTTY === true && streams.stdoutIsTTY === true;
}
