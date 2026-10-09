/** One HTTP scenario admission authority. Registered after service/HMAC authentication. */
import fp from 'fastify-plugin';
import { bindWriteCaller, MODEL_WRITE_OWNERSHIP_REFUSAL_BODY, readWriteRefusal, readSuccessfulDoorEntries, recordSuccessfulSave } from '../orchestrator-v5/ownership/door-ownership.js';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { config } from '../config/index.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { markDraftGraphWriteFailed, preflightEnsureScenario } from '../orchestrator-v5/build-turn-context.js';
import { scenarioAccessDecision } from '../orchestrator-v5/agent-lane/scenario-access.js';
import { resolveOwnershipAuthority, OWNERSHIP_CLAIM_CARVE_OUTS } from '../orchestrator/ownership-authority.js';
import { buildSignInRequiredError, type UserIdentityResolution } from '../orchestrator/user-identity.js';
import { readIngressTurnIdentity } from '../orchestrator/turn-fence-prehandler.js';
import { MAX_TURN_ID_LENGTH } from '../routes/turn-stop.js';
import { SCENARIO_DELETED_RECOVERY_BODY } from '../orchestrator/route-v2-preflight.js';
import { verifySupabaseUserJwt, looksLikeJwt } from '../utils/supabase-user-jwt.js';
import { buildErrorV1, isClientAbortError } from '../utils/errors.js';
import { getOrGenerateRequestId } from '../utils/request-id.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
type SessionStore = ReturnType<typeof getSessionStore>;

export type ScenarioSnapshot = Awaited<ReturnType<NonNullable<SessionStore['readExistingScenario']>>>;
export type ScenarioIdDeclaration = 'none' | ({
  /** ONLY the graph-read route may admit a verified viewer member. */
  viewerMemberRead?: true;
  /** Readiness alone may assess a submitted graph when no row exists. */
  allowMissing?: true;
  /** Rewrite a cached derived entity at the same place its handler reads it. */
  rewriteDerived?: (req: FastifyRequest, scenarioId: string) => void;
  /** Existing family store port, preserving injected readers and absence semantics. */
  readOwner?: (req: FastifyRequest, scenarioId: string) => Promise<string | null | undefined>;
} & ({ from: 'params' | 'body'; key: string } | { derive: (req: FastifyRequest) => Promise<string | undefined> | string | undefined }));
export interface ScenarioAccessContext {
  scenarioId: string;
  ownerUserId: string | null;
  callerUserId: string | null;
  caller: { userId: string | null; verified: boolean };
  memberRead: boolean;
  snapshot?: ScenarioSnapshot;
  scenarioMissing?: true;
  /** CREATE-only continuation owned by this hook, invoked after handler validation. */
  provisionIfMissing?: () => Promise<boolean>;
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
    if (declaration !== 'none' && declaration.allowMissing && route.url !== '/assist/v1/graph-readiness') {
      throw new Error(`allowMissing is restricted to graph readiness: ${route.method} ${route.url}`);
    }
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
function ownershipRefusalEvent(req: FastifyRequest, reason: string, scenarioId: string) {
  log.warn({ event: 'scenario_ownership.refused', request_id: getOrGenerateRequestId(req), route_family: family(req), reason, scenario_id_prefix: scenarioId.slice(0, 8) }, 'Scenario ownership admission refused');
}
function signInRefusal(req: FastifyRequest, reply: FastifyReply, reason: 'missing_token' | 'invalid_token' | 'expired_token' | 'verification_unavailable') {
  const path = family(req);
  const declaration = req.routeOptions.config.scenarioId;
  const rawId = declaration && declaration !== 'none' && 'from' in declaration ? (req[declaration.from] as Record<string, unknown> | undefined)?.[declaration.key] : undefined;
  ownershipRefusalEvent(req, reason, canonicalScenarioId(rawId) ?? '');
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
  ownershipRefusalEvent(req, reason, scenarioId);
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
/** PostgreSQL uuid input accepts braces, uppercase, omitted hyphens, and hyphens
 * after four-digit groups; its output is always canonical. See §8.12:
 * https://www.postgresql.org/docs/18/datatype-uuid.html
 * Normalize the complete input class before either admission or handler use. */
export function canonicalScenarioId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Outer whitespace trimming is an application normalisation convenience.
  let value = raw.trim();
  if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
  if (!/^(?:[0-9a-f]{4}-?){7}[0-9a-f]{4}$/i.test(value)) return null;
  value = value.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(value)) return null;
  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const scenarioOwnershipPlugin = fp(async (app: FastifyInstance) => {
  installScenarioDeclarationGuard(app);
  app.addHook('preHandler', async (req, reply) => {
    // Fastify's not-found handler is not a mounted route and has no config.
    // Keep its existing 404 contract; onRoute still rejects undeclared doors.
    if (req.is404) return;
    const declaration = req.routeOptions.config.scenarioId;
    if (declaration === 'none') return;
    if (!declaration) throw new Error('Missing config.scenarioId at request admission');
    const path = family(req); const requestId = getOrGenerateRequestId(req);
    const raw = req.headers.authorization;
    const token = typeof raw === 'string' && /^bearer /i.test(raw) ? raw.slice(7).trim() : '';
    let identity: UserIdentityResolution = { mode: 'service_legacy' };
    if (token && (personal(path) || looksLikeJwt(token))) {
      const verified = await verifySupabaseUserJwt(token);
      if (!verified.ok) {
        emit(TelemetryEvents.UserJwtRefused, { request_id: requestId, reason: verified.reason });
        return signInRefusal(req, reply, verified.reason);
      }
      emit(TelemetryEvents.UserJwtVerified, { request_id: requestId });
      identity = { mode: 'verified', userId: verified.userId };
    } else if (personal(path)) return signInRefusal(req, reply, 'missing_token');
    else if (config.auth?.requireUserJwt === true) {
      // Preserve the existing legacy-service telemetry, independently of the
      // always-on JWT/ownership decision above.
      emit(TelemetryEvents.UserJwtServiceCallerLegacy, { request_id: requestId });
    }
    const body = req.body as { user_id?: unknown } | undefined;
    const claimed = typeof body?.user_id === 'string' && body.user_id.length > 0 ? body.user_id : null;
    // Existing named HMAC carve-out, restricted to its declared direct turn/stop scope.
    const hmacScope = OWNERSHIP_CLAIM_CARVE_OUTS.some(c => c.scope.includes(path));
    const authority = resolveOwnershipAuthority(req, hmacScope ? claimed : null, identity);
    const callerUserId = authority.userId;
    const caller = { userId: callerUserId, verified: authority.basis === 'verified_user_jwt' || authority.basis === 'verified_hmac_service' };
    if (claimed !== null && identity.mode === 'verified' && claimed !== callerUserId && hmacScope) {
      emit(TelemetryEvents.UserJwtIdentityMismatch, { request_id: requestId, claimed_user_id_prefix: claimed.slice(0, 8), verified_user_id_prefix: callerUserId?.slice(0, 8) });
    }
    req.scenarioAccess = { scenarioId: '', ownerUserId: null, callerUserId, caller, memberRead: false };
    // Stop's bounds precede every scenario read, as in the original helper.
    if (path.endsWith('/stop')) {
      const stop = readIngressTurnIdentity(req.body);
      if (!stop || stop.turnId.length > MAX_TURN_ID_LENGTH) return;
    }
    let scenarioId: string | undefined;
    let snapshot: ScenarioSnapshot | undefined;
    let ownerUserId: string | null | undefined;
    // The same owner rule is used for existing rows and a deferred CREATE result.
    const admitOwner = async (owner: string | null, admittedSnapshot?: ScenarioSnapshot): Promise<boolean> => {
      const checkedId = scenarioId;
      if (!checkedId) throw new Error('Scenario id missing at admission');
      if (path.endsWith('/outcome') && owner === null) { refuse(req, reply, checkedId, 'scenario_owned_by_other_user'); return false; }
      let access = scenarioAccessDecision(owner, callerUserId);
      let memberRead = false;
      if (access !== 'allow' && declaration.viewerMemberRead && identity.mode === 'verified' && owner !== null) {
        const store = getSessionStore();
        if (store.isScenarioMember) {
          try { memberRead = await store.isScenarioMember(checkedId, identity.userId); }
          catch (err) { log.warn({ event: 'v5.scenario_graph.member_check_failed', request_id: requestId, scenario_id: checkedId, err: String(err) }, 'Scenario graph read — membership check failed; refusing'); }
        }
        if (memberRead) { access = 'allow'; log.info({ event: 'v5.scenario_graph.member_read', request_id: requestId, scenario_id: checkedId }, 'Scenario graph read by a viewer member'); }
      }
      if (access !== 'allow') { refuse(req, reply, checkedId, callerUserId === null ? 'scenario_requires_authenticated_owner' : 'scenario_owned_by_other_user'); return false; }
      req.scenarioAccess = { scenarioId: checkedId, ownerUserId: owner, callerUserId, caller, memberRead, snapshot: admittedSnapshot };
      return true;
    };
    try {
      const rawId = 'derive' in declaration ? await declaration.derive(req) : (req[declaration.from] as Record<string, unknown> | undefined)?.[declaration.key];
      scenarioId = canonicalScenarioId(rawId) ?? undefined;
      if ('derive' in declaration) {
        // Outcome's own malformed record-id contract remains in its handler.
        const params = req.params as { record_id?: string };
        if (path.endsWith('/outcome') && canonicalScenarioId(params.record_id) === null) return;
        if (!scenarioId) return refuse(req, reply, '', 'scenario_not_found');
        declaration.rewriteDerived?.(req, scenarioId);
      } else {
        if (!scenarioId) {
          // Strict families retain their existing syntax validators (no store calls).
          // The broad-string doors need an explicit refusal before a store/cache read.
          if (typeof rawId === 'string' && rawId.length > 0) {
            if (path === '/collab/v1/rounds') {
              ownershipRefusalEvent(req, 'invalid_scenario_id', '');
              return envelope(reply, req, 400, 'invalid_scenario_id', 'scenario_id is required.');
            }
            if (path === '/agent/v1/turn' || path === '/assist/v1/ask' || path === '/assist/v1/graph-readiness') return refuse(req, reply, '', 'scenario_not_found');
          }
          return;
        }
        // Handler and admission MUST share this exact value, including path parameters.
        (req[declaration.from] as Record<string, unknown>)[declaration.key] = scenarioId;
      }
      req.scenarioAccess.scenarioId = scenarioId;
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
        if (ownerUserId === undefined) {
          const createsHere = path === '/orchestrate/v2/turn' || path.endsWith('/graph/register') ||
            (path === '/agent/v1/turn' && ((req.body as { kind?: unknown })?.kind === undefined || (req.body as { kind?: unknown }).kind === 'message'));
          // Unknown rows have nothing to protect. Provision only at the handler's
          // original post-validation position, then admit the actual RPC-returned owner.
          req.scenarioAccess.scenarioMissing = true;
          if (createsHere) {
            const checkedId = scenarioId;
            let provisioning: Promise<boolean> | undefined;
            req.scenarioAccess.provisionIfMissing = () => provisioning ??= (async () => {
              const created = await preflightEnsureScenario(checkedId, callerUserId, requestId, store);
              if (!created.ok) { refuse(req, reply, checkedId, created.reason, created.reason === 'scenario_ownership_unverifiable'); return false; }
              if (!created.skipped) recordSuccessfulSave();
              return admitOwner(created.ownerUserId ?? null);
            })();
            return;
          }
          // Wrappers dispatch into the checked inner handler; never CREATE here.
          if (isTurn(path) || path === '/agent/v1/turn' || declaration.allowMissing) return;
        }
      }
    } catch (err) {
      // Let the central handler retain its 499/no-5xx classification when
      // a client disconnects during the newly awaited ownership read.
      if (isClientAbortError(err)) throw err;
      log.warn({ event: 'scenario_ownership.read_failed', request_id: requestId, err: String(err) }, 'Scenario ownership reader failed; refusing');
      if (path.startsWith('/collab/') || (path.startsWith('/assist/v1/decision-records') && !path.endsWith('/list'))) throw err;
      return refuse(req, reply, scenarioId ?? '', 'scenario_ownership_unverifiable', true);
    }
    if (ownerUserId === undefined) return refuse(req, reply, scenarioId ?? '', 'scenario_not_found');
    await admitOwner(ownerUserId, snapshot);
  });
  // Complete untouched responses synchronously. An unconditional async hook
  // delays reply.sent on admission refusals and can let the handler continue.
  app.addHook('onSend', (req, reply, payload, done) => {
    const refusal = readWriteRefusal(req);
    if (!refusal) { done(null, payload); return; }
    if (readSuccessfulDoorEntries(req) > 0) {
      log.warn({ event: 'model_write.ownership_refused_after_commit', reason: refusal.reason,
        request_id: getOrGenerateRequestId(req), route_family: family(req) },
      'Model write ownership refused after an earlier successful door entry');
      done(null, payload);
      return;
    }
    const body = JSON.stringify(MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[refusal.reason]);
    // Already mapped paths retain their bytes and their existing terminal mark.
    if (reply.statusCode === 403 && payload === body) { done(null, payload); return; }
    const replace = () => {
      reply.code(403).type('application/json; charset=utf-8');
      reply.removeHeader('content-length');
      done(null, body);
    };
    const fence = refusal.fence;
    if (fence) {
      void markDraftGraphWriteFailed(fence.scenarioId, fence.turnId,
        'model_write_ownership_refused', getOrGenerateRequestId(req), 'turn_dead_only').then(replace, replace);
    } else replace();
  });
  app.addHook('preHandler', (req, _reply, done) =>
    bindWriteCaller(req.scenarioAccess?.caller ?? { userId: null, verified: false }, done, req));
}, { name: 'scenario-ownership' });
