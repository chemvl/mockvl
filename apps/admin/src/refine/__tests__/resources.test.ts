import { type ResourceMeta, ResourceMetaSchema } from '@starter/schemas';
import { toRefineResources } from '../resources';

// resources.ts → http.ts → config.ts (import.meta) — mock the chain's tail.
jest.mock('../config', () => ({ ADMIN_API_URL: 'http://api.test' }));

const posts: ResourceMeta = {
  name: 'posts',
  label: 'Posts',
  icon: 'FileTextOutlined',
  fields: [{ name: 'title', type: 'string', label: 'Title', required: true }],
  permissions: { list: 'viewer', create: 'editor' },
};

describe('toRefineResources', () => {
  test('maps meta entries onto Refine resource defs with literal paths', () => {
    expect(toRefineResources([posts])).toEqual([
      {
        name: 'posts',
        list: '/resources/posts',
        create: '/resources/posts/create',
        edit: '/resources/posts/edit/:id',
        meta: { label: 'Posts', icon: 'FileTextOutlined' },
      },
    ]);
  });

  test('keeps icon undefined when the backend sends none', () => {
    const { icon, ...withoutIcon } = posts;
    expect(toRefineResources([withoutIcon])[0].meta.icon).toBeUndefined();
  });
});

describe('ResourceMetaSchema boundary validation', () => {
  test('accepts the wire shape', () => {
    expect(() => ResourceMetaSchema.array().parse([posts])).not.toThrow();
  });

  test('rejects an enum field without options', () => {
    const malformed = {
      ...posts,
      fields: [{ name: 'status', type: 'enum', label: 'Status' }],
    };
    expect(() => ResourceMetaSchema.parse(malformed)).toThrow();
  });

  test('rejects a resource without list permission', () => {
    const malformed = { ...posts, permissions: { create: 'editor' } };
    expect(() => ResourceMetaSchema.parse(malformed)).toThrow();
  });

  test('rejects a non-slug resource name', () => {
    const malformed = { ...posts, name: 'Not A Slug!' };
    expect(() => ResourceMetaSchema.parse(malformed)).toThrow();
  });
});
