import type { Request, Response } from "express";
import { MetricAggregator, type AggregatedTick } from "../metrics/index.js";

export interface StreamManagerConfig {
  heartbeatIntervalMs?: number;
  retryIntervalMs?: number;
}

export class MetricsStreamManager {
  private clients: Set<Response> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private aggregator?: MetricAggregator;
  private onTickBound?: (tick: AggregatedTick) => void;
  readonly heartbeatIntervalMs: number;
  readonly retryIntervalMs: number;

  constructor(aggregator?: MetricAggregator, config: StreamManagerConfig = {}) {
    this.aggregator = aggregator;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 15_000;
    this.retryIntervalMs = config.retryIntervalMs ?? 1000;

    if (this.aggregator) {
      this.attachAggregator(this.aggregator);
    }
    this.startHeartbeat();
  }

  attachAggregator(aggregator: MetricAggregator): void {
    if (this.aggregator && this.onTickBound) {
      this.aggregator.off("tick", this.onTickBound);
    }
    this.aggregator = aggregator;
    this.onTickBound = (tick: AggregatedTick) => this.broadcastTick(tick);
    this.aggregator.on("tick", this.onTickBound);
  }

  handleClient(req: Request, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`retry: ${this.retryIntervalMs}\n\n`);
    res.write(`: connected\n\n`);

    this.clients.add(res);

    const cleanup = () => {
      this.clients.delete(res);
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
  }

  broadcastTick(tick: AggregatedTick): void {
    if (this.clients.size === 0) return;
    const payload = `id: ${tick.tickId}\ndata: ${JSON.stringify(tick)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  broadcastHeartbeat(): void {
    if (this.clients.size === 0) return;
    const comment = `: ping ${Date.now()}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(comment);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  clientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.aggregator && this.onTickBound) {
      this.aggregator.off("tick", this.onTickBound);
    }
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Ignore client error on close
      }
    }
    this.clients.clear();
  }
}
