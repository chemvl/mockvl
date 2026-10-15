import { PageContainer } from '@ant-design/pro-components';
import { Result } from 'antd';
import { useIntl } from 'react-intl';
import { Navigate } from 'react-router';
import { useAdminStore } from '../adminStore';

// Default landing: forward to the first resource the caller's role can see.
// Component-based redirect on purpose — React Router runs matched loaders in
// parallel, so an index-route loader could not read the store write made by
// the root loader.
export default function AdminHome() {
  const intl = useIntl();
  const resources = useAdminStore((s) => s.resources);

  if (resources.length > 0) {
    return <Navigate to={`/resources/${resources[0].name}`} replace />;
  }

  return (
    <PageContainer>
      <Result
        status="info"
        title={intl.formatMessage({
          id: 'pages.home.noResources',
          defaultMessage: 'No resources are available for your role.',
        })}
      />
    </PageContainer>
  );
}
