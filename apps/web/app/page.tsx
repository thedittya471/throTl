import Link from 'next/link';
import { ConnectionStatus } from './connection-status';
import { RunSimulator } from './run-simulator';

export default function Home() {
  return (
    <div className="workspace">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="RateLab home"><span aria-hidden="true">▥</span> RateLab</Link>
        <span className="topbar-note">A lab for understanding traffic</span>
      </header>
      <main id="main">
        <div className="page-label"><span className="section-number">01</span> WORKSPACE SETUP</div>
        <h1>Every request<br />has a decision.</h1>
        <p className="intro">Explore how rate limiters shape traffic. Connect your local API, then run a steady experiment and inspect the results.</p>
        <ConnectionStatus />
        <RunSimulator />
        <footer><span>Real requests. Explainable decisions.</span><span>Local development workspace</span></footer>
      </main>
    </div>
  );
}
