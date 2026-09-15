import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'node:url';
import { createCorsOptions } from './src/config/cors.js';
import { createMarketplaceSupabaseRouter } from './src/routes/marketplace-supabase.js';

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

  const marketplaceConfigured = () => Boolean(environment.SUPABASE_URL && (environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY));
  const healthPayload = () => ({
    ok: true,
    service: 'button-marketplace',
    marketplaceConfigured: marketplaceConfigured(),
    paymentProvider: String(environment.PAYMENT_PROVIDER || 'disabled').toLowerCase(),
  });
  app.get('/health', (_req, res) => res.json(healthPayload()));
  app.get('/api/health', (_req, res) => res.json(healthPayload()));
  const readyHandler = (_req, res) => {
    const ready = marketplaceConfigured();
    res.status(ready ? 200 : 503).json({ ...healthPayload(), ok: ready, ready });
  };
  app.get('/ready', readyHandler);
  app.get('/api/ready', readyHandler);

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
  const configured = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
  const paymentProvider = String(process.env.PAYMENT_PROVIDER || 'disabled').toLowerCase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Button marketplace server running on port ${PORT}`);
    console.log(`Button readiness: marketplaceConfigured=${configured} paymentProvider=${paymentProvider}`);
  });
}
