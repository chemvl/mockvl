import { AdminHttpError, adminFetch } from '../http';

// config.ts reads import.meta.env (Vite-only syntax) — replace it wholesale.
jest.mock('../config', () => ({ ADMIN_API_URL: 'http://api.test' }));

const fetchMock = jest.fn();

// jsdom provides no fetch Response — a structural stub is enough for http.ts.
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function textResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('adminFetch', () => {
  test('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));

    await expect(adminFetch('/admin/posts/1')).resolves.toEqual({
      data: { id: '1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/admin/posts/1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  test('sends no CSRF header on GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await adminFetch('/admin/posts');

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-Requested-With')).toBeNull();
  });

  test.each([
    'POST',
    'PATCH',
    'DELETE',
  ])('sends the X-Requested-With CSRF header on %s', async (method) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: {} }));

    await adminFetch('/admin/posts', { method });

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  test('sets a JSON content type when a body is present', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { data: {} }));

    await adminFetch('/admin/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
    });

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  test('maps the API error envelope onto AdminHttpError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: [{ path: ['title'] }],
          requestId: 'req-1',
        },
      }),
    );

    const error = await adminFetch('/admin/posts', { method: 'POST' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AdminHttpError);
    expect(error).toMatchObject({
      message: 'Invalid request body',
      statusCode: 400,
      errors: [{ path: ['title'] }],
    });
  });

  test('falls back to a status message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(textResponse(502));

    await expect(adminFetch('/admin/posts')).rejects.toMatchObject({
      message: 'Request failed with status 502',
      statusCode: 502,
    });
  });
});
