import type { ProLayoutProps } from '@ant-design/pro-components';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import Settings from '@/app/defaultSettings';
import storage from '@/lib/storage';
import defaultErrors from './defaultErrors';
import defaultLang from './defaultLang';

type AppSettings = ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
};

type Language = { id: string; name: string };

type AppState = {
  // ── Locale layer ────────────────────────────────────────────────────────────
  locale: string;
  languages: Language[];
  setLanguages: (languages: Language[]) => void;
  apiMessages: Record<string, string>;
  // Derived: { ...defaultLang, ...apiMessages }. Recomputed inside actions,
  // not as a selector — gives IntlProvider a stable reference per change.
  messages: Record<string, string>;
  setLocale: (locale: string) => void;
  // Called by <DictionaryLoader> when its TanStack Query result resolves.
  setApiMessages: (apiMessages: Record<string, string>) => void;

  // ── Error code layer (parallel to locale layer) ──────────────────────────
  apiErrors: Record<string, string>;
  // Derived: { ...defaultErrors, ...apiErrors }. Used by response interceptor.
  errors: Record<string, string>;
  setApiErrors: (apiErrors: Record<string, string>) => void;

  // ── ProLayout settings (mirrors config/defaultSettings.ts + SettingDrawer) ─
  settings: Partial<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => void;

  // ── UI chrome ───────────────────────────────────────────────────────────────
  settingDrawerOpen: boolean;
  setSettingDrawerOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

// Default ProLayout settings mirror config/defaultSettings.ts,
// with navTheme restored from storage so the choice survives reloads.
const storedNavTheme = storage.getItem('navTheme');
const defaultProSettings: Partial<AppSettings> =
  storedNavTheme === 'light' || storedNavTheme === 'realDark'
    ? { ...Settings, navTheme: storedNavTheme }
    : Settings;

// Initial locale from config/config.ts locale.default
// The Umi config uses 'en-US' as the default locale.
const INITIAL_LOCALE = 'en-US';

export const useAppStore = create<AppState>()(
  devtools(
    (set) => ({
      locale: INITIAL_LOCALE,
      languages: [],
      setLanguages: (languages) => set({ languages }, false, 'setLanguages'),
      apiMessages: {},
      messages: { ...defaultLang },

      setLocale: (locale) =>
        set(
          {
            locale,
            // Clear both API layers when switching locale; DictionaryLoader will repopulate.
            apiMessages: {},
            messages: { ...defaultLang },
            apiErrors: {},
            errors: { ...defaultErrors },
          },
          false,
          'setLocale',
        ),

      setApiMessages: (apiMessages) =>
        set(
          { apiMessages, messages: { ...defaultLang, ...apiMessages } },
          false,
          'setApiMessages',
        ),

      apiErrors: {},
      errors: { ...defaultErrors },

      setApiErrors: (apiErrors) =>
        set(
          { apiErrors, errors: { ...defaultErrors, ...apiErrors } },
          false,
          'setApiErrors',
        ),

      settings: defaultProSettings,
      setSettings: (settings) =>
        set(
          (s) => ({ settings: { ...s.settings, ...settings } }),
          false,
          'setSettings',
        ),

      settingDrawerOpen: false,
      setSettingDrawerOpen: (open) =>
        set({ settingDrawerOpen: open }, false, 'setSettingDrawerOpen'),

      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }, false, 'setCollapsed'),
    }),
    { name: 'AppStore' },
  ),
);
