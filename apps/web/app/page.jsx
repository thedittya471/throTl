import ConnectionStatus from "./connection-status.jsx";
import AuthForm from "./auth-form.jsx";

export default function Home() {
  return (
    <main>
      <header>
        <p className="eyebrow">THE RATE LIMITING LAB</p>
        <h1>throTl<span aria-hidden="true">.</span></h1>
        <p className="intro">Understand the limits. Build the algorithms.</p>
      </header>
      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Start with a connection</h2>
        <p>Check that the API and PostgreSQL are ready before building your first experiment.</p>
        <ConnectionStatus />
      </section>
      <AuthForm />
      <footer>Next.js · Express · PostgreSQL · Drizzle</footer>
    </main>
  );
}
