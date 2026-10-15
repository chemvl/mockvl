import type { MessageInstance } from 'antd/es/message/interface';

let messageApi: MessageInstance | null = null;

export const setMessageApi = (api: MessageInstance): void => {
  messageApi = api;
};

export const getMessageApi = (): MessageInstance | null => messageApi;
