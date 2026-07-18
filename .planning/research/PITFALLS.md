# Domain Pitfalls: v1.4 Task Delegation Platform

**Domain:** Porting multica's Go-based task-delegation system to Aquarium CE (Node.js + Express + SQLite + React)
**Researched:** 2026-04-16
**Overall confidence:** HIGH (multica source analysis at /tmp/multica + Aquarium codebase + Node.js/SQLite official docs + current ecosystem research)

This document focuses on pitfalls specific to the port/graft. It distinguishes **port bugs** (Go → Node translation artifacts) from **greenfield bugs** (new integration risk in Aquarium).

Each pitfall includes:
- **Classification** — port bug / greenfield bug / cross-cutting
- **What goes wrong** — concrete failure mode
- **Prevention** — actionable mitigation
- **Owning phase** — which planned phase must address it
- **HARD CONSTRAINT marker** — flags decisions that, if ignored, invalidate a phase plan

---

## Port-from-Go Risks (Node translation artifacts)

Multica's daemon is 1,323 lines of Go using goroutines + channels + contexts heavily. Node.js has none of these primitives natively. These are the gotchas when doing structural translation.

### PG1: Goroutine-per-concurrent-task → unbounded async leak — HARD CONSTRAINT

**Classification:** Port bug
**What goes wrong:** Multica's `pollLoop` uses a semaphore channel (`sem := make(chan struct{}, d.cfg.MaxConcurrentTasks)`) to cap concurrency at N. The Go idiom pairs `sem <- struct{}{}` with `defer func() { <-sem }()`. In Node, fire-and-forget `void handleTask(task)` provides NO backpressure — a fast-polling daemon can launch 20, 200, or 2000 concurrent handlers before anything returns.

**Consequences:** Memory exhaustion, thundering-herd of child processes, exceeded system file descriptor limits, server endpoint flooded with message POSTs.

**Prevention:**
- Explicit bounded-concurrency primitive. Either `p-limit` (dependency add) or a hand-rolled semaphore class with `acquire()`/`release()` that returns a promise. Use `const release = await sem.acquire(); try { await handleTask(t); } finally { release(); }`.
- Poll loop itself must `await` the next iteration; never schedule `setImmediate(poll)` in a way that fires faster than tasks complete.
- Every spawned background task (heartbeat, workspace sync, GC) must be owned by an `AbortController` so graceful shutdown can await completion.

**Owning phase:** Daemon CLI / task executor phase.

---

### PG2: Unhandled promise rejection kills the daemon — HARD CONSTRAINT

**Classification:** Port bug
**What goes wrong:** Go daemon's goroutines each have their own error-return channel or panic recovery. Node's default `unhandledRejection` in Node 22+ terminates the process. Fire-and-forget `void d.handleTask(task)` in a `for` loop — if one task throws before the `try/catch` is set up, the daemon crashes, losing all in-flight task state.

**Prevention:**
- Every top-level async function launched by the poll loop, heartbeat loop, cancellation poller, and flush ticker MUST be wrapped in its own `.catch(logAndReport)` — NOT optional.
- Register `process.on('unhandledRejection', handler)` that logs to daemon log file AND attempts to mark the in-flight task(s) failed before exit.
- Use `AggregateError` / promise tuples for parallel work so one failure doesn't leave siblings orphaned.
- Add a `process.on('uncaughtException')` hook to write a crash marker to `~/.aquarium/daemon.crash.log` before dying.

**Owning phase:** Daemon CLI / task executor phase.

---

### PG3: Timer and interval leaks on reload/restart

**Classification:** Port bug
**What goes wrong:** Multica uses `time.NewTicker(interval)` with `defer ticker.Stop()` — stopping the ticker on function return is idiomatic and visible. Node's `setInterval(fn, ms)` returns a `NodeJS.Timeout` that must be manually cleared. Missed clearings on daemon reload, workspace sync iteration, or task completion produce a growing pool of ghost timers that keep the event loop alive and prevent clean `process.exit(0)`.

**Prevention:**
- Prefer a `PeriodicTask` helper class that wraps `setInterval` + an `AbortSignal` and exposes `stop()` — forbid raw `setInterval` outside this helper in lint rules (ESLint custom rule or PR check).
- In flush/batch code (like the per-task 500 ms message flush), use `ticker.ref()`/`unref()` intentionally — unref so in-flight flush intervals don't block process exit, but ensure a final `flush()` is called before exit.
- Every `setTimeout` tracking must be stored on the owning object so `stopDaemon()` can iterate and clear.

**Owning phase:** Daemon CLI / task executor phase.

---

### PG4: Channel-full drop semantics silently lose messages

**Classification:** Port bug
**What goes wrong:** Multica's `trySend(ch, msg)` uses `select { case ch <- msg: default: }` — if the buffered channel (256) is full, the message is DROPPED. A direct port to `pendingText.push(msg)` in an unbounded array produces different behavior: backpressure is gone and memory grows unbounded if the consumer is slower than the producer. A lazy port to an EventEmitter with no consumer attached silently drops everything.

**Prevention:**
- Be explicit about which stream is lossy vs reliable. The tool_use/tool_result stream is LOSSY in multica (dropped on full channel) but the text/thinking accumulator is reliable (accumulated into `output.String()` before return). In Node, model this as two distinct constructs: a bounded ring buffer (for UI streaming) + a separate reliable `Array<string>` joined at completion for the final result.
- When using EventEmitter for pub/sub, add listener-count assertions at startup (`if (emitter.listenerCount('task:message') === 0) throw`).
- Make the batch size and flush interval explicit constants in a config file; do not hardcode 256/500ms in multiple places.

**Owning phase:** Agent backend phase (stream-json parsers).

---

### PG5: Context cancellation is not the same as AbortSignal — HARD CONSTRAINT

**Classification:** Port bug
**What goes wrong:** Go's `context.WithCancel(parent)` creates a tree where cancelling a parent cancels ALL descendants, and `<-ctx.Done()` is a first-class channel receive in any `select`. Node's `AbortSignal` + `AbortController` look similar but:
- `AbortSignal` does NOT auto-propagate to I/O primitives unless explicitly passed (`fetch(url, { signal })`, `spawn(cmd, { signal })`).
- `setInterval`/`setTimeout` do NOT respect AbortSignal unless you use the `{ signal }` option on Node 18+.
- `better-sqlite3` is fully synchronous — it doesn't respect AbortSignal at all; queries cannot be interrupted mid-flight.

**Consequences:** User cancels a task; daemon `AbortController.abort()` fires, but the in-flight `fetch()` to Aquarium server is not cancelled (wrong `fetch` wrapper used), the child process keeps running (spawn didn't get signal), and the flush interval keeps posting messages for a "cancelled" task.

**Prevention:**
- Create a central `createTaskContext(taskId)` helper that returns `{ signal, abort(): void }` and threads the signal through EVERY async boundary: fetch calls, child spawn, interval creation, readline async iteration (`for await` loops).
- Audit every third-party client (`node-fetch`, `undici`, HTTP keep-alive agents) for AbortSignal support BEFORE integrating.
- Document that DB calls are uncancellable; long queries must be avoided in request paths.

**Owning phase:** Cross-cutting — concurrency utility module introduced in the schema phase, enforced by all subsequent phases.

---

### PG6: `await` in for-loops vs `Promise.all` semantics

**Classification:** Port bug
**What goes wrong:** Multica's heartbeat loop iterates `for _, rid := range d.allRuntimeIDs()` calling `d.client.SendHeartbeat(ctx, rid)` — each call blocks the loop. A naive JS translation uses `for (const rid of ids) await send(rid)` which sequentializes N network calls. Someone "optimizes" to `await Promise.all(ids.map(send))` — now N parallel POSTs hit the server simultaneously, blowing through rate limits and making heartbeat loop latency dependent on slowest endpoint.

**Prevention:**
- Keep heartbeat explicitly sequential (small N, serial is correct) OR bound parallelism via `p-limit(3)`.
- Decide per loop: is the order meaningful? If yes, sequential `for await`. If no, parallel with bounded concurrency.
- Document the choice in a comment citing the multica Go equivalent.

**Owning phase:** Daemon CLI phase.

---

### PG7: Missing `for await` in readline streams — HARD CONSTRAINT

**Classification:** Port bug
**What goes wrong:** Multica's claude backend uses `bufio.Scanner` with a 10 MB buffer, iterating line-by-line. Direct Node port uses `readline.createInterface({ input: child.stdout })` and forgets that readline emits events asynchronously. If the consumer uses `rl.on('line', async (line) => { await process(line); })`, processing overlaps and out-of-order writes hit the DB. If the consumer uses `for await (const line of rl)`, backpressure works correctly and lines are processed in order.

**Prevention:**
- ALWAYS use `for await (const line of rl)` pattern, not `rl.on('line', asyncHandler)`.
- Set `readline`'s `crlfDelay: Infinity` to correctly handle CRLF from Windows-spawned CLIs.
- Set `rl.input.setEncoding('utf8')` explicitly — default is Buffer chunks, which can split UTF-8 multi-byte sequences at chunk boundaries (see PG9).

**Owning phase:** Agent backend phase.

---

### PG8: stdout buffer overflow / backpressure cascade — HARD CONSTRAINT

**Classification:** Port bug
**What goes wrong:** `claude --output-format stream-json --verbose` can emit bursts of hundreds of lines per second during tool loops. Node's `child.stdout` pipe has a default 16 KB high-water mark. If the consumer is slower (e.g., busy doing DB writes), stdout fills and the child process blocks on `write()` — effectively pausing Claude. Worse, if the pipe is ABANDONED (consumer stops reading but doesn't close), stdout fills and stays full, wasting the task until `cmd.WaitDelay` equivalent kicks in.

**Prevention:**
- ALWAYS consume stdout to completion; if cancelling, explicitly `child.stdout.resume()` AND `child.stdout.destroy()` to discard buffered data.
- If writing to DB is the bottleneck, batch messages (multica does 500 ms flush) so reads aren't gated on per-line writes.
- Do NOT use `stdout.pipe(someWritable)` without handling `error` events — a slow writable propagates backpressure upstream; a failing writable silently disconnects.
- Set a maximum time between `for await` iterations as a health check; if 60 s elapse without a line, assume hung and kill.

**Owning phase:** Agent backend phase.

---

### PG9: Binary / UTF-8 boundary corruption in stdout

**Classification:** Port bug (subtle)
**What goes wrong:** Tool names in stream-json can include emoji (e.g. "🔍Search"). Node reads stdout as `Buffer` chunks; if a multi-byte UTF-8 character straddles a chunk boundary, `buffer.toString('utf8')` replaces the split bytes with the replacement character U+FFFD. Multica's Go `bufio.Scanner` handles this because Scanner's token splitter is rune-aware.

**Prevention:**
- Set `child.stdout.setEncoding('utf8')` on the pipe — Node then decodes with a stateful decoder that handles boundaries correctly.
- Use `readline` with stdout (not manual `on('data')` accumulation).
- Add a round-trip test: spawn a child that emits emoji tool names and assert the received string is byte-identical.

**Owning phase:** Agent backend phase.

---

### PG10: `JSON.parse` errors on partial lines

**Classification:** Port bug
**What goes wrong:** If Claude crashes mid-output, the last line on stdout may be a truncated JSON blob. `JSON.parse("{\"type\":\"assist")` throws `SyntaxError`. If the parse happens inside an async iterator without try/catch, the iterator loop halts, the rest of the drain aborts, and the final `result` event is lost.

**Prevention:**
- Wrap EVERY `JSON.parse(line)` in a try/catch that logs + continues (multica's Go `json.Unmarshal(...); if err { continue }` pattern).
- Keep a counter of parse failures; if > N in a window, log a WARN with a sample of the bad line (truncated).

**Owning phase:** Agent backend phase.

---

## SQLite Concurrency Risks

Multica relies on Postgres `FOR UPDATE SKIP LOCKED` (agent.sql:101) for fair multi-runtime task claiming. SQLite has no equivalent. These pitfalls govern the schema + service layer.

### SQ1: `FOR UPDATE SKIP LOCKED` has NO SQLite equivalent — HARD CONSTRAINT

**Classification:** Greenfield
**What goes wrong:** A direct port of multica's `ClaimAgentTask` query ("atomically dispatch the next queued task and skip ones that other workers have locked") is impossible on SQLite. Two naive implementations both break:
1. **SELECT then UPDATE in the same transaction**: SQLite serializes writers anyway, but if you don't use `BEGIN IMMEDIATE`, the implicit DEFERRED transaction upgrades from read to write at UPDATE time and can hit `SQLITE_BUSY` under contention.
2. **UPDATE ... RETURNING with a subquery**: SQLite DOES support `UPDATE ... RETURNING` (since 3.35) but since only one writer holds the write lock at a time, this fully serializes claims — there's no SKIP, just a global queue.

**Prevention:**
- Accept that SQLite writes are serial. The multi-runtime claim pattern becomes: each runtime polls → server acquires write lock → runs UPDATE ... RETURNING that filters by runtime_id → releases lock. Throughput ceiling is ~hundreds of claims/sec, which is fine for Aquarium's CE single-machine scale.
- Enable WAL mode at boot (PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL) — readers never block, only writers serialize. Verify with `SELECT * FROM pragma_journal_mode`.
- Set `PRAGMA busy_timeout = 5000` to auto-retry instead of throwing SQLITE_BUSY on transient contention.
- Use `better-sqlite3`'s `db.transaction(fn)` wrapper (it uses BEGIN IMMEDIATE by default) for the claim operation — this prevents the deferred-to-immediate upgrade deadlock.
- Document the concurrency ceiling in ARCHITECTURE.md: CE supports ~20 concurrent tasks across all runtimes. EE may revisit with Postgres.

**Owning phase:** Schema phase + Task service phase.

---

### SQ2: `better-sqlite3` is SYNCHRONOUS — blocks the event loop

**Classification:** Greenfield
**What goes wrong:** Unlike `sqlite3` (the async npm package), `better-sqlite3` runs every query on the calling thread. A 200 ms full-table scan blocks Express from serving ANY other request for 200 ms. In a task-heavy workload (polling, heartbeats, message inserts), this compounds: daemon posts 100 messages, server spends 500 ms inserting them, and every other HTTP request waits.

**Prevention:**
- Every multi-row insert MUST use `db.transaction(rows => rows.forEach(insertOne))` — transactions are ~50x faster than autocommit.
- Use `stmt.all()` for rows, `stmt.get()` for singles, `stmt.iterate()` for cursor-based large results (doesn't materialize).
- NEVER do `SELECT * FROM task_messages` without LIMIT — task_messages grows fast. Paginate.
- Consider a Worker thread for the message-ingest endpoint if profiling shows it's hot. `better-sqlite3` supports multiple connections; readers in workers + single writer in main is a valid topology. Defer this until profiling demonstrates need.

**Owning phase:** Task service phase.

---

### SQ3: CHECK constraint enum drift between SQLite and EE Postgres

**Classification:** Greenfield
**What goes wrong:** SQLite has no ENUM type. Aquarium's convention is TEXT + CHECK constraint. Multica's Postgres schema uses real enums. Code paths that write task status expect to hit exactly one of {queued, dispatched, running, completed, failed, cancelled, blocked}. A typo like `"cancell"` silently passes SQLite's type check UNLESS a CHECK is declared; it fails hard on Postgres. EE port will surface drift late.

**Prevention:**
- Declare CHECK constraints on every status column in the SQLite migration, e.g., `CHECK (status IN ('queued','dispatched','running','completed','failed','cancelled','blocked'))`.
- Export the enum values to a shared TS union type in `packages/shared` and reference them everywhere — compile-time guard prevents typos.
- Add a test that every service function that writes status uses a constant from the shared union, not a string literal.

**Owning phase:** Schema phase.

---

### SQ4: Stale task reaper must run somewhere

**Classification:** Greenfield
**What goes wrong:** Multica has `FailStaleTasks` (agent.sql:131) that runs periodically: dispatched > N secs without start, running > M secs without complete → auto-fail. Without this, a daemon crash leaves tasks in `dispatched`/`running` forever, blocking `max_concurrent_tasks` capacity for that agent, and the UI shows permanently-spinning cards.

**Prevention:**
- Add a reaper loop in the server (not daemon) that runs every 30 s and calls the FailStaleTasks query. Thresholds: 5 min dispatched, AGENT_TIMEOUT+5min running.
- The reaper MUST start AFTER migrations + state reconciliation, consistent with the existing startup order (`db.migrate.latest() → state reconciliation → health monitor → gateway event relay → HTTP + WS server`). Add "task reaper" between health monitor and gateway event relay.
- Emit a websocket event for each reaped task so UI updates immediately.

**Owning phase:** Task service phase.

---

### SQ5: SQLite write-lock starvation under long transactions

**Classification:** Greenfield
**What goes wrong:** If a long-running transaction holds the write lock (e.g., bulk insert of task messages inside `db.transaction(...)` that itself does HTTP calls), all other writers stall until 5 s busy_timeout expires, then throw SQLITE_BUSY. Task claims miss their window, heartbeats fail, downstream cascade.

**Prevention:**
- Never do I/O inside `db.transaction(...)`. The callback passed to `transaction()` must be pure compute + DB calls, no `await fetch()` or network.
- Transactions should cover < 10 ms of work. If bulk insert is slow, shrink batch size.
- Add a runtime assertion in dev: wrap `db.transaction` to warn if elapsed > 50 ms.

**Owning phase:** Task service phase.

---

## Process Management Risks (child spawn, cancel, zombies)

Claude/Codex/OpenClaw CLIs are spawned as child processes. This is the single highest-risk area.

### PM1: Child doesn't respect SIGTERM → zombie — HARD CONSTRAINT

**Classification:** Greenfield (Node) + port of multica's `cmd.WaitDelay = 10 * time.Second` pattern
**What goes wrong:** `child.kill()` defaults to SIGTERM. If Claude CLI ignores SIGTERM (some CLIs do because they wrap sub-subprocesses), the child stays running. Worse, if `shell: true` is used in spawn, Node spawns a shell process which forks the actual CLI — killing the shell leaves the CLI orphaned. Multica handles this via `exec.CommandContext` + `WaitDelay`; Go's runtime escalates to SIGKILL automatically after WaitDelay.

**Prevention:**
- Never use `{ shell: true }` in spawn. Pass args as an array.
- On cancel: `child.kill('SIGTERM')` → wait 10 s → `child.kill('SIGKILL')`. Wrap this in a `killWithEscalation(child, { graceMs: 10_000 })` helper.
- On Linux/macOS, spawn with `{ detached: true }` and `process.kill(-child.pid, signal)` to kill the entire process group — catches grandchildren.
- On Windows, SIGTERM is ignored; use `child.kill('SIGKILL')` or `taskkill /F /T /PID <pid>` via `exec`. Detect platform at spawn time.
- After SIGKILL, still call `await new Promise(r => child.once('exit', r))` — don't free resources until the OS confirms the process is gone (PID could be reused otherwise).

**Owning phase:** Agent backend phase.

---

### PM2: Daemon crash → orphan children keep running forever

**Classification:** Greenfield
**What goes wrong:** Node daemon process dies (OOM, unhandled error). Child `claude` processes spawned with default options stay running — they're re-parented to init/launchd/systemd and continue executing, chewing up CPU and API quota. Next daemon start doesn't know about them; they run to completion without reporting back.

**Prevention:**
- Spawn with `{ detached: false }` (the default, but explicit). This keeps parent-child linkage so when parent dies, children receive SIGHUP.
- On startup, daemon reads `~/.aquarium/daemon.state.json` listing last-known child PIDs. For each, `process.kill(pid, 0)` to check if alive; if so, SIGTERM it.
- Periodically write a `pid.state.json` with `{ taskId, pid, startedAt }` for each in-flight child. Write atomically (temp file + rename).
- Document that Windows does NOT propagate parent death to children; on Windows, use a job object (via `node-ffi-napi` or a separate tool like `winston-daemon`). **Flag as a Windows-specific gap** for the daemon phase; consider the first release "best-effort Windows."

**Owning phase:** Daemon CLI phase.

---

### PM3: PATH inheritance — spawned CLI can't find `aquarium`

**Classification:** Port bug — multica already solved this
**What goes wrong:** Multica's `runTask` explicitly prepends the daemon binary's directory to PATH (daemon.go:939-942) so the spawned claude can call `multica repo checkout`. A direct Node port needs the same: the spawned claude needs access to `aquarium` CLI (for `aquarium repo checkout`, `aquarium comment add`, etc.). Without it, tool calls that shell out to `aquarium` silently fail or call the wrong binary (e.g., a globally installed old version).

**Prevention:**
- Mirror multica's pattern: compute `path.dirname(process.execPath)` (Node binary location) — but for npm-packaged CLIs, `process.argv[1]` is the JS entry point, not the bin. Use `require.resolve('@aquaclawai/aquarium')` or track the user's actual `aquarium` binary via `process.env._` or spawn's realpath.
- Prepend `path.dirname(aquariumBin) + path.delimiter + process.env.PATH` to the child's env.
- Codex specifically runs in a sandbox that may not inherit parent PATH — test with Codex explicitly.
- Blocklist env key overrides from `agent.custom_env` to prevent users shadowing PATH with something broken (multica pattern, daemon.go:1313).

**Owning phase:** Agent backend phase + daemon CLI phase.

---

### PM4: stdin must be closed explicitly

**Classification:** Port bug
**What goes wrong:** Multica writes one JSON line to stdin then closes it (`closeStdin()` at claude.go:76). If you forget to close stdin, Claude's `--input-format stream-json` waits for more input forever. Task hangs until AGENT_TIMEOUT (2h default). With Node, `child.stdin.write(data); child.stdin.end();` — forgetting `.end()` is the same bug.

**Prevention:**
- Helper function `writeAndClose(stdin, data)` that always calls `.end()`.
- Test: start a task, wait 5 s, assert the child has exited (or at least emitted its first result event) — catches the forgotten-end case.

**Owning phase:** Agent backend phase.

---

### PM5: Cancellation race — task completes just before cancel

**Classification:** Cross-cutting
**What goes wrong:** User clicks "Cancel" at T=10 s. Server sets status=cancelled at T=10.2 s. Daemon polls every 5 s, sees cancel at T=14.8 s, SIGTERMs child. But child already completed at T=10.1 s and daemon sent `CompleteTask` at T=10.15 s. Now: task is `completed` per the `CompleteAgentTask` query (which requires `status = 'running'`) — actually, it fails, because status is `cancelled`. Server returns 400. Daemon logs error. User sees "cancelled" but the work DID complete and no record shows.

Multica handles this via `CompleteAgentTask` WHERE `status = 'running'` returning no rows → falls back to FailTask (also WHERE status IN ('dispatched','running')), which also fails → daemon logs the cascade.

**Prevention:**
- Server `completeTask(id, result)` must handle the "already cancelled" case gracefully: if current status is `cancelled`, still record the result in a `discarded_result` column or as a comment on the issue ("Task completed after cancel, discarded at user's request"). Don't return 400 — return 200 with a `discarded: true` flag.
- Daemon reads the response and doesn't treat `discarded: true` as an error.
- Before reporting completion, daemon re-fetches task status (multica does this at daemon.go:826) — if cancelled, skip reporting and log only.
- Add a regression test: force this race via test hooks and assert no state corruption.

**Owning phase:** Task service phase + daemon CLI phase.

---

### PM6: Hosted-runtime "cancel" has no process to kill

**Classification:** Greenfield
**What goes wrong:** For external CLI runtimes, cancel = kill child process. For HOSTED runtimes (Aquarium's own Docker instances via gateway RPC), there's no child process — the task is an in-flight WebSocket RPC call to the gateway. Cancellation requires either (a) the gateway RPC protocol supports a cancel message, or (b) server just ignores the reply and closes the WS. Option (b) is simpler but leaves the gateway running the task to completion — wasted compute.

**Prevention:**
- Investigate whether OpenClaw gateway RPC supports a cancel/abort message. If yes, use it. Current protocol v3 has 3-step auth handshake — check if there's a cancel frame defined.
- If not, document the limitation: cancelling a hosted task closes the server-side listener; the gateway runs to completion silently and the result is dropped. UI must set expectations ("Cancel may not immediately free resources").
- In v1.4 scope, the hosted-runtime mode is explicitly a bridge — do NOT block shipping on gateway protocol changes. Defer abort-protocol work to v1.5.

**Owning phase:** Hosted runtime driver phase.

---

### PM7: Child process env leaks credentials into logs

**Classification:** Cross-cutting security
**What goes wrong:** Multica passes MULTICA_TOKEN via env (daemon.go:927). Aquarium will pass similar. If the daemon debug-logs `cmd.env` or writes env to a crash log, the token leaks. Worse, child processes on Linux expose `/proc/<pid>/environ` to the same UID — any other local process can read it.

**Prevention:**
- Define a `REDACTED_KEYS` set covering `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`. ALL logging that touches env must run through a redact helper.
- Prefer sending the token via stdin JSON header instead of env where the agent CLI supports it.
- Scrub `agent.custom_env` values with the same redactor before logging.
- Test: spawn a child, kill it, grep the daemon log file for the token — must not be present.

**Owning phase:** Daemon CLI phase + logging conventions (cross-cutting).

---

## Auth Boundary Risks

Daemon tokens (long-lived, server→daemon) coexist with cookie JWTs (user→browser→server).

### AUTH1: Token privilege confusion — HARD CONSTRAINT

**Classification:** Greenfield
**What goes wrong:** Daemon endpoints (`/api/runtimes/register`, `/api/tasks/claim`, etc.) accept `Authorization: Bearer <daemon-token>`. A daemon token accidentally accepted on user endpoints (e.g., `/api/instances/:id` which currently requires cookie JWT) would let a compromised daemon escalate to any instance the issuing user can access. Symmetrically, a cookie JWT on a daemon endpoint would let a browser impersonate a daemon.

**Prevention:**
- Two completely separate middleware: `requireUser` (cookie JWT only, rejects Bearer) and `requireDaemon` (Bearer only, rejects cookie). No shared code path.
- Lint rule or PR check: no route mounts both middleware simultaneously.
- Daemon tokens have a distinct prefix (`aqd_` for aquarium-daemon), checked in the middleware before JWT parsing — a cookie JWT that starts with `aqd_` is rejected early.
- Tokens include a scope claim; the middleware asserts `scope === 'daemon'`. If you ever mint a user-facing PAT (v1.5), scope=`user` — distinct code path.
- Test: hit every user endpoint with a daemon token and assert 401/403. Hit every daemon endpoint with a cookie JWT and assert 401.

**Owning phase:** Daemon REST API phase.

---

### AUTH2: Token leakage in logs and error responses

**Classification:** Cross-cutting
**What goes wrong:** Express error middleware that returns `{ ok: false, error: err.message }` and the err message contains `Unauthorized: token aqd_xxx is invalid` — token now in client-visible response. Or access logs that record `Authorization` header. Or `console.error(req.headers)` in a debug branch.

**Prevention:**
- Error-response redaction: before returning `{ error }`, strip any substring matching the token regex.
- Express's default morgan/access logger is configured in most projects to NOT log headers — verify no logger records headers. Audit `apps/server/src/index.ce.ts`.
- Pull daemon token OUT of Authorization and put it in a custom header (`X-Aquarium-Daemon-Token`) so it never accidentally flows through bearer-token middleware or reverse-proxy forwarding.

**Owning phase:** Daemon REST API phase + logging conventions.

---

### AUTH3: Token revocation must fail in-flight requests

**Classification:** Greenfield
**What goes wrong:** User revokes daemon token X. Daemon has 3 in-flight message-report requests using X. If middleware caches token validity (e.g., JWT with no DB check), those requests still succeed until the cached entry expires. If messages continue arriving for a "revoked" daemon, the UI shows progress on tasks the user expected to freeze.

**Prevention:**
- Daemon tokens are DB-backed (not self-contained JWTs). Every request does a DB lookup for `daemon_tokens` WHERE `token_hash = sha256($1) AND revoked_at IS NULL`. Cost: one indexed SELECT.
- On revocation, emit a WebSocket event to the user's browser immediately so UI reflects the change.
- Daemon, on receiving 401, gracefully exits with "token revoked, please re-authenticate" — does NOT retry indefinitely (which would DDoS the server with bad-auth requests).

**Owning phase:** Daemon REST API phase.

---

### AUTH4: Rate limiting on daemon auth middleware

**Classification:** Greenfield
**What goes wrong:** Daemon polls every 3 s per runtime × N runtimes × M daemons = 60+ auth checks/min per user. The existing `express-rate-limit` middleware, if applied to daemon endpoints, will throttle legitimate traffic. Alternatively, no rate limit means a stolen token can be used to DDoS.

**Prevention:**
- Separate rate limit bucket per daemon token (not per IP) on daemon endpoints. Generous limits (hundreds/min) but not unlimited.
- Heartbeat endpoint is the only high-volume one; claim is only called when heartbeat returns capacity. Model: heartbeat=every 15 s, claim=every 3 s, messages=batch of 1/500ms during active task. Size limits accordingly.
- Use `express-rate-limit` v8 `keyGenerator` callback that hashes the token. Document the limit in `CLAUDE.md`.

**Owning phase:** Daemon REST API phase.

---

### AUTH5: Daemon spawns child with MULTICA_TOKEN equivalent — secondary credential surface

**Classification:** Port bug (explicit in multica)
**What goes wrong:** Multica passes the token to the spawned agent CLI so it can call back (`multica repo checkout`). In Aquarium this is `AQUARIUM_TOKEN`. If the agent CLI is compromised, it has the same power as the daemon. Worse, Claude's `--verbose` output can echo env to logs.

**Prevention:**
- Issue a short-lived, task-scoped token derived from the daemon token. Scope: task-id-specific, 2h TTL, only endpoints `/api/tasks/:id/*` and `/api/repos/checkout`. Revocable on task complete.
- Alternative: issue the task token via the daemon-local HTTP port (multica opens `MULTICA_DAEMON_PORT`, daemon.go:929). Agent CLI calls daemon, not the server directly. Daemon proxies with its own auth. Same surface but the daemon can mask scoping.
- Blocklist `AQUARIUM_*` from agent custom_env overrides (multica pattern, daemon.go:1313).

**Owning phase:** Agent backend phase + daemon REST API phase.

---

## State-Sync Risks (browser ↔ server ↔ daemon ↔ instance)

Four independent state machines must stay aligned.

### ST1: Instance status vs runtime status drift — HARD CONSTRAINT

**Classification:** Greenfield
**What goes wrong:** An Aquarium instance has states `created/starting/running/stopping/stopped/error` (CLAUDE.md). A runtime (new concept) has states `online/offline`. Hosted runtime maps 1:1 to an instance. Who owns the mapping? If `instance.status=error` but `runtime.status=online`, tasks keep getting dispatched to a broken runtime. If runtime is manually toggled offline but instance is still running, no cleanup.

**Prevention:**
- Single source of truth: for hosted runtimes, `runtime.status` is a DERIVED view from `instance.status`. Don't store it; compute it in a SELECT JOIN. (`CASE WHEN i.status='running' THEN 'online' ELSE 'offline' END AS runtime_status`).
- For daemon-backed runtimes, `runtime.status` IS stored and updated by heartbeat.
- `InstanceManager` (the only place that mutates `instances.status`, per services/AGENTS.md) emits a `ws:runtime-status-changed` event after every transition — listeners cancel in-flight dispatched tasks bound to that runtime.
- Reaper that fails tasks whose runtime went offline > 2 minutes ago.

**Owning phase:** Hosted runtime driver phase.

---

### ST2: WebSocket reconnect must replay recent task messages

**Classification:** Greenfield
**What goes wrong:** User opens Issue detail → subscribes to WS → task is running, 50 tool_use messages fly by. User switches tabs, WS disconnects on mobile. 30 s later reconnects. During the gap, 20 more messages were sent via broadcast (which only hits CURRENTLY connected clients). User now sees messages 1–50 (from initial fetch) and 71–80 (post-reconnect), MISSING 51–70.

**Prevention:**
- Every message has a `seq` (already in multica, daemon.go:1086) — monotonic per-task. DB persists all messages.
- On WS reconnect, client sends `{ type: 'subscribe_task', taskId, lastSeq }`. Server replays messages > lastSeq from DB, then starts live broadcasting.
- Server-side: during the replay + live-handoff, buffer incoming broadcasts and flush AFTER replay completes, so no message arrives out-of-order.
- Prune `task_messages` for completed tasks > 30 days old via a GC loop.

**Owning phase:** Issue detail UI phase + task service phase.

---

### ST3: Browser backgrounded — event pile-up

**Classification:** Greenfield
**What goes wrong:** User has Issue detail open in a background tab. Task runs for 20 minutes producing 500 messages. Chrome keeps the WS connected but throttles JS timers. The React state update buffer grows. When user returns to the tab, React tries to render all 500 updates in one tick → frame drop, app freezes for 5 s.

**Prevention:**
- Batch renders on the client side: `requestIdleCallback` or a `useTransition` + `useDeferredValue` (React 19) wrapper around message-list updates.
- Virtualize the message list (react-virtuoso or similar). Critical for > 100 messages.
- On the server, respect client-sent backpressure hints. Client can send `{ type: 'pause_stream' }` when hidden (via `document.visibilitychange`); server marks the subscription as paused and skips broadcasts, relying on DB replay when resumed.

**Owning phase:** Issue detail UI phase.

---

### ST4: Instance rename / delete / archive must cascade to runtime

**Classification:** Greenfield
**What goes wrong:** User deletes an instance. Hosted runtime row references instance_id. Agents reference runtime_id. Tasks reference agent_id + runtime_id. FK cascades delete everything, but in-flight tasks have already been dispatched and their WebSocket broadcasts still go out, hitting 404s when clients try to fetch task details.

**Prevention:**
- Deleting an instance: (a) cancel all in-flight tasks on its runtime, (b) mark runtime as `offline`, (c) set agent.runtime_id = NULL (ON DELETE SET NULL on agents.runtime_id), (d) keep task_queue rows for historical audit (ON DELETE SET NULL on task_queue.runtime_id) but mark them `failed` if status was `running`. Actual deletion happens in the reaper.
- Do NOT use ON DELETE CASCADE from instances → task_queue. Tasks are audit data; they survive instance deletion.
- Use ON DELETE CASCADE only where child rows have no audit value (e.g., `task_messages → task_queue`).
- Archive instead of delete where possible. Add `archived_at` to runtimes — archived runtimes don't accept new tasks but data is preserved.

**Owning phase:** Schema phase + hosted runtime driver phase.

---

### ST5: Gateway RPC reply → fake message stream impedance mismatch

**Classification:** Greenfield
**What goes wrong:** External CLI runtimes emit a STREAM of messages (tool_use, tool_result, text, thinking). Hosted runtime via gateway RPC returns a SINGLE reply. To unify the UI, the hosted driver must synthesize fake "streaming" messages from the RPC reply. If it simply posts one big `text` message at the end, the UI looks dead during a 60-second gateway call.

**Prevention:**
- If the gateway RPC protocol supports streaming intermediate events, adapt those. Check WS protocol v3 for progress frames.
- If not, synthesize minimal messages: at task start post `{type: text, content: "Dispatched to hosted runtime <name>"}`; every 10 s post a heartbeat `{type: status, content: "Running..."}`; on completion post the result as `{type: text, content: <reply>}`. UI looks alive.
- Document explicitly in ARCHITECTURE.md: "hosted runtime is not introspective; message stream is synthetic."
- Do not pretend tool_use events; users familiar with local-runtime UI will think the hosted runtime is using tools when it's not.

**Owning phase:** Hosted runtime driver phase.

---

### ST6: Event ordering between daemon-direct and WS-broadcast paths

**Classification:** Greenfield
**What goes wrong:** Daemon reports messages via `POST /api/tasks/:id/messages` (batched every 500 ms). Server inserts into DB, then broadcasts to WS subscribers. But a SEPARATE server-side task-status-change handler (e.g., reaper) also broadcasts. If both paths touch the event bus with different orderings (message batch A arrives before status change X arrives before message batch B, but status X is broadcast first), the browser sees state transitions without their causing messages.

**Prevention:**
- One event-bus thread/queue for broadcasts. Every broadcast goes through a single `broadcast(event)` that's serialized (can be a simple in-memory queue that `setImmediate`s the send).
- Task status change events happen AFTER the DB write that causes them, in the same code path — not in a separate handler that races.
- Use a monotonic event seq per task (not just per-message seq) — browser discards out-of-order events.

**Owning phase:** Task service phase.

---

## Migration Ordering & Schema Risks

Aquarium has 35 migrations (2 numbered files in CE repo but CLAUDE.md says 35 incl. merge-conflict duplicates); v1.4 adds ~8.

### SCH1: Migration number collisions — HARD CONSTRAINT

**Classification:** Cross-cutting
**What goes wrong:** CLAUDE.md warns "35 migrations with duplicate numbers at 021 and 027 from merge conflicts." Adding 8 new migrations starting at 036 is the obvious path, but a concurrent PR might land at 036 first, forcing rebase. Using timestamp-based names (`20260420_create_runtimes.ts`) avoids conflicts but breaks the existing numbering convention.

**Prevention:**
- Check existing migrations on branch creation. Start new migrations at `036` (or next highest + 1).
- Each migration is ADDITIVE — never drop or rename columns. If you need to change a column, add a new one and migrate data.
- For the v1.4 migration block, assume atomicity: all 8 migrations either succeed together or the server refuses to boot. Use a guard table `schema_version_v1_4` — if any of the 8 fails, roll back the batch and alert.
- Document in `apps/server/src/db/migrations/AGENTS.md` (create this if missing): "all v1.4 migrations in one PR; no interleaving with unrelated migration PRs."

**Owning phase:** Schema phase.

---

### SCH2: Circular foreign keys between agent and runtime

**Classification:** Greenfield
**What goes wrong:** Agent references runtime (agent.runtime_id). Runtime might reference "default agent" (runtime.primary_agent_id) for a simplified UX. A true circular FK prevents either row from being inserted first. SQLite permits deferred FK checks via `PRAGMA defer_foreign_keys = true` only within a transaction, but if migrations or app code forgets this, inserts fail.

**Prevention:**
- Avoid circular FKs in schema design. Runtime does NOT reference agent; agents belong to runtimes (agent.runtime_id NOT NULL). A runtime's "primary agent" is a compute from MIN(agent.created_at) WHERE runtime_id = X, not a stored FK.
- If circular is unavoidable, wrap creation in an explicit transaction with `defer_foreign_keys=true`.

**Owning phase:** Schema phase.

---

### SCH3: Foreign key to `instances.id` — cascade semantics

**Classification:** Greenfield
**What goes wrong:** Covered in ST4. Reiterating because the decision is made at schema-migration time and cannot be easily changed later.

**Prevention:** See ST4. Use ON DELETE SET NULL on `runtimes.instance_id` and `task_queue.runtime_id`. Never CASCADE from instances to tasks.

**Owning phase:** Schema phase.

---

### SCH4: SQLite has no native UUID; string storage quirks

**Classification:** Greenfield
**What goes wrong:** Aquarium stores UUIDs as TEXT (SqliteAdapter.uuidColumnType returns `'string'`). If any code path compares a UUID with lowercase hyphenated form to a stored UUID with uppercase, WHERE clauses miss. `randomUUID()` always returns lowercase; some LIKE clauses or user-supplied input may not.

**Prevention:**
- Normalize UUIDs to lowercase on input (at service-layer boundaries). Add a `normalizeUuid()` helper.
- Never accept raw UUID strings from user input without validating format (36 chars, lowercase, hyphenated).
- Knex's `.where({ id })` parameterization preserves case — but the stored value must also have been lowercased on insert.

**Owning phase:** Schema phase + shared utilities.

---

## UX Risks (board, streaming, i18n)

### UX1: Kanban drag-and-drop with concurrent WS reordering — HARD CONSTRAINT

**Classification:** Greenfield
**What goes wrong:** User A drags Issue X from "Todo" to "In Progress" locally. Before the API call returns, User B drags Issue Y to "Todo" first — WS broadcasts new positions. User A's optimistic state has Issue X removed from Todo, but WS says Issue Y is now in Todo at the position User A just left. React's reconciler sees conflicting state, flickers, possibly drops User A's drop.

**Prevention:**
- Use `@dnd-kit` (industry standard for React 19 kanban, supports keyboard, ARIA) — NOT react-beautiful-dnd (unmaintained as of 2025).
- Optimistic update: locally reorder on drop. Send `POST /api/issues/:id/reorder { beforeId, afterId }`.
- Server uses fractional positions (e.g., midpoint between neighbors) to avoid cascade renumbering. This is critical — multica uses `position` float for the same reason.
- On WS event for OTHER users' reorders, apply if the local state has no pending drag. If currently dragging, queue and apply on drop.
- If server rejects the reorder (e.g., stale position), rollback optimistic update with a toast.

**Owning phase:** Issue board UI phase.

---

### UX2: Drag-and-drop accessibility gap

**Classification:** Greenfield
**What goes wrong:** Mouse-only drag-and-drop fails accessibility audits and blocks keyboard users. Many custom DnD implementations in 2024-era codebases skip this.

**Prevention:**
- `@dnd-kit/core` + `@dnd-kit/sortable` provides keyboard drag out of the box (space to pick, arrow keys to move, space to drop, escape to cancel). Must ALSO use `@dnd-kit/accessibility` for the live-region announcements.
- Test with keyboard only — can you create an issue, move it across columns, drop it?
- Test with VoiceOver / NVDA. Add ARIA labels to columns ("Todo, 5 issues").

**Owning phase:** Issue board UI phase.

---

### UX3: Z-index wars with existing modals

**Classification:** Greenfield
**What goes wrong:** Aquarium's existing design system (Oxide, CSS variables) has an implicit z-index ladder. Adding kanban drag overlays, toast notifications for task events, and a new Issue detail sheet — if z-indexes are ad-hoc, drag overlays can appear under modals; toasts can be hidden by sheets.

**Prevention:**
- Define a z-index scale in `apps/web/src/index.css` as CSS variables: `--z-base: 0; --z-dropdown: 10; --z-sheet: 100; --z-modal: 200; --z-drag-overlay: 300; --z-toast: 400;`. Use variables everywhere.
- Lint rule or PR checklist: no raw z-index numbers in CSS.

**Owning phase:** Issue board UI phase (establish the scale; all subsequent phases use it).

---

### UX4: Kanban performance at 100+ issues

**Classification:** Greenfield
**What goes wrong:** Rendering 500 Issue cards with rich metadata (avatars, labels, due dates), each a draggable, tanks FPS. Drag overlays lag.

**Prevention:**
- Virtualize each column (only render visible cards). react-virtuoso works with @dnd-kit if configured carefully (virtualization must not unmount during drag).
- Defer heavy card details (avatars, descriptions) to hover/expand. Card skeleton at list level, rich content on click.
- Paginate at the API level: don't return all 500 issues by default. "Load more" or "Filter by status" to constrain.

**Owning phase:** Issue board UI phase.

---

### UX5: i18n drift — new UI ships with en-only

**Classification:** Cross-cutting
**What goes wrong:** CLAUDE.md requires updating all 6 locales (`en, zh, fr, de, es, it`). Developers in a hurry add `t('issues.create')` and update `en.json` only. CI has no check. Non-English users see raw keys ("issues.create") in the UI.

**Prevention:**
- Add a CI step that parses all `t('...')` calls and asserts every key exists in all 6 locale files. Use `i18next-parser` or a simple Node script.
- Provide machine translations as placeholders (explicitly marked `"translationStatus": "machine"`) rather than missing keys — degrades gracefully.
- PR template checkbox: "Updated all 6 locale files."

**Owning phase:** Cross-cutting; enforced starting from the first UI phase (Runtimes/Agents management).

---

### UX6: Task message rendering — truncation and XSS

**Classification:** Greenfield
**What goes wrong:** Agent tool_result can contain 8 KB+ of text (multica truncates at 8192, daemon.go:1168). Rendering raw strings is safe in React (auto-escapes), but if someone adds `dangerouslySetInnerHTML` to render markdown, agent output becomes an XSS vector. Also, multi-MB agent outputs in the DOM freeze the tab.

**Prevention:**
- Truncate server-side at 16 KB per message (multica uses 8 KB; Aquarium can be more generous). "Show full" link fetches on demand.
- If markdown rendering is needed (code blocks, headings), use `react-markdown` with default-safe plugins. Never `dangerouslySetInnerHTML` for agent content.
- Sanitize tool_use input (shown in UI as JSON) by using `<pre>` + text-only rendering, not HTML injection.

**Owning phase:** Issue detail UI phase.

---

## Testing Risks (Playwright-only constraints)

CLAUDE.md: "Playwright only. No unit tests." Multica has Go unit tests. The port removes this safety net.

### T1: Child-process spawn behavior is un-testable in CI

**Classification:** Greenfield
**What goes wrong:** Playwright tests in CI skip Docker-dependent scenarios. They also can't spawn real `claude`/`codex` binaries (not installed in the runner, would require API keys). So the agent-backend layer (the single highest-risk area) ships with zero automated coverage.

**Prevention:**
- Exception to the "no unit tests" rule: create `apps/server/tests/unit/` running via `node --test` (built-in, no new dep). Scope it STRICTLY to:
  - Stream-json parsing (JSON.parse per-line + message dispatch). Feed synthetic lines.
  - Kill-escalation logic (mock child, assert SIGTERM → SIGKILL timing).
  - Bounded-concurrency semaphore.
  - JWT/daemon-token middleware split (AUTH1).
  - SQL claim query correctness (spin a :memory: SQLite, run 100 concurrent claims, assert no double-dispatch).
- Use `execa` to spawn a fake `node -e "console.log('...'); setTimeout(()=>{}, 999999)"` as a stand-in for real CLIs — tests can assert spawn/kill behavior without API keys.
- Document in a new `apps/server/tests/unit/AGENTS.md`: "unit tests allowed only for agent-backend, concurrency, and auth modules; all other code uses Playwright."

**Owning phase:** Agent backend phase (first to introduce unit tests).

---

### T2: E2E testing daemon CLI end-to-end is awkward

**Classification:** Greenfield
**What goes wrong:** A full E2E of "user starts daemon, daemon registers, task assigned, daemon picks up task, reports completion" requires spawning the daemon as a subprocess inside the Playwright test. Flaky on CI if the runner kills processes between tests. Feedback loop is slow (30 s+ per test).

**Prevention:**
- Split daemon tests into two tiers:
  - **Pure server E2E**: mock daemon HTTP calls from Playwright. Fast, reliable. Tests the REST API surface.
  - **Integration daemon**: one smoke test that actually spawns `aquarium daemon start --foreground` as a subprocess, registers a fake agent (echo server pretending to be claude), exercises one task. Marked as `@integration`, runs only in non-CI or nightly.
- Use Playwright's `test.describe.configure({ mode: 'serial' })` for daemon tests to prevent parallel port conflicts.

**Owning phase:** Daemon CLI phase.

---

### T3: Race-condition tests need deterministic clock / sleep injection

**Classification:** Greenfield
**What goes wrong:** Testing PM5 (cancel-race), PM1 (SIGTERM-escalation), and flush-ticker requires advancing time deterministically. Playwright's `page.clock` helps for browser but doesn't touch Node server clocks. Real-time waits make tests flaky.

**Prevention:**
- In server code, inject a `clock` dependency (default = `Date.now` + `setTimeout`) so tests pass a fake.
- `@sinonjs/fake-timers` in unit tests to advance intervals deterministically.
- Accept some flakiness on E2E-only tests; rerun flaky cases once via Playwright's `retries: 2` (already in CI config).

**Owning phase:** All phases (testing convention established early).

---

### T4: Playwright can't verify SQLite transaction atomicity under load

**Classification:** Greenfield
**What goes wrong:** The claim query (SQ1) must be safe when called concurrently by multiple daemons. A single-threaded Playwright test can't reliably trigger this race.

**Prevention:**
- Unit test as described in T1 — spin `:memory:` SQLite, fire 100 promises, assert each claimed task is unique.
- Additionally, run the claim query in a loop against a real DB file under `npm run bench` — not a test, but a scripted check.

**Owning phase:** Task service phase.

---

## CE/EE Boundary Risks

CE targets SQLite + single workspace; EE (not in this milestone) wants Postgres + RBAC + multi-workspace.

### CE1: Workspace_id as a placeholder — HARD CONSTRAINT

**Classification:** Cross-cutting
**What goes wrong:** PROJECT.md says "schema keeps workspace_id but CE uses a single default workspace." If code paths assume a hardcoded workspace ID (e.g., `WHERE workspace_id = 'default'`), EE's multi-workspace feature requires refactoring every query. Worse, if some paths filter on workspace_id and others don't, CE shipped with a partial enforcement that EE inherits as a bug.

**Prevention:**
- Every table with `workspace_id` is always queried WITH `workspace_id` filter, even in CE. The "default" workspace UUID is a constant `DEFAULT_WORKSPACE_ID` injected at every service call site.
- Middleware: derive `req.workspaceId = DEFAULT_WORKSPACE_ID` in CE; in EE, from URL path or header. Services NEVER read `DEFAULT_WORKSPACE_ID` directly — they read `req.workspaceId`.
- Lint rule: any query against a workspace-scoped table without `workspace_id` in the WHERE is a code-review block.

**Owning phase:** Schema phase + task service phase (establish the pattern early).

---

### CE2: Postgres-specific features lurking in shared code

**Classification:** Greenfield
**What goes wrong:** A developer copies multica code using `now()`, `make_interval(secs => ...)`, or JSONB operators (`data @> '{"key": "val"}'`). These are SQL syntax errors on SQLite. If EE uses Postgres and CE SQLite, sharing raw SQL strings doesn't work.

**Prevention:**
- Use Knex query builder, not raw SQL, wherever possible. Knex abstracts `NOW()` vs `datetime('now')`.
- For things Knex doesn't abstract (interval arithmetic, JSON queries), use the DbAdapter pattern already in place (`db/adapter.ts` has `intervalAgo`, `jsonExtract`). Extend this for v1.4 needs.
- Avoid JSONB queries in CE; store structured data in proper columns or a `metadata JSON` column used only for display (not filtering).

**Owning phase:** Schema phase + task service phase.

---

### CE3: Runtime abstraction must accommodate future drivers

**Classification:** Greenfield
**What goes wrong:** v1.4 ships with hosted (gateway RPC) + daemon-local (stream-json CLI). If the service layer branches `if (runtime.type === 'hosted') { ... } else { ... }`, adding a third type (e.g., "remote ssh" in EE) requires touching every branch.

**Prevention:**
- Runtime driver interface: `RuntimeDriver { dispatch(task): Promise<void>; cancel(task): Promise<void>; getStatus(): RuntimeStatus; }`. Factory selects implementation by `runtime.type`.
- Mirrors the existing `RuntimeEngine` pattern for Docker/K8s. Consistency aids discoverability.
- Each driver lives in its own file under `apps/server/src/task-runtime/` (new dir). No `switch` statements in services.

**Owning phase:** Hosted runtime driver phase + daemon REST API phase.

---

### CE4: RBAC hooks absent but reserved

**Classification:** Greenfield
**What goes wrong:** CE has a single user-per-install model. EE wants per-workspace roles. If v1.4 hardcodes "creator can delete, assignee can comment" in route handlers, RBAC retrofit requires editing every route.

**Prevention:**
- Introduce a `can(action, resource)` helper even in CE. In CE, always returns true for the authenticated user. In EE, checks workspace_member.role.
- Example: `if (!await can(req, 'issue:delete', issue)) return 403;`. CE implementation: `return true`. EE implementation: real check.
- Not strictly required for v1.4, but adding these call sites now is cheaper than retrofitting 50 routes later.

**Owning phase:** Task service phase (optional but recommended).

---

## Cross-Cutting Constraints

Things every phase must respect, extracted from HARD CONSTRAINT markers above and Aquarium's established patterns.

### X1: ESM `.js` extension in imports — HARD CONSTRAINT (existing)

Server `.ts` imports MUST use `.js` extension (CLAUDE.md). Every new file in `apps/server/` must follow. Runtime crash if missed; not caught by TypeScript.

**Enforcement:** ESLint config should enforce. Manual audit on every PR.

**Applies to:** All server phases.

---

### X2: Startup order cannot be reshuffled — HARD CONSTRAINT (existing)

CLAUDE.md defines: `db.migrate.latest() → state reconciliation → health monitor → gateway event relay → HTTP + WS server`.

v1.4 adds: **task reaper** after state reconciliation (fails dormant tasks before anyone can claim), **runtime heartbeat collector** after health monitor, **daemon REST endpoints** as part of HTTP server.

**Violation risk:** If the reaper runs AFTER the HTTP server is up, daemons can claim stale tasks before they're failed. If runtime heartbeats start BEFORE reconciliation, status flips back and forth.

**Applies to:** Server integration phase, task service phase.

---

### X3: Build shared package first — HARD CONSTRAINT (existing)

`packages/shared` must be built before server typecheck or web build (CLAUDE.md). Adding new shared types (Task, Runtime, Agent, etc.) increases the blast radius.

**Applies to:** Schema phase (defines shared types first).

---

### X4: No `any`, no `@ts-ignore`, no raw fetch — HARD CONSTRAINT (existing)

Enforced by CLAUDE.md. Temptation in porting: "I'll cast this to any for now" — don't. Stream-json message types need proper discriminated unions; the port is incomplete until they're exhaustive.

**Applies to:** Agent backend phase especially.

---

### X5: Instance state only via InstanceManager — HARD CONSTRAINT (existing)

Only `InstanceManager` mutates `instances.status`. v1.4's hosted runtime driver MUST call `InstanceManager` methods, not update status directly. If hosted runtime's dispatch logic needs to know instance readiness, it queries — it doesn't touch status.

**Applies to:** Hosted runtime driver phase.

---

### X6: Gateway schema strictness — HARD CONSTRAINT (existing)

`additionalProperties: false` on gateway configs. `client.id` must be `'gateway-client'`. v1.4 gateway RPC for task dispatch cannot add ad-hoc fields — if the protocol needs extension, it's an upstream OpenClaw change (out of v1.4 scope).

**Applies to:** Hosted runtime driver phase.

---

### X7: All user-facing strings in 6 locale files — HARD CONSTRAINT (existing)

i18n for en, zh, fr, de, es, it. See UX5.

**Applies to:** Every UI phase.

---

### X8: DB as single writer; chat commands disabled — HARD CONSTRAINT (existing PROJECT.md decision)

The DB is the single writer; chat commands from instances that mutate state are disabled. v1.4's task messages are AGENT→server posts, not instance→DB writes. Stays consistent.

**Applies to:** Task service phase.

---

### X9: Every bug fix needs a regression test — HARD CONSTRAINT (user global)

User's private CLAUDE.md: "Every bug fix must include a new regression or unit test." This means the unit-test carve-out (T1) is REQUIRED, not optional, for bug fixes in port-critical areas.

**Applies to:** All phases, especially agent backend phase.

---

### X10: Daemon-spawned child PATH must include `aquarium` binary — HARD CONSTRAINT

See PM3. The spawned agent CLI must be able to invoke `aquarium <subcommand>` for repo ops, comment posting, etc.

**Applies to:** Daemon CLI phase + agent backend phase.

---

## Phase Assignment Table

Maps each pitfall to the phase that must own risk mitigation. Use this as a planning checklist: no risk goes unassigned.

| Pitfall | Category | Owning phase | HARD CONSTRAINT? |
|---------|----------|--------------|------------------|
| PG1 Goroutine → unbounded async | Port | Daemon CLI / task executor | YES |
| PG2 Unhandled promise rejection | Port | Daemon CLI / task executor | YES |
| PG3 Timer/interval leaks | Port | Daemon CLI / task executor | |
| PG4 Channel-full drop semantics | Port | Agent backend | |
| PG5 Context vs AbortSignal | Port | Cross-cutting (schema phase intro) | YES |
| PG6 await-in-loop vs Promise.all | Port | Daemon CLI | |
| PG7 readline iteration pattern | Port | Agent backend | YES |
| PG8 stdout backpressure | Port | Agent backend | YES |
| PG9 UTF-8 boundary corruption | Port | Agent backend | |
| PG10 JSON.parse on partial lines | Port | Agent backend | |
| SQ1 No SKIP LOCKED | Greenfield | Schema + task service | YES |
| SQ2 better-sqlite3 synchronous | Greenfield | Task service | |
| SQ3 CHECK enum drift | Greenfield | Schema | |
| SQ4 Stale task reaper | Greenfield | Task service | |
| SQ5 Write-lock starvation | Greenfield | Task service | |
| PM1 SIGTERM → zombie | Greenfield | Agent backend | YES |
| PM2 Daemon crash orphans | Greenfield | Daemon CLI | |
| PM3 PATH inheritance | Port | Agent backend + daemon CLI | |
| PM4 stdin not closed | Port | Agent backend | |
| PM5 Cancel race with complete | X-cut | Task service + daemon CLI | |
| PM6 Hosted runtime cancel has no PID | Greenfield | Hosted runtime driver | |
| PM7 Credentials in env/logs | X-cut | Daemon CLI + logging conv | |
| AUTH1 Token privilege confusion | Greenfield | Daemon REST API | YES |
| AUTH2 Token leakage in logs | X-cut | Daemon REST API | |
| AUTH3 Revocation must fail in-flight | Greenfield | Daemon REST API | |
| AUTH4 Rate limiting daemon auth | Greenfield | Daemon REST API | |
| AUTH5 Child inherits token | Port | Agent backend + daemon REST | |
| ST1 Instance vs runtime drift | Greenfield | Hosted runtime driver | YES |
| ST2 WS reconnect replay | Greenfield | Issue detail UI + task service | |
| ST3 Background-tab event pile-up | Greenfield | Issue detail UI | |
| ST4 Instance delete cascades | Greenfield | Schema + hosted runtime | |
| ST5 Gateway RPC → fake stream | Greenfield | Hosted runtime driver | |
| ST6 Event ordering | Greenfield | Task service | |
| SCH1 Migration collisions | X-cut | Schema | YES |
| SCH2 Circular FKs | Greenfield | Schema | |
| SCH3 instance FK cascade | Greenfield | Schema | |
| SCH4 UUID case normalization | Greenfield | Schema + shared utils | |
| UX1 Drag/drop + WS reorder | Greenfield | Issue board UI | YES |
| UX2 DnD accessibility | Greenfield | Issue board UI | |
| UX3 Z-index scale | Greenfield | Issue board UI (establish) | |
| UX4 Kanban at 100+ issues | Greenfield | Issue board UI | |
| UX5 i18n drift | X-cut | Every UI phase | |
| UX6 Message XSS and truncation | Greenfield | Issue detail UI | |
| T1 Child-spawn untestable | Greenfield | Agent backend (intro unit tests) | |
| T2 Daemon E2E awkwardness | Greenfield | Daemon CLI | |
| T3 Deterministic clock | Greenfield | All phases | |
| T4 Claim atomicity under load | Greenfield | Task service | |
| CE1 workspace_id enforcement | X-cut | Schema + task service | YES |
| CE2 Postgres syntax leaks | Greenfield | Schema + task service | |
| CE3 Runtime driver interface | Greenfield | Hosted runtime + daemon REST | |
| CE4 RBAC hooks reserved | Greenfield | Task service | |

### Phase-by-phase risk count

Assuming the roadmap has roughly these phases (roadmapper will finalize):

1. **Schema migrations**: 8 risks — 4 HARD. Highest upfront load; get the foundation right.
2. **Daemon REST API** (runtimes, heartbeat, claim, task lifecycle): 6 risks — 2 HARD.
3. **Task service** (enqueue, claim, complete, fail, reaper, events): 9 risks — 3 HARD.
4. **Agent backend** (stream-json parsers for claude/codex/openclaw/opencode): 10 risks — 4 HARD. The single riskiest phase.
5. **Daemon CLI** (Node binary, register, poll, execute, spawn): 7 risks — 2 HARD.
6. **Hosted runtime driver**: 5 risks — 1 HARD.
7. **Issue board UI** (kanban): 4 risks — 1 HARD.
8. **Issue detail UI** (streaming messages): 4 risks — 0 HARD.
9. **Agents + Runtimes + Daemon tokens management UI**: 0 phase-specific; i18n and z-index apply.

**Recommendation:** Agent backend phase should probably be split into two sub-phases given the risk density: (a) one-CLI happy path with unit tests, (b) multi-CLI with parsers, error handling, cancellation.

---

## Phase-Specific Warnings (quick-reference for planners)

| Phase | Must do first | Must not do |
|-------|---------------|-------------|
| Schema | WAL + busy_timeout PRAGMAs; CHECK constraints; UUID lowercase convention; workspace_id on every scoped table; NO Postgres-only syntax | CASCADE from instances to task_queue; circular FKs; raw SQL bypassing Knex |
| Task service | DB-backed reaper BEFORE HTTP server; transaction discipline; single event-bus | I/O inside transactions; direct `instances.status` writes |
| Daemon REST API | Split `requireUser` vs `requireDaemon` middleware; token hashing on DB lookup | Accept daemon token on user endpoints; log Authorization header |
| Agent backend | AbortSignal threading; for-await readline; JSON.parse try/catch per line | `{ shell: true }` spawn; dangling stdin; fire-and-forget spawns without kill escalation |
| Daemon CLI | Bounded semaphore; unhandled-rejection hook; pid state file | `setInterval` without owner; `void handleTask()` fire-and-forget |
| Hosted runtime driver | Derived runtime.status from instance.status; synthetic progress events | Treat RPC reply as tool_use stream; cancel via fake signal |
| Issue board UI | @dnd-kit; fractional positions; z-index scale | react-beautiful-dnd; cascade renumbering on reorder |
| Issue detail UI | Replay-from-DB on WS reconnect; virtualize message list | `dangerouslySetInnerHTML` on agent content; unbounded WS buffer |

---

## Sources

**Aquarium codebase (HIGH confidence, direct reading):**
- `/Users/shuai/workspace/citronetic/aquarium-ce2/CLAUDE.md` — tech stack, conventions, existing pitfalls
- `/Users/shuai/workspace/citronetic/aquarium-ce2/.planning/PROJECT.md` — v1.4 scope and constraints
- `/Users/shuai/workspace/citronetic/aquarium-ce2/apps/server/src/{AGENTS,services/AGENTS,runtime/AGENTS}.md` — module boundaries
- `/Users/shuai/workspace/citronetic/aquarium-ce2/apps/server/src/db/sqlite-adapter.ts` — adapter patterns
- `/Users/shuai/workspace/citronetic/aquarium-ce2/apps/server/src/ws/index.ts` — existing WS broadcast pattern
- `/Users/shuai/workspace/citronetic/aquarium-ce2/apps/server/src/db/migrations/001_initial_schema.ts` — FK/cascade conventions
- `/Users/shuai/workspace/citronetic/aquarium-ce2/apps/server/package.json` — current deps (better-sqlite3, ws, express, knex)

**Multica codebase (HIGH confidence, direct reading):**
- `/tmp/multica/server/internal/daemon/daemon.go` (1323 lines) — goroutine/channel patterns, poll loop, cancellation
- `/tmp/multica/server/internal/service/task.go` (677 lines) — claim semantics, reconciliation
- `/tmp/multica/server/pkg/agent/claude.go` (508 lines) — stream-json, WaitDelay, stdin handling
- `/tmp/multica/server/pkg/db/queries/agent.sql` — `FOR UPDATE SKIP LOCKED`, stale task reaper
- `/tmp/multica/CLI_AND_DAEMON.md` — daemon UX, background/foreground, logs, profiles
- `/tmp/multica/SELF_HOSTING.md` — architecture

**Official docs / ecosystem research (MEDIUM-HIGH confidence):**
- better-sqlite3 concurrency: https://wchargin.com/better-sqlite3/performance.html
- SQLite WAL mode: https://sqlite.org/wal.html
- SQLite concurrent writers discussion: https://oldmoe.blog/2024/07/08/the-write-stuff-concurrent-write-transactions-in-sqlite/
- Node.js child_process docs: https://nodejs.org/api/child_process.html
- Node.js stream backpressure: https://nodejs.org/learn/modules/backpressuring-in-streams
- Process group kill patterns: https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad
- @dnd-kit (accessible DnD): https://dndkit.com/
- DnD kanban patterns (2026): https://marmelab.com/blog/2026/01/15/building-a-kanban-board-with-shadcn.html

**Confidence summary:** HIGH overall. Port bugs are grounded in reading both codebases side-by-side. Greenfield bugs cite official docs and current ecosystem practice. Two gaps:
- Windows daemon background-process story is explicitly best-effort (PM2) — no authoritative "this is how to ship a Node daemon on Windows" source dominates; ecosystem is pm2/forever/custom.
- Gateway RPC cancellation semantics (PM6, ST5) require reading OpenClaw gateway source, not done here — flagged as a research task for the hosted runtime driver phase.
