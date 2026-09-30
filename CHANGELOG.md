# Changelog

## 0.1.0

- Boneyard connection contract v1 (`docs/contract.md`, `contract/boneyard.ts`).
- Reference server: stateless Streamable HTTP, token auth, caller-context parsing, a fake ticket backend,
  `tickets_search` (read) and `ticket_add_comment` (write), bounded output, redacting structured logs.
- `kit check` with safe (discovery and auth) and fake (tool-calling) checks; `kit dev` mock gateway.
- Dockerfile (non-root), Compose example, `server.json`, CI workflow.
