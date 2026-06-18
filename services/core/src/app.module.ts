import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SkillsModule } from './skills/skills.module';
import { AgentsModule } from './agents/agents.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { SkillGeneratorModule } from './skill-generator/skill-generator.module';
import { LlmGatewayModule } from './llm-gateway/llm-gateway.module';
import { SandboxModule } from './sandbox/sandbox.module';

import { databaseConfig } from './database/database.config';
import appConfig from './config/app.config';

@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      // __dirname = services/core/src — go up 3 levels to reach the monorepo root
      envFilePath: [
        join(__dirname, '..', '..', '..', '.env.local'),
        join(__dirname, '..', '..', '..', '.env'),
      ],
    }),

    // ── Structured Logging (Pino) ────────────────────────────────────────
    LoggerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          redact: ['req.headers.authorization'], // Don't log auth tokens.
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url,
              id: req.id,
            }),
          },
        },
      }),
      inject: [ConfigService],
    }),

    // ── Database (TypeORM + PostgreSQL) ──────────────────────────────────
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => databaseConfig(config),
      inject: [ConfigService],
    }),

    // ── Rate Limiting ────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'short',
            ttl: 1000,    // 1 second
            limit: config.get('THROTTLE_SHORT_LIMIT', 20),
          },
          {
            name: 'medium',
            ttl: 60000,   // 1 minute
            limit: config.get('THROTTLE_MEDIUM_LIMIT', 100),
          },
          {
            name: 'long',
            ttl: 3600000, // 1 hour
            limit: config.get('THROTTLE_LONG_LIMIT', 1000),
          },
        ],
      }),
      inject: [ConfigService],
    }),

    // ── Feature Modules ──────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    SkillsModule,
    AgentsModule,
    ConversationsModule,
    MarketplaceModule,
    SkillGeneratorModule,
    LlmGatewayModule,
    SandboxModule,
  ],
})
export class AppModule {}
