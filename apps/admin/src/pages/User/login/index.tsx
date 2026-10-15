import { GoogleOutlined } from '@ant-design/icons';
import { Alert, Button, Space } from 'antd';
import { createStyles } from 'antd-style';
import { useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useSearchParams } from 'react-router';
import Settings from '@/app/defaultSettings';
import { Footer } from '@/components';
import { ADMIN_API_URL } from '@/refine/config';
import { hardNavigate } from '@/refine/navigation';

const useStyles = createStyles(({ token }) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'auto',
    backgroundImage: `url('${import.meta.env.BASE_URL}images/bg.png')`,
    backgroundSize: '100% 100%',
  },
  card: {
    margin: 'auto',
    marginTop: '10vh',
    padding: '40px 48px',
    maxWidth: 400,
    width: '100%',
    textAlign: 'center' as const,
  },
  logo: {
    width: 44,
    height: 44,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    color: token.colorTextHeading,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: token.colorTextDescription,
    marginBottom: 32,
  },
}));

// Admin login: the only credential is a Google account accepted by apps/api
// (verified hd claim). The button hands the browser to the API's OAuth flow;
// the callback sets the httpOnly admin_session cookie and redirects back.
export default function LoginPage() {
  const { styles } = useStyles();
  const intl = useIntl();
  const [searchParams] = useSearchParams();
  const loginFailed = searchParams.get('error') === 'admin_login_failed';

  useEffect(() => {
    document.title = `${intl.formatMessage({
      id: 'menu.login',
      defaultMessage: 'Login',
    })}${Settings.title ? ` - ${Settings.title}` : ''}`;
  }, [intl]);

  return (
    <div className={styles.container}>
      <div style={{ flex: 1 }}>
        <div className={styles.card}>
          <Space align="center">
            <img
              src={`${import.meta.env.BASE_URL}logo.svg`}
              alt="logo"
              className={styles.logo}
            />
            <div className={styles.title}>
              {intl.formatMessage({
                id: 'pages.layouts.userLayout.title',
                defaultMessage: 'Ant Design',
              })}
            </div>
          </Space>
          <div className={styles.subtitle}>
            {intl.formatMessage({
              id: 'pages.login.subTitle',
              defaultMessage: 'Sign in with your Google admin account',
            })}
          </div>

          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {loginFailed && (
              <Alert
                type="error"
                showIcon
                message={intl.formatMessage({
                  id: 'pages.login.adminLoginFailed',
                  defaultMessage:
                    'Google sign-in failed. Make sure you use an authorized admin account and try again.',
                })}
              />
            )}
            <Button
              type="primary"
              size="large"
              block
              icon={<GoogleOutlined />}
              onClick={() => hardNavigate(`${ADMIN_API_URL}/admin/auth/google`)}
            >
              {intl.formatMessage({
                id: 'pages.login.googleSignIn',
                defaultMessage: 'Sign in with Google',
              })}
            </Button>
          </Space>
        </div>
      </div>
      <Footer />
    </div>
  );
}
