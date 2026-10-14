# S7 construction census corpus (8 Oct 2026)
116 recorded drafter outputs from P44's construction lab (no user data): `construct-20261006T1642Z` (80), `arm-mechanism` (9),
`p44-lab-two-risks-20261008` (18), `arm-mechanism-2842` (9). Seven briefs: B1, B3, heldout1–3, sealed, sealedR (golden/lab briefs).
Each row = `{id, brief, drafter_texts[]}`; the widening checks ("This is Olumi's own check…") are excluded. Replayed 0-LLM through
`buildModelFromBrief` with a fake dispatch by `construction-breadth-census.test.ts`.
