"use client";

import { useState } from "react";

async function authRequest(action, credentials) {
  const response = await fetch(`/api/auth/${action}`, {
    method: action === "me" ? "GET" : "POST",
    credentials: "same-origin",
    headers: credentials ? { "Content-Type": "application/json" } : undefined,
    body: credentials ? JSON.stringify(credentials) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(result.error ?? "Authentication failed. Please try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function getCurrentUser() {
  try {
    return await authRequest("me");
  } catch (error) {
    if (error.status !== 401) throw error;
    // An expired access cookie can be replaced while the refresh session is still valid.
    await authRequest("refresh");
    return authRequest("me");
  }
}

export default function AuthForm() {
  const [mode, setMode] = useState("login");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const isRegistering = mode === "register";
  const submitLabel = isRegistering ? "Create account" : "Log in";

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setIsBusy(true);
    setMessage("");
    try {
      const result = await authRequest(mode, {
        email: fields.get("email"), password: fields.get("password")
      });
      setUser(result.user);
      setMessage(isRegistering ? "Account created. You are logged in." : "You are logged in.");
      form.reset();
    } catch (error) {
      setMessage(error.status ? error.message : "Unable to reach the server. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSession(action) {
    setIsBusy(true);
    setMessage("");
    try {
      if (action === "logout") {
        await authRequest("logout");
        setUser(null);
        setMessage("You are logged out.");
      } else {
        if (action === "refresh") await authRequest("refresh");
        const result = await getCurrentUser();
        setUser(result.user);
        setMessage(action === "refresh" ? "Session refreshed." : "Your saved login is active.");
      }
    } catch (error) {
      if (error.status === 401) setUser(null);
      setMessage(error.status ? error.message : "Unable to reach the server. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section aria-labelledby="auth-heading">
      <h2 id="auth-heading">Your account</h2>
      {user ? (
        <>
          <p>Logged in as <strong>{user.email}</strong>.</p>
          <div className="auth-actions">
            <button type="button" disabled={isBusy} onClick={() => handleSession("refresh")}>Refresh session</button>
            <button type="button" className="secondary" disabled={isBusy} onClick={() => handleSession("logout")}>Log out</button>
          </div>
        </>
      ) : (
        <>
          <p>{isRegistering ? "Create an account with your email and password." : "Log in with your email and password."}</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={isBusy} />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete={isRegistering ? "new-password" : "current-password"}
              minLength={12} maxLength={72} required disabled={isBusy} aria-describedby="password-help" />
            <p id="password-help" className="field-help">At least 12 characters; at most 72 UTF-8 bytes. Emoji can use several bytes each.</p>
            <div className="auth-actions">
              <button type="submit" disabled={isBusy}>{isBusy ? "Please wait…" : submitLabel}</button>
              <button type="button" className="secondary" disabled={isBusy} onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setMessage("");
              }}>{mode === "login" ? "Create an account" : "Back to login"}</button>
            </div>
          </form>
          <button type="button" className="secondary saved-login" disabled={isBusy} onClick={() => handleSession("me")}>Check saved login</button>
        </>
      )}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
