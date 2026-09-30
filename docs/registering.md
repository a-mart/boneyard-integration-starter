# Registering a connection in Boneyard

These steps are for the Boneyard **Workspace admin**. Server owners should read
them too, so they know what to hand over: the URL, the optional `server.json`,
and any secrets the headers need.

## Before you start

- The server is deployed and reachable from the Boneyard host (see
  [deploying.md](deploying.md)).
- `kit check <url> --token-file <file>` passes from the Boneyard host or its
  network.
- You know which agents should use it and who is allowed to see its data.

## Steps

1. **Open** Workspace administration → **Integrations** → **Add connection**.
2. **Identify it.** Enter an id (lowercase letters, digits and single hyphens,
   up to 32 characters, such as `helpdesk` or `files-billing`), a title and a
   description. The id becomes part of the tool names agents see, so keep it
   short.
3. **Enter the URL**, for example `http://example-tickets:8750/mcp` on the
   same host, or `https://tickets-mcp.example.com/mcp` elsewhere.
4. **Optionally import `server.json`.** Paste or upload the server's
   `server.json`. Boneyard reads the `remotes` entry and shows a form for
   its headers: which are required, which are secret, and the defaults and
   choices. Without it, you configure a URL and one optional auth header by
   hand.
5. **Set the secrets.** Either:
   - **Generate a token.** Boneyard creates a random connection token, saves
     it in its secret store and shows it **once**. Where the server's operator
     can read that store (see [where secrets live](#where-secrets-live)), they
     install it from there as `CONNECTION_TOKEN_FILE` (or the equivalent) and
     nobody copies it by hand. Otherwise, copy it to the server owner once.
   - **Enter a secret** the server owner gave you, such as an API key for a
     third-party MCP server.

   Secrets go into Boneyard's secret store through a write-only form. Nobody,
   admins included, can read them back later. To replace a secret, enter a new
   one.
6. **Choose whether to send caller context.** Turn it on only if the server
   uses it (for attribution or its own audit) and the server owner has set
   their server to trust it. It sends the agent, run, channel and person
   (including email) with every call. See the [contract](contract.md#4-caller-context-optional-boneyard--headers).
7. **Save and test.** Boneyard connects through its gateway, checks
   authentication and discovers the tools. Errors show as unreachable,
   authentication failed, protocol error or invalid tool list.
8. **Review the tools.** Every tool arrives **new** and **Off**. For each
   one, read the description and input schema, look at the suggested mode
   (read gets Allow, write gets Ask, destructive or unannotated gets Off),
   then set **Off**, **Ask** or **Allow**.
9. **Grant agents.** Agent managers turn the connection on for specific agents
   in each agent's manage dialog. Only reviewed tools that aren't Off appear, and
   only to granted agents. An agent picks up newly listed tools after its
   runtime restarts, which Boneyard does when the agent is idle.

## Afterwards

- **Tool changes:** when the server adds a tool or changes an existing one
  (name, description, schema or annotations), the tool shows as **new** or
  **changed** and stays Off until you review it again.
- **Revoking:** turning off a grant, a tool or the whole connection takes
  effect on the next call.
- **Rotating the token:** generate a new one, give it to the server owner, and
  save when they are ready. Calls fail with an authentication error until both
  sides match.
- **Two audiences, one server:** add a second connection with its own id, URL
  or token, and its own grants. Don't share one connection between audiences
  that may see different data.

## Where secrets live

Keep three kinds of secret apart. With Bitwarden Secrets Manager, which
Boneyard uses, that means separate projects and a separate machine account for
whoever installs servers:

| Secret | Store it in | Who can read it |
| --- | --- | --- |
| Connection token (Boneyard to your server) | An integration-tokens project that Boneyard's admin marks as a System core project | Boneyard (read and write, because it generates tokens) and the server operator (read) |
| Backend credentials (your server to its backend: API keys, certificates, service-account passwords) | An integration-credentials project | The server operator only, never Boneyard |
| Boneyard's own secrets | Boneyard's own System core project | Boneyard only |

- Boneyard's machine account needs write access to the integration-tokens
  project, or generating a token fails.
- The server operator's machine account token stays where servers are
  installed, for example a root-only file on the host. It never goes into
  Boneyard, the repository or chat.
- Windows services that use a gMSA or another built-in identity may need no
  backend credential at all.

The Boneyard operator's runbook has the full setup, including the exact
permissions and how to rotate a secret.

