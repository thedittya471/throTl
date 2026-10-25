import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import type { RunConfig } from '@ratelab/contracts';
import { parseFixedWindowDecision } from '@ratelab/contracts';

// One script owns read/check/update/expiry; application-level GET then SET would race.
const fixedWindowScript = `
local time = redis.call('TIME')
local raw = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local previous = redis.call('HMGET', KEYS[1], 'start', 'count', 'time')
local effective = math.max(raw, tonumber(previous[3]) or raw)
local window = tonumber(ARGV[2])
local start = effective - effective % window
local before = 0
if tonumber(previous[1]) == start then before = tonumber(previous[2]) end
local allowed = before < tonumber(ARGV[1]) and 1 or 0
local after = before + allowed
redis.call('HSET', KEYS[1], 'start', start, 'count', after, 'time', effective)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {allowed, before, after, start, raw, effective}
`;

export function sharedWindowKey(token: string) {
  const run = createHash('sha256').update(token).digest('hex');
  return `ratelab:{${run}}:fixed-window:global`;
}

export function readRedisUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.REDIS_URL === undefined) return undefined;
  try {
    const url = new URL(env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.hash || url.search) throw new Error();
    return env.REDIS_URL;
  } catch { throw new Error('REDIS_URL must be a Redis connection URL'); }
}

export function createSharedWindowStore(url: string) {
  const client = createClient({ url, disableOfflineQueue: true, commandsQueueMaxLength: 2_048,
    commandOptions: { timeout: 1_000 }, socket: { connectTimeout: 1_000, reconnectStrategy: false } });
  let generation = 0;
  client.on('error', () => { generation++; });
  let connecting: Promise<unknown> | undefined;
  async function register(token: string, config: RunConfig) {
    if (!client.isReady) {
      connecting ??= client.connect().finally(() => { connecting = undefined; });
      await connecting;
    }
    await client.ping();
    const registeredGeneration = generation;
    return {
      async check() {
        // An old run cannot resume on a new connection after Redis may have lost state.
        if (registeredGeneration !== generation) throw new Error('REDIS_UNAVAILABLE');
        try {
          const values = await client.eval(fixedWindowScript, { keys: [sharedWindowKey(token)],
            arguments: [String(config.limit), String(config.windowMs), String(config.durationMs + 30_000)] });
          if (!Array.isArray(values) || values.length !== 6 || values.some((value) => typeof value !== 'number')) {
            throw new Error('INVALID_REDIS_REPLY');
          }
          const [admitted, countBefore, countAfter, windowStartMs, rawTimeMs, effectiveTimeMs] = values as [number, number, number, number, number, number];
          const allowed = admitted === 1;
          return parseFixedWindowDecision({ allowed, reason: allowed ? 'within_limit' : 'limit_exhausted',
            remaining: config.limit - countAfter, resetAtMs: windowStartMs + config.windowMs,
            retryAfterMs: allowed ? 0 : windowStartMs + config.windowMs - rawTimeMs,
            state: { limit: config.limit, windowStartMs, countBefore, countAfter, rawTimeMs, effectiveTimeMs,
              clockClamped: rawTimeMs !== effectiveTimeMs } });
        } catch {
          generation++;
          if (client.isOpen) client.destroy();
          throw new Error('REDIS_UNAVAILABLE');
        }
      },
    };
  }
  return { register,
    async remove(token: string) { await client.del(sharedWindowKey(token)); },
    close() { if (client.isOpen) client.destroy(); },
  };
}
export type SharedWindowStore = ReturnType<typeof createSharedWindowStore>;
