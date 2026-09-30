/**
 * THE AUTHENTIC M1 HOST SEAM — a client of the EXISTING CEE routes, nothing more.
 *
 * Fresh brief → `POST /agent/v1/turn` (the Agent's `build_model_from_brief` → `/graph/register`, the canonical
 * create-only write) → `POST /assist/v1/scenarios/:id/graph` → `POST /assist/v1/scenarios/:id/versions`.
 * No constructor, store, engine or route of its own: the served CEE is the host, so the graph, brief and hashes
 * read back are the ones the product persisted.
 *
 * ⛔ BOUND ⇔ the current model version's `full_hash` equals the graph read's `graph_identity_hash.value`.
 *   Anything else is not a model a card may speak about.
 *
 * ⚠ GUESTS HAVE NO VERSIONS BY DESIGN (`owner_user_id NOT NULL`, MV001 — `src/routes/assist.v1.scenario-versions.ts`
 *   §GUESTS), and the scenario routes take the owner from the verified JWT only. So `bound` needs a signed-in user's
 *   token (`bearer`). Without one the readback is honest about it: `guest_no_version`.
 *
 * Credentials are passed in, never read from argv, never logged, never written to the readback.
 */
import { randomUUID, createHash } from 'node:crypto';

export const READBACK_SCHEMA = 'm1_host_readback.v1';
export const BINDINGS = Object.freeze(['bound', 'guest_no_version', 'mismatch', 'missing']);

function uuidOfSha(input) {
  const b = Buffer.from(createHash('sha256').update(input).digest().subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * The `creation.source_turn_id` a construction's version carries: `registrationTurnId(sid,
 * constructionOperationId(sid, brief))`, the rule `findConstructionVersion` (build-model.ts) reads by. Copied because
 * the Lab launcher runs plain node; `readback.test.mjs` pins it to the TS originals so a drift turns it red.
 */
export function constructionSourceTurnId(scenarioId, brief) {
  const operationId = uuidOfSha(`agent_construction:${scenarioId}:${brief}`);
  return `graph_registration:${uuidOfSha(`graph_registration:${scenarioId}:${operationId}`)}`;
}

function headers({ assistKey, bearer }) {
  const h = { 'content-type': 'application/json' };
  if (assistKey) h['x-olumi-assist-key'] = assistKey;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return h;
}

async function post(ctx, path, body, ms) {
  const r = await ctx.fetchImpl(`${ctx.base}${path}`, {
    method: 'POST', headers: headers(ctx), body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  });
  let json = null;
  try { json = JSON.parse(await r.text()); } catch { json = null; }
  return { http: r.status, json };
}

function context({ base, assistKey, bearer, fetchImpl = fetch }) {
  if (!base) throw new Error('base is required (e.g. https://cee-staging.onrender.com)');
  return { base: base.replace(/\/+$/, ''), assistKey, bearer, fetchImpl };
}

/** Build a model from a fresh brief through the served Agent. Returns what was called, never the credentials. */
export async function buildFromBrief(opts) {
  const ctx = context(opts);
  const scenario_id = opts.scenarioId ?? randomUUID();
  const t = await post(ctx, '/agent/v1/turn', {
    scenario_id, turn_id: randomUUID(), stage: 'frame', turn_class: 'frame', source: 'composer', kind: 'message',
    message: opts.brief,
  }, opts.timeoutMs ?? 300000);
  return {
    scenario_id,
    http: t.http,
    tools: (t.json?._agent?.tool_calls ?? []).map((c) => ({ name: c.name, ok: c.ok !== false })),
    providers: [...new Set((t.json?._provider_calls ?? []).map((p) => p.provider))],
    assistant_message: typeof t.json?.assistant_message === 'string' ? t.json.assistant_message : null,
  };
}

/** Decide the binding from the two reads. Pure, so the Lab and its tests share one rule. */
export function bindingOf({ graphRead, versionsRead, signedIn }) {
  const g = graphRead?.http === 200 ? graphRead.json : null;
  const identity = g?.graph_present === true ? g?.graph_identity_hash?.value ?? null : null;
  if (typeof identity !== 'string' || identity.length === 0) return { version_binding: 'missing', model_version: null };
  const v = versionsRead?.http === 200 ? versionsRead.json : null;
  const versions = Array.isArray(v?.versions) ? v.versions : null;
  if (versions === null) return { version_binding: 'missing', model_version: null };
  if (versions.length === 0) {
    return { version_binding: signedIn ? 'missing' : 'guest_no_version', model_version: null };
  }
  const cur = versions.find((x) => x?.version_id === v.current_version_id) ?? null;
  if (cur === null) return { version_binding: 'missing', model_version: null };
  const model_version = {
    version_id: cur.version_id, sequence: cur.sequence ?? null,
    full_hash: cur.full_hash ?? null, analysis_affecting_hash: cur.analysis_affecting_hash ?? null,
    creation: cur.creation ?? null,
  };
  return { version_binding: cur.full_hash === identity ? 'bound' : 'mismatch', model_version };
}

/** Read the persisted model back. The one object the Lab consumes. */
export async function readback(opts) {
  const ctx = context(opts);
  const sid = opts.scenarioId;
  if (typeof sid !== 'string' || sid.length === 0) throw new Error('scenarioId is required');
  let cee_build = null;
  try {
    const h = await ctx.fetchImpl(`${ctx.base}/healthz`, { signal: AbortSignal.timeout(20000) });
    cee_build = (await h.json())?.build ?? null;
  } catch { cee_build = null; }
  const graphRead = await post(ctx, `/assist/v1/scenarios/${sid}/graph`, {}, opts.timeoutMs ?? 60000);
  const versionsRead = await post(ctx, `/assist/v1/scenarios/${sid}/versions`, {}, opts.timeoutMs ?? 60000);
  const g = graphRead.http === 200 ? graphRead.json : null;
  const { version_binding, model_version } = bindingOf({ graphRead, versionsRead, signedIn: Boolean(ctx.bearer) });
  const briefText = typeof g?.brief_text === 'string' ? g.brief_text : null;
  const sourceTurnId = briefText === null ? null : constructionSourceTurnId(sid, briefText);
  const versions = versionsRead.http === 200 && Array.isArray(versionsRead.json?.versions) ? versionsRead.json.versions : [];
  const built = sourceTurnId === null ? null : versions.find((x) => x?.creation?.source_turn_id === sourceTurnId) ?? null;
  return {
    schema: READBACK_SCHEMA,
    cee_build,
    scenario_id: sid,
    signed_in: Boolean(ctx.bearer),
    http: { graph: graphRead.http, versions: versionsRead.http },
    graph: g?.graph_present === true ? g.graph ?? null : null,
    brief_text: briefText,
    graph_identity_hash: g?.graph_identity_hash ?? null,
    graph_hash: g?.graph_hash ?? null,
    model_version,
    version_binding,
    // The version the brief's construction became (null: guest, not found, or the brief was not built by the Agent).
    construction: {
      source_turn_id: sourceTurnId,
      version_id: built?.version_id ?? null,
      sequence: built?.sequence ?? null,
      is_current: built !== null && built.version_id === model_version?.version_id,
    },
    raw: { graph_read: graphRead.json, versions: versionsRead.json },
  };
}

/** Cards speak only about a bound model. */
export function cardsAllowed(rb) {
  return rb?.schema === READBACK_SCHEMA && rb.version_binding === 'bound';
}

/** Two reads of one scenario name the same model only when every identity field agrees. */
export function sameModel(before, after) {
  return cardsAllowed(before) && cardsAllowed(after)
    && before.scenario_id === after.scenario_id
    && before.graph_identity_hash?.value === after.graph_identity_hash?.value
    && before.model_version?.version_id === after.model_version?.version_id;
}

/**
 * What the Lab says instead of cards (AIQ 5908008371: never a blank pane). `null` when the cards may show.
 */
export function withheldReason(rb) {
  if (cardsAllowed(rb)) return null;
  switch (rb?.version_binding) {
    case 'guest_no_version':
      return 'Not shown: this model is not tied to a saved version. Guest models have no saved versions; sign in to save one.';
    case 'mismatch':
      return 'Not shown: the saved version describes a different model from the one on screen.';
    default:
      return 'Not shown: this model is not tied to a saved version.';
  }
}
