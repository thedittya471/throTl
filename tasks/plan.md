# Implementation plan: throTl

Status: JavaScript foundation in place: npm workspaces, Turborepo, Next.js, Express, PostgreSQL, and Drizzle. Experiment features below remain planned. Deployment and hosting remain deferred.

## Reading the starter code

Read the working foundation in this order. The later experiment roadmap is a reference, not code you need to understand on day one.

1. `apps/web/app/page.jsx` renders the home page. `layout.jsx` wraps every page, and `globals.css` controls appearance.
2. `apps/web/app/connection-status.jsx` stores the connection status in React state. Pressing the button sends a request and updates the message.
3. `apps/web/app/api/health/route.js` runs on the Next.js server. It asks Express whether its database is ready and returns a safe response to the browser.
4. `apps/api/src/app.js` defines Express routes. `/health` checks that the API responds; `/ready` checks PostgreSQL too. `request` is the incoming HTTP request; `response` is what the server sends back.
5. `apps/api/src/db/client.js` creates a connection pool and gives it to Drizzle. `checkDatabase` runs `SELECT 1`, a small query that verifies the connection without changing data.
6. `apps/api/src/config.js` reads environment variables and rejects invalid settings. `index.js` connects the pieces, starts the HTTP server, and closes resources when the process stops.

`createApp` receives `checkDatabase` as an argument so tests can simulate database success or failure. `createDatabase` returns the shared pool, Drizzle client, and check function. These are ordinary functions, not classes or a separate framework.

A request follows this path:

```text
Connection button → Next.js /api/health → Express /ready → Drizzle → PostgreSQL
```

Keep `scripts/setup.mjs`, `turbo.json`, Compose, ESLint, and the shutdown code as supporting setup while learning the page and request flow. They handle configuration, running tasks, and cleanup. Their setup commands are listed below under Local setup and verification.

## Authentication reading order

The home page includes registration, login, saved-session checking, refresh, and logout. Run `npm run setup` and `npm run db:migrate` before using it. Normal registration returns a logged-in account; email verification and password reset are not implemented.

1. `apps/web/app/auth-form.jsx`: the form submits email/password to `/api/auth/register` or `/api/auth/login`. Cookies are handled by the browser, not stored in React or localStorage. Checking a saved login tries `/me`, then refreshes an expired access token and retries once.
2. `apps/web/next.config.js`: Next.js forwards `/api/auth/*` to Express `/auth/*`, including cookies and Set-Cookie responses. This keeps browser requests on the same origin without adding CORS.
3. `apps/api/src/auth/routes.js`: input validation, shared attempt limits, register, login, refresh, current user, and logout. Database queries use Drizzle; registration and session creation share a transaction.
4. `apps/api/src/auth/tokens.js`: signs/verifies JWTs and sets/clears cookies. Access lasts 15 minutes; a session and its rotating refresh token last at most 7 days. Access and refresh use different secrets and purposes.
5. `apps/api/src/db/schema.js`: `users` stores bcrypt password hashes; `auth_sessions` stores a digest of the current refresh token and expiry; `auth_attempts` stores bounded-window shared login counters. Logout removes the session, so existing access tokens stop working.

Use `WEB_ORIGIN=http://localhost:3100` locally. In production, set its exact HTTPS origin, `NODE_ENV=production`, independent random `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` values of at least 32 characters, database credentials, and the internal `API_ORIGIN`. The API must be reachable only through the intended deployment network/reverse proxy. Production cookies are Secure and require HTTPS. Rebuild Next.js if the rewrite destination `API_ORIGIN` changes. Secrets are never returned to the browser or included in browser-exposed environment variables.

All mutating auth requests must supply the exact configured Origin. Cookies are HttpOnly, host-only, SameSite=Lax, and uncached. Login limits are 10 attempts/email/15 minutes plus 100 attempts/minute globally; these are initial lab budgets. Duplicate registration responds with a conflict, while login uses the same error for unknown accounts and wrong passwords. Refresh uses one atomic compare-and-update; concurrent attempts permit one success, and the failed response does not clear the winning cookies.

## Outcome and scope

Build a guided rate-limiting lab with real HTTP traffic against our own demo API. Learning takes priority over portfolio polish and the program assessment, while all three remain goals. Use Next.js/JavaScript, Node/Express/REST, PostgreSQL with Drizzle, and Redis when shared limiter state is introduced. Implement fixed window, exact sliding log, approximate sliding-window counter, token bucket, and queued leaky bucket by hand. A visitor can configure traffic, compare algorithms, inspect internal state, replay retained decisions, and export temporary results. Multiple visitors have independent runs. Hosting decisions and free-tier feasibility are deferred.

Include steady, burst, ramp, sawtooth, boundary attack, and many-clients/heavy-client patterns; three real API processes with local/shared state; artificial per-instance clock offsets; and disposable login/search/payment/upload workflows. No saved visitor experiment history, external target URLs, real financial services, or Go implementation. Real email/password accounts are now supported separately from the disposable login workload. Rich application presets are additional scope beyond a simple traffic preset.

## Architecture: agreed choices and proposals

Agreed: JavaScript Next.js frontend, JavaScript Express REST backend, npm workspaces with Turborepo, PostgreSQL with Drizzle for future application data, Redis shared limiter state, three API instances, server-generated real HTTP traffic, immutable per-run settings, bounded leaky queue, temporary experiments, exports, complete small-run recording and sampled large-run details.

Proposed for review in Task 01:

- One repository with a web app, API app, and a tiny shared contract package. Use npm workspaces and Turborepo for development, build, lint, and test tasks. Add a shared contract package only when actual shared code is needed.
- One Express coordinator process owns experiment scheduling, bounded records, SSE subscriptions, and exports. Run the API in instance mode three times for the target endpoints. Roles share code and can be processes/containers on one host; this is not four separately designed microservices. The web browser controls experiments rather than dispatching benchmark requests.
- All algorithms run on the same three target processes. Namespace state by run, algorithm, and logical limiter key. Comparing five algorithms does not require fifteen target processes.
- Use Redis for atomic limiter updates and the disposable shared payment ledger. PostgreSQL with Drizzle stores users, revocable login sessions, and shared authentication attempt counters. Saved experiment history is still outside scope. Instance-local limiter state is intentionally local; payment correctness must not depend on routing retries to the same instance.
- SSE carries bounded batches of authoritative aggregate snapshots plus limited detail. Browser reconnect gets a current snapshot; it is not promised a durable lossless event log. REST starts/stops runs and retrieves results. Exact endpoints and authentication transport are specified in Task 01.
- Anonymous runs use opaque capability credentials with enough entropy and no log exposure. Prefer same-origin browser/API access to simplify credential and stream access. Validate ownership for read, stop, stream, and export. Demo-target requests also need internal authorization so a public caller cannot bypass run budgets or forge unlimited runs.
- Redis scripts or equivalent atomic Redis operations enforce check/update/expiry together. Do not use application-level read-then-write for admission. Use unique members for sliding-log requests. Keep scripts short and bounded; benchmark hot-key contention.
- Shared leaky bucket needs one global admission/order and pacing rule, not three independent queues each draining at the configured rate. Task 17 must prove a small shared reservation/queue design and its cancellation/crash limits before any generalized queue framework is considered. No Kafka or durable job infrastructure is assumed.
- Proposed failure policy: report a failed/unavailable run when Redis is unavailable; do not silently fall back to per-instance allowance. Confirm this policy in Task 01. Process restart may lose temporary experiment results; this is disclosed rather than adding durable recovery.
- Proposed lifecycle: stop cancels generation and pending queue work, finalizes partial results, and cleans up. Tab disconnect gets a short reconnection grace period before automatic stop. Finished results expire after a documented TTL. Durations and grace period are pending review.
- Baseline algorithm comparisons use one seeded open-loop intended schedule with separate real requests per algorithm. Arrival timing can differ; measure it. Application retry scenarios may branch according to responses, so distinguish identical baseline traffic from response-dependent retry traffic.
- Rate limits may apply globally, per client, per account, or per endpoint as specified. The 3L versus L proof uses one key, not 1000 independent per-client allowances. Benchmark virtual-client count is a workload property, not a connection/process count.

## Proposed repository shape

```text
apps/web/                 Next.js UI, API client, charts, replay
apps/api/src/             Express roles, limiter engine, run scheduler, events
apps/api/src/limiters/    five implementations and focused local/Redis tests
apps/api/src/presets/     disposable application workflows and traffic
apps/api/src/db/         PostgreSQL connection and future Drizzle schema
packages/contracts/      future shared runtime contracts, only when needed
scripts/                  repeatable smoke tests, scenarios, benchmarks
docs/                     spec, evidence, four ADRs, run instructions
tasks/                    this implementation plan
```

These are intended locations, not invented existing files. Reuse a component or module until extracting it solves an actual readability problem. A task's likely paths are a scope guide, not a demand to create all those files.

## Dependency graph and execution strategy

```text
01 semantics -> 02 backend -> 03 frontend/contracts
 -> 04 fixed engine -> 05 real endpoint -> 06 end-to-end run
 -> 07 bounded SSE -> 08 learning view -> 09 three instances
 -> 10 Redis atomicity -> 11 early load probe -> 12 timing
 -> 13 sliding log -> 14 counter -> 15 token bucket
 -> 16 local queued leaky -> 17 globally paced leaky -> 18 recording
 -> 19 burst/ramp -> 20 boundary/sawtooth -> 21 client distributions
 -> 22 paired comparison -> 23 five-way comparison -> 24 replay
 -> 25 export -> 26 clocks -> 27 login -> 28 search
 -> 29 payment ledger -> 30 retries -> 31 upload endpoint -> 32 upload UI
 -> 33 learning explanations -> 34 capacity/ownership -> 35 failure handling
 -> 36 browser load verification -> 37 behavior evidence -> 38 load matrix
 -> 39 ADRs -> 40 repeatable CI -> 41 demo packaging -> 42 review
```

The main path is deliberately sequential for a solo learner: each task builds on a working feature, with review after every three tasks. Security validation, bounded resources, and cleanup start in the first slices; later tasks test and harden them rather than postpone them. Introduce each algorithm as a testable backend + selectable UI slice, rather than implement every engine before seeing any real result.

No agents are dispatched by this plan. If the user later wants parallel work, documentation and independent preset workflows can proceed after contracts stabilize; changes to scheduler, state, and metrics require a single owner. Early high-risk checks are atomicity and real throughput; shared queued pacing is the next explicit risk checkpoint.

## Task index

The ordered tasks below define the roadmap. Behavior and acceptance examples are in [the specification](../docs/spec.md).

### Contract and first real experiment

- Task 01: Specify experiment semantics
- Task 02: Create the backend workspace
- Task 03: Connect the Next.js shell
- Task 04: Implement fixed-window decisions
- Task 05: Expose the limited demo endpoint
- Task 06: Run one steady experiment end to end

### Live view and distributed risk

- Task 07: Stream run summaries safely
- Task 08: Visualize the first learning experiment
- Task 09: Bring up three real API processes
- Task 10: Make fixed-window shared state atomic
- Task 11: Probe the target workload early
- Task 12: Separate limiter timing from HTTP timing

### Complete the algorithm set

- Task 13: Add the sliding-log experiment
- Task 14: Add the sliding-counter experiment
- Task 15: Add the token-bucket experiment
- Task 16: Demonstrate a local leaky queue
- Task 17: Coordinate the leaky queue across instances
- Task 18: Apply dual recording policies

### Traffic patterns and fair comparison

- Task 19: Add burst and ramp traffic
- Task 20: Add sawtooth and boundary traffic
- Task 21: Add client distribution controls
- Task 22: Run a two-algorithm comparison
- Task 23: Extend comparison to all five algorithms
- Task 24: Replay recorded decisions

### Evidence and application workflows

- Task 25: Export experiment evidence
- Task 26: Make clock offsets inspectable
- Task 27: Build the login workflow
- Task 28: Build the search workflow
- Task 29: Build an idempotent payment ledger
- Task 30: Exercise payment retry behavior

### Uploads and operational limits

- Task 31: Build temporary upload handling
- Task 32: Expose upload experiments
- Task 33: Explain each algorithm and preset
- Task 34: Bound simultaneous experiments
- Task 35: Handle dependency and instance failure
- Task 36: Verify the UI under load

### Acceptance, measurements, and handoff

- Task 37: Prove required behavioral demonstrations
- Task 38: Measure final throughput and concurrency
- Task 39: Write the four ADRs from evidence
- Task 40: Make verification repeatable
- Task 41: Package a reproducible portfolio demo
- Task 42: Review full acceptance and learning outcomes

## Time budget and the first ten days

The original 10 x 5 hours gives 50 hours. The complete agreed scope now includes application workflows, replay, clocks, concurrency isolation, and a five-way 5000 requests/second aggregate target. Do not promise all of this in 50 hours. The per-task ranges sum to roughly 90–135 focused implementation hours; allow approximately 20–35 additional hours for learning, cross-task debugging, and review. A useful provisional envelope is 110–170 hours (22–34 days at five hours/day), subject to the early measurement checkpoint. These are estimates, not benchmark facts or a contractual schedule. Re-estimate after Tasks 12, 18, and 30.

Use a daily rhythm of about 45 minutes reading/explanation, 2.5–3 hours hands-on work, and the rest for tests, review, and notes. Do not move on while an algorithm's invariants remain unclear.

| Day | Candidate focus | Visible exit condition |
|---|---|---|
| 1 | Task 01 and backend setup | Reviewed semantics; API boots |
| 2 | Frontend connection and fixed engine | Browser connects; boundary tests pass |
| 3 | Limited HTTP endpoint and first experiment | Real 200/429 and reconciled totals |
| 4 | SSE and first visualization | Live state and decisions visible |
| 5 | Three processes and shared fixed window | L versus 3L demonstration |
| 6 | Early benchmark and timing | Measured bottleneck and timing scopes |
| 7 | Sliding log | Exact rolling behavior in local/shared mode |
| 8 | Sliding counter | Approximation visible and tested |
| 9 | Token bucket | Refill and burst behavior visible |
| 10 | Local leaky queue; review remaining effort | Five local algorithms may be available; shared queue and later scope remain unfinished |

This table is a stretch pacing guide, not a reason to skip tests or rush learning. If a day overflows, carry work forward. The complete ordered backlog remains the delivery scope; the day-10 milestone is not a reduced replacement requirement.

## Local setup and verification

Run from the repository root with the Node version in `.nvmrc` (Node 26; Node 24 is also supported):

```sh
npm ci
npm run setup
npm run db:up
npm run db:migrate
npm run dev
```

`npm run setup` creates the ignored root `.env` with a random development password and separate JWT secrets. Existing values are preserved; missing authentication settings are appended. Docker Compose uses this file; the API, Next.js, and Drizzle Kit load it with dotenv. It is local convenience configuration; production supplies secrets through the deployment environment. No browser-exposed environment variable contains database credentials.

- Web: `http://localhost:3100`.
- API liveness: `http://127.0.0.1:4000/health`.
- API database readiness: `http://127.0.0.1:4000/ready`.
- Web connection bridge: `http://localhost:3100/api/health` (checks API database readiness).
- PostgreSQL: `127.0.0.1:5433`, with a persistent Docker volume. The Compose service is for local development; its initialization user is not a production application role.

```sh
npm run lint
npm test
npm run build
npm run db:check
```

`npm test` checks configuration, real HTTP API success/failure behavior, and the web health bridge without requiring a database. `npm run db:check` also verifies authentication against a disposable PostgreSQL database created and removed by the test. The local test database user needs CREATEDB permission; do not run these integration tests with production credentials. Root configuration and setup code are included in the lint command.

For schema changes in `apps/api/src/db/schema.js`, run `npm run db:generate`, review the generated SQL under `apps/api/drizzle`, then run `npm run db:migrate`. The first migration creates users, authentication sessions, and shared attempt counters. Migrations are explicit and never run on application startup. `npm run db:studio` is an optional local schema browser.

For production verification after a build, start the API with `npm run start --workspace @throtl/api` and the web with `npm run start --workspace @throtl/web`. Set `NODE_ENV=production` and supply database credentials and the server-only `API_ORIGIN` through the deployment environment. The API defaults to loopback; set `HOST=0.0.0.0` when a container platform requires it. Use a least-privilege database role, provider-required TLS, and a platform HTTPS reverse proxy before deployment. Each API process has at most ten pooled database connections, so size the database connection budget against the process count.

Stop local PostgreSQL with `npm run db:down`; this preserves its data volume. Changing initialization credentials after the volume exists does not change the existing database user's password. Do not delete the volume to resolve this without accepting data loss.

Drizzle Kit currently pulls an outdated nested esbuild through `@esbuild-kit/core-utils`. A narrow npm override selects esbuild 0.25.12 (also used directly by Drizzle Kit) to address GHSA-67mh-4wv8-2f99; schema generation and migration commands are verified with it. Remove the override when upstream no longer needs it.

The current full npm audit also reports six moderate findings in the existing ESLint development dependency chain, rooted in minimatch <11.0.1 (GHSA-g3hv-75wg-m249). The production-only audit is clean. Lint patterns here are repository-controlled, and this dependency is not used on the request path. Do not apply npm's suggested forced ESLint downgrade; update the lint toolchain separately when a compatible upstream fix is available.

The API uses finite database timeouts and a bounded graceful shutdown. Health/readiness and bridge responses are uncached. The frontend connection check is explicit, times out, and can be retried; it does not poll.

Later Redis integration, browser automation, and benchmark commands will be added with those features. No empty commands promise unfinished functionality.

## Proposed acceptance gates for review in Task 01

| Concern | Proposed measurable condition |
|---|---|
| Fixed-window attack | Two L-sized bursts straddling a boundary admit about 2L in fixed window, at most L in exact sliding log within the same short observation interval; measured timing tolerances documented |
| Distributed allowance | For one key in one non-boundary window, concurrent shared state admits L; evenly routed local state admits up to 3L |
| Accuracy | Exact algorithms obey their stated invariants; approximate counter documents its error behavior, not a claim of exact rolling counts |
| Throughput | Sustain 1000 offered HTTP requests/second per selected algorithm, 1000 virtual identities, three instances; report achieved rate, not just scheduled work |
| Benchmark duration | Propose 10-second warmup plus 60-second measured interval, three repetitions, with cold-start burst tests separately; approve before measurement |
| Generator health | Propose at least 95% of requested dispatch rate, at most 1% transport errors, bounded pending work; expose late/missed dispatches. Failure is reported, never disguised as successful limiting |
| UI responsiveness | Propose measured interaction response p95 under 100 ms during a 60-second run; target at least 30 fps where chart animation is active, verified on a documented device/browser |
| Live updates | Propose summary batches at 5–10 Hz; details use an explicit bounded byte/event budget |
| Resource growth | Records, chart buffers, sockets, uploads, Redis keys, and timers remain within configured budgets; after cleanup, no run-owned resource remains beyond TTL |
| Recording | Complete mode has a validated total-event/byte ceiling; load mode reports exact aggregate counts and truthful sampled-detail coverage |
| Concurrency | Empirically find sustainable mixed-run capacity for the test environment; no arbitrary universal concurrent-user promise |

These values are proposed quality gates, not user-confirmed limits. Actual maximum run duration, upload size, queue wait, detail budget, reconnect grace, and retained-result TTL must be chosen in Task 01 with memory accounting. No unlimited runs. Validation is enforced server-side even if the UI also validates.

## Definition of Done

For each task: meet its acceptance criteria; test meaningful new logic and error paths; verify the slice at runtime; build/lint affected packages; preserve prior behavior; explain the invariant to the learner. Do not add tests for static prose or trivial cosmetic changes. Keep the change focused and use established modules before new abstractions.

For each checkpoint: demonstrate the new path and relevant failure case, reconcile metrics, inspect memory/resource bounds, and update only actually completed checkboxes. Review uncertainty with the learner; do not treat a time estimate as permission to reduce correctness.

For final delivery: full agreed feature matrix, repeatable behavior evidence, honest load results, browser verification, safe trust boundaries and temporary-file cleanup, documented failure behavior, four evidence-backed ADRs, clean-start instructions, and learner walkthrough. Review before merge/deployment; this plan performs neither.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope grows past learning budget | High | Fixed checklist, stretch day-10 checkpoint, re-estimate early, no silent scope removal |
| Shared Redis race/expiry bug | High | Atomic operations and cross-process concurrent tests, no read/check/write sequence |
| Shared leaky queue drains three times too fast | High | One global pacing rule, fault/cancellation tests, explicit Task 17 proof |
| Generator becomes the bottleneck | High | Separate process role, pooled connections, bounded open-loop scheduling, lateness metrics |
| Recording overwhelms memory/browser | High | Incremental state or summaries, bounded retention, batched snapshots, explicit sampling |
| App work hides limiter cost | Medium | Separate timing scopes and baseline endpoint benchmarks |
| Credential hashing/upload traffic saturates host | High | Low-rate workflow benchmarks, byte/concurrency budgets, separate high-rate baseline proof |
| Visitor data mixes across runs | High | Capability ownership, state namespaces, concurrent isolation tests |
| Real arrival order differs between algorithms | Medium | Seeded intended schedule, arrival skew metrics, deterministic fake-clock reference evidence |
| Retry scenarios no longer have identical traffic | Medium | Label baseline schedule versus response-dependent attempts, keep per-algorithm ledgers independent |
| Clock offsets create misleading evidence | High | Label time source/offset; distinguish wall clock from elapsed scheduling time |
| Same-host processes overstate distributed proof | Medium | Document network/failure/environment limits; no claim of independent-host resilience |
| Free hosting cannot sustain target | Unresolved | Hosting is deferred; publish measured local envelope without promising hosted capacity |

## Decisions to resolve, not silently assume

Task 01 records practical resource limits, proposed fail-closed/stop/disconnect policies, queue ordering/cancellation semantics, demo-target authorization requirements, virtual-client definitions, and baseline versus retry ceilings in [the specification](../docs/spec.md). These are authored proposals awaiting user review, not silently accepted decisions. Exact authentication transport and wire headers are finalized in Tasks 03/05.

Task 17 reviews a minimal atomic shared pacing design if cancellation/crash behavior requires a meaningful trade-off. Task 29 reviews temporary ledger retention and simulated failure injection semantics. The UI's visual styling and exact libraries are minor implementation choices unless the user supplies preferences. Architecture should not grow just to cover hypothetical future scale.

## Requirement traceability

| Requirement | Tasks |
|---|---|
| Five hand-written algorithms, one contract | 04, 13–17 |
| All traffic patterns and client distribution | 06, 19–21 |
| Real HTTP decisions/headers | 05–06; application outcomes in 27–32 |
| Live timeline and algorithm state | 07–08, 12–18, 33 |
| Same traffic side-by-side | 22–23 |
| Three instances, local/shared state | 09–10, 13–17 |
| Four realistic disposable workflows | 27–32 |
| 1000 clients, 1000 RPS per algorithm | 11, 21, 23, 38 |
| Decision timing and smooth browser | 12, 36, 38 |
| Clock drift demonstration | 26, 37, 39 |
| Replay and export | 18, 24–25 |
| Concurrent isolated visitors | 07, 10, 34–35 |
| Four ADR answers | 39 |
| Learning-first and reproducibility | checkpoints, 40–42 |
