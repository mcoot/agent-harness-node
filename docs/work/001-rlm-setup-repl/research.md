---
id: 002-rlm-repl-research
name: First-pass RLM REPL harness research
description: Research for refactoring the minimal Node agent harness toward live-streamed traces and Pyodide REPL-mediated RLM interaction.
status: complete
---

## Research question

How should the current minimal TypeScript/Node agent harness evolve toward an RLM-style interaction model while keeping the implementation small?

Specifically:

1. First refactor the harness so assistant thinking, text deltas, and tool activity can stream live to the CLI.
2. Then replace direct user/context interaction and existing file tools with a single Pyodide-backed `repl` tool.
3. Initialize each agent turn with a Python `context` value that the agent must inspect programmatically.
4. Require final user-facing output to be supplied through `FINAL(...)` or `FINAL_VAR(...)` in the REPL.

## Findings summary

- The current harness is very small: `src/agent.ts` wraps AI SDK `generateText`, provides Anthropic model access, conversation history, and a `readFile` tool; `src/main.ts` owns the readline CLI loop.
- The project already depends on `pyodide`, so no new dependency is required for the first REPL implementation.
- AI SDK supports live streaming through `streamText`, whose `fullStream` emits text deltas, reasoning deltas, tool input chunks, tool calls, tool results, tool errors, step boundaries, and finish events.
- Live trace streaming should be treated as a first milestone/refactor before RLM behavior. This reduces risk by separating CLI/agent streaming concerns from Pyodide context/finalization semantics.
- For the first RLM pass, use a fresh Pyodide REPL per agent turn, but design the interface so persistent per-conversation REPL state can be added later.
- Preserve existing multi-turn behavior by passing a structured dict-like context containing `{ userInput, history }`, not just the current input string.
- Enforce the 500-character read limit only for top-level string context in the first pass via a Python wrapper; recursive wrapping of nested dict/list strings should be future work.
- Remove direct `readFile` support for the RLM pass and expose only the `repl` tool.

## Detailed findings

### Current codebase shape

#### `src/agent.ts`

Current behavior:

- Imports `anthropic` from `@ai-sdk/anthropic`.
- Calls `generateText` from `ai`.
- Accepts prior `ModelMessage[]` history and current `userInput`.
- Appends `{ role: "user", content: userInput }` to history.
- Uses a concise system prompt describing a minimal local agent harness.
- Exposes one tool, `readFile`, via `createReadFileTool`.
- Stops via `stepCountIs(maxSteps)`.
- Returns `{ text: result.text, messages: [...messages, ...result.response.messages] }`.

Implications:

- The agent currently sees the user input directly in model context.
- Tool use is normal AI SDK tool use; there is no REPL-mediated context access.
- The return shape is text-centric and does not expose trace events.
- `generateText` waits for completion, so the CLI cannot stream intermediate text/tool activity live.

#### `src/main.ts`

Current behavior:

- Creates a readline prompt.
- Defaults model to `process.env.AI_MODEL ?? "claude-haiku-4-5"`.
- Maintains `history: ModelMessage[]`.
- Calls `runAgentTurn(history, userInput, { model })`.
- Prints only `turn.text` after the turn completes.

Implications:

- CLI rendering is synchronous-after-turn and not suited to live grey traces yet.
- A streaming refactor should introduce a trace callback or event renderer so `main.ts` can render deltas/tool events while `runAgentTurn` runs.

#### `src/tools/read-file.ts`

Current behavior:

- Defines an AI SDK tool using `tool` and `jsonSchema`.
- Safely resolves paths under `rootDirectory`.
- Reads UTF-8 files and returns `{ path, content }`.

Implications:

- This can remain in the repo but should be removed from the active tool set for the first RLM pass.
- Future file operations, if any, should be mediated by Python-side helpers inside the REPL, not exposed as independent direct tools in this pass.

### AI SDK streaming support

The installed `ai` package exposes `streamText` in `node_modules/ai/dist/index.d.ts`.

Important API facts:

- `streamText(...)` accepts broadly similar options to `generateText`, including:
  - `model`
  - `system`
  - `messages`
  - `tools`
  - `stopWhen`
  - step/tool callbacks
- `StreamTextResult` exposes:
  - `fullStream: AsyncIterableStream<TextStreamPart<TOOLS>>`
  - `textStream: AsyncIterableStream<string>`
  - `response: PromiseLike<... & { messages: Array<ResponseMessage> }>`
  - `steps`, `toolCalls`, `toolResults`, etc.
- `TextStreamPart` includes event variants for:
  - `text-delta`
  - `reasoning-delta`
  - `tool-input-start`
  - `tool-input-delta`
  - `tool-input-end`
  - `tool-call`
  - `tool-result`
  - `tool-error`
  - `start-step`, `finish-step`, `finish`

Recommended first milestone:

- Replace `generateText` with `streamText` in `runAgentTurn`.
- Add an optional `onTrace(event)` callback.
- Iterate `result.fullStream` inside `runAgentTurn` and emit normalized trace events.
- Await `result.response` after stream consumption to update conversation history.
- Keep a final `text` return for compatibility during the streaming refactor.

A small normalized event type should avoid coupling the CLI to all AI SDK event variants:

```ts
type AgentTraceEvent =
  | { type: "assistant-text-delta"; text: string }
  | { type: "assistant-reasoning-delta"; text: string }
  | { type: "tool-input-delta"; toolName: string; text: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string; output: unknown }
  | { type: "tool-error"; toolName: string; error: unknown };
```

For the later RLM pass, these can be narrowed to `repl-command`, `repl-result`, and grey assistant/thinking deltas.

### Terminal UX for grey trace output

The prompt requests that final output be visible normally, with agent thinking and REPL commands shown in grey.

A minimal terminal renderer can use ANSI SGR grey:

- Grey: `\x1b[90m`
- Reset: `\x1b[0m`

Recommended behavior:

- During milestone 1, stream assistant text/tool events in grey as trace output.
- After the turn finishes, print final result normally.
- For RLM milestone, do not treat ordinary assistant text as the final answer. Only the captured `FINAL`/`FINAL_VAR` value should print normally.

Open implementation detail:

- Streaming text deltas may arrive interleaved with tool events. A simple first pass can write grey deltas directly and insert newlines before/after tool call/result blocks.
- Tests should avoid asserting exact terminal formatting beyond the renderer’s responsibilities.

### Pyodide REPL implementation

The project already includes `pyodide: latest` in `package.json`. `node_modules/pyodide/README.md` documents Node usage:

```js
const { loadPyodide } = require("pyodide");
let pyodide = await loadPyodide();
await pyodide.runPythonAsync("1+1");
```

Because the project uses ESM TypeScript (`"type": "module"`, `module: "NodeNext"`), implementation should import from `pyodide` using ESM-compatible imports, likely:

```ts
import { loadPyodide } from "pyodide";
```

Recommended module shape:

- Add `src/rlm/repl.ts` or `src/tools/repl.ts`.
- Create a turn-scoped `RlmReplSession` abstraction that:
  - lazily or explicitly loads Pyodide,
  - initializes Python globals,
  - injects `context`,
  - exposes an `execute(code: string)` method,
  - records final output set by `FINAL`/`FINAL_VAR`.

Possible types:

```ts
export type RlmContext = {
  userInput: string;
  history: readonly ModelMessage[];
};

export type ReplExecutionResult = {
  stdout: string;
  stderr: string;
  resultPreview?: string;
  finalSet: boolean;
};

export type FinalOutput = {
  value: unknown;
  preview: string;
};
```

### Context injection and previewing

User decision: use dict context with `{ userInput, history }`.

The model should not receive the raw full user input as direct prompt content. Instead:

- The actual model user message should be a turn-initialization instruction, not the user's full request verbatim if it may be large.
- The Pyodide `context` variable contains the inspectable payload.
- The initial message shown to the agent should include an automatic preview produced by harness code.

For dict context, the prompt asks for:

- top-level keys,
- truncated previews of values to 500 characters.

Recommended preview example:

```text
A Python REPL has been initialized with context.
context is a dict with keys:
- userInput: "...first 500 chars..."
- history: "...preview of serialized history..."
Use the repl tool to inspect context. You must call FINAL(...) or FINAL_VAR(...) when done.
```

For first implementation, `history` can be converted to JSON-compatible Python values. The preview should avoid dumping full history into model context.

### 500-character read limit

User decision: enforce for top-level string context only in the first pass.

Since the chosen context is a dict, first-pass enforcement can focus on the case where the whole `context` itself is a string, preserving alignment with the original prompt while avoiding recursive wrapper complexity.

Recommended approach:

- Implement a Python `LimitedString` wrapper for string context.
- Permit slices whose resulting length is at most 500 characters.
- Provide helper methods like:
  - `preview_start(n=500)`
  - `preview_end(n=500)`
  - `find(...)`
  - `len(...)` support if practical
- If the context is a dict, nested strings are normal values for now, but their automatic preview remains truncated.

Important documented limitation:

- With `{ userInput, history }`, nested `userInput` will not be hard-limited unless recursive wrapping is added. This is acceptable by current decision but should be called out clearly in the plan.

### Finalization semantics

The RLM pass should define Python functions:

- `FINAL(output_string)`
- `FINAL_VAR(value)`

Behavior:

- Store the final output in a JS-owned or Python-owned cell accessible to the tool/harness after each REPL execution.
- `FINAL` is for direct string output.
- `FINAL_VAR` accepts any Python value and allows final output without forcing the model to read its full representation into the context window.
- The harness should convert the final value to a user-displayable value.

Recommended first-pass conversion:

- Strings: print directly.
- JSON-compatible primitives/lists/dicts: convert to JS using Pyodide conversion where available and pretty-print JSON.
- Fallback: use Python `repr(value)` with a clear marker that it is a representation.

If an agent ends its generation without setting a final output:

- The prompt says it should be re-invoked to continue.
- Minimal first implementation can run another model step/turn with the same messages and a reminder, bounded by `maxSteps` or a separate `maxFinalizationAttempts`.
- Research recommendation: implement this as part of RLM milestone, not streaming milestone.

### REPL tool shape

The RLM pass should expose only one AI SDK tool:

- Name: `repl`
- Input: `{ code: string }`
- Output: likely `{ stdout, stderr, result, finalSet }`

Tool description should emphasize:

- Execute Python code in the turn’s REPL.
- Use it to inspect `context`.
- Use `FINAL(...)` or `FINAL_VAR(...)` to complete the turn.

Potential issue:

- If `runPythonAsync` returns a large value, returning it directly to the model could defeat the token-saving goal. The tool should return bounded previews unless the value is small.

Recommended output policy:

- Capture stdout/stderr and truncate each to a reasonable size for model feedback.
- For expression results, return a truncated representation.
- Separately store the untruncated final value internally when `FINAL_VAR` is used.

### System prompt for RLM mode

A concise system prompt should state:

- You are operating through a Python REPL.
- You do not directly answer from the visible prompt/context preview alone unless sufficient.
- To inspect user/context/tool state, call `repl` with Python code.
- `context` is already available in Python.
- Reads should be targeted and small.
- When done, call `FINAL('...')` or `FINAL_VAR(value)`.
- Any assistant text outside finalization is trace/thinking and not the user-visible answer.

### Milestone split

#### Milestone 1: Live streaming refactor

Goal: preserve current behavior while making trace output live.

Tasks:

1. Switch `src/agent.ts` from `generateText` to `streamText`.
2. Add `AgentTraceEvent` and optional `onTrace` callback.
3. Iterate `fullStream`, emit assistant text/reasoning/tool events live, and accumulate text if needed.
4. Await `result.response` to preserve conversation history.
5. Update `src/main.ts` to render trace events in grey and final text normally.
6. Keep existing `readFile` tool active in this milestone to avoid behavior changes.

Acceptance criteria:

- Existing CLI still supports multi-turn conversation.
- Assistant text appears incrementally rather than only after completion.
- Tool calls/results can be rendered as trace events.
- History still updates correctly.

#### Milestone 2: RLM REPL mode

Goal: replace direct context/tool access with a Pyodide REPL tool.

Tasks:

1. Add a turn-scoped Pyodide REPL session abstraction.
2. Initialize `context = { userInput, history }` in Python.
3. Generate a bounded context preview in the model message.
4. Replace active tools with only `repl`.
5. Add `FINAL` and `FINAL_VAR` functions.
6. Detect final output after tool calls.
7. If no final output is set, re-invoke or continue within bounded attempts.
8. Print grey trace output live and final value normally.

Acceptance criteria:

- The model can inspect `context` only through `repl`.
- `readFile` is no longer exposed as an active model tool.
- Final user-visible output comes from `FINAL`/`FINAL_VAR`.
- If finalization is missing, the harness continues/reminds rather than silently returning empty assistant text.

## Key insights and clarifications

- User chose fresh REPL per turn, with interfaces designed to allow persistent REPL state later.
- User chose dict context: `{ userInput, history }`.
- User chose first-pass 500-character enforcement for top-level string context only, not recursive dict wrapping.
- User initially considered post-turn trace rendering but changed direction: live streaming should be implemented first as a milestone refactor before RLM behavior.
- Keeping the harness minimal argues for two separate changes: first streaming, then REPL semantics.
- The current `readFile` tool is useful for current harness behavior but should not be part of the RLM tool set for the first pass.

## Key questions for implementation

These are mostly unambiguous after clarification:

1. Streaming API: use AI SDK `streamText` and consume `fullStream`.
2. Trace rendering: render live in `main.ts` through an `onTrace` callback and grey ANSI styling.
3. RLM context: set Python `context` to `{ userInput, history }`.
4. REPL lifecycle: fresh per agent turn now; do not persist Python state across turns yet.
5. Read limit: implement only top-level string context limiting for now; document that nested dict strings are not hard-limited in this pass.
6. Tool set in RLM mode: expose only `repl`.
7. Finalization: require `FINAL`/`FINAL_VAR`; final user output is the captured final value, not ordinary assistant text.

Remaining design choices for the implementation plan:

- Exact normalized `AgentTraceEvent` union.
- Exact truncation sizes for stdout/stderr/tool-result previews.
- Whether Pyodide should be loaded once globally and used to create fresh namespaces per turn, or fully loaded/session-created per turn. A practical implementation may cache the Pyodide runtime while resetting globals per turn to avoid startup cost while preserving fresh logical state.
- Test strategy: likely unit-test context preview/finalization/truncation separately and smoke-test streaming with mocked model/tool events if practical.

## References

### Codebase

- `package.json`
  - ESM TypeScript package.
  - Scripts: `build`, `typecheck`, `test`, `dev`, `start`.
  - Dependencies include `@ai-sdk/anthropic`, `ai`, and `pyodide`.
- `src/agent.ts`
  - Current `generateText`-based agent loop.
  - Current active `readFile` tool.
- `src/main.ts`
  - Readline CLI and history management.
- `src/tools/read-file.ts`
  - Existing safe file-reading AI SDK tool.
- `docs/work/001-rlm-setup-repl/prompt.md`
  - Source prompt describing desired RLM/REPL mechanics and UX.

### Local dependency docs/types

- `node_modules/pyodide/README.md`
  - Documents `loadPyodide()` and `runPythonAsync(...)` usage in Node.
- `node_modules/ai/dist/index.d.ts`
  - `streamText(...)` declaration.
  - `StreamTextResult.fullStream` and `TextStreamPart` event variants.
  - `generateText(...)` current API reference.
