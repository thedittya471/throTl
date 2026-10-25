# RateLab

A rate-limiting learning lab in progress. The Next.js workspace currently connects to the Express health endpoint. The limiter engine and simulation controls are later tasks.

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
      limiters/
        fixed-window.ts         # Fixed-window algorithm
        types.ts                # Shared limiter interface
    tests/
      server.test.ts
      limiters/
        fixed-window.test.ts
  web/
    app/                        # Next.js pages, UI, and route handlers
      api/health/route.ts
      connection-status.tsx
      globals.css
      layout.tsx
      page.tsx
    tests/
      api/health.test.ts
packages/
  contracts/
    src/index.ts                # Shared API types and runtime validation
    tests/index.test.ts
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

`apps/api/src/limiters/fixed-window.ts` exports `createFixedWindowLimiter({ limit, windowMs, now? })`. Each instance owns an in-memory map; `check(key)` synchronously returns admission, reason, remaining allowance, reset/retry milliseconds, and a detached explanation of the before/after counts and clock values. HTTP integration is Task 05.

Windows are epoch-aligned and include their start but exclude their end. Rejections do not consume allowance. The last allowed request has zero remaining allowance. Clock rollback is clamped per key; rejected retry delays include the raw clock's rollback gap. Limits/durations must be positive safe integers; clock values must be non-negative safe integer milliseconds, and reset timestamps must remain safe integers.

For a limit of two per second, requests at 998, 999, 1,000, and 1,001 ms all pass because they span two windows. This boundary burst is expected fixed-window behavior.

Keys remain until their limiter instance is released. Use one instance per experiment and bounded, validated keys when integrating it; it does not provide Redis sharing, arbitrary public-key admission, or background eviction.

Focused deterministic tests (no network or sleeps):

```sh
npm exec --workspace @ratelab/api -- node --test tests/limiters/fixed-window.test.ts
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
