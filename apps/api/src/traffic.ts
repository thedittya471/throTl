import { Agent, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { parseFixedWindowDecision, type FixedWindowDemoResponse, type RunConfig, type RunCounts } from '@ratelab/contracts';

export function createRunCounts(config: RunConfig): RunCounts {
  return {
    scheduled: Math.ceil(config.durationMs * config.ratePerSecond / 1_000),
    dispatched: 0, responseReceived: 0, allowed: 0, rejected: 0, unknownDecision: 0,
    transportFailed: 0, cancelled: 0, timedOut: 0, inFlight: 0,
    missed: 0, missedLate: 0, missedInFlight: 0, missedCancelled: 0,
  };
}

export async function generateTraffic({ config, counts, target, token, signal, onDraining,
  maxInFlight = 256, timeoutMs = 15_000, canDispatch = () => true, targets, onDecision, onUnavailable,
}: {
  config: RunConfig;
  counts: RunCounts;
  target: URL;
  targets?: { url: URL; id: string; counts: RunCounts }[];
  onDecision?: (decision: FixedWindowDemoResponse['decision'], instance: string) => void;
  onUnavailable?: () => void;
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

  let dispatched = 0;
  async function send() {
    const selected = targets?.[dispatched++ % targets.length];
    const counters = selected ? [counts, selected.counts] : [counts];
    if (selected) { selected.counts.scheduled++; selected.counts.dispatched++; selected.counts.inFlight++; }
    const increment = (key: keyof RunCounts) => { for (const counter of counters) counter[key]++; };
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const result = await new Promise<'allowed' | 'rejected' | 'unknownDecision'>((resolve, reject) => {
        const outgoing = request(selected?.url ?? target, {
          agent, headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([signal, deadline]),
        }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            if (body.length + chunk.length > 8_192) outgoing.destroy(new Error('TARGET_RESPONSE_TOO_LARGE'));
            else body += chunk;
          });
          response.on('error', reject);
          response.on('end', () => {
            if (response.statusCode === 503 && response.headers['x-ratelab-error'] === 'REDIS_UNAVAILABLE') {
              onUnavailable?.(); resolve('unknownDecision'); return;
            }
            if (onDecision && selected) {
              try {
                const evidence = JSON.parse(body) as FixedWindowDemoResponse;
                if (evidence.instance !== selected.id || evidence.version !== 1 || evidence.algorithm !== 'fixed-window' ||
                    response.statusCode !== (evidence.decision.allowed ? 200 : 429) ||
                    response.headers['x-ratelab-decision'] !== (evidence.decision.allowed ? 'allowed' : 'rejected')) throw new Error('INVALID_DECISION');
                parseFixedWindowDecision(evidence.decision);
                onDecision(evidence.decision, selected.id);
              } catch { resolve('unknownDecision'); return; }
            }
            const decision = response.headers['x-ratelab-decision'];
            resolve(response.statusCode === 200 && decision === 'allowed' ? 'allowed'
              : response.statusCode === 429 && decision === 'rejected' ? 'rejected' : 'unknownDecision');
          });
          response.resume();
        });
        outgoing.on('error', reject);
        outgoing.end();
      });
      increment('responseReceived');
      increment(result);
    } catch {
      increment('unknownDecision');
      if (signal.aborted) increment('cancelled');
      else if (deadline.aborted) increment('timedOut');
      else increment('transportFailed');
    } finally {
      for (const counter of counters) counter.inFlight--;
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
