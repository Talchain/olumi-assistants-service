# A2e — PR #2982 working-tree handback

Base: `5af724f693d99be090da16f470b59615a8b2dbed`; no commit created.

Applied the nine AIE replacements exactly once, verified against parsed provider tool definitions. Optional months and deadline_date shapes, months 0–60, and deadline_words maxLength 80 are unchanged. Full rationale is kept in proposal provenance and displayed on the deadline card.

Verified typed history comes from the existing route-bound user_text (chips, assistant text and unknown restored history excluded). Existing held quantity records are read with readUserTodayMember; exact quantity label, value and unit are matched, with the range preserved even when later tool args omit it. Matching unverifiable retained origins are refused explicitly rather than relabelled. Approval, permission, units, current-revision and writer paths are unchanged.

Reference arguments override the draft reference only when bound to the current user’s explicit as-of date. A deliberate new reference is displayed on the existing whole card and written only after its approval. Arbitrary Agent dates cannot displace the known reference.

## Exact UTF-8 field deltas

| Field | Before | After | Delta |
|---|---:|---:|---:|
| `propose_hiring_times/description` | 432 | 610 | +178 |
| `propose_hiring_times/parameters/properties/options/items/properties/starts/items/properties/months` | 147 | 272 | +125 |
| `propose_goal_deadline/description` | 379 | 700 | +321 |
| `propose_goal_deadline/parameters/properties/reference_date/description` | 79 | 252 | +173 |
| `propose_goal_deadline/parameters/properties/deadline_words/description` | 34 | 264 | +230 |
| `propose_goal_deadline/parameters/properties/rationale/description` | 45 | 261 | +216 |
| `propose_goal_deadline/parameters/properties/deadline_date` | 121 | 218 | +97 |
| `propose_new_factor/description` | 320 | 651 | +331 |
| `propose_new_factor/parameters/properties/factors/items/properties/unit/description` | 79 | 177 | +98 |

Total: **+1,769 UTF-8 bytes** (compact JSON for object replacements; UTF-8 strings for description replacements).

## Pins

Every complete before/after provider request was compared after substituting only the nine exact AIE fields. All other fields, including prompt instructions, schema, settings, state, inputs and output, were equal. Five of nine parity request pins changed; four remained byte-identical. SYS1 changed only tools and enclosing body hashes. No instruction hash changed.

| Request | Before SHA-256 | After SHA-256 | Bytes |
|---|---|---|---:|
| chip-converse/run2/1.sentBody.json | `20bcc64daaa561dc5fb6bb7b70091dab65111536da9901a37c41ce7d5fb1fc92` | `4536de41d08aa695980aa3c966f89562523ad63d7bc62f83c421ad845bf34676` | +1767 |
| ordinary-converse/run2/1.sentBody.json | `09ab663b54261c16659548cc1a9dfa9f6565f06dc3de6c565366e6da7a7fef1b` | `a70d5f20f1195ec79eff159654d09995d1c53beb3a669e988212ed5218aa2844` | +1767 |
| selected-converse/run2/1.sentBody.json | `5a4685c4e290bad7d1cc57b504eef7e006c5737a19fe8aef4840bd44622da3e5` | `0227a9750613d0580d114de482bbcec2665ad73277d11bde4539e582a6e0002d` | +1767 |
| tool-continuation/run2/1.sentBody.json | `09ab663b54261c16659548cc1a9dfa9f6565f06dc3de6c565366e6da7a7fef1b` | `a70d5f20f1195ec79eff159654d09995d1c53beb3a669e988212ed5218aa2844` | +1767 |
| tool-continuation/run2/2.sentBody.json | `76f374e4632967e819b9faf0bb12444b20e2e5594363ac26edf251c6024afdb9` | `07abccc4b77709a54d361716d269b4aee90f053882d52ae9d31b437f2b358a6f` | +1767 |

SYS1 tools: `356b3df46b8a70736d752521600b892f07efcd764516c752c73568260ea6b4f0` → `f0f4fb0895b416587fc1ad54c8c0e14c372f7e98a3c4344d87a5cbfb4036ec4b`.
SYS1 body: `3c2757824ea1e0ca6deca25fea4185f7c8ae11163cff31783b9a72c939e295ab` → `7a67aefc183f87a22e748ea0c37db56a9ac58930a11ca5f02c2166b8a06b9012` (+1767 bytes).

## Validation

Real installed Vitest, each file run separately with `npx vitest run <file>`. All runs offline; no whole suite. Final tests: **303 passed, 0 failed** across seven named files.

Assumptions: verified source means the existing host typed-history or validated held quantity record; a reference override requires explicit user as-of wording. Unsupported/unknown retained source is surfaced rather than guessed. These local fixture witnesses are not staging or fresh-user acceptance.

| Spec | Final result |
|---|---|
| `agent-add-factor-door-seam.test.ts` | 48 passed (48) |
| `time-close-chain.test.ts` | 46 passed (46) |
| `deadline-card-chain.test.ts` | 70 passed (70) |
| `e5-hiring-times.test.ts` | 32 passed (32) |
| `e5-hiring-times-door.test.ts` | 20 passed (20) |
| `run-explanation-turn-parity.test.ts` | 8 passed (8) |
| `sys1-turn-authority.test.ts` | 79 passed (79) |

## Mutants

All five killed; each produced exactly one targeted failure; production source restored after each.

| Mutant | Result |
|---|---|
| current-turn-only | 1 failed | 47 passed (48) |
| drop-retained-range | 1 failed | 47 passed (48) |
| relabel-unknown | 1 failed | 47 passed (48) |
| agent-reference-override | 1 failed | 45 passed (46) |
| truncate-card-source | 1 failed | 69 passed (70) |

The first factor run found a missing GraphV3 test import (fixed). Golden parity failures were the anticipated nine-field tool-byte changes, verified before re-pinning. Showing full rationale also required updating three existing time-card assertions (five parameterised rows); deadline/reference values and write expectations remain strict.
