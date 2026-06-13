import { loadPyodide, type PyodideAPI } from "pyodide";
import { pythonContextSetupSource, truncateWithMarker, TOOL_OUTPUT_LIMIT, type RlmContext } from "./context.js";
import { finalOutputFromPayload, type FinalOutput, type PythonFinalPayload } from "./final-output.js";

export type ReplExecutionResult = {
  stdout: string;
  stderr: string;
  resultPreview?: string;
  finalSet: boolean;
};

export interface RlmReplSession {
  execute(code: string): Promise<ReplExecutionResult>;
  getFinalOutput(): Promise<FinalOutput | undefined>;
  dispose(): Promise<void>;
}

let pyodidePromise: Promise<PyodideAPI> | undefined;

async function getPyodide(): Promise<PyodideAPI> {
  pyodidePromise ??= loadPyodide();
  return pyodidePromise;
}

const FINAL_SETUP = String.raw`
import json, math
__rlm_final = None

def __rlm_is_json_compatible(value):
    if value is None or isinstance(value, (bool, str)):
        return True
    if isinstance(value, int) and not isinstance(value, bool):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, (list, tuple)):
        return all(__rlm_is_json_compatible(v) for v in value)
    if isinstance(value, dict):
        return all(isinstance(k, str) and __rlm_is_json_compatible(v) for k, v in value.items())
    return False

def __rlm_to_jsonable(value):
    if isinstance(value, tuple):
        return [__rlm_to_jsonable(v) for v in value]
    if isinstance(value, list):
        return [__rlm_to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: __rlm_to_jsonable(value[k]) for k in sorted(value.keys())}
    return value

def __rlm_capture(value):
    global __rlm_final
    if isinstance(value, str):
        __rlm_final = {"kind": "string", "text": value, "value": value}
    elif __rlm_is_json_compatible(value):
        jsonable = __rlm_to_jsonable(value)
        __rlm_final = {"kind": "json", "text": json.dumps(jsonable, indent=2, sort_keys=True, allow_nan=False), "value": jsonable}
    else:
        __rlm_final = {"kind": "repr", "text": repr(value), "value": repr(value)}
    return value

def FINAL(value):
    return __rlm_capture(value)

def FINAL_VAR(value):
    return __rlm_capture(value)
`;

const EXECUTE_SOURCE = String.raw`
import contextlib, io, traceback
from pyodide.code import eval_code_async
_stdout = io.StringIO()
_stderr = io.StringIO()
_result_preview = None
with contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):
    try:
        _result = await eval_code_async(__rlm_code, globals=globals(), locals=globals())
        if _result is not None:
            _result_preview = repr(_result)
    except Exception:
        traceback.print_exc(file=_stderr)
{"stdout": _stdout.getvalue(), "stderr": _stderr.getvalue(), "resultPreview": _result_preview, "finalSet": __rlm_final is not None}
`;

export class PyodideRlmReplSession implements RlmReplSession {
  readonly #pyodide: PyodideAPI;
  readonly #globals: any;
  #disposed = false;
  #busy = false;

  private constructor(pyodide: PyodideAPI, globals: any) {
    this.#pyodide = pyodide;
    this.#globals = globals;
  }

  static async create(context: RlmContext): Promise<PyodideRlmReplSession> {
    const pyodide = await getPyodide();
    const globals = pyodide.runPython("dict()");
    await pyodide.runPythonAsync(`${pythonContextSetupSource(context)}\n${FINAL_SETUP}`, { globals });
    return new PyodideRlmReplSession(pyodide, globals);
  }

  async execute(code: string): Promise<ReplExecutionResult> {
    if (this.#disposed) throw new Error("Cannot execute code: REPL session has been disposed");
    if (this.#busy) throw new Error("Cannot execute code: REPL session is busy");
    this.#busy = true;
    try {
      this.#globals.set("__rlm_code", code);
      const raw = await this.#pyodide.runPythonAsync(EXECUTE_SOURCE, { globals: this.#globals });
      const value = raw.toJs ? raw.toJs() as Record<string, unknown> : raw as Record<string, unknown>;
      raw.destroy?.();
      const stdout = truncateWithMarker(String(value.stdout ?? ""), TOOL_OUTPUT_LIMIT);
      const stderr = truncateWithMarker(String(value.stderr ?? ""), TOOL_OUTPUT_LIMIT);
      const result = value.resultPreview == null ? undefined : truncateWithMarker(String(value.resultPreview), TOOL_OUTPUT_LIMIT);
      return {
        stdout,
        stderr,
        ...(result === undefined ? {} : { resultPreview: result }),
        finalSet: value.finalSet === true,
      };
    } finally {
      this.#busy = false;
    }
  }

  async getFinalOutput(): Promise<FinalOutput | undefined> {
    if (this.#disposed) throw new Error("Cannot read final output: REPL session has been disposed");
    const raw = this.#pyodide.runPython("__rlm_final", { globals: this.#globals });
    if (raw == null) return undefined;
    const payload = (raw.toJs ? raw.toJs({ dict_converter: Object.fromEntries }) : raw) as PythonFinalPayload;
    raw.destroy?.();
    return finalOutputFromPayload(payload);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#globals.destroy?.();
  }
}

export async function createRlmReplSession(context: RlmContext): Promise<RlmReplSession> {
  return PyodideRlmReplSession.create(context);
}
