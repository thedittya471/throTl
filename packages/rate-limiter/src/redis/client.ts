import { Redis, RedisOptions } from "ioredis";

export interface RedisClientConfig {
  url?: string;
  options?: RedisOptions;
}

export class RedisClientManager {
  private client: Redis;

  constructor(config: RedisClientConfig = {}) {
    const url = config.url || process.env.REDIS_URL || "redis://localhost:6379";

    const defaultOptions: RedisOptions = {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 1000,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 100, 2000),
      ...config.options,
    };

    this.client = new Redis(url, defaultOptions);
    this.client.on("error", () => {});
  }

  getClient(): Redis {
    return this.client;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client.status !== "end") {
      await this.client.quit();
    }
  }
}
