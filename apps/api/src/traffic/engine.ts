import { EventEmitter } from "node:events";

export type TrafficPattern =
  | "steady"
  | "burst"
  | "ramp-up"
  | "sawtooth"
  | "window-boundary"
  | "heavy-client";

export interface TrafficEngineConfig {
  pattern?: TrafficPattern;
  targetRps?: number;
  clientCount?: number;
  clientId?: string;
  cost?: number;
  durationMs?: number;
  windowSizeMs?: number;
  burstMultiplier?: number;
  burstDurationMs?: number;
  burstPeriodMs?: number;
  rampDurationMs?: number;
  minRps?: number;
  maxRps?: number;
  seed?: number;
  route?: string;
  tickIntervalMs?: number;
  onRequest?: (event: TrafficEvent) => void | Promise<void>;
}

export interface TrafficEvent {
  clientId: string;
  timestampMs: number;
  cost: number;
  route: string;
  pattern: TrafficPattern;
  sequence: number;
}

export interface TrafficStats {
  totalEmitted: number;
  currentRps: number;
  elapsedMs: number;
  pattern: TrafficPattern;
  activeClients: number;
  clientDistribution: Record<string, number>;
}

function createSeededRandom(seed: number = 1337): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TrafficEngine extends EventEmitter {
  readonly config: Required<Omit<TrafficEngineConfig, "onRequest">> & {
    onRequest?: (event: TrafficEvent) => void | Promise<void>;
  };

  private running: boolean = false;
  private paused: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private startHrtime: bigint = 0n;
  private lastTickHrtime: bigint = 0n;
  private startEpochMs: number = 0;
  private totalEmitted: number = 0;
  private sequence: number = 0;
  private accumulator: number = 0;
  private clientPool: string[] = [];
  private clientDistribution: Map<string, number> = new Map();
  private rng: () => number;

  constructor(config: TrafficEngineConfig = {}) {
    super();

    this.config = {
      pattern: config.pattern ?? "steady",
      targetRps: config.targetRps ?? 1000,
      clientCount: config.clientCount ?? 1000,
      clientId: config.clientId ?? "",
      cost: config.cost ?? 1,
      durationMs: config.durationMs ?? 0,
      windowSizeMs: config.windowSizeMs ?? 60_000,
      burstMultiplier: config.burstMultiplier ?? 5,
      burstDurationMs: config.burstDurationMs ?? 2_000,
      burstPeriodMs: config.burstPeriodMs ?? 10_000,
      rampDurationMs: config.rampDurationMs ?? 30_000,
      minRps: config.minRps ?? 10,
      maxRps: config.maxRps ?? 1000,
      seed: config.seed ?? 1337,
      route: config.route ?? "/api/check",
      tickIntervalMs: config.tickIntervalMs ?? 2,
      onRequest: config.onRequest,
    };

    this.rng = createSeededRandom(this.config.seed);
    this.initClientPool();
  }

  private initClientPool(): void {
    if (this.config.clientId) {
      this.clientPool = [this.config.clientId];
      return;
    }
    this.clientPool = Array.from(
      { length: this.config.clientCount },
      (_, i) => `client-${String(i + 1).padStart(3, "0")}`
    );
  }

  calculateCurrentRps(elapsedMs: number): number {
    switch (this.config.pattern) {
      case "steady":
        return this.config.targetRps;

      case "burst": {
        const cycle = elapsedMs % this.config.burstPeriodMs;
        if (cycle < this.config.burstDurationMs) {
          return this.config.targetRps * this.config.burstMultiplier;
        }
        return this.config.targetRps;
      }

      case "ramp-up": {
        const progress = Math.min(1, elapsedMs / this.config.rampDurationMs);
        return this.config.minRps + (this.config.maxRps - this.config.minRps) * progress;
      }

      case "sawtooth": {
        const cycle = (elapsedMs % this.config.rampDurationMs) / this.config.rampDurationMs;
        return this.config.minRps + (this.config.maxRps - this.config.minRps) * cycle;
      }

      case "window-boundary": {
        const pos = elapsedMs % this.config.windowSizeMs;
        if (pos >= this.config.windowSizeMs - 2000 || pos < 2000) {
          return this.config.targetRps;
        }
        return this.config.minRps;
      }

      case "heavy-client":
        return this.config.targetRps;

      default:
        return this.config.targetRps;
    }
  }

  private selectClientId(): string {
    if (this.config.pattern === "heavy-client") {
      if (this.rng() < 0.8) {
        return this.clientPool[0];
      }
      const idx = 1 + Math.floor(this.rng() * (this.clientPool.length - 1));
      return this.clientPool[idx] || this.clientPool[0];
    }

    const idx = Math.floor(this.rng() * this.clientPool.length);
    return this.clientPool[idx];
  }

  private tick(): void {
    if (!this.running || this.paused) return;

    const nowHr = process.hrtime.bigint();
    const dtSec = Number(nowHr - this.lastTickHrtime) / 1e9;
    this.lastTickHrtime = nowHr;

    const elapsedMs = Number((nowHr - this.startHrtime) / 1_000_000n);

    if (this.config.durationMs > 0 && elapsedMs >= this.config.durationMs) {
      this.stop();
      return;
    }

    const currentRps = this.calculateCurrentRps(elapsedMs);
    this.accumulator += currentRps * dtSec;

    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    for (let i = 0; i < count; i++) {
      const eventTimeMs = this.startEpochMs + elapsedMs;
      const clientId = this.selectClientId();

      this.sequence++;
      this.totalEmitted++;
      this.clientDistribution.set(
        clientId,
        (this.clientDistribution.get(clientId) || 0) + 1
      );

      const event: TrafficEvent = {
        clientId,
        timestampMs: eventTimeMs,
        cost: this.config.cost,
        route: this.config.route,
        pattern: this.config.pattern,
        sequence: this.sequence,
      };

      if (this.config.onRequest) {
        this.config.onRequest(event);
      }
      this.emit("request", event);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.startHrtime = process.hrtime.bigint();
    this.lastTickHrtime = this.startHrtime;
    this.startEpochMs = Date.now();
    this.accumulator = 0;

    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
    this.emit("start");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit("stop", this.getStats());
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.emit("pause");
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTickHrtime = process.hrtime.bigint();
    this.emit("resume");
  }

  reset(): void {
    this.stop();
    this.totalEmitted = 0;
    this.sequence = 0;
    this.accumulator = 0;
    this.clientDistribution.clear();
    this.rng = createSeededRandom(this.config.seed);
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getClientPool(): readonly string[] {
    return this.clientPool;
  }

  getStats(): TrafficStats {
    const elapsedMs =
      this.running && this.startHrtime > 0n
        ? Number((process.hrtime.bigint() - this.startHrtime) / 1_000_000n)
        : 0;

    const distribution: Record<string, number> = {};
    for (const [k, v] of this.clientDistribution.entries()) {
      distribution[k] = v;
    }

    return {
      totalEmitted: this.totalEmitted,
      currentRps: this.calculateCurrentRps(elapsedMs),
      elapsedMs,
      pattern: this.config.pattern,
      activeClients: this.clientDistribution.size,
      clientDistribution: distribution,
    };
  }
}
