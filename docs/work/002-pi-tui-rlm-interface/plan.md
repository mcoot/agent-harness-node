---
id: 002-pi-tui-rlm-interface
name: Pi TUI interface for RLM harness
status: draft
source_research: ./research.md
---

# Implementation plan: Pi TUI interface for RLM harness

## Problem statement

The harness currently exposes the RLM agent through a simple `readline` loop in `src/main.ts`. That loop mixes CLI input, conversation history, trace rendering, and agent orchestration. It cannot provide a comfortable multiline terminal UI, inline transcript, trace filters, or concise/expandable Python REPL display.

Implement a lightweight Pi-style TUI using `@earendil-works/pi-tui` while preserving a strict boundary: agent/REPL logic remains UI-independent, and both TUI and no-TUI modes use the same session/controller contract.

## Approach overview

Use a layered design:

1. **Agent/harness layer** remains independent of UI packages. Existing `runAgentTurn` continues to own model streaming and REPL tool orchestration.
2. **Session/controller layer** owns conversation history, turn lifecycle, command recognition, trace event forwarding, and busy-state behavior. It exposes deterministic events and accepts an injected `AgentRunner`.
3. **UI layer** contains:
   - a Pi TUI app with transcript, status line, filter toggles, and multiline composer;
   - pure TUI state/reducer and trace display-model modules;
   - a minimal no-TUI runner for `--no-tui` and non-TTY execution.
4. **CLI entrypoint** becomes a thin wiring layer that parses mode flags, chooses TUI vs no-TUI, creates the default runner, and delegates.

```mermaid
flowchart LR
  Main[src/main.ts] --> Args[src/cli/args.ts]
  Main --> Runner[Default AgentRunner wrapper]
  Main --> Mode{mode selection}
  Mode -->|TUI| PiApp[src/tui/pi-tui-app.ts]
  Mode -->|plain| NoTui[src/cli/no-tui.ts]
  PiApp --> Session[src/session/rlm-session.ts]
  NoTui --> Session
  Session --> Runner
  Runner --> Agent[src/agent.ts runAgentTurn]
  Agent --> Trace[src/trace.ts]
  Agent --> Repl[src/rlm + src/tools]
  PiApp --> PiTui[@earendil-works/pi-tui]
```

## Overall acceptance criteria

### Programmatic verification

The implementation is complete only when all of these pass from a clean checkout after installing dependencies:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:pty
```

Expected package scripts after implementation:

- `npm run clean`: removes `dist`.
- `npm run build`: performs a clean TypeScript build.
- `npm run typecheck`: runs `tsc -p tsconfig.json --noEmit`.
- `npm test`: runs non-PTY Vitest suites.
- `npm run test:pty`: builds and runs PTY user-journey tests.

Additional automated acceptance checks:

- `package.json` and `package-lock.json` declare `@earendil-works/pi-tui` as a runtime dependency, `node-pty` as a dev dependency, and `engines.node` as `>=22.19.0`.
- `npm run build` removes stale `dist` output before emitting new files, so stale `dist/tui/*` artifacts from the previous `@rezi-ui` attempt do not remain.
- Tests prove `src/agent.ts`, `src/trace.ts`, `src/rlm/*`, and `src/tools/*` do not import `@earendil-works/pi-tui`.
- PTY tests strip ANSI and assert visible behavior/order rather than exact escape-sequence snapshots.

### User verification

A user can manually verify the work with:

```bash
npm run build
node dist/main.js --no-tui
node dist/main.js --tui
```

Manual expectations:

- Default interactive TTY launch opens the TUI.
- `--no-tui` keeps a simple prompt and plain trace output.
- Non-TTY stdin uses no-TUI mode for one prompt and exits.
- TUI composer supports multiline editing; `Enter` submits, `Shift+Enter` inserts a newline when supported, and backslash-before-enter fallback inserts a newline.
- TUI transcript shows user input, concise REPL/tool activity, errors, and final answers inline.
- `Ctrl+T`, `Ctrl+A`, and `Ctrl+R` toggle tool details, assistant trace, and reasoning trace respectively.
- `/exit`, `/quit`, and idle `Ctrl+C` exit cleanly.

## Design, architecture and interfaces

### Dependency and build changes

Update `package.json`:

- `engines.node`: `>=22.19.0`
- dependencies: add `@earendil-works/pi-tui`
- dev dependencies: add `node-pty`
- scripts:
  - `clean`: `rm -rf dist`
  - `build`: `npm run clean && tsc -p tsconfig.json`
  - `test`: `vitest run --passWithNoTests --exclude tests/pty/**`
  - `test:pty`: `npm run build && vitest run --passWithNoTests tests/pty/*.test.ts`

The observable contract is that `npm test` excludes PTY suites and `npm run test:pty` runs them.

### Agent runner boundary

Add `src/session/agent-runner.ts`:

```ts
import type { AgentConversationEntry, AgentTurn } from "../agent.js";
import type { AgentTraceEvent } from "../trace.js";

export interface AgentRunner {
  runTurn(
    history: readonly AgentConversationEntry[],
    input: string,
    callbacks: { onTrace(event: AgentTraceEvent): void | Promise<void> },
  ): Promise<AgentTurn>;
}
```

In the same file, export `createDefaultAgentRunner(options)` that wraps `runAgentTurn` with `model`, `rootDirectory`, `maxSteps`, and related `AgentOptions` values. UI modules depend on `AgentRunner`; only this adapter imports `runAgentTurn`.

### Session/controller contract

Add `src/session/rlm-session.ts`.

Types:

```ts
export type HarnessSessionEvent =
  | { type: "turn-started"; turnId: string; input: string; at: Date }
  | { type: "trace"; turnId: string; event: AgentTraceEvent; at: Date }
  | { type: "turn-final"; turnId: string; text: string; at: Date }
  | { type: "turn-error"; turnId: string; message: string; at: Date }
  | { type: "turn-finished"; turnId: string; at: Date };

export type SubmitResult =
  | { status: "accepted"; turnId: string }
  | { status: "ignored"; reason: "empty" }
  | { status: "rejected"; reason: "busy" }
  | { status: "exit"; command: "/exit" | "/quit" };
```

Behavior:

- Normalize `\r\n` and `\r` to `\n` before command checks and submission.
- Reject all-whitespace input with `{ status: "ignored", reason: "empty" }` and no events.
- Recognize `/exit` and `/quit` by `input.trim().toLowerCase()` and return `{ status: "exit", command }` with no events.
- If a turn is running, return `{ status: "rejected", reason: "busy" }` and emit no events.
- For accepted input:
  1. create deterministic `turnId` from injected `createTurnId`;
  2. emit `turn-started` with the exact normalized input;
  3. call `AgentRunner.runTurn` with current history and an `onTrace` callback that emits `trace` events in callback order;
  4. on success, replace history with `AgentTurn.messages`, emit `turn-final`, then `turn-finished`;
  5. on error, leave history unchanged, emit `turn-error`, then `turn-finished`;
  6. clear busy state in `finally`.

Constructor dependencies:

```ts
{
  runner: AgentRunner;
  now?: () => Date;              // default: () => new Date()
  createTurnId?: () => string;   // default: monotonic turn-1, turn-2, ...
}
```

The session is a unit bubble. Tests may inject fake `AgentRunner`, clock, and ID source, but must not mock internal session helpers.

### CLI mode and no-TUI contract

Add `src/cli/args.ts`:

```ts
export type CliMode = "auto" | "tui" | "no-tui";
export type ParsedArgs = { mode: CliMode; model: string };
export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedArgs;
export function shouldUseTui(mode: CliMode, streams: { stdinIsTTY?: boolean; stdoutIsTTY?: boolean }): boolean;
```

Rules:

- Default mode: `auto`.
- `--tui`: force TUI.
- `--no-tui`: force plain mode.
- Passing both `--tui` and `--no-tui` is an error.
- Unknown flags are errors with an actionable message.
- Model defaults to `env.AI_MODEL ?? "claude-haiku-4-5"`.
- `shouldUseTui("auto", ...)` is true only when both stdin and stdout are TTY.
- `shouldUseTui("tui", ...)` is true, but `main` must fail clearly before starting TUI if either stream is not TTY.

Add `src/cli/no-tui.ts`:

- For TTY stdin: interactive loop equivalent to current behavior, using `RlmSession`.
- For non-TTY stdin: read all stdin as one prompt, strip one trailing final line ending, run one turn if non-empty, print result, and exit.
- Render traces using existing `renderTraceEvent`/`formatFinalAnswer`.
- Render errors as `Agent error: <message>`.
- Do not implement TUI filters or transcript state in no-TUI mode.

### TUI state and trace display model

Add `src/tui/state.ts` as a pure reducer-driven model.

Core state:

```ts
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
```

Default filters:

```ts
{ showReasoning: false, showAssistantTrace: false, showToolDetails: false }
```

Reducer actions:

- session event actions for all `HarnessSessionEvent` variants.
- toggle actions: `toggle-reasoning`, `toggle-assistant-trace`, `toggle-tool-details`.
- `set-status` for rejected/busy or help messages.

Reducer behavior:

- `turn-started`: append user item and empty trace group, set `runningTurnId`.
- `trace`: append normalized display entries to that turn’s trace group.
- `turn-final`: append assistant final item.
- `turn-error`: append error item.
- `turn-finished`: clear `runningTurnId` if it matches.
- Toggles only change filters; they never mutate trace history.

Add `src/tui/trace-log.ts` for deterministic mapping from `AgentTraceEvent` to `TraceDisplayEntry`.

Trace display entries:

```ts
export type TraceDisplayEntry =
  | { kind: "assistant-text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "step"; label: "start" | "finish"; stepNumber?: number }
  | { kind: "tool-input"; toolName: string; text: string; toolCallId?: string }
  | { kind: "tool-call"; toolName: string; summary: string; detail?: string; toolCallId?: string }
  | { kind: "tool-result"; toolName: string; status: "ok" | "stderr" | "final-set" | "error"; summary: string; detail?: string; toolCallId?: string }
  | { kind: "finish" };
```

REPL summary rules:

- If `tool-call` has `toolName === "repl"` and `input.code` is a string:
  - summary is the first non-empty trimmed code line, or `<empty code>`;
  - detail is the full code string.
- If `tool-result` has `toolName === "repl"` and an object shaped like `ReplExecutionResult`:
  - status is `stderr` if `stderr` is non-empty;
  - otherwise `final-set` if `finalSet === true`;
  - otherwise `ok`;
  - summary includes available markers in this order: `stdout`, `stderr`, `result`, `final`;
  - detail includes full labeled `stdout`, `stderr`, `resultPreview`, and `finalSet` fields.
- `tool-error` maps to `tool-result` with status `error`.
- Unknown tool inputs/results are JSON-stringified safely and truncated by renderers.

### TUI components

Add modules under `src/tui/components/`:

- `rlm-app.ts`: root component, owns child components, global key handling, session submission, and invalidation.
- `transcript.ts`: renders transcript items and applies filters.
- `composer.ts`: wraps `Editor` and exposes submit aliases.
- `status-line.ts`: model name, running/idle state, active filter indicators, and help text.
- `trace-block.ts`: renders concise and expanded trace/tool blocks.
- `markdown-theme.ts`: local theme callbacks for final-answer `Markdown` rendering.

TUI app module `src/tui/pi-tui-app.ts`:

```ts
export type PiTuiAppOptions = {
  runner: AgentRunner;
  model: string;
  terminal?: Terminal;
  now?: () => Date;
  createTurnId?: () => string;
};

export async function runPiTuiApp(options: PiTuiAppOptions): Promise<void>;
```

Runtime behavior:

- Create `ProcessTerminal` if no terminal is injected.
- Create `TUI`, `RlmSession`, root component, and focus the composer.
- Subscribe to session events and dispatch them into `TuiState`.
- Call `tui.requestRender()` after every state change.
- Stop terminal/TUI in `finally`.

Rendering contract:

- Every custom component `render(width)` returns only lines whose `visibleWidth(line) <= width`.
- Widths below 20 columns must not throw.
- Final answers use `Markdown` behind a wrapper so component tests assert visible text, not ANSI styling.
- Trace/tool blocks are concise by default; details appear only when `showToolDetails` is true.
- Assistant text deltas appear only when `showAssistantTrace` is true.
- Reasoning deltas appear only when `showReasoning` is true.

Keybindings:

- `Enter`: submit through Pi `Editor` default.
- `Shift+Enter`: newline through Pi `Editor` default when terminal supports it.
- Backslash-before-enter: newline fallback through Pi `Editor` default.
- `Ctrl+Enter`: submit alias implemented with `matchesKey(data, Key.ctrl("enter"))`.
- `Ctrl+X`: submit alias.
- `Ctrl+T`: toggle tool/REPL details.
- `Ctrl+A`: toggle assistant trace.
- `Ctrl+R`: toggle reasoning trace.
- `Ctrl+C`: exit cleanly when idle. While a turn is running, set status to `Turn running; exit after turn finishes`, ignore new submissions, and stop the app immediately after the current turn emits `turn-finished`; do not introduce cancellation in this task.
- `/exit` and `/quit`: session command path exits from both TUI and no-TUI.

### PTY fixture

Add `tests/fixtures/fake-tui-cli.mjs` as a plain JavaScript fixture that imports built `dist` modules after `npm run build`.

Fixture behavior:

- Wires `runPiTuiApp` with a fake `AgentRunner`.
- For any accepted prompt, emits in order:
  1. `tool-call` for `repl` with code containing the submitted prompt;
  2. `tool-result` with `stdout`, `resultPreview`, and `finalSet: true`;
  3. both `assistant-text-delta` and `assistant-reasoning-delta` for filter tests;
  4. final text that echoes the submitted prompt.
- Does not call Anthropic or Pyodide.

## Milestones

### Milestone 1: Dependency, build, and CLI mode foundation

#### Milestone description

Prepare the project to use Pi TUI safely and make the entrypoint mode selection explicit while preserving current no-TUI behavior.

#### Verifiable milestone acceptance criteria

- `package.json` and `package-lock.json` include `@earendil-works/pi-tui`, `node-pty`, and `engines.node >=22.19.0`.
- `npm run build` performs a clean build and no stale `dist/tui/*` files from modules absent in `src` remain.
- `npm run typecheck` passes.
- Unit tests for `parseCliArgs` and `shouldUseTui` cover default auto mode, `--tui`, `--no-tui`, conflicting flags, unknown flags, and non-TTY auto fallback.

#### Task checklist

- [ ] Install/update dependencies and lockfile.
- [ ] Update package scripts for `clean`, clean `build`, `test`, and `test:pty`.
- [ ] Add `src/cli/args.ts`.
- [ ] Add `tests/cli-args.test.ts`.
- [ ] Refactor `src/main.ts` to call argument parsing but keep current no-TUI path until later milestones replace it.

#### Test plan for TDD

1. Red: add `tests/cli-args.test.ts` expecting default mode `auto` and default model from env.
2. Red: add cases for `--tui`, `--no-tui`, conflicts, and unknown flags.
3. Green: implement parser and mode selector.
4. Red: add build hygiene assertion script/test that `npm run build` removes stale `dist`.
5. Green: add clean script and wire build.
6. Refactor: ensure `main.ts` contains only argument/mode wiring logic for this milestone.

#### Implementation notes or gotchas

- Because this repo currently contains stale compiled `dist/tui/*` without matching `src/tui/*`, clean builds are required before judging output.
- Use the planned `vitest run --passWithNoTests --exclude tests/pty/**` script for default non-PTY tests.

### Milestone 2: Session/controller unit bubble

#### Milestone description

Introduce a UI-independent session layer that coordinates turns, history, commands, traces, errors, and busy state through a deterministic event contract.

#### Verifiable milestone acceptance criteria

- `tests/session.test.ts` passes and covers success, trace ordering, agent error, busy rejection, empty input, CRLF normalization, and `/exit`/`/quit` handling.
- Existing `tests/agent.test.ts`, `tests/context.test.ts`, `tests/repl.test.ts`, and `tests/trace.test.ts` still pass without behavior changes.
- A dependency-boundary test proves no file under `src/agent.ts`, `src/trace.ts`, `src/rlm/`, or `src/tools/` imports `@earendil-works/pi-tui`.

#### Task checklist

- [ ] Add `src/session/agent-runner.ts` and default runner adapter.
- [ ] Add `src/session/rlm-session.ts`.
- [ ] Add fake runner helpers for tests.
- [ ] Add `tests/session.test.ts`.
- [ ] Add dependency-boundary test at `tests/dependency-boundaries.test.ts`.

#### Test plan for TDD

- Successful turn:
  - Arrange fake runner that emits two traces and returns messages.
  - Assert events: `turn-started`, two `trace`, `turn-final`, `turn-finished` with deterministic dates and turn id.
  - Assert history updates to returned messages.
- Agent error:
  - Arrange fake runner throwing `Error("boom")`.
  - Assert `turn-error` then `turn-finished`, no history update, busy cleared.
- Busy rejection:
  - Arrange fake runner whose promise is manually controlled.
  - Submit first input, then submit second before resolving.
  - Assert second returns `{ status: "rejected", reason: "busy" }` and emits no events.
- Command/empty handling:
  - Assert whitespace returns ignored.
  - Assert `/exit`, `/quit`, and mixed-case/trailing-space variants return exit without runner calls.
- CRLF normalization:
  - Submit `"a\r\nb\rc"` and assert runner receives `"a\nb\nc"`.

#### Implementation notes or gotchas

- Do not trim accepted prompt content except for command/empty checks; preserve multiline user input after line-ending normalization.
- Emit trace events in the order `AgentRunner` invokes `onTrace`, including asynchronous callbacks.

### Milestone 3: Minimal no-TUI runner on the session contract

#### Milestone description

Move plain CLI behavior into a small no-TUI module that uses `RlmSession`, preserving simple interactive behavior and adding deterministic non-TTY one-shot behavior.

#### Verifiable milestone acceptance criteria

- `tests/no-tui.test.ts` passes for interactive success, interactive `/exit`, agent error, and non-TTY one-shot stdin.
- `node dist/main.js --no-tui` starts the plain prompt in a TTY.
- Piped stdin runs exactly one turn and exits without opening TUI.
- Existing trace rendering remains via `trace-renderer.ts`.

#### Task checklist

- [ ] Add `src/cli/no-tui.ts`.
- [ ] Refactor `src/main.ts` to wire `RlmSession` + no-TUI for `--no-tui` and non-TTY auto mode.
- [ ] Add stream fakes/helpers for no-TUI tests.
- [ ] Add `tests/no-tui.test.ts`.

#### Test plan for TDD

- Interactive success:
  - Fake input stream answers `hello`, then `/exit`.
  - Fake runner emits a trace and final.
  - Assert output contains banner, prompt, trace text, and final text.
- Interactive error:
  - Fake runner throws.
  - Assert output contains `Agent error: boom` and loop continues until `/exit`.
- Non-TTY one-shot:
  - Fake readable stream contains `hello\n` and `isTTY` false.
  - Assert runner receives `hello`, final is printed, and function resolves.
- Empty piped stdin:
  - Assert no runner call and no hang.

#### Implementation notes or gotchas

- `readline/promises` can be awkward to test with fake streams; isolate stream reading and session event rendering into small functions.
- Do not introduce TUI-specific state or filter behavior into no-TUI mode.

### Milestone 4: Pure TUI state and trace display model

#### Milestone description

Build deterministic, terminal-independent state and trace mapping modules that make most TUI behavior unit-testable without a real terminal.

#### Verifiable milestone acceptance criteria

- `tests/tui-state.test.ts` and `tests/tui-trace-log.test.ts` pass.
- Tests cover all `AgentTraceEvent` variants.
- Tests prove default filters hide assistant text/reasoning and collapsed REPL details while preserving data for later expansion.
- REPL summary tests cover code summary, stdout/stderr/result/finalSet classification, unknown output fallback, and truncation boundaries.

#### Task checklist

- [ ] Add `src/tui/trace-log.ts` with guards and mapping helpers.
- [ ] Add `src/tui/state.ts` reducer/actions.
- [ ] Add pure tests for trace mapping.
- [ ] Add pure tests for reducer behavior and filter toggles.

#### Test plan for TDD

- Trace mapping:
  - `assistant-text-delta` -> assistant text entry.
  - `assistant-reasoning-delta` -> reasoning entry.
  - step start/finish/finish events -> labels.
  - `tool-call repl` with code -> first non-empty code line summary and full detail.
  - `tool-result repl` with stdout -> `ok` summary.
  - `tool-result repl` with stderr -> `stderr` status.
  - `tool-result repl` with `finalSet` -> `final-set` status.
  - `tool-error` -> `error` status.
- Reducer:
  - turn start appends user and trace group.
  - trace appends to matching group.
  - final/error append after trace group.
  - turn finish clears running state.
  - toggles change only filter flags.

#### Implementation notes or gotchas

- Keep ANSI and `pi-tui` imports out of these pure modules.
- Treat unknown tool payloads defensively; never throw from trace mapping on malformed model/tool output.

### Milestone 5: TUI components and fake-terminal rendering tests

#### Milestone description

Create renderable Pi TUI components for transcript, trace blocks, status, final Markdown, and composer integration, with automated width and filter behavior checks.

#### Verifiable milestone acceptance criteria

- `tests/tui-components.test.ts` passes.
- Every rendered line in component tests satisfies `visibleWidth(line) <= width` for widths including 18, 40, and 100.
- Collapsed REPL render shows concise summary and hides full code/output details by default.
- Expanded tool-details render shows full Python code and labeled stdout/stderr/result/final fields.
- Assistant text and reasoning entries appear only when their filters are enabled.
- Final-answer Markdown renders to stable visible text.

#### Task checklist

- [ ] Add `src/tui/components/trace-block.ts`.
- [ ] Add `src/tui/components/transcript.ts`.
- [ ] Add `src/tui/components/status-line.ts`.
- [ ] Add `src/tui/components/markdown-theme.ts`.
- [ ] Add `src/tui/components/composer.ts` wrapping `Editor`.
- [ ] Add render helper tests that strip ANSI only for assertions while using `visibleWidth` for width checks.

#### Test plan for TDD

- Width contract:
  - For a state with long user text, long code, and long output, render at widths 18/40/100 and assert no line exceeds width.
- Filter behavior:
  - Default state hides assistant text, reasoning, and REPL details.
  - Enable each filter independently and assert only the expected content appears.
- Markdown:
  - Render final markdown with heading/list/code and assert visible words are present without asserting exact styles.
- Composer alias behavior:
  - Component-level test calls alias handler for `Ctrl+X` and asserts `onSubmit` receives current editor text.

#### Implementation notes or gotchas

- Use `truncateToWidth`, `visibleWidth`, and `wrapTextWithAnsi` from `@earendil-works/pi-tui` for custom layout.
- Avoid exact ANSI snapshots; assert stable visible content and line widths.
- Cache rendered content only with width-aware keys, or skip caching for this first implementation.

### Milestone 6: Pi TUI app wiring and CLI integration

#### Milestone description

Wire the session, reducer, components, terminal, and CLI mode selection into the actual interactive TUI path.

#### Verifiable milestone acceptance criteria

- `npm run typecheck` passes with `@earendil-works/pi-tui` imports isolated to `src/tui/*` and test helpers.
- `node dist/main.js --tui` fails with a clear message if stdin/stdout are not TTY.
- In auto mode, TUI is selected only when both stdin and stdout are TTY; otherwise no-TUI is selected.
- `tests/tui-app.test.ts` with a fake terminal proves session events trigger render invalidation and `tui.requestRender()`.
- `/exit` and `/quit` submitted in the TUI path stop the app cleanly.

#### Task checklist

- [ ] Add `src/tui/pi-tui-app.ts`.
- [ ] Add `src/tui/components/rlm-app.ts` root component.
- [ ] Refactor `src/main.ts` to choose TUI/no-TUI and create the default runner once.
- [ ] Add tests for TUI app wiring with fake terminal where deterministic.
- [ ] Ensure `terminal.stop()`/`tui.stop()` is called in `finally`.

#### Test plan for TDD

- Mode integration:
  - Unit-test a small `runCli`/main wiring helper with injected streams and app functions so no real terminal is needed.
  - Assert forced TUI on non-TTY throws/fails clearly.
  - Assert auto non-TTY calls no-TUI function.
- TUI event wiring:
  - Use fake session/runner and fake terminal.
  - Submit prompt through root component or exposed handler.
  - Assert state contains user, trace, final and terminal captured writes after render.
- Exit path:
  - Submit `/exit` through root component.
  - Assert app resolves and terminal stop is called.

#### Implementation notes or gotchas

- Keep `src/main.ts` minimal; do not test Node process globals directly except through injected helpers.
- Pi `TUI.start()` owns raw mode and resize handling; all cleanup must be in `finally`.

### Milestone 7: PTY user-journey tests

#### Milestone description

Add deterministic PTY smoke tests for critical UX flows using a fake agent fixture, avoiding external model/Pyodide calls and brittle ANSI snapshots.

#### Verifiable milestone acceptance criteria

- `npm run test:pty` passes locally.
- PTY tests cover startup, submit path, multiline fallback, tool-detail toggle, and exit.
- PTY tests strip ANSI and assert visible text/order, not exact escape sequences.
- The fake fixture does not require Anthropic credentials, Pyodide loading, or network access.

#### Task checklist

- [ ] Add `tests/fixtures/fake-tui-cli.mjs`.
- [ ] Add `tests/pty/tui-journey.test.ts`.
- [ ] Add PTY helpers for spawn, wait-for-text, ANSI stripping, timeout cleanup, and exit.
- [ ] Wire `npm run test:pty`.

#### Test plan for TDD

- Startup:
  - Spawn fixture in PTY.
  - Assert visible header/status/composer text appears.
- Submit path:
  - Type `hello` and press Enter.
  - Assert visible order: user `hello`, concise `repl`, final fake answer.
- Multiline fallback:
  - Type `first\\`, press Enter, type `second`, press Enter.
  - Assert final fake answer contains both lines.
- Tool detail toggle:
  - Before toggle, assert full Python detail marker is absent.
  - Press `Ctrl+T`.
  - Assert full Python code and stdout/result detail appear.
- Exit:
  - Submit `/exit`.
  - Assert process exits within timeout and PTY is cleaned up.

#### Implementation notes or gotchas

- Prefer short timeouts with useful captured-output diagnostics on failure.
- Ensure spawned processes are killed in `afterEach` on failures.
- Do not put PTY tests in the default `npm test` path unless they are reliably fast across CI environments.

## Invariants and non-goals

### Invariants to preserve

- `runAgentTurn` remains the only production code path that talks to `streamText`, Anthropic, and the REPL tool.
- `src/agent.ts`, `src/trace.ts`, `src/rlm/*`, and `src/tools/*` do not import `@earendil-works/pi-tui` or depend on terminal concepts.
- Existing RLM finalization semantics do not change: user-visible answers come from `FINAL(...)` or `FINAL_VAR(...)`, not ordinary assistant text.
- Existing trace normalization behavior remains backward compatible unless tests are explicitly updated for a researched AI SDK change.
- No-TUI mode remains small and does not duplicate TUI transcript/filter features.
- TUI tests do not assert exact ANSI snapshots.
- No production fake-agent environment variable is added; PTY fake behavior lives in test fixtures.
- No cancellation/abort semantics are introduced in this task.

### Non-goals for this implementation

- Per-trace-block expansion/collapse state; first pass uses global filters.
- Persistent transcript storage.
- Mouse interactions.
- Rich theming beyond a small local Markdown/status theme.
- Full-screen alternate-buffer UI; the target is an inline chronological transcript.
- Agent turn cancellation while running.

## Stop-and-ask boundaries

Pause implementation and ask before proceeding if any of these occur:

- `@earendil-works/pi-tui` cannot be installed or typechecked under Node `>=22.19.0` in this project.
- `Editor` submit/newline behavior in the installed Pi TUI version materially differs from the researched behavior, especially the backslash-enter fallback.
- `Ctrl+Enter` cannot be detected in a deterministic way and the implementation would require invasive keybinding changes beyond a local wrapper.
- Achieving clean TUI shutdown during a running agent turn requires adding cancellation/abort support to `runAgentTurn`.
- PTY tests are impossible to make reliable without adding a new test runner/transpiler/dependency beyond `node-pty`.
- The planned `AgentRunner`/`RlmSession` boundary cannot satisfy both TUI and no-TUI paths without exposing UI concepts to the harness layer.
- Implementation would require committing credentials, model-specific secrets, or network-dependent tests.
- Existing tests reveal behavior contradicting `research.md`, especially around trace event shapes or finalization semantics.
