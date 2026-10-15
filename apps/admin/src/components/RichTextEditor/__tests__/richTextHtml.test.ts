import { htmlToExcerpt, normalizeEditorHtml } from '../richTextHtml';

describe('normalizeEditorHtml', () => {
  test('empty document forms collapse to the empty string', () => {
    expect(normalizeEditorHtml('')).toBe('');
    expect(normalizeEditorHtml('<p></p>')).toBe('');
    expect(normalizeEditorHtml('<p>   </p>')).toBe('');
    expect(normalizeEditorHtml('<p><br></p>')).toBe('');
    expect(normalizeEditorHtml('<p>&nbsp;</p>')).toBe('');
    expect(normalizeEditorHtml('<p></p><p>  </p>')).toBe('');
  });

  test('textual content passes through untouched', () => {
    expect(normalizeEditorHtml('<p>hi</p>')).toBe('<p>hi</p>');
    expect(normalizeEditorHtml('<h1>Title</h1><p></p>')).toBe(
      '<h1>Title</h1><p></p>',
    );
  });

  test('media-only documents are not empty', () => {
    const image = '<p><img src="https://a.example/x.png"></p>';
    expect(normalizeEditorHtml(image)).toBe(image);
    const rule = '<hr><p></p>';
    expect(normalizeEditorHtml(rule)).toBe(rule);
    const table = '<table><tbody><tr><td></td></tr></tbody></table>';
    expect(normalizeEditorHtml(table)).toBe(table);
  });
});

describe('htmlToExcerpt', () => {
  test('strips tags and decodes basic entities', () => {
    expect(htmlToExcerpt('<h1>Hello</h1><p>a &amp; b</p>')).toBe('Hello a & b');
  });

  test('collapses whitespace across block boundaries', () => {
    expect(htmlToExcerpt('<p>one</p>\n<p>two</p>')).toBe('one two');
  });

  test('truncates long content with an ellipsis', () => {
    const excerpt = htmlToExcerpt(`<p>${'a'.repeat(200)}</p>`, 10);
    expect(excerpt.length).toBeLessThanOrEqual(10);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('short content is returned whole', () => {
    expect(htmlToExcerpt('<p>short</p>', 10)).toBe('short');
  });
});
