import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from '@refinedev/react-hook-form';
import type { ResourceField, ResourceMeta } from '@starter/schemas';
import { Button, Flex, Form, Spin } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo } from 'react';
import type { FieldValues, Resolver } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { FormItem } from '@/components/Form/FormItem';
import { buildFormSchema } from './fieldSchema';
import { FieldWidget } from './fieldWidgets';

type ResourceFormBodyProps = {
  resourceMeta: ResourceMeta;
  id?: string;
  /** Host (the form drawer) owns dismissal — called on cancel and after save. */
  onClose: () => void;
};

// House convention (user-directed deviation from PLAN's antd-Form): form
// state lives in react-hook-form via @refinedev/react-hook-form; the antd
// <Form> is only a layout/context shell for the FormItem bridge, and submit
// goes through handleSubmit(onFinish) on a Button — never antd onFinish.
export default function ResourceFormBody({
  resourceMeta,
  id,
  onClose,
}: ResourceFormBodyProps) {
  const { formatMessage } = useIntl();
  const action = id ? 'edit' : 'create';
  const fields = resourceMeta.fields;
  // readOnly fields: omitted on create, rendered disabled on edit.
  const visibleFields =
    action === 'create' ? fields.filter((f) => !f.readOnly) : fields;

  const schema = useMemo(() => buildFormSchema(fields), [fields]);
  const defaultValues = useMemo(() => buildDefaultValues(fields), [fields]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
    refineCore: { onFinish, query, formLoading },
  } = useForm({
    refineCoreProps: {
      resource: resourceMeta.name,
      action,
      id,
      // The list stays mounted behind the drawer, so no route redirect:
      // Refine's mutation invalidates the list queries and closing the
      // drawer (exit animation, then navigate) is the whole "redirect".
      redirect: false,
      onMutationSuccess: () => onClose(),
    },
    // The API's error envelope details are zod issues, not Refine's
    // ValidationErrors shape — don't let Refine try to map them onto fields.
    disableServerSideValidation: true,
    resolver: zodResolver(schema) as Resolver<FieldValues>,
    defaultValues,
  });

  // Populate RHF once the edit record arrives (dates become Dayjs objects).
  const record = query?.data?.data;
  useEffect(() => {
    if (record) reset(toFormValues(record, fields));
  }, [record, reset, fields]);

  const submit = handleSubmit(async (values) => {
    await onFinish(toPayload(values, fields));
  });

  if (formLoading && !record && action === 'edit') {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flex>
    );
  }

  return (
    <Form layout="vertical">
      {visibleFields.map((field) => (
        <FormItem
          key={field.name}
          control={control}
          name={field.name}
          label={field.label}
          required={field.required}
          disabled={field.readOnly}
          {...(field.type === 'boolean' ? { valuePropName: 'checked' } : {})}
        >
          <FieldWidget field={field} disabled={field.readOnly} />
        </FormItem>
      ))}
      <Flex gap={8} justify="flex-end">
        <Button onClick={onClose}>
          {formatMessage({
            id: 'adminResources.form.cancel',
            defaultMessage: 'Cancel',
          })}
        </Button>
        <Button
          type="primary"
          loading={isSubmitting || formLoading}
          onClick={submit}
        >
          {formatMessage({
            id: 'adminResources.form.save',
            defaultMessage: 'Save',
          })}
        </Button>
      </Flex>
    </Form>
  );
}

function buildDefaultValues(fields: ResourceField[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    if (field.type === 'boolean') values[field.name] = false;
    else if (
      field.type === 'string' ||
      field.type === 'text' ||
      field.type === 'richtext' ||
      field.type === 'image'
    )
      values[field.name] = '';
    else values[field.name] = undefined;
  }
  return values;
}

function toFormValues(
  record: Record<string, unknown>,
  fields: ResourceField[],
): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    const value = record[field.name];
    values[field.name] =
      field.type === 'date' ? (value ? dayjs(String(value)) : null) : value;
  }
  return values;
}

// Writable fields only — readOnly values are stripped even on edit. Dates go
// back to ISO strings; cleared optional strings become explicit nulls;
// undefined (never-touched optional inputs) is omitted so server-side
// defaults apply on create.
function toPayload(
  values: FieldValues,
  fields: ResourceField[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    let value: unknown = values[field.name];
    if (value === undefined) continue;
    if (field.type === 'date') {
      value = value && dayjs.isDayjs(value) ? value.toISOString() : value;
    }
    if (
      (field.type === 'string' ||
        field.type === 'text' ||
        field.type === 'richtext' ||
        field.type === 'image') &&
      value === '' &&
      !field.required
    ) {
      value = null;
    }
    payload[field.name] = value;
  }
  return payload;
}
