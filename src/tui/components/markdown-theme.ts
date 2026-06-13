import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { highlightCode } from "../syntax-highlight.js";
import { tuiStyle } from "../style.js";

export function createMarkdownTheme(): MarkdownTheme {
  return {
    heading: tuiStyle.cyan,
    link: tuiStyle.blue,
    linkUrl: tuiStyle.grey,
    code: tuiStyle.yellow,
    codeBlock: tuiStyle.white,
    codeBlockBorder: tuiStyle.grey,
    quote: tuiStyle.grey,
    quoteBorder: tuiStyle.cyan,
    hr: tuiStyle.grey,
    listBullet: tuiStyle.cyan,
    bold: tuiStyle.bold,
    italic: tuiStyle.italic,
    strikethrough: (text) => `\u001b[9m${text}\u001b[29m`,
    underline: tuiStyle.underline,
    highlightCode,
  };
}
