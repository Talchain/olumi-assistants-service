# Confidence-boundary bisect + v42.2h validation (2026-07-09)

**Instrument:** journey-bisect (9 turns: state-build + T10 + the confidence probes T19/P23 + P25), Sonnet-5-serving, local server + file store, code-matched **8cf918a8d** (= my served-v42.2g baseline tip; the confidence-boundary postcheck module is unchanged vs the current served tip afed7a16, and afed7a16 couldn't boot locally due to a new `dotenv@17` dep the shared node_modules lacked). On-wire prompt confirmed per arm.

## Bisect: the concision/countable-caps edit is CONVICTED

Single isolated edit — **v42.2g-caps = v42.2g + only the countable-caps concision swap** ("cap at three insight bullets… skip non-essential context" replacing "under about 130 words"), hash b0415b6cd5c9edae, served on-wire (39+ routing calls).

| Arm | confidence-boundary postcheck degrades | T19 |
|---|---|---|
| **served v42.2g** (no concision edit) | **0** | grounded, 218w (validation run) |
| **v42.2g-caps** (+ concision only) | **1** (`unsupported_evidence_or_confidence_claim`) | **DEGRADED → "not safe to show" stub** |

Adding *only* the concision edit flips 0 → 1 degrade and reproduces the exact round-1 T19 failure. **Mechanism confirmed:** "skip non-essential context" starves the specific modelled figure the postcheck requires on a decline, so the refusal reads as unsupported and is suppressed. (n=1; P23 stayed grounded this run — the degrade is stochastic under the tight budget, but the single isolated edit clearly contributes, matching round 1 where S5-A/S5-B degraded both T19+P23.)

## v42.2h (grounding-preserving concision): VALIDATED — fixes it

**v42.2h = v42.2g-caps + the confidence-boundary rule strengthened** so the grounding figure is mandatory even under the cap (line 169): *"Asked to confirm a choice or agree the user is right: cite the specific modelled figure that grounds your answer (win share, target-fit or margin), required even under the cap, then name the one check that would settle it."* 21,986 chars (headroom 14), hash cc49920d1e30f462, served on-wire (9/9 calls).

| metric | v42.2g-caps | **v42.2h** |
|---|---|---|
| confidence-boundary degrades | 1 | **0** |
| T19 | stub | **grounded, 225w — "…leads in 97% of simulations versus 2%…"** |
| P23 | grounded | **grounded, 227w — cites 97% vs 2%** |
| T10 | — | grounded, 216w, cites the figure |
| concision retained (P25) | — | **97w** (tight, with the figure) |
| floor (forbidden / mutation-lang / narrow-D5 / empty) | — | **0 / 0 / 0 / 0** |

The grounding clause does exactly what the bisect predicted: T19/P23/T10 now **explicitly cite the specific figure (97% vs 2%)** on the decline — the thing the concision cap was starving — so the postcheck passes, while the countable-caps concision is kept.

**One honest floor note:** 1 `success_claim_hit` on **T04** ("Added constraint: Success target…") — a set-target turn. It appears in **v42.2g-caps too** (same journey), so it is **not a v42.2h regression**, and it is unrelated to the grounding change; likely a legitimate post-handler receipt that `findSuccessClaimHit` flags. Flag for a separate look, does not block the bisect/v42.2h conclusion.

## Verdict
- **Bisect:** the concision edit caused the S5-A/S5-B confidence-boundary regression. Convicted.
- **v42.2h:** grounding-preserving concision **eliminates the degrade (1→0) while keeping the tighter caps** and citing the grounding figure. Provably safe on this run; n=1 caveat — a larger confidence-probe sample would harden it before upload.
- **Not uploaded — Paul-gated.** v42.2h is the next-round candidate if the orchestrator opens the slot (v42.2g is the served baseline; single change per round).

Artifacts: `candidates/build-v42.2h.py` → `v42.2h.txt` + `stores/armV422h.json` (v123). All harness scenarios deleted + verified stayed-gone.
