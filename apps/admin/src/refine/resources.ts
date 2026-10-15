import { type ResourceMeta, ResourceMetaSchema } from '@starter/schemas';
import { adminFetch } from './http';

// Boundary validation: the meta endpoint is "our" API, but the whole point of
// the generic admin is that resources change server-side without frontend
// deploys — parse hard so a drifted payload fails loudly here, not deep in a
// table render. .array() comes from the schema's own zod instance, avoiding
// cross-instance composition issues.
export async function fetchAdminMeta(): Promise<ResourceMeta[]> {
  const response = await adminFetch<{ data: unknown }>('/admin/meta/resources');
  return ResourceMetaSchema.array().parse(response.data);
}

// Structural subset of Refine's ResourceProps — RefineRoot passes these to
// <Refine resources={...}>. Literal paths let the router provider infer
// resource/action/id, so pages never need an explicit `resource` prop.
export type RefineResourceDef = {
  name: string;
  list: string;
  create: string;
  edit: string;
  show?: string;
  meta: { label: string; icon?: string };
};

export function toRefineResources(meta: ResourceMeta[]): RefineResourceDef[] {
  return meta.map((resource) => ({
    name: resource.name,
    list: `/resources/${resource.name}`,
    create: `/resources/${resource.name}/create`,
    edit: `/resources/${resource.name}/edit/:id`,
    meta: { label: resource.label, icon: resource.icon },
  }));
}
