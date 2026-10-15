import type { ReactNode } from 'react';
import React from 'react';
import type { IntlConfig } from 'react-intl';
import { IntlProvider, ReactIntlErrorCode } from 'react-intl';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './useAppStore';

interface AppIntlProviderProps {
  children: ReactNode;
}

// react-intl v10's IntlProvider types have a complex conditional shape under
// TypeScript 6 that makes direct JSX usage produce false-positive errors. Cast
// to a plain interface that matches the actual runtime props so the rest of the
// file compiles cleanly. The runtime behaviour is correct.
const StableIntlProvider = IntlProvider as React.ComponentType<{
  locale: string;
  messages: Record<string, string>;
  defaultLocale?: string;
  onError?: IntlConfig['onError'];
  children?: ReactNode;
}>;

// Missing-key warnings are handled by the defaultMessage prop at each call
// site (Pro already passes defaultMessage everywhere). Suppress the noise
// without losing the fallback chain:
//   API value → defaultLang → inline defaultMessage → raw key string
const handleIntlError: IntlConfig['onError'] = (err: { code: string }) => {
  if (err.code === ReactIntlErrorCode.MISSING_TRANSLATION) return;
};

// Bridges the Zustand AppStore ↔ react-intl.
// Phase 2: file exists but is NOT yet mounted in the app tree.
// Phase 3: mount inside the root layout (RouterProvider or App component).
export function AppIntlProvider({ children }: AppIntlProviderProps) {
  const { locale, messages } = useAppStore(
    useShallow((s) => ({ locale: s.locale, messages: s.messages })),
  );

  return (
    <StableIntlProvider
      locale={locale}
      messages={messages}
      defaultLocale="en-US"
      onError={handleIntlError}
    >
      {children}
    </StableIntlProvider>
  );
}
