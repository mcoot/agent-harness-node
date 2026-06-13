export type StyleFn = (text: string) => string;

const ESC = "\u001b[";

function ansi(open: string, close: string): StyleFn {
  return (text: string): string => text.length === 0 ? text : `${ESC}${open}m${text}${ESC}${close}m`;
}

function compose(...styles: StyleFn[]): StyleFn {
  return (text: string): string => styles.reduce((current, style) => style(current), text);
}

export const tuiStyle = {
  reset: `${ESC}0m`,
  bold: ansi("1", "22"),
  dim: ansi("2", "22"),
  italic: ansi("3", "23"),
  underline: ansi("4", "24"),
  grey: ansi("90", "39"),
  red: ansi("31", "39"),
  green: ansi("32", "39"),
  yellow: ansi("33", "39"),
  blue: ansi("34", "39"),
  magenta: ansi("35", "39"),
  cyan: ansi("36", "39"),
  white: ansi("37", "39"),

  appTitle: compose(ansi("36", "39"), ansi("1", "22")),
  userLabel: compose(ansi("36", "39"), ansi("1", "22")),
  finalLabel: compose(ansi("32", "39"), ansi("1", "22")),
  finalText: ansi("37", "39"),
  assistantTrace: compose(ansi("2", "22"), ansi("36", "39")),
  reasoning: compose(ansi("2", "22"), ansi("3", "23"), ansi("35", "39")),
  toolHeader: compose(ansi("1", "22"), ansi("33", "39")),
  toolInput: compose(ansi("2", "22"), ansi("33", "39")),
  toolResult: ansi("36", "39"),
  toolSuccess: ansi("32", "39"),
  toolWarning: ansi("33", "39"),
  error: compose(ansi("1", "22"), ansi("31", "39")),
  muted: ansi("90", "39"),
};
