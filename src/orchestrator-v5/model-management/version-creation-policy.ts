/**
 * Model-version creation policy. This is a decision predicate, not a third
 * identity/hash authority: CAS/restore use full identity and freshness uses
 * the analysis-affecting hash.
 */
import { stableStringify } from "../../orchestrator/context/stable-stringify.js";
import type { GraphStateIngress } from "../boundary/request-extensions.js";
import {
  computeGraphIdentityHash,
  normaliseGraphForIdentity,
} from "../context/graph-identity.js";

export type VersionCreationDecision =
  | { readonly create: true; readonly reason: "initial" | "semantic_change" }
  | {
      readonly create: false;
      readonly reason: "no_graph" | "no_op" | "presentation_only";
    };

const PRESENTATION_KEYS = new Set([
  "position",
  "layout",
  "dimensions",
  "style",
  "viewport",
  "ui",
  "ui_state",
  "panel_state",
  "selected",
  "selection",
  "hover",
  "hovered",
  "dragging",
]);

function stripPresentation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPresentation);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRESENTATION_KEYS.has(key.toLowerCase())) continue;
    out[key] = stripPresentation(child);
  }
  return out;
}

function asIngress(value: unknown): GraphStateIngress | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.nodes) && Array.isArray(record.edges)
    ? (value as GraphStateIngress)
    : null;
}

export function decideModelVersionCreation(
  priorGraph: unknown,
  projectedGraph: unknown
): VersionCreationDecision {
  const current = asIngress(projectedGraph);
  if (current === null) return { create: false, reason: "no_graph" };
  const currentIdentity = computeGraphIdentityHash(current);
  if (currentIdentity === null) return { create: false, reason: "no_graph" };

  const prior = asIngress(priorGraph);
  if (prior === null) return { create: true, reason: "initial" };
  const priorIdentity = computeGraphIdentityHash(prior);
  if (priorIdentity?.value === currentIdentity.value) {
    return { create: false, reason: "no_op" };
  }

  const priorNormalised = normaliseGraphForIdentity(prior);
  const currentNormalised = normaliseGraphForIdentity(current);
  if (priorNormalised === null || currentNormalised === null) {
    return { create: true, reason: "semantic_change" };
  }
  const priorPolicyShape = stableStringify(
    stripPresentation(priorNormalised.graph)
  );
  const currentPolicyShape = stableStringify(
    stripPresentation(currentNormalised.graph)
  );
  return priorPolicyShape === currentPolicyShape
    ? { create: false, reason: "presentation_only" }
    : { create: true, reason: "semantic_change" };
}
