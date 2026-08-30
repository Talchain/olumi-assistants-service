/** Bounded offline compatibility probes. Never imported by prompt execution. */
import { createHash } from "node:crypto";
import {
  EXECUTABLE_RUNTIME_TASKS,
  RUNTIME_AI_TASK_AUTHORITY,
  type ExecutableRuntimeTask,
} from "../../src/config/model-routing.js";

export type ContractStatus = "PASS" | "FAIL" | "UNVERIFIED";
type FailureStage = "identity" | "participation" | "execution" | "semantic";
// Function arguments remain those of the imported implementation, not a new
// parser interface. This lets a probe call the actual seam with its own args.
type Implementation = (...args: any[]) => any;
export interface ComponentSource { readonly path: string; readonly exportName: string }
export interface Component<F extends Implementation = Implementation> {
  readonly source: ComponentSource;
  readonly implementation: F;
}
export function component<F extends Implementation>(source: ComponentSource, implementation: F): Component<F> {
  return { source, implementation };
}
export type Components = {
  readonly schema: Component;
  readonly parser: Component;
  readonly consumer: Component;
} & Readonly<Record<string, Component>>;
export type ExecutingComponents<C extends Components> = {
  [Role in keyof C]: C[Role]["implementation"];
};

/** Stored/configured identity is separate from a provider-bound observation. */
export interface ProbeIdentity {
  readonly task: ExecutableRuntimeTask;
  readonly sourceHead: string;
  readonly prompt: {
    readonly task: string | null;
    readonly id: string;
    readonly version: number | string | null;
    readonly sha256: string;
    readonly content: string;
    readonly disposition: "served" | "candidate" | "default";
  };
  readonly model?: { readonly id: string; readonly resolutionSource: string };
  readonly bound?: {
    readonly task: ExecutableRuntimeTask;
    readonly sourceHead: string;
    readonly promptSha256: string;
    readonly schemaSha256?: string | null;
    readonly model: string;
    readonly modelResolutionSource: string;
    readonly requestId: string;
  };
}
export interface ContractProbe<T, C extends Components = Components> {
  readonly id: string;
  readonly task: ExecutableRuntimeTask;
  readonly components: C;
  /** A negative contract case must explicitly expect rejection, never silently skip the consumer. */
  readonly expectation?: "accept" | "reject";
  readonly identity?: ProbeIdentity;
  readonly execute: (components: ExecutingComponents<C>) => T;
  /** Assert actual schema expressibility and consumer meaning here, not keywords. */
  readonly verify: (output: T) => void;
}
export interface SemanticProbeResult {
  readonly id: string;
  readonly task: ExecutableRuntimeTask;
  readonly status: ContractStatus;
  readonly issues: readonly string[];
  readonly failureStages: readonly FailureStage[];
  readonly participation: {
    readonly components: readonly {
      readonly role: string;
      readonly source: ComponentSource;
      readonly implementationName: string;
      readonly calls: number;
      readonly inputHashes: readonly (string | null)[];
      readonly resultHashes: readonly (string | null)[];
    }[];
    readonly identity: { readonly status: ContractStatus; readonly issues: readonly string[] };
  };
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const fullHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const fullHead = (value: string): boolean => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
function fingerprint(value: unknown): string | null {
  try { return sha256(JSON.stringify(value) ?? "undefined"); } catch { return null; }
}
const issuedResults = new WeakSet<SemanticProbeResult>();

/**
 * Execute imported implementations through tracked wrappers. Receipts prove
 * participation, not semantic correctness: matching hashes/call names NEVER
 * substitute for verify() and its independent breaking/unrelated controls.
 */
export function runContractProbe<T, C extends Components>(probe: ContractProbe<T, C>): SemanticProbeResult {
  const issues: string[] = [];
  const stages: FailureStage[] = [];
  const fail = (stage: FailureStage, message: string) => { stages.push(stage); issues.push(`${stage}: ${message}`); };
  if (!(EXECUTABLE_RUNTIME_TASKS as readonly string[]).includes(probe.task)) fail("identity", "task has no executable runtime authority");
  if (!probe.id.trim()) fail("identity", "probe id is empty");
  const records = Object.entries(probe.components).map(([role, entry]) => ({
    role, source: { ...entry.source }, implementationName: entry.implementation.name,
    calls: 0, inputHashes: [] as (string | null)[], resultHashes: [] as (string | null)[],
  }));
  const order: string[] = [];
  const executing = Object.fromEntries(Object.entries(probe.components).map(([role, entry]) => [role, (...args: unknown[]) => {
    const record = records.find((candidate) => candidate.role === role)!;
    record.calls++;
    order.push(role);
    record.inputHashes.push(fingerprint(args));
    const output: unknown = entry.implementation(...args);
    if (output && typeof (output as { then?: unknown }).then === "function") throw new Error("async component requires an explicit async probe; not silently awaited");
    record.resultHashes.push(fingerprint(output));
    return output;
  }])) as ExecutingComponents<C>;

  let output: T | undefined;
  let executed = false;
  try {
    output = probe.execute(executing);
    if (output && typeof (output as { then?: unknown }).then === "function") throw new Error("async execute is unsupported by this synchronous probe");
    executed = true;
  } catch (error) { fail("execution", error instanceof Error ? error.message : String(error)); }
  if (executed) {
    try { probe.verify(output as T); }
    catch (error) { fail("semantic", error instanceof Error ? error.message : String(error)); }
  }
  for (const role of ["schema", "parser", "consumer"]) {
    if (!records.some((record) => record.role === role)) fail("participation", `missing ${role} implementation`);
  }
  for (const record of records) {
    if (!record.source.path || !record.source.exportName) fail("participation", `${record.role} source identity is empty`);
    const mustRun = probe.expectation !== "reject" || record.role === "schema" || record.role === "parser";
    if (mustRun && record.calls === 0) fail("participation", `${record.role} did not execute`);
    if (probe.expectation === "reject" && record.role === "consumer" && record.calls !== 0) fail("participation", "rejected output reached consumer");
  }
  if (order.indexOf("schema") >= 0 && order.indexOf("parser") >= 0 && order.indexOf("schema") > order.indexOf("parser")) fail("participation", "parser ran before schema authority");
  if (order.indexOf("consumer") >= 0 && order.indexOf("consumer") < order.indexOf("parser")) fail("participation", "consumer ran before parser");

  const identityIssues: string[] = [];
  let identityStatus: ContractStatus = "UNVERIFIED";
  const identity = probe.identity;
  if (identity) {
    if (identity.task !== probe.task) identityIssues.push("identity task differs from probe task");
    if (!fullHead(identity.sourceHead)) identityIssues.push("source head is not full length");
    if (!identity.prompt.id || !fullHash(identity.prompt.sha256) || sha256(identity.prompt.content) !== identity.prompt.sha256) identityIssues.push("prompt bytes/id/full hash do not agree");
    if (Object.hasOwn(RUNTIME_AI_TASK_AUTHORITY, probe.task) && identity.prompt.task !== RUNTIME_AI_TASK_AUTHORITY[probe.task].promptTask) identityIssues.push("prompt task differs from runtime authority");
    if (identity.bound) {
      const bound = identity.bound;
      if (bound.task !== probe.task || bound.sourceHead !== identity.sourceHead || bound.promptSha256 !== identity.prompt.sha256) identityIssues.push("provider-bound task/head/prompt differs from selected identity");
      if (!bound.requestId) identityIssues.push("provider-bound request id is missing");
      if (!identity.model || !bound.model || !bound.modelResolutionSource || bound.model !== identity.model.id || bound.modelResolutionSource !== identity.model.resolutionSource) identityIssues.push("provider-bound model differs from configured model evidence");
      if (bound.schemaSha256 !== undefined && bound.schemaSha256 !== null) {
        const schemaHashes = records.find((record) => record.role === "schema")?.resultHashes ?? [];
        if (!fullHash(bound.schemaSha256) || !schemaHashes.includes(bound.schemaSha256)) identityIssues.push("provider-bound grammar did not participate");
      }
      identityStatus = identityIssues.length ? "FAIL" : "PASS";
    }
    if (identityIssues.length) {
      identityStatus = "FAIL";
      for (const issue of identityIssues) fail("identity", issue);
    } else if (!identity.bound) identityIssues.push("stored/configured identity has no provider-bound observation");
  } else identityIssues.push("no runtime identity supplied; deterministic proof is not a served-route witness");

  const result: SemanticProbeResult = Object.freeze({
    id: probe.id, task: probe.task, status: issues.length ? "FAIL" : "PASS",
    issues: Object.freeze(issues), failureStages: Object.freeze(stages),
    participation: Object.freeze({
      components: Object.freeze(records.map((record) => Object.freeze({ ...record, inputHashes: Object.freeze(record.inputHashes), resultHashes: Object.freeze(record.resultHashes) }))),
      identity: Object.freeze({ status: identityStatus, issues: Object.freeze(identityIssues) }),
    }),
  });
  issuedResults.add(result);
  return result;
}

export interface MutationCase {
  readonly id: string;
  readonly kind: "baseline" | "semantic_break" | "unrelated";
  readonly run: () => SemanticProbeResult;
}
export interface MutationFamilyResult {
  readonly id: string;
  readonly status: ContractStatus;
  readonly issues: readonly string[];
  readonly cases: readonly { readonly id: string; readonly kind: MutationCase["kind"]; readonly result: SemanticProbeResult }[];
}
export function assertExactCaseIds(expected: readonly string[], actual: readonly string[]): void {
  if (!expected.length || expected.some((id) => !id.trim()) || new Set(expected).size !== expected.length) throw new Error("expected case ids must be nonempty and unique");
  if (new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error("expected cases were not collected exactly once");
}
/** A parser bypass or dead verifier cannot survive the opposite controls. */
export function runSemanticMutationFamily(input: { readonly id: string; readonly expectedCaseIds: readonly string[]; readonly cases: readonly MutationCase[] }): MutationFamilyResult {
  const issues: string[] = [];
  try { assertExactCaseIds(input.expectedCaseIds, input.cases.map((entry) => entry.id)); }
  catch (error) { issues.push((error as Error).message); }
  for (const kind of ["baseline", "semantic_break", "unrelated"] as const) {
    const count = input.cases.filter((entry) => entry.kind === kind).length;
    if (!count || (kind === "baseline" && count !== 1)) issues.push(`requires ${kind === "baseline" ? "exactly one" : "at least one"} ${kind} case`);
  }
  const cases: MutationFamilyResult["cases"][number][] = [];
  for (const entry of input.cases) {
    try {
      const result = entry.run();
      if (!issuedResults.has(result)) { issues.push(`${entry.id}: result was not produced by executable probe runner`); continue; }
      cases.push({ id: entry.id, kind: entry.kind, result });
      const expected = entry.kind === "semantic_break" ? "FAIL" : "PASS";
      if (result.status !== expected) issues.push(`${entry.id}: expected ${expected}, got ${result.status}`);
      if (entry.kind === "semantic_break" && !result.failureStages.some((stage) => stage === "semantic" || stage === "execution")) issues.push(`${entry.id}: identity/participation failure alone is not a semantic-loss control`);
    } catch (error) { issues.push(`${entry.id}: case did not return evidence: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (new Set(cases.map((entry) => entry.result.task)).size > 1) issues.push("mutation arms did not exercise the same runtime task");
  if (new Set(cases.map((entry) => entry.result.id)).size > 1) issues.push("mutation arms did not exercise the same contract probe");
  return { id: input.id, status: issues.length ? "FAIL" : "PASS", issues, cases };
}

/** FQ supplies these real exports after adding its task to runtime authority.
 * This interface registers nothing and mirrors no shared quantity semantics. */
export interface FactorQuantificationRegistration<SharedQuantityContract> {
  readonly task: ExecutableRuntimeTask;
  readonly sourceHead: string;
  readonly components: Components;
  readonly sharedQuantityContract: { readonly source: ComponentSource; readonly definition: SharedQuantityContract };
  readonly fixtureIds: readonly string[];
}
