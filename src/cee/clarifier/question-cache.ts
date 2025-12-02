import { getRedis, isRedisAvailable } from "../../platform/redis.js";
import { log } from "../../utils/telemetry.js";
import type { QuestionType } from "./question-selector.js";

const CACHE_PREFIX = "clarifier:question:";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export interface CachedQuestion {
  question: string;
  question_type: QuestionType;
  options?: string[];
  targets_ambiguity: string;
  generated_at: string;
}

// In-memory fallback when Redis is not available
const memoryCache = new Map<string, { data: CachedQuestion; expires: number }>();

function cleanExpiredFromMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expires < now) {
      memoryCache.delete(key);
    }
  }
}

export async function cacheQuestion(
  questionId: string,
  data: CachedQuestion,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = `${CACHE_PREFIX}${questionId}`;

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
      log.debug({ question_id: questionId, ttl_seconds: ttlSeconds }, "Question cached in Redis");
    } else {
      // Fallback to in-memory cache
      cleanExpiredFromMemory();
      memoryCache.set(questionId, {
        data,
        expires: Date.now() + ttlSeconds * 1000,
      });
      log.debug({ question_id: questionId, ttl_seconds: ttlSeconds }, "Question cached in memory (Redis unavailable)");
    }
  } catch (error) {
    log.warn({ error, question_id: questionId }, "Failed to cache question, using in-memory fallback");
    memoryCache.set(questionId, {
      data,
      expires: Date.now() + ttlSeconds * 1000,
    });
  }
}

export async function retrieveQuestion(
  questionId: string
): Promise<CachedQuestion | null> {
  const key = `${CACHE_PREFIX}${questionId}`;

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      const raw = await redis.get(key);
      if (!raw) {
        log.debug({ question_id: questionId }, "Question not found in Redis cache");
        return null;
      }
      log.debug({ question_id: questionId }, "Question retrieved from Redis cache");
      return JSON.parse(raw) as CachedQuestion;
    }

    // Fallback to in-memory cache
    cleanExpiredFromMemory();
    const entry = memoryCache.get(questionId);
    if (!entry || entry.expires < Date.now()) {
      memoryCache.delete(questionId);
      log.debug({ question_id: questionId }, "Question not found in memory cache");
      return null;
    }
    log.debug({ question_id: questionId }, "Question retrieved from memory cache");
    return entry.data;
  } catch (error) {
    log.warn({ error, question_id: questionId }, "Failed to retrieve question from cache");

    // Try memory fallback
    const entry = memoryCache.get(questionId);
    if (entry && entry.expires >= Date.now()) {
      return entry.data;
    }
    return null;
  }
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const key = `${CACHE_PREFIX}${questionId}`;

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      await redis.del(key);
    }

    // Also clean from memory cache
    memoryCache.delete(questionId);
  } catch (error) {
    log.warn({ error, question_id: questionId }, "Failed to delete question from cache");
    memoryCache.delete(questionId);
  }
}

// For testing: clear all cached questions
export function clearQuestionCache(): void {
  memoryCache.clear();
}
