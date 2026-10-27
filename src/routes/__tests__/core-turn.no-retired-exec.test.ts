/**
 * W5 (ALPHA-PLAN, "Not yet proven"; Paul 26 Oct; boundary as the PL confirmed it, 27 Oct): no RETIRED behaviour governs an alpha
 * operation. The claim is NO-EXEC of retired interpretation, readiness, refusal, repair and analysis-DECISION branches, and of the
 * prohibited top-level effects (a PLoT or ISL call; a legacy turn engine deciding the outcome). It is NOT no-load: the served
 * process loads the legacy routes at boot, and shared approval, storage and helper code may run (W5 permits it).
 *
 * The run: the REAL core route (`POST /agent/v1/core-turn`) and its real request -> write/read dispatch, with the REAL register
 * route (`assist.v1.scenario-graph-register.ts`) on every save, over the harness of `core-turn.route.test.ts`: a scripted
 * provider (0 live calls) and the session store as the database double (its RPCs' fence gate, revision and version receipt);
 * the graph read and versions routes stay doubles in the served PROGRAM shapes, their bodies out of scope. It takes a first draft,
 * the approval of the card that draft held, a card proposed and approved, an edit (a canvas figure), a Run press (on a current Run
 * and on a stale one), a replay (the same press resent), a recovery (a save whose acknowledgement was lost after it committed),
 * negatives (a press on a card no longer waiting; a press whose words are not the card's own; a reply lost after its save) and a
 * Stop.
 *
 * THE TRAPS, each named below with its file and why it is retired, on two instruments at every step:
 *  1. an EXPORT TRAP on each retired entry point (it records the call and its caller, then runs the real code);
 *  2. V8's own per-function EXECUTION COUNT for the same function (`Profiler.takePreciseCoverage`). An export trap is blind to a
 *     caller that holds the module's original binding, which an import cycle gives (measured: graph-hash.ts ->
 *     analysis-ready-helper.ts -> risk-occurrence.ts -> graph-hash.ts runs the readiness projection with its trap at 0); V8's
 *     counts do not depend on bindings. V8's BLOCK counts also trap the legacy refusal and repair branches inside shared code
 *     the path does enter (BRANCHES).
 * ⭐ RUNS, DECIDES NOTHING: the legacy analysis hash still runs on a program save in three shared places (RUNS_DECIDES_NOTHING,
 * each with its file:line), and its own projection runs two retired functions (HASH_INNER). They are allowed only there, bound by
 * callee and caller; the register's CAS base (W5 Option A: identity only) and the store's A3 hook (skipped for a program save) may
 * not compute it. The store's hook itself is proved on the real store by `assist.v1.scenario-graph-register.program-cas.test.ts`.
 * POSITIVE CONTROL, same run, same code: the modules the path really uses (the core contract, the program save, the register's
 * program save) must show calls at every step; and a direct call into each retired entry shows on both (each trap can go RED).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { toOutboundGraph } from '../../orchestrator-v5/goal-target/outbound-graph.js';
import { streamWhenAsked } from '../../orchestrator-v5/agent-lane/__tests__/stream-when-asked.js';
import { bakery, BRIEF as BAKERY_BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { programRevisionOf } from '../../orchestrator-v5/model-program-turn/program-card.js';
import { programReadinessOf } from '../../orchestrator-v5/model-program-turn/program-readiness.js';
import { postimageOf } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { reopenProgram, savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';

type Json = Record<string, any>;
const SRC = resolve(__dirname, '../..');
const rel = (abs: string): string => relative(SRC, abs);

type Kind = 'engine' | 'plot_isl' | 'readiness' | 'interpretation' | 'refusal' | 'analysis';
/**
 * ⭐ THE RETIRED ENTRY POINTS (files under `src/`). Each is off the alpha by the inventory's verdict (`ALPHA-CODE-INVENTORY.md`
 * §1 families F1–F6, §2 rows) or by #3851's wall, re-read against this tree; the shared code around them is not trapped.
 */
const RETIRED: readonly { readonly file: string; readonly fns: readonly string[]; readonly kind: Kind; readonly why: string }[] = [
  // A legacy turn engine deciding the outcome (and no in-process dispatch to /agent/v1/turn or /orchestrate/v2/turn: see the rows).
  { file: 'orchestrator-v5/agent-lane/runtime/agent-loop.ts', fns: ['runAgentTurn'], kind: 'engine', why: 'F2: the legacy agent loop (the core route runs the SDK turn)' },
  { file: 'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', fns: ['createAgentCapabilities'], kind: 'engine', why: 'F2: the legacy capability set (build, edits, run_analysis via v2)' },
  { file: 'orchestrator-v5/commit.ts', fns: ['commitDirectAnswer'], kind: 'engine', why: 'F1: the v2 commit' },
  { file: 'orchestrator-v5/build-turn-context.ts', fns: ['buildTurnContext'], kind: 'engine', why: 'F1: the v2 turn context' },
  { file: 'orchestrator/route-v2.ts', fns: ['ceeOrchestratorRouteV2'], kind: 'engine', why: 'F1: the /orchestrate/v2/turn pipeline' },
  { file: 'orchestrator-v5/system-events/dispatch.ts', fns: ['dispatchSystemEvent'], kind: 'engine', why: 'F1: the legacy canvas-edit engine (a program edit is applyCanvasFigure)' },
  { file: 'orchestrator-v5/handlers/approve-held-proposal.ts', fns: ['approveHeldProposal', 'runHeldProposalApproval', 'commitHeldProposalInProcess'], kind: 'engine', why: 'F2: the legacy held-approval writer' },
  { file: 'orchestrator-v5/agent-lane/run-operation.ts', fns: ['restoreRunOperation', 'readRecordedRun'], kind: 'engine', why: 'F2: the legacy Run restore' },
  { file: 'orchestrator-v5/agent-lane/core/model-critic.ts', fns: ['modelCritic'], kind: 'engine', why: 'F2: the legacy draft critic call' },
  // PLoT and ISL (and no outbound call but the provider's: see the rows).
  { file: 'orchestrator/plot-client.ts', fns: ['createPLoTClient'], kind: 'plot_isl', why: 'F5: the CEE to PLoT client' },
  { file: 'adapters/isl/client.ts', fns: ['createISLClient'], kind: 'plot_isl', why: 'F5: the ISL client' },
  { file: 'adapters/isl/counterfactual-client.ts', fns: ['createCounterfactualClient', 'makeCounterfactualClient'], kind: 'plot_isl', why: 'F5: the ISL counterfactual client' },
  { file: 'services/validateClient.ts', fns: ['validateGraph'], kind: 'plot_isl', why: 'F5: engine validate (PLoT, over undici, outside the fetch stub)' },
  { file: 'orchestrator-v5/tools/registry.ts', fns: ['getDefaultPlotClient', 'getDefaultRegistry', 'createRegistry', 'resolveHandler'], kind: 'plot_isl', why: 'F5: the legacy tool registry and its PLoT client' },
  { file: 'orchestrator-v5/tools/handlers/run-analysis.ts', fns: ['createRunAnalysisHandler'], kind: 'plot_isl', why: 'F5: the legacy Run (PLoT)' },
  { file: 'orchestrator-v5/handlers/stress-variant-run.ts', fns: ['runStressVariant', 'runVariant'], kind: 'plot_isl', why: 'F5: the stress-test variant Run (PLoT)' },
  { file: 'orchestrator-v5/handlers/what-if-run.ts', fns: ['runWhatIf'], kind: 'plot_isl', why: 'F5: the what-if Run (PLoT)' },
  { file: 'orchestrator-v5/tools/handlers/what-would-flip.ts', fns: ['createWhatWouldFlipHandler'], kind: 'plot_isl', why: 'F5: what would flip (ISL)' },
  // Readiness and the legacy analysis read.
  { file: 'orchestrator/tools/analysis-ready-helper.ts', kind: 'readiness', why: 'F3: the legacy readiness/admission assessor and its option projection (#3851 FORBIDDEN)',
    fns: ['assessCanonicalAnalysisReadiness', 'buildCanonicalAnalysisReadyFromGraph', 'canonicalAnalysisReadyFrom', 'computeStructuralReadiness', 'buildAnalysisRefusalReadiness', 'projectOptionForCanonicalBuilder'] },
  { file: 'routes/scenario-graph-analysis-read.ts', fns: ['readScenarioAnalysis'], kind: 'readiness', why: 'F3: the legacy analysis reader' },
  { file: 'routes/canonical-analysis-view.ts', fns: ['projectCanonicalAnalysisView', 'projectCanonicalAnalysisCells'], kind: 'readiness', why: 'F3: the legacy Run view (#3851 FORBIDDEN)' },
  { file: 'orchestrator-v5/agent-lane/first-analysis.ts', fns: ['claimPermissionsFrom', 'runFirstAnalysisAfterConstruction'], kind: 'readiness', why: 'F3: legacy claim permissions and the first automatic Run' },
  // The legacy Run's analysis inputs.
  { file: 'orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts', fns: ['guardAnalysisParticipation', 'isRetainedExcluded'], kind: 'analysis', why: 'F5: the PLoT Run\'s participation guard' },
  { file: 'orchestrator-v5/goal-target/carried-effects-timing.ts', fns: ['carriedEffectsTiming', 'recordedEffectsTimingOf'], kind: 'analysis', why: 'F2: the timing carried to the legacy automatic Run' },
  // Interpretation: the Living Model and the legacy semantic layers.
  { file: 'orchestrator-v5/path-b/living-model/view.ts', fns: ['livingViewOf'], kind: 'interpretation', why: 'F2: the Living Model reader (the pre-alpha core)' },
  { file: 'orchestrator-v5/path-b/living-model/mapper.ts', fns: ['mapLivingModel'], kind: 'interpretation', why: 'F2: the Living Model mapper' },
  { file: 'orchestrator-v5/path-b/living-model/edit.ts', fns: ['applyExplicitEdit'], kind: 'interpretation', why: 'F2: the Living Model edit rules' },
  { file: 'orchestrator-v5/path-b/living-model/kernel.ts', fns: ['applyKernel'], kind: 'interpretation', why: 'F2: the Living Model kernel' },
  { file: 'cee/context-integrity/not-modelled-manifest.ts', fns: ['deriveNotModelledManifest'], kind: 'interpretation', why: 'F3: the GraphV3 not-modelled scan (the program variant is shared)' },
  { file: 'orchestrator-v5/agent-lane/goal-definition-sum.ts', fns: ['deriveTodayParts', 'withTodayPartsAtGoalLevel', 'todayPartsApartFromGoal'], kind: 'interpretation', why: 'F3: the legacy goal today-part rule' },
  { file: 'orchestrator-v5/compose/goal-scope-claim-input.ts', fns: ['goalScopeClaimInput'], kind: 'interpretation', why: 'F3: the legacy goal-scope claim gate' },
  { file: 'orchestrator-v5/agent-lane/reply/compose-reply.ts', fns: ['composeReplyShape'], kind: 'interpretation', why: 'F2: the legacy reply composer' },
  { file: 'orchestrator-v5/agent-lane/actions/rank.ts', fns: ['actionBarOf'], kind: 'interpretation', why: 'F3/F7: the legacy action bar ranker' },
  { file: 'orchestrator-v5/core-route/action-bar.ts', fns: ['coreActionBarOf'], kind: 'interpretation', why: 'F3/F7: the core lane action bar (no program contract)' },
  { file: 'orchestrator-v5/agent-lane/history-store.ts', fns: ['historyFromDurableTurns'], kind: 'interpretation', why: 'F7: the legacy history window (a program reads program-history.ts)' },
  { file: 'orchestrator-v5/agent-lane/goal-chance-estimate-egress.ts', fns: ['withEstimateGoalPointsAtEgress'], kind: 'interpretation', why: 'F3: the egress gate keyed on the PLoT result licence' },
  { file: 'routes/agent-v1-turn.ts', fns: ['stillValidOffers', 'isDurableAnswerOffer'], kind: 'interpretation', why: 'F1: the legacy route\'s offer rules' },
  // Refusal: the Living Model card rules (a program card's life is program-card.ts's).
  { file: 'orchestrator-v5/agent-lane/approval-chips.ts', fns: ['approvalChipsFor'], kind: 'refusal', why: 'F6: the Living Model approval chips' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/lifecycle.ts', fns: ['reconcileHeldProposals'], kind: 'refusal', why: 'F6: the Living Model card lifecycle' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/still-applies.ts', fns: ['heldCardStillApplies', 'heldCardSubjectMoved', 'heldCardAppliesAt'], kind: 'refusal', why: 'F6: the Living Model "card still applies" rules' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/record.ts', fns: ['heldRecordAppliesAt', 'heldRecordsApplyAt'], kind: 'refusal', why: 'F6: the legacy applies rule (the record itself is shared)' },
];

/**
 * Legacy refusal and repair BRANCHES inside shared code the path does enter, trapped by V8's block counts at the branch itself.
 * The row writer (`persist-graph-write.ts:390`) runs the legacy horizon-basis hook on every core turn row, with no graph
 * (inventory §2.1: "should be skipped for a program"); none of its refusals or its repair may run.
 */
const BRANCHES: readonly { readonly file: string; readonly at: readonly string[]; readonly kind: Kind; readonly why: string }[] = [
  { file: 'orchestrator-v5/goal-target/horizon-basis-provenance.ts', kind: 'refusal', why: 'F1: the legacy horizon-basis provenance refusals',
    at: ['horizon_basis write authorisation is invalid', 'horizon_basis authorised goal is absent', 'horizon_basis authorised goal is absent or ambiguous',
      'horizon_basis graph write is not prepared from stored provenance'] },
  { file: 'orchestrator-v5/goal-target/horizon-basis-provenance.ts', kind: 'refusal', why: 'F1: the legacy horizon-basis repair (rewrites a goal\'s basis)', at: ['delete node.horizon_basis'] },
];

/**
 * ⭐ RUNS, DECIDES NOTHING (W5 Option A, DL 27 Oct): where a program save still computes the legacy analysis hash. Each call is
 * bound by its callee and its caller's file (and, for the register, the source line the call is made on); a call from anywhere
 * else, such as the register's CAS base (`computeExpectedGraphCasHashes(base)`), is a retired analysis DECISION and fails the claim.
 */
const RUNS_DECIDES_NOTHING: readonly { readonly callee: string; readonly caller: string; readonly line?: string; readonly where: string; readonly why: string }[] = [
  { callee: 'orchestrator-v5/context/graph-identity.ts#computeVersionAnalysisAffectingHashRecord', caller: 'orchestrator-v5/commit.ts',
    where: 'commit.ts:1070 (-> graph-identity.ts:179 computeAnalysisAffectingGraphHashSha256; from register.ts:1181)',
    why: 'the version receipt\'s analysis_affecting_hash column, written to the database; nothing on this path compares it (core-write.ts:90-92)' },
  { callee: 'orchestrator-v5/context/graph-cas-conflict.ts#computeExpectedGraphCasHashes', caller: 'routes/assist.v1.scenario-graph-register.ts', line: 'graphHashForStore',
    where: 'register.ts:1260 -> :418 -> program-card.ts:75', why: 'the awaiting-review marker\'s `model`, which no reader reads (program-card.ts:66 reads its presence)' },
  { callee: 'orchestrator-v5/context/graph-hash.ts#computeAnalysisAffectingGraphHash', caller: 'orchestrator-v5/context/graph-cas-conflict.ts',
    where: 'graph-cas-conflict.ts:187, inside the register.ts:1260 call only', why: 'the same marker' },
  { callee: 'orchestrator-v5/context/graph-hash.ts#computeAnalysisAffectingGraphHash', caller: 'orchestrator-v5/persisted-graph-invariants.ts',
    where: 'persisted-graph-invariants.ts:217-224 (guarded; from persist-graph-write.ts:222)', why: 'the invariant report\'s analysisGraphHash, read only by the v2 commit (commit.ts:1238, :2119)' },
];
/** Retired functions the legacy hash's OWN projection runs (graph-hash.ts -> analysis-ready-helper; held-user-links -> the guard): allowed only on a step whose legacy hash ran from a site above. */
const HASH_INNER = {
  fns: ['orchestrator/tools/analysis-ready-helper.ts#projectOptionForCanonicalBuilder', 'orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts#isRetainedExcluded'],
  calls: ['orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts#isRetainedExcluded <- orchestrator-v5/goal-target/held-user-links.ts'],
};
/** The shared hash modules, trapped (callers recorded) and counted, the real code run: "executes, does not decide". */
const SHARED_TRAPS: readonly { readonly file: string; readonly fns: readonly string[] }[] = [
  { file: 'orchestrator-v5/context/graph-hash.ts', fns: ['computeAnalysisAffectingGraphHash', 'computeAnalysisAffectingGraphHashSha256'] },
  { file: 'orchestrator-v5/context/graph-cas-conflict.ts', fns: ['computeExpectedGraphCasHashes', 'computeExpectedGraphIdentityHash', 'categoriseGraphCasWrite'] },
  // Its call into graph-hash.ts holds the original binding (the cycle above), so the receipt hash is trapped at its own entry.
  { file: 'orchestrator-v5/context/graph-identity.ts', fns: ['computeVersionAnalysisAffectingHashRecord'] },
];
const SHARED_COUNTED: readonly { readonly file: string; readonly fns: readonly string[] }[] = [
  ...SHARED_TRAPS,
  { file: 'orchestrator-v5/context/graph-identity-normalise.ts', fns: ['computeGraphIdentityHash'] },
  { file: 'orchestrator-v5/persisted-graph-invariants.ts', fns: ['checkPersistedGraphInvariants'] },
  { file: 'orchestrator-v5/commit.ts', fns: ['buildAtomicCommittedModelVersion'] },
  { file: 'orchestrator/tools/analysis-ready-helper.ts', fns: ['projectOptionForCanonicalBuilder'] },
  { file: 'orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts', fns: ['isRetainedExcluded'] },
];
const SHARED_IDS = new Set(SHARED_COUNTED.flatMap((x) => x.fns.map((f) => `${x.file}#${f}`)));
const LEGACY_HASH = new Set(['orchestrator-v5/context/graph-hash.ts#computeAnalysisAffectingGraphHash', 'orchestrator-v5/context/graph-hash.ts#computeAnalysisAffectingGraphHashSha256',
  'orchestrator-v5/context/graph-cas-conflict.ts#computeExpectedGraphCasHashes', 'orchestrator-v5/context/graph-identity.ts#computeVersionAnalysisAffectingHashRecord']);
/** A legacy-hash call is allowed when its callee and caller (and, where named, the caller's source line) are one of the sites above. */
function decidesNothing(c: Call): boolean {
  const m = /^(.+\.ts):(\d+):\d+$/.exec(c.site);
  return m !== null && RUNS_DECIDES_NOTHING.some((r) => r.callee === c.id && r.caller === m[1]
    && (r.line === undefined || (readFileSync(join(SRC, m[1]!), 'utf8').split('\n')[Number(m[2]) - 1] ?? '').includes(r.line)));
}

/** Entry points the path really uses, trapped and counted by the SAME code: each must show calls (the instruments see what runs). */
const USED: readonly { readonly file: string; readonly fns: readonly string[] }[] = [
  { file: 'orchestrator-v5/core-route/contract.ts', fns: ['coreTurnContract', 'coreTurnFailure'] },
  { file: 'orchestrator-v5/model-program-turn/program-save.ts', fns: ['savePostimage'] },
];
const CONTRACT = ['orchestrator-v5/core-route/contract.ts#coreTurnContract', 'orchestrator-v5/core-route/contract.ts#coreTurnFailure'];
const SAVE = 'orchestrator-v5/model-program-turn/program-save.ts#savePostimage';
/** The REAL register route's program save, by V8 (the handler's helper runs on every save; it is not exported, so no trap). */
const REGISTER = 'routes/assist.v1.scenario-graph-register.ts#threadLiveHoldsThroughRegistration';

const RETIRED_FNS = new Set(RETIRED.flatMap((r) => r.fns.map((f) => `${r.file}#${f}`)));
const USED_FNS = new Set(USED.flatMap((u) => u.fns.map((f) => `${u.file}#${f}`)));
const HASH_INNER_FNS = new Set(HASH_INNER.fns);
const HASH_INNER_CALLS = new Set(HASH_INNER.calls);
/** A trapped call by its identity: the entry point and its caller's file. */
const callKey = (c: Call): string => `${c.id} <- ${c.site.replace(/:\d+:\d+$/, '')}`;
const MEASURED_FILES = new Set([...RETIRED, ...USED, ...BRANCHES, ...SHARED_COUNTED, { file: REGISTER.split('#')[0]! }].map((x) => x.file));

// ── INSTRUMENT 1: THE EXPORT TRAP ────────────────────────────────────────────────────────────────────────────────────────────
type Call = { readonly id: string; readonly site: string; readonly phase: string };
let phase = 'import';
const calls: Call[] = [];
/** Retired modules whose traps were installed because the route's own module graph loaded them. */
const loaded = new Set<string>();

/** Who called a trap: the first frame outside this file and outside the trapped module. */
function callerOf(file: string): string {
  const frames = (new Error().stack ?? '').split('\n').slice(1).map((l) => l.trim());
  const site = frames.find((l) => !l.includes('core-turn.no-retired-exec') && !l.includes(file) && /\/src\//.test(l)) ?? 'unknown';
  return /([\w.@-]+(?:\/[\w.@-]+)*\.ts):\d+:\d+/.exec(site.replaceAll(`${SRC}/`, ''))?.[0] ?? 'unknown';
}

/** A module whose named functions are traps (each records its call, then runs the real code); every other export is untouched. */
function trapModule(actual: Record<string, unknown>, file: string, fns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    let cached: { v: unknown } | undefined;
    // Read lazily: a module still loading in an import cycle is never touched before it is ready.
    Object.defineProperty(out, key, { enumerable: true, configurable: true, get: () => {
      const v = actual[key];
      if (!fns.includes(key) || typeof v !== 'function') return v;
      cached ??= { v: new Proxy(v, {
        apply: (t, self, args) => { calls.push({ id: `${file}#${key}`, site: callerOf(file), phase }); return Reflect.apply(t, self, args); },
        construct: (t, args, nt) => { calls.push({ id: `${file}#${key}`, site: callerOf(file), phase }); return Reflect.construct(t, args, nt); },
      }) };
      return cached.v;
    } });
  }
  return out;
}

// ── INSTRUMENT 2: V8'S OWN EXECUTION COUNTS ──────────────────────────────────────────────────────────────────────────────────
// Precise coverage is isolate-wide and each take resets its counters; it is started here and never stopped, so a coverage run of
// the suite still works (it loses only this file's counts).
const inspector = new Session();
type Range = { readonly startOffset: number; readonly endOffset: number; readonly count: number };
type ScriptCoverage = { readonly scriptId: string; readonly url: string; readonly functions: readonly { readonly functionName: string; readonly ranges: readonly Range[] }[] };
type Take = { readonly fns: readonly string[]; readonly branches: readonly string[]; readonly counts: Readonly<Record<string, number>> };
const sources = new Map<string, string>();
const sourceOf = async (scriptId: string): Promise<string> => {
  if (!sources.has(scriptId)) sources.set(scriptId, (await inspector.post('Debugger.getScriptSource', { scriptId }) as { scriptSource: string }).scriptSource);
  return sources.get(scriptId)!;
};
/** The traps' functions (`file#name`) and BRANCHES that ran since the last take; a take's own `post` resets the counts at once. */
async function take(files: ReadonlySet<string>): Promise<Take> {
  const { result } = await inspector.post('Profiler.takePreciseCoverage') as unknown as { result: ScriptCoverage[] };
  const fns = new Set<string>();
  const branches: string[] = [];
  const counts: Record<string, number> = {};
  for (const script of result) {
    if (!script.url.startsWith('file://')) continue;
    const file = rel(fileURLToPath(script.url.split('?')[0]!));
    if (!files.has(file)) continue;
    for (const fn of script.functions) {
      const n = fn.ranges[0]?.count ?? 0;
      if (fn.functionName === '' || n === 0) continue;
      fns.add(`${file}#${fn.functionName}`);
      if (SHARED_IDS.has(`${file}#${fn.functionName}`)) counts[`${file}#${fn.functionName}`] = (counts[`${file}#${fn.functionName}`] ?? 0) + n;
    }
    for (const b of BRANCHES.filter((x) => x.file === file)) {
      const src = await sourceOf(script.scriptId);
      for (const at of b.at) {
        const offset = src.indexOf(at);
        if (offset < 0) { branches.push(`${file}: "${at}" NOT FOUND`); continue; }
        // The innermost range holding the branch gives its count (V8 reports a nested range only where the count differs).
        const ranges = script.functions.flatMap((f) => f.ranges).filter((r) => r.startOffset <= offset && offset < r.endOffset);
        const inner = ranges.reduce<Range | undefined>((a, r) => (a === undefined || r.endOffset - r.startOffset < a.endOffset - a.startOffset ? r : a), undefined);
        if ((inner?.count ?? 0) > 0) branches.push(`${file}: "${at}" x${inner!.count}`);
      }
    }
  }
  return { fns: [...fns].sort(), branches, counts };
}
/** The path's V8 counts so far in this step, kept across each double's own work. */
let measured: Take[] = [];
/**
 * A double's own work, outside the measure. A double stands in for a served route whose body is out of scope, and V8 counts a FILE
 * whichever module instance runs it: the register double computes this tree's receipt hash with graph-hash.ts itself. Each take
 * runs synchronously inside `post`, so nothing else runs between the two.
 */
function asDouble<T>(work: () => T): Promise<T> {
  const before = take(MEASURED_FILES);
  const out = work();
  const own = take(new Set());
  return before.then((t) => { measured.push(t); return own; }).then(() => out);
}

// ── THE HARNESS: the minimum of `core-turn.route.test.ts` (the store as the database, scripted provider, read / versions doubles). ─
let SCENARIO = '';
let persisted: Json | null = null;
/** Every committed graph write (the register's, through the store), in order: its turn id and the version its commit minted. */
const registered: { readonly turn_id: string; readonly version_id: string; readonly mutation_id: string }[] = [];
const turnRows = new Map<string, any>();
const fenceRows = new Map<string, { generation: number; stopped_at: string | null }>();
let fenceGeneration = 0;
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
/** The next graph write's acknowledgement is lost after it committed (the commit answers with an error): once, then cleared. */
let loseAck = false;
/** Every route served in process, by its pattern; every outbound HTTP call, by its path. */
const dispatched: string[] = [];
const outbound: string[] = [];
/** A program's revision, as the served read and register give it (`programRevisionOf`, else the graph's own hash). */
const revisionOf = (g: unknown): string => programRevisionOf(g) ?? computeAnalysisAffectingGraphHash(g as never) ?? '';

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: BAKERY_BRIEF }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => [...turnRows.values()].reverse()),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (_sid: string, id: string, hash: string) => { if (turnRows.get(id)?.request_hash === hash) turnRows.delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    // The commit's own fence gate (append_turn_atomic_v4): a graph write under a stopped turn's handle is refused in the transaction.
    const bound = write.graph != null ? currentTurnFence() : undefined;
    if (bound !== undefined && [...fenceRows.values()].some((r) => r.generation === bound.generation && r.stopped_at !== null)) {
      throw new TurnFenceRejectedError('turn stopped', { verdict: 'stopped', generation: bound.generation, maxGeneration: null });
    }
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date(Date.now() + turnRows.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    if (write.graph == null) return { id: row.id };
    persisted = write.graph as Json;
    // The version the commit mints (append_turn_atomic_v5's receipt), from the carrier the register built.
    const v = write.modelVersion as Json | undefined;
    const n = registered.length + 1;
    registered.push({ turn_id: key, version_id: `v_${n}`, mutation_id: String(v?.mutation_id ?? `m_${n}`) });
    if (loseAck) { loseAck = false; throw new Error('the commit\'s acknowledgement was lost'); }
    return { id: row.id, ...(v === undefined ? {} : { modelVersionReceipt: { ...v, version_id: `v_${n}`, version_number: n, creation_kind: n === 1 ? 'initial' : 'committed_mutation',
      source_version_id: null, parent_version_id: n === 1 ? null : `v_${n - 1}`, root_version_id: 'v_1', undo_version_id: null, graph: write.graph, event_id: `e_${n}` } }) };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  claimTurnFence: vi.fn(async (sid: string, tid: string) => {
    if (!fenceRows.has(`${sid}:${tid}`)) fenceRows.set(`${sid}:${tid}`, { generation: ++fenceGeneration, stopped_at: null });
    return { scenarioId: sid, turnId: tid, generation: fenceRows.get(`${sid}:${tid}`)!.generation };
  }),
  turnFenceRowExists: vi.fn(async (sid: string, tid: string) => fenceRows.has(`${sid}:${tid}`)),
  markTurnStopped: vi.fn(async (sid: string, tid: string) => {
    const row = fenceRows.get(`${sid}:${tid}`);
    fenceRows.set(`${sid}:${tid}`, { generation: row?.generation ?? ++fenceGeneration, stopped_at: '2026-10-27T10:00:00.000Z' });
    return { stopped: true, claimed: row !== undefined, alreadyCommitted: false };
  }),
  isTurnStopped: vi.fn(async (sid: string, tid: string) => (fenceRows.get(`${sid}:${tid}`)?.stopped_at ?? null) !== null),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));

let served = 0;
let preparedId = '';
let canonicalDraft: string | undefined;
let outputs: Json[][] = [];
let sent: Json[] = [];
/** When set, the next provider call waits for it: a turn still running while its Stop is sent. */
let holdProvider: Promise<void> | undefined;
const ANSWER = 'The model holds the oven price as a question.';
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: JSON.stringify(item.name === 'apply_change' && item.args === undefined ? { proposal_id: preparedId } : item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The served read's PROGRAM branch (`assist.v1.scenario-graph.ts`: `programAnalysisRead` and the response body): no legacy reader. */
function graphRead(): Json {
  if (persisted === null) return { scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  const identity = computeGraphIdentityHash(persisted as never)!;
  const ready = programReadinessOf(persisted);
  return { schema: 'scenario_graph.v1', scenario_id: SCENARIO, graph: toOutboundGraph(persisted), graph_present: true, brief_text: BAKERY_BRIEF,
    graph_identity_hash: identity, content_hash: identity.value, graph_hash: revisionOf(persisted),
    analysis_state: null, analysis_result: null, canonical_analysis_view: reopenProgram(persisted)?.view ?? null,
    current_read: { run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [], ...(ready === undefined ? {} : { analysis_ready: ready }) } };
}
/** The route's own turn-fence reader and refusal (after `resetModules`): the register commits a core turn's write under the turn's handle. */
let currentTurnFence: () => { readonly generation: number | null } | undefined = () => undefined;
let TurnFenceRejectedError: new (message: string, evaluation: { verdict: 'stopped'; generation: number | null; maxGeneration: number | null }) => Error = Error as never;

type Step = { readonly name: string; readonly status: number; readonly retired: readonly string[]; readonly used: readonly string[]; readonly shared: Readonly<Record<string, number>>; readonly hashCallers: readonly string[] };
const steps: Step[] = [];

// Each step takes V8's counts several times (once around every double), so a row runs for seconds: never vitest's 5 s default.
describe('W5: on the real core route, no retired behaviour governs an alpha operation', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    inspector.connect();
    await inspector.post('Profiler.enable');
    await inspector.post('Debugger.enable');
    await inspector.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      outbound.push(String(url).replace(/\/v1\/conversations\/[^/]+/, '/v1/conversations/:id'));
      if (String(url).endsWith('/v1/conversations')) return json({ id: `conv_${randomUUID()}`, object: 'conversation' });
      if (/\/v1\/conversations\/[^/]+\/items$/.test(String(url))) return json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      if (body.text?.format?.name === 'canonical_model') { sent.push(body); return json(responsesBody(canonicalDraft === undefined ? [] : [{ type: 'message', text: canonicalDraft }])); }
      if (body.text?.format?.type === 'json_schema') return json(responsesBody([]));
      sent.push(body);
      if (holdProvider !== undefined) { const hold = holdProvider; holdProvider = undefined; await hold; }
      const next = outputs.shift() ?? [{ type: 'message', text: ANSWER }];
      if (next[0]?.type === 'refuse') return json({ error: { message: 'Refused.', type: 'invalid_request_error', param: null, code: null } }, 400);
      return json(responsesBody(next));
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    // The traps go on the module instances the route is about to load: the retired entry points, then the used ones.
    for (const r of [...RETIRED, ...USED, ...SHARED_TRAPS]) {
      vi.doMock(join(SRC, r.file), async (importOriginal: () => Promise<Record<string, unknown>>) => {
        loaded.add(r.file);
        return trapModule(await importOriginal(), r.file, r.fns);
      });
    }
    const route = await import('../core-turn.js');
    // The real Stop handler (route-v2's `/orchestrate/v2/turn/stop` body), over the same store, as the route harness mounts it.
    const { recordExplicitTurnStop } = await import('../turn-stop.js');
    ({ currentTurnFence, TurnFenceRejectedError } = await import('../../orchestrator-v5/session/turn-fence.js') as never);
    const registerRoute = (await import('../assist.v1.scenario-graph-register.js')).default;
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => { dispatched.push(req.routeOptions.url ?? req.url); });
    app.post('/assist/v1/scenarios/:id/graph', async () => asDouble(graphRead));
    await registerRoute(app);
    app.post('/assist/v1/scenarios/:id/versions', async () => asDouble(() => ({ versions: registered.map((r, i) => ({
      version_id: r.version_id, sequence: i + 1, created_at: '2026-10-27T10:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: r.mutation_id, source_turn_id: r.turn_id } })) })));
    app.post('/orchestrate/v2/turn/stop', async (req, reply) => { const r = await recordExplicitTurnStop(req, 'req-stop'); return reply.code(r.status).send(r.body as never); });
    await app.register(route.coreTurnRoute);
    await app.ready();
    phase = 'ready';
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = null; canonicalDraft = undefined; registered.length = 0; fenceRows.clear(); turnRows.clear(); conversationIds.clear();
    pausedRun = null; outputs = []; sent = []; preparedId = ''; loseAck = false; holdProvider = undefined;
  });

  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const typed = (message: string, turnId = randomUUID()) => post({ turn_id: turnId, message, source: 'composer' });
  const pressOf = (card: Json): Json => ({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
    chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
  const runPress = (): Json => ({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
  const canvasEdit = (value: number) => post({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'factor_value_edit', target_id: 'base_sales', raw_value: value } });
  const storedRuns = (): number => savedProgramOf(persisted)!.runs.length;
  const figure = (id: string): number | null => savedProgramOf(persisted)!.canonical.quantities.find((x) => x.id === id)!.value;
  /** The saved model as one saved before its Run (a figure moved, the Runs kept): its newest stored Run is no longer current. */
  const staleRun = (): void => {
    const p = savedProgramOf(persisted)!;
    persisted = postimageOf({ ...p, canonical: { ...p.canonical, quantities: p.canonical.quantities.map((x) => (x.id === 'base_sales' ? { ...x, value: (x.value ?? 0) + 7 } : x)) } }) as Json;
    expect(reopenProgram(persisted)!.current, 'the stored Run is from an earlier revision').toBe(false);
  };
  const answer = (value: number, quote: string): Json => ({ public_label: `Oven price ${quote}`, basis: 'their answer', request: '', remove: [],
    answers: [{ id: 'oven_price', value, low: null, high: null, range_kind: null, party: null, quote, basis: null, status: 'known', author: 'person' }] });

  /** One operation through the route, on both instruments: every retired call, function and branch it reached, and the used entries'. */
  const step = async (name: string, run: () => Promise<{ statusCode: number; json: () => unknown }>): Promise<Json> => {
    await take(new Set());
    measured = [];
    const c0 = calls.length;
    phase = name;
    const r = await run();
    phase = 'ready';
    measured.push(await take(MEASURED_FILES));
    const fns = new Set(measured.flatMap((t) => t.fns));
    const ofCalls = calls.slice(c0);
    // The legacy analysis hash: allowed only at the RUNS_DECIDES_NOTHING sites; the A3 categoriser never (it decides by it).
    const hashCalls = ofCalls.filter((c) => LEGACY_HASH.has(c.id));
    const hashRan = hashCalls.some(decidesNothing);
    const shared: Record<string, number> = {};
    for (const t of measured) for (const [k, n] of Object.entries(t.counts)) shared[k] = (shared[k] ?? 0) + n;
    steps.push({ name, status: r.statusCode,
      retired: [...new Set([
        ...ofCalls.filter((c) => RETIRED_FNS.has(c.id) && !(hashRan && HASH_INNER_CALLS.has(callKey(c)))).map((c) => `trap ${c.id} <- ${c.site}`),
        ...hashCalls.filter((c) => !decidesNothing(c)).map((c) => `decides ${c.id} <- ${c.site}`),
        ...ofCalls.filter((c) => c.id.endsWith('#categoriseGraphCasWrite')).map((c) => `decides ${c.id} <- ${c.site}`),
        ...[...fns].filter((f) => RETIRED_FNS.has(f) && !(hashRan && HASH_INNER_FNS.has(f))).map((f) => `ran ${f}`),
        ...measured.flatMap((t) => t.branches).map((b) => `branch ${b}`)])].sort(),
      used: [...new Set([...ofCalls.filter((c) => USED_FNS.has(c.id)).map((c) => `trap ${c.id}`), ...[...fns].filter((f) => USED_FNS.has(f) || f === REGISTER).map((f) => `ran ${f}`)])].sort(),
      shared, hashCallers: [...new Set(hashCalls.map((c) => `${c.id} <- ${c.site.replace(/:\d+$/, '')}`))].sort() });
    return r.json() as Json;
  };
  /** The draft every row starts from: the canonical drafter's first model, saved, with its reading card held. */
  const draft = async (): Promise<Json> => {
    canonicalDraft = JSON.stringify(bakery());
    const d = await step('a first draft', () => typed(BAKERY_BRIEF));
    expect(steps.at(-1)!.status, JSON.stringify(d._agent)).toBe(200);
    return d;
  };
  const readingCardOf = (d: Json): Json => { const c = (d.cards as Json[]).find((x) => x.reading === true); expect(c, JSON.stringify(d.cards)).toBeDefined(); return c!; };
  /** A card holding their answer, proposed on a typed turn. */
  const propose = async (): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: answer(2500, '£2,500') }], [{ type: 'message', text: 'I prepared that change.' }]];
    const p = await step('a card proposed', () => typed('The second oven would cost £2,500.'));
    const card = (p.cards as Json[]).find((c) => c.reading !== true);
    expect(card, JSON.stringify(p._agent)).toBeDefined();
    preparedId = String(card!.proposal_id);
    return card!;
  };
  const approve = async (name: string, press: Json): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: `apply_${randomUUID()}` }], [{ type: 'message', text: 'Saved.' }]];
    return step(name, () => post(press));
  };

  it('SETUP + CONTRAST: every trap is on the instance the route loads, and a direct call into EACH retired entry point shows on both instruments (each trap can go RED)', async () => {
    for (const r of [...RETIRED, ...USED, ...BRANCHES]) expect(existsSync(join(SRC, r.file)), r.file).toBe(true);
    for (const b of BRANCHES) for (const at of b.at) expect(readFileSync(join(SRC, b.file), 'utf8'), `${b.file}: ${at}`).toContain(at);
    // Loaded by the route's own module graph (no-load is NOT the claim): the legacy engine, PLoT, ISL and the readiness assessor.
    for (const f of ['routes/agent-v1-turn.ts', 'orchestrator/plot-client.ts', 'adapters/isl/counterfactual-client.ts', 'orchestrator/tools/analysis-ready-helper.ts',
      'orchestrator-v5/tools/registry.ts', 'orchestrator-v5/path-b/living-model/view.ts']) expect(loaded, f).toContain(f);
    // Any argument read throws, so no entry point gets past its first use of its input (and validateGraph's body fails before undici).
    const poison = new Proxy({}, { get: () => { throw new Error('contrast: not a real input'); } });
    const missing: string[] = [];
    for (const r of RETIRED) {
      const mod = await import(/* @vite-ignore */ join(SRC, r.file)) as Record<string, unknown>;
      for (const fn of r.fns) {
        const f = mod[fn];
        if (typeof f !== 'function') { missing.push(`${r.file}#${fn}: not a function`); continue; }
        await take(new Set());
        const c0 = calls.length;
        try { await (f as (...a: unknown[]) => unknown)(fn === 'validateGraph' ? { big: 1n } : poison, poison, poison); } catch { /* the call is what counts */ }
        const ran = (await take(new Set([r.file]))).fns;
        if (!calls.slice(c0).some((c) => c.id === `${r.file}#${fn}`)) missing.push(`${r.file}#${fn}: no trap call`);
        if (!ran.includes(`${r.file}#${fn}`)) missing.push(`${r.file}#${fn}: V8 counted no run`);
        calls.length = c0;
      }
    }
    expect(missing).toEqual([]);
    // CONTRAST for the branch traps: each can go RED. A goal write whose basis was not prepared from stored provenance reaches the
    // hook's repair and its refusal.
    const hb = await import('../../orchestrator-v5/goal-target/horizon-basis-provenance.js');
    await take(new Set());
    try { hb.assertDoorProvenance({ nodes: [{ id: 'g', kind: 'goal', horizon_basis: { bound_months: 6 } }] }, null, 's'); } catch { /* the refusal is what counts */ }
    const hit = (await take(MEASURED_FILES)).branches;
    for (const at of ['delete node.horizon_basis', 'horizon_basis graph write is not prepared from stored provenance']) {
      expect(hit, at).toEqual(expect.arrayContaining([expect.stringContaining(`"${at}"`)]));
    }
    expect(outbound, 'the contrast made no outbound call').toEqual([]);
  });

  it('⭐ a first draft, the approval of the card it held, a card proposed and approved, an edit, a Run press (current, then stale) and a replay: each succeeds as the route says', async () => {
    const drafted = await draft();
    expect(registered, 'the draft saved once').toHaveLength(1);
    const reading = readingCardOf(drafted);
    preparedId = String(reading.proposal_id);
    const confirmed = await approve('the approval of the card the draft held', pressOf(reading));
    expect(confirmed.receipts, JSON.stringify(confirmed._agent)).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
    const card = await propose();
    const press = pressOf(card);
    const saves = registered.length;
    const approved = await approve('the approval of a card', press);
    expect([approved.receipts, registered.length - saves, figure('oven_price')], JSON.stringify(approved._agent))
      .toEqual([[expect.objectContaining({ authorised_by: 'person' })], 1, 2500]);
    // An edit: the person's own figure on the canvas, saved with a new Run, no model call.
    const before = sent.length;
    const edited = await step('an edit (a canvas figure)', () => canvasEdit(320));
    expect([steps.at(-1)!.status, figure('base_sales'), sent.length - before], JSON.stringify(edited)).toEqual([200, 320, 0]);
    // A Run press on a current Run: that Run, shown as stored, nothing written; on a stale one, a NEW Run, saved with the model.
    const runs = storedRuns();
    outputs = [[{ type: 'message', text: 'Each option, by the Run.' }]];
    const shown = await step('a Run press, current Run', () => post(runPress()));
    expect([shown.error, shown.model_program?.stored, storedRuns()], JSON.stringify(shown._agent)).toEqual([null, true, runs]);
    staleRun();
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    const ran = await step('a Run press, stale Run', () => post(runPress()));
    expect([ran.error, ran.model_program?.saved, storedRuns()], JSON.stringify(ran._agent)).toEqual([null, true, runs + 1]);
    // A replay: the approval's press resent with its own turn id answers from its record: no model call, no write.
    const [sentBefore, writesBefore] = [sent.length, registered.length];
    const again = await step('a replay (the same press resent)', () => post(press));
    expect([again.durability, sent.length, registered.length]).toEqual(['replayed', sentBefore, writesBefore]);
  });

  it('a recovery: a save whose acknowledgement was lost after it committed is proved by its own version and readback, and said with that receipt', async () => {
    await draft();
    staleRun();
    loseAck = true;
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    const saves = registered.length;
    const recovered = await step('a recovery (an acknowledgement lost after commit)', () => post(runPress()));
    expect([steps.at(-1)!.status, recovered.error, registered.length - saves], JSON.stringify(recovered._agent)).toEqual([200, null, 1]);
    expect(recovered.receipts, 'the save, found by its own operation').toEqual([expect.objectContaining({ version_id: `v_${registered.length}`, authorised_by: 'person' })]);
    expect(loseAck, 'the acknowledgement was lost').toBe(false);
  });

  it('negatives: a press whose words are not the card\'s own, a press on a card no longer waiting, and a reply lost after its save', async () => {
    const drafted = await draft();
    const reading = readingCardOf(drafted);
    const refused = await step('a press whose words are not the card\'s own', () => post({ ...pressOf(reading), message: 'Something else entirely.' }));
    expect([steps.at(-1)!.status, refused.error]).toEqual([409, expect.objectContaining({ code: 'CARD_NOT_WAITING', nothing_saved: true })]);
    const card = await propose();
    await approve('the approval of a card', pressOf(card));
    const stale = await step('a press on a card no longer waiting (already applied)', () => post(pressOf(card)));
    expect([steps.at(-1)!.status, stale.error]).toEqual([409, expect.objectContaining({ code: 'CARD_NOT_WAITING', nothing_saved: true })]);
    staleRun();
    outputs = [[{ type: 'refuse' }]];
    const lost = await step('a reply lost after its save', () => post(runPress()));
    expect([steps.at(-1)!.status, lost.error]).toEqual([502, expect.objectContaining({ message: 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.', nothing_saved: false })]);
  });

  it('a Stop: the person stops a card\'s approval while its call is out; the write the AI then makes commits nothing', async () => {
    await draft();
    const card = await propose();
    const press = pressOf(card);
    let release!: () => void;
    holdProvider = new Promise<void>((resolve) => { release = resolve; });
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
    const saves = registered.length;
    const before = sent.length;
    const a = await step('a Stop', async () => {
      const approval = post(press);
      await vi.waitFor(() => expect(sent.length).toBe(before + 1));
      const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: press.turn_id } });
      expect(stop.json()).toMatchObject({ stopped: true, claimed: true, turn_id: press.turn_id });
      release();
      return approval;
    });
    expect([registered.length - saves, figure('oven_price'), a.receipts], JSON.stringify(a._agent)).toEqual([0, null, []]);
  });

  it('⭐ THE CLAIM across every operation above, on both instruments: no retired entry point, function, branch or analysis decision; the legacy hash only where it decides nothing; the positive controls show calls at each', () => {
    const names = steps.map((s) => s.name);
    // What executes and decides nothing, with its V8 count per step, and anything retired (W5_PROOF_OUT, when set, receives the table).
    const table = steps.map((s) => ({ step: s.name, status: s.status, retired: s.retired, shared: s.shared, legacy_hash_callers: s.hashCallers }));
    if (process.env.W5_PROOF_OUT) writeFileSync(process.env.W5_PROOF_OUT, JSON.stringify({ runs_decides_nothing: RUNS_DECIDES_NOTHING, hash_inner: HASH_INNER, steps: table }, null, 1));
    for (const must of ['a first draft', 'the approval of the card the draft held', 'the approval of a card', 'an edit (a canvas figure)', 'a Run press, stale Run',
      'a replay (the same press resent)', 'a recovery (an acknowledgement lost after commit)', 'a press on a card no longer waiting (already applied)', 'a Stop']) {
      expect(names, must).toContain(must);
    }
    expect(steps.map((s) => [s.name, s.retired])).toEqual(steps.map((s) => [s.name, []]));
    for (const s of steps) {
      expect(s.used.filter((u) => CONTRACT.some((c) => u.endsWith(c))), `${s.name}: the contract, on both instruments`)
        .toEqual(expect.arrayContaining([expect.stringMatching(/^trap /), expect.stringMatching(/^ran /)]));
    }
    for (const s of steps.filter((x) => ['a first draft', 'the approval of the card the draft held', 'the approval of a card', 'an edit (a canvas figure)',
      'a Run press, stale Run', 'a recovery (an acknowledgement lost after commit)', 'a reply lost after its save'].includes(x.name))) {
      expect(s.used, `${s.name}: the program save, on both instruments, through the REAL register route`).toEqual(expect.arrayContaining([`trap ${SAVE}`, `ran ${SAVE}`, `ran ${REGISTER}`]));
      expect(s.shared[SHARED_TRAPS[1]!.file + '#computeExpectedGraphIdentityHash'] ?? 0, `${s.name}: the register's CAS base, by identity alone`).toBeGreaterThan(0);
    }
    for (const s of steps) for (const c of s.hashCallers) expect(RUNS_DECIDES_NOTHING.some((r) => c.startsWith(`${r.callee} <- ${r.caller}`)), `${s.name}: ${c}`).toBe(true);
    // No legacy turn engine was dispatched to, and nothing was called out but the provider (no PLoT, no ISL).
    expect(dispatched.filter((d) => d === '/agent/v1/turn' || d === '/orchestrate/v2/turn')).toEqual([]);
    const paths = [...new Set(outbound.map((u) => new URL(u).pathname))];
    expect(paths, 'the provider was called').toContain('/v1/responses');
    expect(paths.filter((p) => !['/v1/conversations', '/v1/conversations/:id/items', '/v1/responses'].includes(p))).toEqual([]);
  });

  it('⭐ RUNS, DECIDES NOTHING: a save over a saved program computes the legacy hash at exactly the listed sites (each observed by callee, caller and line), and the register\'s CAS base never does', async () => {
    await draft();
    staleRun();
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    const c0 = calls.length;
    expect((await post(runPress())).statusCode).toBe(200);
    const hash = calls.slice(c0).filter((c) => LEGACY_HASH.has(c.id));
    for (const r of RUNS_DECIDES_NOTHING) expect(hash.some((c) => decidesNothing(c) && c.id === r.callee && c.site.startsWith(`${r.caller}:`)), `${r.where}: observed`).toBe(true);
    expect(hash.filter((c) => !decidesNothing(c)).map((c) => `${c.id} <- ${c.site}`), 'no other site').toEqual([]);
    expect(calls.slice(c0).filter((c) => c.id === `${SHARED_TRAPS[1]!.file}#computeExpectedGraphIdentityHash`).map((c) => c.site.replace(/:\d+:\d+$/, '')),
      'the base, by identity alone, at the register').toEqual(['routes/assist.v1.scenario-graph-register.ts']);
  });

  it('module level (the load; no-load is NOT the claim): no alpha code calls a retired entry point while the route loads, and the load calls out to nothing', () => {
    const atLoad = calls.filter((c) => c.phase === 'import' && RETIRED_FNS.has(c.id));
    const alpha = /^(orchestrator-v5\/(model-program|model-program-turn|core-route)\/|routes\/core-turn\.ts:)/;
    expect(atLoad.filter((c) => alpha.test(c.site)).map((c) => `${c.id} <- ${c.site}`)).toEqual([]);
    // What a retired module does at its own load is its own (a frozen constant): measured 27 Oct, one, within the legacy read.
    expect(atLoad.map(callKey)).toEqual(['routes/canonical-analysis-view.ts#projectCanonicalAnalysisView <- routes/scenario-graph-analysis-read.ts']);
  });
});
