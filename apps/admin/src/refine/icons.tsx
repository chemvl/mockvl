import * as AntIcons from '@ant-design/icons';
import type React from 'react';

// Namespace lookup so the backend can name any antd icon without a frontend
// deploy (the meta payload carries icon names as strings). Tradeoff: this
// keeps every outline icon in the bundle. If bundle size ever matters more
// than backend flexibility, replace with a curated map:
//   const ICONS = { FileTextOutlined: <FileTextOutlined />, ... } as const;
export function resolveAdminIcon(name?: string): React.ReactNode {
  if (name && /^[A-Z]/.test(name)) {
    const candidate = (AntIcons as Record<string, unknown>)[name];
    // antd icons are forwardRef components (objects), not plain functions.
    if (
      typeof candidate === 'function' ||
      (typeof candidate === 'object' && candidate !== null)
    ) {
      const Icon = candidate as React.ComponentType;
      return <Icon />;
    }
  }
  return <AntIcons.TableOutlined />;
}
