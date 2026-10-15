import { getMessageApi } from './messageRef';

export function showToast(text: string): void {
  const api = getMessageApi();
  if (api) {
    api.error(text);
  } else {
    // fallback: interceptor fired before BasicLayout mounted (very early errors)
    console.warn('[interceptor] toast before message API ready:', text);
  }
}
