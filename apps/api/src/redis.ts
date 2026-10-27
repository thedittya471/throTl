import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import type { RunConfig } from '@ratelab/contracts';
import { parseFixedWindowDecision } from '@ratelab/contracts';

// One script owns read/check/update/expiry; application-level GET then SET would race.
const fixedWindowScript = `
local time = redis.call('TIME')
local rawTimeMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local previous = redis.call('HMGET', KEYS[1], 'start', 'count', 'time')
local effectiveTimeMs = math.max(rawTimeMs, tonumber(previous[3]) or rawTimeMs)
local windowMs = tonumber(ARGV[2])
local windowStartMs = effectiveTimeMs - effectiveTimeMs % windowMs

local countBefore = 0
if tonumber(previous[1]) == windowStartMs then
  countBefore = tonumber(previous[2])
end

local allowed = 0
if countBefore < tonumber(ARGV[1]) then
  allowed = 1
end

local countAfter = countBefore + allowed
redis.call('HSET', KEYS[1], 'start', windowStartMs, 'count', countAfter, 'time', effectiveTimeMs)
redis.call('PEXPIRE', KEYS[1], ARGV[3])

return {allowed, countBefore, countAfter, windowStartMs, rawTimeMs, effectiveTimeMs}
`;

export function sharedWindowKey(token: string) {
  const run = createHash('sha256').update(token).digest('hex');

  return `ratelab:{${run}}:fixed-window:global`;
}

export function readRedisUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.REDIS_URL === undefined) {
    return undefined;
  }

  try {
    const url = new URL(env.REDIS_URL);

    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      url.hash ||
      url.search
    ) {
      throw new Error();
    }

    return env.REDIS_URL;
  } catch {
    throw new Error('REDIS_URL must be a Redis connection URL');
  }
}

export function createSharedWindowStore(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 2_048,
    commandOptions: { timeout: 1_000 },
    socket: {
      connectTimeout: 1_000,
      reconnectStrategy: false,
    },
  });

  let connectionGeneration = 0;

  client.on('error', () => {
    connectionGeneration++;
  });

  let connectionPromise: Promise<unknown> | undefined;

  async function register(token: string, config: RunConfig) {
    if (!client.isReady) {
      // Concurrent registrations must share the same connection attempt.
      if (connectionPromise === undefined) {
        connectionPromise = client.connect().finally(() => {
          connectionPromise = undefined;
        });
      }

      await connectionPromise;
    }

    await client.ping();
    const registeredGeneration = connectionGeneration;

    return {
      async check() {
        // An old run cannot resume on a new connection after Redis may have lost state.
        if (registeredGeneration !== connectionGeneration) {
          throw new Error('REDIS_UNAVAILABLE');
        }

        try {
          const values = await client.eval(fixedWindowScript, {
            keys: [sharedWindowKey(token)],
            arguments: [
              String(config.limit),
              String(config.windowMs),
              String(config.durationMs + 30_000),
            ],
          });

          if (!Array.isArray(values) || values.length !== 6 || values.some((value) => typeof value !== 'number')) {
            throw new Error('INVALID_REDIS_REPLY');
          }

          const [
            admitted,
            countBefore,
            countAfter,
            windowStartMs,
            rawTimeMs,
            effectiveTimeMs,
          ] = values as [number, number, number, number, number, number];

          const allowed = admitted === 1;
          const resetAtMs = windowStartMs + config.windowMs;

          return parseFixedWindowDecision({
            allowed,
            reason: allowed ? 'within_limit' : 'limit_exhausted',
            remaining: config.limit - countAfter,
            resetAtMs,
            retryAfterMs: allowed ? 0 : resetAtMs - rawTimeMs,
            state: {
              limit: config.limit,
              windowStartMs,
              countBefore,
              countAfter,
              rawTimeMs,
              effectiveTimeMs,
              clockClamped: rawTimeMs !== effectiveTimeMs,
            },
          });
        } catch {
          connectionGeneration++;

          if (client.isOpen) {
            client.destroy();
          }

          throw new Error('REDIS_UNAVAILABLE');
        }
      },
    };
  }

  return {
    register,
    async remove(token: string) {
      await client.del(sharedWindowKey(token));
    },
    close() {
      if (client.isOpen) {
        client.destroy();
      }
    },
  };
}

export type SharedWindowStore = ReturnType<typeof createSharedWindowStore>;
