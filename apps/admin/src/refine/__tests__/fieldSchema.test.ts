import type { ResourceField } from '@starter/schemas';
import { buildFormSchema } from '../pages/fieldSchema';

const field = (overrides: Partial<ResourceField>): ResourceField =>
  ({ name: 'f', label: 'F', type: 'string', ...overrides }) as ResourceField;

describe('buildFormSchema', () => {
  test('requires non-empty strings when the field is required', () => {
    const schema = buildFormSchema([
      field({ name: 'title', type: 'string', required: true }),
    ]);

    expect(schema.safeParse({ title: '' }).success).toBe(false);
    expect(schema.safeParse({ title: 'hello' }).success).toBe(true);
  });

  test('lets optional strings be empty, null, or missing', () => {
    const schema = buildFormSchema([field({ name: 'content', type: 'text' })]);

    expect(schema.safeParse({ content: '' }).success).toBe(true);
    expect(schema.safeParse({ content: null }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  test('richtext validates like text: required rejects the empty string', () => {
    const required = buildFormSchema([
      field({ name: 'content', type: 'richtext', required: true }),
    ]);
    // The editor emits '' for an empty document, so min(1) catches it.
    expect(required.safeParse({ content: '' }).success).toBe(false);
    expect(required.safeParse({ content: '<p>hi</p>' }).success).toBe(true);

    const optional = buildFormSchema([
      field({ name: 'content', type: 'richtext' }),
    ]);
    expect(optional.safeParse({ content: '' }).success).toBe(true);
    expect(optional.safeParse({ content: null }).success).toBe(true);
  });

  test('image fields validate as urls; optional allows empty and null', () => {
    const required = buildFormSchema([
      field({ name: 'coverImageUrl', type: 'image', required: true }),
    ]);
    expect(required.safeParse({ coverImageUrl: '' }).success).toBe(false);
    expect(required.safeParse({ coverImageUrl: 'not-a-url' }).success).toBe(
      false,
    );
    expect(
      required.safeParse({ coverImageUrl: 'https://cdn.example.com/pic.png' })
        .success,
    ).toBe(true);

    const optional = buildFormSchema([
      field({ name: 'coverImageUrl', type: 'image' }),
    ]);
    // Untouched Input yields ''; toPayload nulls it before submit.
    expect(optional.safeParse({ coverImageUrl: '' }).success).toBe(true);
    expect(optional.safeParse({ coverImageUrl: null }).success).toBe(true);
    expect(optional.safeParse({}).success).toBe(true);
    expect(optional.safeParse({ coverImageUrl: 'not-a-url' }).success).toBe(
      false,
    );
  });

  test('enforces enum membership', () => {
    const schema = buildFormSchema([
      field({
        name: 'status',
        type: 'enum',
        options: ['draft', 'published'],
      }),
    ]);

    expect(schema.safeParse({ status: 'draft' }).success).toBe(true);
    expect(schema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });

  test('requires enum choice when the field is required', () => {
    const schema = buildFormSchema([
      field({
        name: 'status',
        type: 'enum',
        options: ['draft', 'published'],
        required: true,
      }),
    ]);

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ status: null }).success).toBe(false);
  });

  test('validates relations as uuids', () => {
    const schema = buildFormSchema([
      field({
        name: 'authorId',
        type: 'relation',
        resource: 'users',
        displayField: 'email',
        required: true,
      }),
    ]);

    expect(schema.safeParse({ authorId: 'not-a-uuid' }).success).toBe(false);
    expect(
      schema.safeParse({
        authorId: '3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a',
      }).success,
    ).toBe(true);
  });

  test('booleans accept only true/false', () => {
    const schema = buildFormSchema([
      field({ name: 'active', type: 'boolean' }),
    ]);

    expect(schema.safeParse({ active: true }).success).toBe(true);
    expect(schema.safeParse({ active: 'yes' }).success).toBe(false);
  });

  test('required dates check presence only (Dayjs objects pass)', () => {
    const schema = buildFormSchema([
      field({ name: 'publishedAt', type: 'date', required: true }),
    ]);

    expect(schema.safeParse({ publishedAt: null }).success).toBe(false);
    expect(
      schema.safeParse({ publishedAt: { $isDayjsObject: true } }).success,
    ).toBe(true);
  });

  test('excludes readOnly fields from the schema entirely', () => {
    const schema = buildFormSchema([
      field({
        name: 'createdAt',
        type: 'date',
        readOnly: true,
        required: true,
      }),
      field({ name: 'title', type: 'string', required: true }),
    ]);

    expect(schema.safeParse({ title: 'ok' }).success).toBe(true);
    expect(Object.keys(schema.shape)).toEqual(['title']);
  });
});
