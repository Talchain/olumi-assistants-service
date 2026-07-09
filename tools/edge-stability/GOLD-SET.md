# Edge-Stability gold set

The locked set of briefs the harness runs. Changes require explicit review and a version bump
with rationale (a regression harness is only meaningful against a stable corpus). Seeds for every
version: `17, 42, 101, 2024, 7` (5 independent draws per brief).

## v1 (2026-07-09) — 22 briefs, LOCKED

The 6 original briefs + 16 authored across previously-absent domains (manufacturing/ops,
healthcare/life-sciences, retail/e-commerce, corporate finance/treasury) and decision structures.
The original set was all binary software/SaaS decisions; v1 injects 3- and 4-option decisions and
non-tech domains so the parameter-lottery measurement generalises beyond one archetype.

| id | source | domain | decision type | options | numeric density |
|---|---|---|---|---|---|
| buy-vs-build | existing-v0 | software/SaaS | make-vs-buy | 2 | med |
| expand-vs-focus | existing-v0 | software/SaaS | market-entry | 2 | med |
| f10 | existing-v0 | software/SaaS | market-entry | 2 | med |
| hire-vs-contract | existing-v0 | software/SaaS | resource-allocation | 2 | med |
| migrate-vs-stay | existing-v0 | software/SaaS | make-vs-buy | 2 | med |
| technical-debt | existing-v0 | software/SaaS | resource-allocation | 2 | med |
| warehouse-automation-vs-labour | gold-set-v1 | manufacturing / ops | make-vs-buy | 2 | high |
| single-vs-dual-vs-regional-supplier | gold-set-v1 | manufacturing / ops | vendor-selection | 3 | med |
| preventive-vs-predictive-maintenance | gold-set-v1 | manufacturing / ops | investment | 2 | med |
| telehealth-rollout-vendor-vs-build-vs-hybrid | gold-set-v1 | healthcare / care delivery | market-entry | 3 | med |
| phase2-trial-academic-vs-community-sites | gold-set-v1 | life-sciences / clinical | site-selection | 2 | low |
| surgical-robot-buy-lease-refurb-vs-manual | gold-set-v1 | healthcare / capital | investment | 4 | high |
| fulfillment-inhouse-vs-3pl-vs-hybrid | gold-set-v1 | retail / e-commerce | make-vs-buy | 3 | high |
| flagship-stores-vs-online-only | gold-set-v1 | retail / e-commerce | market-entry | 2 | low |
| discount-strategy-reset | gold-set-v1 | retail / e-commerce | pricing | 4 | med |
| refinance-fixed-vs-floating-vs-convertible | gold-set-v1 | corporate finance | refinancing | 3 | high |
| excess-cash-allocation-4way | gold-set-v1 | capital allocation | capital-allocation | 4 | med |
| fx-hedge-forwards-vs-options-vs-unhedged | gold-set-v1 | treasury / risk | hedging | 3 | med |
| plg-vs-sales-led-vs-hybrid-gtm | gold-set-v1 | people / GTM | market-entry | 3 | high |
| sales-comp-restructure-retention | gold-set-v1 | people / GTM | resource-allocation | 2 | low |
| single-tenant-vs-multi-tenant-tiering | gold-set-v1 | platform architecture | capacity | 4 | med |
| freemium-vs-trial-vs-paid | gold-set-v1 | SaaS pricing | pricing | 3 | high |

**Coverage:** 6 domains; option-count 5×2-way / 7×3-way / 4×4-way (existing were all binary);
numeric density 6 high / 7 med / 3 low. Decision types span make-vs-buy, market-entry,
resource-allocation, pricing, vendor-selection, investment, capital-allocation, hedging, capacity,
site-selection, refinancing.

**Validation status (aligned v0.4.3, seed 17):** ✅ 16/16 new briefs produce valid drafts, 16/16
carry per-option `data.interventions`, 0 invalid. 11/16 drafted the author-suggested option count
(the other 5 are the model's own reasonable option choices — the suggested count is advisory, not
a constraint). The 6 originals were already validated. The 22-brief set is analysable end-to-end.

**Authoring provenance:** the 16 additions were drafted by a 6-way domain-cluster workflow
(`wf_17ec298c-bd1`, 24 candidates) then curated/deduped to 16 (rejected 8 redundant archetypes).
LLM-authored benchmark fixtures — reviewed for realism + distinctness; never product data.

## Planned v2
Grow toward broader length/complexity variance and add briefs that deliberately stress the
harness (near-tie options, dominated options, missing-baseline). Each addition lands here with
id, why-added, date. Growth staged so per-run cost scales deliberately (each brief = 5 draft calls
+ 5 PLoT runs per harness run).

## Change log
- **v1 (2026-07-09):** 6 → 22 briefs (+16 across manufacturing/healthcare/retail/finance/GTM/
  platform; 3- and 4-option decisions added). Locked.
- **v0 (2026-07-09):** initial lock — the 6 bakeoff golden briefs.
