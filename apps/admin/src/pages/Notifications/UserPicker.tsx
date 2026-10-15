import { Select } from 'antd';
import { useIntl } from 'react-intl';
import { useUserSearch } from './hooks/useUserSearch';
import type { UserOption } from './types';

type UserPickerProps = {
  value?: UserOption[];
  onChange?: (value: UserOption[]) => void;
  mode?: 'multiple' | 'single';
  placeholder?: string;
};

// Debounced email search select. labelInValue keeps selected emails rendered
// after the search text (and therefore the options list) changes.
export function UserPicker({
  value,
  onChange,
  mode = 'multiple',
  placeholder,
}: UserPickerProps) {
  const { formatMessage } = useIntl();
  const { options, loading, onSearch } = useUserSearch();

  return (
    <Select
      mode={mode === 'multiple' ? 'multiple' : undefined}
      labelInValue
      showSearch
      value={value}
      onChange={(next) => {
        const list = Array.isArray(next) ? next : next ? [next] : [];
        onChange?.(list as UserOption[]);
      }}
      onSearch={onSearch}
      filterOption={false}
      options={options}
      loading={loading}
      allowClear
      style={{ width: '100%' }}
      placeholder={
        placeholder ??
        formatMessage({
          id: 'notifications.userPicker.placeholder',
          defaultMessage: 'Search users by email',
        })
      }
    />
  );
}
