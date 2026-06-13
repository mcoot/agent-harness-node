import { highlight, supportsLanguage, type Theme } from "cli-highlight";
import { tuiStyle, type StyleFn } from "./style.js";

const plain: StyleFn = (text) => text;

const syntaxTheme: Theme = {
  default: plain,
  keyword: (text) => tuiStyle.magenta(tuiStyle.bold(text)),
  built_in: tuiStyle.cyan,
  type: tuiStyle.cyan,
  literal: tuiStyle.yellow,
  number: tuiStyle.yellow,
  regexp: tuiStyle.red,
  string: tuiStyle.green,
  subst: tuiStyle.white,
  symbol: tuiStyle.yellow,
  class: tuiStyle.blue,
  function: tuiStyle.blue,
  title: tuiStyle.blue,
  params: tuiStyle.white,
  comment: (text) => tuiStyle.grey(tuiStyle.italic(text)),
  doctag: tuiStyle.cyan,
  meta: tuiStyle.grey,
  "meta-keyword": tuiStyle.magenta,
  "meta-string": tuiStyle.green,
  section: tuiStyle.blue,
  tag: tuiStyle.blue,
  name: tuiStyle.blue,
  "builtin-name": tuiStyle.cyan,
  attr: tuiStyle.cyan,
  attribute: tuiStyle.cyan,
  variable: tuiStyle.yellow,
  bullet: tuiStyle.yellow,
  code: tuiStyle.green,
  emphasis: tuiStyle.italic,
  strong: tuiStyle.bold,
  formula: tuiStyle.cyan,
  link: tuiStyle.underline,
  quote: tuiStyle.grey,
  "selector-tag": tuiStyle.blue,
  "selector-id": tuiStyle.yellow,
  "selector-class": tuiStyle.yellow,
  "selector-attr": tuiStyle.cyan,
  "selector-pseudo": tuiStyle.cyan,
  "template-tag": tuiStyle.magenta,
  "template-variable": tuiStyle.yellow,
  addition: tuiStyle.green,
  deletion: tuiStyle.red,
};

const languageAliases: Record<string, string> = {
  py: "python",
  python3: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
};

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return languageAliases[normalized] ?? normalized;
}

export function highlightCode(code: string, language?: string): string[] {
  const normalizedLanguage = normalizeLanguage(language);
  try {
    const highlighted = highlight(code, {
      ...(normalizedLanguage !== undefined && supportsLanguage(normalizedLanguage) ? { language: normalizedLanguage } : {}),
      ignoreIllegals: true,
      theme: syntaxTheme,
    });
    return highlighted.split("\n");
  } catch {
    return code.split("\n");
  }
}

export function highlightInlineCode(code: string, language?: string): string {
  return highlightCode(code, language).join(" ");
}
