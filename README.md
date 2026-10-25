# RateLab

A rate-limiting learning lab in progress. The Next.js workspace connects to Express and runs bounded fixed-window experiments using real HTTP traffic.

## Setup

Use Node.js 24 LTS (at least 24.12.0) and npm 11 or later. `.nvmrc` selects the Node 24 line. With nvm installed:

```sh
nvm install
nvm use
npm ci
```

Run commands from the repository root. npm workspaces manage `packages/contracts`, `apps/api`, and `apps/web`; there is one root lockfile. No Redis, database, external service, or secret is needed yet.

Start the API in one terminal:

```sh
npm run dev:api
```

Start the frontend in another:

```sh
npm run dev:web
```

Open [RateLab](http://127.0.0.1:3000). It checks the API on initial load. Use **Check connection** to check again; the page does not continuously monitor the backend. `npm run dev` remains an alias for the API command.

Both dev commands build the shared contracts first. If you edit the contract package, restart the apps to rebuild it. This small workspace deliberately does not add an orchestration framework or another file watcher yet.

## Folder structure

Each workspace keeps application code and tests separate. Test folders follow the source area they verify; test filenames describe the module under test.

```text
apps/
  api/
    src/
      index.ts                  # Process startup and shutdown
      server.ts                 # Express app and configuration
      demo.ts                   # Fixed-window HTTP responses
      runs.ts                   # Coordinator lifecycle and peer registration
      redis.ts                  # Bounded Redis connection and atomic fixed-window script
      instances.ts              # Validated server-owned instance configuration
      targets.ts                # Private per-process limiter stores
      traffic.ts                # Bounded steady HTTP generator
      events.ts                 # Bounded SSE snapshots and disconnect grace
      telemetry.ts              # Received timeline and recent decision evidence
      limiters/
        fixed-window.ts         # Fixed-window algorithm
        types.ts                # Shared limiter interface
    tests/
      server.test.ts
      demo.test.ts
      runs.test.ts
      traffic.test.ts
      events.test.ts
      telemetry.test.ts
      limiters/
        fixed-window.test.ts
  web/
    app/                        # Next.js pages, UI, and route handlers
      api/health/route.ts
      api/runs/route.ts
      api/runs/events/route.ts
      run-simulator.tsx
      connection-status.tsx
      globals.css
      layout.tsx
      page.tsx
    components/
      experiment-view.tsx       # Timeline and latest window state
      decision-inspector.tsx    # Selected request explanation
    lib/run-stream.ts           # SSE parsing and reconnects
    lib/timeline.ts             # Chart geometry with explicit units
    tests/
      api/health.test.ts
      api/runs.test.ts
      api/run-events.test.ts
      lib/run-stream.test.ts
      lib/timeline.test.ts
packages/
  contracts/
    src/index.ts                # Shared API exports
    src/runs.ts                 # Run configuration and snapshot validation
    src/telemetry.ts            # Bounded decision/timeline contract
    tests/index.test.ts
    tests/runs.test.ts
    tests/telemetry.test.ts
```

All workspace test commands discover `tests/**/*.test.ts`. Type checking covers source and tests; API and contracts production builds include only `src/`. Next.js uses `app/` for its application entry points.

## Connection behavior

The browser requests `/api/health` on the Next.js origin. The Next.js handler requests the configured Express API, validates its response against `@ratelab/contracts`, and returns a safe result. There is no arbitrary user-selected destination or browser CORS configuration.

- **Checking:** initial request or user-triggered retry; retry is disabled until the check finishes.
- **Connected:** the API returned a compatible response. This confirms connectivity, not simulator readiness.
- **Unavailable:** connection error, timeout, invalid API address, or non-success upstream response. Start the API and check its port and `API_ORIGIN`.
- **Incompatible:** an upstream success response has malformed JSON or an unsupported health contract. Restart both apps from the same checkout.

The server-side upstream check has a three-second timeout. The browser has a five-second deadline. Health responses disable caching. Internal error details and upstream URLs are not returned to the browser.

Direct API check:

```sh
curl --fail http://127.0.0.1:3001/health
```

Expected HTTP 200 JSON:

```json
{"version":1,"status":"ok","service":"ratelab-api"}
```

The `version` field is additive to the original health endpoint. The shared package provides its type and runtime parser; API output is checked statically, and the Next.js handler validates incoming API data at runtime. Experiment configuration and event schemas will extend this package when their endpoints are implemented; none are fabricated for the health-only shell.

## Configuration

| App | Optional local file | Variable | Default | Meaning |
|---|---|---|---|---|
| API | `apps/api/.env` | `HOST` | `127.0.0.1` | IPv4/IPv6 bind address or `localhost` |
| API | `apps/api/.env` | `PORT` | `3001` | Decimal integer from 1 through 65535 |
| Web | `apps/web/.env.local` | `API_ORIGIN` | `http://127.0.0.1:3001` | Server-only origin of your RateLab API |

Copy each app's `.env.example` to the corresponding optional file if needed. Existing process variables take precedence. Node may print a notice when the optional API environment file is absent; it continues with defaults. Restart the web server after changing `API_ORIGIN`. Do not prefix it with `NEXT_PUBLIC_`.

Blank/malformed API bind settings fail before listening. Occupied ports produce a startup error and nonzero exit. Use a wildcard bind address only when network access is intended. Environment files and generated output are ignored by Git; safe examples are included. No future Redis URL or secret is required yet.

Stop each process with Ctrl+C. The API closes HTTP connections on SIGINT/SIGTERM, with a ten-second shutdown deadline.

## Fixed-window engine (Task 04)

`apps/api/src/limiters/fixed-window.ts` exports `createFixedWindowLimiter({ limit, windowMs, now? })`. Each instance owns an in-memory map; `check(key)` synchronously returns admission, reason, remaining allowance, reset/retry milliseconds, and a detached explanation of the before/after counts and clock values. The `/demo` HTTP endpoint exposes these decisions.

Windows are epoch-aligned and include their start but exclude their end. Rejections do not consume allowance. The last allowed request has zero remaining allowance. Clock rollback is clamped per key; rejected retry delays include the raw clock's rollback gap. Limits/durations must be positive safe integers; clock values must be non-negative safe integer milliseconds, and reset timestamps must remain safe integers.

For a limit of two per second, requests at 998, 999, 1,000, and 1,001 ms all pass because they span two windows. This boundary burst is expected fixed-window behavior.

Keys remain until their limiter instance is released. Use one instance per experiment and bounded, validated keys when integrating it; it does not provide Redis sharing, arbitrary public-key admission, or background eviction.

Focused deterministic tests (no network or sleeps):

```sh
npm exec --workspace @ratelab/api -- node --test tests/limiters/fixed-window.test.ts
```

## Limited demo endpoint (Task 05)

`GET /demo` exercises the fixed-window engine through real HTTP. The standalone demo uses one global key, a limit of 100 requests per 60,000 ms, and independent state per API app instance. Restarting the API resets this state. This is a local learning endpoint; isolated, authorized experiment runs are added with the coordinator, not provided by this standalone endpoint.

```sh
curl -i http://127.0.0.1:3001/demo
```

An allowed request returns 200; a limiter rejection returns 429. Both return `{ version: 1, algorithm: "fixed-window", instance: "local", decision }`. The shared `FixedWindowDemoResponse` contract describes the body. `decision` includes admission, reason, remaining allowance, reset/retry milliseconds, and the before/after counter and clock snapshot.

| Header | Meaning |
|---|---|
| `X-RateLab-Algorithm` | `fixed-window` |
| `X-RateLab-Instance` | `INSTANCE_ID` (defaults to `local`) |
| `X-RateLab-Decision` | `allowed` or `rejected` |
| `X-RateLab-Limit` | Configured requests per window |
| `X-RateLab-Remaining` | Integer allowance after this decision; zero is valid on a 200 |
| `X-RateLab-Reset-Ms` | Absolute Unix timestamp in milliseconds at the next window boundary |
| `Retry-After` | Only on 429: `max(1, ceil(decision.retryAfterMs / 1000))` seconds |
| `Cache-Control` | `no-store` |

These application-defined headers are educational metadata. Retry-After is an advisory delay, including a clock rollback gap when present; it does not reserve capacity. Response headers and the JSON explanation use the same engine decision.

Query parameters are rejected with 400 and `DEMO_QUERY_NOT_SUPPORTED`, before consuming allowance. Callers cannot supply client identities, limiter keys, limits, or target URLs. Identity headers do not change the global key. Methods other than GET return 405 with `Allow: GET`, including HEAD so it cannot silently consume allowance. This route accepts no application payload and makes no outbound requests; experiment traffic uses the private registered targets described below. Server-owned test configuration is validated by the existing limiter factory.

Focused HTTP integration tests use an injected clock to verify exhaustion and recovery without sleeps:

```sh
npm exec --workspace @ratelab/api -- node --test tests/demo.test.ts
```

## Steady experiments (Task 06)

Start the API and web app with the setup commands above. In **First experiment**, choose the request rate, duration, fixed-window limit, and window length, then select **Start steady run**. The defaults offer 10 requests/second for 10 seconds against a limit of 5 per 1,000 ms. This produces allowed and rejected requests, with actual counts affected by aligned boundaries and arrival timing. Settings stay fixed during a run. **Stop run** waits for generator cleanup before acknowledging the stop.

Experiments use one synthetic client, local state, and a global key. The default setup has one target; `dev:instances` routes across three independent API processes. Each run owns a fresh limiter; it does not share the standalone `/demo` allowance. The UI consumes live SSE snapshots, shows final totals, and keeps its private control token only in memory. Leaving the component closes its stream; the server stops the run after a 15-second reconnect grace period. Reload recovery is not available yet because the credential is not persisted. If a start response is lost or no stream ever connects, the same grace period stops the unattended run.

| Setting / budget | Current ceiling |
|---|---:|
| Duration | 100–120,000 ms |
| Offered steady rate | 1–1,000 requests/second |
| Fixed-window limit | 1–1,000 requests/window |
| Window duration | 1–60,000 ms |
| Active runs / retained runs | 10 / 20 |
| Aggregate active offered rate | 5,000 requests/second |
| In-flight attempts per run / total | 256 / 2,048 |
| Maximum dispatch lateness | 100 ms |
| Total HTTP attempt deadline | 15 seconds |
| Result retention | 10 minutes after settlement; expired records are pruned on requests |

These are admission ceilings, not measured throughput guarantees. A full budget rejects new runs with 503. The generator uses monotonic scheduling and a keep-alive HTTP agent. Late or over-capacity slots are missed instead of creating a catch-up burst. Stop aborts pending timers/HTTP requests, marks undispatched slots missed, waits for every initiated request to settle, and destroys the agent. API shutdown uses the same cleanup.

`scheduled` is the number of offered slots (`ceil(durationMs * ratePerSecond / 1000)`), including slots later missed. `responseReceived` means an entire HTTP response was consumed; it includes HTTP errors. Completed attempts include received responses, transport failures, cancellations, and timeouts. Allowed/rejected counts use confirmed target responses; lost responses leave an unknown decision even if the target already evaluated them. Missed slots are split into lateness, capacity, and cancellation.

After settlement:

```text
scheduled = dispatched + missed
completed attempts = dispatched = responseReceived + transportFailed + cancelled + timedOut
dispatched = allowed + rejected + unknownDecision
inFlight = 0
```

Control wire contract (all responses disable caching):

- `POST /runs`: JSON `{ durationMs, ratePerSecond, limit, windowMs }`; returns 201 `{ run, token }`. `run.id` is an opaque display identifier; the separate bearer token controls access.
- `GET /runs`: returns the current run snapshot for `Authorization: Bearer <token>`.
- `DELETE /runs`: stops that run, awaits cleanup, and returns its final snapshot. Repeated stop is safe.
- API control requests require `X-RateLab-Request: 1`; missing/invalid run credentials return 404. Queries, unknown fields, invalid settings, and oversized JSON are rejected.
- The Next.js `/api/runs` bridge validates input/output, enforces same-origin mutations, and forwards to server-configured `API_ORIGIN`. Tokens stay in headers and the start response, never URLs.
- `/internal/runs/target` accepts a separate private generator credential that is never returned to the browser. It uses the same decision-response formatter as `/demo`. The local target comes from the API listener's socket address and port; optional peers come from server-owned configuration. Incoming Host headers and user-supplied destinations are not used.

Focused tests:

```sh
npm exec --workspace @ratelab/api -- node --test tests/runs.test.ts tests/traffic.test.ts
npm exec --workspace @ratelab/web -- node --test tests/api/runs.test.ts
```

## Live run streams (Task 07)

`GET /runs/events` streams `event: snapshot` messages whose JSON `data` is the existing versioned `RunSnapshot`. API callers send `Authorization: Bearer <token>` and `X-RateLab-Request: 1`. The UI uses the authenticated same-origin `/api/runs/events` relay with fetch streaming, so the credential stays in a header rather than a URL. Status and Stop retain their existing REST contracts.

- The stream sends the current snapshot immediately, then refreshes aggregate totals every 200 ms (5 Hz). Terminal status is sent immediately and closes the stream.
- Each snapshot replaces the UI's totals. Reconnect starts from the current server state; events are not added to previous counts, and old event history is not replayed.
- Only one stream may be attached per run. A replacement closes the previous connection. A completed run can reconnect to retrieve one final snapshot.
- When a write applies backpressure, periodic snapshots are skipped until drain; the next write uses the newest totals. There is no per-request event queue. Pending Node output is capped at 256 KiB, and a reader stalled for five seconds is disconnected. A final snapshot that cannot drain can be recovered by reconnecting.
- Heartbeat comments are included every ten seconds. Streams disable caching/transformation and send `X-Accel-Buffering: no`. The Next.js relay reads on downstream demand, bounds individual chunks to 256 KiB, and cancels upstream work when canceled.
- A 15-second grace period begins on run creation and after stream disconnect. Attaching a stream clears it; expiry cancels the run through the existing cleanup path. Completion and shutdown clear stream timers/listeners.
- The client retries disconnected streams after one second, detects a connection with no snapshots for 15 seconds, and retains a bounded 140-second watch lifetime. Invalid or expired credentials end retries. The parser bounds unfinished events and validates snapshots with the shared contract.

Task 08 adds bounded timeline and recent-decision telemetry to these same replacement snapshots; full recording policies remain later work. Aggregate counters remain independent of stream speed or missing updates. An in-memory credential supports reconnect within the current page; it does not provide reload recovery.

Focused scripted checks:

```sh
npm exec --workspace @ratelab/api -- node --test tests/events.test.ts tests/runs.test.ts
npm exec --workspace @ratelab/web -- node --test tests/api/run-events.test.ts tests/lib/run-stream.test.ts
```

Tests cover controlled backpressure, stalled-reader cleanup, stream replacement, heartbeats, terminal delivery, real HTTP reconnect with final counters, relay cancellation, chunk limits, fragmented SSE parsing, and client reconnect. Browser interaction and deployment-proxy behavior have not been verified.

## Three real API processes (Task 09)

Use Node 24.12+ and run these in separate terminals:

```sh
npm run dev:instances
npm run dev:web
```

The launcher starts the same `apps/api/src/index.ts` entry point three times on loopback ports 3001–3003, with IDs `api-1`, `api-2`, and `api-3`. The coordinator on 3001 is also the first target. Next.js keeps its existing `API_ORIGIN=http://127.0.0.1:3001`. Stop an existing single API before starting this command. Restart the launcher after API edits; it does not watch files. Ctrl-C stops all children, and an unexpected child exit shuts down the group. Local mode requires no running Redis server or Docker. Shared mode uses Redis as described below.

Each run registers fresh independent local limiter state on the three processes. Actual dispatched requests rotate `api-1 → api-2 → api-3`; missed schedule slots do not advance routing. Connection pooling and existing in-flight limits still apply. The UI displays per-instance dispatched, allowed, rejected, transport-failed, and unknown-decision totals. Retained decisions identify their target; the usage meter describes that specific instance's latest received decision, not combined allowance.

For the 3L demonstration, use limit **10**, window **60000 ms**, rate **60 requests/s**, and duration **1000 ms**, with the entire experiment inside one window. At least 30 evenly routed requests can consume all three allowances: 10 per instance, 30 combined. Later arrivals in the same window return 429. A run crossing a window boundary can admit more; the scripted test avoids this boundary. The default single-process command `npm run dev:api` continues to work.

For separately managed API processes, configure these server-side values:

| Variable | Default | Meaning |
|---|---|---|
| `INSTANCE_ID` | `local` | Distinct 1–32 character alphanumeric/underscore/hyphen ID |
| `INSTANCE_PEERS` | empty | Exactly two comma-separated HTTP origins on the coordinator; empty on the other targets |
| `INSTANCE_SECRET` | absent | Shared 64-hex-character registration secret, required with peers |

The launcher generates a fresh secret in memory and does not print it. `GET /instance` reports the ID. `POST /internal/runs` registers a bounded policy/token using the internal secret; `DELETE` removes it. The generator uses a separate per-run random target token; browser capabilities cannot register or call targets. There are at most ten live target entries per process, and abandoned entries expire after duration + 30 seconds (pruned on access). Normal completion, explicit stop, failed setup, and graceful shutdown remove target registrations; unavailable peers rely on expiry. These internal HTTP endpoints are for a trusted local/private network; use appropriate network isolation/TLS before multi-host deployment.

A peer must register successfully before a run starts. Failed setup returns 503 and cleans up partial registration. During a run, an unavailable target stays in rotation: failed connections count as transport failures with unknown decisions, never as 429, and there is no automatic retry or failover. Cleanup requests have three-second deadlines. Run summaries include an additive optional `instances: [{ id, counts }]` field; per-instance scheduled/dispatched counts cover assigned attempts, while missed slots belong to the coordinator totals. Received response bodies are bounded to 8192 characters and validated before evidence enters telemetry.

`npm test` includes a multi-process test that starts three real API entry points, proves exactly 3L across two isolated runs, kills one target, verifies transport accounting, and rejects subsequent setup while that peer is down. Target credential/capacity/cleanup and invalid-response tests cover the trust boundaries. This demonstrates independent processes on one host; it is not a throughput benchmark or proof of independent-host resilience. Task 10 adds the shared Redis allowance below.

## Atomic shared fixed window (Task 10)

Choose **Local** or **Shared** before starting a run. The setting is immutable for that run. Local mode retains an independent allowance per instance; shared mode uses one Redis allowance across all registered targets. Omitted `stateMode` still means local for earlier callers. The standalone `/demo` remains local.

With Redis installed, start a disposable local server in one terminal:

```sh
redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no --maxmemory-policy noeviction
```

Then start the APIs and web app in separate terminals:

```sh
REDIS_URL=redis://127.0.0.1:6379 npm run dev:instances
```

```sh
npm run dev:web
```

Use an existing Redis server instead if one already owns port 6379. All API processes must use the same Redis server/database. The launcher inherits `REDIS_URL` from its environment; it does not load `apps/api/.env`. Separately launched `dev:api`/`start` processes can use that optional file. Redis is contacted lazily when shared mode is requested, so an unavailable Redis server does not prevent local experiments or the API health endpoint from working. Verified with Node 24.22.1, Redis server 8.6.2, and the exact official `redis` client dependency 6.3.0.

For the same limit-10, 60000-ms-window, 60-requests/s, 1000-ms experiment, local mode admits 30 across three instances; shared mode admits 10 combined, provided the run stays inside one window. The UI explains the active mode, shows the shared usage evidence, and preserves per-instance routing counts. Shared decisions use Redis `TIME`; local decisions use the process clock. The existing half-open windows and rollback-clamping explanation remain in the inspector.

The fixed-window Lua script reads the previous window/count/time, computes the boundary, decides admission, writes the resulting state, and sets expiry in **one atomic operation**. Rejections do not consume allowance. It uses one hash per run/algorithm/global key: `ratelab:{SHA256(private-target-token)}:fixed-window:global`. Raw capabilities are not stored in Redis key names. Redis documents [atomic script execution](https://redis.io/docs/latest/develop/programmability/eval-intro/) and [server time](https://redis.io/docs/latest/commands/time/).

Every evaluation refreshes the key TTL to run duration + 30 seconds (at most 150 seconds after the last evaluation with current input limits). Normal completion and explicit stop remove target registrations, then delete the exact shared key after all peers acknowledge removal. A target's individual removal does not delete shared allowance for other instances. If cleanup cannot be confirmed or Redis is unavailable, expiry removes the orphaned key. No scans or database-wide deletes are used by the application. Keep active limiter keys on a Redis deployment with `maxmemory-policy noeviction`; deleting or evicting an active counter can reset allowance.

Connections and commands have one-second deadlines, the command queue is bounded, offline queuing is disabled, and commands are not automatically replayed after disconnect. A failed shared setup returns HTTP 503 with safe `REDIS_UNAVAILABLE` metadata. During a run, a target Redis failure returns 503 rather than 429; the coordinator cancels generation and emits a terminal snapshot with `status: "failed"` and `error: "REDIS_UNAVAILABLE"`. The UI and SSE client understand that terminal state. Confirmed prior outcomes remain counted; the failed request and unconfirmed in-flight work remain unknown decisions. There is no local fallback. A newly requested run may establish a new connection; old runs cannot resume on it after Redis may have lost state. See the official client's [production reliability guidance](https://redis.io/docs/latest/develop/clients/nodejs/produsage/).

`npm test` now requires a `redis-server` executable on PATH, or an explicit `REDIS_SERVER_BIN` path. Tests start isolated loopback servers on temporary ports with persistence disabled and stop them afterward; they do not use `REDIS_URL` or your existing Redis data. Focused checks after building contracts:

```sh
npm exec --workspace @ratelab/api -- node --test tests/limiters/fixed-window.redis.test.ts tests/shared-instances.test.ts
```

Coverage includes a deliberate unsafe read-then-write race, exact atomic allowance across three connections, 90 concurrent HTTP requests across three real API processes admitting exactly 10, isolated keys, actual Redis expiry after TTL acceleration, stale-window reset, rollback evidence, explicit cleanup, disconnected checks, replacement-connection protection, final failed SSE delivery, and stopped dispatch after Redis loss. These are correctness tests; high-load capacity and browser performance remain later tasks.

## Learning view (Task 08)

The run view includes an allowed/rejected timeline, a window-usage meter, and a request inspector. All three use real limiter decisions received in complete, validated HTTP responses and included in the existing SSE snapshots. There is no chart dependency or separate event queue.

- **Timeline:** stacked request counts in one-second elapsed-time intervals. Allowed requests use solid bars; rejections use diagonal hatching. The legend and exact-values table provide text alternatives. Gaps within the displayed time range have no received decision evidence. At most 120 nonempty intervals are retained; cumulative evidence totals cover all received decisions.
- **Window state:** allowance used and remaining at the latest evaluated request, with its reset timestamp in Unix milliseconds. The engine resets lazily on evaluation, so the display is explicitly labelled as observed state rather than a live countdown.
- **Inspector:** choose a retained request in response completion order using a native select. It explains admission/rejection, before/after counts, remaining allowance, `[start, end)` window boundaries, raw/effective clocks, rollback clamping, and advisory retry milliseconds. Selection stays on that request while retained; if it leaves the buffer, the inspector shows the newest request.
- **Detail retention:** each run retains the most recent 50 decisions. The visible indicator says how many evaluated requests are retained and how many older details are omitted. This is a rolling excerpt, not a statistical sample or a full recording policy. Server aggregate counters do not depend on detail retention. Full recording/replay policies remain later tasks.

The learning view contains received decision evidence. A target can evaluate a request whose response is lost; that evaluation cannot be reconstructed here and remains an unknown decision in generator counters. This is not a target-side audit log. Sequence and elapsed time describe response completion at the coordinator, not arrival order across processes. Reconnect replaces the timeline and detail arrays instead of appending duplicate history. Server and browser histories share explicit bounds, and complete representative snapshots stay within the SSE parser's 64 KiB event budget.

The optional `telemetry` snapshot field contains `{ evaluated, allowed, rejected, timeline, recent }`. A recent item contains `{ sequence, elapsedMs, instance, decision }`; `decision` uses the existing fixed-window evidence shape. Clients validate retention limits, integer counts, bucket/sequence order, and decision evidence. Snapshots without telemetry remain accepted for the earlier contract and show a waiting message.

Focused scripted checks:

```sh
npm exec --workspace @ratelab/api -- node --test tests/telemetry.test.ts tests/runs.test.ts
npm exec --workspace @ratelab/contracts -- node --test tests/telemetry.test.ts
npm exec --workspace @ratelab/web -- node --test tests/lib/timeline.test.ts
```

Tests cover deterministic exhaustion/reset, bounded history with exact aggregate counts, event size, HTTP telemetry integration, malformed evidence, and chart scaling/gaps/empty data. Browser rendering, keyboard interaction, and visual performance have not been checked, per the requested testing scope.

## Verification and production build

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Redis integration tests require `redis-server` on PATH (or `REDIS_SERVER_BIN`) and start disposable instances automatically. Tests use Node's built-in runner, with real loopback HTTP for the API and controlled upstream responses for the Next.js health route. Local HTTP tests need permission to bind localhost. `npm test` and typecheck build the shared contracts first. The build runs contracts, API, and web in dependency order.

Focused checks:

```sh
npm exec --workspace @ratelab/api -- node --test --test-name-pattern=^configuration tests/server.test.ts
npm run test --workspace @ratelab/contracts
npm run test --workspace @ratelab/web
```

After `npm run build`, start the compiled API and Next.js server in separate terminals:

```sh
npm start
```

```sh
npm run start:web
```

API build output is `apps/api/dist`, excluding tests. Contracts compile to JavaScript plus declarations in `packages/contracts/dist`, so the API runs compiled code rather than trying to execute TypeScript inside a dependency. Next.js output is `apps/web/.next`.

The backend uses native Node TypeScript execution for development and tests; type checking remains separate. Relative `.ts` imports are rewritten during compilation. Avoid runtime enums, parameter properties, and backend path aliases unsupported by native execution. The web workspace uses Next.js's JSX/bundler settings while retaining strict checks.

## Dependencies and references

Runtime packages are Express, Next.js, React, React DOM, and the local contract package. No UI kit, chart library, state manager, remote font, or test-runner dependency is needed for this shell. TypeScript 6 fits the installed TypeScript ESLint peer range. ESLint 10 uses the Next.js plugin directly plus React Hooks rules, avoiding the incompatible transitive peer ranges of the full Next.js lint configuration.

Official setup references:

- [Express installation and TypeScript types](https://expressjs.com/en/starter/installing/)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Next.js ESLint plugin configuration](https://nextjs.org/docs/app/api-reference/config/eslint)
- [Node release status](https://nodejs.org/en/about/previous-releases)
- [Native Node TypeScript execution](https://nodejs.org/api/typescript.html)
- [TypeScript relative import rewriting](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)

Project behavior is in [the specification](docs/spec.md); proposed simulator defaults remain identified there. Implementation order and progress are in [the plan](tasks/plan.md) and [task checklist](tasks/todo.md).
