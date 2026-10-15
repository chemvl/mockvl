import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

import { createRoot } from 'react-dom/client';
import { DictionaryLoader } from '@/app/DictionaryLoader';
import { AppRouter } from '@/app/router';
import { queryClient } from '@/queryClient';
import { AppIntlProvider } from '@/store';
import '@/global.less';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

// No <StrictMode>: Refine v5 always consumes React Query's abort signal, so
// StrictMode's dev-only double mount cancels + refires every query — each page
// visit showed a (canceled) duplicate of every data request in the network tab.
createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <ConfigProvider
      locale={enUS}
      theme={{ token: { fontFamily: 'AlibabaSans, sans-serif' } }}
    >
      <AntdApp>
        <AppIntlProvider>
          <DictionaryLoader />
          <AppRouter />
        </AppIntlProvider>
      </AntdApp>
    </ConfigProvider>
  </QueryClientProvider>,
);
