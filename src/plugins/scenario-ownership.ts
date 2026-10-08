/** One HTTP scenario admission authority. Registered after service/HMAC authentication. */
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { preflightEnsureScenario } from '../orchestrator-v5/build-turn-context.js';
import { scenarioAccessDecision } from '../orchestrator-v5/agent-lane/scenario-access.js';
import { resolveOwnershipAuthority, OWNERSHIP_CLAIM_CARVE_OUTS } from '../orchestrator/ownership-authority.js';
import { buildSignInRequiredError, type UserIdentityResolution } from '../orchestrator/user-identity.js';
import { parseRequestExtensions } from '../orchestrator-v5/boundary/request-extensions.js';
import { readIngressTurnIdentity } from '../orchestrator/turn-fence-prehandler.js';
import { MAX_TURN_ID_LENGTH } from '../routes/turn-stop.js';
import { validateIngress } from '../validators/b1.js';
import { stripExtensionFields } from '../orchestrator/route-v2-preflight.js';
import { SCENARIO_DELETED_RECOVERY_BODY } from '../orchestrator/route-v2-preflight.js';
import { verifySupabaseUserJwt, looksLikeJwt } from '../utils/supabase-user-jwt.js';
import { buildErrorV1 } from '../utils/errors.js';
import { getOrGenerateRequestId } from '../utils/request-id.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
type SessionStore = ReturnType<typeof getSessionStore>;

export type ScenarioSnapshot = Awaited<ReturnType<NonNullable<SessionStore['readExistingScenario']>>>;
export type ScenarioIdDeclaration = 'none' | ({
  /** ONLY the graph-read route may admit a verified viewer member. */
  viewerMemberRead?: true;
  /** Existing family store port, preserving injected readers and absence semantics. */
  /** Pure payload admission before creating an unknown scenario; no owner decision. */
  createIfMissing?: (req: FastifyRequest) => boolean;
  readOwner?: (req: FastifyRequest, scenarioId: string) => Promise<string | null | undefined>;
} & ({ from: 'params' | 'body'; key: string } | { derive: (req: FastifyRequest) => Promise<string | undefined> | string | undefined }));
export interface ScenarioAccessContext {
  scenarioId: string;
  ownerUserId: string | null;
  callerUserId: string | null;
  memberRead: boolean;
  snapshot?: ScenarioSnapshot;
}
declare module 'fastify' {
  interface FastifyContextConfig { scenarioId?: ScenarioIdDeclaration }
  interface FastifyRequest { scenarioAccess?: ScenarioAccessContext }
}
const guarded = new WeakSet<FastifyInstance>();
export function installScenarioDeclarationGuard(app: FastifyInstance): void {
  if (guarded.has(app)) return;
  guarded.add(app);
  app.addHook('onRoute', (route: RouteOptions) => {
    const declaration = route.config?.scenarioId;
    if (declaration === undefined || (declaration !== 'none' && (
      !declaration || (typeof ('derive' in declaration ? declaration.derive : undefined) !== 'function' &&
        (!('from' in declaration) || !['body', 'params'].includes(declaration.from) || !declaration.key))
    ))) throw new Error(`Missing or invalid config.scenarioId: ${route.method} ${route.url}`);
    if (declaration !== 'none' && declaration.viewerMemberRead &&
      (route.url !== '/assist/v1/scenarios/:scenario_id/graph' || route.method !== 'POST')) {
      throw new Error(`viewerMemberRead is restricted to POST scenario graph: ${route.method} ${route.url}`);
    }
  });
}
function family(req: FastifyRequest): string { return req.routeOptions.url ?? ''; }
function isTurn(path: string): boolean { return (path.startsWith('/orchestrate/v2/turn') || path.startsWith('/proxy/v5/turn')) && !path.endsWith('/stop'); }
function personal(path: string): boolean { return path.startsWith('/collab/v1/rounds') || path.startsWith('/assist/v1/decision-records') || path.endsWith('/copy'); }
function envelope(reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string) {
  return reply.code(status).send({ error: code, code, message, request_id: getOrGenerateRequestId(req) });
}
function signInRefusal(req: FastifyRequest, reply: FastifyReply, reason: 'missing_token' | 'invalid_token' | 'expired_token' | 'verification_unavailable') {
  const path = family(req);
  if (path === '/agent/v1/turn') return reply.code(401).send({ error: 'SIGN_IN_REQUIRED', detail: reason });
  if (!personal(path)) return reply.code(401).send(buildSignInRequiredError(reason, getOrGenerateRequestId(req)));
  const missing = path.startsWith('/collab/') ? 'Opening or closing a round is owner-only: sign in and retry.'
    : path.endsWith('/copy') ? 'Sign in to keep this decision in your account.'
    : 'Decision records are personal: sign in and retry with your access token.';
  return envelope(reply, req, 401, reason === 'missing_token' ? 'sign_in_required' : reason,
    reason === 'missing_token' ? missing : reason === 'expired_token' ? 'Your session has expired. Sign in again and retry.' : 'That token could not be verified.');
}
function refuse(req: FastifyRequest, reply: FastifyReply, scenarioId: string, reason: string, oracleFailed = false) {
  const path = family(req); const requestId = getOrGenerateRequestId(req);
  if (path.endsWith('/stop')) return reply.code(404).send({ error: { code: 'TURN_STOP_UNKNOWN_SCENARIO', message: 'That turn could not be stopped.', source: 'cee', request_id: requestId } });
  if (isTurn(path)) return reply.code(422).send({
    error: 'INGRESS_CONTRACT_VIOLATION', boundary: 'B1', direction: 'ingress', validator: 'scenario_preflight',
    details: { reason, scenario_id: scenarioId, ...(reason === 'scenario_deleted' ? { recovery: SCENARIO_DELETED_RECOVERY_BODY, recovery_suggestion: SCENARIO_DELETED_RECOVERY_BODY.suggestion } : {}) },
    request_id: requestId, retryable: false,
  });
  if (path === '/agent/v1/turn') return oracleFailed
    ? reply.code(409).send({ error: 'SCENARIO_OWNERSHIP_UNVERIFIABLE', detail: 'Could not verify the scenario. Nothing was changed.' })
    : reply.code(404).send({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
  if (path.startsWith('/collab/')) {
    const action = path.endsWith('/close') ? 'close this round' : path.endsWith('/preview') ? 'preview this round' : 'open a round on it';
    const message = reason === 'scenario_not_found' || path.endsWith('/reveal') || path.endsWith('/disagreement') ? 'No round you own with that id.' : `Only the scenario owner can ${action}.`;
    return envelope(reply, req, 403, 'collab_owner_only', message);
  }
  if (path.startsWith('/assist/v1/decision-records')) {
    if (path.endsWith('/list') || (reason === 'scenario_not_found' && !path.endsWith('/outcome'))) return envelope(reply, req, 404, 'scenario_not_found', 'No such scenario.');
    if (path.endsWith('/outcome')) return reason === 'scenario_not_found'
      ? envelope(reply, req, 404, 'DR404', 'No such decision record.')
      : envelope(reply, req, 403, 'not_record_owner', 'This record belongs to someone else.');
    return envelope(reply, req, 403, 'not_scenario_owner', 'This scenario belongs to someone else.');
  }
  if (path.endsWith('/copy')) return oracleFailed
    ? envelope(reply, req, 503, 'copy_unavailable', 'Your decision could not be copied just now. Try again shortly.')
    : envelope(reply, req, 404, 'scenario_not_copyable', 'There is no guest decision with that id to copy.');
  const versions = path.includes('/versions'); const register = path.endsWith('/graph/register');
  const message = oracleFailed ? (versions ? 'Versions could not be read right now.' : register ? 'The graph could not be registered right now.' : 'The graph could not be read right now.')
    : versions ? 'No readable versions for that scenario.' : register ? 'No registrable graph for that scenario.' : 'No readable graph for that scenario.';
  return reply.code(oracleFailed ? 503 : 404).send(buildErrorV1(oracleFailed ? 'INTERNAL' : 'NOT_FOUND', message, {}, requestId));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const scenarioOwnershipPlugin = fp(async (app: FastifyInstance) => {
  installScenarioDeclarationGuard(app);
  app.addHook('preHandler', async (req, reply) => {
    const declaration = req.routeOptions.config.scenarioId;
    if (declaration === 'none') return;
    if (!declaration) throw new Error('Missing config.scenarioId at request admission');
    const path = family(req); const requestId = getOrGenerateRequestId(req);
    const raw = req.headers.authorization;
    const token = typeof raw === 'string' && /^bearer /i.test(raw) ? raw.slice(7).trim() : '';
    let identity: UserIdentityResolution = { mode: 'service_legacy' };
    if (token && (personal(path) || looksLikeJwt(token))) {
      const verified = await verifySupabaseUserJwt(token);
      if (!verified.ok) return signInRefusal(req, reply, verified.reason);
      identity = { mode: 'verified', userId: verified.userId };
    } else if (personal(path)) return signInRefusal(req, reply, 'missing_token');
    const body = req.body as { user_id?: unknown } | undefined;
    const claimed = typeof body?.user_id === 'string' && body.user_id.length > 0 ? body.user_id : null;
    // Existing named HMAC carve-out, restricted to its declared direct turn/stop scope.
    const hmacScope = OWNERSHIP_CLAIM_CARVE_OUTS.some(c => c.scope.includes(path));
    const authority = resolveOwnershipAuthority(req, hmacScope ? claimed : null, identity);
    const callerUserId = authority.userId;
    if (claimed !== null && identity.mode === 'verified' && claimed !== callerUserId && hmacScope) {
      emit(TelemetryEvents.UserJwtIdentityMismatch, { request_id: requestId, claimed_user_id_prefix: claimed.slice(0, 8), verified_user_id_prefix: callerUserId?.slice(0, 8) });
    }
    req.scenarioAccess = { scenarioId: '', ownerUserId: null, callerUserId, memberRead: false };
    // Stop's bounds precede every scenario read, as in the original helper.
    if (path.endsWith('/stop')) {
      const stop = readIngressTurnIdentity(req.body);
      if (!stop || stop.turnId.length > MAX_TURN_ID_LENGTH) return;
    }
    let scenarioId: string | undefined;
    let snapshot: ScenarioSnapshot | undefined;
    let ownerUserId: string | null | undefined;
    try {
      const rawId = 'derive' in declaration ? await declaration.derive(req) : (req[declaration.from] as Record<string, unknown> | undefined)?.[declaration.key];
      scenarioId = typeof rawId === 'string' ? rawId.trim().toLowerCase() : undefined;
      // A missing derived entity is refused HERE: a second read in the handler
      // must not turn a missing record/round into an unchecked newly-created one.
      if ('derive' in declaration) {
        const params = req.params as { record_id?: string };
        if (path.endsWith('/outcome') && !UUID.test(params.record_id ?? '')) return;
        if (!scenarioId) return refuse(req, reply, '', 'scenario_not_found');
        if (!UUID.test(scenarioId)) throw new Error('Derived scenario id is invalid');
      }
      // Payload-only readiness and malformed direct ids retain handler validation contracts.
      if (!scenarioId || !UUID.test(scenarioId)) {
        req.scenarioAccess.scenarioId = scenarioId ?? '';
        return;
      }
      if (declaration.readOwner) ownerUserId = await declaration.readOwner(req, scenarioId);
      else {
        const store = getSessionStore();
        if (path.endsWith('/stop')) {
          // Stop's existence hardening fails OPEN on a throw. This is separate
          // from the owner oracle, which still fails CLOSED below (base 2.236).
          if (store.scenarioExists) {
            let exists = true;
            try { exists = await store.scenarioExists(scenarioId); }
            catch (err) {
              log.warn({ event: 'v5.turn_fence.stop_existence_read_failed', request_id: requestId, scenario_id: scenarioId, err: String(err) },
                'V5 turn fence — scenario existence read failed; failing OPEN and recording the Stop');
            }
            if (!exists) return refuse(req, reply, scenarioId, 'scenario_not_found');
          }
          if (!store.getScenarioOwner) throw new Error('Scenario ownership reader unavailable');
          ownerUserId = await store.getScenarioOwner(scenarioId);
        } else if (store.readExistingScenario) {
          snapshot = await store.readExistingScenario(scenarioId);
          ownerUserId = snapshot === null ? undefined : snapshot.userId;
        } else {
          // Legacy store port: read-only existence + owner lookup, NEVER an upsert on reads.
          if (!store.scenarioExists || !store.getScenarioOwner) throw new Error('Scenario ownership reader unavailable');
          ownerUserId = await store.scenarioExists(scenarioId) ? await store.getScenarioOwner(scenarioId) : undefined;
        }
        if (ownerUserId === undefined && (isTurn(path) || path === '/agent/v1/turn' || path.endsWith('/graph/register'))) {
          // Invalid requests still reach their existing validator, but cannot create a row first.
          if (declaration.createIfMissing && !declaration.createIfMissing(req)) return;
          if (isTurn(path) || (path === '/agent/v1/turn' && (req.body as { kind?: string })?.kind !== undefined && (req.body as { kind?: string }).kind !== 'message')) {
            if (!parseRequestExtensions(req.body, requestId).ok || !validateIngress(stripExtensionFields(req.body), requestId).ok) return;
          } else if (path === '/agent/v1/turn' && (typeof (req.body as { message?: unknown })?.message !== 'string' || (req.body as { message: string }).message.length === 0)) return;
          const created = await preflightEnsureScenario(scenarioId, callerUserId, requestId, store);
          if (!created.ok) return refuse(req, reply, scenarioId, created.reason, created.reason === 'scenario_ownership_unverifiable');
          ownerUserId = created.ownerUserId ?? null;
          snapshot = undefined;
        }
      }
    } catch (err) {
      log.warn({ event: 'scenario_ownership.read_failed', request_id: requestId, err: String(err) }, 'Scenario ownership reader failed; refusing');
      if (path.startsWith('/collab/') || (path.startsWith('/assist/v1/decision-records') && !path.endsWith('/list'))) throw err;
      return refuse(req, reply, scenarioId ?? '', 'scenario_ownership_unverifiable', true);
    }
    if (ownerUserId === undefined) return refuse(req, reply, scenarioId, 'scenario_not_found');
    // Personal outcome writes require a durable record owner; a null record
    // owner is not a guest scenario to be scored by any signed-in caller.
    if (path.endsWith('/outcome') && ownerUserId === null) return refuse(req, reply, scenarioId, 'scenario_owned_by_other_user');
    let access = scenarioAccessDecision(ownerUserId, callerUserId);
    let memberRead = false;
    if (access !== 'allow' && declaration.viewerMemberRead && identity.mode === 'verified' && ownerUserId !== null) {
      const store = getSessionStore();
      if (store.isScenarioMember) {
        try { memberRead = await store.isScenarioMember(scenarioId, identity.userId); }
        catch (err) { log.warn({ event: 'v5.scenario_graph.member_check_failed', request_id: requestId, scenario_id: scenarioId, err: String(err) }, 'Scenario graph read — membership check failed; refusing'); }
      }
      if (memberRead) { access = 'allow'; log.info({ event: 'v5.scenario_graph.member_read', request_id: requestId, scenario_id: scenarioId }, 'Scenario graph read by a viewer member'); }
    }
    if (access !== 'allow') return refuse(req, reply, scenarioId, callerUserId === null ? 'scenario_requires_authenticated_owner' : 'scenario_owned_by_other_user');
    req.scenarioAccess = { scenarioId, ownerUserId, callerUserId, memberRead, snapshot };
  });
}, { name: 'scenario-ownership' });
