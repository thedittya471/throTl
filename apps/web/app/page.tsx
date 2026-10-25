import Link from 'next/link';
import { ConnectionStatus } from './connection-status';

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
        <p className="intro">Explore how rate limiters shape traffic. First, connect your local API—the starting point for real HTTP experiments.</p>
        <ConnectionStatus />
        <section className="next-step" aria-labelledby="next-heading">
          <div className="section-number" aria-hidden="true">02</div>
          <div><h2 id="next-heading">Next: your first limiter</h2><p>The fixed-window engine comes next. Simulation controls will appear as the engine is implemented.</p></div>
          <span className="tag">Not built yet</span>
        </section>
        <footer><span>Real requests. Explainable decisions.</span><span>Local development workspace</span></footer>
      </main>
    </div>
  );
}
