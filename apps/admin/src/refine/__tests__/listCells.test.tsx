import type { ResourceField } from '@starter/schemas';
import { render } from '@testing-library/react';
import { renderFieldCell } from '../pages/listCells';

const relationField: ResourceField = {
  name: 'categoryId',
  type: 'relation',
  label: 'Category',
  resource: 'categories',
  displayField: 'name',
};

const cell = (node: React.ReactNode) => render(<>{node}</>).container;

describe('renderFieldCell — relation', () => {
  test('shows the resolved display label when provided', () => {
    const container = cell(
      renderFieldCell(relationField, 'uuid-1', 'Technology'),
    );

    expect(container.textContent).toBe('Technology');
    expect(container.querySelector('code')).toBeNull();
  });

  test('falls back to the raw id in code style without a label', () => {
    const container = cell(renderFieldCell(relationField, 'uuid-1'));

    expect(container.textContent).toBe('uuid-1');
    expect(container.querySelector('code')).not.toBeNull();
  });

  test('renders the empty marker for null values', () => {
    const container = cell(renderFieldCell(relationField, null, undefined));

    expect(container.textContent).toBe('—');
  });
});

describe('renderFieldCell — image', () => {
  const imageField: ResourceField = {
    name: 'coverImageUrl',
    type: 'image',
    label: 'Cover Image',
  };

  test('renders a small avatar pointing at the url', () => {
    const container = cell(
      renderFieldCell(imageField, 'https://cdn.example.com/pic.png'),
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/pic.png');
  });

  test('renders the empty marker for null values', () => {
    const container = cell(renderFieldCell(imageField, null));

    expect(container.textContent).toBe('—');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('renderFieldCell — richtext', () => {
  const richtextField: ResourceField = {
    name: 'content',
    type: 'richtext',
    label: 'Content',
  };

  test('renders a plain-text excerpt, never markup', () => {
    const container = cell(
      renderFieldCell(
        richtextField,
        '<h1>Title</h1><p onclick="x">body &amp; more</p>',
      ),
    );

    expect(container.textContent).toBe('Title body & more');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('p')).toBeNull();
  });

  test('renders the empty marker for null values', () => {
    const container = cell(renderFieldCell(richtextField, null));

    expect(container.textContent).toBe('—');
  });
});
