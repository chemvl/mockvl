import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Input } from 'antd';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { createLowlight } from 'lowlight';
import { useEffect, useRef, useState } from 'react';
import { defaultImageUploadAdapter } from './imageUpload';
import type { RichTextEditorProps } from './RichTextEditor';
import { useEditorStyles } from './RichTextEditor.style';
import { RichTextToolbar } from './RichTextToolbar';
import { normalizeEditorHtml } from './richTextHtml';

export type RichTextEditorMode = 'wysiwyg' | 'source';

// Curated grammars keep this lazy chunk lean — extend alongside real usage
// (and keep the server allowlist in apps/api src/lib/sanitize.ts in sync
// with everything this editor can emit).
const lowlight = createLowlight({
  bash,
  css,
  javascript,
  json,
  python,
  sql,
  typescript,
  xml,
});

// StarterKit v3 already bundles Link/Underline/UndoRedo; its plain code block
// is swapped for the lowlight-highlighted one.
const extensions = [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false },
  }),
  CodeBlockLowlight.configure({ lowlight }),
  Image,
  TableKit.configure({ table: { resizable: false } }),
];

export const RichTextEditorContent = ({
  value,
  onChange,
  onBlur,
  disabled,
  uploadAdapter = defaultImageUploadAdapter,
}: RichTextEditorProps) => {
  const { styles, cx } = useEditorStyles();
  const [mode, setMode] = useState<RichTextEditorMode>('wysiwyg');

  // The editor instance is created once; its callbacks read the latest props
  // through refs so FormItem's per-render onChange wrappers never go stale.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  }, [onChange, onBlur]);

  const editor = useEditor({
    extensions,
    content: value ?? '',
    editable: !disabled,
    // Empty documents emit '' (not '<p></p>') so required-field validation
    // and the form's ''→null submit conversion work like a plain textarea.
    onUpdate: ({ editor: current }) =>
      onChangeRef.current?.(normalizeEditorHtml(current.getHTML())),
    onBlur: () => onBlurRef.current?.(),
  });

  // Adopt external form resets (RHF reset() once the edit record loads). The
  // normalized comparison ignores the editor's own updates, so typing never
  // triggers a caret-resetting setContent.
  //
  // isDestroyed guards: @tiptap/react destroys instances on a 1ms timer
  // (scheduleDestroy), which can fire between a commit and its effects when
  // this lazy chunk mounts under Suspense. destroy() nulls editor.schema, so
  // getHTML() on a destroyed instance throws "Cannot read properties of null
  // (reading 'cached')". A fresh instance re-runs these effects afterwards.
  useEffect(() => {
    if (!editor || editor.isDestroyed || mode !== 'wysiwyg') return;
    const incoming = value ?? '';
    if (
      normalizeEditorHtml(editor.getHTML()) !== normalizeEditorHtml(incoming)
    ) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [editor, value, mode]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  const handleModeChange = (next: RichTextEditorMode) => {
    if (next === 'wysiwyg' && editor && !editor.isDestroyed) {
      // Re-parse whatever was typed as source; tiptap canonicalizes it (drops
      // unknown tags per its schema), then the form adopts the canonical HTML.
      editor.commands.setContent(value ?? '', { emitUpdate: false });
      onChangeRef.current?.(normalizeEditorHtml(editor.getHTML()));
    }
    setMode(next);
  };

  if (!editor) return null;

  return (
    <div className={cx(styles.root, disabled && styles.rootDisabled)}>
      <div className={styles.toolbar}>
        <RichTextToolbar
          editor={editor}
          mode={mode}
          onModeChange={handleModeChange}
          disabled={disabled}
          uploadAdapter={uploadAdapter}
        />
      </div>
      {mode === 'wysiwyg' ? (
        <EditorContent editor={editor} className={styles.content} />
      ) : (
        <Input.TextArea
          className={styles.sourceTextarea}
          variant="borderless"
          autoSize={{ minRows: 9 }}
          value={value ?? ''}
          onChange={(event) => onChangeRef.current?.(event.target.value)}
          onBlur={() => onBlurRef.current?.()}
          disabled={disabled}
        />
      )}
    </div>
  );
};
