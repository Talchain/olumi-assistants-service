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
import { config, isProduction } from "../config/index.js";

/**
 * Singleton Redis client instance
 */
let redisClient: Redis | null = null;
let isInitialized = false;
let initializationError: Error | null = null;

/**
 * Get Redis configuration from centralized config
 */
function getRedisConfig(): RedisOptions | null {
  const redisUrl = config.redis.url;

  if (!redisUrl) {
    return null;
  }

  // Parse TLS setting (auto-detect from URL or explicit config)
  const enableTLS = config.redis.tls || redisUrl.startsWith("rediss://");

  const redisOptions: RedisOptions = {
    // Connection (use centralized config with defaults)
    connectTimeout: config.redis.connectTimeout,
    commandTimeout: config.redis.commandTimeout,

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
        rejectUnauthorized: isProduction(),
      },
    }),

    // Key prefix (namespace)
    keyPrefix: `${config.redis.namespace}:`,
  };

  return redisOptions;
}

/**
 * Initialize Redis client (lazy singleton)
 */
async function initializeRedis(): Promise<Redis | null> {
  if (isInitialized) {
    return redisClient;
  }

  const redisOptions = getRedisConfig();

  if (!redisOptions) {
    log.info("Redis not configured (REDIS_URL not set), using in-memory fallback");
    isInitialized = true;
    return null;
  }

  try {
    const redisUrl = config.redis.url!;
    const client = new Redis(redisUrl, redisOptions);

    // Set up event handlers
    client.on("error", (error: Error) => {
      log.error({ error }, "Redis error");
    });

    client.on("connect", () => {
      log.info(
        { namespace: redisOptions.keyPrefix, tls: !!redisOptions.tls },
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
        namespace: redisOptions.keyPrefix,
        tls: !!redisOptions.tls,
        connect_timeout: redisOptions.connectTimeout,
        command_timeout: redisOptions.commandTimeout,
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
