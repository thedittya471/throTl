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
