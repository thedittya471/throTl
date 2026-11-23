import { createHash } from "node:crypto";
import { Redis } from "ioredis";

export class LuaScriptManager {
  private redis: Redis;
  private scripts = new Map<string, { code: string; sha: string }>();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async registerScript(name: string, scriptText: string): Promise<string> {
    const trimmed = scriptText.trim();
    const sha = createHash("sha1").update(trimmed).digest("hex");

    await this.redis.script("LOAD", trimmed);
    this.scripts.set(name, { code: trimmed, sha });

    return sha;
  }

  async runScript<T = unknown>(
    name: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<T> {
    const script = this.scripts.get(name);

    if (!script) {
      throw new Error(`Lua script "${name}" is not registered.`);
    }

    try {
      const result = await this.redis.evalsha(
        script.sha,
        keys.length,
        ...keys,
        ...args
      );
      return result as T;
    } catch (err: any) {
      if (err?.message?.includes("NOSCRIPT")) {
        const reloadedSha = (await this.redis.script("LOAD", script.code)) as string;
        script.sha = reloadedSha;

        const result = await this.redis.evalsha(
          script.sha,
          keys.length,
          ...keys,
          ...args
        );
        return result as T;
      }

      throw err;
    }
  }

  hasScript(name: string): boolean {
    return this.scripts.has(name);
  }
}
