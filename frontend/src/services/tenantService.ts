import apiClient from './apiClient';
import type { ServerTenantInfo } from '@/config/tenant';

/**
 * Ask the backend which tenant IT resolved for this request (from the Host header, server-side).
 * Throws on network/HTTP errors so the caller can treat "cannot confirm" as a failure.
 */
export async function fetchServerTenant(signal?: AbortSignal): Promise<ServerTenantInfo> {
  const { data } = await apiClient.get<{ multiTenant: boolean; tenant: string | null; routing?: string | null }>('/tenant', { timeout: 10_000, signal });
  const tenant = data.tenant === 'myhome' || data.tenant === 'kohinoor' ? data.tenant : null;
  const routing = data.routing === 'email' || data.routing === 'host' ? data.routing : null;
  return { multiTenant: Boolean(data.multiTenant), tenant, routing };
}
