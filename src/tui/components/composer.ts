import { Editor, Key, matchesKey, type Component, type EditorTheme, type Focusable, type TUI } from "@earendil-works/pi-tui";

const passthrough = (text: string): string => text;

export function createEditorTheme(): EditorTheme {
  return {
    borderColor: passthrough,
    selectList: {
      selectedPrefix: passthrough,
      selectedText: passthrough,
      description: passthrough,
      scrollInfo: passthrough,
      noMatch: passthrough,
    },
  };
}

export class Composer implements Component, Focusable {
  readonly editor: Editor;
  onSubmit?: (text: string) => void;

  get focused(): boolean {
    return this.editor.focused;
  }

  set focused(value: boolean) {
    this.editor.focused = value;
  }

  constructor(tui: TUI, theme: EditorTheme = createEditorTheme()) {
    this.editor = new Editor(tui, theme, { paddingX: 0 });
    this.editor.onSubmit = (text) => this.submit(text);
  }

  getText(): string {
    return this.editor.getText();
  }

  setText(text: string): void {
    this.editor.setText(text);
  }

  submitCurrent(): void {
    this.submit(this.editor.getText());
  }

  private submit(text: string): void {
    this.editor.addToHistory(text);
    this.editor.setText("");
    this.onSubmit?.(text);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("x")) || matchesKey(data, Key.ctrl("enter"))) {
      this.submitCurrent();
      return;
    }
    this.editor.handleInput(data);
  }

  render(width: number): string[] {
    return this.editor.render(width);
  }

  invalidate(): void {
    this.editor.invalidate();
  }
}
