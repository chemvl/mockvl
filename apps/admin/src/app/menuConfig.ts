import type React from 'react';

// Menu config for the migrated pages. Mirrors config/routes.ts for the
// routes that are wired in router.tsx. Non-migrated routes (form, profile,
// result, account, chatbot) are intentionally excluded until phase 5.
export type MenuRoute = {
  path: string;
  name: string;
  icon?: React.ReactNode;
  access?: string;
  routes?: MenuRoute[];
};

// Legacy pages are intentionally
// delisted: the app presents as the Refine admin, whose "Resources" menu
// group comes from useAdminResourceMenu. The page code and routes remain in
// router.tsx (URL-reachable); restore entries from git history as pages get
// migrated to the admin API.
export const menuRoutes: MenuRoute[] = [];
