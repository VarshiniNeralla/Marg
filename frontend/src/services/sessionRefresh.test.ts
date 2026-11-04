import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn(), isAxiosError: () => false } }));
vi.mock('@/config/env', () => ({ API_BASE_URL: 'http://api.test' }));

// A tiny stand-in for the persisted auth store (the real one needs a browser localStorage).
const auth = vi.hoisted(() => {
  const state: { user: unknown; sessionKind: string | null; accessToken: string | null; setAccessToken: (t: string) => void } = {
    user: null, sessionKind: null, accessToken: null,
    setAccessToken: (t: string) => { state.accessToken = t; },
  };
  return state;
});
vi.mock('@store/authStore', () => ({ useAuthStore: { getState: () => auth } }));

import axios from 'axios';
import { jwtSubject, restoreSessionFromCookie } from './sessionRefresh';

function token(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.sig`;
}

const alice = {
  id: 'user-alice', name: 'Alice', email: 'alice@myhomeconstructions.com', role: 'admin' as const,
  org_id: 'org-1', org_name: 'My Home', org_slug: 'myhome', avatar_url: null, assignedProjectIds: [],
};

describe('jwtSubject', () => {
  it('reads the sub claim', () => expect(jwtSubject(token({ sub: 'u1', tid: 'myhome' }))).toBe('u1'));
  it('returns null for garbage', () => {
    expect(jwtSubject('nope')).toBeNull();
    expect(jwtSubject(token({ tid: 'x' }))).toBeNull();
  });
});

describe('restoreSessionFromCookie identity check', () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
    auth.user = alice; auth.sessionKind = 'live'; auth.accessToken = 'old-token';
  });

  it('continues the session when the refreshed token is the same user', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { data: { access_token: token({ sub: 'user-alice' }) } } });
    expect(await restoreSessionFromCookie()).toBe('restored');
  });

  it('refuses a token that belongs to a different user (shared refresh cookie)', async () => {
    const bobs = token({ sub: 'user-bob', tid: 'kohinoor' });
    vi.mocked(axios.post).mockResolvedValue({ data: { data: { access_token: bobs } } });
    expect(await restoreSessionFromCookie()).toBe('no-session');
    expect(auth.accessToken).toBe('old-token');   // never adopted
  });
});
