# Deploying

Deploy the server anywhere the Boneyard host can reach over HTTP(S). Pick the
option that puts the server closest to the data it serves.

| Option | Use when | Transport |
|---|---|---|
| [Same host as Boneyard](#same-host-as-boneyard) | The backend is reachable from the Boneyard host, such as a SaaS API | HTTP on a private Docker network |
| [Elsewhere over HTTPS](#elsewhere-over-https) | The data lives in another network or cloud | HTTPS, firewalled to the Boneyard host |
| [Windows service](#windows-service) | The data is on a Windows domain (file shares, SQL Server with integrated auth) | HTTPS, firewalled to the Boneyard host |

Whichever you pick:

1. Generate the connection token in Boneyard (or with
   `openssl rand -base64 48`), and install it as a file readable only by the
   service account.
2. Put the backend credentials next to it, also as files.
3. Before registering the server, run `kit check <url> --token-file <file>`
   from the Boneyard host (or a host on the same network path) and get a pass.

## Same host as Boneyard

When integrations are enabled, Boneyard creates a Docker network named
**`boneyard-integrations`** and its gateway joins it. Put your container on that
network and give it **no published ports**: it is then reachable only by the
gateway, as `http://<service-name>:<port>/mcp`.

The network is **internal**, so it has no route out of the host. If your server
calls a backend (an API, a database, a file server), also attach it to a
network of your own that has egress, as `compose.example.yml` does with
`backend`. Never create `boneyard-integrations` yourself; Boneyard owns it.

```sh

mkdir -p secrets
openssl rand -base64 48 | tr -d '\n' > secrets/connection-token   # or paste the token Boneyard generated
printf '%s' "$YOUR_BACKEND_KEY" > secrets/backend-api-key
chmod 0444 secrets/*          # the container runs as uid 1000
cp compose.example.yml compose.yml
docker compose up -d --build
```

Register the URL `http://example-tickets:8750/mcp` (the Compose service
name and port).

Notes:

- Plain HTTP is acceptable here because the traffic never leaves the host's
  private bridge network. Use HTTPS as soon as it does.
- `compose.example.yml` runs the container read-only, drops all capabilities,
  forbids privilege escalation and mounts secrets as files. Keep those
  settings.
- Pin the base image by digest (`node:22-bookworm-slim@sha256:...`) for
  reproducible builds, and rebuild regularly for security updates.
- To check the server from the host, run a throwaway container on the same
  network, or temporarily publish the port on `127.0.0.1` only.

## Elsewhere over HTTPS

1. Run the server (container, VM, or platform service) with `HOST=0.0.0.0`.
2. Terminate TLS in front of it with a reverse proxy (Caddy, nginx, a cloud load
   balancer) or in the process itself, using a certificate the Boneyard host
   trusts. For an internal CA, the Boneyard operator must add the CA to the
   gateway's trust store.
3. Firewall: allow inbound 443 **only from the Boneyard host's egress
   address**. Deny everything else. Keep `/healthz` internal if you can.
4. Make sure the proxy:
   - passes the `Authorization` header and any `Boneyard-*` headers
     unchanged, and doesn't add its own `Boneyard-*` headers;
   - doesn't buffer responses indefinitely, because MCP responses may stream
     as `text/event-stream`;
   - allows 60-second requests;
   - doesn't redirect. Register the exact final URL, including any path prefix.
5. Register `https://tickets-mcp.example.com/mcp`.

Test from the Boneyard host:

```sh
npm run kit -- check https://tickets-mcp.example.com/mcp --token-file ./connection-token
```

## Windows service

For data inside a Windows domain, run the server on a domain-joined host inside
that network, under a **group Managed Service Account (gMSA)** or a dedicated
low-privilege service account. Grant that account read access to exactly the
data the connection may serve.

Using the reference server as an example (Node 22 installed on the host):

```powershell
npm ci; npm run build
New-Item -ItemType Directory C:\ProgramData\ExampleTickets\secrets -Force
# write connection-token and backend-api-key there, then restrict the ACL:
icacls C:\ProgramData\ExampleTickets\secrets /inheritance:r /grant:r "DOMAIN\svc-tickets$:(R)" "BUILTIN\Administrators:(F)"
```

Run it as a service with a service wrapper such as
[WinSW](https://github.com/winsw/winsw) or [NSSM](https://nssm.cc). Set:

| Setting | Value |
|---|---|
| Executable | `node.exe` |
| Arguments | `dist\src\main.js` |
| Working directory | the repository folder |
| Account | the gMSA (`DOMAIN\svc-tickets$`) |
| Environment | `HOST=0.0.0.0`, `PORT=8750`, `CONNECTION_TOKEN_FILE=C:\ProgramData\ExampleTickets\secrets\connection-token`, `BACKEND_API_KEY_FILE=...` |
| Restart | on failure |

Then:

- Terminate TLS in front of it (IIS with Application Request Routing, or a
  reverse proxy), using a certificate from your enterprise CA that the Boneyard
  host trusts.
- In Windows Defender Firewall, allow inbound 443 only from the Boneyard host's
  address.
- Send the service's stdout to a file or to the Windows Event Log through the
  wrapper, so you keep the structured audit lines.

Servers written in C# (ASP.NET Core with the official MCP C# SDK) run the same
way through `UseWindowsService()`. The contract doesn't change.

## Operating

- **Health:** `GET /healthz` returns `200 {"status":"ok"}` without
  authentication.
- **Logs:** one JSON line per event on stdout. Ship them to your log system
  and keep them as long as your audit policy requires.
- **Upgrades:** any change to a tool's name, description, schema or annotations
  sends that tool back to review (Off) in Boneyard. Tell the admin before you
  deploy such a change.
- **Scaling:** the server is stateless, so run several replicas behind a load
  balancer if needed. Keep their tool lists identical.
