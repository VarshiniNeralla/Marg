import { describe, expect, it, vi } from 'vitest';

vi.mock('@store/authStore', () => ({ useAuthStore: { getState: () => ({ accessToken: null }) } }));
vi.mock('@store/sessionIsolation', () => ({ endClientSession: vi.fn() }));
vi.mock('./sessionRefresh', () => ({ restoreSessionFromCookie: vi.fn() }));
vi.mock('@/config/env', () => ({ API_V1_URL: 'http://api.test/api/v1', API_BASE_URL: 'http://api.test' }));

import { AxiosError } from 'axios';
import { normaliseError } from './apiClient';

function axios422(body: unknown): AxiosError {
  return new AxiosError('Request failed with status code 422', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 422, statusText: 'Unprocessable Entity', headers: {}, config: {} as never, data: body,
  });
}

describe('normaliseError', () => {
  it("returns the server's own message for a failed request, not axios's generic text", () => {
    const e = normaliseError(axios422({ success: false, error: 'VALIDATION_ERROR', message: 'source or target floor plan not found' }));
    expect(e.status).toBe(422);
    expect(e.message).toBe('source or target floor plan not found');
  });

  it('leaves an already-normalised error untouched', () => {
    const already = { status: 403, message: 'nope' };
    expect(normaliseError(already)).toBe(already);
  });

  it('reads a list of field errors', () => {
    const e = normaliseError(axios422({ detail: [{ field: 'password', message: 'Password must contain an uppercase letter' }] }));
    expect(e.message).toBe('Password must contain an uppercase letter');
  });
});
