# Boneyard integration starter

Build an MCP server that plugs into [Boneyard](docs/concepts.md) as a
**connection**, without changing Boneyard. This repository contains:

- **The contract**: [docs/contract.md](docs/contract.md). Language-agnostic
  rules for authentication, caller context, tool naming and annotations,
  errors and limits.
- **A reference server** in TypeScript (Node 22, official MCP SDK, stateless
  Streamable HTTP). It has two example tools, `tickets_search` (read) and
  `ticket_add_comment` (write), backed by an in-repository fake.
- **The kit**: `kit check`, a conformance suite you can run against any server
  URL, and `kit dev`, a mock Boneyard gateway for trying tools as a given
  agent, person and channel.

Coding agents: start with [AGENTS.md](AGENTS.md).

## Quick start

```sh
npm ci
npm run verify      # typecheck, tests, and a full conformance run against the reference server
npm run dev         # serve http://127.0.0.1:8750/mcp with the fake backend
npm run kit:dev     # in a second terminal: call tools as Boneyard would
```

Check any server, including one in another language:

```sh
npm run kit -- check https://your-server.example.com/mcp --token-file ./connection-token
```

## Documentation

| Page | For |
|---|---|
| [contract.md](docs/contract.md) | What your server must do (any language) |
| [concepts.md](docs/concepts.md) | Connections vs integrations, Off, Ask and Allow, what the admin sees |
| [security.md](docs/security.md) | Secrets, least privilege, containment, prompt injection, audit, regulated data |
| [testing.md](docs/testing.md) | `npm test`, `kit check` (safe and fake modes), `kit dev` |
| [deploying.md](docs/deploying.md) | Same host (Docker network), elsewhere over HTTPS, Windows service |
| [registering.md](docs/registering.md) | Adding the connection in Boneyard |
| [server-json.md](docs/server-json.md) | Describing your headers so Boneyard renders a form |

## Configuration (reference server)

| Variable | Default | Meaning |
|---|---|---|
| `CONNECTION_TOKEN_FILE` / `CONNECTION_TOKEN` | required | Token Boneyard sends as `Authorization: Bearer ...` (at least 32 characters) |
| `BACKEND_API_KEY_FILE` / `BACKEND_API_KEY` | required | Credential for the backend (the fake checks it too) |
| `BACKEND` | `fake` | Backend implementation |
| `TRUST_CALLER_CONTEXT` | `false` | Use `Boneyard-*` headers for attribution and logs |
| `HOST` / `PORT` / `MCP_PATH` | `127.0.0.1` / `8750` / `/mcp` | Listener |
| `MAX_RESULT_BYTES` | `65536` | Result bound per tool call (at most 262144) |
| `MAX_BODY_BYTES` | `1048576` | Request body cap |
| `ALLOWED_ORIGINS` | empty | Browser origins allowed (the gateway sends none) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
