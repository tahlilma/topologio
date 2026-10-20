import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // libsql ships native bindings for local SQLite files.
  serverExternalPackages: ['@libsql/client', 'libsql'],
};

export default config;
