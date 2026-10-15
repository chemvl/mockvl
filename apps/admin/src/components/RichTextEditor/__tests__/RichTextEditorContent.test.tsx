import { fireEvent, render, screen } from '@testing-library/react';
import { RichTextEditorContent } from '../RichTextEditorContent';

// The real editor is not mounted in jsdom (ProseMirror needs Range/clipboard
// APIs jsdom lacks). The stub verifies the component's own contract: mode
// switching syncs content both directions and empty documents emit ''.
const mockSetContent = jest.fn();
const mockSetEditable = jest.fn();
let mockCurrentHtml = '';
let mockIsDestroyed = false;
let mockCapturedOptions: Record<string, any> = {};

const mockChain: any = new Proxy(() => mockChain, {
  get: () => () => mockChain,
  apply: () => mockChain,
});

const mockEditor = {
  // Destroyed tiptap editors null out editor.schema, so getHTML() throws
  // exactly the production TypeError instead of returning stale HTML.
  getHTML: () => {
    if (mockIsDestroyed) {
      throw new TypeError("Cannot read properties of null (reading 'cached')");
    }
    return mockCurrentHtml;
  },
  get isDestroyed() {
    return mockIsDestroyed;
  },
  commands: {
    setContent: (...args: unknown[]) => mockSetContent(...args),
  },
  setEditable: (...args: unknown[]) => mockSetEditable(...args),
  isActive: () => false,
  can: () => ({ undo: () => false, redo: () => false }),
  getAttributes: () => ({}),
  chain: () => mockChain,
};

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
jest.mock('lowlight', () => ({ createLowlight: () => ({}) }));
jest.mock('@tiptap/react', () => ({
  useEditor: (options: Record<string, any>) => {
    mockCapturedOptions = options;
    return mockEditor;
  },
  useEditorState: ({ editor, selector }: any) => selector({ editor }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

type Props = React.ComponentProps<typeof RichTextEditorContent>;

const renderEditor = (props: Props) =>
  render(<RichTextEditorContent {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentHtml = '';
  mockIsDestroyed = false;
  mockCapturedOptions = {};
});

describe('RichTextEditorContent mode toggle', () => {
  test('source mode shows the current form value in a textarea', () => {
    mockCurrentHtml = '<p>hello</p>';
    renderEditor({ value: '<p>hello</p>', onChange: jest.fn() });

    fireEvent.click(screen.getByText('HTML'));

    expect(screen.getByRole('textbox')).toHaveProperty('value', '<p>hello</p>');
    expect(screen.queryByTestId('editor-content')).toBeNull();
  });

  test('typing raw HTML in source mode pushes it straight to onChange', () => {
    mockCurrentHtml = '<p>hello</p>';
    const onChange = jest.fn();
    renderEditor({ value: '<p>hello</p>', onChange });

    fireEvent.click(screen.getByText('HTML'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '<p>edited</p>' },
    });

    expect(onChange).toHaveBeenCalledWith('<p>edited</p>');
  });

  test('returning to visual mode re-parses the source and canonicalizes', () => {
    mockCurrentHtml = '<p>hello</p>';
    const onChange = jest.fn();
    const { rerender } = renderEditor({ value: '<p>hello</p>', onChange });

    fireEvent.click(screen.getByText('HTML'));
    // Parent (react-hook-form) holds the edited source now.
    rerender(
      <RichTextEditorContent value="<p>edited</p" onChange={onChange} />,
    );
    // tiptap would parse the malformed source into canonical HTML.
    mockCurrentHtml = '<p>edited</p>';
    fireEvent.click(screen.getByText('Visual'));

    expect(mockSetContent).toHaveBeenCalledWith('<p>edited</p', {
      emitUpdate: false,
    });
    expect(onChange).toHaveBeenLastCalledWith('<p>edited</p>');
  });

  test('empty documents emit the empty string, not <p></p>', () => {
    const onChange = jest.fn();
    renderEditor({ value: '', onChange });

    mockCapturedOptions.onUpdate({
      editor: { getHTML: () => '<p></p>' },
    });

    expect(onChange).toHaveBeenCalledWith('');
  });

  test('external form resets replace the editor content without emitting', () => {
    mockCurrentHtml = '<p>old</p>';
    const { rerender } = renderEditor({ value: '<p>old</p>' });

    // RHF reset() after the edit record loads.
    rerender(<RichTextEditorContent value="<p>loaded</p>" />);

    expect(mockSetContent).toHaveBeenCalledWith('<p>loaded</p>', {
      emitUpdate: false,
    });
  });

  test('effects skip a destroyed editor instance instead of crashing', () => {
    mockCurrentHtml = '<p>old</p>';
    const { rerender } = renderEditor({ value: '<p>old</p>' });
    mockSetContent.mockClear();
    mockSetEditable.mockClear();

    // @tiptap/react's scheduleDestroy() can destroy the instance in the gap
    // between a commit and its effects (lazy/Suspense delays the mount
    // effect past the 1ms destruction timer).
    mockIsDestroyed = true;

    expect(() =>
      rerender(<RichTextEditorContent value="<p>new</p>" disabled />),
    ).not.toThrow();
    expect(mockSetContent).not.toHaveBeenCalled();
    expect(mockSetEditable).not.toHaveBeenCalled();
  });

  test('disabled state is forwarded to the editor', () => {
    renderEditor({ value: '', disabled: true });

    expect(mockSetEditable).toHaveBeenCalledWith(false);
  });
});
