import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import storage from '@/lib/storage';
import { useAppStore } from '@/store';

export const SwitchTheme = () => {
  const { settings, setSettings } = useAppStore();

  return (
    <>
      <Button
        shape="circle"
        icon={
          settings?.navTheme === 'light' ? <SunOutlined /> : <MoonOutlined />
        }
        onClick={() => {
          const themeValue =
            settings?.navTheme === 'light' ? 'realDark' : 'light';
          setSettings({
            ...settings,
            navTheme: themeValue,
          });
          storage.setItem('navTheme', themeValue);
        }}
      />
    </>
  );
};
