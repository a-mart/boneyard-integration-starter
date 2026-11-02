# Long-running tools

Some work takes longer than one tool call: an export, a build, an approval
somebody else gives, a ticket waiting for a reply. Boneyard has a way for an
agent to wait for that work without holding its turn open: a **follow-up**.
This page says how a follow-up waits, and what your server does so it can.

## What a follow-up is

An agent asks Boneyard to follow one of its tools, with arguments and a note
("tell me when the export is ready"), and ends its turn. Boneyard calls the
tool in the background, for an hour by default and at most four, under the
same policy as the agent's own calls. When the work ends, Boneyard posts a
short line in the conversation the agent came from and wakes the agent with the
tool's result, so it can tell the person.

Rules that follow from this:

- **Only tools in Allow mode can be followed.** A tool in Ask mode needs a
  person to approve every call, and nobody is there to approve background
  calls. In practice, a follow-up waits on a read tool (`readOnlyHint: true`),
  which is suggested Allow.
- **Every background call is a normal call.** It passes the gateway's checks,
  carries the connection's headers (and caller context, if that is on, with
  trigger `follow_up`), is audited, and is limited to 60 seconds and 256 KiB
  like any other call.
- **Annotations decide retries.** When a call's outcome is unknown (it timed
  out, the connection dropped, or a task disappeared), Boneyard calls the tool
  again only if it is marked `readOnlyHint: true` or `idempotentHint: true`.
  Otherwise the follow-up ends with an error rather than run the tool twice.

Give a long job one of two shapes. A **wait tool** works with every protocol
version and every MCP SDK, so start there. **MCP Tasks** suit work that has a
natural handle and should be cancelled when nobody wants it any more.

## Shape 1: a wait tool

A wait tool waits for something for a bounded time and then says whether it
happened. Boneyard calls it again until it does.

- It waits **at most 50 seconds** (`MAX_WAIT_SECONDS`), so one call always
  ends inside the gateway's 60-second call limit. Take the wait as an argument
  (`timeoutSeconds`, `minimum: 1`, `maximum: 50`) so tests and the kit can use
  short waits.
- While the work is not done it answers normally, **not as an error**, with
  `structuredContent.timedOut: true` and the latest status. Declare `timedOut`
  in the tool's `outputSchema`; that is how `kit check` recognizes a wait tool.
- When the work is done, it answers without `timedOut` (or with
  `timedOut: false`) and with the result. That answer is what the agent gets.
- It is **read-only and idempotent**: calling it twice changes nothing, so a
  lost answer can safely be asked for again.
- It takes what it needs to resume as arguments, such as a job id or the last
  version the agent saw (`since`), because the server is stateless.

The reference tool is `ticket_wait_for_update` in
[`src/tools/ticket-wait-for-update.ts`](../src/tools/ticket-wait-for-update.ts):
it polls the backend once a second until the ticket changes after `since`, or
the timeout runs out.

```json
{ "timedOut": true, "ticket": { "id": "T-1003", "status": "open", "updatedAt": "2026-01-14T08:40:00Z" } }
```

If your work is started by another tool (`report_start` returns a job id),
make the start tool a normal write or read tool and the wait tool a separate
read tool (`report_wait`). The agent starts the job itself and follows only the
wait.

## Shape 2: MCP Tasks

[MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
let a `tools/call` return a task handle at once; the caller then checks the
task with `tasks/get`, collects the result with `tasks/result`, and can stop it
with `tasks/cancel`. Boneyard follow-ups use them like this:

1. The first background call starts the tool **once** as a task, asking for a
   TTL of the follow-up's remaining time (at most 4 hours, `MAX_TASK_TTL_MS`).
2. Boneyard stores the task id and, about every 30 seconds, asks `tasks/get`.
   It never starts the tool again for that follow-up.
3. When the task has ended, Boneyard collects `tasks/result`, and that result is
   what the agent gets. A task in `input_required` ends the follow-up with an
   error, because nobody can give it input.
4. When the person or agent stops the follow-up, or it runs out of time,
   Boneyard sends `tasks/cancel`.

What your server must do:

- **Serve protocol `2025-11-25`, and nothing newer, on the endpoint with task
  tools.** Tasks exist only on `2025-11-25`; `2026-07-28` removed them.
  Boneyard speaks the newest version both sides support, so an endpoint that
  also offers `2026-07-28` never sees a task request. The reference server
  therefore serves its task tool on a second path, `/mcp-tasks`, which the admin
  registers as its own connection, and keeps everything else on `/mcp` with
  `2026-07-28`.
- **Use an SDK with a task runtime.** The 2.x TypeScript SDK has none, so the
  reference endpoint uses the v1 SDK (`@modelcontextprotocol/sdk`) and its
  experimental task API, in stateless mode
  ([`src/tasks/`](../src/tasks/)).
- **Declare the capability** `tasks.requests.tools.call` (and `tasks.cancel`),
  and give each such tool `execution.taskSupport: "optional"`. Use
  `"optional"`, not `"required"`: an agent's own call through Boneyard is never
  a task, and `optional` lets that call still work (the SDK waits for the task
  and returns its result).
- **Bind tasks to the connection's credential, not to the MCP session.**
  Boneyard keeps the session that started a task open while it follows it, but
  after its gateway restarts it checks from a new session. A store that ties a
  task to its session then answers "not found", and Boneyard treats the task as
  lost: it starts the tool again only if it is read-only or idempotent, and
  otherwise ends the follow-up with an error. The reference store,
  [`ConnectionTaskStore`](../src/tasks/task-store.ts), ignores the session id;
  the whole server belongs to one connection token.
- **Stop the work on cancel**, keep a cancelled task cancelled, and answer a
  JSON-RPC error (`-32602`) for an unknown task id.
- **Bound the work.** Cap running tasks (the reference allows 10 and answers a
  tool error beyond that), honor the TTL, and keep results under 256 KiB.
- Results stay in memory in the reference server, so a restart of your server
  loses running tasks; Boneyard then treats them as lost. Use a durable store
  if that matters for your work.

The reference task tool is `tickets_export`
([`src/tasks/tickets-export.ts`](../src/tasks/tickets-export.ts)): a read-only
CSV export that the fake backend slows down by `FAKE_EXPORT_DELAY_MS`.

## Checking it

`kit check` recognizes both shapes ([testing.md](testing.md)):

| Check | Mode | What it proves |
|---|---|---|
| `follow.wait-tools` | safe | Wait tools are read-only and cap their timeout at 50 seconds |
| `follow.tasks` | safe | Task tools come with the tasks capability, on `2025-11-25`, and are `optional` |
| `follow.wait-calls` | fake | Wait calls answer in time, say `timedOut` as a boolean, never as an error, and at least one fixture runs out |
| `follow.task-runs` | fake | Each task tool starts as a task, can be seen from a new session, ends with a result free of secrets, and can be cancelled; an unknown task id is a JSON-RPC error |

`npm run kit:check` checks both reference endpoints: `kit.config.json` lists
`/mcp-tasks` under `extraTargets` with its own fixtures,
`kit.tasks.fixtures.json`.

## If you don't need it

Delete `src/tasks/`, the `tasks` wiring in `src/http.ts` and `src/server.ts`,
`MCP_TASKS_PATH` and `FAKE_EXPORT_DELAY_MS`, `test/tasks.test.ts`,
`kit.tasks.fixtures.json` and the `extraTargets` entry. Keep the
`@modelcontextprotocol/sdk` dependency: the kit's task checks use it. A wait
tool needs nothing beyond the main endpoint.
