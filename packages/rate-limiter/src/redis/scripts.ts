export const FIXED_WINDOW_LUA = `
local key = KEYS[1]
local timestampMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowSizeMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local windowIndex = math.floor(timestampMs / windowSizeMs)
local windowKey = key .. ":" .. windowIndex
local windowStartMs = windowIndex * windowSizeMs
local resetTimeMs = windowStartMs + windowSizeMs

local current = tonumber(redis.call("GET", windowKey) or "0")
local allowed = 0
local remaining = 0
local retryAfterSec = 0

if current + cost <= limit then
  current = redis.call("INCRBY", windowKey, cost)
  if current == cost then
    redis.call("PEXPIRE", windowKey, math.max(60000, windowSizeMs * 2))
  end
  allowed = 1
  remaining = math.max(0, limit - current)
else
  allowed = 0
  remaining = math.max(0, limit - current)
  local diff = resetTimeMs - timestampMs
  retryAfterSec = math.max(1, math.ceil(diff / 1000))
end

return { allowed, remaining, resetTimeMs, retryAfterSec, current, limit, windowSizeMs, windowStartMs, resetTimeMs, windowIndex }
`;

export const SLIDING_LOG_LUA = `
local key = KEYS[1]
local timestampMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowSizeMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local threshold = timestampMs - windowSizeMs
redis.call("ZREMRANGEBYSCORE", key, "-inf", threshold)

local count = redis.call("ZCARD", key)
local allowed = 0
local remaining = 0
local resetTimeMs = timestampMs + windowSizeMs
local retryAfterSec = 0

if count + cost <= limit then
  local seq = redis.call("INCR", key .. ":seq")
  for i = 1, cost do
    redis.call("ZADD", key, timestampMs, tostring(timestampMs) .. ":" .. tostring(seq) .. ":" .. tostring(i))
  end
  redis.call("PEXPIRE", key, windowSizeMs + 5000)
  allowed = 1
  remaining = math.max(0, limit - (count + cost))
  count = count + cost
else
  allowed = 0
  remaining = math.max(0, limit - count)
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  if oldest and #oldest >= 2 then
    resetTimeMs = tonumber(oldest[2]) + windowSizeMs
    local diff = resetTimeMs - timestampMs
    retryAfterSec = math.max(1, math.ceil(diff / 1000))
  else
    retryAfterSec = 1
  end
end

return { allowed, remaining, resetTimeMs, retryAfterSec, count, limit, windowSizeMs }
`;

export const SLIDING_WINDOW_COUNTER_LUA = `
local key = KEYS[1]
local timestampMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowSizeMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local windowIndex = math.floor(timestampMs / windowSizeMs)
local windowStartMs = windowIndex * windowSizeMs
local resetTimeMs = windowStartMs + windowSizeMs
local elapsedMs = timestampMs - windowStartMs
local prevWeight = math.max(0, 1 - (elapsedMs / windowSizeMs))

local data = redis.call("HMGET", key, "windowIndex", "prevCount", "currCount")
local storedIndex = tonumber(data[1] or "-1")
local prevCount = tonumber(data[2] or "0")
local currCount = tonumber(data[3] or "0")

if storedIndex == windowIndex then
  -- Same window
elseif storedIndex == windowIndex - 1 then
  prevCount = currCount
  currCount = 0
else
  prevCount = 0
  currCount = 0
end

local estimated = (prevCount * prevWeight) + currCount
local allowed = 0
local remaining = 0
local retryAfterSec = 0

if estimated + cost <= limit then
  currCount = currCount + cost
  redis.call("HMSET", key, "windowIndex", windowIndex, "prevCount", prevCount, "currCount", currCount)
  redis.call("PEXPIRE", key, windowSizeMs * 2)
  allowed = 1
  local newEstimated = (prevCount * prevWeight) + currCount
  remaining = math.max(0, math.floor(limit - newEstimated))
else
  allowed = 0
  remaining = math.max(0, math.floor(limit - estimated))
  local diff = resetTimeMs - timestampMs
  retryAfterSec = math.max(1, math.ceil(diff / 1000))
end

return { allowed, remaining, resetTimeMs, retryAfterSec, prevCount, currCount, math.floor(estimated), math.floor(prevWeight * 1000) }
`;

export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local timestampMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillRatePerSec = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "lastRefillMs")
local tokens = tonumber(data[1])
local lastRefillMs = tonumber(data[2])

if not tokens or not lastRefillMs then
  tokens = capacity
  lastRefillMs = timestampMs
else
  local elapsedMs = math.max(0, timestampMs - lastRefillMs)
  local refilled = (elapsedMs / 1000) * refillRatePerSec
  tokens = math.min(capacity, tokens + refilled)
  lastRefillMs = timestampMs
end

local allowed = 0
local remaining = 0
local retryAfterSec = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
  remaining = math.max(0, math.floor(tokens))
else
  allowed = 0
  remaining = math.max(0, math.floor(tokens))
  local deficit = cost - tokens
  local waitMs = (deficit / refillRatePerSec) * 1000
  retryAfterSec = math.max(1, math.ceil(waitMs / 1000))
end

redis.call("HMSET", key, "tokens", tostring(tokens), "lastRefillMs", tostring(lastRefillMs))
local ttlMs = math.max(60000, math.ceil((capacity / refillRatePerSec) * 2000))
redis.call("PEXPIRE", key, ttlMs)

local msUntilFull = ((capacity - tokens) / refillRatePerSec) * 1000
local resetTimeMs = timestampMs + math.ceil(msUntilFull)

return { allowed, remaining, resetTimeMs, retryAfterSec, math.floor(tokens * 100), lastRefillMs }
`;

export const LEAKY_BUCKET_LUA = `
local key = KEYS[1]
local timestampMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local leakRatePerSec = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "level", "lastLeakMs")
local level = tonumber(data[1])
local lastLeakMs = tonumber(data[2])

if not level or not lastLeakMs then
  level = 0
  lastLeakMs = timestampMs
else
  local elapsedMs = math.max(0, timestampMs - lastLeakMs)
  local leaked = (elapsedMs / 1000) * leakRatePerSec
  level = math.max(0, level - leaked)
  lastLeakMs = timestampMs
end

local allowed = 0
local remaining = 0
local retryAfterSec = 0
local nextLevel = level + cost

if nextLevel <= capacity then
  level = nextLevel
  allowed = 1
  remaining = math.max(0, math.floor(capacity - level))
else
  allowed = 0
  remaining = math.max(0, math.floor(capacity - level))
  local overflow = nextLevel - capacity
  local waitMs = (overflow / leakRatePerSec) * 1000
  retryAfterSec = math.max(1, math.ceil(waitMs / 1000))
end

redis.call("HMSET", key, "level", tostring(level), "lastLeakMs", tostring(lastLeakMs))
local ttlMs = math.max(60000, math.ceil((capacity / leakRatePerSec) * 2000))
redis.call("PEXPIRE", key, ttlMs)

local msUntilEmpty = (level / leakRatePerSec) * 1000
local resetTimeMs = timestampMs + math.ceil(msUntilEmpty)

return { allowed, remaining, resetTimeMs, retryAfterSec, math.floor(level * 100), lastLeakMs }
`;
