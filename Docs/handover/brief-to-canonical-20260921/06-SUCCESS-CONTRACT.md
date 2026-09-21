# The smallest test battery that would prove the contract

Design rules carried from the estate's own hard-won doctrine:
**bind by identity, never a value predicate** · **every absence claim needs a
contrast control** · **prove each test with a discriminating mutant pair** ·
**the corpus must come from outside the author's head.**

## Tier 1 — user meaning survives (7 tests)

| # | Test | Mutant that must RED |
|---|---|---|
| T1 | Every figure literally present in the brief appears in `stated_items` with a numeric `value` | delete the digits from one span |
| T2 | £49 and £59 land on **different roles** (current vs proposed), bound by `source_quote` identity | swap the two roles |
| T3 | The option built from the user's own words carries a value for **every factor it is wired to** | strip one value → must RED (today's defect: 5 of 12) |
| T4 | No generated option shares a `(factor, value)` signature **or a semantic paraphrase** with a user-stated one | re-add the £59 twin |
| T5 | `"under 4%"` produces a **strict** bound, or an explicit `unsupported` disclosure the user sees | widen to `<=` silently → must RED |
| T6 | No intervention carries `source: brief_extraction` unless its magnitude is bound to **that factor's** span | plant `churn := 0.102` from "Cut price by 15%" |
| T7 | Churn is **not** modelled as directly set by the pricing option | add the `sets_to` link |

## Tier 2 — the model is scientifically defensible (3)

- **T8** every causal edge has a stated basis or is marked `ai_inferred`, and
  no `ai_inferred` edge carries a user-authored magnitude;
- **T9** option→factor edges terminate on factors (`factor-matcher.ts:139-141`)
  and no edge inverts a direction the user stated;
- **T10** a constraint the analysis cannot evaluate is reported as
  `constraint_unevaluated` **with a code** — today it returns `codes: []`.

## Tier 3 — usable by an ordinary person (2)

- **T11** every number on screen traces to a quote or is badged as Olumi's —
  executed at the **served** function, not the object under edit;
- **T12** the confirmation sentence restates the user's own bound
  (`"under 4%"`, not `"at most 4%"`).

## Tier 4 — generalises beyond the pricing wording (2)

- **T13** the Tier-1 battery runs over **≥5 briefs from outside the author's
  head** — the estate already has `tests/fixtures/ui-starters-2026-09-08/` and
  banked staging captures. A self-authored fixture confirms the model, it does
  not test it.
- **T14** a **perturbed equivalent**: same meaning, different wording
  ("bump the price to £59 from £49", "churn mustn't go above 4%"). Passing the
  pricing wording while failing its paraphrase is the failure mode that matters.

## The single highest-value test

**T1.** It is mechanical, it is measurable on the wire today at **0.067%**, and
every other failure in `04-MEASURED-FAILURES-AND-ROOT-CAUSES.md` becomes either
impossible or trivially detectable once it passes.
