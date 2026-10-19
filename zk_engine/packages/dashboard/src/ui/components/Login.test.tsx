import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { Login } from './Login.js';
import type { SessionInfo } from '../App.js';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })));
}

describe('Login', () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the form and signs in on submit', async () => {
    const session: SessionInfo = { ok: true, expiresMs: 1234 };
    mockFetch(200, session);
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);
    await waitFor(() => screen.getByPlaceholderText('password'));
    const input = screen.getByTestId('password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hunter2' } });
    const btn = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(session));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'hunter2' }) }),
    );
  });

  it('shows the API problem detail on 401', async () => {
    mockFetch(401, { code: 'unauthorized', detail: 'bad password' });
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);
    const input = screen.getByTestId('password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByTestId('login-error').textContent).toBe('bad password'));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('disables submit while password is empty', () => {
    render(<Login onSuccess={vi.fn()} />);
    expect((screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});