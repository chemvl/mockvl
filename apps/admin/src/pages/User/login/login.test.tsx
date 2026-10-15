import { fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './index';

// config.ts reads import.meta.env (Vite-only syntax) — replace it wholesale.
jest.mock('@/refine/config', () => ({ ADMIN_API_URL: 'http://api.test' }));

// react-intl v10 ships ESM-only; the page only needs formatMessage.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) =>
      defaultMessage,
  }),
}));

// react-router is ESM-only under ts-jest; the page only reads search params.
let search = '';
jest.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(search)],
}));

// The components barrel drags in the whole layout tree — only Footer is used.
jest.mock('@/components', () => ({ Footer: () => null }));

jest.mock('@/refine/navigation', () => ({ hardNavigate: jest.fn() }));

import { hardNavigate } from '@/refine/navigation';

const hardNavigateMock = hardNavigate as jest.Mock;

beforeEach(() => {
  search = '';
  hardNavigateMock.mockReset();
});

describe('LoginPage', () => {
  test('the Google button hands the browser to the admin OAuth flow', () => {
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /sign in with google/i }),
    );

    expect(hardNavigateMock).toHaveBeenCalledWith(
      'http://api.test/admin/auth/google',
    );
  });

  test('shows the failure alert when the OAuth callback reported an error', () => {
    search = '?error=admin_login_failed';

    render(<LoginPage />);

    expect(screen.getByText(/google sign-in failed/i)).toBeTruthy();
  });

  test('shows no alert without the error param', () => {
    render(<LoginPage />);

    expect(screen.queryByText(/google sign-in failed/i)).toBeNull();
  });
});
