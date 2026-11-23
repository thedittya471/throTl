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
