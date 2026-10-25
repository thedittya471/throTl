'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ExperimentView } from '../components/experiment-view';
import { watchRun } from '../lib/run-stream';
import { DEFAULT_RUN_CONFIG, parseRunConfig, parseRunSnapshot, type RunSnapshot } from '@ratelab/contracts';

const fields = [
  { name: 'ratePerSecond', label: 'Requests per second', min: 1, max: 1_000 },
  { name: 'durationMs', label: 'Duration (milliseconds)', min: 100, max: 120_000 },
  { name: 'limit', label: 'Allowed requests per window', min: 1, max: 1_000 },
  { name: 'windowMs', label: 'Window length (milliseconds)', min: 1, max: 60_000 },
] as const;

export function RunSimulator() {
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = run !== null && !['completed', 'stopped'].includes(run.status);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void watchRun(token, AbortSignal.any([controller.signal, AbortSignal.timeout(140_000)]), (snapshot) => {
      if (controller.signal.aborted) return;
      // Reconnect snapshots replace totals; old streams cannot overwrite a new or stopped run.
      setRun((previous) => previous?.id !== snapshot.id || previous.status === 'stopped' ? previous : snapshot);
      setError('');
    }, (connected) => {
      if (!controller.signal.aborted) setError(connected ? '' : 'Stream disconnected. Reconnecting; the run stops after 15 seconds without a stream.');
    });
    return () => controller.abort();
  }, [token]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const config = parseRunConfig(Object.fromEntries(fields.map(({ name }) => [name, Number(data.get(name))])));
      const response = await fetch('/api/runs', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
        signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error('Could not start. Check the API and available run capacity.');
      const result = await response.json();
      if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error('Invalid run credential');
      setRun(parseRunSnapshot(result.run));
      setToken(result.token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the run.');
    } finally { setPending(false); }
  }

  async function stop() {
    if (!token) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/runs', { method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error('Could not stop. Check the API and retry Stop.');
      setRun(parseRunSnapshot(await response.json()));
    } catch {
      setError('Could not confirm Stop. Check the API and retry; runs are limited to two minutes.');
    } finally { setPending(false); }
  }

  return (
    <section className="simulator" aria-labelledby="run-heading">
      <div className="page-label"><span className="section-number">02</span> FIRST EXPERIMENT</div>
      <h2 id="run-heading">Watch a fixed window fill up.</h2>
      <p className="connection-description">Steady traffic · one client · one instance · global allowance. Each run starts with fresh state and sends real HTTP requests to your demo API.</p>
      <form onSubmit={start}>
        <fieldset disabled={pending || active}>
          <legend>Experiment settings</legend>
          <div className="run-fields">
            {fields.map(({ name, label, min, max }) => (
              <label key={name} htmlFor={name}>{label}
                <input id={name} name={name} type="number" min={min} max={max} step="1" required defaultValue={DEFAULT_RUN_CONFIG[name]} />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="run-actions">
          <button type="submit" disabled={pending || active}>{pending && !active ? 'Starting…' : 'Start steady run'}</button>
          <button type="button" onClick={stop} disabled={pending || !active}>{pending && active ? 'Stopping…' : 'Stop run'}</button>
          <p role="status">{run ? `Run ${run.status}` : 'Ready for your first run'}</p>
        </div>
      </form>
      {error && <p className="run-error" role="alert">{error}</p>}
      {run && <>
        <p className="run-note">Run {run.id} · {run.config.ratePerSecond} requests/s for {run.config.durationMs} ms · {run.config.limit} allowed / {run.config.windowMs} ms</p>
        <dl className="run-counts">
          {([
            ['Scheduled', run.counts.scheduled], ['Dispatched', run.counts.dispatched],
            ['Completed attempts', run.counts.dispatched - run.counts.inFlight],
            ['Responses received', run.counts.responseReceived], ['Allowed', run.counts.allowed],
            ['Rejected (429)', run.counts.rejected], ['Missed schedule', run.counts.missed],
            ['In flight', run.counts.inFlight], ['Transport failures', run.counts.transportFailed],
            ['Cancelled', run.counts.cancelled], ['Timed out', run.counts.timedOut],
            ['Unknown decisions', run.counts.unknownDecision],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <ExperimentView key={run.id} run={run} />
        <p className="run-note">Missed: {run.counts.missedLate} late, {run.counts.missedInFlight} at capacity, {run.counts.missedCancelled} cancelled before dispatch. Completed attempts include received responses, transport failures, cancellations, and timeouts. Live snapshots replace totals on reconnect.</p>
      </>}
    </section>
  );
}
