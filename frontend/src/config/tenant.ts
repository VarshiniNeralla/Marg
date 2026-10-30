/**
 * Which organization's login experience to show.
 *
 * DISPLAY HINT ONLY. The server decides the real tenant from the request Host header and an e-mail
 * domain allowlist, and rejects mismatches; nothing here grants access to anything. Used to choose
 * which demo accounts the (development-only) login panel lists.
 */
export type TenantKey = 'myhome' | 'kohinoor';

const DOMAINS: Record<TenantKey, string> = {
  myhome: 'myhomeconstructions.com',
  kohinoor: 'kohinoorpune.com',
};

// Exact hosts only (no wildcards), mirroring the backend allowlist: apex, www, api, app.
const HOST_TENANTS: Record<string, TenantKey> = Object.fromEntries(
  (Object.keys(DOMAINS) as TenantKey[]).flatMap((key) =>
    ['', 'www.', 'api.', 'app.'].map((prefix) => [`${prefix}${DOMAINS[key]}`, key] as const),
  ),
);

export function tenantFromHostname(hostname: string | undefined | null): TenantKey | null {
  const host = (hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
  return HOST_TENANTS[host] ?? null;
}

/** Explicit per-tenant local-development hosts (development builds only). */
const DEV_HOST_TENANTS: Record<string, TenantKey> = {
  'myhome.localhost': 'myhome',
  'kohinoor.localhost': 'kohinoor',
};

export function devTenantFromHostname(hostname: string | undefined | null): TenantKey | null {
  return DEV_HOST_TENANTS[(hostname ?? '').trim().toLowerCase().replace(/\.$/, '')] ?? null;
}

function asTenantKey(value: string | undefined | null): TenantKey | null {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'myhome' || v === 'kohinoor' ? v : null;
}

export interface ResolveTenantOptions {
  hostname?: string;
  search?: string;
  /** Development build? Defaults to !import.meta.env.PROD. */
  dev?: boolean;
  /** VITE_TENANT (development convenience). */
  envTenant?: string;
}

/**
 * 1. An approved production hostname decides it.
 * 2. Development builds only: the explicit hosts myhome.localhost / kohinoor.localhost, then (localhost,
 *    tunnels, LAN) `?tenant=kohinoor` or VITE_TENANT.
 * 3. Otherwise My Home, so the existing experience never changes.
 */
export function resolveTenantKey(opts: ResolveTenantOptions = {}): TenantKey {
  const hostname = opts.hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const dev = opts.dev ?? !import.meta.env.PROD;
  const envTenant = opts.envTenant ?? (import.meta.env.VITE_TENANT as string | undefined);

  const fromHost = tenantFromHostname(hostname);
  if (fromHost) return fromHost;
  if (dev) {
    const fromDevHost = devTenantFromHostname(hostname);
    if (fromDevHost) return fromDevHost;
    const fromQuery = asTenantKey(new URLSearchParams(search).get('tenant'));
    if (fromQuery) return fromQuery;
    const fromEnv = asTenantKey(envTenant);
    if (fromEnv) return fromEnv;
  }
  return 'myhome';
}

/** What the backend answered to GET /tenant. */
export interface ServerTenantInfo {
  multiTenant: boolean;
  tenant: TenantKey | null;
  /** 'email': the server picks the tenant from the e-mail domain at login; 'host': from the Host header. */
  routing?: 'host' | 'email' | null;
}

/** undefined = still asking; 'error' = could not be reached. */
export type ServerTenantState = ServerTenantInfo | 'error' | undefined;

export interface LoginTenantState {
  /** Which demo-account list may be shown (null = none). */
  demoTenant: TenantKey | null;
  /** The page's tenant and the backend's tenant disagree, or cannot be confirmed. */
  mismatch: boolean;
  /** Refuse to submit credentials to a backend that would authenticate them against another organization. */
  blockSignIn: boolean;
  message: string | null;
}

const NAMES: Record<TenantKey, string> = { myhome: 'My Home', kohinoor: 'Kohinoor' };

/**
 * The server is the authority. A page configured for an organization must never offer that organization's
 * sign-in or demo accounts while talking to a backend that would use a different database.
 * My Home against a legacy single-tenant server keeps working exactly as before (no tenant-aware server needed).
 */
export function loginTenantState(hint: TenantKey, server: ServerTenantState): LoginTenantState {
  const ok = (demoTenant: TenantKey | null): LoginTenantState => ({ demoTenant, mismatch: false, blockSignIn: false, message: null });
  const bad = (message: string): LoginTenantState => ({ demoTenant: null, mismatch: true, blockSignIn: true, message });
  if (server === undefined) return ok(hint === 'myhome' ? 'myhome' : null); // verifying: show nothing org-specific except the legacy default
  if (server === 'error') {
    return hint === 'myhome' ? ok('myhome') : bad(`Cannot confirm that this server is the ${NAMES[hint]} backend, so sign-in is disabled.`);
  }
  if (!server.multiTenant) {
    return hint === 'myhome'
      ? ok('myhome')
      : bad(`This page is for ${NAMES[hint]}, but the server it is connected to is not tenant-aware and would sign you in against a different database. Sign-in is disabled.`);
  }
  // E-mail routing: this one backend serves every tenant and chooses the database from the e-mail domain at sign-in
  // (an address on an unknown domain is refused by the server), so any page may use it.
  if (server.routing === 'email') return ok(hint);
  if (server.tenant === hint) return ok(hint);
  return bad(`This page is for ${NAMES[hint]}, but the server resolved ${server.tenant ? NAMES[server.tenant] : 'no tenant'} for this address. Sign-in is disabled.`);
}
