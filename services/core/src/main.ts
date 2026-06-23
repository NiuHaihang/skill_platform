import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // ── Startup Guard: JWT secrets must be set in production ─────────────
  // Fail fast rather than silently using an obvious placeholder that allows
  // anyone to forge tokens.
  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = process.env.JWT_SECRET ?? '';
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET ?? '';
    const obviousDefaults = ['CHANGE_ME', 'secret', 'your-secret', ''];
    if (obviousDefaults.some((d) => jwtSecret.toLowerCase().includes(d.toLowerCase()) && d !== ''
        ? true : jwtSecret.length < 32)) {
      throw new Error(
        'FATAL: JWT_SECRET is missing or too weak for production. ' +
        'Generate one with: openssl rand -hex 64',
      );
    }
    if (jwtRefreshSecret.length < 32) {
      throw new Error(
        'FATAL: JWT_REFRESH_SECRET is missing or too weak for production. ' +
        'Generate one with: openssl rand -hex 64',
      );
    }
  }

  const app = await NestFactory.create(AppModule, {
    // Disable default logger — we use Pino.
    bufferLogs: true,
  });

  // ── Structured Logger (Pino) ──────────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ── Global Exception Filter ───────────────────────────────────────────
  // Must be registered before other global pipes/guards so it catches all
  // exceptions from the entire request lifecycle.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // ── CORS ─────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Global Validation Pipe ────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // Strip unknown fields.
      forbidNonWhitelisted: true, // Throw on unknown fields.
      transform: true,          // Auto-transform types.
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── API Versioning ────────────────────────────────────────────────────
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ── Global Prefix ─────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger Documentation ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SkillForge API')
      .setDescription('SkillForge platform REST API — AI Agent & Skill Marketplace')
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Health Check Endpoint ─────────────────────────────────────────────
  // Simple root health check for load balancers.
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: any, res: any) => {
    res.json({ status: 'ok', service: 'skillforge-core', version: '0.1.0' });
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`SkillForge Core Service listening on port ${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();
