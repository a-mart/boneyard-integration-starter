# Boneyard connection contract, version 1

This page is the whole contract between Boneyard and an MCP server. It doesn't
depend on any language: a server in Python, C#, Go or anything else works if it
follows these rules. The TypeScript reference server in `src/` is one way to
meet them, and `kit check` tests them against any URL.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## How Boneyard calls you

```
agent ──> Boneyard gateway ──HTTP POST──> your server ──> your backend
          (policy, audit)    token +       (your credentials,
                             optional      your access rules)
                             Boneyard-* headers
```

Agents never talk to your server directly. The Boneyard gateway is your only
caller. For each call, it checks the admin's policy for the tool (Off, Ask or
Allow) and whether the agent has a grant. It records an audit entry, then
forwards the call with the connection's configured headers. It doesn't forward
the agent's own credentials.

## 1. Transport

- The server MUST be a **remote MCP server over Streamable HTTP**: one URL that
  accepts `POST` of JSON-RPC messages. stdio-only servers aren't supported. If
  you have one, wrap it in an HTTP bridge that you run and secure yourself.
- The server SHOULD be **stateless**: every request stands alone. Don't rely on
  `Mcp-Session-Id`, the long-lived `GET` SSE stream, server-to-client requests
  (sampling, elicitation, roots) or notifications arriving on a later request.
  The gateway can send any request to any replica at any time.
- `GET` and `DELETE` on the endpoint MAY return `405`.
- The endpoint MUST NOT redirect. The gateway never follows redirects, so
  register the final URL.
- Use HTTPS whenever the traffic leaves the Boneyard host. Plain HTTP is
  acceptable only on the same host's private Docker network (see
  [deploying.md](deploying.md)).
- Answer within 60 seconds. After that, the gateway cancels the call and
  reports it to the agent as timed out.

## 2. Protocol versions

The gateway uses the official MCP TypeScript SDK and negotiates the newest
version you both support.

| Version | Status |
|---|---|
| `2026-07-28` | Preferred. Stateless by design; the reference server uses it. |
| `2025-11-25` | Supported. |
| `2025-06-18` | Supported. |
| `2025-03-26` | Supported (first version with Streamable HTTP). |
| `2024-11-05` and older | Not supported (HTTP+SSE transport). |

The official SDKs for the 2026 era serve both eras from one endpoint. The
agent-facing side of Boneyard is pinned to `2026-07-28` regardless of what your
server speaks.

## 3. Authentication

- The server MUST reject any request without valid credentials, returning HTTP
  `401` before it does any MCP processing.
- The default is a **connection token**. The Boneyard admin generates a random
  token (or pastes one you give them), and Boneyard sends it on every request:

  ```
  Authorization: Bearer <connection token>
  ```

  Compare it in constant time (hash both values, then use a constant-time
  equality check), and load it from a file or a secret store rather than from
  source code. Tokens are at least 32 characters.
- Instead, the admin MAY configure **custom headers** (for example
  `X-Api-Key: ...`, or a non-secret `X-Tenant: north`), usually by importing
  your [`server.json`](server-json.md). Boneyard sends exactly the headers
  configured for this connection, only to this connection's URL. Header names
  starting with `Mcp-`, `Boneyard-` or `X-Boneyard-` are reserved and can't be configured.
- Each connection has its own token. If one implementation backs two
  connections (for example "billing files" and "clinical files"), run two
  instances or give each connection its own token, and map each token to its own
  scope on your side.
- OAuth isn't available in v1. An organization-level "Connect with OAuth"
  option is planned; per-user OAuth isn't.

## 4. Caller context (optional `Boneyard-*` headers)

If the admin turns on **Send caller context** for the connection, each request
also carries these headers:

| Header | Value |
|---|---|
| `Boneyard-Agent-Id` | UUID of the calling agent |
| `Boneyard-Agent-Name` | Display name of the agent (up to 200 characters) |
| `Boneyard-Run-Id` | UUID of the agent run that made the call |
| `Boneyard-Tool-Call-Id` | The model's tool-call id (up to 128 characters) |
| `Boneyard-Channel-Id` | UUID of the channel the run belongs to |
| `Boneyard-Channel-Name` | Channel name (up to 200 characters) |
| `Boneyard-Trigger` | `interactive` (a person asked) or `routine` (a schedule); `unknown` if Boneyard can't tell |
| `Boneyard-Person-Id` | UUID of the person who started the run, or of the routine's sponsor |
| `Boneyard-Person-Email` | That person's email address |
| `Boneyard-Context-Status` | `verified`, `missing` or `invalid`: whether Boneyard could tie the call to a live run |

Rules:

- Every value is **percent-encoded UTF-8** (as `encodeURIComponent` produces).
  Decode it, and treat a value that fails to decode, contains control characters
  or has the wrong shape as absent. A malformed header MUST NOT fail the request.
- A header whose value is unknown is **omitted**, not sent empty. For calls from
  a routine, the person headers may be absent. With a status of `missing` or
  `invalid`, only the agent headers are dependable.
- The headers are **informational**: use them for attribution (for example
  "comment added by pat@example.com via Boneyard") and for your audit log.
  Boneyard enforces access before the call reaches you. Don't treat them as an
  end user's identity for authorization.
- Trust them **only because the gateway authenticated with your connection
  token**. The gateway removes any `Boneyard-*` header that an agent or anyone
  else tries to inject. If the connection doesn't send caller context, your
  server MUST ignore these headers; make trust an explicit setting that is off
  by default (`TRUST_CALLER_CONTEXT=false` in the reference server). Otherwise
  anyone holding the token could claim to be anyone.
- Boneyard itself uses `x-boneyard-run` and `x-boneyard-tool-call` between the
  agent runtime and the gateway. Your server never sees them.

## 5. Tools

### Names

- A name MUST match `^[A-Za-z0-9_.-]{1,128}$` and be unique on the server.
- Agents see `mcp__boneyard__<connection>__<tool>` (or `mcp__boneyard_ask__...`),
  cut off at 64 characters. Use **lowercase snake_case of 32 characters or
  fewer** (`tickets_search`), and avoid `.` and `-`, which some model providers
  reject.
- **A tool's name is its identity.** Renaming a tool creates a new tool, which
  starts **Off** until the admin reviews it, and the old tool disappears from
  every agent.

### Input schema

- `inputSchema` MUST be a JSON Schema whose `type` is `"object"`. If any tool
  has a different schema, clients (including the gateway) reject your whole
  tool list.
- Describe every property, set `additionalProperties: false`, and bound strings
  and numbers (`maxLength`, `minimum`, `maximum`, `enum`). The schema is your
  first line of defense, and the model reads it.

### Annotations drive the admin's suggested mode

Every tool SHOULD declare `annotations.readOnlyHint`. Write tools SHOULD also
declare `destructiveHint`.

| Annotations | Boneyard class | Suggested mode |
|---|---|---|
| `readOnlyHint: true` | read | **Allow** |
| `readOnlyHint: false, destructiveHint: false` | write | **Ask** (a person approves each call) |
| `readOnlyHint: false, destructiveHint: true` | destructive | **Off** |
| no `readOnlyHint`, `destructiveHint: false` | write | **Ask** |
| no annotations at all | destructive | **Off** |

- The annotations only produce a suggestion. The admin decides, and **every
  new tool starts Off** until they review it.
- Be honest: a read-only tool mustn't change anything, including through side
  effects like "mark as read".
- Split mixed tools: `ticket_get` (read) and `ticket_close` (write), never
  `ticket(action=...)`.

### Changes trigger re-review

Boneyard computes a digest of each tool's name, title, description,
`inputSchema`, `outputSchema` and annotations. If any of them changes, the tool
is marked **changed** and treated as Off until the admin reviews it again.
That covers renaming a tool, reclassifying it (changing `readOnlyHint` or
`destructiveHint`) and editing its description or schema. Plan releases so
that this review is expected, and keep tool metadata stable across replicas.

### Limits

| Item | Limit |
|---|---|
| Tools per server | 500 |
| `title` | 200 characters |
| `description` | 8,000 characters |
| One `tools/call` result, serialized as JSON | **256 KiB** (`262144` bytes) |

## 6. Results and errors

- **A tool that fails returns a result, not a protocol error.** Use
  `{ "isError": true, "content": [{ "type": "text", "text": "Ticket T-9 does not exist." }] }`.
  Write the message for the model: say what went wrong and what to try instead.
  Invalid arguments, not-found cases, permission refusals and backend outages
  all belong here.
- Protocol errors (JSON-RPC `error`) are for protocol problems only, such as an
  unknown tool name or a malformed request. Never let the server answer `500` or
  drop the connection because a tool failed.
- **Bound your output.** Paginate, cap list lengths, cut long text and say so
  (`"truncated": true`). Aim well below the 256 KiB cap: a model reads every
  byte you return.
- Return text content. If you also return `structuredContent`, keep it
  consistent with the text.
- Everything your tool returns is data, not instructions. Don't paste backend
  content in a way that could pass for instructions from Boneyard.

## 7. Secrets

- **No token passthrough.** Never forward the connection token (or any header
  Boneyard sends) to your backend, and never accept a token that was issued to
  someone else. Your backend credentials belong to your server.
- Never return a secret in a tool result, an error message or a log line. Use
  `kit check --fake --canary-file` to prove it.

## 8. Discovery and health

- The gateway discovers tools with `tools/list` after each configuration change
  and every 5 minutes. Keep `tools/list` fast and free of side effects, and
  don't make it depend on caller context.
- You MAY expose `GET /healthz` without authentication for your own monitoring.
  Boneyard doesn't use it and it mustn't reveal anything.
- A server that is down or failing affects only its own connection. Its tools
  give agents a "temporarily unavailable" error, and other connections keep
  working.

## Conformance

`kit check <url> --token-file <file>` runs the checks that are safe against
production: discovery, authentication and the tool list. Add `--fake` against
a server running on its fake backend to call tools and test canaries, result
sizes, errors and caller-context handling. See [testing.md](testing.md).
