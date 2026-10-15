import { GoogleOutlined } from '@ant-design/icons';
import { useLogin } from '@refinedev/core';
import { Button, Result } from 'antd';
import { useIntl } from 'react-intl';

type AdminSignInProps = {
  // 'signIn' — no admin session yet; 'forbidden' — signed in but the role
  // does not allow the attempted resource/action (also shown for resources
  // absent from the role-filtered meta payload).
  variant?: 'signIn' | 'forbidden';
};

export default function AdminSignIn({ variant = 'signIn' }: AdminSignInProps) {
  const { formatMessage } = useIntl();
  const { mutate: login } = useLogin();

  if (variant === 'forbidden') {
    return (
      <Result
        status="403"
        title={formatMessage({
          id: 'adminResources.forbidden.title',
          defaultMessage: 'Access denied',
        })}
        subTitle={formatMessage({
          id: 'adminResources.forbidden.subtitle',
          defaultMessage:
            'Your admin role does not allow this action on this resource.',
        })}
      />
    );
  }

  return (
    <Result
      status="403"
      title={formatMessage({
        id: 'adminResources.signIn.title',
        defaultMessage: 'Admin session required',
      })}
      subTitle={formatMessage({
        id: 'adminResources.signIn.subtitle',
        defaultMessage:
          'Resource management uses a separate Google admin sign-in.',
      })}
      extra={
        <Button
          type="primary"
          icon={<GoogleOutlined />}
          onClick={() => login({})}
        >
          {formatMessage({
            id: 'adminResources.signIn.button',
            defaultMessage: 'Sign in with Google',
          })}
        </Button>
      }
    />
  );
}
