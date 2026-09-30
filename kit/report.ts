export type CheckScope = "safe" | "fake";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  readonly id: string;
  readonly scope: CheckScope;
  readonly status: CheckStatus;
  readonly summary: string;
  readonly details: readonly string[];
}

export interface Report {
  readonly target: string;
  readonly mode: CheckScope;
  readonly checks: readonly CheckResult[];
}

export function result(id: string, scope: CheckScope, status: CheckStatus, summary: string, details: readonly string[] = []): CheckResult {
  return { id, scope, status, summary, details };
}

export function worst(statuses: readonly CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

export function passed(report: Report): boolean {
  return !report.checks.some((check) => check.status === "fail");
}

const LABEL: Readonly<Record<CheckStatus, string>> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

export function formatReport(report: Report): string {
  const width = Math.max(...report.checks.map((check) => check.id.length), 10);
  const lines = [
    `Boneyard connection contract v1: kit check`,
    `Target: ${report.target}`,
    `Mode:   ${report.mode === "safe" ? "safe (discovery and auth only; no tool calls)" : "fake (calls every tool on test data; never point this at production)"}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`  ${LABEL[check.status]}  ${check.id.padEnd(width)}  [${check.scope}] ${check.summary}`);
    for (const detail of check.details) lines.push(`        ${" ".repeat(width)}    - ${detail}`);
  }
  const count = (status: CheckStatus): number => report.checks.filter((check) => check.status === status).length;
  lines.push("", `Result: ${passed(report) ? "PASS" : "FAIL"} (${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed, ${count("skip")} skipped)`);
  return lines.join("\n");
}
