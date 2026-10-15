import type { ReactNode } from "react";
import { setThemePreference, type ThemePreference, useThemePreference } from "@/features/theme/theme-store";
import styles from "./AppHeader.module.scss";

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const OPTIONS = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }>;

export function ThemeSwitch() {
  const preference = useThemePreference();

  return (
    <fieldset aria-label="Theme" className={styles.theme}>
      {OPTIONS.map((option) => {
        const active = option.value === preference;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={`${option.label} theme`}
            aria-pressed={active}
            title={option.label}
            className={`${styles.themeOption} ${active ? styles.themeOptionActive : ""}`}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
          </button>
        );
      })}
    </fieldset>
  );
}
