import { Pool } from 'pg';
import Redis from 'ioredis';

const globalForInfra = globalThis as unknown as {
  pgPool?: Pool;
  redisClient?: Redis;
};

export const pool =
  globalForInfra.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 15,
    idleTimeoutMillis: 30000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForInfra.pgPool = pool;
}

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!globalForInfra.redisClient) {
    globalForInfra.redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }
  return globalForInfra.redisClient;
}