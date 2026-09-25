# AQ-FMC-0.1 prereg addendum 1 (about 01:00Z, 25 Sep, before any paired output existed)

## What happened at capture
- H construction at R failed: `build_model_from_brief` refused with `model_too_large`, even after the constructor's one retry.
- So R/D1 is a genuine H construction final reply, but there is no model behind it.
- R/D2 (challenge the model) therefore has no model to challenge. It is **BLOCKED_PRECONDITION** as captured and is excluded.

## Rule for the second attempt
- **Exactly one more fresh H attempt is made at R.** It is captured as D1b.
- **If D1b builds a model** without dispatching a Run, D2 is captured on that scenario.
- **If D1b also fails,** D2 stays BLOCKED_PRECONDITION with the reason "H construction failed 2/2". There is no third attempt.

## How the development set changes
- **Development states** = every captured one of D1, D1b, D2 and D8.
- D1 and D1b are two separate H construction final replies, each scored as its own case.
- The mean development gain (rule 3) is taken over all captured development states. No state is dropped after its outputs are seen.
- Everything else in `PREREG-INTERPRETATION.md` is unchanged.
