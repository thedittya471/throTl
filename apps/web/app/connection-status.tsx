'use client';

import { useEffect, useState } from 'react';
import { CONTRACT_VERSION, parseHealthResponse } from '@ratelab/contracts';

export function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'checking' | 'connected' | 'unavailable' | 'incompatible'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch('/api/health', {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
        });
        if (!response.ok) {
          if (!controller.signal.aborted) setState(response.status === 502 ? 'incompatible' : 'unavailable');
          return;
        }
        parseHealthResponse(await response.json());
        if (!controller.signal.aborted) setState('connected');
      } catch {
        if (!controller.signal.aborted) setState('unavailable');
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt]);

  const titles = {
    checking: 'Checking API connection…', connected: 'Your API is connected',
    unavailable: 'API is unavailable', incompatible: 'API versions do not match',
  };

  return (
    <section className="connection" aria-labelledby="connection-title" aria-busy={state === 'checking'}>
      <div className="connection-heading">
        <span className={`status-label ${state}`}><span className="status-dot" aria-hidden="true" />{state === 'connected' ? 'CONNECTED' : state === 'checking' ? 'CHECKING' : 'NEEDS ATTENTION'}</span>
        <span className="protocol">PROTOCOL v{CONTRACT_VERSION}</span>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="connection-title">{titles[state]}</h2>
        <p className="connection-description">{state === 'connected'
          ? 'The Express server responded with a valid health check. Your frontend and backend are talking.'
          : state === 'checking' ? 'Sending a health request to your RateLab backend.'
          : state === 'incompatible' ? 'Restart both apps from the same checkout, then check the connection again.'
          : 'Start the API in a separate terminal. If it is already running, check its port and the web app’s API_ORIGIN setting.'}</p>
      </div>
      <div className="terminal"><span className="terminal-label">FROM THE PROJECT ROOT</span><code><span aria-hidden="true">$ </span>npm run dev:api</code></div>
      <div className="connection-bottom">
        <p>{state === 'connected' ? 'This confirms connectivity, not simulator readiness.' : 'No database or external service is needed for this check.'}</p>
        <button type="button" disabled={state === 'checking'} onClick={() => { setState('checking'); setAttempt((value) => value + 1); }}>
          {state === 'checking' ? 'Checking…' : 'Check connection'}<span aria-hidden="true"> ↗</span>
        </button>
      </div>
    </section>
  );
}
