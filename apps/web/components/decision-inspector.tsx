'use client';

import { useState } from 'react';
import type { DecisionDetail } from '@ratelab/contracts';

export function DecisionInspector({ recent }: { recent: DecisionDetail[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const detail = recent.find((entry) => entry.sequence === selected) ?? recent.at(-1);
  if (!detail) return <p>No evaluated requests yet.</p>;
  const { decision, sequence, elapsedMs } = detail;
  const state = decision.state;

  return (
    <section className="decision-inspector" aria-labelledby="inspector-heading">
      <h3 id="inspector-heading">Inspect a request</h3>
      <label htmlFor="decision-selection">Retained request (response completion order)</label>
      <select id="decision-selection" value={sequence} onChange={(event) => setSelected(Number(event.target.value))}>
        {recent.map((entry) => <option key={entry.sequence} value={entry.sequence}>
          #{entry.sequence} · {entry.elapsedMs} ms · {entry.decision.allowed ? 'Allowed' : 'Rejected'}
        </option>)}
      </select>
      <h4>Request #{sequence}: {decision.allowed ? 'Allowed' : 'Rejected (429)'}</h4>
      <p>{decision.allowed
        ? `The window held ${state.countBefore} of ${state.limit} allowed requests. This request consumed one allowance.`
        : `The window had reached its limit of ${state.limit}. This rejection did not increase the counter.`}</p>
      <dl className="decision-facts">
        <div><dt>Instance</dt><dd>{detail.instance ?? 'local'}</dd></div>
        <div><dt>Response since run start</dt><dd>{elapsedMs} ms</dd></div>
        <div><dt>Reason</dt><dd>{decision.reason === 'within_limit' ? 'Within limit' : 'Limit exhausted'}</dd></div>
        <div><dt>Counter before → after</dt><dd>{state.countBefore} → {state.countAfter} requests</dd></div>
        <div><dt>Remaining after decision</dt><dd>{decision.remaining} requests</dd></div>
        <div><dt>Window [start, end)</dt><dd>{state.windowStartMs} → {decision.resetAtMs} Unix ms</dd></div>
        <div><dt>Raw / effective clock</dt><dd>{state.rawTimeMs} / {state.effectiveTimeMs} Unix ms</dd></div>
        <div><dt>Clock rollback clamped</dt><dd>{state.clockClamped ? 'Yes' : 'No'}</dd></div>
        <div><dt>Advisory retry delay</dt><dd>{decision.retryAfterMs} ms</dd></div>
      </dl>
      <p className="run-note">Window end is excluded: a request exactly at the end starts a new window. A retry delay reserves no capacity. Selection stays on its request until it leaves the recent-detail buffer.</p>
    </section>
  );
}
