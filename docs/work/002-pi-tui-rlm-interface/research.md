---
id: 002-pi-tui-rlm-interface
name: Pi TUI interface for RLM harness
description: Research for building a lightweight Pi-style terminal UI around the RLM agent harness while preserving clean harness/UI separation and testability.
status: complete
---

## Research question

How should the Node/TypeScript RLM harness use `@earendil-works/pi-tui` to provide a simple, lightweight Pi-like TUI while keeping agent/harness logic independent from UI concerns?

The target UI should:

- Accept comfortable multiline user input.
- Render an inline chronological transcript.
- Distinguish user messages, final answers, assistant trace text/thinking, and tool/REPL activity.
- Nicely display Python REPL usage, concisely by default with expandable/filterable details.
- Preserve a minimal/simple non-TUI mode for non-interactive use and explicit `--no-tui` use.
- Be testable behaviourally with DI-style harness tests and automated PTY tests for critical UX flows.

## Findings summary

- `@earendil-works/pi-tui` is the right fit for this harness. It supplies the terminal mechanics that are hard to implement correctly: differential rendering, raw keyboard handling, multiline editor behaviour, IME cursor support, ANSI width helpers, Markdown rendering, resize handling, and a fakeable `Terminal` boundary.
- The package currently requires Node `>=22.19.0`; this project currently declares `>=22`, so adopting `pi-tui` should tighten `package.json` engines.
- The existing source harness is already a good starting point for UI separation: `runAgentTurn` owns agent orchestration and accepts DI hooks (`onTrace`, `createReplSession`). The current `readline` loop in `src/main.ts` should become a thin entrypoint that chooses TUI vs minimal no-TUI mode.
- The source tree currently has no `src/tui/*`; stale compiled `dist/tui/*` references `@rezi-ui/*` and should be ignored/removed by a clean build rather than used as a design basis.
- Use an inline Pi-like transcript as the core UI model, with filters/toggles to hide or expand trace details. This keeps the normal conversation readable while preserving full inspectability for RLM behaviour.
- Default REPL rendering should be concise: show a REPL block with summary/status by default, and expose full Python code/stdout/stderr/result through an in-memory details toggle/filter.
- Testing should be layered: unit-test harness/session/UI-state logic through injected dependencies and fake terminals; use PTY tests only for critical user journeys and avoid brittle exact ANSI snapshots.

## Detailed findings

### Current codebase shape

Relevant source files:

- `src/main.ts`
  - Current CLI is a simple `readline/promises` loop.
  - Maintains conversation history and calls `runAgentTurn`.
  - Writes trace events directly using `trace-renderer.ts`.
- `src/agent.ts`
  - Exposes `runAgentTurn(history, userInput, options)`.
  - Owns Anthropic/AI SDK orchestration via `streamText`.
  - Emits normalized trace events through `options.onTrace`.
  - Accepts `createReplSession` for DI and tests.
  - Returns final output captured through `FINAL(...)` / `FINAL_VAR(...)`, not ordinary assistant text.
- `src/trace.ts`
  - Defines `AgentTraceEvent`, a harness-owned stream event contract decoupled from raw AI SDK event shapes.
- `src/trace-renderer.ts`
  - Simple ANSI renderer for no-TUI/readline output.
- `src/rlm/repl.ts`, `src/tools/repl.ts`
  - Provide a Pyodide-backed REPL session and AI SDK tool wrapper.
- `tests/*.test.ts`
  - Existing tests already mock model streaming and REPL dependencies for behavioural checks.

Implications:

- Keep `runAgentTurn` UI-agnostic. It should know nothing about `pi-tui`, component classes, terminal dimensions, filters, or keybindings.
- The TUI should consume a session-facing/event-facing API, not call AI SDK APIs directly.
- The no-TUI path can continue to use `formatTraceEvent`/`formatFinalAnswer` or a small plain renderer.
- `dist/tui/*` references an unrelated/extraneous `@rezi-ui` implementation; since `src/tui` does not exist, implementation should create fresh source modules and rely on TypeScript build output.

### `pi-tui` capabilities relevant to this harness

Inspected local docs/types:

- Pi TUI docs: `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Package/types:
  - `@earendil-works/pi-tui/package.json`
  - `dist/index.d.ts`
  - `dist/tui.d.ts`
  - `dist/components/editor.d.ts`
  - `dist/components/editor.js`
  - `dist/terminal.d.ts`

Key primitives:

- `TUI`
  - Main container/differential renderer.
  - Owns focus, overlays, input listeners, resize handling, and render scheduling.
- `ProcessTerminal`
  - Real process stdin/stdout terminal implementation.
- `Terminal` interface
  - Small fakeable boundary: `start`, `stop`, `write`, dimensions, cursor/clear/progress methods.
  - Useful for deterministic component/render tests without a real PTY.
- `Editor`
  - Multiline input component with history, cursor movement, undo-ish editing, paste handling, autocomplete hooks, and submit/newline keybindings.
  - Implements `Focusable` and cursor marker support for IME positioning.
- `Markdown`
  - Renders Markdown with code block support and theme callbacks.
  - Useful for final answers and possibly user messages.
- `Text`, `Box`, `Container`, `Spacer`, `Loader`, `SelectList`, `SettingsList`
  - Enough for a lightweight custom shell without introducing another UI abstraction.
- Helpers:
  - `matchesKey`, `Key` for key handling.
  - `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi` for line-width correctness.

Important component contract:

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

Every rendered line must fit the provided width. Components with cached output must implement `invalidate()` correctly.

### Node/dependency implications

`@earendil-works/pi-tui@0.79.3` declares:

```json
{
  "engines": { "node": ">=22.19.0" }
}
```

The harness currently declares:

```json
{
  "engines": { "node": ">=22" }
}
```

Adoption should:

- Add `@earendil-works/pi-tui` as a runtime dependency.
- Tighten `engines.node` to `>=22.19.0`.
- Add an explicit PTY test dependency such as `node-pty` as a dev dependency if PTY tests are implemented. `node_modules` currently contains extraneous `node-pty`, but `package.json` does not declare it.

### Recommended architecture

Use a three-layer split.

#### 1. Agent/harness layer: UI-independent

Keep `src/agent.ts`, `src/rlm/*`, `src/tools/*`, and `src/trace.ts` independent from `pi-tui`.

Recommended stable contract:

```ts
export interface AgentRunner {
  runTurn(
    history: readonly AgentConversationEntry[],
    input: string,
    callbacks: { onTrace(event: AgentTraceEvent): void | Promise<void> },
  ): Promise<AgentTurn>;
}
```

This can be a small wrapper over existing `runAgentTurn`, or `runAgentTurn` itself can remain the injected function. The important boundary is that UI code receives session events and trace events, not model/tool internals.

#### 2. Session/controller layer: coordinates UI events and agent turns

Add a UI-agnostic controller/session bubble, for example:

```text
src/session/
  rlm-session.ts
```

Responsibilities:

- Store conversation history.
- Accept user submissions.
- Prevent concurrent turns or define cancellation behaviour.
- Emit session events:
  - `turn-started`
  - `trace`
  - `turn-final`
  - `turn-error`
  - `turn-finished`
- Depend on an injected `AgentRunner` and clock/id source.

This should be a primary unit bubble for behavioural tests. The TUI and no-TUI entrypoints should both use it.

Possible event contract:

```ts
export type HarnessSessionEvent =
  | { type: "turn-started"; turnId: string; input: string; at: Date }
  | { type: "trace"; turnId: string; event: AgentTraceEvent; at: Date }
  | { type: "turn-final"; turnId: string; text: string; at: Date }
  | { type: "turn-error"; turnId: string; message: string; at: Date }
  | { type: "turn-finished"; turnId: string; at: Date };
```

#### 3. UI layer: pi-tui components and no-TUI renderer

Add source modules such as:

```text
src/tui/
  pi-tui-app.ts          # wires TUI, terminal, session, root component
  state.ts               # TUI view state + reducer
  trace-log.ts           # AgentTraceEvent -> display entries/block models
  components/
    rlm-app.ts           # root component
    transcript.ts        # inline transcript component
    composer.ts          # Editor wrapper/status/help
    status-line.ts       # model/status/filter indicators
    trace-block.ts       # collapsed/expanded trace and REPL blocks
    markdown-theme.ts    # local theme callbacks for Markdown
src/cli/
  no-tui.ts              # minimal non-TTY/plain mode
  args.ts                # --tui/--no-tui/auto parse if needed
```

The TUI layer should depend on session events and `pi-tui`, not on AI SDK or Pyodide internals.

### UI model and rendering

User decision: use a **hybrid inline transcript with filters**.

Recommended state model:

```ts
type TranscriptItem =
  | { kind: "user"; turnId: string; text: string; at: Date }
  | { kind: "assistant-final"; turnId: string; markdown: string; at: Date }
  | { kind: "trace"; turnId: string; entries: TraceDisplayEntry[]; collapsed: boolean; at: Date }
  | { kind: "error"; turnId: string; message: string; at: Date };

type TraceFilters = {
  showReasoning: boolean;
  showAssistantTrace: boolean;
  showToolDetails: boolean;
  expandRepl: boolean;
};
```

Default display:

- User prompt: clear user-labeled block.
- Final answer: rendered normally, ideally with `Markdown`.
- Assistant ordinary text deltas: hidden by default or shown as dim trace only when `showAssistantTrace` is enabled, because ordinary assistant text is trace-only in the RLM design.
- Reasoning deltas: hidden by default; available behind a filter if the upstream model emits them and policy allows display.
- REPL/tool calls: visible concisely by default.
- REPL details: expanded only when `expandRepl` / details filter is enabled.
- Errors: prominent inline callout/text block.

A concise REPL block should include:

- Tool name: `repl`.
- Code summary: first meaningful line or short truncated single-line summary.
- Result status: `ok`, `stderr`, `final set`, or `error`.
- Optional compact output markers: `stdout`, `stderr`, `result`, each truncated.

Expanded REPL details should include:

- Full submitted Python code as received from the trace/tool call, within harness truncation limits.
- Tool result fields from `ReplExecutionResult`:
  - `stdout`
  - `stderr`
  - `resultPreview`
  - `finalSet`

`Markdown` should be used for assistant final answers. For trace/tool code blocks, either `Markdown` or custom `Text` rendering is acceptable; custom rendering may be simpler and more predictable for tests.

### Input and keybindings

User decision: use **Pi default plus submit aliases**.

Recommended behaviour:

- `Enter`: submit.
- `Shift+Enter`: insert newline.
- Backslash-before-enter fallback: if the terminal cannot send reliable Shift+Enter, a trailing `\` before Enter should insert a newline instead of submitting. `Editor` already implements this behaviour around Pi keybindings.
- Add submit aliases where practical:
  - `Ctrl+Enter`
  - `Ctrl+X`
- Keep `/exit` and `/quit` as commands submitted through the composer.
- `Ctrl+C`: quit if idle; if a turn is running, future work can cancel the turn, but first implementation may quit cleanly if cancellation is not implemented.
- Filter toggles can be simple global keys, for example:
  - `Ctrl+R`: toggle reasoning
  - `Ctrl+T`: toggle REPL/tool details
  - `Ctrl+A`: toggle assistant trace
  - `Ctrl+L`: clear/hide trace entries or clear screen, depending final design

Implementation note: `Editor` already uses global `tui.input.submit` and `tui.input.newLine` keybindings. If adding `Ctrl+Enter` to submit globally, use `KeybindingsManager` / `setKeybindings` carefully so tests and user expectations are deterministic. A lighter alternative is wrapping `Editor.handleInput` and translating `Ctrl+X`/`Ctrl+Enter` to submit behaviour in the wrapper/root component.

### Auto TUI vs no-TUI mode

User decision: use **auto mode** with a minimal/simple no-TUI option.

Recommended CLI mode selection:

- Default `auto`:
  - Use `pi-tui` when `process.stdin.isTTY` and `process.stdout.isTTY` are true.
  - Use no-TUI/plain mode otherwise.
- `--tui`: force TUI, failing with a clear message if terminal requirements are not met.
- `--no-tui`: force minimal plain mode.

No-TUI should remain intentionally small:

- Preserve current readline-like behaviour for interactive non-TUI sessions.
- For piped stdin or CI, optionally read one prompt from stdin and run one turn, but this can be future work if not currently needed.
- Render trace via the existing plain ANSI renderer.
- Do not duplicate TUI state/filter features in no-TUI mode.

### Test strategy

User decision: use **layered tests**.

#### Harness/session behavioural tests

Follow the code-philosophy unit bubble approach:

- Unit-test the controller/session bubble through its public contract only.
- Inject fake `AgentRunner`, deterministic clock, and deterministic turn id source.
- Assert session events and history updates for:
  - successful turn
  - trace streaming order
  - agent error
  - concurrent submit rejection/ignore behaviour
  - `/exit` command handling if it lives in the session layer

Do not mock internal subcomponents inside the same bubble.

#### TUI reducer/render-model tests

Keep most UI logic out of terminal rendering by testing pure state transforms:

- `trace-log.ts`: `AgentTraceEvent` -> display entries.
- REPL summarization:
  - concise one-line code summary
  - stdout/stderr/result/finalSet classification
  - truncation and ANSI-safe width constraints
- `state.ts` reducer:
  - append user/final/error items
  - append or aggregate trace blocks
  - toggle filters
  - preserve collapsed/expanded state

#### Component/fake terminal tests

Use `pi-tui`'s `Terminal` interface or direct component `render(width)` tests to verify:

- Every rendered line fits `width` using `visibleWidth`.
- Narrow widths truncate/wrap instead of throwing.
- Final answer Markdown renders to visible text.
- Collapsed vs expanded REPL details appear as expected.
- Root component invalidates and rerenders on state changes.

#### PTY tests

Use PTY tests only for critical end-to-end UX journeys. Add explicit `node-pty` dev dependency when implementing.

Recommended PTY coverage:

1. Startup in TTY:
   - Spawn built CLI with a fake-agent/test mode.
   - Verify header/status/composer appears.
2. Submit path:
   - Type a prompt.
   - Submit with Enter or alias.
   - Verify user text, concise REPL trace, and final answer appear.
3. Multiline input:
   - Insert newline with Shift+Enter if PTY/terminal encoding supports it, or use backslash-enter fallback.
   - Verify submitted prompt contains newline in fake-agent echo/final output.
4. Filter toggle:
   - Toggle REPL/tool details.
   - Verify hidden Python code/details become visible.
5. Exit:
   - Submit `/exit` or send Ctrl+C.
   - Verify process exits cleanly and terminal is restored enough for the test to finish.

Avoid exact ANSI snapshot assertions. Prefer stripping ANSI and asserting stable visible text/ordering. For some tests, `PI_TUI_WRITE_LOG` can capture raw output for debugging, not as the main assertion format.

### Fake agent mode for tests

To make PTY tests deterministic and fast, provide a fake/test runner path that does not call Anthropic or Pyodide.

Options:

- Internal test-only executable/module under `tests/fixtures/` that wires the TUI to a fake `AgentRunner`.
- CLI environment variable such as `RLM_HARNESS_FAKE_AGENT=1`, if acceptable, with implementation isolated and clearly not used by production paths.

The fake runner should emit representative events:

- `tool-call` for `repl` with Python code.
- `tool-result` with stdout/result/finalSet.
- optional assistant trace/reasoning events.
- final text.

Prefer a fixture module over production environment branching if possible; this keeps production entrypoints simpler.

### Width, ANSI, Markdown, and resize edge cases

Implementation should treat line width as a contract:

- Use `visibleWidth` for tests and custom layout calculations.
- Use `truncateToWidth` for labels/status lines.
- Use `wrapTextWithAnsi` for styled trace/details text that wraps across lines.
- Reapply styles per line because `TUI` appends resets at line ends.
- On resize, rely on `TUI` to rerender but ensure components do not cache without width keys.

For final answers:

- Use `Markdown` with a local theme based on ANSI functions.
- Keep Markdown rendering isolated behind a component wrapper so tests can focus on visible text rather than exact styling.

For REPL code:

- A custom code/details component may be simpler than Markdown because Python tool input is plain code, not model-authored Markdown.
- If using Markdown fenced code blocks, ensure syntax highlighting/theme functions do not make tests brittle.

## Key insights and clarifications

Clarifications from interview:

1. Use an **inline transcript** and offer filters to expand/hide trace details.
2. Composer keybindings should be **hybrid Pi default**:
   - `Enter` submits.
   - `Shift+Enter` inserts newline.
   - `Ctrl+Enter`/`Ctrl+X` submit aliases are desired.
3. REPL usage should be **concise by default**:
   - collapsed/summary display by default.
   - full Python code and outputs available through detail expansion/filter.
4. Tests should be **layered**:
   - DI-style behavioural tests for harness/session.
   - pure state/render-model tests for UI logic.
   - PTY tests for critical user journeys only.
5. CLI should use **auto TUI mode**:
   - TUI by default for interactive TTY.
   - minimal/simple no-TUI mode for `--no-tui` and non-TTY.

Architectural insight:

- The cleanest boundary is not “TUI calls `runAgentTurn` directly everywhere”; instead, put a small session/controller between UI and agent. This session/controller becomes the behavioural unit bubble and lets both TUI and no-TUI share turn orchestration.

Implementation risk:

- `pi-tui` is a package from the Pi ecosystem and may track Pi release cadence. Keep usage focused on stable primitives (`TUI`, `Editor`, `Markdown`, `Container`, helpers) and wrap harness-specific UI in our own small components.

## Key questions for implementation

These are now sufficiently resolved for planning:

1. **Use `@earendil-works/pi-tui`?** Yes.
2. **Update Node engine?** Yes, to `>=22.19.0`.
3. **Default UI layout?** Inline chronological transcript with filterable/expandable trace details.
4. **REPL rendering?** Concise by default, expandable to full details.
5. **Submit/newline behaviour?** `Enter` submit, `Shift+Enter` newline, backslash-enter fallback, plus `Ctrl+Enter`/`Ctrl+X` submit aliases.
6. **No-TUI mode?** Auto-detect TTY; keep `--no-tui` minimal/simple.
7. **Testing approach?** Behavioural DI tests + pure UI state/render tests + PTY smoke/user-journey tests.
8. **Harness/UI separation?** Keep agent and REPL layers independent of `pi-tui`; introduce a session/controller event boundary used by both TUI and no-TUI.

Remaining implementation choices for a plan:

- Exact file/module names.
- Exact keyboard shortcuts for each trace filter.
- Whether first implementation supports cancellation or only blocks/ignores input while running.
- Whether fake-agent PTY tests use a fixture executable or a production-gated env var.
- Whether expanded trace state is global (`expand all REPL`) or per-block from the first pass.

## References

### Codebase

- `package.json`
  - Current Node engine is `>=22`.
  - Current dependencies: `@ai-sdk/anthropic`, `ai`, `pyodide`.
  - No declared `@earendil-works/pi-tui` or `node-pty` dependency yet.
- `src/main.ts`
  - Current readline CLI loop and plain output path.
- `src/agent.ts`
  - UI-independent agent orchestration and DI points.
- `src/trace.ts`
  - Harness-owned normalized trace event contract.
- `src/trace-renderer.ts`
  - Existing minimal ANSI no-TUI renderer.
- `src/rlm/repl.ts`
  - Pyodide REPL session and final-output capture.
- `src/tools/repl.ts`
  - AI SDK `repl` tool wrapper.
- `tests/agent.test.ts`
  - Existing mocked streaming/DI behavioural tests.
- `tests/context.test.ts`, `tests/repl.test.ts`, `tests/trace.test.ts`
  - Existing coverage for context, REPL, trace normalization/rendering.
- `dist/tui/*`
  - Stale compiled artifacts referencing `@rezi-ui`; not backed by `src/tui` and not recommended as implementation basis.

### Pi / pi-tui docs and types

- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
  - Component contract, built-in components, key handling, width helpers, invalidation guidance.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/package.json`
  - `@earendil-works/pi-tui@0.79.3`, Node engine `>=22.19.0`.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/README.md`
  - Quick start and high-level API.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.d.ts`
  - Public exports.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/tui.d.ts`
  - `TUI`, `Component`, `Focusable`, `Terminal`, overlay/focus APIs.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts`
  - `Editor` API and theme/options.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/components/editor.js`
  - Confirmed default submit/newline behaviour and backslash-enter fallback.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/terminal.d.ts`
  - Fakeable terminal boundary.

### Pi examples consulted

- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/modal-editor.ts`
  - Example of extending/wrapping editor input behaviour.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/border-status-editor.ts`
  - Example of custom editor/status rendering with width helpers.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/status-line.ts`
  - Status-line pattern.
- `/opt/homebrew/Cellar/pi-coding-agent/0.79.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/message-renderer.ts`
  - Custom message rendering and use of `Box`/`Text`.
