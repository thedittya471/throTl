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
      runs.ts                   # Run lifecycle and private target routing
      traffic.ts                # Bounded steady HTTP generator
      limiters/
        fixed-window.ts         # Fixed-window algorithm
        types.ts                # Shared limiter interface
    tests/
      server.test.ts
      demo.test.ts
      runs.test.ts
      traffic.test.ts
      limiters/
        fixed-window.test.ts
  web/
    app/                        # Next.js pages, UI, and route handlers
      api/health/route.ts
      api/runs/route.ts
      run-simulator.tsx
      connection-status.tsx
      globals.css
      layout.tsx
      page.tsx
    tests/
      api/health.test.ts
      api/runs.test.ts
packages/
  contracts/
    src/index.ts                # Shared API exports
    src/runs.ts                 # Run configuration and snapshot validation
    tests/index.test.ts
    tests/runs.test.ts
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
| `X-RateLab-Instance` | `local`, the standalone demo label |
| `X-RateLab-Decision` | `allowed` or `rejected` |
| `X-RateLab-Limit` | Configured requests per window |
| `X-RateLab-Remaining` | Integer allowance after this decision; zero is valid on a 200 |
| `X-RateLab-Reset-Ms` | Absolute Unix timestamp in milliseconds at the next window boundary |
| `Retry-After` | Only on 429: `max(1, ceil(decision.retryAfterMs / 1000))` seconds |
| `Cache-Control` | `no-store` |

These application-defined headers are educational metadata. Retry-After is an advisory delay, including a clock rollback gap when present; it does not reserve capacity. Response headers and the JSON explanation use the same engine decision.

Query parameters are rejected with 400 and `DEMO_QUERY_NOT_SUPPORTED`, before consuming allowance. Callers cannot supply client identities, limiter keys, limits, or target URLs. Identity headers do not change the global key. Methods other than GET return 405 with `Allow: GET`, including HEAD so it cannot silently consume allowance. This route accepts no application payload and makes no outbound requests; registered-target selection belongs to the future traffic generator. Server-owned test configuration is validated by the existing limiter factory.

Focused HTTP integration tests use an injected clock to verify exhaustion and recovery without sleeps:

```sh
npm exec --workspace @ratelab/api -- node --test tests/demo.test.ts
```

## Steady experiments (Task 06)

Start the API and web app with the setup commands above. In **First experiment**, choose the request rate, duration, fixed-window limit, and window length, then select **Start steady run**. The defaults offer 10 requests/second for 10 seconds against a limit of 5 per 1,000 ms. This produces allowed and rejected requests, with actual counts affected by aligned boundaries and arrival timing. Settings stay fixed during a run. **Stop run** waits for generator cleanup before acknowledging the stop.

This slice uses one synthetic client, one instance, local state, and a global key. Each run owns a fresh limiter; it does not share the standalone `/demo` allowance. The UI polls every 500 ms, shows final totals, and keeps its private control token only in memory. Leaving the component attempts a best-effort stop. Reload recovery and disconnect grace are not available yet; if a stop or start response is lost, remaining work is still bounded by duration and request deadlines. SSE follows in Task 07.

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
- `/runs/target` accepts a separate private generator credential that is never returned to the browser. It uses the same decision-response formatter as `/demo`. The target URL comes only from the API listener's actual socket address and port; incoming Host headers and user-supplied destinations are not used.

Focused tests:

```sh
npm exec --workspace @ratelab/api -- node --test tests/runs.test.ts tests/traffic.test.ts
npm exec --workspace @ratelab/web -- node --test tests/api/runs.test.ts
```

## Verification and production build

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use Node's built-in runner, with real loopback HTTP for the API and controlled upstream responses for the Next.js health route. Local HTTP tests need permission to bind localhost. `npm test` and typecheck build the shared contracts first. The build runs contracts, API, and web in dependency order.

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
