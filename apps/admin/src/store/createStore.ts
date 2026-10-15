import type { StateCreator } from 'zustand';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export function createStore<T>(
  initializer: StateCreator<T, [['zustand/devtools', never]], []>,
) {
  return import.meta.env.DEV
    ? create<T>()(devtools(initializer))
    : create<T>()(initializer as StateCreator<T, [], []>);
}

export type { StateCreator };
export { create };
