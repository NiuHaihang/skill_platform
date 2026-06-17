import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export const databaseConfig = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: config.get<string>('DATABASE_URL'),

  // Entity auto-discovery.
  entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],

  // Migration management.
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',

  // IMPORTANT: Never use synchronize: true in production.
  // Use migrations to manage schema changes.
  synchronize: false,

  // Run migrations automatically on startup.
  // In production, prefer running migrations separately before deploying.
  migrationsRun: config.get('NODE_ENV') === 'development',

  // SSL for production.
  ssl: config.get('NODE_ENV') === 'production'
    ? { rejectUnauthorized: false }
    : false,

  // Logging for development.
  logging: config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],

  // Connection pool settings.
  extra: {
    max: 10,           // Max connections in pool.
    min: 2,            // Min connections.
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});
