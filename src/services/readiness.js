import { marketplaceConfiguration, supabaseAdminHeaders, supabaseBackendHeaders } from './supabase-marketplace.js';

export async function probeMarketplaceAdmin(environment = process.env, fetchImpl = fetch) {
  const configuration = marketplaceConfiguration(environment);
  if (!configuration.marketplaceAdminConfigured) return { reachable: false, mode: 'not_configured' };

  if (configuration.adminKey) {
    const response = await fetchImpl(`${configuration.url}/rest/v1/orders?select=id&limit=1`, {
      headers: supabaseAdminHeaders(configuration.adminKey),
    });
    if (!response.ok) throw new Error(`admin_key_http_${response.status}`);
    return { reachable: true, mode: 'admin_key' };
  }

  const response = await fetchImpl(`${configuration.url}/rest/v1/rpc/button_backend_ping`, {
    method: 'POST',
    headers: supabaseBackendHeaders(configuration.publicKey, configuration.backendSecret, { 'Content-Type': 'application/json' }),
    body: '{}',
  });
  if (!response.ok) throw new Error(`shared_secret_http_${response.status}`);
  const result = await response.json();
  if (result !== true) throw new Error('shared_secret_unexpected_response');
  return { reachable: true, mode: 'shared_secret' };
}
