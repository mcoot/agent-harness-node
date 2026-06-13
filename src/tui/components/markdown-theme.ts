import type { MarkdownTheme } from "@earendil-works/pi-tui";

const passthrough = (text: string): string => text;

export function createMarkdownTheme(): MarkdownTheme {
  return {
    heading: passthrough,
    link: passthrough,
    linkUrl: passthrough,
    code: passthrough,
    codeBlock: passthrough,
    codeBlockBorder: passthrough,
    quote: passthrough,
    quoteBorder: passthrough,
    hr: passthrough,
    listBullet: passthrough,
    bold: passthrough,
    italic: passthrough,
    strikethrough: passthrough,
    underline: passthrough,
  };
}
