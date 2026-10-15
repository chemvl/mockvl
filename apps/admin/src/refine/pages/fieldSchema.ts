import type { ResourceField } from '@starter/schemas';
import { z } from 'zod';

// Builds the zodResolver schema for the generic ResourceForm from field
// metadata. Pure — unit-tested without antd or Refine. readOnly fields never
// appear in the form (omitted on create, disabled+stripped on edit), so they
// are excluded from validation entirely.
//
// Date fields hold Dayjs objects (or null) in form state — they are converted
// to ISO strings on submit, AFTER validation — so the schema only checks
// presence, not string format.
export function buildFormSchema(
  fields: ResourceField[],
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const field of fields) {
    if (field.readOnly) continue;
    shape[field.name] = schemaForField(field);
  }

  return z.object(shape);
}

function schemaForField(field: ResourceField): z.ZodType {
  switch (field.type) {
    case 'string':
    case 'text':
    // richtext holds an HTML string; the editor emits '' for an empty
    // document, so min(1) required-validation behaves like a textarea.
    case 'richtext': {
      return field.required
        ? z.string({ error: `${field.label} is required` }).min(1, {
            error: `${field.label} is required`,
          })
        : z.string().nullish();
    }
    case 'image': {
      // Holds a URL string; an untouched Input yields '' — toPayload turns
      // empty optional values into null before submit.
      const url = z.url({ error: `${field.label} must be a valid URL` });
      return field.required ? url : z.union([url, z.literal('')]).nullish();
    }
    case 'number': {
      return field.required
        ? z.number({ error: `${field.label} is required` })
        : z.number().nullish();
    }
    case 'boolean': {
      // A Switch always yields a boolean; there is no "empty" state to require.
      return z.boolean();
    }
    case 'enum': {
      const options = z.enum(field.options as [string, ...string[]], {
        error: `${field.label} is required`,
      });
      return field.required ? options : options.nullish();
    }
    case 'relation': {
      return field.required
        ? z.uuid({ error: `${field.label} is required` })
        : z.uuid().nullish();
    }
    case 'date': {
      // Dayjs | string | null in form state; only presence is validated here.
      const present = z.custom<unknown>((value) => value != null, {
        error: `${field.label} is required`,
      });
      return field.required ? present : z.unknown().nullish();
    }
  }
}
