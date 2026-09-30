# Concepts

## Integration and connection

- An **integration** is an MCP server you build and run: its code, its tools
  and its deployment. This repository gives you one to start from.
- A **connection** is one configured endpoint of that server in Boneyard: a
  URL, the headers Boneyard sends (usually a connection token), the admin's
  review of each tool, and the agents allowed to use it.

One integration can back several connections. A file-share server might be
registered twice, as `files-billing` and `files-clinical`, each with its own
token and its own root folders on your side. Each connection is reviewed and
granted separately. Make each connection cover one audience: give its agents
only the data every person using those agents may see.

## Who does what

| Party | Responsibility |
|---|---|
| **You, the server owner** | Build the server; hold the backend credentials; decide what data and actions are reachable at all; deploy it; log the backend principal you used |
| **Workspace admin** (in Boneyard) | Adds the connection, stores its secrets, reviews every tool, and sets it Off, Ask or Allow |
| **Agent manager** (in Boneyard) | Turns the connection on or off for specific agents |
| **Boneyard gateway** | Enforces the above on every call, records an audit entry, and strips spoofed headers |

Your server decides what is **possible**. Boneyard decides who **may** do it
and whether a person approves first. Enforce your own limits even though
Boneyard enforces its own.

## Off, Ask and Allow

The admin sets each tool of each connection to one of three modes:

| Mode | Effect |
|---|---|
| **Off** | Agents never see the tool. Every new or changed tool starts here. |
| **Ask** | Agents see it, but a person approves every call in the conversation. Scheduled routines have no one to ask, so they decline Ask tools. |
| **Allow** | Agents call it without asking. |

Boneyard suggests a mode from your annotations: read-only tools get Allow,
non-destructive writes get Ask, and destructive or unannotated tools get Off.
The admin makes the final choice. A mode change applies to the next call.

An agent manager can then grant the connection to an agent. Agents only ever
see tools that are reviewed, not Off, and on a connection granted to them.
Worker sub-agents never get integrations.

## What the admin sees

When the admin adds your URL, Boneyard connects, runs `tools/list`, and shows:

- the server name and version, and the protocol version negotiated;
- every tool's name, title, description and input schema;
- the class derived from annotations (read, write or destructive) and the
  suggested mode;
- review state: **new**, **reviewed** or **changed**. Any change to a
  tool's name, description, schema or annotations marks it changed and turns
  it Off until reviewed again;
- availability: available, unreachable, authentication failed, protocol error
  or invalid tool list.

Write tool descriptions for a person deciding whether to allow the tool, not
only for the model.

## What agents see

A tool `tickets_search` on connection `helpdesk` appears to an agent as
`mcp__boneyard__helpdesk__tickets_search` (Allow) or
`mcp__boneyard_ask__helpdesk__tickets_search` (Ask). Names over 64 characters
are cut off, which is why short tool names matter.

When your server is unreachable, the agent gets a "temporarily unavailable"
tool error for that connection only. Everything else keeps working.

## Audit

Boneyard records every authorized or denied call: agent, run, channel, person,
tool, decision and outcome. It stores metadata only, never arguments or results. Your
server records what only it knows: which backend account it used, what it
touched, and the caller context if the connection sends it. See
[security.md](security.md#audit-logging).
