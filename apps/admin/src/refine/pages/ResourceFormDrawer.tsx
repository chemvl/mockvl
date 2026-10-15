import { useCan } from '@refinedev/core';
import { Drawer } from 'antd';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router';
import { useAdminStore } from '../adminStore';
import AdminSignIn from './AdminSignIn';
import ResourceFormBody from './ResourceFormBody';

// Generic create/edit child route (/resources/:resource/create and
// /resources/:resource/edit/:id), rendered by ResourceList's Outlet as a
// right-side drawer over the still-mounted list. Closing plays the exit
// animation first, then navigates back to the list, which unmounts this
// route. Direct-URL access to forbidden forms is blocked here, in-drawer —
// the body is keyed so RHF state never survives a record/resource switch.
export default function ResourceFormDrawer() {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { resource: resourceName = '', id } = useParams();
  const action = id ? 'edit' : 'create';

  const resourceMeta = useAdminStore((s) =>
    s.resources.find((r) => r.name === resourceName),
  );

  const { data: canDo } = useCan({ resource: resourceName, action });

  const [open, setOpen] = useState(true);
  const close = () => setOpen(false);

  // ResourceList only mounts this Outlet when a session exists and the
  // resource is listable, so the drawer only needs the action-level gate.
  const forbidden = !resourceMeta || canDo?.can === false;

  const title = resourceMeta
    ? formatMessage(
        {
          id:
            action === 'create'
              ? 'adminResources.form.createTitle'
              : 'adminResources.form.editTitle',
          defaultMessage:
            action === 'create' ? 'Create {label}' : 'Edit {label}',
        },
        { label: resourceMeta.label },
      )
    : undefined;

  return (
    <Drawer
      placement="right"
      width={720}
      open={open}
      onClose={close}
      title={title}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) navigate(`/resources/${resourceName}`);
      }}
    >
      {forbidden ? (
        <AdminSignIn variant="forbidden" />
      ) : (
        <ResourceFormBody
          key={`${resourceName}:${id ?? 'create'}`}
          resourceMeta={resourceMeta}
          id={id}
          onClose={close}
        />
      )}
    </Drawer>
  );
}
