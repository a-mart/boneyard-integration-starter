import { randomBytes } from "node:crypto";

import { result, type CheckResult } from "../report.js";
import { authHeaders, rawPost, type RawResponse, type Target } from "../target.js";
import { containsSecret } from "./secrets.js";

type Probe = (headers: Readonly<Record<string, string>>) => Promise<RawResponse>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function forgedToken(target: Target): string {
  const random = randomBytes(Math.max(24, target.token.length)).toString("base64url").slice(0, Math.max(24, target.token.length));
  return random === target.token ? `${random}x` : random;
}

async function expectRejected(id: string, summary: string, probe: Probe, headers: Readonly<Record<string, string>>, secrets: readonly string[]): Promise<CheckResult> {
  let response: RawResponse;
  try {
    response = await probe(headers);
  } catch (error) {
    return result(id, "safe", "fail", "The request failed before the server answered.", [errorText(error)]);
  }
  if (containsSecret(response.body, secrets)) return result(id, "safe", "fail", "The rejection echoed the connection token.");
  if (response.status === 401) return result(id, "safe", "pass", summary);
  if (response.status === 403) return result(id, "safe", "warn", "Rejected with 403; the contract expects 401 for a missing or wrong token.");
  if (response.status >= 300 && response.status < 400) return result(id, "safe", "fail", `Answered with a ${response.status} redirect; Boneyard never follows redirects.`);
  return result(id, "safe", "fail", `Expected 401 but the server answered ${response.status}.`);
}

export async function checkAuth(target: Target): Promise<CheckResult[]> {
  const probe: Probe = (headers) => rawPost(target, headers);
  const valid = authHeaders(target);
  const withoutAuth = Object.fromEntries(Object.entries(valid).filter(([name]) => name.toLowerCase() !== target.authHeader.toLowerCase()));
  const wrongValue = target.authHeader.toLowerCase() === "authorization" ? `Bearer ${forgedToken(target)}` : forgedToken(target);
  const secrets = [target.token];
  const checks = [
    await expectRejected("auth.missing", "A request without the token is rejected with 401.", probe, withoutAuth, secrets),
    await expectRejected("auth.wrong", "A request with a wrong token is rejected with 401.", probe, { ...withoutAuth, [target.authHeader]: wrongValue }, secrets),
  ];
  try {
    const accepted = await probe(valid);
    if (accepted.status >= 300 && accepted.status < 400) {
      checks.push(result("auth.accepted", "safe", "fail", `The endpoint redirects (${accepted.status}); register the final URL instead.`));
    } else if (accepted.status === 401 || accepted.status === 403) {
      checks.push(result("auth.accepted", "safe", "fail", `The configured token was rejected (${accepted.status}).`));
    } else {
      checks.push(result("auth.accepted", "safe", "pass", `The configured token is accepted (HTTP ${accepted.status}).`));
    }
  } catch (error) {
    checks.push(result("auth.accepted", "safe", "fail", "The request with the token failed.", [errorText(error)]));
  }
  return checks;
}
