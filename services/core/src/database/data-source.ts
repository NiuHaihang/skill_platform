import { DataSource } from 'typeorm';
import { join } from 'path';

// For CLI usage, ensure .env is loaded via ts-node/tsconfig-paths.
// The DATABASE_URL should be set in the shell environment or .env file.

// This DataSource is used by the TypeORM CLI for migrations.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});

