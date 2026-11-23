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
