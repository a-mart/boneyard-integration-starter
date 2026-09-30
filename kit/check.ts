import { randomBytes } from "node:crypto";

import { MAX_TOOL_RESULT_BYTES } from "../contract/boneyard.js";
import { checkAuth } from "./checks/auth.js";
import { checkCanaries, checkErrorsAsResults, checkFixtureCoverage, checkResultSizes, executePlan } from "./checks/behavior.js";
import { checkAnnotations, checkCatalogSecrets, checkInputSchemas, checkMetadata, checkToolNames, discover, type Discovery } from "./checks/catalog.js";
import { checkForgedContextIgnored, checkMalformedContextTolerated } from "./checks/context.js";
import { NO_FIXTURES, type Fixtures } from "./fixtures.js";
import { result, type CheckResult, type Report } from "./report.js";
import { authHeaders, connect, type Target } from "./target.js";

export const CANARY_HEADER = "X-Kit-Canary";

export interface CheckOptions {
  readonly fake: boolean;
  readonly canaries: readonly string[];
  readonly fixtures?: Fixtures;
  readonly trustsCallerContext?: boolean;
  readonly maxResultBytes?: number;
}

const FAKE_CHECK_IDS = ["calls.fixtures", "secrets.canary", "results.size", "results.errors", "context.forged-ignored", "context.malformed"];

function skippedFakeChecks(reason: string): CheckResult[] {
  return FAKE_CHECK_IDS.map((id) => result(id, "fake", "skip", reason));
}

async function fakeChecks(target: Target, discovery: Discovery, options: CheckOptions): Promise<CheckResult[]> {
  const fixtures = options.fixtures ?? NO_FIXTURES;
  const headerCanary = `kit-canary-${randomBytes(18).toString("base64url")}`;
  const secrets = [target.token, headerCanary, ...options.canaries];
  const canaryHeaders = { [CANARY_HEADER]: headerCanary };
  const session = await connect(target, { ...authHeaders(target), ...canaryHeaders });
  const checks: CheckResult[] = [];
  try {
    const executed = await executePlan(session, discovery.tools, fixtures);
    checks.push(checkFixtureCoverage(discovery.tools, fixtures, executed));
    checks.push(checkCanaries(executed, secrets));
    checks.push(checkResultSizes(executed, options.maxResultBytes ?? MAX_TOOL_RESULT_BYTES));
    checks.push(await checkErrorsAsResults(session, discovery.tools));
  } finally {
    await session.close();
  }
  checks.push(
    options.trustsCallerContext === true
      ? result("context.forged-ignored", "fake", "skip", "The server is declared to trust caller context (--trusts-caller-context).")
      : await checkForgedContextIgnored(target, discovery.tools, fixtures, canaryHeaders),
  );
  checks.push(await checkMalformedContextTolerated(target, discovery.tools, fixtures, canaryHeaders));
  return checks;
}

export async function runChecks(target: Target, options: CheckOptions): Promise<Report> {
  const checks: CheckResult[] = [];
  const { check, discovery } = await discover(target);
  checks.push(check);
  checks.push(...(await checkAuth(target)));
  if (discovery !== null) {
    checks.push(checkToolNames(discovery.tools), checkAnnotations(discovery.tools), checkInputSchemas(discovery.tools), checkMetadata(discovery.tools));
    checks.push(checkCatalogSecrets(discovery, [target.token, ...options.canaries]));
  }
  if (!options.fake) checks.push(...skippedFakeChecks("Needs --fake: the server must run on test data (a fake backend or synthetic fixtures)."));
  else if (discovery === null) checks.push(...skippedFakeChecks("Skipped because discovery failed."));
  else checks.push(...(await fakeChecks(target, discovery, options)));
  return { target: target.url.toString(), mode: options.fake ? "fake" : "safe", checks };
}
