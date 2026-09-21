/**
 * Rich Decision Model → GraphV3-shaped analysis projection.
 *
 * THE HYPOTHESIS THIS FILE EXISTS TO DISPROVE (PLAN-v2 amendment 2 + principle 1):
 *   "Everything the numerical engine cannot carry can be omitted EXPLICITLY, with
 *    its reason recorded, and nothing user-authored is laundered or invented on
 *    the way through."
 * The cheapest disproof is a mutant: delete the provenance switch's throw and an
 * item of unknown provenance silently acquires user authority — the exact
 * `schema-v3.ts:457` fail-open shape. The test asserts that mutant is RED.
 *
 * THREE RULES THAT ARE NOT NEGOTIABLE HERE:
 *  1. The projection CREATES NO NUMBER. A null stays absent; it never becomes 0.
 *  2. Provenance is never defaulted. `projectProvenance` throws on anything it
 *     does not recognise.
 *  3. Anything dropped is REPORTED with a reason. Silence is the failure mode.
 */

import { createHash } from "node:crypto";
import type {
  ProjectedEdge,
  ProjectedGoalConstraint,
  ProjectedGraph,
  ProjectedIntervention,
  ProjectedNode,
  ProjectionDisclosure,
  ProjectionOmission,
  ProjectionReport,
  RichCausalLink,
  RichDecisionModel,
  RichFactor,
  RichUserFact,
} from "./rich-model.js";

/** Thrown when an item's provenance cannot be projected. NEVER caught internally. */
export class ProvenanceUnknownError extends Error {
  readonly itemId: string;
  readonly rawProvenance: unknown;
  constructor(itemId: string, rawProvenance: unknown) {
    super(
      `[rich-to-graph] Cannot project item '${itemId}': provenance ${JSON.stringify(
        rawProvenance,
      )} is not one of user | ai_proposed | ai_hypothesis. Refusing to default — an absent or ` +
        "unknown provenance must never become user authority.",
    );
    this.name = "ProvenanceUnknownError";
    this.itemId = itemId;
    this.rawProvenance = rawProvenance;
  }
}

/**
 * THE PROVENANCE SWITCH. Removing the `default: throw` is the H5 mutant.
 *
 * user          → from_brief    (user authority, carried as such)
 * ai_proposed   → ai_inferred
 * ai_hypothesis → ai_inferred
 * anything else → THROW
 */
export function projectProvenance(
  itemId: string,
  provenance: unknown,
): "from_brief" | "ai_inferred" {
  switch (provenance) {
    case "user":
      return "from_brief";
    case "ai_proposed":
    case "ai_hypothesis":
      return "ai_inferred";
    default:
      throw new ProvenanceUnknownError(itemId, provenance);
  }
}

/** Intervention source, derived from the SAME evidence as node provenance. */
export function projectInterventionSource(
  itemId: string,
  epistemicState: string,
  sourceFactId: string | null,
): ProjectedIntervention["source"] {
  switch (epistemicState) {
    case "known":
    case "observed":
    case "user_estimate":
      if (sourceFactId == null) {
        throw new ProvenanceUnknownError(
          itemId,
          `epistemic_state '${epistemicState}' with source_fact_id null`,
        );
      }
      return "brief_extraction";
    case "external_evidence":
    case "ai_hypothesis":
    case "unknown":
      return "cee_hypothesis";
    default:
      throw new ProvenanceUnknownError(itemId, epistemicState);
  }
}

/** Stable 8-hex node id. Collisions THROW rather than silently merge two nodes. */
export function sha8(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8);
}

interface IdMapper {
  (richId: string): string;
}

function buildIdMapper(model: RichDecisionModel): IdMapper {
  const seen = new Map<string, string>();
  const allIds = [
    ...model.user_facts.map((f) => f.id),
    ...model.options.map((o) => o.id),
    ...model.factors.map((f) => f.id),
    ...model.outcomes.map((o) => o.id),
    ...model.constraints.map((c) => c.id),
    ...model.causal_links.map((l) => l.id),
  ];
  for (const id of allIds) {
    const hashed = sha8(id);
    const existing = seen.get(hashed);
    if (existing != null && existing !== id) {
      throw new Error(
        `[rich-to-graph] sha8 collision: '${id}' and '${existing}' both hash to '${hashed}'. ` +
          "Refusing to project — two distinct items would become one node.",
      );
    }
    seen.set(hashed, id);
  }
  return (richId: string) => sha8(richId);
}

function targetFact(model: RichDecisionModel): RichUserFact | undefined {
  return model.user_facts.find((f) => f.role === "target" && f.value != null);
}

function factorCategory(control: RichFactor["control"]): "controllable" | "observable" | "external" {
  switch (control) {
    case "lever":
      return "controllable";
    case "observable":
      return "observable";
    case "external":
      return "external";
    default: {
      const never: never = control;
      throw new Error(`[rich-to-graph] unknown control kind ${JSON.stringify(never)}`);
    }
  }
}

function hasTemporalContent(link: RichCausalLink): boolean {
  const t = link.temporal;
  return (
    t.delay != null || t.duration != null || t.note != null || (t.persistence !== "unknown")
  );
}

export interface RichToGraphResult {
  graph: ProjectedGraph;
  report: ProjectionReport;
}

export function richToParsedGraph(model: RichDecisionModel): RichToGraphResult {
  const mapId = buildIdMapper(model);
  const nodes: ProjectedNode[] = [];
  const edges: ProjectedEdge[] = [];
  const goalConstraints: ProjectedGoalConstraint[] = [];
  const included: string[] = [];
  const omitted: ProjectionOmission[] = [];
  const disclosures: ProjectionDisclosure[] = [];

  // --- goal -----------------------------------------------------------------
  const target = targetFact(model);
  if (target != null) {
    const goalNode: ProjectedNode = {
      id: mapId("goal"),
      rich_id: "goal",
      kind: "goal",
      label: model.decision.question,
      provenance: "from_brief",
      goal_threshold: target.value as number,
      goal_threshold_raw: target.value as number,
      ...(target.unit != null ? { goal_threshold_unit: target.unit } : {}),
      data: {
        ...(model.decision.horizon.value != null
          ? {
              horizon_value: model.decision.horizon.value,
              horizon_unit: model.decision.horizon.unit,
            }
          : {}),
        source_fact_id: target.id,
      },
    };
    nodes.push(goalNode);
    included.push("goal");
  } else {
    omitted.push({
      id: "goal",
      reason: "no_value",
      detail:
        "no user fact with role 'target' carries a value — no goal threshold is projected (never invented)",
    });
  }

  if (model.decision.horizon.value == null) {
    omitted.push({
      id: "decision.horizon",
      reason: "no_value",
      detail: "horizon has no stated value; nothing is projected for it",
    });
  }

  // --- decision -------------------------------------------------------------
  nodes.push({
    id: mapId("decision"),
    rich_id: "decision",
    kind: "decision",
    label: model.decision.question,
    provenance: "from_brief",
  });
  included.push("decision");

  // --- factors ---------------------------------------------------------------
  for (const factor of model.factors) {
    const provenance = projectProvenance(factor.id, factor.provenance);
    if (factor.measurability === "qualitative") {
      omitted.push({
        id: factor.id,
        reason: "qualitative",
        detail: `factor '${factor.label}' is qualitative; the numerical target carries no qualitative factor — kept in the rich model only`,
      });
      continue;
    }
    const data: ProjectedNode["data"] = {};
    if (factor.current_value != null) {
      data.value = factor.current_value;
      data.raw_value = factor.current_value;
      if (factor.unit != null) data.unit = factor.unit;
      data.extractionType = provenance === "from_brief" ? "brief_extraction" : "cee_hypothesis";
    } else {
      omitted.push({
        id: factor.id,
        reason: "no_value",
        detail: `factor '${factor.label}' is projected as a node but carries NO current_value (null stays absent; never 0)`,
      });
    }
    nodes.push({
      id: mapId(factor.id),
      rich_id: factor.id,
      kind: "factor",
      label: factor.label,
      category: factorCategory(factor.control),
      provenance,
      ...(Object.keys(data).length > 0 ? { data } : {}),
    });
    included.push(factor.id);
  }

  // --- outcomes and risks -----------------------------------------------------
  for (const outcome of model.outcomes) {
    const provenance = projectProvenance(outcome.id, outcome.provenance);
    if (outcome.measurability === "qualitative") {
      omitted.push({
        id: outcome.id,
        reason: "qualitative",
        detail: `${outcome.kind} '${outcome.label}' is qualitative; kept in the rich model only`,
      });
      continue;
    }
    nodes.push({
      id: mapId(outcome.id),
      rich_id: outcome.id,
      kind: outcome.kind === "risk" ? "risk" : "outcome",
      label: outcome.label,
      provenance,
      data: { better_direction: outcome.better_direction },
    });
    included.push(outcome.id);
  }

  // --- options ----------------------------------------------------------------
  const projectedFactorIds = new Set(
    model.factors.filter((f) => f.measurability !== "qualitative").map((f) => f.id),
  );
  for (const option of model.options) {
    const provenance = projectProvenance(option.id, option.provenance);
    const interventions: Record<string, ProjectedIntervention> = {};
    for (const lever of option.lever_settings) {
      if (!projectedFactorIds.has(lever.factor_id)) {
        omitted.push({
          id: `${option.id}.lever_settings[${lever.factor_id}]`,
          reason: "qualitative",
          detail: `lever targets factor '${lever.factor_id}', which is not projected (qualitative or absent)`,
        });
        continue;
      }
      const source = projectInterventionSource(
        `${option.id}.lever_settings[${lever.factor_id}]`,
        lever.epistemic_state,
        lever.source_fact_id,
      );
      if (lever.value == null) {
        omitted.push({
          id: `${option.id}.lever_settings[${lever.factor_id}]`,
          reason: "no_value",
          detail: "lever setting has no value; no intervention magnitude is projected (never 0)",
        });
      }
      interventions[mapId(lever.factor_id)] = {
        value: lever.value,
        source,
        ...(lever.unit != null ? { unit: lever.unit } : {}),
        source_fact_id: lever.source_fact_id,
      };
    }
    nodes.push({
      id: mapId(option.id),
      rich_id: option.id,
      kind: "option",
      label: option.label,
      provenance,
      data: {
        is_status_quo: option.is_status_quo,
        ...(Object.keys(interventions).length > 0 ? { interventions } : {}),
      },
    });
    included.push(option.id);
  }

  // --- causal links -----------------------------------------------------------
  const projectedNodeRichIds = new Set(nodes.map((n) => n.rich_id));
  for (const link of model.causal_links) {
    const provenance = projectProvenance(link.id, link.provenance);
    if (!projectedNodeRichIds.has(link.from_id) || !projectedNodeRichIds.has(link.to_id)) {
      omitted.push({
        id: link.id,
        reason: "qualitative",
        detail: `link ${link.from_id}→${link.to_id} touches an endpoint that is not projected (qualitative or absent)`,
      });
      continue;
    }

    const magnitudeUnknown = link.magnitude.kind === "unknown" || link.magnitude.value == null;
    const sign = link.effect === "negative" ? -1 : 1;
    const mean = magnitudeUnknown ? 0 : sign * Math.abs(link.magnitude.value as number);

    if (magnitudeUnknown) {
      omitted.push({
        id: link.id,
        reason: "unknown_magnitude",
        detail:
          `magnitude.kind='${link.magnitude.kind}' — strength.mean 0 and exists_probability 0.5 are ` +
          "PLACEHOLDERS, flagged magnitude_placeholder:true. mean 0 means 'no measured magnitude', " +
          "NOT 'no effect'. THE SCORER MUST NOT REWARD THIS EDGE.",
      });
    }
    if (hasTemporalContent(link)) {
      omitted.push({
        id: link.id,
        reason: "temporal",
        detail: `temporal semantics ${JSON.stringify(
          link.temporal,
        )} have no representation in the GraphV3 edge; kept in the rich model only`,
      });
    }

    const edge: ProjectedEdge = {
      from: mapId(link.from_id),
      to: mapId(link.to_id),
      rich_id: link.id,
      provenance,
      strength: { mean, std: 0 },
      exists_probability: magnitudeUnknown ? 0.5 : 0.9,
      ...(link.effect !== "unknown" ? { effect_direction: link.effect } : {}),
      ...(magnitudeUnknown ? { magnitude_placeholder: true } : {}),
    };
    edges.push(edge);
    included.push(link.id);

    if (link.mediator_id != null && !projectedNodeRichIds.has(link.mediator_id)) {
      omitted.push({
        id: `${link.id}.mediator`,
        reason: "qualitative",
        detail: `mediator '${link.mediator_id}' is not a projected node; the mechanism is flattened`,
      });
    }
  }

  // --- constraints -------------------------------------------------------------
  for (const constraint of model.constraints) {
    const provenance = projectProvenance(constraint.id, constraint.provenance);
    if (!projectedNodeRichIds.has(constraint.subject_id)) {
      omitted.push({
        id: constraint.id,
        reason: "qualitative",
        detail: `constraint subject '${constraint.subject_id}' is not projected; the limit cannot be carried`,
      });
      continue;
    }

    let operator: string;
    let strictness: ProjectedGoalConstraint["strictness"];
    let relaxedTo: string | undefined;

    switch (constraint.operator) {
      case "<":
        operator = "<=";
        strictness = "strict";
        relaxedTo = "<=";
        break;
      case ">":
        operator = ">=";
        strictness = "strict";
        relaxedTo = ">=";
        break;
      case "<=":
      case ">=":
        operator = constraint.operator;
        strictness = "as_stated";
        break;
      case "=":
        omitted.push({
          id: constraint.id,
          reason: "strict_operator",
          detail:
            "operator '=' has no member in the GraphV3 constraint enum (>=, <=). NOT approximated — " +
            "an equality relaxed to an inequality would change what the person asked for.",
        });
        continue;
      default: {
        const never: never = constraint.operator;
        throw new Error(`[rich-to-graph] unknown operator ${JSON.stringify(never)}`);
      }
    }

    if (relaxedTo != null) {
      disclosures.push({
        constraint_id: constraint.id,
        original_operator: constraint.operator,
        projected_operator: operator,
        detail: `strict '${constraint.operator}' is unrepresentable in the GraphV3 operator enum; projected as '${operator}' and DISCLOSED (never silently relaxed)`,
      });
      omitted.push({
        id: constraint.id,
        reason: "strict_operator",
        detail: `strictness of '${constraint.operator}' is not carried by the projection; see disclosures`,
      });
    }

    goalConstraints.push({
      constraint_id: constraint.id,
      node_id: mapId(constraint.subject_id),
      operator,
      value: constraint.value,
      ...(constraint.unit != null ? { unit: constraint.unit } : {}),
      provenance,
      strictness,
      ...(relaxedTo != null ? { relaxed_to: relaxedTo } : {}),
    });
    included.push(constraint.id);
  }

  // --- unknowns are NEVER projected: they are the honest absence ---------------
  for (const unknown of model.unknowns) {
    omitted.push({
      id: unknown.id,
      reason: "no_value",
      detail: `open question "${unknown.question}" — never filled with an estimate${
        unknown.blocks_quantitative_analysis ? " (blocks quantitative analysis)" : ""
      }`,
    });
  }

  return {
    graph: { nodes, edges, goal_constraints: goalConstraints },
    report: { included, omitted, disclosures },
  };
}

/** Counts by reason, for the projection-loss table (WP6). */
export function omissionCounts(report: ProjectionReport): Record<string, number> {
  const counts: Record<string, number> = {
    qualitative: 0,
    temporal: 0,
    strict_operator: 0,
    unknown_magnitude: 0,
    no_value: 0,
  };
  for (const o of report.omitted) counts[o.reason] = (counts[o.reason] ?? 0) + 1;
  return counts;
}
