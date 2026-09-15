import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'node:url';
import { createCorsOptions } from './src/config/cors.js';
import { createMarketplaceSupabaseRouter } from './src/routes/marketplace-supabase.js';

// Compatibility entry point for Render services that were previously configured with `node server.js`.
// `npm start` remains the canonical entry point and also exposes the same Supabase marketplace router.
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

  const healthPayload = () => ({
    ok: true,
    service: 'button-marketplace',
    marketplaceConfigured: Boolean(environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY),
    paymentProvider: String(environment.PAYMENT_PROVIDER || 'disabled').toLowerCase(),
  });
  app.get('/health', (_req, res) => res.json(healthPayload()));
  app.get('/api/health', (_req, res) => res.json(healthPayload()));

  // New collision-free namespace used by Update 13+ frontends.
  app.use('/api/marketplace', createMarketplaceSupabaseRouter(environment));
  // Backward compatibility for Update 1-12 HTML while a frontend deployment rolls over.
  // There are no legacy Prisma routes in this compatibility entry point, so aliases are safe here.
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
  app.listen(PORT, '0.0.0.0', () => console.log(`Button marketplace server running on port ${PORT}`));
}
