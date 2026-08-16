import { Redis } from "ioredis";
import { env } from "./config/env.js";

let shared: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!shared) {
    shared = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return shared;
}

export function createRedisConnection(): Redis {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is required for this operation");
  }
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
