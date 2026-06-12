# Implementation plan: RLM setup REPL

## Problem statement

The current harness is a minimal `generateText`-based CLI agent that prints only after a turn completes and exposes a direct `readFile` tool. We need to evolve it toward an RLM-style interaction model while keeping the implementation small:

1. First, refactor the agent/CLI boundary so assistant deltas, reasoning deltas, and tool activity stream live to the terminal as grey trace output.
2. Then, replace direct user-context access and active file tools with a single Pyodide-backed Python `repl` tool.
3. Initialize each agent turn with a Python `context` value containing the full user input and prior conversation history.
4. Require the user-visible answer to come from Python `FINAL(...)` or `FINAL_VAR(...)`; ordinary assistant text remains trace-only.

The implementation should be testable with Vitest and should preserve a small public API for the CLI.

## Approach overview

Implement in two risk-reducing milestones:

- **Milestone 1: live streaming refactor.** Keep current behavior and `readFile`, but switch from `generateText` to `streamText`. Add a normalized trace event callback and CLI renderer.
- **Milestone 2: RLM REPL mode.** Replace the active tool set with one `repl` tool, create a fresh logical Pyodide session per agent turn, expose `context`, add finalization functions, and make final output derive only from the captured final value.

The Pyodide runtime may be cached process-wide for startup performance, but each agent turn must receive a fresh logical Python namespace/session so Python globals do not leak across turns.

## Overall acceptance criteria

Programmatic verification:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- Streaming unit tests verify normalized trace events for text, reasoning, tool calls, results, and errors, using the installed AI SDK `fullStream` part shapes where possible.
- RLM unit tests verify context preview truncation, `LimitedString` / `LimitedHistory` behavior, Pyodide console-backed REPL execution, stdout/stderr/result truncation, deterministic final formatting, and `FINAL` / `FINAL_VAR` capture.
- Agent orchestration tests, using mocked model streams/tools where practical, verify:
  - During Milestone 1 only, the transitional direct-chat path still returns assistant text and updated history.
  - By the end of Milestone 2, final tests target only the RLM path and its `repl` tool.
  - Milestone 2 does not use ordinary assistant text as final user output.
  - Missing finalization triggers a bounded continuation/reminder attempt with the same REPL session and exact attempt-count semantics.

Manual verification:

- Running `npm run dev` starts the CLI.
- During a turn, assistant/tool activity appears live in grey before completion.
- After Milestone 1, the final assistant answer is printed normally after the grey trace.
- After Milestone 2, the model can inspect `context` via Python code and must call `FINAL(...)` or `FINAL_VAR(...)`; that captured value is printed normally.
- After Milestone 2, direct `readFile` calls are not available to the model as an active tool.

## Design, architecture, and interfaces

### Target module layout

```text
src/
  agent.ts                 # runAgentTurn orchestration
  trace.ts                 # AgentTraceEvent types + AI SDK stream normalization helpers
  trace-renderer.ts        # terminal rendering helpers used by main.ts
  main.ts                  # readline CLI loop
  rlm/
    context.ts             # RlmContext, preview generation, conversion helpers
    repl.ts                # RlmReplSession and Pyodide runtime/session implementation
    final-output.ts        # final value formatting helpers if useful
  tools/
    read-file.ts           # existing tool, still present but inactive after Milestone 2
    repl.ts                # AI SDK repl tool factory wrapping RlmReplSession
```

### Trace event contract

Add a small harness-owned event union so `main.ts` is not coupled to AI SDK internals:

```ts
export type AgentTraceEvent =
  | { type: "assistant-text-delta"; text: string }
  | { type: "assistant-reasoning-delta"; text: string }
  | { type: "tool-input-start"; toolName: string; toolCallId?: string }
  | { type: "tool-input-delta"; toolName: string; text: string; toolCallId?: string }
  | { type: "tool-input-end"; toolName: string; toolCallId?: string }
  | { type: "tool-call"; toolName: string; input: unknown; toolCallId?: string }
  | { type: "tool-result"; toolName: string; output: unknown; toolCallId?: string }
  | { type: "tool-error"; toolName: string; error: unknown; toolCallId?: string }
  | { type: "step-start"; stepNumber?: number }
  | { type: "step-finish"; stepNumber?: number }
  | { type: "finish" };
```

`runAgentTurn` accepts `onTrace?: (event: AgentTraceEvent) => void | Promise<void>`. The agent should await async trace callbacks to keep output ordering deterministic.

### Agent public types

Milestone 1 can retain `ModelMessage[]` history for compatibility. This compatibility is transitional only. By the end of Milestone 2, remove or replace interfaces and tests that assert direct-chat `ModelMessage[]` behavior, direct assistant text as the user-visible answer, or `readFile` as an active tool. Milestone 2 should move the CLI-facing history to a harness-owned type to avoid sending full raw user input directly as model prompt history:

```ts
export type AgentConversationEntry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export function runAgentTurn(
  history: readonly AgentConversationEntry[],
  userInput: string,
  options: AgentOptions,
): Promise<AgentTurn>;

export type AgentOptions = {
  model: string;
  maxSteps?: number;
  maxFinalizationAttempts?: number;
  rootDirectory?: string; // only used by Milestone 1/readFile compatibility
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
};

export type AgentTurn = {
  text: string; // final user-visible output; in RLM mode, captured FINAL/FINAL_VAR text only
  messages: AgentConversationEntry[];
};
```

For Milestone 2, `messages` should append the full current `userInput` and the final output text to the harness-owned conversation history. These full values are injected into later Python `context.history`, not directly into the model message list. `AgentTurn.text` is the captured `FINAL` / `FINAL_VAR` output only; in RLM mode it is never ordinary assistant stream text.

### RLM model prompt and context flow

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="210" viewBox="0 0 760 210" role="img" aria-label="RLM turn flow"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#555"/></marker></defs><rect x="20" y="35" width="135" height="55" rx="8" fill="#eef6ff" stroke="#6aa0d8"/><text x="87" y="58" text-anchor="middle" font-family="sans-serif" font-size="13">CLI input</text><text x="87" y="76" text-anchor="middle" font-family="sans-serif" font-size="11">full userInput</text><rect x="205" y="25" width="150" height="75" rx="8" fill="#f7f7f7" stroke="#999"/><text x="280" y="53" text-anchor="middle" font-family="sans-serif" font-size="13">Harness</text><text x="280" y="72" text-anchor="middle" font-family="sans-serif" font-size="11">preview + context</text><rect x="405" y="20" width="145" height="85" rx="8" fill="#fff8e8" stroke="#d8ad45"/><text x="477" y="48" text-anchor="middle" font-family="sans-serif" font-size="13">LLM</text><text x="477" y="67" text-anchor="middle" font-family="sans-serif" font-size="11">sees bounded</text><text x="477" y="82" text-anchor="middle" font-family="sans-serif" font-size="11">preview only</text><rect x="610" y="25" width="125" height="75" rx="8" fill="#eefaf0" stroke="#69a86f"/><text x="672" y="53" text-anchor="middle" font-family="sans-serif" font-size="13">Pyodide REPL</text><text x="672" y="72" text-anchor="middle" font-family="sans-serif" font-size="11">context + FINAL</text><path d="M155 62 L205 62" stroke="#555" stroke-width="2" marker-end="url(#arrow)"/><path d="M355 62 L405 62" stroke="#555" stroke-width="2" marker-end="url(#arrow)"/><path d="M550 62 L610 62" stroke="#555" stroke-width="2" marker-end="url(#arrow)"/><path d="M672 100 C672 160 310 160 280 100" fill="none" stroke="#555" stroke-width="2" marker-end="url(#arrow)"/><text x="500" y="151" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#555">tool result previews + captured final value</text></svg>
```

For each RLM turn:

1. Build `RlmContext = { userInput, history }` where `history` is the prior `AgentConversationEntry[]`.
2. Create a fresh `RlmReplSession` and inject `context` plus `FINAL` and `FINAL_VAR`.
3. Send the model a system prompt and one bounded turn-initialization user message. Do **not** include raw `userInput` directly in the model message.
4. The model uses the `repl` tool to inspect `context` and compute the answer.
5. When the REPL captures a final value, `runAgentTurn` formats it and returns that text as the normal output.
6. If the stream finishes without finalization, append a bounded reminder message and run another attempt with the same turn-scoped REPL session until `maxFinalizationAttempts` is reached.

`maxFinalizationAttempts` means the maximum total number of model stream attempts for a single user turn, including the initial attempt. The default is `2`, meaning one initial attempt plus one reminder attempt. `maxFinalizationAttempts: 1` performs no reminder. Values below `1` are invalid and should throw before calling the model.

The reminder attempt must reuse the same `RlmReplSession` and must not include the full raw `userInput`. A suitable reminder is:

```text
You did not call FINAL(...) or FINAL_VAR(...). Continue using the repl tool already initialized with context. You must call FINAL(...) or FINAL_VAR(...) to provide the user-visible answer. Do not answer in ordinary assistant text.
```

Ordinary assistant text from failed attempts remains trace-only and is never returned or appended as assistant history. On success, returned history appends only `{ role: "user", content: userInput }` and `{ role: "assistant", content: finalText }`.

### Context preview contract

`createContextPreview(context)` returns a bounded prompt string like:

```text
A Python REPL has been initialized with context.
context is a dict with keys:
- userInput: "<first 500 chars, escaped/truncated>"
- history: "<first 500 chars of JSON preview, escaped/truncated>"
Use the repl tool to inspect context. You must call FINAL(...) or FINAL_VAR(...) when done.
```

Preview constants:

- Top-level preview per key: **500 characters**.
- Indicate truncation with `…[truncated, total N chars]`.
- The preview must be deterministic for tests.

### 500-character preview and schema-specific context limits

Automatic model-facing context previews remain truncated to 500 characters per top-level key. In addition, the selected RLM context shape `{ userInput, history }` must use lightweight schema-specific Python wrappers to guide the model away from accidental huge reads:

- `context["userInput"]` is a `LimitedString`.
- Each history entry `content` is a `LimitedString`.
- `context["history"]` is a `LimitedHistory` sequence-like wrapper.

`LimitedString` contract:

- `str(value)`, `repr(value)`, and REPL display return a bounded preview instead of the full string.
- Slicing is capped to 500 characters and includes the standard truncation marker when capped.
- `len(value)` returns the full underlying string length.
- Explicit helpers are available: `preview(limit=500)`, `slice(start, end)`, `find(substring)`, and optionally `search(substring, context=100)` for bounded surrounding snippets.

`LimitedHistory` supports `len`, indexing, and iteration, yielding entries with `role` and bounded `content`. Its `repr` summarizes entries without dumping full content.

These wrappers are guidance and accidental-large-output prevention, not a security sandbox. Generic recursive wrapping of arbitrary nested dict/list values remains out of scope.

### REPL session contract

```ts
export type RlmContext = {
  userInput: string;
  history: readonly AgentConversationEntry[];
};

export type ReplExecutionResult = {
  stdout: string;
  stderr: string;
  resultPreview?: string;
  finalSet: boolean;
};

export type FinalOutput = {
  kind: "string" | "json" | "repr";
  value: unknown;
  text: string;
};

export interface RlmReplSession {
  execute(code: string): Promise<ReplExecutionResult>;
  getFinalOutput(): Promise<FinalOutput | undefined>;
  dispose(): Promise<void>;
}
```

REPL execution must rely on Pyodide's built-in console/REPL implementation, preferably `pyodide.console.PyodideConsole`, rather than manually parsing Python ASTs or emulating last-expression behavior in TypeScript. Each `RlmReplSession` owns one console with a fresh globals namespace. Each `execute(code)` submits the provided code to that console as a complete REPL input block. Expression display, `_`, syntax errors, tracebacks, async support where available, and display-hook behavior should follow Pyodide/Python semantics.

Execution output limits returned to the model:

- `stdout`: 4,000 characters.
- `stderr`: 4,000 characters.
- `resultPreview`: 4,000 characters.
- Truncated fields must include `…[truncated, total N chars]`.

Captured final values are not truncated internally. Display formatting is deterministic:

- `FINAL(str)` outputs the string directly.
- `FINAL(nonString)` and `FINAL_VAR(value)` output pretty JSON with 2-space indentation when the value is JSON-compatible.
- Python dict keys are sorted alphabetically before JSON output.
- JSON-compatible values are: `None`, booleans, strings, finite integers/floats, lists/tuples of JSON-compatible values, and dicts with string keys and JSON-compatible values.
- Non-JSON-compatible values fall back to Python `repr(value)`. This includes NaN, Infinity, non-string dict keys, sets, functions, modules, classes, and arbitrary Python objects.

User Python code errors do not reject from `execute`; tracebacks/errors are returned in bounded `stderr`, and `finalSet` still reflects whether a final value was captured before the error. `execute` rejects only for infrastructure/session failures such as disposed sessions, Pyodide load failure, JS/Pyodide bridge failure, or invalid setup.

Concurrency is out of scope for the first pass. The CLI and harness assume one `runAgentTurn` at a time, and concurrent `execute(...)` calls on the same `RlmReplSession` are not supported. The implementation may reject concurrent use with a clear busy/concurrency error, but it must not claim concurrent safety. Sequential turns must use fresh logical sessions and must not leak Python globals.

### REPL tool contract

Expose exactly one active tool after Milestone 2:

- Tool name: `repl`
- Input schema: `{ code: string }`
- Output: `ReplExecutionResult`

The tool description must state that `context` is already available, targeted small reads are preferred, and final answers must be provided with `FINAL(...)` or `FINAL_VAR(...)`.

## Milestones

## Milestone 1: Live streaming refactor

### Milestone description

Replace `generateText` with `streamText` while preserving the existing direct-chat/readFile behavior. Add normalized trace events and render trace output live in grey from the CLI. The final answer should still be returned and printed normally after the stream completes.

### Verifiable milestone acceptance criteria

- `runAgentTurn(history, userInput, options)` still accepts prior history and returns `{ text, messages }` compatible with current CLI usage.
- `readFile` remains active in this milestone.
- `onTrace` receives text deltas, reasoning deltas, tool input/call/result/error events, step events, and finish events when the underlying AI SDK stream emits them.
- CLI writes grey trace output during the turn before printing the normal final answer.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

### Task checklist

- [ ] Add `src/trace.ts` with `AgentTraceEvent` and a `normalizeTextStreamPart(part)` helper.
- [ ] Update `AgentOptions` to include `onTrace`.
- [ ] Replace `generateText` with `streamText` in `src/agent.ts`.
- [ ] Iterate `result.fullStream`, emit normalized events, and accumulate assistant text deltas for compatibility.
- [ ] Await `result.response` after stream consumption and update returned messages using `result.response.messages`.
- [ ] Add `src/trace-renderer.ts` with ANSI grey/reset helpers and `renderTraceEvent`.
- [ ] Update `src/main.ts` to pass an `onTrace` callback and print the final `turn.text` normally.
- [ ] Keep `createReadFileTool` unchanged and active.

### Test plan for TDD

1. Red: add unit tests for `normalizeTextStreamPart` covering representative AI SDK part-like objects:
   - `text-delta` -> `assistant-text-delta`.
   - `reasoning-delta` -> `assistant-reasoning-delta`.
   - `tool-input-start`, `tool-input-delta`, `tool-input-end` preserve tool name/id.
   - `tool-call`, `tool-result`, `tool-error` preserve payloads.
   - unknown/unhandled parts return an empty list.
2. Green: implement normalization.
3. Red: add renderer tests using a fake writable stream or pure `formatTraceEvent` helper:
   - trace text is wrapped in grey/reset.
   - final answer formatting is not grey.
   - tool events include tool name.
4. Green: implement renderer helpers.
5. Red: add an agent orchestration test with a small fake stream adapter if needed:
   - fake text deltas emit `onTrace` before the promise resolves.
   - returned `text` equals accumulated text or final result text.
6. Green: implement streaming orchestration.

### Implementation notes or gotchas

- Avoid exact terminal-layout assertions in high-level tests; test formatting helpers instead.
- AI SDK stream part property names may vary by version. Before or during implementation, inspect the installed `ai` package `streamText(...).fullStream` part types. Keep normalization defensive, covered by typecheck against installed types, and ensure unknown parts produce no events and do not throw.
- If `result.text` is available as a promise, prefer the accumulated deltas only as fallback; the final returned text should match AI SDK semantics.
- Await async trace callbacks to avoid interleaved output in the CLI.

## Milestone 2: RLM REPL mode

### Milestone description

Replace direct model access to the raw user input and active file tools with a single Pyodide-backed `repl` tool. Each turn initializes a fresh logical Python session with `context = { userInput, history }`. The model must inspect context via `repl` and finish by calling `FINAL(...)` or `FINAL_VAR(...)`; only the captured final value is printed normally.

### Verifiable milestone acceptance criteria

- Active tools object passed to `streamText` contains `repl` and does not contain `readFile`.
- The model user message contains the bounded context preview and does not contain the full raw `userInput` when it exceeds preview length.
- Python code executed through the `repl` tool can read `context["userInput"]` and `context["history"]`.
- `FINAL("hello")` causes `runAgentTurn(...).text === "hello"`.
- `FINAL_VAR({"a": 1})` produces deterministic pretty JSON or documented display text.
- If no final value is set after an attempt, the harness performs at least one bounded reminder attempt, up to `maxFinalizationAttempts`.
- If no final value is set after all attempts, `runAgentTurn` throws a clear error rather than returning ordinary assistant text as the answer.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

### Task checklist

- [ ] Add `AgentConversationEntry` and migrate `main.ts` history from `ModelMessage[]` to this type.
- [ ] Add `src/rlm/context.ts` with `RlmContext`, deterministic JSON-compatible conversion, preview generation, truncation helpers, and schema-specific wrapper source/helpers for `LimitedString` and `LimitedHistory`.
- [ ] Add unit tests for preview generation and truncation markers.
- [ ] Add `src/rlm/repl.ts` with process-wide Pyodide runtime caching and fresh per-turn namespace/session creation.
- [ ] Inject Python `context`, `FINAL`, `FINAL_VAR`, `LimitedString`, `LimitedHistory`, and any helper/wrapper code into each session.
- [ ] Capture stdout/stderr around executed code.
- [ ] Return bounded stdout/stderr/result previews from `execute`.
- [ ] Store untruncated final values internally and expose `getFinalOutput()`.
- [ ] Add `src/tools/repl.ts` with the AI SDK tool schema and execute wrapper.
- [ ] Replace active tools in `src/agent.ts` with only `repl`.
- [ ] Replace raw user prompt construction with the bounded RLM turn-initialization message.
- [ ] Add the RLM system prompt.
- [ ] Add finalization-attempt loop using `maxFinalizationAttempts ?? 2`, where the value is total attempts including the initial attempt.
- [ ] Update CLI rendering so ordinary assistant text remains grey trace, while `turn.text` is the captured final value.
- [ ] Leave `src/tools/read-file.ts` in the repo but unused by RLM mode.

### Test plan for TDD

1. Red: context tests:
   - preview lists `userInput` and `history` keys.
   - each preview is capped at 500 characters plus truncation marker.
   - full long `userInput` does not appear in generated prompt.
   - `print(context["userInput"])` and `repr(context["history"])` do not dump full long content.
   - `len(context["userInput"])` returns the full underlying length.
   - `context["userInput"][:10000]` and `.slice(1000, 2000)` return bounded text.
2. Green: implement context preview helpers.
3. Red: final formatting tests:
   - string final displays directly.
   - JSON-compatible object displays deterministic pretty JSON with sorted keys and 2-space indentation.
   - fallback `repr` path is deterministic for representative non-JSON values.
4. Green: implement final formatting helpers.
5. Red: REPL session tests:
   - `execute("x = 1\nx + 1")` returns a `resultPreview` containing `2` using Pyodide console/REPL behavior.
   - assignment-only input has no `resultPreview`.
   - `_` refers to the previous displayed expression result if supported by Pyodide.
   - `print("hi")` captures stdout.
   - raising an exception resolves with bounded stderr containing the error and does not reject.
   - executing after `dispose()` rejects with a clear session error.
   - `FINAL("done")` sets final output.
   - `FINAL_VAR({"a": 1})` sets final output.
6. Green: implement `RlmReplSession`.
7. Red: tool factory tests:
   - schema requires `code`.
   - execution delegates to the session and returns bounded output.
8. Green: implement `createReplTool`.
9. Red: agent orchestration tests with mocked `streamText`:
   - active tool keys are exactly `["repl"]`.
   - model message contains preview, not full raw input.
   - final output is returned from the session, not from assistant text.
   - missing final triggers the exact configured number of total attempts, reuses the same REPL session for reminders, and then throws if still absent.
   - sequential turns use fresh logical sessions and Python globals do not leak.
10. Green: implement RLM orchestration.

### Implementation notes or gotchas

- Pyodide startup can be slow; cache `loadPyodide()` at module scope, but reset Python globals per logical turn.
- Ensure `dispose()` clears any JS references to final values and namespace objects.
- Do not return huge REPL values to the model. Always truncate tool feedback.
- Do not silently fall back to assistant text if finalization is missing; that would violate the RLM contract.
- The current `rootDirectory` option becomes unused after RLM mode unless future Python-side file helpers are added. Keep it only if needed for Milestone 1 compatibility.
- Generic nested dict/list strings beyond the known `{ userInput, history }` schema are not recursively read-limited in this pass by explicit decision; do not implement generic recursive wrapping unless requirements change.

## Invariants and things that should not change

- Project remains ESM TypeScript with Node >= 22.
- `npm run typecheck`, `npm test`, and `npm run build` must remain the primary verification commands.
- The CLI keeps `/exit` and `/quit` behavior.
- The active RLM tool set must contain only `repl`.
- Final user-visible output in RLM mode must come only from `FINAL` or `FINAL_VAR`.
- Model-facing automatic context previews must stay bounded and deterministic.
- A fresh logical Python session must be used for each user turn; Python variables from one turn must not leak into the next.
- Existing `readFile` source may remain for reference/backward compatibility but must not be wired into RLM mode.

## Stop-and-ask boundaries

Stop and ask before implementing if any of the following become necessary:

- Adding generic recursive read-limit wrappers for arbitrary nested dict/list strings beyond the known `{ userInput, history }` schema.
- Adding Python-side file-system helpers or restoring direct file tools in RLM mode.
- Persisting Python REPL state across turns instead of using fresh logical sessions.
- Changing the finalization syntax away from `FINAL(...)` / `FINAL_VAR(...)`.
- Introducing dependencies beyond the existing `ai`, `@ai-sdk/anthropic`, `pyodide`, TypeScript, and Vitest stack.
- Making large UX changes to the CLI beyond grey trace output plus normal final output.
