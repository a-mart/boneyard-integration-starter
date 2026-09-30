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
calls a backend over the network (an API, a database, an SMB server it
connects to itself), also attach it to a network of your own that has egress,
as `compose.example.yml` does with `backend`. That second network is
**optional**: a server that only reads folders bind-mounted from the host
makes no outbound connections, so drop `backend` and keep it on
`boneyard-integrations` alone. Never create `boneyard-integrations` yourself;
Boneyard owns it.

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

### File shares from Docker on Linux

To serve folders from an SMB (Windows) share, mount the share **on the host**
and bind-mount the folders into the container read-only. The container then
needs no SMB credentials, no extra capabilities and no egress network.

1. Create a domain account (or a gMSA the Linux host can use through a
   keytab) with **read-only** share and NTFS permissions on exactly the
   folders to publish. The ACLs are the real boundary.
2. Store its credentials on the host, readable by root only:

   ```sh
   sudo install -d -m 0700 /etc/file-reader
   sudo install -m 0600 /dev/null /etc/file-reader/cifs-credentials
   sudoedit /etc/file-reader/cifs-credentials   # username=svc-files, password=..., domain=EXAMPLE
   ```

3. Mount the share read-only in `/etc/fstab`, owned by the container's user
   (uid 1000 is `node` in the image):

   ```
   //files.example.internal/policies  /mnt/shares/policies  cifs  ro,credentials=/etc/file-reader/cifs-credentials,uid=1000,gid=1000,file_mode=0444,dir_mode=0555,vers=3.1.1,seal,nosuid,nodev,noexec,_netdev  0  0
   ```

   `seal` encrypts SMB traffic. With Kerberos, use `sec=krb5` and a keytab
   instead of a stored password.
4. Bind-mount each folder into the container with `read_only: true` (the
   commented `volumes` block in `compose.example.yml`) and publish the
   container paths, such as `FILE_ROOTS=policies=/data/policies`.

Don't use a Docker `cifs` volume (`driver_opts: { type: cifs, o: "username=...,password=..." }`):
the password ends up in the Compose file and in `docker volume inspect`.

Links that the SMB server follows itself (Windows symbolic links evaluated on
the server, DFS referrals) are invisible to `realpath` on the client, so your
containment check can't see them. Keep the account's permissions tight, and
[refuse links out of the root](security.md#symlinks-and-other-links) that the
client does see.

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

### File shares from a Windows service

- **Use UNC paths, never mapped drives.** Drive letters are mapped per logon
  session. A service runs in its own session under its own account, so it
  doesn't see `P:` mapped by a user, and mapping drives from a service
  startup script is fragile. Publish
  `policies=\\files.example.internal\policies` instead of `policies=P:\`.
- **Run as a gMSA.** Windows rotates its password, and nobody knows it:

  ```powershell
  # Once per domain, by a domain admin (keys take up to 10 hours to replicate):
  Add-KdsRootKey -EffectiveImmediately
  New-ADServiceAccount -Name svc-files -DNSHostName svc-files.example.internal -PrincipalsAllowedToRetrieveManagedPassword "FileReaderHosts"
  # On the server host, a member of FileReaderHosts:
  Install-ADServiceAccount -Identity svc-files
  Test-ADServiceAccount -Identity svc-files
  ```

  Configure the service to log on as `DOMAIN\svc-files$` with an empty
  password (`sc.exe config <service> obj= "DOMAIN\svc-files$"`, or the
  wrapper's service-account setting), and make sure the account has the
  *Log on as a service* right.
- **Grant read only.** Give `DOMAIN\svc-files$` *Read* on the share and
  *Read & execute* on exactly the published folders. Deny nothing else by
  hand; just don't grant it.
- **Resolve roots the way the server sees them.** `realpath` on a DFS path
  returns the namespace path, so publish roots in the same form, and include
  a DFS link in your containment tests if you use DFS.
- The server's own files (the repository, `secrets`) stay on a local disk
  with an ACL for the service account, as above.

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
