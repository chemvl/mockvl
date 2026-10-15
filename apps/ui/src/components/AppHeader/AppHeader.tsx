import { Link, useLocation, useNavigate } from "react-router";
import { Tabs } from "@/components/ds";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher/WorkspaceSwitcher";
import { brand } from "@/config/brand";
import { useLogout } from "@/features/auth/use-logout";
import { canManageWorkspace } from "@/features/workspaces/permissions";
import type { Workspace } from "@/lib/api/types";
import { formatInitials } from "@/lib/format";
import styles from "./AppHeader.module.scss";
import { HeaderDropdown, HeaderMenuItem } from "./HeaderDropdown";
import { ThemeSwitch } from "./ThemeSwitch";

type NavValue = "resources" | "members" | "usage" | "access-tokens" | "settings";

const SECTIONS = ["members", "usage", "access-tokens", "settings"] as const satisfies readonly NavValue[];

const NAV_ITEMS = [
  { value: "resources", label: "Resources" },
  { value: "members", label: "Members" },
  { value: "usage", label: "Usage" },
  { value: "access-tokens", label: "Access tokens" },
] as const satisfies ReadonlyArray<{ value: NavValue; label: string }>;

const NAV_ITEMS_WITH_SETTINGS = [...NAV_ITEMS, { value: "settings", label: "Settings" }] as const;

function navFor(pathname: string, slug: string): NavValue {
  return SECTIONS.find((section) => pathname === `/${slug}/${section}`) ?? "resources";
}

type AppHeaderProps = {
  workspaces: Workspace[];
  current: Workspace | null;
  status: "pending" | "error" | "success";
  onRetry: () => void;
  email: string | null;
};

export function AppHeader({ workspaces, current, status, onRetry, email }: AppHeaderProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const logout = useLogout();

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <Link to="/" className={styles.logo} aria-label={brand.name}>
          {"{ }"}
        </Link>
        <WorkspaceSwitcher workspaces={workspaces} current={current} status={status} onRetry={onRetry} />
        {current && (
          <Tabs
            items={canManageWorkspace(current.role) ? NAV_ITEMS_WITH_SETTINGS : NAV_ITEMS}
            value={navFor(pathname, current.slug)}
            onChange={(value) => navigate(value === "resources" ? `/${current.slug}` : `/${current.slug}/${value}`)}
            style={{ flexWrap: "nowrap" }}
          />
        )}
      </div>
      <div className={styles.right}>
        <ThemeSwitch />
        {email && <span className={styles.email}>{email}</span>}
        <HeaderDropdown
          align="end"
          ariaLabel="Account"
          buttonClassName={styles.avatar}
          label={email ? formatInitials(email) : ""}
        >
          {(close) => (
            <HeaderMenuItem
              onSelect={() => {
                close();
                void logout();
              }}
            >
              Sign out
            </HeaderMenuItem>
          )}
        </HeaderDropdown>
      </div>
    </header>
  );
}
