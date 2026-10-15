import { Breadcrumb, Drawer, Input, Typography } from 'antd';
import { useState } from 'react';

type ResourceSection = {
  title: string;
  description: string;
};

const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    title: 'Totals',
    description:
      'Data is not segmented in any way. In the Engage Section, the selected metrics are added together.',
  },
  {
    title: 'Breakdown or Compare by Network',
    description: 'Data is segmented by the network.',
  },
  {
    title: 'Breakdown or Compare by Engage Type',
    description:
      'Data is segmented by the type of engage actions. This is only available in the Engage Section.',
  },
  {
    title: 'Breakdown or Compare by Content Type',
    description:
      'Data is segmented by the content type. Content types include video, image, link or text, in that order. For example, if a message contained a link and a video, the message gets categorized as a video.',
  },
  {
    title: 'Breakdown or Compare by Discussion Type',
    description:
      'Data is segmented by discussion type. Discussion types consist of Posts (original content), Discussions (mentions/replies), and Shares.',
  },
  {
    title: 'Breakdown or Compare by Sentiment',
    description:
      "Data is segmented by the sentiment rating of the author's message. Ratings are either negative or positive.",
  },
];

export type ResourcesDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function ResourcesDrawer({ open, onClose }: ResourcesDrawerProps) {
  const [search, setSearch] = useState('');

  const filteredSections = RESOURCE_SECTIONS.filter(
    (s) =>
      search === '' ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Drawer
      title="Listening Resources"
      open={open}
      onClose={onClose}
      width={520}
      styles={{ body: { padding: 16 } }}
    >
      <Breadcrumb
        items={[{ title: 'Listening Resources Home' }, { title: 'Breakdowns' }]}
        style={{ marginBottom: 16 }}
      />
      <Input.Search
        placeholder="Search resources..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 20 }}
      />
      <Typography.Title level={5} style={{ marginBottom: 8 }}>
        Breakdowns
      </Typography.Title>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 13, marginBottom: 16 }}
      >
        Use Breakdowns to segment your data to help you better understand how
        particular segments performed using the extra metadata existing on
        messages. Here are ways in which you can break down or compare data
        segments:
      </Typography.Paragraph>
      <ul style={{ paddingLeft: 20, margin: 0 }}>
        {filteredSections.map((section) => (
          <li key={section.title} style={{ marginBottom: 8 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {section.title}:
            </Typography.Text>{' '}
            <Typography.Text style={{ fontSize: 13 }}>
              {section.description}
            </Typography.Text>
          </li>
        ))}
      </ul>
      <div
        style={{
          background: '#FAFAFA',
          border: '1px solid var(--ant-color-border-secondary)',
          borderRadius: 6,
          padding: '12px 16px',
          marginTop: 20,
          fontSize: 13,
          color: '#595959',
        }}
      >
        If you are viewing a Competitive Topic, charts will be segmented by
        competitor data by default and do not support additional breakdowns.
      </div>
    </Drawer>
  );
}
