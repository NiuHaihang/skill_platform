import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  // JWT
  // IMPORTANT: These values MUST be set via environment variables in production.
  // main.ts startup guard will reject the app if JWT_SECRET is weak or missing in production.
  // For local dev, set them in .env.local (use: openssl rand -hex 64).
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // Database
  database: {
    url: process.env.DATABASE_URL,
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // Sandbox Service
  sandbox: {
    apiUrl: process.env.SANDBOX_API_URL || 'http://localhost:8194',
    apiKey: process.env.SANDBOX_API_KEY || 'sk-sandbox-dev',
    timeoutMs: parseInt(process.env.SANDBOX_TIMEOUT_MS || '120000', 10),
  },

  // MinIO
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'skillforge_minio',
    secretKey: process.env.MINIO_SECRET_KEY || '',
    bucket: process.env.MINIO_BUCKET || 'skillforge-assets',
  },

  // LLM Providers
  llm: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    defaultModel: process.env.LLM_DEFAULT_MODEL || 'gpt-4o',
    routerModel: process.env.LLM_ROUTER_MODEL || 'gpt-4o-mini',
  },

  // CORS
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  },

  // Rate Limiting
  throttle: {
    shortLimit: parseInt(process.env.THROTTLE_SHORT_LIMIT || '20', 10),
    mediumLimit: parseInt(process.env.THROTTLE_MEDIUM_LIMIT || '100', 10),
    longLimit: parseInt(process.env.THROTTLE_LONG_LIMIT || '1000', 10),
  },
}));
