# Item 2 probe (RC 5825523678): can the served Agent lane put a starting level on a derived target?

Run by AI Quality on served `e39f6e0`, 25 Sep 2026, about 02:20Z, to take a probe off OpenAI Runtime's queue. RC: "a probe decides it, not source".

## Sequence
Both journeys use `probe-repair.sh` with an `ANSWER` override. Every turn is asserted to be OpenAI only, on exit path `agent_lane_v1`, with the served build pinned.
1. Construction.
2. Chip approval.
3. Run 1. The limit is unchecked, on a derived target.
4. **The user states the missing LEVEL or FRAME:**
   - pricing: "Monthly churn is 3% a month today; please use that as its starting level."
   - hiring: "The cap covers total payroll; our current annual salary spend is £250,000 today; please use that as its starting level."
5. If the answer turn offers `agent-approve-proposal:*`, it is clicked (approve2).
6. Run 2.

## Verdict rule
- **YES:** Run 2's `analysis_result.summary` no longer says "could not be checked", **and** the answer or approval turn made a write (`mutated: true`) on the derived target.
- **NO:** Run 2 still says "could not be checked". Record which tools the answer turn called and what it said.
- **Partial:** a proposal was made and approved, but the limit is still unchecked.

## Result 1: `{pricing,hiring}-level`, about 02:30Z. CONFOUNDED; NOT a verdict
**What happened, in both journeys:**
- The answer turn called `propose_assumptions` (`ok`) and offered "Use as starting assumptions".
- Approval: `authorise_change` returned `ok: false`, `mutated: false`, `refusal: "not_applied"`, and the user read "Not saved: none of it was applied."
- Run 2 was still unchecked.

**The confound:** both proposals were **no-ops** ("Monthly churn, 3% → 3%" and "£250,000 → £250,000"). The values I chose equalled Olumi's existing estimates. So `not_applied` may simply mean "nothing changed".
- **Rerun:** `-level2`, with values that differ from the estimates (2.4%, £310,000).

**Defect regardless of the confound:** the Agent proposed a change whose own write then refused it, which the user reads as "Not saved: none of it was applied". A proposal must pass the write's own admission.

**Source prior** (this repo's `run-analysis-unanchored-constraint-remedy.test.ts` docstring): PLoT's `resolveConstraintSampleFrameAnchor` returns null for any node with an incoming edge, *before it reads `observed_state`*. If that still holds, no level on a derived node can anchor the limit, whether or not the write lands.

## Outputs
- `e39f6e0/pricing-level/`
- `e39f6e0/hiring-level/`
- Each directory's `REPAIR-VERDICT.jsonl`.

## Result 2: `{pricing,hiring}-level2`, about 02:25Z. VERDICT: **NO** (2/2)
Served `e39f6e0` before and after every turn. `x-olumi-ai-mode: openai` on every turn.

| Journey | Answer turn | Approval | Run 2 |
|---|---|---|---|
| Pricing ("churn is 2.4% a month today") | `propose_assumptions`, then "Monthly churn 3% → 2.4% per month"; chip "Use as starting assumptions" | `authorise_change` **mutated: true**, "Saved." | **still unchecked** (`constraint_verdict_withheld`) |
| Hiring ("total payroll; £310,000 today") | `get_canonical_state` only; no proposal. "cannot store £310,000 on Annual salary spend: it is a calculated outcome" | none offered | **still unchecked** |

**Decisive row: pricing.**
- The level **landed**. `monthly_churn.observed_state` went from 0.03 (`cee_inference`) to 0.024 (`user_override`).
- The node keeps its 2 incoming links: `perceived_pro_value` and `price_resistance`.
- The re-run still could not check "Monthly churn < 4%".
- This matches PLoT source (`plot-lite-service` `src/lib/constraint-reliability.ts` `resolveConstraintSampleFrameAnchor`, staging `6d143fb`). A derived target is anchored ONLY when:
  - the goal threshold frame is `delta`, or
  - every option pins the node.
- Otherwise the function returns null before reading any value, by design (to avoid double-counting).

**So the answer to RC's item 2 is no.** Even a successful level write cannot make these limits checkable.

**Owners:**
- **PLoT:** by design; nothing to fix unless the design changes.
- **MG / constructor:**
  - It binds absolute user limits ("keep churn under 4%", "payroll under £400k") to derived nodes that PLoT can never anchor.
  - It stores "under 4%" as `<=`.
- **Runtime:**
  - The Agent lane has no tool to record a limit's frame (`delta`), or to restructure the model so the target is measured.
  - `propose_assumptions` offers level writes that cannot change the outcome.

**Also found (prompt / action truth, AI Quality's lane):** the hiring answer said "I've recorded your clarification as evidence", but the only tool it called was `get_canonical_state`, with no write. That is an unsupported save claim.

**Producer copy:** #1875 was amended to `57d02451`. The copy no longer offers "a starting level … such as its value today". It names only the delta frame or a model change, and says neither can be added from the conversation yet.
