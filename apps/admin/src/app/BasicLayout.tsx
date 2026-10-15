import {
  BellOutlined,
  CrownOutlined,
  DashboardOutlined,
  DesktopOutlined,
  FolderOpenOutlined,
  ScheduleOutlined,
  SearchOutlined,
  SettingOutlined,
  TableOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';
import { ProLayout } from '@ant-design/pro-components';
import { IconDeviceTvFilled } from '@tabler/icons-react';
import { App } from 'antd';
import React, { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import defaultSettings from '@/app/defaultSettings';
import { AvatarDropdown } from '@/components';
import { AvatarName } from '@/components/RightContent/AvatarName';
import { SwitchTheme } from '@/components/RightContent/SwitchTheme';
import { setMessageApi } from '@/lib/messageRef';
import { useAdminStore } from '@/refine/adminStore';
import { useAdminResourceMenu } from '@/refine/menu';
import { selectAccess, useAppStore, useUserStore } from '@/store';
import { type MenuRoute, menuRoutes } from './menuConfig';

const ICON_MAP: Record<string, React.ReactNode> = {
  UsergroupAddOutlined: <UsergroupAddOutlined />,
  dashboard: <DashboardOutlined />,
  desktop: <DesktopOutlined />,
  table: <TableOutlined />,
  search: <SearchOutlined />,
  crown: <CrownOutlined />,
  FolderOpenOutlined: <FolderOpenOutlined />,
  ScheduleOutlined: <ScheduleOutlined />,
  BellOutlined: <BellOutlined />,
  SettingOutlined: <SettingOutlined />,
  IconDeviceTvFilled: <IconDeviceTvFilled />,
};

function resolveIcons(
  routes: MenuRoute[],
  intl: ReturnType<typeof useIntl>,
): MenuRoute[] {
  return routes.map((r) => ({
    ...r,
    icon: typeof r.icon === 'string' ? (ICON_MAP[r.icon] ?? r.icon) : r.icon,
    name:
      typeof r.name === 'string'
        ? (intl.formatMessage({ id: r.name }) ?? r.name)
        : r.name,
    routes: r.routes ? resolveIcons(r.routes, intl) : undefined,
  }));
}

function filterByAccess(routes: MenuRoute[], canAdmin: boolean): MenuRoute[] {
  return routes
    .filter((r) => !r.access || (r.access === 'canAdmin' && canAdmin))
    .map((r) =>
      r.routes ? { ...r, routes: filterByAccess(r.routes, canAdmin) } : r,
    );
}

export default function BasicLayout() {
  const { message } = App.useApp();
  useEffect(() => {
    setMessageApi(message);
  }, [message]);

  const navigate = useNavigate();
  const location = useLocation();

  const identity = useAdminStore((s) => s.identity);
  const { collapsed, setCollapsed, settings } = useAppStore(
    useShallow((s) => ({
      collapsed: s.collapsed,
      setCollapsed: s.setCollapsed,
      settings: s.settings,
    })),
  );

  const canAdmin = useUserStore((s) => selectAccess(s).canAdmin);
  const intl = useIntl();

  // Admin-realm resource menu (names/icons pre-resolved) is appended after
  // the pipeline: it must bypass filterByAccess (legacy realm) and resolveIcons.
  const resourceMenu = useAdminResourceMenu();
  const filteredRoutes = useMemo(
    () => [
      ...resolveIcons(filterByAccess(menuRoutes, canAdmin), intl),
      ...resourceMenu,
    ],
    [canAdmin, intl, resourceMenu],
  );

  return (
    <ProLayout
      {...defaultSettings}
      {...settings}
      collapsed={collapsed}
      onCollapse={setCollapsed}
      location={{ pathname: location.pathname }}
      onMenuHeaderClick={() => navigate('/')}
      actionsRender={() => [<SwitchTheme key="switch-theme" />]}
      avatarProps={
        identity
          ? {
              src: identity.avatarUrl ?? undefined,
              title: <AvatarName />,
              children: identity.name
                ? identity.name[0].toUpperCase()
                : undefined,
              render: (_, avatarChildren) => {
                return <AvatarDropdown>{avatarChildren}</AvatarDropdown>;
              },
            }
          : undefined
      }
      menuItemRender={(item, dom) => <Link to={item.path || '/'}>{dom}</Link>}
      route={{ routes: filteredRoutes }}
    >
      <Outlet />
    </ProLayout>
  );
}
