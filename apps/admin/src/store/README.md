# `src/store` — Zustand stores and translation layer

## Dictionary architecture

Two parallel dictionaries share the same fetch-store-merge pattern.

### Translations (UI strings)

```
API value  →  defaultLang value  →  inline defaultMessage  →  raw key string
   ▲              ▲                       ▲
   │              │                       └── passed at call site:
   │              │                           intl.formatMessage({ id, defaultMessage })
   │              └── src/store/defaultLang.ts (static, 137 zh-CN keys)
   └── apiMessages in useAppStore (runtime, pushed by <DictionaryLoader> via setApiMessages)
```

`messages` = `{ ...defaultLang, ...apiMessages }`. `AppIntlProvider` feeds that into `react-intl`.

### Error codes (response interceptor strings)

```
API value  →  defaultErrors value  →  fallback string
   ▲              ▲
   │              └── src/store/defaultErrors.ts (static, initially empty)
   └── apiErrors in useAppStore (runtime, pushed by <DictionaryLoader> via setApiErrors)
```

`errors` = `{ ...defaultErrors, ...apiErrors }`. The response interceptor in `src/queryClient.ts`
reads this map outside React via `useAppStore.getState().errors`.

### Translating in components

```tsx
// Function form
const intl = useIntl();
intl.formatMessage({ id: 'user.welcome', defaultMessage: 'Welcome' });
intl.formatMessage({ id: 'user.greet', defaultMessage: 'Hi {name}' }, { name: 'Alice' });

// Component form
<FormattedMessage id="user.welcome" defaultMessage="Welcome" />
```

ICU placeholders, plurals, and `<FormattedNumber>` / `<FormattedDate>` all work because we kept `react-intl`.

### Translating outside React (interceptors, store actions, etc.)

Use the store directly:

```ts
import { useAppStore } from '@/store';
const msg = useAppStore.getState().messages['error.network'] ?? 'Network error';
```

### Looking up an error message outside React

```ts
import { useAppStore } from '@/store';
const text = useAppStore.getState().errors[code] ?? 'Unknown error';
```

### Refreshing dictionaries from the API

Both dictionaries are loaded by `<DictionaryLoader>` via TanStack Query.
To force a refetch, invalidate the relevant query key:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { currentUserQueryKey } from '@root/client/@tanstack/react-query.gen';

// Inside a component:
const queryClient = useQueryClient();
queryClient.invalidateQueries({ queryKey: currentUserQueryKey() });
```

### Switching language

```ts
useAppStore.getState().setLocale('en-US');
// setLocale clears both apiMessages and apiErrors — DictionaryLoader refetches on next render.
```

---

## Store patterns: `useModel` → Zustand

### Pattern 1 — Reading state

```ts
// Umi
const { currentUser } = useModel('@@initialState').initialState;

// Zustand
const currentUser = useUserStore(s => s.currentUser);
```

### Pattern 2 — Calling an action

```ts
// Umi
const { refresh } = useModel('@@initialState');
await refresh();

// Zustand
const refresh = useUserStore(s => s.refresh);
await refresh();
```

### Pattern 3 — Reading multiple fields (use shallow to avoid re-renders)

```ts
// Umi
const { initialState, setInitialState } = useModel('@@initialState');

// Zustand
import { useShallow } from 'zustand/react/shallow';
const { currentUser, setCurrentUser } = useUserStore(
  useShallow(s => ({ currentUser: s.currentUser, setCurrentUser: s.setCurrentUser })),
);
```

### Pattern 4 — User-defined model with derived data

```ts
// Umi src/models/products.ts
export default function useProductModel() {
  const [list, setList] = useState([]);
  const total = list.length;
  return { list, total, setList };
}

// Zustand src/store/useProductStore.ts
export const useProductStore = create<State>()((set, get) => ({
  list: [],
  setList: (list) => set({ list }),
  // derived values become selectors at call site, not state:
  // const total = useProductStore(s => s.list.length);
}));
```

### Pattern 5 — Cross-store dependencies

`useModel('foo')` from inside another model becomes `useOtherStore.getState()` inside an action, or composition at the component level. Do not call one store's hook from inside another store's setup.

### Naming convention

- File: `useXxxStore.ts`
- Export: `useXxxStore`
- One store per domain. Resist a single mega-store.
