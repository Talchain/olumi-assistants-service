/**
 * Gold Brief Fixture Set — v1
 *
 * 12 diverse decision briefs for parametric edge stability benchmarking.
 * Changes require explicit review and gold_set_version increment.
 *
 * Diversity coverage:
 *   Option count: 2×2-option, 3×3-option, 1×4-option (+ others)
 *   Domain:       2× market/pricing, 2× product/feature, 2× hiring/team, 6× other
 *   Constraints:  6 with explicit constraints, 6 without
 *   Graph size:   Expected 5–15 node graphs
 */

import type { GoldBriefSet, GoldBrief, GoldBriefWithTransforms } from "./types.js";

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

const briefs: GoldBrief[] = [
  // ── Market / Pricing (2) ─────────────────────────────────────────────────
  {
    id: "gold_001",
    version: 1,
    domain: "market_pricing",
    brief_text:
      "We're a B2B SaaS company selling project management software at £49/user/month. " +
      "Our competitor just dropped their price to £39/user/month and we've seen a 15% " +
      "decline in new sign-ups over the past quarter. We have 2,000 active customers " +
      "with an average contract length of 14 months. Should we match their price or " +
      "maintain our current pricing and invest in product differentiation?",
    expected_option_count: 2,
    notes: "2-option pricing decision with explicit numeric constraints (price, churn, customers)",
  },
  {
    id: "gold_002",
    version: 1,
    domain: "market_pricing",
    brief_text:
      "Our e-commerce platform is launching in three new European markets: Germany, " +
      "France, and Spain. We need to decide our pricing strategy. Option A: uniform " +
      "pricing at €29.99 across all markets. Option B: localised pricing based on " +
      "purchasing power (€34.99 Germany, €27.99 France, €24.99 Spain). Option C: " +
      "freemium model with premium tier at €39.99. Current conversion rate is 3.2% " +
      "and we need to reach 10,000 paying customers within 12 months.",
    expected_option_count: 3,
    notes: "3-option market entry with explicit conversion and customer targets",
  },

  // ── Product / Feature (2) ────────────────────────────────────────────────
  {
    id: "gold_003",
    version: 1,
    domain: "product_feature",
    brief_text:
      "Our mobile app has 50,000 daily active users. We're deciding between two major " +
      "feature investments for Q3: (A) AI-powered personalisation engine that could " +
      "increase engagement by 20-30%, or (B) offline mode that addresses the #1 " +
      "feature request from 35% of our user surveys. Engineering estimates: " +
      "personalisation needs 4 developers for 3 months, offline mode needs 3 " +
      "developers for 2 months. Our retention rate is currently 62%.",
    expected_option_count: 2,
    notes: "2-option product roadmap with engineering resource constraints",
  },
  {
    id: "gold_004",
    version: 1,
    domain: "product_feature",
    brief_text:
      "We run a fintech platform processing £2M in daily transactions. We need to " +
      "decide how to handle our authentication upgrade. Option 1: migrate to passkeys " +
      "(WebAuthn) which reduces fraud by ~40% but requires 6 months of development. " +
      "Option 2: add SMS-based 2FA which is faster (2 months) but has known SIM-swap " +
      "vulnerabilities. Option 3: implement both in phases, starting with 2FA then " +
      "passkeys, taking 9 months total but maintaining security throughout.",
    expected_option_count: 3,
    notes: "3-option security decision with time and risk trade-offs",
  },

  // ── Hiring / Team (2) ───────────────────────────────────────────────────
  {
    id: "gold_005",
    version: 1,
    domain: "hiring_team",
    brief_text:
      "Our engineering team of 12 is struggling with delivery velocity. Sprint " +
      "completion rate has dropped from 85% to 60% over the last two quarters. " +
      "We're choosing between: hiring 4 senior engineers at £95k each (6-month " +
      "ramp-up), or restructuring into smaller autonomous squads of 3-4 people " +
      "with dedicated product owners. Budget constraint: £400k annual for this " +
      "initiative. Current team cost is £1.2M/year.",
    expected_option_count: 2,
    notes: "2-option team scaling with budget constraint",
  },
  {
    id: "gold_006",
    version: 1,
    domain: "hiring_team",
    brief_text:
      "We're a 50-person startup that just raised Series B. We need to decide our " +
      "hiring approach for the next 18 months. Option A: aggressive in-house hiring " +
      "to reach 120 people. Option B: hybrid model with 80 in-house and 15 contractors " +
      "for specialised work. Option C: lean team of 70 with heavy investment in " +
      "AI-assisted tooling and automation. Option D: strategic acqui-hire of a 20-person " +
      "team from a failing competitor. Runway is 24 months at current burn rate.",
    expected_option_count: 4,
    notes: "4-option hiring strategy, no explicit numeric constraints beyond headcount",
  },

  // ── Operations (2) ──────────────────────────────────────────────────────
  {
    id: "gold_007",
    version: 1,
    domain: "operations",
    brief_text:
      "Our warehouse fulfilment centre processes 5,000 orders daily with a 2.1% error " +
      "rate. We're evaluating whether to invest £800k in robotic picking systems that " +
      "promise to reduce errors to 0.3% and increase throughput by 40%, or to hire 15 " +
      "additional quality control staff at £28k each and implement a manual double-check " +
      "process. Current customer satisfaction score is 4.2/5 and we must maintain above " +
      "4.0 during any transition.",
    expected_option_count: 2,
    notes: "2-option operations with explicit error rate and satisfaction constraints",
  },
  {
    id: "gold_008",
    version: 1,
    domain: "operations",
    brief_text:
      "Our food delivery startup operates in 3 cities. We need to decide our expansion " +
      "strategy. We can expand to 2 more cities (Leeds and Bristol), deepen penetration " +
      "in existing cities by adding grocery delivery, or pivot to B2B corporate catering. " +
      "Current unit economics: £2.30 contribution margin per order, 12,000 daily orders. " +
      "We need to reach profitability within 18 months.",
    expected_option_count: 3,
    notes: "3-option strategic expansion without explicit numeric constraints beyond unit economics",
  },

  // ── Technology (2) ──────────────────────────────────────────────────────
  {
    id: "gold_009",
    version: 1,
    domain: "technology",
    brief_text:
      "Our monolithic Rails application is hitting scaling limits at 10,000 concurrent " +
      "users. P95 latency has degraded from 200ms to 800ms. We need to decide: full " +
      "microservices migration (estimated 12 months, £500k), or targeted performance " +
      "optimisation of the 3 bottleneck endpoints with caching and read replicas " +
      "(estimated 3 months, £80k). Our SLA requires P95 latency under 500ms.",
    expected_option_count: 2,
    notes: "2-option technology decision with explicit latency SLA constraint",
  },
  {
    id: "gold_010",
    version: 1,
    domain: "technology",
    brief_text:
      "We're choosing a cloud provider for our healthcare data platform that processes " +
      "500TB of patient records. Options: AWS with HIPAA BAA (most mature, £180k/year), " +
      "Azure with integrated Active Directory for hospital systems (£165k/year), or " +
      "Google Cloud with superior ML capabilities for our diagnostic AI (£155k/year). " +
      "Data residency must be UK-only. Migration from current on-prem takes 6 months " +
      "regardless of provider.",
    expected_option_count: 3,
    notes: "3-option cloud migration with data residency constraint",
  },

  // ── Strategy (2) ────────────────────────────────────────────────────────
  {
    id: "gold_011",
    version: 1,
    domain: "strategy",
    brief_text:
      "Our DTC fashion brand has £3M annual revenue with 40% gross margins. We're " +
      "deciding whether to launch a wholesale channel to department stores (potential " +
      "50% revenue increase but margins drop to 25%) or invest in our own retail " +
      "stores (2 locations at £150k each, maintaining 40% margins but slower growth). " +
      "Customer acquisition cost online has risen 60% in two years to £45 per customer.",
    expected_option_count: 2,
    notes: "2-option channel strategy with margin and CAC trade-offs",
  },
  {
    id: "gold_012",
    version: 1,
    domain: "strategy",
    brief_text:
      "Our edtech company serves 200 UK schools with a curriculum-aligned maths " +
      "platform. We're evaluating three growth paths: expand to secondary schools " +
      "(currently primary only), enter the US market (requires curriculum adaptation), " +
      "or build an AI tutoring product for direct-to-consumer. Current ARR is £1.8M " +
      "with 92% renewal rate. We have £2M in the bank and 18 months of runway.",
    expected_option_count: 3,
    notes: "3-option growth strategy without hard numeric constraints",
  },
];

// ---------------------------------------------------------------------------
// Sensitivity Briefs (3 briefs with transformation metadata)
// ---------------------------------------------------------------------------

const sensitivityBriefs: GoldBriefWithTransforms[] = [
  {
    ...briefs[0]!, // gold_001 — pricing decision
    transformations: {
      synonym_map: {
        "competitor": "rival",
        "price": "rate",
        "sign-ups": "registrations",
        "customers": "clients",
        "differentiation": "distinction",
      },
      // Split between the two sentences describing the situation and the question
      clause_split_index: 234,
      passive_voice_sentences: [1, 2], // "A 15% decline has been seen..." "2,000 customers are had..."
    },
  },
  {
    ...briefs[2]!, // gold_003 — product feature decision
    transformations: {
      synonym_map: {
        "engagement": "interaction",
        "feature": "capability",
        "developers": "engineers",
        "retention": "user retention",
        "surveys": "feedback polls",
      },
      clause_split_index: 196,
      passive_voice_sentences: [0, 3], // "50,000 DAUs are had..." "An estimate of... is given..."
    },
  },
  {
    ...briefs[4]!, // gold_005 — hiring decision
    transformations: {
      synonym_map: {
        "velocity": "speed",
        "engineers": "developers",
        "squads": "teams",
        "budget": "financial",
        "autonomous": "independent",
      },
      clause_split_index: 169,
      passive_voice_sentences: [0, 1], // "Delivery velocity is being struggled with..." "Sprint completion rate has been dropped..."
    },
  },
];

// ---------------------------------------------------------------------------
// Exported Gold Brief Set
// ---------------------------------------------------------------------------

export const GOLD_BRIEF_SET: GoldBriefSet = {
  gold_set_version: 1,
  briefs,
  sensitivity_brief_ids: ["gold_001", "gold_003", "gold_005"],
  sensitivity_briefs: sensitivityBriefs,
};

/**
 * Look up a gold brief by ID.
 * Throws if not found — callers should use known IDs.
 */
export function getGoldBrief(id: string): GoldBrief {
  const brief = GOLD_BRIEF_SET.briefs.find((b) => b.id === id);
  if (!brief) throw new Error(`Gold brief not found: ${id}`);
  return brief;
}
