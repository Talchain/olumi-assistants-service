# Olumi — "Draft My Model" (NL→Graph) — Product & Technical Specification v04

**Date:** 01 Nov 2025\
**Owner:** Paul Slee\
**Status:** Ready for build\
**Revision:** v0.4 (clarifier with deterministic stop rules; text‑only document grounding with citations; simplified user‑visible streaming; needle‑movers hidden unless engine debug; first‑draft ≤ 8 s p95; functional stability; cost caps and prompt caching; telemetry: draft\_source/fallback\_reason/quality\_tier)\
**Related:** Scenario Sandbox PoC, PLoT engine contracts, Assistants Service

---

## 1) Purpose and outcomes

**Purpose**\
Deliver a low‑friction copilot that turns a short plain‑English brief (plus optional documents and data) into a small, valid decision graph (by default ≤ 50 nodes, ≤ 200 edges) that users can review, understand, and run deterministically in the PLoT engine.

**User outcomes**

- Express my decision quickly (brief, optional files, optional metrics).
- Answer only necessary follow‑up questions (max 3 rounds) that genuinely improve model quality.
- Receive a legible first model with options, outcomes (and risks if enabled), beliefs, weights, and provenance.
- Understand trade‑offs via option tiles; see influential connections when the engine exposes them.
- Stay in control: I review a diff, apply with one click, and can undo.
- Trust: deterministic engine (seed and response hash), redaction by default.

**Business outcomes**

- Higher first‑session success rate to validated graph and first run.
- Faster demos and pilots using deterministic fixtures and archetype templates.
- Telemetry for continuous improvement (accept rate, first‑pass validate rate, edit distance).

**Plain‑English explainer**\
*A decision graph is a small map of your decision: boxes (nodes) and arrows (edges). Each arrow has a ****belief**** (how likely the link exists) and a ****weight**** (how strongly it pushes the outcome up or down). The engine runs many quick trials to estimate likely results and shows a spread (p10 / p50 / p90). “Deterministic” means the same inputs produce the same results every time.*

---

## 2) In scope (PoC)

- Two modes: **Quick** (instant draft) and **Guided** (clarifier with deterministic stop rules: max 3 rounds, MCQ‑first, each question includes “why we ask”).
- **Draft Diff** with Apply/Undo and **Explain Diff** (≤ 280 chars per change).
- **Option Tiles** (3–5 distinct ideas with pros/cons/evidence‑to‑gather).
- **Needle‑Movers:** **hidden** unless the engine returns `debug.influence_scores` (never assistant‑fabricated).
- **Provenance chips** and **redaction ON by default**.
- **Document grounding (text‑only):** PDF → text, TXT/MD direct, CSV → safe summaries (count/mean/p50/p90). Cap **5k characters per file**; strict citation format.
- **Assistant service**: schema validation, single repair retry, safe fallback. **Streaming** for perceived latency with **user‑visible Drafting → Complete** (fixture at 2.5 s).
- **Feature flags in API:** `clarifier_enabled`, `risks_enabled`, `actions_enabled`, `rag_enabled`, `share_review_enabled`, `shadow_canary_enabled`, `fixtures_fallback_enabled`.
- **Caps:** By default ≤ 50 nodes, ≤ 200 edges, payload ≤ 1 MB, **first draft p95 ≤ 8 s**; actual caps are auto‑discovered from `/v1/limits` at boot with config fallback.

**Out of scope (this release)**

- Auto‑apply of AI suggestions, long‑running external connectors, multi‑step planning beyond tasklets.

**Plain‑English explainer**\
*We keep graphs small so they are easy to read and explain. Citations show where a number or claim came from (a file quote, a metric, or a clear “hypothesis”).*

---

## 3) Jobs to be done (JTBD)

1. Express my decision and context quickly.
2. Fill knowledge gaps without overwhelm.
3. See a credible first model I can trust and edit.
4. Understand which levers matter.
5. Add or adjust options and evidence, then run with confidence.
6. Share for review without exposing sensitive data.

**Plain‑English explainer**\
*Each job maps to a UI moment: describe → clarify (optional) → draft → compare → run → share.*

---

## 4) User journeys (example: SaaS upgrade)

**Stage 0 — Entry**\
Brief box; optional file upload; optional metrics paste. System extracts chips: Goal, Decision, Constraints, Timeframe.

**Stage 1 — Clarify (flagged)**\
Up to **3 short questions**. Multiple‑choice first; one short free‑text only if critical. Each shows **why we ask** and how the answer will change the draft.

**Stage 2 — Draft**\
Draft Diff shows a **patch** (adds and updates) rather than a full rewrite. Small, legible scaffold: Goal → Decision → Options → Outcomes (Risks and Actions if flags enabled). Every edge with belief or weight includes provenance.

**Stage 3 — Explain and choose**\
Option Tiles (3–5) with pros, cons, and “evidence to gather”. Needle‑Movers appear only when the engine provides them. “Add to canvas” appends option nodes; edges apply after confirm.

**Stage 4 — Run and iterate**\
Option Compare (p10/p50/p90 deltas). Inspector lists belief, weight, and provenance per edge. Export Evidence Pack (redacted by default).

**First‑minute timeline**\
0–10 s: Brief and optional files → Drafting.\
≤ 2.5 s: Fixture appears if slow.\
≤ 60–90 s median: Review, apply, and first run.

**Plain‑English explainer**\
*p10 / p50 / p90 are checkpoints along the result spread: a cautious view, a middle view, and an optimistic view.*

---

## 5) UX specification

**Components**

- **Entry**: brief box, attachments, metrics paste; chips (Goal, Audience, Constraints, Timeframe).
- **Clarifier panel** (flag): MCQ‑first questions with “why we ask” and an **impact hint** (what it changes in the model). Max 3 rounds or confidence ≥ 0.8.
- **Draft Diff panel**: shows adds/updates; **Explain Diff** one‑liners per patch; Apply (atomic), Undo.
- **Option Tiles**: title, 2–3 pros, 2–3 cons, 2–3 evidence items; “Add to canvas”.
- **Needle‑Movers**: top edges by influence when engine exposes them; never assistant‑fabricated.
- **Inspector**: belief, weight, provenance; quoted doc lines for evidence.
- **Provenance chips**: Document, Metric, Hypothesis (hover reveals redacted snippet).
- **Risk badges** and **Action nodes** (flags): visible on risky edges/outcomes and simple action scaffolds.
- **Keyboard**: ⌘K command palette; ⌘/ search; arrow keys to step through diffs.

**Visual, layout, accessibility**

- Progressive disclosure; WCAG AA; focus states; motion‑reduced mode.
- Deterministic **suggested\_positions**: when absent, UI uses `meta.suggested_positions` (seeded by `default_seed`).
- Colour semantics show whether “higher is better”.

**Streaming behaviour**

- **User‑visible:** `DRAFTING → COMPLETE`. If not ready by **2.5 s**, show a fixture while drafting continues.
- **Internal stages** (brief digest, nodes, edges, clarifier, rationales) are logged for telemetry only.

**Empty / failure copy**

- **No files read**: “We could not read the files you attached. Your draft is based on your brief only.”
- **Clarifier timeout**: “Building your draft without extra questions. You can add details by editing any node.”
- **Schema repair failed**: “We could not fix this suggestion automatically. Review the highlighted items or try again.”
- **Validate returned issues**: “Some changes do not meet the model rules. We have marked them below with fixes.”
- **Engine debug unavailable**: “Needle‑Movers are hidden while the engine finishes analysis.”

**Plain‑English explainer**\
*A “diff” is just the list of proposed changes. Nothing applies until you click Apply.*

---

## 6) Assistant service (product and technical)

**Endpoints**

1. `POST /assist/draft-graph`\
   **Input** `{ brief, attachments[], constraints, flags, include_debug? }`\
   **Output** `{ graph, patch, rationales[], issues[], questions?[], layout?:{ suggested_positions }, debug?:{ needle_movers? }, clarifier_status? }`\
   **Rules**: ≤ 12 nodes and ≤ 24 edges; every node has `kind`; include `version`, `default_seed`, `meta.roots`, `meta.leaves`, and `meta.suggested_positions` (seeded). Assign **stable edge IDs** `${from}::${to}::${index}` if missing; **sort outputs** (nodes id asc; edges from/to/id asc) to stabilise diffs. Only emit **DAGs** (no cycles); **prune isolated nodes**; call engine `/v1/validate`. **One repair retry**, then return `issues[]`. **Do not fabricate needle‑movers**.

2. `POST /assist/suggest-options`\
   **Input** `{ goal, constraints?, graph_summary?, include_debug? }`\
   **Output** `{ options:[{ id, title, pros[], cons[], evidence_to_gather[] }] }`\
   **Rules**: 3–5 distinct options; no graph mutations; may emit minimal option node scaffolds as a separate patch when the user applies.

3. `POST /assist/critique-graph` (pre‑flight nudge)\
   **Input** `{ graph, include_debug? }`\
   **Output** `{ issues:[{level: BLOCKER|IMPROVEMENT|OBSERVATION, note}], suggested_fixes[] }`

4. `POST /assist/explain-diff`\
   **Input** `{ patch, context?, include_debug? }`\
   **Output** `{ rationales:[{ target, why (≤ 280 chars), provenance_source }] }`

**Streaming variant**\
`POST /assist/draft-graph/stream` emits `DRAFTING` (with optional fixture) then `COMPLETE|ERROR`.

**Document grounding (text‑only)**

- PDF → text; TXT/MD direct; CSV → safe summaries (count, mean, p50, p90).
- Cap preview at **5k characters per file**; no embeddings or external indexes.
- Strict citation format in edges and rationales: `{ source, quote (≤ 100 chars), location }`.
- Optional fuzzy verification server‑side; unverifiable quotes are **downgraded to hypothesis**.

**Template selection**

- Fast LLM classification into archetypes (SaaS upsell, Pricing change, Feature launch, Vendor selection, Hiring plan, Marketing mix), with keyword fallback.

**OpenAPI fragments (excerpt)**

```yaml
paths:
  /assist/draft-graph:
    post:
      summary: Draft a small decision graph from a brief and optional files
      responses:
        '200': { description: OK }
        '429': { description: Rate limited }
        '500': { description: Server error }
  /assist/explain-diff:
    post:
      summary: Generate brief rationales for a patch
      responses:
        '200': { description: OK }
        '500': { description: Server error }
```

**Schema (Zod‑style excerpt)**

```ts
const ProvenanceSource = z.enum(["document","metric","hypothesis","engine"]);
const NodeKind = z.enum(["goal","decision","option","outcome","risk","action"]); // risk & action are feature‑flagged
const Position = z.object({ x: z.number(), y: z.number() });
const Node = z.object({ id: z.string().min(1), kind: NodeKind, label: z.string().optional(), body: z.string().max(200).optional() });
const Edge = z.object({ id: z.string().optional(), from: z.str
```
