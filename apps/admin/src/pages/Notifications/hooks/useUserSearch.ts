import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toUserOptions, userSearchQueryOptions } from '../service';

const SEARCH_DEBOUNCE_MS = 300;

// Debounced email search over the admin users resource, shaped for a
// labelInValue antd Select.
export function useUserSearch() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const { data, isFetching } = useQuery(userSearchQueryOptions(debounced));

  return {
    options: toUserOptions(data),
    loading: isFetching,
    onSearch: setSearch,
  };
}
