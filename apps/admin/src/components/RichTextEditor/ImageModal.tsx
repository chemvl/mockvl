import { IconUpload } from '@tabler/icons-react';
import { Flex, Input, Modal, Typography, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import type {
  RichTextImageUploadAdapter,
  RichTextImageUploadResult,
} from './imageUpload';
import { isHttpUrl } from './imageUpload';

type ImageModalProps = {
  open: boolean;
  uploadAdapter: RichTextImageUploadAdapter;
  onSubmit: (image: RichTextImageUploadResult) => void;
  onCancel: () => void;
};

export const ImageModal = ({
  open,
  uploadAdapter,
  onSubmit,
  onCancel,
}: ImageModalProps) => {
  const { formatMessage } = useIntl();
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl('');
      setAlt('');
      setTouched(false);
      setUploading(false);
    }
  }, [open]);

  const invalid = touched && !isHttpUrl(url);

  const submit = () => {
    setTouched(true);
    if (isHttpUrl(url)) onSubmit({ url, alt: alt || undefined });
  };

  return (
    <Modal
      open={open}
      title={formatMessage({
        id: 'richText.imageModal.title',
        defaultMessage: 'Image',
      })}
      onCancel={onCancel}
      onOk={submit}
      okButtonProps={{ loading: uploading }}
    >
      <Flex vertical gap={12}>
        <div>
          <Typography.Text>
            {formatMessage({
              id: 'richText.imageModal.urlLabel',
              defaultMessage: 'Image URL',
            })}
          </Typography.Text>
          <Input
            autoFocus
            placeholder="https://"
            value={url}
            status={invalid ? 'error' : undefined}
            onChange={(event) => setUrl(event.target.value)}
            onPressEnter={submit}
          />
          {invalid && (
            <Typography.Text type="danger">
              {formatMessage({
                id: 'richText.imageModal.invalidUrl',
                defaultMessage: 'Enter a valid http(s) image URL.',
              })}
            </Typography.Text>
          )}
        </div>
        <div>
          <Typography.Text>
            {formatMessage({
              id: 'richText.imageModal.altLabel',
              defaultMessage: 'Alt text (optional)',
            })}
          </Typography.Text>
          <Input value={alt} onChange={(event) => setAlt(event.target.value)} />
        </div>
        {uploadAdapter.upload && (
          <Upload.Dragger
            multiple={false}
            showUploadList={false}
            accept="image/*"
            disabled={uploading}
            customRequest={async ({ file }) => {
              const upload = uploadAdapter.upload;
              if (!upload || !(file instanceof File)) return;
              setUploading(true);
              try {
                const result = await upload(file);
                onSubmit(result);
              } finally {
                setUploading(false);
              }
            }}
          >
            <Flex vertical align="center" gap={4}>
              <IconUpload size={20} />
              {formatMessage({
                id: 'richText.imageModal.uploadHint',
                defaultMessage: 'Click or drop an image to upload',
              })}
            </Flex>
          </Upload.Dragger>
        )}
      </Flex>
    </Modal>
  );
};
