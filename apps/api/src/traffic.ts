import { Agent, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { RunConfig, RunCounts } from '@ratelab/contracts';

export function createRunCounts(config: RunConfig): RunCounts {
  return {
    scheduled: Math.ceil(config.durationMs * config.ratePerSecond / 1_000),
    dispatched: 0, responseReceived: 0, allowed: 0, rejected: 0, unknownDecision: 0,
    transportFailed: 0, cancelled: 0, timedOut: 0, inFlight: 0,
    missed: 0, missedLate: 0, missedInFlight: 0, missedCancelled: 0,
  };
}

export async function generateTraffic({ config, counts, target, token, signal, onDraining,
  maxInFlight = 256, timeoutMs = 15_000, canDispatch = () => true,
}: {
  config: RunConfig;
  counts: RunCounts;
  target: URL;
  token: string;
  signal: AbortSignal;
  onDraining: () => void;
  maxInFlight?: number;
  timeoutMs?: number;
  canDispatch?: () => boolean;
}) {
  const agent = new Agent({ keepAlive: true, maxSockets: maxInFlight });
  const pending = new Set<Promise<void>>();
  const startedAt = performance.now();
  let slot = 0;

  async function send() {
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const result = await new Promise<'allowed' | 'rejected' | 'unknownDecision'>((resolve, reject) => {
        const outgoing = request(target, {
          agent, headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([signal, deadline]),
        }, (response) => {
          response.on('error', reject);
          response.on('end', () => {
            const decision = response.headers['x-ratelab-decision'];
            resolve(response.statusCode === 200 && decision === 'allowed' ? 'allowed'
              : response.statusCode === 429 && decision === 'rejected' ? 'rejected' : 'unknownDecision');
          });
          response.resume();
        });
        outgoing.on('error', reject);
        outgoing.end();
      });
      counts.responseReceived++;
      counts[result]++;
    } catch {
      counts.unknownDecision++;
      if (signal.aborted) counts.cancelled++;
      else if (deadline.aborted) counts.timedOut++;
      else counts.transportFailed++;
    } finally {
      counts.inFlight--;
    }
  }

  try {
    for (; slot < counts.scheduled && !signal.aborted; slot++) {
      const dueAt = startedAt + slot * 1_000 / config.ratePerSecond;
      const waitMs = dueAt - performance.now();
      if (waitMs > 0) {
        try { await delay(waitMs, undefined, { signal }); }
        catch { break; }
      }
      if (signal.aborted) break;
      if (performance.now() - dueAt > 100) {
        counts.missed++;
        counts.missedLate++;
      } else if (pending.size >= maxInFlight || !canDispatch()) {
        counts.missed++;
        counts.missedInFlight++;
      } else {
        counts.dispatched++;
        counts.inFlight++;
        const task = send().finally(() => pending.delete(task));
        pending.add(task);
      }
    }
    counts.missedCancelled += counts.scheduled - slot;
    counts.missed += counts.scheduled - slot;
    onDraining();
    await Promise.all(pending);
  } finally {
    agent.destroy();
  }
}
