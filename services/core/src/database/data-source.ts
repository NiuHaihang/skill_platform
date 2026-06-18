import { DataSource } from 'typeorm';
import { join } from 'path';
import { config } from 'dotenv';

// Load environment variables for CLI usage.
// Tries .env.local first, then falls back to .env.
config({ path: join(__dirname, '../../../../.env.local') });
config({ path: join(__dirname, '../../../../.env') });

// This DataSource is used by the TypeORM CLI for migrations.
// The application runtime uses database.config.ts via NestJS ConfigModule.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});

export default AppDataSource;
