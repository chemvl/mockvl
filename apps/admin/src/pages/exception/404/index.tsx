import { Button, Card, Result } from 'antd';
import React from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';

const Exception404: React.FC = () => {
  const intl = useIntl();
  return (
    <Card variant="borderless">
      <Result
        status="404"
        title="404"
        subTitle={intl.formatMessage({
          id: 'pages.404.subTitle',
          defaultMessage: 'Sorry, the page you visited does not exist.',
        })}
        extra={
          <Link to="/">
            <Button type="primary">
              {intl.formatMessage({
                id: 'pages.404.buttonText',
                defaultMessage: 'Back Home',
              })}
            </Button>
          </Link>
        }
      />
    </Card>
  );
};

export default Exception404;
