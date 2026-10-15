import type { ResourceMeta } from '@starter/schemas';
import { checkAccess } from '../accessControlProvider';

// The real Phase 9b worked-example permission shapes.
const posts: ResourceMeta = {
  name: 'posts',
  label: 'Posts',
  icon: 'FileTextOutlined',
  fields: [{ name: 'title', type: 'string', label: 'Title' }],
  permissions: {
    list: 'viewer',
    create: 'editor',
    update: 'editor',
    delete: 'owner',
  },
};

const users: ResourceMeta = {
  name: 'users',
  label: 'Users',
  icon: 'UserOutlined',
  fields: [{ name: 'email', type: 'string', label: 'Email' }],
  permissions: { list: 'viewer' },
};

const resources = [posts, users];

describe('checkAccess', () => {
  test.each([
    // role × refine action → expected, against posts
    ['viewer', 'list', true],
    ['viewer', 'show', true],
    ['viewer', 'create', false],
    ['viewer', 'edit', false],
    ['viewer', 'delete', false],
    ['editor', 'list', true],
    ['editor', 'create', true],
    ['editor', 'clone', true],
    ['editor', 'edit', true],
    ['editor', 'delete', false],
    ['owner', 'list', true],
    ['owner', 'create', true],
    ['owner', 'edit', true],
    ['owner', 'delete', true],
  ] as const)('posts: %s can %s → %s', (role, action, expected) => {
    expect(checkAccess(resources, role, 'posts', action).can).toBe(expected);
  });

  test.each([
    // users is read-only: absent permissions deny even the owner
    ['viewer', 'list', true],
    ['owner', 'create', false],
    ['owner', 'edit', false],
    ['owner', 'delete', false],
  ] as const)('users: %s can %s → %s', (role, action, expected) => {
    expect(checkAccess(resources, role, 'users', action).can).toBe(expected);
  });

  test('maps refine action aliases onto API actions', () => {
    expect(checkAccess(resources, 'editor', 'posts', 'clone').can).toBe(true);
    expect(checkAccess(resources, 'editor', 'posts', 'edit').can).toBe(true);
    expect(checkAccess(resources, 'viewer', 'posts', 'show').can).toBe(true);
  });

  test('denies unknown actions', () => {
    expect(checkAccess(resources, 'owner', 'posts', 'export').can).toBe(false);
  });

  test('denies unknown resources', () => {
    expect(checkAccess(resources, 'owner', 'secrets', 'list').can).toBe(false);
  });

  test('denies when there is no identity', () => {
    expect(checkAccess(resources, null, 'posts', 'list').can).toBe(false);
  });

  test('denies when resource name is missing', () => {
    expect(checkAccess(resources, 'owner', undefined, 'list').can).toBe(false);
  });
});
