export type FinalOutput = {
  kind: "string" | "json" | "repr";
  value: unknown;
  text: string;
};

export type PythonFinalPayload =
  | { kind: "string"; text: string; value: string }
  | { kind: "json"; text: string; value: unknown }
  | { kind: "repr"; text: string; value: unknown };

export function finalOutputFromPayload(payload: PythonFinalPayload): FinalOutput {
  return {
    kind: payload.kind,
    value: payload.value,
    text: payload.text,
  };
}
