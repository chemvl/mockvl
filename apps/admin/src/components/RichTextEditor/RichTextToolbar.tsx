import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBlockquote,
  IconBold,
  IconCode,
  IconHeading,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconPhoto,
  IconStrikethrough,
  IconTable,
} from '@tabler/icons-react';
import { type Editor, useEditorState } from '@tiptap/react';
import { Button, Divider, Dropdown, Flex, Segmented, Tooltip } from 'antd';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { ImageModal } from './ImageModal';
import type { RichTextImageUploadAdapter } from './imageUpload';
import { LinkModal } from './LinkModal';
import type { RichTextEditorMode } from './RichTextEditorContent';

const ICON_SIZE = 16;
const TABLE_SIZE = 3;

type RichTextToolbarProps = {
  editor: Editor;
  mode: RichTextEditorMode;
  onModeChange: (mode: RichTextEditorMode) => void;
  disabled?: boolean;
  uploadAdapter: RichTextImageUploadAdapter;
};

type ToolbarState = {
  isBold: boolean;
  isItalic: boolean;
  isStrike: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isBlockquote: boolean;
  isCodeBlock: boolean;
  isLink: boolean;
  headingLevel: number | undefined;
  inTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  linkHref: string | undefined;
};

const INERT_TOOLBAR_STATE: ToolbarState = {
  isBold: false,
  isItalic: false,
  isStrike: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isCodeBlock: false,
  isLink: false,
  headingLevel: undefined,
  inTable: false,
  canUndo: false,
  canRedo: false,
  linkHref: undefined,
};

type ToolbarButtonProps = {
  title: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

const ToolbarButton = ({
  title,
  icon,
  active,
  disabled,
  onClick,
}: ToolbarButtonProps) => (
  <Tooltip title={title}>
    <Button
      type={active ? 'primary' : 'text'}
      ghost={active}
      size="small"
      icon={icon}
      disabled={disabled}
      onClick={onClick}
    />
  </Tooltip>
);

export const RichTextToolbar = ({
  editor,
  mode,
  onModeChange,
  disabled,
  uploadAdapter,
}: RichTextToolbarProps) => {
  const { formatMessage } = useIntl();
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);

  // A single selector subscription instead of per-button editor listeners.
  const state = useEditorState({
    editor,
    // The snapshot can briefly hold a destroyed instance while @tiptap/react's
    // 1ms scheduleDestroy race replaces the editor (see RichTextEditorContent);
    // destroy() nulls commandManager, so can() would throw. isActive() survives
    // on the cached state, which is why only can() crashes without this guard.
    selector: ({ editor: current }): ToolbarState => {
      if (!current || current.isDestroyed) {
        return INERT_TOOLBAR_STATE;
      }
      return {
        isBold: current.isActive('bold'),
        isItalic: current.isActive('italic'),
        isStrike: current.isActive('strike'),
        isBulletList: current.isActive('bulletList'),
        isOrderedList: current.isActive('orderedList'),
        isBlockquote: current.isActive('blockquote'),
        isCodeBlock: current.isActive('codeBlock'),
        isLink: current.isActive('link'),
        headingLevel: [1, 2, 3].find((level) =>
          current.isActive('heading', { level }),
        ),
        inTable: current.isActive('table'),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        linkHref: current.getAttributes('link').href as string | undefined,
      };
    },
  });

  // Formatting operates on the WYSIWYG document — meaningless in source mode.
  const formattingDisabled = disabled || mode === 'source';

  const headingItems = [
    {
      key: 'paragraph',
      label: formatMessage({
        id: 'richText.toolbar.paragraph',
        defaultMessage: 'Paragraph',
      }),
      onClick: () => editor.chain().focus().setParagraph().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      key: `h${level}`,
      label: formatMessage(
        { id: 'richText.toolbar.heading', defaultMessage: 'Heading {level}' },
        { level },
      ),
      onClick: () => editor.chain().focus().toggleHeading({ level }).run(),
    })),
  ];

  const tableItems = [
    {
      key: 'insert',
      label: formatMessage({
        id: 'richText.toolbar.insertTable',
        defaultMessage: 'Insert table',
      }),
      disabled: state.inTable,
      onClick: () =>
        editor
          .chain()
          .focus()
          .insertTable({
            rows: TABLE_SIZE,
            cols: TABLE_SIZE,
            withHeaderRow: true,
          })
          .run(),
    },
    {
      key: 'addRow',
      label: formatMessage({
        id: 'richText.toolbar.addRowBelow',
        defaultMessage: 'Add row below',
      }),
      disabled: !state.inTable,
      onClick: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      key: 'addColumn',
      label: formatMessage({
        id: 'richText.toolbar.addColumnAfter',
        defaultMessage: 'Add column after',
      }),
      disabled: !state.inTable,
      onClick: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      key: 'deleteRow',
      label: formatMessage({
        id: 'richText.toolbar.deleteRow',
        defaultMessage: 'Delete row',
      }),
      disabled: !state.inTable,
      onClick: () => editor.chain().focus().deleteRow().run(),
    },
    {
      key: 'deleteColumn',
      label: formatMessage({
        id: 'richText.toolbar.deleteColumn',
        defaultMessage: 'Delete column',
      }),
      disabled: !state.inTable,
      onClick: () => editor.chain().focus().deleteColumn().run(),
    },
    {
      key: 'deleteTable',
      label: formatMessage({
        id: 'richText.toolbar.deleteTable',
        defaultMessage: 'Delete table',
      }),
      disabled: !state.inTable,
      danger: true,
      onClick: () => editor.chain().focus().deleteTable().run(),
    },
  ];

  return (
    <Flex gap={2} wrap align="center">
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.bold',
          defaultMessage: 'Bold',
        })}
        icon={<IconBold size={ICON_SIZE} />}
        active={state.isBold}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.italic',
          defaultMessage: 'Italic',
        })}
        icon={<IconItalic size={ICON_SIZE} />}
        active={state.isItalic}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.strike',
          defaultMessage: 'Strikethrough',
        })}
        icon={<IconStrikethrough size={ICON_SIZE} />}
        active={state.isStrike}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <Dropdown
        menu={{ items: headingItems }}
        trigger={['click']}
        disabled={formattingDisabled}
      >
        <Button
          type={state.headingLevel ? 'primary' : 'text'}
          ghost={Boolean(state.headingLevel)}
          size="small"
          icon={<IconHeading size={ICON_SIZE} />}
          disabled={formattingDisabled}
        >
          {state.headingLevel ? `H${state.headingLevel}` : undefined}
        </Button>
      </Dropdown>
      <Divider orientation="vertical" />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.bulletList',
          defaultMessage: 'Bullet list',
        })}
        icon={<IconList size={ICON_SIZE} />}
        active={state.isBulletList}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.orderedList',
          defaultMessage: 'Ordered list',
        })}
        icon={<IconListNumbers size={ICON_SIZE} />}
        active={state.isOrderedList}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.blockquote',
          defaultMessage: 'Blockquote',
        })}
        icon={<IconBlockquote size={ICON_SIZE} />}
        active={state.isBlockquote}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.codeBlock',
          defaultMessage: 'Code block',
        })}
        icon={<IconCode size={ICON_SIZE} />}
        active={state.isCodeBlock}
        disabled={formattingDisabled}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <Divider orientation="vertical" />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.link',
          defaultMessage: 'Link',
        })}
        icon={<IconLink size={ICON_SIZE} />}
        active={state.isLink}
        disabled={formattingDisabled}
        onClick={() => setLinkOpen(true)}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.image',
          defaultMessage: 'Image',
        })}
        icon={<IconPhoto size={ICON_SIZE} />}
        disabled={formattingDisabled}
        onClick={() => setImageOpen(true)}
      />
      <Dropdown
        menu={{ items: tableItems }}
        trigger={['click']}
        disabled={formattingDisabled}
      >
        <Button
          type={state.inTable ? 'primary' : 'text'}
          ghost={state.inTable}
          size="small"
          icon={<IconTable size={ICON_SIZE} />}
          disabled={formattingDisabled}
        />
      </Dropdown>
      <Divider orientation="vertical" />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.undo',
          defaultMessage: 'Undo',
        })}
        icon={<IconArrowBackUp size={ICON_SIZE} />}
        disabled={formattingDisabled || !state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarButton
        title={formatMessage({
          id: 'richText.toolbar.redo',
          defaultMessage: 'Redo',
        })}
        icon={<IconArrowForwardUp size={ICON_SIZE} />}
        disabled={formattingDisabled || !state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <Flex flex={1} justify="flex-end">
        <Segmented
          size="small"
          value={mode}
          disabled={disabled}
          onChange={(next) => onModeChange(next as RichTextEditorMode)}
          options={[
            {
              label: formatMessage({
                id: 'richText.mode.wysiwyg',
                defaultMessage: 'Visual',
              }),
              value: 'wysiwyg',
            },
            {
              label: formatMessage({
                id: 'richText.mode.source',
                defaultMessage: 'HTML',
              }),
              value: 'source',
            },
          ]}
        />
      </Flex>
      <LinkModal
        open={linkOpen}
        initialHref={state.linkHref}
        onCancel={() => setLinkOpen(false)}
        onSubmit={(href) => {
          editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href })
            .run();
          setLinkOpen(false);
        }}
        onRemove={() => {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          setLinkOpen(false);
        }}
      />
      <ImageModal
        open={imageOpen}
        uploadAdapter={uploadAdapter}
        onCancel={() => setImageOpen(false)}
        onSubmit={({ url, alt }) => {
          editor.chain().focus().setImage({ src: url, alt }).run();
          setImageOpen(false);
        }}
      />
    </Flex>
  );
};
