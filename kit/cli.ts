import { parseArgs } from "node:util";

import { z } from "zod";

import { runChecks } from "./check.js";
import { runDev } from "./dev.js";
import { loadFixtures } from "./fixtures.js";
import { formatReport, passed } from "./report.js";
import { createTarget, readSecretFile, type Target } from "./target.js";

const USAGE = `Usage:
  kit check <url> --token-file <file> [--fake] [--canary-file <file>] [--fixtures <file>] [options]
  kit dev   <url> --token-file <file> [--agent <name>] [--person <email>] [--channel <name>] [options]

Connection options:
  --token-file <file>        File holding the connection token (preferred)
  --token-env <VAR>          Environment variable holding the token
  --auth-header <name>       Header carrying the token (default Authorization, sent as "Bearer <token>")
  --header "<Name: value>"   Extra non-secret header the admin configured (repeatable)

check options:
  --fake                     Also run the checks that call tools, including write tools. Only against a server
                             on test data: a fake backend or synthetic fixture roots, never production.
  --canary-file <file>       A value that must never appear in a result: a secret the server holds (such as its
                             backend key) or content outside the allowed scope (repeatable)
  --fixtures <file>          Tool arguments to use instead of synthesized ones
  --trusts-caller-context    The server is configured to trust Boneyard-* headers; skip the forged-header check
  --max-result-bytes <n>     Result size cap (default: the contract cap)
  --json                     Print the report as JSON

dev options:
  --connection <id>          Connection id used to show agent-facing tool names (default example)
  --agent <name> --person <email> --channel <name> --trigger <interactive|routine>
  --no-context               Do not send Boneyard-* caller-context headers
  --exec "<command>"         Run a REPL command and exit (repeatable)`;

const NO_STRINGS: string[] = [];

const OPTIONS = {
  "token-file": { type: "string" },
  "token-env": { type: "string" },
  "auth-header": { type: "string", default: "Authorization" },
  header: { type: "string", multiple: true, default: NO_STRINGS },
  fake: { type: "boolean", default: false },
  "canary-file": { type: "string", multiple: true, default: NO_STRINGS },
  fixtures: { type: "string" },
  "trusts-caller-context": { type: "boolean", default: false },
  "max-result-bytes": { type: "string" },
  json: { type: "boolean", default: false },
  connection: { type: "string", default: "example" },
  agent: { type: "string", default: "Example Assistant" },
  person: { type: "string", default: "pat.example@example.com" },
  channel: { type: "string", default: "general" },
  trigger: { type: "string", default: "interactive" },
  "no-context": { type: "boolean", default: false },
  exec: { type: "string", multiple: true, default: NO_STRINGS },
  help: { type: "boolean", default: false },
} as const;

const HeaderSchema = z.string().regex(/^[A-Za-z0-9-]+:\s?.+$/u, 'Headers look like "Name: value".');

function tokenFrom(values: { readonly "token-file"?: string | undefined; readonly "token-env"?: string | undefined }): string {
  if (values["token-file"] !== undefined) return readSecretFile(values["token-file"], "Token");
  if (values["token-env"] !== undefined) {
    const value = process.env[values["token-env"]]?.trim();
    if (value === undefined || value.length === 0) throw new Error(`Environment variable ${values["token-env"]} is empty.`);
    return value;
  }
  throw new Error("Pass --token-file <file> or --token-env <VAR>.");
}

function parseHeaders(entries: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => {
      const valid = HeaderSchema.parse(entry);
      const at = valid.indexOf(":");
      return [valid.slice(0, at), valid.slice(at + 1).trim()];
    }),
  );
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  const [command, url] = positionals;
  if (values.help || command === undefined || url === undefined || positionals.length > 2) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 2;
  }
  const target: Target = createTarget({ url, token: tokenFrom(values), authHeader: values["auth-header"], extraHeaders: parseHeaders(values.header) });
  if (command === "check") {
    const report = await runChecks(target, {
      fake: values.fake,
      canaries: values["canary-file"].map((path) => readSecretFile(path, "Canary")),
      fixtures: loadFixtures(values.fixtures),
      trustsCallerContext: values["trusts-caller-context"],
      ...(values["max-result-bytes"] === undefined ? {} : { maxResultBytes: z.coerce.number().int().positive().parse(values["max-result-bytes"]) }),
    });
    process.stdout.write(`${values.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
    return passed(report) ? 0 : 1;
  }
  if (command === "dev") {
    await runDev(target, {
      connectionId: values.connection,
      agentName: values.agent,
      personEmail: values.person,
      channelName: values.channel,
      trigger: z.enum(["interactive", "routine"]).parse(values.trigger),
      sendContext: !values["no-context"],
      exec: values.exec,
    });
    return 0;
  }
  process.stdout.write(`Unknown command "${command}".\n${USAGE}\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`kit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
