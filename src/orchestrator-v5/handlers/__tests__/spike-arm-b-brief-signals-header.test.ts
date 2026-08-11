/**
 * SPIKE arm B — byte-faithfulness of the BriefSignals header threaded onto the
 * LIVE V5 draft path.  THROWAWAY SPIKE BRANCH (`spike/arm-b-header`) — never
 * merged, never pushed to `staging`.
 *
 * Protocol: olumi-docs/parallel-briefs/SEMANTIC-SPINE-SPIKE-PROTOCOL.md §0.1, §2 arm B.
 * Base SHA 755163663164c56210281c72fe99b2fa0aab8f49.
 *
 * ── WHAT THIS PROVES BY EXECUTION ──────────────────────────────────────────
 * §0.1 established that the dark `[BRIEF_SIGNALS v1]` header cannot reach the
 * product draft path by enablement: the flag-gated computation exists only in
 * the three legacy assist routes and `evaluatePreflightDecision` has zero
 * callers outside them.  Arm B threads
 * `formatBriefHeader(computeBriefSignals(effectiveBrief))` into
 * `dispatchDraftGraph` and passes it through the existing
 * `draftOpts.briefSignalsHeader` seam.
 *
 * The equivalence is DERIVABLE at the bytes — `preflight-decision.ts:151` sets
 * `briefSignals = computeBriefSignals(brief)` verbatim and returns it
 * unmodified; `assist.v1.draft-graph.ts:431` formats exactly that value — but a
 * derivation is not a measurement.  These tests RUN both paths and compare the
 * produced bytes on all four frozen briefs (§4).
 *
 * ── INSTRUMENT CONTROLS (why this file is longer than the code it guards) ───
 *   - every fixture asserts its own frozen hash before use (trap 13b: a fixture
 *     that drifts turns a discriminating assertion into a tautology);
 *   - the legacy side pins its own precondition — `action === 'proceed'` and
 *     `briefSignals` DEFINED — because the assist route threads nothing on the
 *     reject rung, and comparing two absent headers agrees vacuously (trap 13);
 *   - both sides are asserted NON-EMPTY and well-formed BEFORE the equality is
 *     believed (the compare-two-empty-extractions failure mode);
 *   - the four headers are asserted MUTUALLY DISTINCT — a formatter that
 *     collapsed every brief to one string would satisfy every equality above
 *     while discriminating nothing (trap 20: identical answers for every item is
 *     evidence about the instrument, not about the world);
 *   - the arm-OFF cases pin that arm B changes NOTHING at the base posture, so
 *     arm A on this lineage is a true control and the arms differ only by the
 *     named intervention.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import { config, _resetConfigCache } from '../../../config/index.js';
import { evaluatePreflightDecision } from '../../../cee/validation/preflight-decision.js';
import { formatBriefHeader } from '../../../cee/signals/brief-header.js';

// ── Frozen inputs (§4) ──────────────────────────────────────────────────────

interface FrozenBrief {
  id: string;
  hashAlg: 'md5' | 'sha256';
  hash: string;
  text: string;
}

const FROZEN_BRIEFS: readonly FrozenBrief[] = [
  {
    id: "CRM-control",
    hashAlg: "sha256" as const,
    hash: "90529b8e23026ed23e05d65912d820153476dd81f883af4ff7410b02fde9c377",
    text: "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
  },
  {
    id: "B1",
    hashAlg: "md5" as const,
    hash: "b2ed2c7b6376ff5d4a51833495d3313e",
    text: "I need to work out whether we push into Germany next year or double down on the UK — that's the decision, and honestly the board is split. We're an 85-person regtech SaaS doing £11.2m ARR, growing about 28% year on year, but UK new-logo growth slowed to 9% over the last two quarters and I think the UK market is maybe 70% penetrated for our segment — that's my gut, not a real number. The goal is to get to £20m ARR by end of FY28 without dropping gross margin below 78%. Germany: TAM is supposedly €400m (that's from the 2025 Gartner regtech sizing, though our head of sales thinks it's inflated, maybe half that once you strip out the banks we can't serve). BaFin licensing will take 9 to 14 months, legal quoted us €250k for the process, and we'd need maybe 6 local hires — say €900k a year fully loaded. We have £3.1m cash and we're profitable-ish, breakeven plus or minus £100k a quarter, so we can't fund a two-year burn on this. Assumption: our UK compliance content localises to the German regime with about 60% reuse — our CTO says it's more like 40%, and if he's right the engineering cost roughly doubles. Two existing customers (both UK banks with Frankfurt operations) have said they'd sponsor a pilot — I have the emails from May. Constraint: we cannot hire more than 8 people total next year, HR freeze from the board, and marketing spend is capped at £1.5m. There's a half-formed idea floating around that we partner with a local player like Regnology instead of going direct — nobody has scoped it, might be nothing. Also worth saying: our NRR is 112%, and if we just focused on expansion we might hit £16m without any new market — Priya's cohort model in the June board pack says £15.8m by FY28 on expansion alone. I honestly don't know whether the Germany window closes if we wait a year — two US competitors raised big rounds in Q2. The CFO wants to wait 12 months, the CRO wants to go now. So: Germany in 2027, or UK depth?\n",
  },
  {
    id: "B2",
    hashAlg: "md5" as const,
    hash: "216e469613fe961604ccf117d970de89",
    text: "Need to decide how we take £4m out of opex by end of Q2 2027 — do we do it mainly through offshoring support, automation, or closing the Leeds office? Braindump before the exec offsite, apologies for the mess:\n\n- context: 240 heads, £31m revenue, EBITDA minus £1.8m, board wants breakeven by Q3 2027, non-negotiable\n- target: £4m annualised opex out, ideally £2.5m of it landed by end of Q2\n- support org = 62 people, £2.9m/yr. Offshore quote from TaskUs: ~40% saving on 45 roles = ~£1.1m/yr, but CSAT risk is real\n- when a competitor did this their Trustpilot dropped 4.1 to 3.3 in six months (I saw it in their public reviews, not exactly science)\n- automation: the deflection pilot in April handled 34% of tickets end to end (our own dashboard, n=6 weeks). Jamie extrapolates that to £800k/yr saving but it assumes vendor pricing holds at renewal — the vendor contract renews in November and they know we're locked in\n- Leeds office lease = £600k/yr, break clause March 2027. 70 people based there. Hybrid means maybe we don't need it at all? Nobody has modelled the attrition hit. My guess: we'd lose 10-15% of Leeds staff if we close — pure guess\n- constraint: no more than one compulsory redundancy round in the next 12 months — we promised staff after the last one and the CEO is adamant\n- constraint: engineering (58 heads) is ring-fenced, board agreed\n- assumption: revenue flat at £31m. Sales says +8% but they said that last year and we did minus 2%\n- half-formed: could we sell the Leeds sublease rights? or do a 3-day office share with WPP's local outfit? no idea if either is real\n- Dana thinks we should just do a 10% across-the-board RIF and be done. I think that's how you kill morale twice — we disagree openly\n- worry: doing all three at once = change saturation. The ops director says max two big changes in parallel, based on the 2024 migration mess\n- unknown: what does offshoring do to our ISO 27001 posture? the renewal audit is January 2027\n",
  },
  {
    id: "B3",
    hashAlg: "md5" as const,
    hash: "b22788a59cb03ba3605a5cb0c7ad6e18",
    text: "Trying to decide whether we bet the next two quarters on the AI copilot or finally do the platform rewrite. Or neither — I keep going back and forth, and I'm writing this partly to think. The goal I actually care about is 15% ARR growth next year without engineering attrition getting worse.\n\nThe copilot: the prototype demoed at SKO got the best reaction I've seen in years. Sales swears it would lift win rate from 22% to 30% — that number came from Marcus polling 15 AEs on Slack, so treat accordingly. Pricing thinks we could charge +£15/seat/month on our 40,000 seats, so up to £7.2m a year if attach were 100%, which it won't be — 25% attach feels honest, call it £1.8m. Build estimate is 4 engineers for 6 months. Actually, Elena's team said 6 engineers for 8 months once you include evals and the safety review — use hers, she's usually right. LLM serving cost is the thing nobody can pin down: finance modelled £3 per seat per month, could be half that or triple depending on caching. Assumption: our data-processing agreements let us send customer CRM text to a model provider — legal has NOT confirmed this, and if it's wrong the whole thing is dead in enterprise, which is 60% of revenue.\n\nThe rewrite: the platform is 9 years old, deploys take 45 minutes, and we lost two staff engineers to it last year — the exit interviews say so explicitly. Infra says the monolith adds roughly 30% drag to every feature — that's the number the CTO keeps quoting, source unclear, possibly the 2024 DX survey. Rewrite = 10 engineers, 12 months, and history says double whatever engineering estimates on this codebase. If we don't do it, copilot velocity sits on the same slow foundation — so maybe rewrite first, then copilot. But the window: three competitors shipped copilots in the last two quarters, PMM says we're 12 months behind already, and waiting a year might mean entering dead.\n\nBudget: the board approved £2m for strategic initiatives. Realistically it's £1.2m after the security remediation eats its share, which it will. Deadline: the CEO said the copilot must demo at Camunda Days on 14 May 2027. Though honestly, if the rewrite is the right call the demo date shouldn't drive it — we could show smoke and mirrors. Second thought on revenue: I said 25% attach earlier, but enterprise procurement cycles mean year one is more like 10%, so £700k in year one — the £1.8m is a year-three number. The CPO wants the copilot, the CTO wants the rewrite, they've been at a standoff in every exec meeting since June, and I'm the tiebreak. Which way do we go?\n",
  },
];

const HEADER_PREFIX = '\n\n[BRIEF_SIGNALS v1] ';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const MINIMAL_GRAPH = {
  nodes: [{ id: 'dec_x', kind: 'decision', label: 'Decide' }],
  edges: [{ from: 'dec_x', to: 'goal_y' }],
};

function makeDraftResult(): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: MINIMAL_GRAPH as unknown as DraftGraphResult['graphOutput'],
  } as DraftGraphResult;
}

function mockCommit(): void {
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: true,
  } as unknown as Awaited<ReturnType<typeof commitDirectAnswer>>);
}

/**
 * The LIVE V5 path.  Drives the real `dispatchDraftGraph` and reads the
 * `draftOpts` argument the dispatcher ACTUALLY handed to `handleDraftGraph` —
 * bound by call identity, never by re-deriving what it ought to have passed
 * (trap 19).
 */
async function threadedDraftOpts(
  brief: string,
  extra: { requestStartMs?: number } = {},
): Promise<{ briefSignalsHeader?: string; requestStartMs?: number } | undefined> {
  const h = handleDraftGraph as MockedFunction<typeof handleDraftGraph>;
  h.mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

  await dispatchDraftGraph({
    payload: makePayload(brief),
    requestId: 'req-spike-arm-b',
    request: STUB_REQUEST,
    ...extra,
  });

  // Preconditions: exactly one draft call, on OUR brief — otherwise the capture
  // below is ambiguous or belongs to a different input.
  expect(h).toHaveBeenCalledTimes(1);
  const call = h.mock.calls[0]!;
  expect(call[0]).toBe(brief);
  return call[3] as { briefSignalsHeader?: string; requestStartMs?: number } | undefined;
}

/**
 * The LEGACY assist-route path, reproduced as the route's own expression:
 *   assist.v1.draft-graph.ts:230-233 → evaluatePreflightDecision(brief, {...})
 *   assist.v1.draft-graph.ts:431     → formatBriefHeader(preflightDecision.briefSignals)
 * Nothing here re-implements the formatter or the signal computation; both are
 * the production functions.
 */
function legacyAssistRouteHeader(brief: string): string {
  const preflightDecision = evaluatePreflightDecision(brief, {
    preflightStrict: config.cee.preflightStrict,
    preflightReadinessThreshold: config.cee.preflightReadinessThreshold,
  });
  // The route reaches its header line only on the proceed rung, and threads a
  // header only when briefSignals is present (undefined on reject).  Pin both,
  // or the equality below could be comparing two absences.
  expect(preflightDecision.action).toBe('proceed');
  expect(preflightDecision.briefSignals).toBeDefined();
  return formatBriefHeader(preflightDecision.briefSignals!);
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('SPIKE arm B — threaded BriefSignals header is byte-faithful to the assist route', () => {
  const originalArm = process.env.SPIKE_ARM;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCommit();
  });

  afterEach(() => {
    if (originalArm === undefined) delete process.env.SPIKE_ARM;
    else process.env.SPIKE_ARM = originalArm;
    _resetConfigCache();
  });

  // ── Fixture integrity ────────────────────────────────────────────────────

  it('the four frozen briefs match their protocol-recorded hashes (§4)', () => {
    expect(FROZEN_BRIEFS).toHaveLength(4);
    for (const b of FROZEN_BRIEFS) {
      expect(createHash(b.hashAlg).update(b.text, 'utf8').digest('hex')).toBe(b.hash);
    }
  });

  // ── The byte-faithfulness assertion (arm B's stated requirement) ──────────

  describe.each(FROZEN_BRIEFS.map((b) => [b.id, b] as const))('brief %s', (_id, brief) => {
    it('threads a header byte-identical to the assist-route output', async () => {
      process.env.SPIKE_ARM = 'B';

      const legacy = legacyAssistRouteHeader(brief.text);
      const threaded = (await threadedDraftOpts(brief.text))?.briefSignalsHeader;

      // Positive controls BEFORE the equality — two empty strings agree with
      // each other and prove nothing.
      expect(legacy.startsWith(HEADER_PREFIX)).toBe(true);
      expect(legacy.length).toBeGreaterThan(HEADER_PREFIX.length);
      expect(typeof threaded).toBe('string');
      expect(threaded).toBeTruthy();

      // The measurement.
      expect(threaded).toBe(legacy);
      expect(sha256(threaded!)).toBe(sha256(legacy));
    });

    it('the threaded header is deterministic across repeated dispatches (§2)', async () => {
      process.env.SPIKE_ARM = 'B';

      const first = (await threadedDraftOpts(brief.text))?.briefSignalsHeader;
      vi.clearAllMocks();
      mockCommit();
      const second = (await threadedDraftOpts(brief.text))?.briefSignalsHeader;

      expect(first).toBeTruthy();
      expect(second).toBe(first);
    });
  });

  // ── Instrument discrimination (trap 20) ──────────────────────────────────

  it('the four frozen briefs produce mutually DISTINCT headers', () => {
    const headers = FROZEN_BRIEFS.map((b) => legacyAssistRouteHeader(b.text));
    expect(new Set(headers).size).toBe(FROZEN_BRIEFS.length);
    // ...and at least one carries a real extracted marker rather than an
    // all-"none" header, which would make every equality trivially satisfiable.
    expect(headers.some((h) => !/target=none .*constraints=none .*risks=none/.test(h))).toBe(true);
  });

  // ── Arm OFF: arm B is inert at the base posture (arm A stays a control) ───

  it('threads NO header when the arm is off — status-quo call is byte-identical', async () => {
    delete process.env.SPIKE_ARM;
    // Base code passed `undefined` for draftOpts when requestStartMs was absent.
    // Arm B must not manufacture an object.
    expect(await threadedDraftOpts(FROZEN_BRIEFS[0]!.text)).toBeUndefined();
  });

  it('does not activate for a DIFFERENT arm value (SPIKE_ARM=C must not light arm B)', async () => {
    process.env.SPIKE_ARM = 'C';
    expect(await threadedDraftOpts(FROZEN_BRIEFS[0]!.text)).toBeUndefined();
  });

  it('still threads requestStartMs when the arm is off (existing seam intact)', async () => {
    delete process.env.SPIKE_ARM;
    expect(await threadedDraftOpts(FROZEN_BRIEFS[0]!.text, { requestStartMs: 4242 })).toEqual({
      requestStartMs: 4242,
    });
  });

  it('threads BOTH header and requestStartMs when the arm is on', async () => {
    process.env.SPIKE_ARM = 'B';
    const draftOpts = await threadedDraftOpts(FROZEN_BRIEFS[0]!.text, { requestStartMs: 4242 });
    expect(draftOpts?.requestStartMs).toBe(4242);
    expect(draftOpts?.briefSignalsHeader).toBe(legacyAssistRouteHeader(FROZEN_BRIEFS[0]!.text));
  });

  // ── PROTOCOL CORRECTION, pinned in the suite ─────────────────────────────
  //
  // §2 arm B says the thread is "gated on the existing
  // `config.cee.briefSignalsHeaderEnabled` flag (set
  // `CEE_BRIEF_SIGNALS_HEADER_ENABLED=true` in the LOCAL instance env only)".
  // That is IMPOSSIBLE at this base SHA: the env var is never read into
  // `rawConfig`, so the flag is permanently false and gating arm B on it would
  // have produced a guaranteed no-op — arm B measuring arm A while reporting
  // arm B, invisibly, in the run data.
  //
  // Recording the gap in the suite rather than only in a report is the honest
  // form: it REDs if the wiring later lands and silently changes what arm B
  // means, and it REDs if someone "fixes" the arm switch back onto the flag.

  describe('protocol correction — CEE_BRIEF_SIGNALS_HEADER_ENABLED is unwired at this base', () => {
    it('the flag stays false however the env var is set', () => {
      process.env.CEE_BRIEF_SIGNALS_HEADER_ENABLED = 'true';
      _resetConfigCache();
      expect(config.cee.briefSignalsHeaderEnabled).toBe(false);
      delete process.env.CEE_BRIEF_SIGNALS_HEADER_ENABLED;
      _resetConfigCache();
    });

    it('config/index.ts declares the key but never reads its env var — with contrast controls', () => {
      const configSrc = readFileSync(
        fileURLToPath(new URL('../../../config/index.ts', import.meta.url)),
        'utf8',
      );
      const occurrences = (needle: string): number =>
        configSrc.split('\n').filter((l) => l.includes(needle)).length;

      // TARGET: declared once (the schema line), never wired into rawConfig.
      expect(occurrences('briefSignalsHeaderEnabled')).toBe(1);
      expect(configSrc.includes('env.CEE_BRIEF_SIGNALS_HEADER_ENABLED')).toBe(false);

      // CONTRAST CONTROLS (trap 13e): a sweep that can see nothing looks exactly
      // like a sweep that found nothing.  Sibling flags MUST appear twice —
      // schema declaration AND rawConfig wiring — in this same read.
      expect(occurrences('draftComplianceReminderEnabled')).toBe(2);
      expect(configSrc.includes('env.CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED')).toBe(true);
      expect(occurrences('preflightStrict')).toBe(2);
      expect(configSrc.includes('env.CEE_PREFLIGHT_STRICT')).toBe(true);
    });
  });
});
