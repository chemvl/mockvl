import type { NotificationProvider } from '@refinedev/core';
import { getMessageApi } from '@/lib/messageRef';

// Mutation toasts for the headless useForm/useDelete hooks, routed through the
// app's existing antd message instance (registered by BasicLayout). 'progress'
// belongs to Refine's undoable mutation mode, which we don't use — ignore it.
// Refine puts the human-readable cause in `description` (e.g. the API error
// message) and a generic summary in `message`.
export const notificationProvider: NotificationProvider = {
  open: ({ key, message, description, type }) => {
    const api = getMessageApi();
    if (!api || type === 'progress') return;
    // Refine's generic success descriptions ("Success") add nothing; error
    // descriptions carry the actual API message and are worth appending.
    const detail =
      description && description !== 'Success' ? `: ${description}` : '';
    api.open({ key, type, content: `${message}${detail}` });
  },
  close: (key: string) => {
    getMessageApi()?.destroy(key);
  },
};
