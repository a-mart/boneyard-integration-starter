# Writing `server.json`

`server.json` is optional. It describes how to connect to your server, in the
**official MCP Registry format** (schema `2025-12-11`). When an admin imports
it, Boneyard renders a form for your headers, marking each as required or
secret with its defaults and choices, instead of asking for one free-form auth
header.

Boneyard reads only the `remotes` entry of type `streamable-http`. There is no
Boneyard-specific extension, so the same file works in the MCP Registry and in
other MCP clients.

## The reference file

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "com.example/tickets",
  "title": "Example tickets",
  "description": "Search help-desk tickets and add comments. Reference server for Boneyard connections.",
  "version": "0.1.0",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "http://example-tickets:8750/mcp",
      "headers": [
        {
          "name": "Authorization",
          "description": "Connection token. Generate it in Boneyard and install the same value on the server (CONNECTION_TOKEN_FILE).",
          "isRequired": true,
          "isSecret": true,
          "value": "Bearer {connection_token}",
          "variables": {
            "connection_token": {
              "description": "The connection token, at least 32 characters.",
              "isRequired": true,
              "isSecret": true
            }
          }
        }
      ]
    }
  ]
}
```

## Fields

Top level (required by the schema):

| Field | Rule |
|---|---|
| `$schema` | `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` |
| `name` | Reverse-DNS namespace, a slash, then a name: `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, 3 to 200 characters. Use a domain you control. |
| `description` | 1 to 100 characters |
| `version` | Your release version, such as `1.4.0` |
| `title` | Optional, up to 100 characters |

`remotes[]` entries:

| Field | Meaning |
|---|---|
| `type` | `"streamable-http"` (Boneyard ignores `sse`) |
| `url` | Endpoint URL; must start with `http://` or `https://`. May contain `{variable}` placeholders defined in `variables`. The admin can still edit the final URL. |
| `variables` | Optional map from placeholder name to an **Input** (below), for values in the URL |
| `headers[]` | Headers Boneyard sends on every request. Each is an **Input** plus `name`, and may have its own `variables` for placeholders in `value` |

**Input** fields, as Boneyard renders them:

| Field | Form behavior |
|---|---|
| `description` | Help text under the field |
| `isRequired` | The admin must fill it in before saving |
| `isSecret` | Write-only field. The value goes to Boneyard's secret store and never comes back |
| `format` | `string` (default), `number` or `boolean` (checkbox). `filepath` doesn't apply to remote servers |
| `choices` | Dropdown limited to these values |
| `default` | Pre-filled value |
| `placeholder` | Example shown in an empty field |
| `value` | Fixed template. When set, the admin doesn't type the header value; they fill in its `{variables}` instead |

## Patterns

**Bearer token (default).** Use the reference file above. `value` is fixed as
`Bearer {connection_token}`, so the admin types or generates only the token.

**API key header:**

```json
{ "name": "X-Api-Key", "description": "API key for this connection.", "isRequired": true, "isSecret": true }
```

**Non-secret choice, such as a tenant or region:**

```json
{ "name": "X-Tenant", "description": "Which tenant this connection serves.", "isRequired": true, "choices": ["north", "south"], "default": "north" }
```

**Host in the URL:**

```json
{
  "type": "streamable-http",
  "url": "https://{host}/mcp",
  "variables": {
    "host": { "description": "Host name and port where the server is deployed.", "isRequired": true, "placeholder": "tickets-mcp.example.com" }
  }
}
```

## Rules

- Don't use header names starting with `Mcp-`, `Boneyard-` or `X-Boneyard-` (reserved), or
  `Host`, `Content-Length`, `Connection` or `Transfer-Encoding`.
- At most 16 headers.
- Never put a real secret in `default`, `value` or `placeholder`. The file is
  public.
- Keep `server.json` in the repository next to the server, and bump `version`
  with each release.

## Validate it

```sh
curl -sO https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
npx -y -p ajv-cli@5 ajv validate --spec=draft7 --strict=false -s server.schema.json -d server.json
# prints "server.json valid"; "unknown format" notices are harmless
```

The reference `server.json` and the "Host in the URL" example above both
validate against the official schema.
