import { defineConfig } from 'drizzle-kit';

const schema = './src/lib/server/schema.ts';

export default defineConfig(
  process.env.TURSO_DATABASE_URL
    ? { schema, dialect: 'turso', dbCredentials: { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN } }
    : { schema, dialect: 'sqlite', dbCredentials: { url: 'file:./data/topologio.db' } },
);
