import { indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ds";
import styles from "./JsonEditor.module.scss";

type JsonEditorProps = {
  /** Seeds the document; later changes that differ from the document replace it. */
  value: string;
  onChange: (text: string) => void;
  /** Fires when the text starts or stops parsing as JSON. */
  onValidityChange: (valid: boolean) => void;
  /** Ctrl/Cmd+S. */
  onSubmit: () => void;
  /** Focus the editor on mount (default true). */
  autoFocus?: boolean;
};

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Same colors as JsonViewer, so editing looks like reading.
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--code-key)" },
  { tag: tags.string, color: "var(--code-string)" },
  { tag: tags.number, color: "var(--code-number)" },
  { tag: [tags.bool, tags.null], color: "var(--code-literal)" },
  { tag: [tags.separator, tags.brace, tags.squareBracket], color: "var(--code-punct)" },
]);

// Tokens only: .theme-dark on <html> swaps the variables, no JS theme switch.
// `dark: true` because code surfaces are dark in both app themes (--code-bg).
const theme = EditorView.theme(
  {
    "&": {
      maxHeight: "480px",
      color: "var(--code-text)",
      backgroundColor: "var(--code-bg)",
      border: "1px solid var(--code-border)",
      borderRadius: "var(--radius-lg)",
      fontSize: "12px",
    },
    "&.cm-focused": { outline: "none", boxShadow: "0 0 0 3px var(--primary-ring)" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content, .cm-gutter": { minHeight: "240px" },
    ".cm-content": { caretColor: "var(--code-text)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-text)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--surface-dark-elevated)" },
    ".cm-gutters": {
      backgroundColor: "var(--code-bg)",
      color: "var(--on-dark-soft)",
      border: "none",
      borderTopLeftRadius: "var(--radius-lg)",
      borderBottomLeftRadius: "var(--radius-lg)",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--on-dark-soft)" },
    ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "none", color: "var(--on-dark-soft)" },
    ".cm-tooltip": {
      backgroundColor: "var(--surface-dark-elevated)",
      color: "var(--code-text)",
      border: "1px solid var(--code-border)",
      borderRadius: "var(--radius-sm)",
    },
    ".cm-panels": { backgroundColor: "var(--surface-dark-elevated)", color: "var(--code-text)" },
  },
  { dark: true },
);

/** CodeMirror JSON editor: lint gutter, folding, search, history, Format, Ctrl/Cmd+S. */
export function JsonEditor({ value, onChange, onValidityChange, onSubmit, autoFocus = true }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialDoc = useRef(value);
  const focusOnMount = useRef(autoFocus);
  const [valid, setValid] = useState(() => parses(value));
  // Latest callbacks, so the view is created once.
  const handlers = useRef({ onChange, onValidityChange, onSubmit });
  useEffect(() => {
    handlers.current = { onChange, onValidityChange, onSubmit };
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let lastValid = parses(initialDoc.current);
    const editor = new EditorView({
      doc: initialDoc.current,
      parent,
      extensions: [
        basicSetup,
        // Tab indents instead of moving focus; Escape then Tab still leaves the editor.
        keymap.of([indentWithTab]),
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        syntaxHighlighting(highlight),
        theme,
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return false;
            event.preventDefault();
            handlers.current.onSubmit();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          handlers.current.onChange(text);
          const nextValid = parses(text);
          if (nextValid === lastValid) return;
          lastValid = nextValid;
          setValid(nextValid);
          handlers.current.onValidityChange(nextValid);
        }),
      ],
    });
    view.current = editor;
    if (focusOnMount.current) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Outside changes only; text that came from onChange already matches.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  function format() {
    const editor = view.current;
    if (!editor) return;
    const text = editor.state.doc.toString();
    if (!parses(text)) return;
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: pretty } });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Button size="sm" variant="text" disabled={!valid} onClick={format}>
          Format
        </Button>
      </div>
      <div ref={host} />
    </div>
  );
}
