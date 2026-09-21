# Draft Graph Pipeline Parity Benchmark

**Date:** 2026-03-15
**Raw model:** gpt-4o
**Prompt:** draft-v178.txt
**Pipeline model:** gpt-4o (via staging)
**Prompt hash (pipeline):** unavailable
**Staging endpoint:** https://cee-staging.onrender.com
**Briefs evaluated:** 14 (14 successful)

> **⚠ Important:** The unified pipeline does not support injecting a pre-parsed graph.
> Stage 1 (Parse) always calls the LLM. Therefore, the raw LLM call and the staging
> endpoint call are **two independent stochastic generations** from the same brief.
> Results include model variance, not just pipeline effect. This is a system-level
> comparison, not a controlled same-graph experiment.

---

## 1. Phase A — Same-Brief Parity (Aggregate)

| Metric | Raw LLM | Post-Pipeline | Delta |
|---|---|---|---|
| Structurally valid | 11/14 | 13/14 | +2 |
| Score ≥0.90 | 4/14 | 8/14 | +4 |
| Mean score (valid only) | 0.863 | 0.898 | +0.034 |
| Total violations | 4 | 2 | -2 |

**Classification summary:**

| Classification | Count |
|---|---|
| RESCUED | 3 |
| IMPROVED | 5 |
| NEUTRAL | 4 |
| DEGRADED | 1 |
| BROKEN | 1 |

---

## 2. Phase A — Same-Brief Parity (Per-Brief)

| Brief | Raw Valid | Raw Score | Pipeline Valid | Pipeline Score | Delta | Classification | Topology Changed | Notes |
|---|---|---|---|---|---|---|---|---|
| 01-simple-binary | ✓ | 0.910 | ✓ | 0.925 | +0.015 | NEUTRAL | Yes | — |
| 02-multi-option-constrained | ✓ | 0.870 | ✓ | 0.851 | -0.019 | NEUTRAL | Yes | — |
| 03-vague-underspecified | ✓ | 0.914 | ✓ | 0.914 | +0.000 | NEUTRAL | Yes | — |
| 04-conflicting-constraints | ✓ | 0.925 | ✓ | 0.895 | -0.030 | DEGRADED | Yes | — |
| 05-product-feature | ✗ | null | ✓ | 0.914 | n/a | RESCUED | Yes | — |
| 06-operations-warehouse | ✓ | 0.834 | ✓ | 0.910 | +0.076 | IMPROVED | Yes | — |
| 07-cloud-migration | ✓ | 0.876 | ✓ | 0.914 | +0.038 | IMPROVED | Yes | — |
| 08-channel-strategy | ✓ | 0.796 | ✓ | 0.925 | +0.129 | IMPROVED | Yes | — |
| 09-nested-subdecision | ✓ | 0.945 | ✓ | 0.945 | +0.000 | NEUTRAL | Yes | — |
| 10-many-observables | ✗ | null | ✓ | 0.851 | n/a | RESCUED | Yes | — |
| 11-feedback-loop-trap | ✓ | 0.835 | ✗ | null | n/a | BROKEN | Yes | — |
| 12-similar-options | ✓ | 0.740 | ✓ | 0.820 | +0.080 | IMPROVED | No | — |
| 13-forced-binary | ✗ | null | ✓ | 0.895 | n/a | RESCUED | Yes | — |
| 14-qualitative-strategy | ✓ | 0.850 | ✓ | 0.910 | +0.060 | IMPROVED | Yes | — |

---

## 3. Phase B — Live-System Parity (Aggregate)

> Phase B uses the same data as Phase A. Since the unified pipeline does not support
> offline graph replay, both phases are independent-sample comparisons. The tables
> above already represent the live-system comparison.

See Section 1 for aggregate metrics and Section 2 for per-brief breakdown.

---

## 4. Pipeline Stage Impact

### 01-simple-binary

| Metric | Value |
|---|---|
| Nodes added | dec_pricing, fac_subscription_price, opt_keep_price, opt_raise_price |
| Nodes removed | dec_price_increase, opt_increase, opt_status_quo, fac_price |
| Kinds changed | none |
| Edge count delta | +0 |
| Edges added | 6 |
| Edges removed | 6 |
| Repair fired | 3 repairs, 3 reclassified |
| Enrichment called | 1 |

### 02-multi-option-constrained

| Metric | Value |
|---|---|
| Nodes added | fac_market_entry, fac_regulatory_complexity, fac_team_experience, goal_revenue_growth, risk_cost_overrun, risk_operational_challenges |
| Nodes removed | fac_current_team, fac_regulatory_risk, fac_market_size, risk_operational, goal_revenue |
| Kinds changed | none |
| Edge count delta | +5 |
| Edges added | 13 |
| Edges removed | 8 |
| Repair fired | 3 repairs, 3 reclassified |
| Enrichment called | 1 |

### 03-vague-underspecified

| Metric | Value |
|---|---|
| Nodes added | fac_engineering_headcount, fac_sales_headcount, goal_optimal_hiring, out_revenue_growth, risk_budget_overrun |
| Nodes removed | fac_engineering_team_size, fac_sales_team_size, out_sales_performance, risk_financial_strain, goal_team_effectiveness |
| Kinds changed | none |
| Edge count delta | +0 |
| Edges added | 10 |
| Edges removed | 10 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 04-conflicting-constraints

| Metric | Value |
|---|---|
| Nodes added | fac_cac, fac_headcount, goal_user_growth |
| Nodes removed | fac_user_acquisition_cost, fac_enterprise_headcount, out_profit_margin, goal_users |
| Kinds changed | none |
| Edge count delta | +0 |
| Edges added | 8 |
| Edges removed | 8 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 05-product-feature

| Metric | Value |
|---|---|
| Nodes added | fac_developer_time, fac_engagement_increase, fac_user_base, goal_user_retention, out_engagement, out_fac_retention_rate_impact |
| Nodes removed | fac_personalisation, fac_development_resources, fac_user_engagement, fac_user_demand, out_user_growth, out_user_satisfaction, goal_increased_retention |
| Kinds changed | none |
| Edge count delta | -1 |
| Edges added | 11 |
| Edges removed | 12 |
| Repair fired | 3 repairs, 1→0 violations, 2 reclassified |
| Enrichment called | 1 |

### 06-operations-warehouse

| Metric | Value |
|---|---|
| Nodes added | dec_investment, fac_throughput, out_operational_efficiency |
| Nodes removed | dec_automation, fac_investment, fac_throughput_increase, out_order_quality, out_processing_speed |
| Kinds changed | none |
| Edge count delta | -3 |
| Edges added | 10 |
| Edges removed | 13 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 07-cloud-migration

| Metric | Value |
|---|---|
| Nodes added | fac_cost, goal_success, out_performance, risk_migration |
| Nodes removed | fac_provider_cost, fac_integration, fac_migration_time, out_implementation, risk_budget, risk_integration, goal_successful_migration |
| Kinds changed | none |
| Edge count delta | -6 |
| Edges added | 9 |
| Edges removed | 15 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 08-channel-strategy

| Metric | Value |
|---|---|
| Nodes added | out_profitability, risk_operational |
| Nodes removed | out_revenue_increase, out_channel_success, risk_margin_erosion, risk_high_costs |
| Kinds changed | none |
| Edge count delta | -2 |
| Edges added | 6 |
| Edges removed | 8 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 09-nested-subdecision

| Metric | Value |
|---|---|
| Nodes added | dec_delivery_strategy, fac_courier_contract, fac_emissions_standards, fac_fleet_type, goal_cost_reduction, opt_build_diesel, opt_build_electric, opt_partner_exclusive, opt_partner_non_exclusive, opt_status_quo, risk_regulatory |
| Nodes removed | dec_delivery, opt_electric_van, opt_diesel_van, opt_exclusive_courier, opt_non_exclusive_courier, fac_emissions, fac_contract_cost, fac_regulation, fac_delivery_volume, risk_delays, goal_cost_per_delivery |
| Kinds changed | none |
| Edge count delta | +3 |
| Edges added | 19 |
| Edges removed | 16 |
| Repair fired | 8 repairs, 6→0 violations, 3 reclassified, 2 pruned |
| Enrichment called | 1 |

### 10-many-observables

| Metric | Value |
|---|---|
| Nodes added | dec_delivery_model, fac_box_price, fac_delivery_schedule, fac_subscriber_base, fac_support_tickets, goal_subscriber_growth, out_revenue, risk_customer_satisfaction, risk_operational |
| Nodes removed | dec_scheduling, fac_flexible_schedule, fac_organic_tier, fac_current_subscribers, fac_order_value, fac_support_load, out_subscriber_growth, risk_churn_increase, risk_cost_increase, goal_expansion |
| Kinds changed | none |
| Edge count delta | +4 |
| Edges added | 19 |
| Edges removed | 15 |
| Repair fired | 6 repairs, 6 reclassified |
| Enrichment called | 1 |

### 11-feedback-loop-trap

| Metric | Value |
|---|---|
| Nodes added | fac_matching_quality, goal_gmv, opt_ai_matching, opt_manual_curation, opt_status_quo, out_buyer_growth, out_buyer_satisfaction, out_supplier_growth, risk_financial |
| Nodes removed | opt_ai, opt_manual, fac_match_quality, fac_buyer_satisfaction, out_gmv_growth, risk_budget_overrun, goal_gmv_target |
| Kinds changed | none |
| Edge count delta | +5 |
| Edges added | 20 |
| Edges removed | 15 |
| Repair fired | 3 repairs, LLM repair, 2→2 violations, 3 reclassified |
| Enrichment called | 1 |

### 13-forced-binary

| Metric | Value |
|---|---|
| Nodes added | dec_office_choice, fac_commute_mode, fac_office_location, fac_rent_cost, goal_collaboration_priority, risk_commute_disruption |
| Nodes removed | dec_office_selection, fac_office_space, fac_cost, fac_commute_access, fac_parking_availability, risk_difficulty_commute, goal_team_collaboration |
| Kinds changed | none |
| Edge count delta | +0 |
| Edges added | 12 |
| Edges removed | 12 |
| Repair fired | 1 repairs, 1 reclassified |
| Enrichment called | 1 |

### 14-qualitative-strategy

| Metric | Value |
|---|---|
| Nodes added | fac_market_conditions, fac_pricing_strategy, fac_prospect_loss, fac_subscription_model, goal_stability, opt_launch, opt_no_launch, risk_brand_positioning |
| Nodes removed | opt_launch_subscription, opt_status_quo, fac_revenue_stream, fac_brand_position, fac_price_sensitivity, risk_cannibalisation, risk_brand_perception, goal_recurring_stability |
| Kinds changed | none |
| Edge count delta | +0 |
| Edges added | 13 |
| Edges removed | 13 |
| Repair fired | 2 repairs, 2 reclassified |
| Enrichment called | 1 |

---

## 5. Metadata

| Brief | Source | Model | Pipeline Path | Repair Summary | Enrichment | Latency |
|---|---|---|---|---|---|---|
| 01-simple-binary | raw | gpt-4o | none (raw LLM) | n/a | n/a | 10979ms |
| 01-simple-binary | pipeline | gpt-4o | unified | 3 repairs, 3 reclassified | 1 | 14011ms |
| 02-multi-option-constrained | raw | gpt-4o | none (raw LLM) | n/a | n/a | 15257ms |
| 02-multi-option-constrained | pipeline | gpt-4o | unified | 3 repairs, 3 reclassified | 1 | 19686ms |
| 03-vague-underspecified | raw | gpt-4o | none (raw LLM) | n/a | n/a | 13266ms |
| 03-vague-underspecified | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 12658ms |
| 04-conflicting-constraints | raw | gpt-4o | none (raw LLM) | n/a | n/a | 16284ms |
| 04-conflicting-constraints | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 13902ms |
| 05-product-feature | raw | gpt-4o | none (raw LLM) | n/a | n/a | 12318ms |
| 05-product-feature | pipeline | gpt-4o | unified | 3 repairs, 1→0 violations, 2 reclassified | 1 | 12014ms |
| 06-operations-warehouse | raw | gpt-4o | none (raw LLM) | n/a | n/a | 16681ms |
| 06-operations-warehouse | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 10462ms |
| 07-cloud-migration | raw | gpt-4o | none (raw LLM) | n/a | n/a | 17970ms |
| 07-cloud-migration | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 14405ms |
| 08-channel-strategy | raw | gpt-4o | none (raw LLM) | n/a | n/a | 12685ms |
| 08-channel-strategy | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 14238ms |
| 09-nested-subdecision | raw | gpt-4o | none (raw LLM) | n/a | n/a | 14540ms |
| 09-nested-subdecision | pipeline | gpt-4o | unified | 8 repairs, 6→0 violations, 3 reclassified, 2 pruned | 1 | 17012ms |
| 10-many-observables | raw | gpt-4o | none (raw LLM) | n/a | n/a | 15446ms |
| 10-many-observables | pipeline | gpt-4o | unified | 6 repairs, 6 reclassified | 1 | 23252ms |
| 11-feedback-loop-trap | raw | gpt-4o | none (raw LLM) | n/a | n/a | 13087ms |
| 11-feedback-loop-trap | pipeline | gpt-4o | unified | 3 repairs, LLM repair, 2→2 violations, 3 reclassified | 1 | 40907ms |
| 12-similar-options | raw | gpt-4o | none (raw LLM) | n/a | n/a | 15716ms |
| 12-similar-options | pipeline | gpt-4o | unified | 2 repairs, 2 reclassified | 1 | 16134ms |
| 13-forced-binary | raw | gpt-4o | none (raw LLM) | n/a | n/a | 14115ms |
| 13-forced-binary | pipeline | gpt-4o | unified | 1 repairs, 1 reclassified | 1 | 11263ms |
| 14-qualitative-strategy | raw | gpt-4o | none (raw LLM) | n/a | n/a | 12290ms |
| 14-qualitative-strategy | pipeline | gpt-4o | unified | 2 repairs, 2 reclassified | 1 | 14463ms |

---

## 6. Recommendations

### 1. Is the pipeline net-positive, net-neutral, or net-negative for graph quality?

**net-positive** — Mean score delta: +0.034. Structurally valid graphs: raw 11/14 vs pipeline 13/14. Rescued: 3, Broken: 1.

### 2. Are any specific stages causing degradation?

2 brief(s) show degradation: 04-conflicting-constraints, 11-feedback-loop-trap. Review pipeline trace data for these briefs to identify which stage caused the regression.

### 3. Are raw benchmark scores a reliable proxy for production quality?

Partially — the pipeline rescues 3 invalid graph(s) (raw valid: 11/14 → pipeline valid: 13/14), which means raw validity scores undercount production quality. Among graphs that are valid in both, scores track closely (delta: +0.034). Post-pipeline validity should supplement raw scores as a metric.

### 4. Briefs requiring human review

The following briefs require human review:
- **04-conflicting-constraints**: DEGRADED
- **11-feedback-loop-trap**: BROKEN

