import { Button, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { isLinkUrl } from './imageUpload';

type LinkModalProps = {
  open: boolean;
  /** Existing link href when the cursor sits on a link. */
  initialHref?: string;
  onSubmit: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
};

export const LinkModal = ({
  open,
  initialHref,
  onSubmit,
  onRemove,
  onCancel,
}: LinkModalProps) => {
  const { formatMessage } = useIntl();
  const [href, setHref] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setHref(initialHref ?? '');
      setTouched(false);
    }
  }, [open, initialHref]);

  const invalid = touched && !isLinkUrl(href);

  const submit = () => {
    setTouched(true);
    if (isLinkUrl(href)) onSubmit(href);
  };

  return (
    <Modal
      open={open}
      title={formatMessage({
        id: 'richText.linkModal.title',
        defaultMessage: 'Link',
      })}
      onCancel={onCancel}
      onOk={submit}
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          {initialHref && (
            <Button danger onClick={onRemove}>
              {formatMessage({
                id: 'richText.linkModal.remove',
                defaultMessage: 'Remove link',
              })}
            </Button>
          )}
          <CancelBtn />
          <OkBtn />
        </>
      )}
    >
      <Input
        autoFocus
        placeholder="https://"
        value={href}
        status={invalid ? 'error' : undefined}
        onChange={(event) => setHref(event.target.value)}
        onPressEnter={submit}
      />
      {invalid && (
        <Typography.Text type="danger">
          {formatMessage({
            id: 'richText.linkModal.invalidUrl',
            defaultMessage: 'Enter a valid http(s) or mailto URL.',
          })}
        </Typography.Text>
      )}
    </Modal>
  );
};
