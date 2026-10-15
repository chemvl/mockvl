import { PictureOutlined } from '@ant-design/icons';
import type { ResourceField } from '@starter/schemas';
import { Avatar, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type React from 'react';
import { htmlToExcerpt } from '@/components/RichTextEditor/richTextHtml';

const EMPTY = '—';

// Cell renderer per field type for the generic list. List rows carry only the
// raw relation id; the caller resolves it to a display value (see
// useRelationLookups) and passes it as `relationLabel` — absent that, the cell
// falls back to the raw id so a failed lookup never breaks the table.
export function renderFieldCell(
  field: ResourceField,
  value: unknown,
  relationLabel?: string,
): React.ReactNode {
  if (value == null) return EMPTY;

  switch (field.type) {
    case 'date':
      return dayjs(String(value)).format('YYYY-MM-DD HH:mm');
    case 'boolean':
      return (
        <Tag color={value ? 'green' : 'default'}>
          {value ? 'true' : 'false'}
        </Tag>
      );
    case 'enum':
      return <Tag>{String(value)}</Tag>;
    case 'relation':
      return relationLabel != null ? (
        relationLabel
      ) : (
        <Typography.Text code>{String(value)}</Typography.Text>
      );
    case 'richtext':
      // Never render stored HTML into the table — plain-text excerpt only.
      return htmlToExcerpt(String(value));
    case 'image':
      // Broken URLs fall back to the icon via antd's img error handling.
      return (
        <Avatar
          shape="square"
          size="small"
          src={String(value)}
          icon={<PictureOutlined />}
          alt={field.label}
        />
      );
    default:
      return String(value);
  }
}
