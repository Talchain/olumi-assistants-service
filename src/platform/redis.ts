/**
 * Redis Client Platform Layer
 *
 * Lazy singleton with health probe and graceful fallback.
 * Configuration via environment variables:
 * - REDIS_URL: Connection string (redis://host:port or rediss://host:port for TLS)
 * - REDIS_TLS: true|false (default: auto-detect from URL scheme)
 * - REDIS_NAMESPACE: Key prefix (default: "olumi")
 * - REDIS_CONNECT_TIMEOUT: Connection timeout in ms (default: 10000)
 * - REDIS_COMMAND_TIMEOUT: Command timeout in ms (default: 5000)
 */

import { Redis, type RedisOptions } from "ioredis";
import { log } from "../utils/telemetry.js";

const DEFAULT_NAMESPACE = "olumi";
const DEFAULT_CONNECT_TIMEOUT = 10000;
const DEFAULT_COMMAND_TIMEOUT = 5000;

/**
 * Singleton Redis client instance
 */
let redisClient: Redis | null = null;
let isInitialized = false;
let initializationError: Error | null = null;

/**
 * Get Redis configuration from environment
 */
function getRedisConfig(): RedisOptions | null {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return null;
  }

  // Parse TLS setting (auto-detect from URL or explicit env var)
  const enableTLS =
    process.env.REDIS_TLS === "true" ||
    (process.env.REDIS_TLS !== "false" && redisUrl.startsWith("rediss://"));

  const config: RedisOptions = {
    // Connection
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT) ||
      DEFAULT_CONNECT_TIMEOUT,
    commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT) ||
      DEFAULT_COMMAND_TIMEOUT,

    // Reconnection strategy
    retryStrategy(times: number) {
      const delay = Math.min(times * 100, 3000);
      log.warn({ attempt: times, delay_ms: delay }, "Redis reconnecting");
      return delay;
    },

    // Lazy connect (connect on first command)
    lazyConnect: true,

    // TLS
    ...(enableTLS && {
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
    }),

    // Key prefix (namespace)
    keyPrefix: `${process.env.REDIS_NAMESPACE || DEFAULT_NAMESPACE}:`,
  };

  return config;
}

/**
 * Initialize Redis client (lazy singleton)
 */
async function initializeRedis(): Promise<Redis | null> {
  if (isInitialized) {
    return redisClient;
  }

  const config = getRedisConfig();

  if (!config) {
    log.info("Redis not configured (REDIS_URL not set), using in-memory fallback");
    isInitialized = true;
    return null;
  }

  try {
    const redisUrl = process.env.REDIS_URL!;
    const client = new Redis(redisUrl, config);

    // Set up event handlers
    client.on("error", (error: Error) => {
      log.error({ error }, "Redis error");
    });

    client.on("connect", () => {
      log.info(
        { namespace: config.keyPrefix, tls: !!config.tls },
        "Redis connected"
      );
    });

    client.on("ready", () => {
      log.info("Redis ready");
    });

    client.on("reconnecting", () => {
      log.warn("Redis reconnecting");
    });

    client.on("close", () => {
      log.warn("Redis connection closed");
    });

    // Attempt connection
    await client.connect();

    // Health check
    await client.ping();

    redisClient = client;
    isInitialized = true;

    log.info(
      {
        namespace: config.keyPrefix,
        tls: !!config.tls,
        connect_timeout: config.connectTimeout,
        command_timeout: config.commandTimeout,
      },
      "Redis initialized successfully"
    );

    return client;
  } catch (error) {
    initializationError = error as Error;
    isInitialized = true;

    log.error(
      { error },
      "Redis initialization failed, falling back to in-memory storage"
    );

    return null;
  }
}

/**
 * Get Redis client instance (lazy initialization)
 * Returns null if Redis is not configured or failed to connect
 */
export async function getRedis(): Promise<Redis | null> {
  if (!isInitialized) {
    return await initializeRedis();
  }

  return redisClient;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return isInitialized && redisClient !== null && redisClient.status === "ready";
}

/**
 * Health probe for Redis connection
 * Returns true if Redis is available and responding
 */
export async function redisHealthProbe(): Promise<boolean> {
  try {
    const client = await getRedis();
    if (!client) {
      return false;
    }

    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      log.info("Redis connection closed gracefully");
    } catch (error) {
      log.error({ error }, "Error closing Redis connection");
    } finally {
      redisClient = null;
      isInitialized = false;
    }
  }
}

/**
 * Reset Redis client state (for testing)
 */
export function resetRedis(): void {
  if (redisClient) {
    redisClient.disconnect();
  }
  redisClient = null;
  isInitialized = false;
  initializationError = null;
}

/**
 * Get initialization error (if any)
 */
export function getRedisInitError(): Error | null {
  return initializationError;
}
