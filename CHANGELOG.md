# Changelog

## Unreleased

- Long-running tools for Boneyard follow-ups (`docs/long-running.md`, contract section 9): a wait tool,
  `ticket_wait_for_update`, that waits at most 50 seconds and answers `timedOut: true` while nothing
  changed; and an optional `/mcp-tasks` endpoint (protocol 2025-11-25, v1 SDK) whose `tickets_export`
  runs as an MCP task, with tasks bound to the connection rather than the session. New contract
  constants `MAX_WAIT_SECONDS`, `TASK_PROTOCOL_VERSION` and `MAX_TASK_TTL_MS`.
- Kit checks `follow.wait-tools`, `follow.tasks` (safe) and `follow.wait-calls`, `follow.task-runs`
  (fake). `kit.config.json` takes `extraTargets` to check more endpoints of one server.
- The kit and its tests no longer depend on the example tools: `kit/test` uses self-contained servers,
  and `npm run kit:check` starts whatever `kit.config.json` describes. The reference server's own
  conformance test moved to `test/conformance.test.ts`.
- Fixtures can mark expected refusals (`"expect": "refusal"`); one that succeeds fails `calls.fixtures`.
- Kit messages and docs say "test data" (a fake backend or synthetic fixture roots).
- `audited(...)` takes an optional resource identifier and logs its hash as `resourceHash`.
- `npm run lint` enforces the code standards and is part of `npm run verify`.
- `npm run validate:server-json` validates `server.json` without leaving the schema behind.
- New `docs/backends.md` (identity-based backends, fixture roots, scope canaries, admin configuration);
  security, testing and deploying docs cover path references, cross-root links, case and Unicode
  tests, file shares on Linux and Windows, and the optional egress network. AGENTS.md gains a
  "Replace the example" checklist.

## 0.1.0

- Boneyard connection contract v1 (`docs/contract.md`, `contract/boneyard.ts`).
- Reference server: stateless Streamable HTTP, token auth, caller-context parsing, a fake ticket backend,
  `tickets_search` (read) and `ticket_add_comment` (write), bounded output, redacting structured logs.
- `kit check` with safe (discovery and auth) and fake (tool-calling) checks; `kit dev` mock gateway.
- Dockerfile (non-root), Compose example, `server.json`, CI workflow.
