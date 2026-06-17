-- SkillForge PostgreSQL initialization script
-- This runs automatically when the PostgreSQL container starts for the first time.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "vector";   -- pgvector for embeddings

-- Set timezone
SET timezone = 'UTC';
