import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { RedisClientManager, LuaScriptManager } from "../dist/index.js";

describe("RedisClientManager & LuaScriptManager", () => {
  const manager = new RedisClientManager({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  });
  const redis = manager.getClient();
  const lua = new LuaScriptManager(redis);

  after(async () => {
    await manager.close();
  });

  it("successfully connects to redis and responds to ping", async () => {
    const healthy = await manager.checkHealth();
    assert.equal(healthy, true);
  });

  it("loads and executes lua scripts via EVALSHA atomically", async () => {
    const script = `
      local key = KEYS[1]
      local increment = tonumber(ARGV[1])
      local current = redis.call("INCRBY", key, increment)
      return {key, current}
    `;

    const sha = await lua.registerScript("test_increment", script);
    assert.equal(typeof sha, "string");
    assert.equal(sha.length, 40);

    const testKey = "test:ratelab:evalsha";
    await redis.del(testKey);

    const result1 = await lua.runScript<[string, number]>("test_increment", [testKey], [5]);
    assert.deepEqual(result1, [testKey, 5]);

    const result2 = await lua.runScript<[string, number]>("test_increment", [testKey], [10]);
    assert.deepEqual(result2, [testKey, 15]);

    await redis.del(testKey);
  });

  it("automatically recovers from NOSCRIPT errors", async () => {
    const script = `return "recovered"`;
    await lua.registerScript("recover_test", script);

    // Flush script cache in Redis
    await redis.script("FLUSH");

    // Should catch NOSCRIPT, reload script, and return result
    const result = await lua.runScript<string>("recover_test", [], []);
    assert.equal(result, "recovered");
  });
});
