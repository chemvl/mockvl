import { ExclamationCircleFilled } from '@ant-design/icons';
import { Modal } from 'antd';
import React from 'react';

const { confirm } = Modal;

interface ShowConfirmOptions {
  message: string;
  title?: string;
  okText?: string;
  cancelText?: string;
  onOk: () => void | Promise<void>;
  onCancel?: () => void;
}

export const showConfirm = ({
  message,
  title = 'Are you sure?',
  okText = 'OK',
  cancelText = 'Cancel',
  onOk,
  onCancel,
}: ShowConfirmOptions): void => {
  confirm({
    title,
    icon: React.createElement(ExclamationCircleFilled),
    content: message,
    okText,
    cancelText,
    onOk,
    onCancel,
  });
};
