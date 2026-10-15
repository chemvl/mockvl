import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import type { MenuRoute } from '@/app/menuConfig';
import { useAdminStore } from './adminStore';
import { resolveAdminIcon } from './icons';

// Sidebar group for registered admin resources. Names and icons are
// pre-resolved to final values here because BasicLayout appends this AFTER
// its resolveIcons/filterByAccess pipeline — these entries must not depend on
// ICON_MAP or intl message ids, and they bypass the legacy-realm access filter
// (visibility is driven by the role-filtered meta endpoint instead).
export function useAdminResourceMenu(): MenuRoute[] {
  const resources = useAdminStore((s) => s.resources);
  const identity = useAdminStore((s) => s.identity);
  const intl = useIntl();

  return useMemo(() => {
    // Custom consoles (not registry resources) that every admin role can at
    // least read; the pages themselves hide mutations from viewers.
    const consoleEntries: MenuRoute[] = identity
      ? [
          {
            path: '/notifications',
            name: intl.formatMessage({
              id: 'menu.notifications',
              defaultMessage: 'Push Notifications',
            }),
            icon: resolveAdminIcon('BellOutlined'),
          },
        ]
      : [];
    if (resources.length === 0) return consoleEntries;
    return [
      ...consoleEntries,
      ...resources.map((resource) => ({
        path: `/resources/${resource.name}`,
        name: resource.label,
        icon: resolveAdminIcon(resource.icon),
      })),
    ];
    // return [
    //   {
    //     path: '/resources',
    //     name: intl.formatMessage({
    //       id: 'menu.resources',
    //       defaultMessage: 'Resources',
    //     }),
    //     icon: resolveAdminIcon('DatabaseOutlined'),
    //     routes: resources.map((resource) => ({
    //       path: `/resources/${resource.name}`,
    //       name: resource.label,
    //       icon: resolveAdminIcon(resource.icon),
    //     })),
    //   },
    // ];
  }, [resources, identity, intl]);
}
