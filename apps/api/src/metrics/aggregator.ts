import { EventEmitter } from "node:events";
import { RingBuffer } from "./ring-buffer.js";

export interface MetricRecord {
  allowed: boolean;
  decisionLatencyNs: number;
  remaining: number;
  limit?: number;
  instanceId?: string;
  clientId?: string;
  route?: string;
  timestampMs?: number;
  internalState?: Record<string, any>;
}

export interface InstanceMetricStats {
  total: number;
  allowed: number;
  rejected: number;
}

export interface AggregatedTick {
  tickId: number;
  timestampMs: number;
  windowDurationMs: number;
  totalCount: number;
  allowedCount: number;
  rejectedCount: number;
  allowRatio: number;
  p50LatencyNs: number;
  p90LatencyNs: number;
  p99LatencyNs: number;
  avgLatencyNs: number;
  instanceDistribution: Record<string, InstanceMetricStats>;
  internalStateSnapshot?: Record<string, any>;
  recentSamples: MetricRecord[];
}

export interface AggregatorConfig {
  tickIntervalMs?: number;
  sampleBufferSize?: number;
  onTick?: (tick: AggregatedTick) => void;
}

export class MetricAggregator extends EventEmitter {
  readonly config: Required<Omit<AggregatorConfig, "onTick">> & {
    onTick?: (tick: AggregatedTick) => void;
  };

  private ringBuffer: RingBuffer<MetricRecord>;
  private running: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private tickId: number = 0;

  // Window accumulators
  private totalCount: number = 0;
  private allowedCount: number = 0;
  private rejectedCount: number = 0;
  private latencies: number[] = [];
  private totalLatencyNs: number = 0;
  private instanceStats: Map<string, InstanceMetricStats> = new Map();
  private latestInternalState?: Record<string, any>;

  constructor(config: AggregatorConfig = {}) {
    super();

    this.config = {
      tickIntervalMs: config.tickIntervalMs ?? 100,
      sampleBufferSize: config.sampleBufferSize ?? 100,
      onTick: config.onTick,
    };

    this.ringBuffer = new RingBuffer<MetricRecord>(this.config.sampleBufferSize);
  }

  record(metric: MetricRecord): void {
    this.totalCount++;
    if (metric.allowed) {
      this.allowedCount++;
    } else {
      this.rejectedCount++;
    }

    const latency = metric.decisionLatencyNs || 0;
    this.latencies.push(latency);
    this.totalLatencyNs += latency;

    const inst = metric.instanceId || "instance-1";
    let stats = this.instanceStats.get(inst);
    if (!stats) {
      stats = { total: 0, allowed: 0, rejected: 0 };
      this.instanceStats.set(inst, stats);
    }
    stats.total++;
    if (metric.allowed) {
      stats.allowed++;
    } else {
      stats.rejected++;
    }

    if (metric.internalState) {
      this.latestInternalState = metric.internalState;
    }

    this.ringBuffer.push(metric);
  }

  flush(): AggregatedTick {
    const now = Date.now();
    const durationMs = this.lastTickTime > 0 ? now - this.lastTickTime : this.config.tickIntervalMs;
    this.lastTickTime = now;
    this.tickId++;

    const count = this.totalCount;
    let p50 = 0;
    let p90 = 0;
    let p99 = 0;
    let avg = 0;

    if (this.latencies.length > 0) {
      this.latencies.sort((a, b) => a - b);
      const len = this.latencies.length;
      p50 = this.latencies[Math.floor(len * 0.5)];
      p90 = this.latencies[Math.min(len - 1, Math.floor(len * 0.9))];
      p99 = this.latencies[Math.min(len - 1, Math.floor(len * 0.99))];
      avg = Math.round(this.totalLatencyNs / len);
    }

    const distribution: Record<string, InstanceMetricStats> = {};
    for (const [k, v] of this.instanceStats.entries()) {
      distribution[k] = { ...v };
    }

    const tick: AggregatedTick = {
      tickId: this.tickId,
      timestampMs: now,
      windowDurationMs: durationMs,
      totalCount: count,
      allowedCount: this.allowedCount,
      rejectedCount: this.rejectedCount,
      allowRatio: count > 0 ? this.allowedCount / count : 1,
      p50LatencyNs: p50,
      p90LatencyNs: p90,
      p99LatencyNs: p99,
      avgLatencyNs: avg,
      instanceDistribution: distribution,
      internalStateSnapshot: this.latestInternalState,
      recentSamples: this.ringBuffer.toArray(),
    };

    // Reset current window accumulator
    this.totalCount = 0;
    this.allowedCount = 0;
    this.rejectedCount = 0;
    this.latencies = [];
    this.totalLatencyNs = 0;
    this.instanceStats.clear();

    return tick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = Date.now();

    this.timer = setInterval(() => {
      const tick = this.flush();
      if (this.config.onTick) {
        this.config.onTick(tick);
      }
      this.emit("tick", tick);
    }, this.config.tickIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.stop();
    this.totalCount = 0;
    this.allowedCount = 0;
    this.rejectedCount = 0;
    this.latencies = [];
    this.totalLatencyNs = 0;
    this.instanceStats.clear();
    this.latestInternalState = undefined;
    this.ringBuffer.clear();
    this.tickId = 0;
    this.lastTickTime = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  getRingBuffer(): RingBuffer<MetricRecord> {
    return this.ringBuffer;
  }
}
