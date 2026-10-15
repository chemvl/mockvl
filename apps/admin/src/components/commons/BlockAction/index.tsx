/** Block quick actions including ai summary and 3 dots for config AI skills and export csv*/
import {
  LoadingOutlined,
  MoreOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button, Dropdown, Space } from 'antd';
import { useState } from 'react';

type BlockActionProps = {
  aiSummaryVisible?: boolean;
  onAiSummaryShow: () => void;
  moreMenuItems?: MenuProps['items'];
};

export function BlockAction({
  aiSummaryVisible = false,
  onAiSummaryShow,
  moreMenuItems = [],
}: BlockActionProps) {
  const [isAiLoading, setIsAiLoading] = useState(false);

  function handleAiClick() {
    if (isAiLoading || aiSummaryVisible) return;
    setIsAiLoading(true);
    setTimeout(() => {
      setIsAiLoading(false);
      onAiSummaryShow();
    }, 1500);
  }

  return (
    <Space size={4} style={{ flexShrink: 0 }}>
      <Button
        type="link"
        size="small"
        icon={isAiLoading ? <LoadingOutlined /> : <ThunderboltOutlined />}
        onClick={handleAiClick}
        disabled={isAiLoading}
        style={{ padding: '0 4px', fontSize: 13 }}
      >
        {isAiLoading ? null : 'AI'}
      </Button>
      <Dropdown
        menu={{ items: moreMenuItems }}
        trigger={['click']}
        placement="bottomRight"
      >
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined />}
          style={{ padding: '0 4px' }}
        />
      </Dropdown>
    </Space>
  );
}
