import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'node:url';
import { createCorsOptions } from './src/config/cors.js';
import { createMarketplaceSupabaseRouter } from './src/routes/marketplace-supabase.js';
import { marketplaceConfiguration, supabaseAdminHeaders, supabaseBackendHeaders } from './src/services/supabase-marketplace.js';

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

export function createApp(environment = process.env) {
  const app = express();
  app.use(helmet());
  app.use(cors(createCorsOptions(environment)));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
  }));

  const healthPayload = () => {
    const configuration = marketplaceConfiguration(environment);
    return {
      ok: true,
      service: 'button-marketplace',
      marketplaceConfigured: configuration.marketplaceConfigured,
      marketplaceAdminConfigured: configuration.marketplaceAdminConfigured,
      paymentProvider: String(environment.PAYMENT_PROVIDER || 'disabled').toLowerCase(),
    };
  };
  app.get('/health', (_req, res) => res.json(healthPayload()));
  app.get('/api/health', (_req, res) => res.json(healthPayload()));

  const readyHandler = (_req, res) => {
    const payload = healthPayload();
    const ready = payload.marketplaceConfigured;
    res.status(ready ? 200 : 503).json({ ...payload, ok: ready, ready });
  };
  app.get('/ready', readyHandler);
  app.get('/api/ready', readyHandler);

  const adminReadyHandler = async (_req, res) => {
    const payload = healthPayload();
    try {
      const admin = await probeMarketplaceAdmin(environment);
      const ready = Boolean(admin.reachable);
      res.status(ready ? 200 : 503).json({
        ...payload,
        ok: ready,
        ready,
        marketplaceAdminReachable: ready,
        marketplaceAdminMode: admin.mode,
      });
    } catch (error) {
      console.error('Button privileged readiness check failed:', error?.message || error);
      res.status(503).json({
        ...payload,
        ok: false,
        ready: false,
        marketplaceAdminReachable: false,
        code: 'MARKETPLACE_ADMIN_UNREACHABLE',
      });
    }
  };
  app.get('/ready/admin', adminReadyHandler);
  app.get('/api/ready/admin', adminReadyHandler);

  app.use('/api/marketplace', createMarketplaceSupabaseRouter(environment));
  app.use('/api', createMarketplaceSupabaseRouter(environment));

  app.use((req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
  app.use((error, _req, res, _next) => {
    console.error('Button compatibility server error:', error);
    res.status(error?.code === 'CORS_ORIGIN_DENIED' ? 403 : 500).json({
      error: error?.code === 'CORS_ORIGIN_DENIED' ? 'Origin not allowed' : 'Internal server error',
      code: error?.code || 'SERVER_ERROR',
    });
  });
  return app;
}

export const app = createApp();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3000;
  const configuration = marketplaceConfiguration(process.env);
  const paymentProvider = String(process.env.PAYMENT_PROVIDER || 'disabled').toLowerCase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Button marketplace server running on port ${PORT}`);
    console.log(`Button readiness: marketplaceConfigured=${configuration.marketplaceConfigured} marketplaceAdminConfigured=${configuration.marketplaceAdminConfigured} paymentProvider=${paymentProvider}`);
    probeMarketplaceAdmin(process.env)
      .then(result => console.log(`Button admin readiness: reachable=${result.reachable} mode=${result.mode}`))
      .catch(error => console.error(`Button admin readiness: reachable=false code=${error?.message || 'ADMIN_CONNECTION_FAILED'}`));
  });
}
