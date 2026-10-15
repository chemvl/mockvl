import { render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { RichTextToolbar } from '../RichTextToolbar';

// react-intl ships ESM-only, which ts-jest's CommonJS pipeline cannot load;
// the stub renders defaultMessage with naive {token} interpolation.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      descriptor: { defaultMessage: string },
      values?: Record<string, unknown>,
    ) =>
      descriptor.defaultMessage.replace(/\{(\w+)\}/g, (_, key) =>
        String(values?.[key] ?? ''),
      ),
  }),
}));
// jsdom cannot mount ProseMirror; the stub runs the selector synchronously
// against whatever editor snapshot the test provides, like useEditorState
// does on render.
jest.mock('@tiptap/react', () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (context: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

// A destroyed tiptap editor: destroy() nulls commandManager, so can() throws
// the production TypeError, while isActive/getAttributes keep working off the
// cached editor state.
const destroyedEditor = {
  isDestroyed: true,
  isActive: () => false,
  getAttributes: () => ({}),
  can: () => {
    throw new TypeError("Cannot read properties of null (reading 'can')");
  },
} as unknown as Editor;

const renderToolbar = (editor: Editor) =>
  render(
    <RichTextToolbar
      editor={editor}
      mode="wysiwyg"
      onModeChange={jest.fn()}
      uploadAdapter={{}}
    />,
  );

describe('RichTextToolbar with a destroyed editor snapshot', () => {
  test('renders instead of crashing when the snapshot editor is destroyed', () => {
    // @tiptap/react's scheduleDestroy() can destroy the instance between a
    // commit and its effects; useEditorState's snapshot then still holds the
    // destroyed instance during the next render.
    expect(() => renderToolbar(destroyedEditor)).not.toThrow();
    expect(screen.getByText('Visual')).toBeTruthy();
  });

  test('renders when the snapshot editor is null', () => {
    expect(() => renderToolbar(null as unknown as Editor)).not.toThrow();
  });
});
