"use client";

import { useState } from "react";

const statusMessages = {
  idle: "Connection has not been checked.",
  checking: "Checking API and database…",
  connected: "Connected. The API and database are ready.",
  unavailable: "Connection unavailable. Check that the API and database are running, then try again."
};

export default function ConnectionStatus() {
  const [status, setStatus] = useState("idle");
  const isChecking = status === "checking";
  const buttonLabel = isChecking ? "Checking…" : "Check connection";

  async function checkConnection() {
    setStatus("checking");
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(6000)
      });
      const health = await response.json();

      if (response.ok && health.status === "ok") {
        setStatus("connected");
      } else {
        setStatus("unavailable");
      }
    } catch {
      setStatus("unavailable");
    }
  }

  return (
    <div className="connection">
      <button type="button" onClick={checkConnection} disabled={isChecking}>
        {buttonLabel}
      </button>
      <p role="status" aria-live="polite" data-status={status}>
        {statusMessages[status]}
      </p>
    </div>
  );
}
