# Backends, test data and configuration

The reference server talks to an API with a key it holds. Many servers don't:
a file-share reader authenticates as the Windows account it runs under, and a
server that reads a mounted folder has no credential at all. This page covers
both shapes, what "fake" and "canary" mean for each, and how an admin passes
configuration such as the folders to publish.

## Two shapes of backend

| | API backend | Identity-based backend |
|---|---|---|
| Examples | A SaaS ticket system, a REST API, a database with a password | A Windows file share, a mounted SMB or NFS share, SQL Server with integrated auth, a local folder |
| Credential | A key or password the server loads from a `*_FILE` | The server process's identity: a gMSA, a service account, a Kerberos keytab, or the host's mount |
| What limits reach | The key's scopes at the backend | The account's ACLs **and** the roots the server publishes |
| Test data | An in-memory **fake backend** that checks a synthetic key | **Synthetic fixture roots**: real folders of synthetic files |
| Canary | The fake's key | Content **outside** the published roots (and the key too, if there is one) |

A server may be both, for example a document store reached with an API key
that also has folders. Then use both kinds of canary.

## The fake for an identity-based backend

Don't write an in-memory imitation of a file system. Run the real code path
against real folders that contain only synthetic data:

```
fixtures/
  shares/
    policies/
      README.txt
      front-desk/phone-greeting.md
      front-desk/pasted-note.md     # a prompt-injection sample, returned as data
      greeting-shortcut.md -> front-desk/phone-greeting.md   # link inside the root: allowed
      escape-link.txt -> ../../outside/not-shared.txt        # link out of the root: refused
      escape-folder -> ../../outside                          # folder link out of the root: refused
    forms/
      supply-order-sample.csv
  outside/
    not-shared.txt                  # the canary: must never appear in a result
```

- Publish `fixtures/shares/policies` and `fixtures/shares/forms` as roots,
  through the same configuration format production uses, so tests exercise
  the real parser and resolver.
- Put at least one file **outside** every root, and reach for it from inside:
  a `..` path, a symlink to the file, a symlink to its folder, and a link from
  one root into another (see [cross-root links](security.md#symlinks-and-other-links)).
- Commit the symlinks with Git (`core.symlinks` is on by default except on
  Windows). On Windows, or anywhere symlinks can't be created, create them in
  the test setup instead, in a temporary copy of the fixtures.
- Keep everything synthetic, including names: no real people, patients,
  hostnames or share paths.

The file-share equivalent of "the fake must check a credential" is "the
fixtures must contain something the server must not reach".

## Canaries for identity-based backends

A canary is any value that must never appear in a tool result. For an API
backend it is the key. When the server holds no key, the thing to protect is
**content outside the allowed scope**, so make that content the canary:

1. Put a unique random line in a file outside every published root, such as
   `fixtures/outside/not-shared.txt`. Generate it once and commit it; it isn't
   a secret, only a marker.
2. Link to it from inside a root, as above.
3. Pass the file to the kit as a canary, and mark each escape attempt as an
   expected refusal in the fixtures.

```json
{
  "command": ["node", "--import", "tsx", "src/main.ts"],
  "env": {
    "PORT": "{port}",
    "CONNECTION_TOKEN_FILE": "{token_file}",
    "FILE_ROOTS": "policies=fixtures/shares/policies;forms=fixtures/shares/forms"
  },
  "url": "http://127.0.0.1:{port}/mcp",
  "canaryFiles": ["fixtures/outside/not-shared.txt"],
  "fixtures": "kit.fixtures.json"
}
```

If a tool ever returns the file's content, however it got there,
`secrets.canary` fails. If an escape returns anything else, such as a listing
of the outside folder, the `"expect": "refusal"` fixture fails
`calls.fixtures`. The two together cover "read outside" and "reached outside".
See [testing.md](testing.md#canaries).

Use absolute paths in production roots. Relative paths such as the ones above
are fine for fixtures because `kit:check` and the tests run from the
repository root.

## Configuration the admin sets

Some configuration decides what the connection can reach: the folders to
publish, the mailbox, the project. It belongs **on the server**, set by
whoever deploys it, next to the backend credentials. Not in Boneyard headers,
and not in tool schemas.

### Recommended format

For a short list, one environment variable with `name=value` entries separated
by semicolons:

```sh
FILE_ROOTS='policies=/srv/shares/policies;forms=/srv/shares/forms'
```

On Windows, the same with UNC paths (see [deploying.md](deploying.md#file-shares-from-a-windows-service)):
`policies=\\files.example.internal\policies;forms=\\files.example.internal\forms`.

For anything longer or structured, a JSON file named by a `*_FILE` variable,
mounted read-only next to the secrets:

```sh
FILE_ROOTS_FILE=/etc/file-reader/roots.json
```

```json
{
  "roots": [
    { "name": "policies", "path": "/srv/shares/policies", "description": "Front-desk policies and scripts" },
    { "name": "forms", "path": "/srv/shares/forms", "description": "Blank forms" }
  ]
}
```

Either way:

- Parse it with zod at startup and **refuse to start** on anything invalid:
  unknown keys, duplicate names, relative paths, a root that doesn't exist or
  can't be read. A server that starts with half its configuration serves the
  wrong scope quietly.
- Root names are short, lowercase and stable (`^[a-z0-9][a-z0-9-]{0,31}$`),
  because they appear in references, logs and agent memory. Renaming a root
  breaks every reference an agent remembers.
- The configuration isn't secret, but it describes your internal layout, so
  don't return raw paths to the model. Return root names and descriptions.
- One deployment and one connection token per audience. If two teams need
  different roots, run two instances with two configurations and register two
  connections.
- Document every variable in the README, and use synthetic values in examples.

### Don't put configuration in tool schemas

It is tempting to list the roots in the schema:

```json
{ "type": "object", "properties": { "root": { "type": "string", "enum": ["policies", "forms"] } } }
```

Boneyard computes a digest of each tool's name, title, description,
`inputSchema`, `outputSchema` and annotations
([contract](contract.md#changes-trigger-re-review)). If a configuration value
appears in any of them, **every configuration change changes the digest**, and
the tool goes back to admin review (Off) until someone approves it again.
Replicas with different configurations would also disagree about the tool list.

Keep schemas static (`"root": { "type": "string", "maxLength": 32, "pattern": "^[a-z0-9-]+$" }`)
and let the model discover the configured values from a read tool, such as
`files_list` with no arguments returning the roots and their descriptions.
Reject an unknown root at call time with a result that says how to list them.
The same applies to descriptions: say "one of the published folders", not
their names.
