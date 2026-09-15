const DEFAULT_ORIGINS = Object.freeze([
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://subtle-panda-e64c50.netlify.app',
]);

function cleanOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function allowedFrontendOrigins(environment = process.env) {
  const configured = [environment.FRONTEND_URL, environment.FRONTEND_URLS]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(cleanOrigin)
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

export function createCorsOptions(environment = process.env) {
  const allowed = allowedFrontendOrigins(environment);
  return {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin(origin, callback) {
      // Requests without Origin are server-to-server/health checks, not browser CORS requests.
      if (!origin) return callback(null, true);
      const normalized = cleanOrigin(origin);
      if (allowed.has(normalized)) return callback(null, true);
      const error = new Error('Origin is not allowed by Button CORS policy.');
      error.code = 'CORS_ORIGIN_DENIED';
      return callback(error);
    },
  };
}
