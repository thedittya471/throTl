# RateLab

A rate-limiting learning lab in progress. Task 02 provides the Express backend workspace and health endpoint. The simulator and Next.js frontend are later tasks.

## Requirements and setup

Use Node.js 24 LTS (at least 24.12.0) and npm 11 or later. `.nvmrc` selects the Node 24 line. With nvm installed:

```sh
nvm install
nvm use
npm ci
```

Run commands from the repository root. npm workspaces manage `apps/api`; there is one root `package-lock.json`. Do not install separately inside the API workspace or introduce another lockfile.

```sh
npm run dev
```

The API listens on `127.0.0.1:3001` by default. Development uses Node's native TypeScript execution and file watcher; type checking is a separate command. No Redis, database, external service, or secret is needed yet.

Check the running server:

```sh
curl --fail http://127.0.0.1:3001/health
```

Expected HTTP 200 JSON:

```json
{"status":"ok","service":"ratelab-api"}
```

This endpoint is a process health check, not a readiness check for a simulator or Redis connection. Stop the server with Ctrl+C. SIGINT/SIGTERM close the HTTP server, with a ten-second shutdown deadline.

## Configuration

Optional: copy `apps/api/.env.example` to `apps/api/.env`. Workspace dev/start commands load that file, if present; existing environment variables take precedence. If the optional file is absent, Node prints a notice and continues with defaults. Environment files containing local values are ignored by Git, while the safe example is included.

| Variable | Default | Accepted value |
|---|---|---|
| `HOST` | `127.0.0.1` | IPv4/IPv6 address or `localhost`; use `0.0.0.0` only when network access is intended |
| `PORT` | `3001` | Decimal integer from 1 through 65535 |

Blank or malformed settings fail before listening. Occupied ports produce a startup error and nonzero exit. No future Redis URLs, tokens, or secret placeholders are required before those features exist.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use the built-in Node test runner, including real HTTP on an ephemeral loopback port. They need permission to listen on localhost. For a focused configuration check:

```sh
npm exec --workspace @ratelab/api -- node --test --test-name-pattern=^configuration src/server.test.ts
```

Build compiles API source to `apps/api/dist` and excludes test files. Run the compiled server:

```sh
npm start
```

`npm start` requires a prior successful build. Build output and dependencies are ignored by Git. Root TypeScript settings enforce strict checking and erasable syntax; relative `.ts` imports are rewritten to `.js` for production output. Avoid TypeScript runtime enums, parameter properties, and path aliases that native Node execution cannot resolve.

## Dependencies and documentation

Express is the only runtime dependency. TypeScript, Node/Express types, ESLint, and TypeScript ESLint are development dependencies. Versions are pinned in manifests and the lockfile. TypeScript 6 is selected because the installed TypeScript ESLint version supports TypeScript below 6.1; using the latest TypeScript major would exceed that peer range.

Version/setup references checked for this slice:

- [Express installation and TypeScript types](https://expressjs.com/en/starter/installing/)
- [Node release status](https://nodejs.org/en/about/previous-releases)
- [Native Node TypeScript execution](https://nodejs.org/api/typescript.html)
- [TypeScript relative import rewriting](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)
- [TypeScript ESLint flat configuration](https://typescript-eslint.io/getting-started/)

Project behavior is described in [the specification](docs/spec.md). Proposed simulator defaults remain identified there. Implementation order and progress are in [the plan](tasks/plan.md) and [task checklist](tasks/todo.md).
