import { SearchOutlined } from '@ant-design/icons';
import { useDebounceFn } from 'ahooks';
import type { InputProps } from 'antd';
import { Input } from 'antd';
import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';

const DEFAULT_DELAY = 300;

export type DebounceInputProps = Omit<InputProps, 'value' | 'onChange'> & {
  value?: string;
  onChange: (value: string) => void;
  delay?: number;
};

/**
 * Controlled text input that debounces `onChange` while keeping the visible
 * value snappy. Intended for table filter search boxes so typing does not fire
 * an API request / re-filter on every keystroke. Clearing (empty value) emits
 * immediately so the list resets without the debounce delay.
 */
export function DebounceInput({
  value = '',
  onChange,
  delay = DEFAULT_DELAY,
  prefix,
  ...rest
}: DebounceInputProps) {
  const [innerValue, setInnerValue] = useState(value);

  useEffect(() => {
    setInnerValue(value);
  }, [value]);

  const { run: emitDebounced, cancel } = useDebounceFn(
    (next: string) => onChange(next),
    { wait: delay },
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setInnerValue(next);

    if (next === '') {
      cancel();
      onChange('');
      return;
    }

    emitDebounced(next);
  };

  return (
    <Input
      {...rest}
      value={innerValue}
      onChange={handleChange}
      prefix={prefix === undefined ? <SearchOutlined /> : prefix}
    />
  );
}
