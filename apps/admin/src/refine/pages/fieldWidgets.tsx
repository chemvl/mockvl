import { type BaseKey, useSelect } from '@refinedev/core';
import type { ResourceField } from '@starter/schemas';
import { DatePicker, Input, InputNumber, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { RichTextEditor } from '@/components/RichTextEditor/RichTextEditor';
import { ImageUrlInput } from './ImageUrlInput';

// FormItem clones its child and injects react-hook-form's controller props
// (value/onChange/onBlur/…), so every widget must spread `rest` onto the
// actual antd input. `any` because each widget narrows the value type itself.
type InjectedProps = Record<string, any> & { value?: any };

type FieldWidgetProps = InjectedProps & {
  field: ResourceField;
  disabled?: boolean;
};

export function FieldWidget({ field, disabled, ...rest }: FieldWidgetProps) {
  switch (field.type) {
    case 'string':
      return <Input disabled={disabled} {...rest} />;
    case 'text':
      return <Input.TextArea rows={6} disabled={disabled} {...rest} />;
    case 'richtext':
      // Lazy-loaded tiptap editor; holds an HTML string as its form value.
      return <RichTextEditor disabled={disabled} {...rest} />;
    case 'image':
      // URL input with a small preview underneath.
      return <ImageUrlInput disabled={disabled} {...rest} />;
    case 'number':
      return (
        <InputNumber style={{ width: '100%' }} disabled={disabled} {...rest} />
      );
    case 'boolean':
      return <Switch disabled={disabled} {...rest} />;
    case 'enum':
      return (
        <Select
          options={field.options.map((option) => ({
            label: option,
            value: option,
          }))}
          allowClear={!field.required}
          disabled={disabled}
          {...rest}
        />
      );
    case 'date':
      return (
        <DatePicker
          showTime
          style={{ width: '100%' }}
          disabled={disabled}
          {...rest}
          // Refine's RHF adapter populates edit forms with the raw record, so
          // the value can arrive as an ISO string — antd's picker only takes
          // Dayjs. Placed after the spread so the normalized value wins.
          value={toDayjsValue(rest.value)}
        />
      );
    case 'relation':
      return <RelationSelect field={field} disabled={disabled} {...rest} />;
  }
}

function toDayjsValue(value: unknown) {
  if (value == null || value === '') return null;
  return dayjs.isDayjs(value) ? value : dayjs(value as string | number | Date);
}

type RelationSelectProps = InjectedProps & {
  field: Extract<ResourceField, { type: 'relation' }>;
  disabled?: boolean;
};

// Server-searched select over the related resource. `defaultValue` makes
// useSelect fetch the currently-selected record via getMany so an edit form
// shows its display value even when it falls outside the first options page.
function RelationSelect({ field, disabled, ...rest }: RelationSelectProps) {
  const { options, onSearch, query } = useSelect({
    resource: field.resource,
    optionLabel: (item) =>
      String(
        (item as unknown as Record<string, unknown>)[field.displayField] ??
          item.id,
      ),
    optionValue: 'id',
    // A nullable relation arrives as null on edit forms; useSelect treats any
    // non-undefined defaultValue as an id to fetch, and a null id blows up in
    // the query-string serializer. Normalize to "no default".
    defaultValue: (rest.value ?? undefined) as BaseKey | undefined,
    onSearch: (value) =>
      value ? [{ field: field.displayField, operator: 'contains', value }] : [],
  });

  return (
    <Select
      showSearch
      filterOption={false}
      onSearch={onSearch}
      options={options}
      loading={query.isFetching}
      allowClear={!field.required}
      disabled={disabled}
      {...rest}
    />
  );
}
