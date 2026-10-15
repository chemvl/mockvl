import { LogoutOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import React from 'react';
import { useAdminStore } from '@/refine/adminStore';
import { adminLogout } from '@/refine/authProvider';
import HeaderDropdown from '../HeaderDropdown';

export type GlobalHeaderRightProps = {
  children?: React.ReactNode;
};

export const AvatarDropdown: React.FC<GlobalHeaderRightProps> = ({
  children,
}) => {
  const identity = useAdminStore((s) => s.identity);

  const onMenuClick: MenuProps['onClick'] = (event) => {
    if (event.key === 'logout') {
      void adminLogout();
    }
  };

  if (!identity) {
    return <Spin size="small" />;
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
    },
  ];

  return (
    <HeaderDropdown
      placement="bottomRight"
      menu={{
        selectedKeys: [],
        onClick: onMenuClick,
        items: menuItems,
      }}
      arrow
    >
      {children}
    </HeaderDropdown>
  );
};
