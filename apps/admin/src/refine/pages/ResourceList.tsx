import { PageContainer } from '@ant-design/pro-components';
import { useCan } from '@refinedev/core';
import { Outlet, useParams } from 'react-router';
import { useAdminStore } from '../adminStore';
import AdminSignIn from './AdminSignIn';
import ResourceTable from './ResourceTable';

// Generic list route (/resources/:resource). Gates first: no admin session →
// sign-in card; resource unknown (role-filtered out of meta) or list denied →
// 403 state. The table itself is keyed by resource name so its useTable
// state (filters/sorters/page) never leaks between resources.
export default function ResourceList() {
  const { resource: resourceName = '' } = useParams();
  const identity = useAdminStore((s) => s.identity);
  const resourceMeta = useAdminStore((s) =>
    s.resources.find((r) => r.name === resourceName),
  );

  const { data: canList } = useCan({
    resource: resourceName,
    action: 'list',
  });

  if (!identity) {
    return (
      <PageContainer title={false}>
        <AdminSignIn />
      </PageContainer>
    );
  }

  if (!resourceMeta || canList?.can === false) {
    return (
      <PageContainer title={false}>
        <AdminSignIn variant="forbidden" />
      </PageContainer>
    );
  }

  return (
    <PageContainer title={resourceMeta.label}>
      <ResourceTable key={resourceName} resourceMeta={resourceMeta} />
      {/* create/edit child routes render the form drawer over the list;
          placing the Outlet inside the authorized branch keeps the same
          gates on deep links. */}
      <Outlet />
    </PageContainer>
  );
}
