# RateLab experiment specification

Status: Task 01 specification draft; proposed full-system behavior remains reviewable. Tasks 02–06 implement the local fixed-window experiment described below.

The interview requirements below are agreed. Rules labeled **Proposed** are concrete defaults prepared for review, not previously approved product decisions. After review, this document becomes the behavior contract for implementation and tests. Hosting selection and capacity promises remain deferred.

## 1. Agreed scope

- Next.js/TypeScript UI; TypeScript Node/Express REST backend; Redis shared state.
- Five hand-written algorithms: fixed window, exact sliding log, approximate sliding-window counter, token bucket, and bounded queued leaky bucket.
- Real HTTP requests to RateLab's own registered demo API instances. No arbitrary destination URLs.
- Configurable steady, burst, ramp-up, sawtooth, boundary attack, and many-clients/one-heavy-client traffic; algorithm comparisons; one or three target API processes.
- In three-instance mode, switch between separate instance-local allowance and shared Redis allowance. Algorithms and experiments have independent state on the same three processes.
- Live decisions, aggregate timelines, internal state explanations, completed-run replay, and downloadable temporary results. Small learning runs record all decisions; load runs retain aggregates and limited detail.
- Disposable login, search, idempotent simulated payment, and actual generated-byte upload workflows. No real financial integration or visitor accounts/history.
- Per-instance artificial clock offsets. Configuration is immutable once a run starts.
- Target 1,000 virtual clients and 1,000 offered requests/second **per algorithm**. Five selected algorithms therefore offer 5,000 requests/second total, before response-dependent retries. Achieved rates and errors must be reported.

## 2. Configuration and key scope

**Proposed:** Each run has a server-generated identity, seed, selected algorithms, instance count, state mode, time mode, traffic configuration, recording mode, workload, and dispatch duration. Resolve and validate all configuration before dispatch. Return the effective configuration, including operator ceilings. Never silently clamp an invalid request.

A virtual client is a synthetic stable identity in the schedule, not a browser visitor, socket, account, thread, or process. Client count defines the available identity pool; report how many actually dispatched traffic.

| Setting | Unit and meaning |
|---|---|
| Offered rate | Requests/second per algorithm; total across all its virtual clients and instances |
| Dispatch duration | Milliseconds during which new scheduled requests may be sent |
| Window limit / duration | Positive integer requests / positive integer milliseconds |
| Token capacity / refill | Positive integer tokens / positive finite tokens per second |
| Token cost | One token per request in the initial version; no weighted-cost editor |
| Queue capacity | Positive integer waiting requests per limiter key; excludes request currently executing application work |
| Drain rate | Positive finite service admissions/second per limiter key |
| Clock offset | Signed integer milliseconds per instance |
| Burst size / period | Positive integer requests / positive integer milliseconds |
| Heavy-client share | Fraction from 0 to 1 of scheduled traffic assigned to one chosen client |
| Upload size | Positive integer bytes generated per upload |

Reject NaN, infinity, negative/zero values where inappropriate, unknown fields, unsupported combinations, oversized identifiers, duplicate algorithms, and configurations exceeding operator budgets. Integer arithmetic and unit conversions must stay within safe numeric range. Algorithm-specific controls are shown only for that algorithm; do not invent a reset time for token/queue algorithms.

**Proposed scopes:** Support `global` and `client` for general experiments; default `global`. Login additionally supports `account`. Endpoint scope means an endpoint-specific policy combined with global/client/account identity, not a second limiter silently layered over the first. Only one configured policy applies to a request in the first version.

Logical identity is `(run, algorithm, endpoint policy, scope identity)`. Local mode adds the target instance to storage identity; shared mode does not. Replica routing never changes the client's logical identity. Separate runs and comparison arms cannot consume each other's allowance or application state. Synthetic clients/accounts come from validated run configuration, not forwarded IP headers supplied by arbitrary callers.

**Worked example:** L=100/minute with 10 clients means at most 100 admitted in one fixed window for a global shared key; client scope gives each client up to 100, potentially 1,000 overall. This is independent of offered requests/second.

## 3. Time and algorithm decisions

**Proposed:** Use milliseconds internally. Record intended dispatch offset and actual dispatch/arrival time. Use monotonic elapsed time for dispatch scheduling, request deadlines, queue waiting, and performance measurements. Offsets affect limiter decision time only.

Default limiter time is instance wall time plus its configured offset. A separate shared-time experiment mode, available with Redis state, obtains authoritative Redis time within the atomic decision. In that mode instance offsets do not influence limiter decisions; the UI explicitly says so. Default offsets are zero. A shared store alone does not repair inconsistent clocks.

Within a key, effective decision time never moves backwards: clamp raw time to the last effective time, atomically in shared mode. Record raw and effective time and whether clamping occurred. Artificially fast instance clocks can advance a shared key and keep slower instances clamped; this is an observable lesson, not hidden correction. Time and source are exported. Queue reservations use the chosen time basis consistently; elapsed waiting/deadline checks remain monotonic.

| Algorithm | Proposed admission rule and state |
|---|---|
| Fixed window | Windows are epoch-aligned `[kW, (k+1)W)`. Allow iff current window count is below L, then increment. Rejections do not increment. At exactly the boundary, use the new window. |
| Sliding log | Active accepted timestamps are `(t-W, t]`: remove entries at or before `t-W`. Allow iff active count is below L, then insert this uniquely identified request. Rejections are not inserted. |
| Sliding counter | Keep accepted counts for previous/current aligned windows. At elapsed x in current window, estimated usage is `current + previous * (1-x/W)`. Allow iff `estimated + 1 <= L`, then increment current. Do not round before comparison; expose fractional usage. This is an approximation, not an exact rolling guarantee. |
| Token bucket | Start full. Refill lazily by `elapsedSeconds * refillRate`, capped at capacity. Allow iff at least one token is available, then subtract one. Rejections may update refill bookkeeping but do not consume a token. |
| Queued leaky bucket | Admit into a FIFO waiting queue if capacity permits; otherwise reject immediately. First service can start immediately if idle; subsequent service starts are separated by at least `1/drainRate` seconds. Service starts are paced, not HTTP completions. There is no accumulated idle burst credit. |

For fixed-window rejection, `retryAfterMs = resetAtMs - rawTimeMs`, including any rollback gap; allowed requests return zero. This assumes the raw clock subsequently advances normally and does not reserve future allowance.

Rejected requests carry a reason and relevant bounded state; allowed requests carry equivalent evidence. Shared decisions update check, mutation, and expiration atomically. TTL must not remove state while it could still affect a decision or pending queue work; early expiry is a correctness bug.

Queue FIFO order is limiter admission order, not client send order. Shared mode requires one global capacity/order/service cadence across three instances. Application processing may overlap after service starts; the queue does not promise completion order. A 200 is returned only after queued work is served and the application succeeds, not at queue admission.

**Proposed queue cancellation:** Remove cancelled waiting entries and release their waiting capacity. If the minimal implementation uses service reservations, cancelled reservations may leave idle slots; never advance service into a slot already promised to another request. Explain any idle gap. At the maximum wait deadline, a still-waiting request expires and must never later execute. Do not refund token/window allowance after an application failure or ambiguous disconnect. Do not retry a queue admission automatically.

## 4. Decisions, HTTP outcomes, and counters

A limiter decision and an application outcome are separate facts. Bad credentials admitted by a limiter can return 401. An idempotency conflict can return 409. Oversize uploads can return 413. A limiter denial is 429. Dependency errors are explicit 5xx, not fabricated limiter denials. A queued wait timeout is proposed to return 504 if the connection remains writable.

**Proposed header contract:** Use explicitly application-defined `X-RateLab-Algorithm`, `X-RateLab-Instance`, `X-RateLab-Decision`, and algorithm-specific remaining-capacity metadata. Window policies expose limit, remaining integer allowance, and absolute reset milliseconds. Token policies expose token capacity, fractional tokens, and refill rate. Queue policies expose waiting capacity, depth, and drain rate. These are educational headers, not a claim to implement an IETF rate-limit standard. Document exact wire names with the shared contracts in Task 03/05. Known limiter rejections include `Retry-After` as rounded-up seconds, minimum 1; it is an advisory earliest retry, not a reserved slot. Omit it if a correct bound cannot be computed. Do not cache experiment responses.

**Task 05 standalone wire contract:** `GET /demo` uses a single server-owned global fixed-window policy (100 requests / 60,000 ms by default). Responses contain `{ version: 1, algorithm: "fixed-window", instance: "local", decision }`, typed by `FixedWindowDemoResponse` in the shared package. Both 200 and 429 carry `X-RateLab-Algorithm`, `X-RateLab-Instance`, `X-RateLab-Decision` (`allowed`/`rejected`), `X-RateLab-Limit`, `X-RateLab-Remaining`, and `X-RateLab-Reset-Ms` (absolute Unix milliseconds). A 429 additionally carries `Retry-After: max(1, ceil(retryAfterMs / 1000))`; allowed responses omit it. All demo responses use `Cache-Control: no-store`. Queries return 400; non-GET methods return 405 before evaluation. No caller-controlled key/configuration/target is accepted. This bounded local demonstration precedes run ownership, registered generator targets, and per-run state; it does not implement those later capabilities.

Authoritative per-algorithm counters:

- `scheduled`: offered attempt slots, including a separately counted retry subset.
- `missed`: slots not dispatched because of lateness, in-flight budget, or run cancellation. Include a reason; no delayed catch-up burst.
- `dispatched`: HTTP attempts actually initiated; every retry is a new attempt ID under the same logical operation ID.
- Limiter facts: `allowed` (including queue admissions), `rejected`, and `unknownDecision`. A transport loss before a confirmed response is unknown to the generator even if the server later reports a decision.
- `queuedTotal`: cumulative admitted requests that waited; overlaps `allowed`. `queueDepth` is a current gauge, never added to totals.
- Application outcomes: `applicationSucceeded`, `applicationFailed`, and `applicationUnknown`. An admitted failed login increments application failure, not limiter rejection.
- Request terminal outcomes: `responseReceived`, `transportFailed`, `cancelled`, `timedOut`. Each dispatched attempt has exactly one generator terminal outcome. HTTP errors still count as received responses.
- `inFlight`: dispatched attempts without a generator terminal outcome. Track target-side active/queued work separately because a client timeout may precede server cleanup.

Reconciliation: `scheduled = missed + dispatched` after dispatch closes. At any point, `dispatched = responseReceived + transportFailed + cancelled + timedOut + inFlight`. After a terminal run, inFlight is zero. For server-observed evaluated requests, `evaluated = allowed + rejected`; failed evaluation is separate. Never sum server decisions with generator outcomes as though they partition one total. Exports expose missing telemetry and unresolved application outcomes instead of asserting exact knowledge after a network failure.

Decision latency measures limiter evaluation; shared mode includes the Redis round trip. HTTP round-trip, queue wait, application time, and dispatch lateness have separate distributions. Histograms and counts are bounded. Sampling detailed events must not sample aggregate counters. Labels distinguish selected clients, active clients, scheduled rate, achieved dispatch rate, and completion rate.

## 5. Lifecycle, stopping, and ownership

**Proposed states:** `created -> running -> draining -> completed`. `running` means dispatch remains open; `draining` means no new attempts are scheduled but already dispatched work is settling. `running` or `draining` may enter `stopping -> stopped` on explicit stop/disconnect expiry, or `failed` on a fatal dependency/invariant error. Validation failure creates no run. Terminal states never return to running. Expired result storage is reported as expired, not an empty successful run.

Natural duration expiry stops new dispatch and retries; queued/in-flight attempts may settle within their deadlines. Explicit stop cancels unsent slots, pending retries, waiting queue entries, active HTTP work where possible, and upload streams. Stop is idempotent. Wait for bounded cleanup, preserve partial results, and identify operations whose application outcome is unknown. Cancellation cannot undo an already committed simulated payment.

Configuration cannot be patched mid-run. Starting again creates a new run with fresh state and may reuse the seed. Coordinator restart may lose temporary results; no durable experiment recovery is promised. On Redis loss in shared mode, **proposed fail-closed policy** stops the run as failed; never silently switches to local state. Failure of a target connection is a transport error; do not retry it unless the selected workload's explicit retry policy permits it.

**Proposed ownership:** Anonymous browser sessions own runs via unguessable credentials, with read/control authorization on start, status, SSE, stop, and export. Cookie-based same-origin control uses CSRF/origin protections; credentials never appear in URLs, exports, or logs. Exact transport is finalized during setup. Target endpoints require coordinator authorization tied to a live run/configuration, preventing direct bypass of scheduling/resource budgets. Visitors cannot select target hosts, Redis keys, filesystem paths, or synthetic credentials outside the run.

SSE sends current aggregate snapshots and bounded detail batches. Reconnect replaces aggregate state with a fresh snapshot; it must not add cumulative counters twice. Missing detail is labeled. Each run retains at most one active control stream; reconnect replaces it. After the last authorized connection disappears, a grace deadline starts; reconnect within it preserves the run. No unlimited unattended jobs.

## 6. Proposed budgets and recording

These defaults are reviewable development settings, not benchmarked capacity. Operators may change them without changing algorithm behavior. The start response shows effective ceilings; reject over-budget requests with an explanatory error before dispatch. Revisit budgets after Task 11's measured probe.

| Budget | Proposed initial value |
|---|---:|
| Default / maximum dispatch duration | 10 seconds / 120 seconds |
| Maximum virtual-client pool | 1,000 per experiment |
| Maximum baseline offered rate | 1,000 requests/second per selected algorithm |
| Aggregate offered-rate ceiling | 5,000 attempts/second across active runs, including retries |
| Maximum active runs | 10, also subject to aggregate resource admission |
| In-flight HTTP attempts | 256 per algorithm; 2,048 across coordinator |
| Maximum dispatch lateness | 100 ms; overdue slots counted as missed |
| Queue waiting capacity | At most 100 per key; total pending work also bounded by in-flight budget |
| Queue wait / total attempt deadline | 5 seconds / 15 seconds, starting at queue admission / dispatch respectively |
| Stream reconnect grace | 15 seconds |
| Result retention after termination | 10 minutes, subject to aggregate retained-record budget |
| Maximum retained run records | 20; reject new runs when unexpired retention cannot be budgeted |
| Aggregate retained-record budget | 64 MiB coordinator-side accounted serialized records, plus separately bounded live structures |
| Complete recording | At most 2,000 anticipated attempts across all algorithms and 4 MiB; reject complete mode if worst-case retries exceed it |
| Sampled recording | At most 1,000 request records and 2 MiB per run |
| One request detail | At most 8 KiB including explanatory state; summarize large logs/queues explicitly |
| Aggregate stream refresh | 5 Hz; bounded 256 KiB pending output per connection |
| Browser live timeline | At most 600 aggregate points per algorithm; at most 1,000 detailed rows per run |
| Single generated upload | At most 1 MiB; maximum 4 simultaneous body transfers per run, 8 total |
| Active temporary upload bytes | Reserve declared size; at most 8 MiB per run and 32 MiB across target instances |
| Artificial offsets | -5,000 through +5,000 ms per instance |

Serialized-byte accounting is not a claim about V8 heap consumption; measure heap, object overhead, active keys, scheduler state, and browser memory. Per-key state still needs a bounded key count and total entries: only configured synthetic identities may be used; log entries cannot exceed validated admitted/window budgets; reject configurations whose worst-case state estimate exceeds a proposed 32 MiB per-instance allowance. These estimates must be calibrated before declaring capacity supported.

Complete recording captures every decision and enough algorithm-specific evidence to explain before/after state. Large structures use counts, bounded excerpts, and transition data rather than a full cloned log per decision; the inspector labels excerpted fields. If runtime encoded size unexpectedly exceeds the complete budget, fail the run with partial-results metadata rather than silently claim complete replay.

**Proposed sampled selection:** Keep the first 100 decisions and up to 900 deterministic hash-selected decisions by attempt ID, stopping at byte budget. State the selection rule, retained/omitted counts, and limitations; this is not an unbiased statistical sample. No reconstruction of unrecorded transitions. All aggregate counts/histograms still cover the observed run. Aggregate totals mean exact counts of observed facts, not omniscience about lost responses.

Scheduling is open-loop: slow responses do not delay creation of intended slots. Maintain a bounded scheduling horizon, not a precomputed array of every future request. Distribute a per-algorithm global in-flight budget fairly among active runs. Capacity errors never secretly lower a requested rate. The system can instead refuse a new experiment or count missed slots when actual runtime capacity is lower than expected.

## 7. Traffic, comparison, and preset rules

Use a seeded identity/pattern generator and stable logical operation IDs. Steady means equally spaced intended slots; burst means configured groups at intervals; ramp is a linear offered-rate increase over dispatch duration; sawtooth repeats a linear ramp over a configured period. Heavy-client mode assigns a configured fraction to one client and distributes the rest over remaining clients; with one client its share is 100%. Validate a rate/count combination that rounds to zero requests as an empty experiment, not a successful throughput benchmark.

Boundary attack derives a target aligned boundary from the selected authoritative time; schedule one L-sized burst just before it and one just after. Record actual arrival times and jitter. Under offsets, actual per-instance boundaries may differ and this must remain visible.

Comparison reuses intended dispatch offsets, identity assignments, payload seeds, and logical IDs for each algorithm. Each arm has its own actual HTTP attempts, limiter state, application ledger, and results. Never gate one algorithm on another's response. Offer 1,000/second per algorithm; do not divide that rate by selected algorithm count. Real arrivals/order may differ; disclose skew. Retained-decision replay issues no HTTP traffic; rerunning a seed is a fresh experiment, not guaranteed identical wall-clock outcomes.

| Preset | Proposed application behavior |
|---|---|
| Login brute force | Seeded fake accounts with real credential checks; configurable account or client key. Good credentials return 200; bad credentials return 401 after admission; limiter denials return 429. No production user signup or visitor credentials. |
| Search spike | Bounded query strings against a deterministic seeded dataset; real matching work, no external search. Client key by default. Application time is separate from limiter time. |
| Payment retries | Integer minor-unit simulated amounts and experiment/algorithm-scoped ledger. Same idempotency key plus same payload returns original result; changed payload returns 409. Concurrent retries across instances create at most one charge. Client key by default. |
| File uploads | Server-generated byte stream, validated size, streamed temporary storage with backpressure. Client key by default. Limit admission before application body processing; reject oversize input and clean up on every terminal path. Queueing may leave bytes in bounded transport buffers; no promise that no bytes arrive before admission. |

**Proposed payment retry policy:** Baseline slots represent new payment operations. An attempt may retry on received 429, configured injected 503, transport failure, or deadline timeout; never retry 401, 409, or 413. At most three attempts per operation including the first; retain its idempotency key and payload. Default backoff is 250 ms then 500 ms with seeded jitter up to 100 ms; respect a larger received Retry-After. Retries stop at dispatch close or explicit stop. They are new scheduled attempts sharing rate/in-flight ceilings, not invisible extra traffic. Reserve worst-case retry capacity on admission (up to three times baseline rate); reject a configuration exceeding aggregate ceiling. Thus the 5,000/second all-five baseline benchmark uses retries disabled. Response-dependent retries may differ across comparison arms; report that difference.

Failure injection is deterministic and confined to simulated endpoints: optionally return 503 after an atomic ledger commit to demonstrate lost-response retries. Application state is reset for new runs and retained at least until all attempts have settled, then expires with results. Payment idempotency and limiter admission use different keys. Waiting/unknown request outcomes must not falsely claim a payment was rolled back.

## 8. Worked acceptance examples

These are hand-checked specification examples, not claims of executed runtime tests. Later tasks translate them into deterministic and real-HTTP tests.

### A. Exact boundaries

L=2, W=1,000 ms, offset=0. Fixed-window requests at 998 and 999 ms pass; requests at 1,000 and 1,001 ms pass in the next window. Exact sliding log admits the first two and rejects the latter two. At 1,998 ms the 998 ms entry is exactly at the cutoff and is removed, allowing another request. Scaling the bursts to L=100 explains about 200 versus 100 within the short attack interval, not a claim that a long run admits only 100 total.

### B. Three instances and scope

L=2, one global key, six requests inside one fixed window, round-robin across A/B/C. Local mode admits all six (two per instance); shared mode admits exactly two total. Repeat for another run and get an independent allowance. Switching to client scope intentionally multiplies allowances and is not evidence of a shared-state bug.

### C. Failed login

One dispatched attempt is allowed, then fails credential checking and returns 401. Generator totals: dispatched=1, responseReceived=1, inFlight=0. Server totals: evaluated=1, allowed=1, rejected=0. applicationFailed=1. Retrying uses another allowance; the failed login does not refund it.

### D. Payment retry after commit

Operation P with key K commits a simulated charge of 500 minor units, but injected 503 reaches the generator. First attempt is allowed and receives a response, while the ledger already contains one charge. A second allowed attempt with K and the same payload returns 200 with the original result. Two attempts, two allowances consumed, one charge. Same K with amount 600 returns 409 and creates no new charge. The first HTTP failure does not prove the payment did not happen.

### E. Queued request cancelled on stop

Drain=1/second, waiting capacity=2. Request A starts service at t=0; B admitted at t=100 ms waits for t=1,000 ms. Stop at t=200 ms removes B before execution and cancels its HTTP attempt. B remains allowed=1 and queuedTotal=1 historically, has cancelled=1 at the generator, and never becomes applicationSucceeded. Queue depth returns to zero. Do not count B as both rejected and cancelled.

### F. Count reconciliation

Ten slots: two missed; eight dispatched. At observation: responseReceived=5, transportFailed=1, cancelled=1, timedOut=0, inFlight=1. Then `10 = 2 + 8` and `8 = 5 + 1 + 1 + 0 + 1`. After the final attempt times out, timedOut=1 and inFlight=0. Server evaluation counts may differ due to lost responses; missing correlation remains explicit.

### G. Token refill and counter approximation

Capacity=2, refill=1 token/second. Two requests at t=0 pass. At 500 ms, tokens=0.5 and a request fails; at 1,000 ms one token is available and a request passes. Separately, sliding counter with L=10, W=1,000 ms, previous=8, current=3 at x=500 ms estimates 7; a request passes and increments current to 4, making estimated usage 8. The exact log may disagree depending on the eight timestamps.

## Implemented first experiment (Task 06)

The initial run supports steady traffic, one client, one local instance, and a global fixed-window key. Each run gets fresh state and immutable validated settings. Defaults are 10 requests/second, 10,000 ms, and 5 admitted requests per 1,000 ms. Current input ceilings are 1,000 requests/second, 120,000 ms, 1,000 requests/window, and 60,000 ms/window; minimum duration is 100 ms. Full presets, Redis, comparison, clocks, and event recording remain later tasks.

`POST /runs` returns `{ run, token }`; `run.id` is an opaque identifier, while a separate 256-bit bearer token authorizes `GET /runs` and `DELETE /runs`. Credentials are not placed in URLs. A separate server-only token authorizes `/runs/target`; that route returns the same decision-derived metadata as the standalone demo. The generator's only registered target is the current API listener, derived from socket address/port rather than request Host or configuration. Unknown config fields and query parameters are rejected. The Next.js bridge bounds input and requires same-origin mutations; API controls require a custom header and do not enable CORS.

Runs move from running to draining to completed, or through stopping to stopped. Stop is idempotent and returns after all generator tasks settle. Process shutdown cancels runs before closing the listener. The generator uses monotonic time, keep-alive HTTP, at most 256 in-flight requests per run and 2,048 total, a 15-second total request deadline, and 100 ms lateness tolerance. Aggregate admission is capped at 10 active runs / 5,000 offered requests per second; 20 snapshots are retained for 10 minutes after settlement with lazy expiry. These budgets do not establish achieved throughput.

Scheduled slots are `ceil(durationMs * ratePerSecond / 1000)` at offsets starting at zero and strictly before duration end. Missed slots record lateness, in-flight budget, or cancellation. UI completed attempts are `dispatched - inFlight`; final counter identities follow Section 4. Incomplete/failed transport outcomes are unknown decisions, not 429. The UI polls status and shows final totals; unmount attempts a best-effort stop. Reload recovery, disconnect grace, and guaranteed delivery of a start/stop response are not part of this slice; disconnected work remains duration/deadline bounded. Browser tests were explicitly excluded by the user for this task.

## 9. Task 01 completion and review

Authored: configuration/scope, units, algorithms and boundaries, counters, lifecycle, queue rules, budgets, recording, clocks, retries, failures, ownership, and worked examples. No runtime behavior is verified yet; there is no application test/build toolchain at this stage.

Review before treating proposed rules as accepted: global default/key scopes; token cost; time clamping; queue deadlines/cancellation gaps; stop/disconnect behavior; fail-closed shared mode; numeric resource budgets; payment retry policy; and temporary result retention. Algorithm implementation details may change only while preserving accepted behavior, or through an explicit specification revision.

Task 01 documentation can be checked for completeness now. User review of the proposed behavior remains a separate unchecked gate; Task 02 implementation should follow that review.
