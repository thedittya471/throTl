import {
  MAX_DECISION_DETAILS,
  MAX_TIMELINE_POINTS,
  type RunTelemetry,
  type FixedWindowDemoResponse,
} from '@ratelab/contracts';

export function createRunTelemetry(now = performance.now.bind(performance)) {
  const startedAt = now();

  const data: RunTelemetry = {
    evaluated: 0,
    allowed: 0,
    rejected: 0,
    timeline: [],
    recent: [],
  };

  function record(
    decision: FixedWindowDemoResponse['decision'],
    instance?: string,
  ) {
    const elapsedMs = Math.max(0, Math.floor(now() - startedAt));
    const bucketStartMs = Math.floor(elapsedMs / 1_000) * 1_000;
    const outcome = decision.allowed ? 'allowed' : 'rejected';

    data.evaluated++;
    data[outcome]++;

    let timelinePoint = data.timeline.at(-1);

    if (!timelinePoint || timelinePoint.elapsedMs !== bucketStartMs) {
      timelinePoint = {
        elapsedMs: bucketStartMs,
        allowed: 0,
        rejected: 0,
      };

      data.timeline.push(timelinePoint);

      if (data.timeline.length > MAX_TIMELINE_POINTS) {
        data.timeline.shift();
      }
    }

    timelinePoint[outcome]++;

    data.recent.push({
      sequence: data.evaluated,
      elapsedMs,
      decision,
      ...(instance === undefined ? {} : { instance }),
    });

    if (data.recent.length > MAX_DECISION_DETAILS) {
      data.recent.shift();
    }
  }

  return { data, record };
}
