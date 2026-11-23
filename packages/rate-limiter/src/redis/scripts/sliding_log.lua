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
