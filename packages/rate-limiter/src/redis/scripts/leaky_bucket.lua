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
