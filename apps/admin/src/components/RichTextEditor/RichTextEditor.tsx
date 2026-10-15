import { Skeleton } from 'antd';
import { lazy, Suspense } from 'react';
import type { RichTextImageUploadAdapter } from './imageUpload';

// tiptap and its prosemirror tree are heavy — everything editor-related lives
// in RichTextEditorContent and only loads when a richtext field renders. This
// light shell is the only file the generic pages import.
const RichTextEditorContent = lazy(() =>
  import('./RichTextEditorContent').then((module) => ({
    default: module.RichTextEditorContent,
  })),
);

export type RichTextEditorProps = {
  // Injected by FormItem's controller clone — HTML string form value.
  value?: string | null;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  uploadAdapter?: RichTextImageUploadAdapter;
};

export const RichTextEditor = (props: RichTextEditorProps) => (
  <Suspense fallback={<Skeleton.Input active block style={{ height: 240 }} />}>
    <RichTextEditorContent {...props} />
  </Suspense>
);
