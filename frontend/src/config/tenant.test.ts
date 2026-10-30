import { describe, expect, it } from 'vitest';
import { resolveTenantKey, tenantFromHostname } from './tenant';
import { KOHINOOR_DEMO_CREDENTIALS, KOHINOOR_DEMO_PASSWORD_HINT } from '@/features/auth/demoCredentials';

describe('tenantFromHostname (exact allowlist, mirrors the backend)', () => {
  it.each([
    ['myhomeconstructions.com', 'myhome'],
    ['www.myhomeconstructions.com', 'myhome'],
    ['api.myhomeconstructions.com', 'myhome'],
    ['kohinoorpune.com', 'kohinoor'],
    ['WWW.KohinoorPune.com', 'kohinoor'],
    ['app.kohinoorpune.com.', 'kohinoor'],
  ])('%s -> %s', (host, key) => expect(tenantFromHostname(host)).toBe(key));

  it.each(['', 'localhost', '127.0.0.1', 'evil.example', 'kohinoorpune.com.evil.com', 'evilkohinoorpune.com',
    'sub.kohinoorpune.com', 'myhomeconstructions.com.attacker.net'])('%s is not a tenant host', (host) =>
    expect(tenantFromHostname(host)).toBeNull());
});

describe('resolveTenantKey', () => {
  it('an approved production hostname decides, even if the query disagrees', () => {
    expect(resolveTenantKey({ hostname: 'kohinoorpune.com', search: '?tenant=myhome', dev: true })).toBe('kohinoor');
    expect(resolveTenantKey({ hostname: 'myhomeconstructions.com', search: '?tenant=kohinoor', dev: true })).toBe('myhome');
  });

  it('development builds can pick the tenant with ?tenant= or VITE_TENANT', () => {
    expect(resolveTenantKey({ hostname: 'localhost', search: '?tenant=kohinoor', dev: true })).toBe('kohinoor');
    expect(resolveTenantKey({ hostname: 'localhost', search: '', dev: true, envTenant: 'kohinoor' })).toBe('kohinoor');
    expect(resolveTenantKey({ hostname: 'localhost', search: '?tenant=kohinoor', dev: true, envTenant: 'myhome' })).toBe('kohinoor');
  });

  it('production builds ignore the query string and the env hint on unknown hosts', () => {
    expect(resolveTenantKey({ hostname: 'tunnel.trycloudflare.com', search: '?tenant=kohinoor', dev: false, envTenant: 'kohinoor' })).toBe('myhome');
  });

  it('the default is My Home, so the existing experience is unchanged', () => {
    expect(resolveTenantKey({ hostname: 'localhost', search: '', dev: true })).toBe('myhome');
    expect(resolveTenantKey({ hostname: 'localhost', search: '?tenant=other', dev: true })).toBe('myhome');
    expect(resolveTenantKey({ hostname: 'evil.example', search: '?tenant=kohinoor', dev: false })).toBe('myhome');
  });
});

describe('Kohinoor demo credentials list', () => {
  it('lists exactly the three approved accounts with their roles', () => {
    expect(KOHINOOR_DEMO_CREDENTIALS.map((c) => [c.email, c.role])).toEqual([
      ['admin@kohinoorpune.com', 'admin'],
      ['manager@kohinoorpune.com', 'manager'],
      ['engineerdemo@kohinoorpune.com', 'field_engineer'],
    ]);
  });

  it('carries no password (or any secret) in source, and every address is on the Kohinoor domain', () => {
    for (const c of KOHINOOR_DEMO_CREDENTIALS) {
      expect(Object.keys(c).sort()).toEqual(['color', 'email', 'role', 'roleLabel']);
      expect(c.email.endsWith('@kohinoorpune.com')).toBe(true);
    }
    expect(JSON.stringify(KOHINOOR_DEMO_CREDENTIALS)).not.toMatch(/password|secret|token/i);
    expect(KOHINOOR_DEMO_PASSWORD_HINT).toMatch(/not stored in the app/i);
  });
});

import { devTenantFromHostname, loginTenantState } from './tenant';

describe('explicit per-tenant local-development hosts', () => {
  it('map only the two exact *.localhost names', () => {
    expect(devTenantFromHostname('kohinoor.localhost')).toBe('kohinoor');
    expect(devTenantFromHostname('MyHome.localhost.')).toBe('myhome');
    for (const h of ['localhost', 'evil.localhost', 'kohinoor.localhost.evil.com', 'x.kohinoor.localhost', '']) {
      expect(devTenantFromHostname(h)).toBeNull();
    }
  });

  it('decide the tenant on development builds only, and beat the query string', () => {
    expect(resolveTenantKey({ hostname: 'kohinoor.localhost', search: '?tenant=myhome', dev: true })).toBe('kohinoor');
    expect(resolveTenantKey({ hostname: 'myhome.localhost', search: '', dev: true })).toBe('myhome');
    expect(resolveTenantKey({ hostname: 'kohinoor.localhost', search: '', dev: false })).toBe('myhome'); // never on a production build
  });
});

describe('loginTenantState: the server is the authority', () => {
  const kohinoorServer = { multiTenant: true, tenant: 'kohinoor' as const };
  const myhomeServer = { multiTenant: true, tenant: 'myhome' as const };
  const legacyServer = { multiTenant: false, tenant: null };

  it('Kohinoor page + Kohinoor backend: shows Kohinoor accounts and allows sign-in', () => {
    expect(loginTenantState('kohinoor', kohinoorServer)).toEqual({ demoTenant: 'kohinoor', mismatch: false, blockSignIn: false, message: null });
  });

  it('My Home page + My Home backend: unchanged', () => {
    expect(loginTenantState('myhome', myhomeServer)).toEqual({ demoTenant: 'myhome', mismatch: false, blockSignIn: false, message: null });
  });

  it('My Home page against today\'s legacy single-tenant server or an old backend without /tenant: exactly as before', () => {
    expect(loginTenantState('myhome', legacyServer)).toEqual({ demoTenant: 'myhome', mismatch: false, blockSignIn: false, message: null });
    expect(loginTenantState('myhome', 'error').demoTenant).toBe('myhome');
    expect(loginTenantState('myhome', undefined).demoTenant).toBe('myhome');
  });

  it('Kohinoor page against a legacy / unreachable / unverified backend: no demo accounts, sign-in blocked, clear message', () => {
    for (const server of [legacyServer, 'error' as const]) {
      const st = loginTenantState('kohinoor', server);
      expect(st).toMatchObject({ demoTenant: null, mismatch: true, blockSignIn: true });
      expect(st.message).toMatch(/Kohinoor/);
    }
    expect(loginTenantState('kohinoor', undefined)).toMatchObject({ demoTenant: null, blockSignIn: false }); // still verifying: show nothing org-specific
  });

  it('a page and backend for DIFFERENT tenants never show demo accounts or allow sign-in (both directions)', () => {
    expect(loginTenantState('kohinoor', myhomeServer)).toMatchObject({ demoTenant: null, mismatch: true, blockSignIn: true });
    expect(loginTenantState('myhome', kohinoorServer)).toMatchObject({ demoTenant: null, mismatch: true, blockSignIn: true });
    expect(loginTenantState('kohinoor', { multiTenant: true, tenant: null })).toMatchObject({ blockSignIn: true });
  });
});

describe('e-mail routed server (one backend, tenant chosen from the e-mail domain at sign-in)', () => {
  const emailServer = { multiTenant: true, tenant: null, routing: 'email' as const };

  it('is a valid backend for either page, with that page\'s own demo accounts', () => {
    expect(loginTenantState('kohinoor', emailServer)).toEqual({ demoTenant: 'kohinoor', mismatch: false, blockSignIn: false, message: null });
    expect(loginTenantState('myhome', emailServer)).toEqual({ demoTenant: 'myhome', mismatch: false, blockSignIn: false, message: null });
  });

  it('a legacy single-tenant server is still refused for Kohinoor', () => {
    expect(loginTenantState('kohinoor', { multiTenant: false, tenant: null, routing: null })).toMatchObject({ blockSignIn: true, demoTenant: null });
  });

  it('a HOST-routed server that resolved another tenant is still a mismatch', () => {
    expect(loginTenantState('kohinoor', { multiTenant: true, tenant: 'myhome', routing: 'host' })).toMatchObject({ blockSignIn: true });
  });
});
