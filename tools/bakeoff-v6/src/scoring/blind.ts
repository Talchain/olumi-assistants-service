/**
 * Arm blinding — a TESTED guarantee, not a convention.
 *
 * buildBlindPayload() is the single chokepoint through which candidates reach
 * ANY scorer. It constructs the payload from an ALLOWLIST (never by stripping
 * a denylist): brief text + purely structural graph content + normalized open
 * questions. Arm IDs, model names, prompt names/hashes, run ids, generation
 * order, timestamps, usage, cost and proposal provenance can never appear —
 * and the leak scanner asserts they don't, using forbidden tokens derived
 * from the live run config.
 *
 * The blind_id <-> (arm, brief, seed) mapping lives ONLY in the sealed
 * presentation map, written next to the run outputs and excluded from every
 * scoring input and from the report until an explicit unblind step.
 */
import { seededShuffle } from "../util/stable.ts";
import type {
  BlindCandidate,
  BlindEdge,
  BlindGraph,
  BlindNode,
  BlindOption,
  CandidateRecord,
  RunConfig,
} from "../types.ts";

interface RawGraphLike {
  nodes?: unknown[];
  edges?: unknown[];
  options?: unknown[];
  goal_node_id?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Allowlist node projection — structural/semantic content only. */
function projectNode(raw: unknown): BlindNode | null {
  const node = asRecord(raw);
  if (typeof node.id !== "string" || typeof node.kind !== "string" || typeof node.label !== "string") return null;
  const observed = asRecord(node.observed_state);
  const out: BlindNode = { id: node.id, kind: node.kind, label: node.label };
  if (typeof node.description === "string") out.description = node.description;
  if (typeof observed.value === "number") out.value = observed.value;
  if (typeof observed.unit === "string") out.unit = observed.unit;
  if (typeof node.category === "string") out.category = node.category;
  return out;
}

function projectEdge(raw: unknown): BlindEdge | null {
  const edge = asRecord(raw);
  const strength = asRecord(edge.strength);
  if (typeof edge.from !== "string" || typeof edge.to !== "string") return null;
  return {
    from: edge.from,
    to: edge.to,
    strength_mean: typeof strength.mean === "number" ? strength.mean : 0,
    strength_std: typeof strength.std === "number" ? strength.std : 0,
    exists_probability: typeof edge.exists_probability === "number" ? edge.exists_probability : 0,
    effect_direction: typeof edge.effect_direction === "string" ? edge.effect_direction : "positive",
  };
}

function projectOption(raw: unknown): BlindOption | null {
  const option = asRecord(raw);
  if (typeof option.id !== "string" || typeof option.label !== "string") return null;
  const interventions: BlindOption["interventions"] = [];
  for (const [factorId, rawIntervention] of Object.entries(asRecord(option.interventions))) {
    const intervention = asRecord(rawIntervention);
    if (typeof intervention.value === "number") {
      interventions.push({
        factor_id: factorId,
        value: intervention.value,
        ...(typeof intervention.unit === "string" ? { unit: intervention.unit } : {}),
      });
    }
  }
  const out: BlindOption = {
    id: option.id,
    label: option.label,
    status: typeof option.status === "string" ? option.status : "unknown",
    interventions,
  };
  if (typeof option.description === "string") out.description = option.description;
  return out;
}

export function projectBlindGraph(candidate: unknown): BlindGraph {
  const raw = asRecord(candidate) as RawGraphLike;
  return {
    nodes: (raw.nodes ?? []).map(projectNode).filter((n): n is BlindNode => n !== null),
    edges: (raw.edges ?? []).map(projectEdge).filter((e): e is BlindEdge => e !== null),
    options: (raw.options ?? []).map(projectOption).filter((o): o is BlindOption => o !== null),
    goal_node_id: typeof raw.goal_node_id === "string" ? raw.goal_node_id : "",
  };
}

/** Normalized open questions: candidate user_questions + arm-C defer artifacts, identically shaped for every arm. */
export function collectOpenQuestions(record: CandidateRecord): string[] {
  const questions: string[] = [];
  const raw = asRecord(record.candidate) as RawGraphLike;
  for (const rawOption of raw.options ?? []) {
    const option = asRecord(rawOption);
    if (Array.isArray(option.user_questions)) {
      for (const q of option.user_questions) if (typeof q === "string") questions.push(q);
    }
  }
  for (const artifact of record.artifacts) {
    if (artifact.question) questions.push(artifact.question);
  }
  return questions;
}

export function buildBlindPayload(record: CandidateRecord, brief: string, blindId: string): BlindCandidate {
  return {
    blind_id: blindId,
    brief,
    graph: projectBlindGraph(record.candidate),
    open_questions: collectOpenQuestions(record),
  };
}

export interface PresentationEntry {
  blind_id: string;
  arm: string;
  brief_id: string;
  seed: number;
}

/** Seeded, deterministic blind-ID assignment. The map is SEALED run output. */
export function buildPresentationMap(
  keys: Array<{ arm: string; brief_id: string; seed: number }>,
  shuffleSeed: number
): PresentationEntry[] {
  const shuffled = seededShuffle(keys, shuffleSeed);
  return shuffled.map((key, i) => ({
    blind_id: `B${String(i + 1).padStart(3, "0")}`,
    arm: key.arm,
    brief_id: key.brief_id,
    seed: key.seed,
  }));
}

/** Forbidden tokens derived from the LIVE run config — not a static list. */
export function forbiddenTokens(config: RunConfig, promptFileNames: string[], promptHashes: string[]): string[] {
  const tokens = new Set<string>();
  for (const arm of config.arms) tokens.add(`"arm":"${arm}"`);
  tokens.add("requested_model");
  tokens.add("served_model");
  tokens.add("prompt_hash");
  tokens.add("cost_usd");
  tokens.add("run_id");
  tokens.add("iterations");
  tokens.add("evidence_pointer");
  tokens.add("proposals_raw");
  tokens.add(config.run_id);
  tokens.add(config.models.A.model);
  tokens.add(config.models.B.model);
  tokens.add(config.models.C.m1);
  tokens.add(config.models.C.m2);
  tokens.add(config.models.D.executor);
  tokens.add(config.models.D.advisor);
  for (const name of promptFileNames) tokens.add(name);
  for (const hash of promptHashes) tokens.add(hash);
  return [...tokens].filter((t) => t.length > 0);
}

export interface LeakScanResult {
  clean: boolean;
  hits: string[];
}

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Scan a serialized scoring payload for identity/provenance leaks. */
export function scanForLeaks(payload: unknown, forbidden: string[]): LeakScanResult {
  const serialized = JSON.stringify(payload);
  const hits: string[] = [];
  for (const token of forbidden) {
    if (serialized.includes(token)) hits.push(token);
  }
  if (ISO_TIMESTAMP.test(serialized)) hits.push("<iso-timestamp>");
  return { clean: hits.length === 0, hits };
}
