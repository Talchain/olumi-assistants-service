# Event-branch live pilot (correction a): 4 draws, 4 provider calls, 0 retries, 0 × 429. Head 4778b9ee9e688e457d06d2b0b3fbc6b77a806e69, model gpt-5.6-terra low (served baseline). Fake registration, no store writes.

| Brief | Draws | Risk drew `occurrence` | Probability factors |
|---|---|---|---|
| Paul pricing brief, unmodified (`pilot-paul-noevent/`), no discrete event | 2 | 0/2: its only risk is a continuous "Price-change backlash" (correct) | 0 |
| The same brief + one figure-free event clause, SELF-AUTHORED (`pilot-event-run/`, see pilot-event-PROVENANCE.md) | 2 | 2/2: "Senior backend developer departure/leaves", 10–30% (basis olumi) | 0 |

Card words served by the construction disclosure:
- d1: "May happen: about 10–30% within 3 months (Olumi's estimate, based on Olumi estimate for a single critical employee leaving over an assumed three-month period before release; …)"
- d2: "May happen: about 10–30% within 12 months (Olumi's estimate, based on Reference-class estimate for annual voluntary departure risk for a single key technical employee; …)"

Residuals (for review, not fixed here):
1. d1's basis text starts "Olumi estimate…", so it reads "Olumi's estimate, based on Olumi estimate". Its basis is also a horizon assumption, not a reference class: the admission gate accepts any non-empty basis.
2. d1 horizon is 3 months (the release window), not the goal's 12. The instruction allows "or the period you mean".
3. Impact link existence is 0.8 (the user stated it as a consequence, so it's a causal hypothesis). The impact size on "months until release" is P44's sizing (not in scope).
Limit: the event brief is self-authored, so this measures whether the instruction triggers, not how users phrase risks.
