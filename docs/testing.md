# Testing

Test at three levels. Only the last one touches anything real.

| Level | Command | Against |
|---|---|---|
| Unit and integration tests | `npm test` | Your code, in-process, on test data |
| Conformance, fake mode | `npm run kit:check`, or `npm run kit -- check <url> --fake ...` | A running server on **test data** |
| Conformance, safe mode | `npm run kit -- check <url> --token-file <file>` | Any server, including production |

## `kit check`

```sh
npm run kit -- check <url> --token-file <file> [--fake] [--canary-file <file>] [--fixtures <file>]
```

It works against any server URL, whatever language the server is written in.
Checks marked **safe** only discover tools and test authentication, so you
can run them against production. Checks marked **fake** call every tool,
**including write tools**. Run those only against a server on test data.

"Test data" depends on the backend (see [backends.md](backends.md)):

- for an API backend, an in-memory **fake backend** with synthetic records
  that checks a synthetic credential;
- for a file share or another identity-based backend, **synthetic fixture
  roots**: real folders on disk holding synthetic files, published through
  the same configuration production uses.

The flag is called `--fake` either way.

| Check | Mode | Passes when |
|---|---|---|
| `discovery` | safe | The kit connects, negotiates a [supported protocol version](contract.md#2-protocol-versions), and `tools/list` returns |
| `auth.missing` | safe | A request without the token gets `401` (`403` is a warning) |
| `auth.wrong` | safe | A request with a wrong token gets `401` and the response doesn't echo the token |
| `auth.accepted` | safe | The configured token is accepted and the endpoint doesn't redirect |
| `tools.names` | safe | Names match the contract charset and are unique; non-portable names are a warning |
| `tools.annotations` | safe | Every tool has `readOnlyHint`, and write tools have `destructiveHint`; otherwise a warning. Also prints each tool's class and suggested mode |
| `tools.input-schemas` | safe | Every `inputSchema` has `type: "object"` |
| `tools.metadata` | safe | Titles and descriptions fit the limits; a missing description is a warning |
| `secrets.catalog` | safe | The tool list never contains the token or a canary |
| `calls.fixtures` | fake | Each planned call succeeds, or fails if the fixture says `"expect": "error"` (otherwise a warning). A call marked `"expect": "refusal"` that succeeds is a **failure** |
| `secrets.canary` | fake | No tool result contains the token, the `X-Kit-Canary` header value, or any `--canary-file` value (raw, base64, hex or percent-encoded) |
| `results.size` | fake | Every result is at most 256 KiB serialized |
| `results.errors` | fake | Invalid arguments come back as `isError` results (a JSON-RPC error is a warning), and nothing fails at the transport level, including an unknown tool name |
| `context.forged-ignored` | fake | Forged `Boneyard-*` values never appear in results. Skipped with `--trusts-caller-context` |
| `context.malformed` | fake | Malformed `Boneyard-*` headers don't break a call |

The exit code is `0` when nothing fails (warnings allowed) and `1` otherwise.
`--json` prints a machine-readable report.

### `npm run kit:check` and `kit.config.json`

`npm run kit:check` starts your server as a child process, runs `kit check`
in safe and fake modes against it, and stops it. It knows nothing about the
server except what `kit.config.json` says, so it works for a server in any
language:

```json
{
  "command": ["node", "--import", "tsx", "src/main.ts"],
  "env": {
    "PORT": "{port}",
    "CONNECTION_TOKEN_FILE": "{token_file}",
    "BACKEND": "fake",
    "BACKEND_API_KEY_FILE": "{random_file:backend-api-key}"
  },
  "url": "http://127.0.0.1:{port}/mcp",
  "canaryFiles": ["{random_file:backend-api-key}"],
  "fixtures": "kit.fixtures.json"
}
```

| Field | Meaning |
|---|---|
| `command` | Program and arguments that start the server in fake mode |
| `env` | Environment added for the server (on top of the current one) |
| `url` | Where the server answers |
| `canaryFiles` | Files whose content must never appear in a result (see [Canaries](#canaries)) |
| `fixtures` | Optional fixtures file |
| `trustsCallerContext` | `true` if this configuration trusts `Boneyard-*` headers |
| `startupTimeoutMs` | How long to wait for the server to answer (default 30000) |

Placeholders, usable in `command`, `env`, `url` and `canaryFiles`:
`{port}` is a free local port, `{token_file}` is a file holding a fresh
connection token, and `{random_file:<name>}` is a file holding a fresh random
value (the same file each time the name repeats). The files live in a temporary
directory that is removed afterwards. Plain paths such as
`fixtures/outside/secret.txt` pass through unchanged. The server's output is
printed only when something fails.

### Canaries

A canary is a value that must never appear in a tool result, planted so you
can see whether it ever comes out. There are two patterns; use every one that
applies to your backend (see [backends.md](backends.md)).

**A secret the server holds.** For an API backend, start the server in fake
mode with a random backend key, and pass the same file to the kit.
`kit.config.json` does this with `{random_file:backend-api-key}`; by hand:

```sh
openssl rand -hex 24 > /tmp/canary
BACKEND_API_KEY_FILE=/tmp/canary CONNECTION_TOKEN_FILE=.dev/connection-token npm run dev
npm run kit -- check http://127.0.0.1:8750/mcp --token-file .dev/connection-token --fake --canary-file /tmp/canary
```

A Python or C# server does the same with its own secret variable.

**Content outside the allowed scope.** A server that authenticates as its
own identity (a file share under a gMSA, a mounted folder) may hold no secret
at all. What it must protect is everything it can reach but mustn't serve. Put
a unique random line in a file **outside** every published root of the
synthetic fixtures, link to it from inside a root, and pass that file as the
canary:

```sh
npm run kit -- check http://127.0.0.1:8750/mcp --token-file .dev/connection-token --fake \
  --canary-file fixtures/outside/not-shared.txt --fixtures kit.fixtures.json
```

Then any path that reads it (`..`, a symlink, a junction, a case or Unicode
variant, a link into another root) fails `secrets.canary`, even one you didn't
think to write a fixture for. Pair it with `"expect": "refusal"` fixtures for
the escapes you know about ([Fixtures](#fixtures)). The same idea applies to
any scoped backend: a record in another tenant, a mailbox the connection
doesn't serve, a row the service account can read but the tool shouldn't
return.

The kit always treats the connection token and a random `X-Kit-Canary` request
header as canaries too, so a server that echoes request headers fails even
without `--canary-file`.

### Fixtures

The kit makes up arguments from each input schema: defaults, the first enum
value, minimum numbers, placeholder strings. These often fail validation
(for example against a `pattern`). To exercise the real paths, give it
fixtures:

```json
{
  "tools": {
    "tickets_search": [{ "arguments": { "query": "vpn" } }],
    "ticket_add_comment": [
      { "arguments": { "ticketId": "T-1001", "body": "Retested." } },
      { "arguments": { "ticketId": "T-99999", "body": "x" }, "expect": "error" }
    ]
  }
}
```

`kit.fixtures.json` in this repository is the working example. Include at
least one call per tool that returns the largest realistic result, so that
`results.size` means something.

Each case has an `expect`:

| `expect` | Meaning | If the call succeeds anyway |
|---|---|---|
| `"result"` (default) | The call succeeds | - |
| `"error"` | An ordinary failure: not found, invalid input | Warning: your fixture may be stale |
| `"refusal"` | A **security boundary** the server must hold: a path escape, a root that isn't published, a symlink out of the root, an id in the wrong format | **Failure**: the boundary didn't hold |

Any failure counts as a refusal: an `isError` result or a JSON-RPC error. Mark
every containment test as a refusal, so that a regression shows up as `FAIL`
rather than as a warning that is easy to miss:

```json
{
  "tools": {
    "file_read": [
      { "arguments": { "ref": "policies:handbook.md" } },
      { "arguments": { "ref": "policies:missing.md" }, "expect": "error" },
      { "arguments": { "ref": "policies:../outside/secret.txt" }, "expect": "refusal" },
      { "arguments": { "ref": "policies:escape-link.txt" }, "expect": "refusal", "note": "Symlink to a file outside the root." },
      { "arguments": { "ref": "billing:" }, "expect": "refusal", "note": "Not a published root." }
    ]
  }
}
```

### Caller context

With the default settings, the kit assumes your server **doesn't** trust
`Boneyard-*` headers, so forged values must never show up in results. If you
deploy with trust turned on (the connection sends caller context), pass
`--trusts-caller-context`. The forged-header check is skipped, and
`context.malformed` still runs.

## `kit dev`: try tools the way Boneyard calls them

```sh
npm run dev        # terminal 1: reference server on :8750 with the fake backend
npm run kit:dev    # terminal 2: a mock Boneyard gateway
```

```
kit> tools
kit> call tickets_search {"query":"vpn"}
kit> as person someone@example.com
kit> as trigger routine
kit> context off
kit> whoami
```

Each call sends the connection token and fresh caller-context headers
(`Boneyard-Run-Id`, `Boneyard-Tool-Call-Id` and the rest, percent-encoded), as
the gateway does when **Send caller context** is on. `tools` shows each tool's
class, suggested mode and agent-facing name.

To run it without a prompt, for scripts and coding agents:

```sh
npm run kit -- dev http://127.0.0.1:8750/mcp --token-file .dev/connection-token \
  --exec tools --exec 'call tickets_search {"query":"printer"}'
```

It also reads commands from stdin when stdin isn't a terminal.

## What to test in your own server

- Every tool: a success case, a not-found case, invalid input, and a backend
  failure, each returned as a tool result.
- Output bounds: the largest realistic input gives a truncated but valid result.
- Auth: a missing or wrong token gets `401`, and so does a token for another
  connection.
- Logs: no secret values (see `test/log.test.ts`).
- Containment, for file or object stores: `..`, absolute paths, symlinks and
  junctions that escape, links into another root, and case and Unicode
  variants are refused (see below).
- Caller context: ignored when trust is off; parsed and logged when it is on;
  malformed values tolerated.

### Case and Unicode variants, portably

File systems disagree about names, so a containment test that passes on your
laptop can mean something different in production:

| File system | Case | Unicode normalization |
|---|---|---|
| APFS (macOS default) | Insensitive, preserving: `Policies` opens `policies` | Insensitive: NFC `é` and NFD `e` + `◌́` open the same file |
| ext4, XFS (Linux, containers) | Sensitive: `Policies` is a different, usually missing, name | Byte-exact: NFC and NFD are different names |
| NTFS, SMB shares | Insensitive, preserving | Byte-exact, but many clients normalize |

Write the tests so they hold on all of them:

- Assert the security property, not the file-system behavior: a variant is
  either refused or resolves to **the same file inside the same root**, and
  never reaches anything outside. For example, compare the `realpath` of what
  was served with the `realpath` of the fixture, instead of asserting "not
  found".
- Generate variants in the test (`name.toUpperCase()`, `name.normalize("NFD")`)
  and create any files that need them in a temporary directory at setup. Don't
  commit two names that differ only by case or normalization: the checkout
  breaks on macOS and Windows.
- Compare root names and reference segments exactly, in your own code, before
  touching the file system, so the rules for the model don't depend on the
  host.
- Run the suite on Linux as well as on your workstation. CI (`ubuntu-latest`)
  does it on every push; to do it locally on macOS or Windows, run the tests in
  the same Linux image the Dockerfile uses:

```sh
docker run --rm -v "$PWD":/src:ro -w /work node:22-bookworm-slim sh -c \
  'tar -C /src --exclude=./node_modules --exclude=./.git -cf - . | tar -xf - && npm ci && npm test'
```

The source is mounted read-only and copied inside the container, so the
container's own `node_modules` never mixes with the host's.

## Before registering

Run `npm run verify` (typecheck, tests and `kit:check`). Then run a safe
`kit check` from the Boneyard host against the deployed URL.
