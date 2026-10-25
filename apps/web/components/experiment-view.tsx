'use client';

import { useId } from 'react';
import type { RunSnapshot } from '@ratelab/contracts';
import { buildTimeline } from '../lib/timeline';
import { DecisionInspector } from './decision-inspector';

export function ExperimentView({ run }: { run: RunSnapshot }) {
  const chartId = useId();
  const telemetry = run.telemetry;
  if (!telemetry) return <p className="run-note">Waiting for decision telemetry from the API.</p>;
  const chart = buildTimeline(telemetry.timeline);
  const latest = telemetry.recent.at(-1);
  const omitted = telemetry.evaluated - telemetry.recent.length;

  return (
    <section className="experiment-view" aria-labelledby={`${chartId}-heading`}>
      {run.instances && <section aria-label="Per-instance routing">
        <h3>Round-robin routing · independent local state</h3>
        <p>Each instance has its own allowance of {run.config.limit} per {run.config.windowMs} ms for one global key. {run.instances.length} instance(s) can admit up to {run.instances.length * run.config.limit} in one window.</p>
        <div className="table-scroll"><table>
          <caption>Real HTTP outcomes by target process. Failed targets stay in rotation; requests are not retried.</caption>
          <thead><tr><th scope="col">Instance</th><th scope="col">Dispatched</th><th scope="col">Allowed</th><th scope="col">429</th><th scope="col">Transport failed</th><th scope="col">Unknown decision</th></tr></thead>
          <tbody>{run.instances.map(({ id, counts }) => <tr key={id}><th scope="row">{id}</th><td>{counts.dispatched}</td><td>{counts.allowed}</td><td>{counts.rejected}</td><td>{counts.transportFailed}</td><td>{counts.unknownDecision}</td></tr>)}</tbody>
        </table></div>
      </section>}
      <h3 id={`${chartId}-heading`}>Allowed and rejected over time</h3>
      <p className="run-note">Received decision evidence in one-second intervals. {telemetry.allowed} allowed, {telemetry.rejected} rejected, {telemetry.evaluated} evaluated. Lost or invalid responses leave decision evidence unknown.</p>
      <p className="timeline-legend"><span>■ Allowed: solid</span><span>▨ Rejected: diagonal lines</span></p>
      {chart.bars.length === 0 ? <p>Waiting for the first evaluated request.</p> : <>
        <svg className="traffic-chart" viewBox="0 0 620 210" role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
          <title id={`${chartId}-title`}>Allowed and rejected requests by elapsed time</title>
          <desc id={`${chartId}-description`}>Stacked bars show request counts in one-second intervals. Solid bars are allowed; diagonal bars are rejected. Read exact values in the table below.</desc>
          <defs><pattern id={`${chartId}-rejected`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#f8e8d7" /><path d="M-1 1L1-1M0 6L6 0M5 7L7 5" stroke="#80502a" strokeWidth="2" />
          </pattern></defs>
          <path d="M35 10V155H595" className="chart-axis" />
          <text x="30" y="20" textAnchor="end">{chart.maxCount}</text>
          <text x="30" y="155" textAnchor="end">0</text>
          {chart.bars.map((bar) => <g key={bar.elapsedMs}>
            <title>{bar.elapsedMs / 1_000}–{bar.elapsedMs / 1_000 + 1} s: {bar.allowed} allowed, {bar.rejected} rejected</title>
            <rect x={bar.x} y={155 - bar.allowedHeight} width={bar.width} height={bar.allowedHeight} className="chart-allowed" />
            <rect x={bar.x} y={155 - bar.allowedHeight - bar.rejectedHeight} width={bar.width} height={bar.rejectedHeight} fill={`url(#${chartId}-rejected)`} />
          </g>)}
          <text x="35" y="178">{chart.startMs / 1_000} s</text>
          <text x="595" y="178" textAnchor="end">{chart.endMs / 1_000} s</text>
          <text x="315" y="200" textAnchor="middle">Elapsed time since run start (seconds)</text>
        </svg>
        <details className="timeline-table"><summary>Read exact timeline counts as a table</summary>
          <div className="table-scroll"><table>
            <caption>Received decisions per one-second interval. Missing intervals contain no received evidence.</caption>
            <thead><tr><th scope="col">Elapsed interval (s)</th><th scope="col">Allowed</th><th scope="col">Rejected</th></tr></thead>
            <tbody>{telemetry.timeline.map((point) => <tr key={point.elapsedMs}>
              <th scope="row">{point.elapsedMs / 1_000}–{point.elapsedMs / 1_000 + 1}</th><td>{point.allowed}</td><td>{point.rejected}</td>
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
      <p className="run-note">Timeline retains at most 120 nonempty one-second intervals. Earlier intervals can leave the view; aggregate totals above still cover all received decision evidence.</p>
      {latest && <section className="window-state" aria-labelledby={`${chartId}-window`}>
        <h3 id={`${chartId}-window`}>Window at the latest received decision</h3>
        <label htmlFor={`${chartId}-usage`}>Used allowance: {latest.decision.state.countAfter} / {run.config.limit} requests</label>
        <meter id={`${chartId}-usage`} min="0" max={run.config.limit} value={latest.decision.state.countAfter} />
        <p className="run-note">Instance {latest.instance ?? 'local'}. As of {latest.elapsedMs} ms after run start. Remaining: {latest.decision.remaining} requests. Window resets at {latest.decision.resetAtMs} Unix ms. State updates when a request is evaluated; this is not a live countdown.</p>
      </section>}
      <p className="detail-policy">{omitted > 0 ? 'Detail limited' : 'All evaluated details retained'}: showing {telemetry.recent.length} of {telemetry.evaluated} evaluated requests. {omitted} older details omitted. This is a recent excerpt, not a statistical sample; totals and retained timeline intervals include all evaluations.</p>
      <DecisionInspector recent={telemetry.recent} />
    </section>
  );
}
