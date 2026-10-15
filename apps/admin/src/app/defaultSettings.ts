import type { ProLayoutProps } from '@ant-design/pro-components';
import storage from '@/lib/storage';

// Restore the theme persisted by SwitchTheme so it survives reloads.
const storedNavTheme = storage.getItem('navTheme');

/**
 * @name
 */
const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: storedNavTheme === 'realDark' ? 'realDark' : 'light',
  // 拂晓蓝
  colorPrimary: '#1890ff',
  layout: 'side',
  splitMenus: false,
  siderMenuType: 'sub',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: 'Mockvl Admin',
  pwa: true,
  // BASE_URL-relative so the logo resolves under any deploy base path.
  logo: `${import.meta.env.BASE_URL}logo.svg`,
  iconfontUrl: '',
  token: {
    // 参见ts声明，demo 见文档，通过token 修改样式
    //https://procomponents.ant.design/components/layout#%E9%80%9A%E8%BF%87-token-%E4%BF%AE%E6%94%B9%E6%A0%B7%E5%BC%8F
  },
};

export default Settings;
