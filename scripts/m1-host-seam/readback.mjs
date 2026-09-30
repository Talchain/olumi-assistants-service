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

/**
 * A READ retried once on a network error (undici's "fetch failed" — measured once on a Lab host re-attach while staging
 * answered /healthz 200). Never used for the turn: a turn is not a read.
 */
async function read(ctx, path, body, ms) {
  try { return await post(ctx, path, body, ms); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return post(ctx, path, body, ms);
  }
}

async function post(ctx, path, body, ms) {
  // `bearer` may be a token or an async token source (accountTokenSource), resolved per call so a long session refreshes.
  const bearer = typeof ctx.bearer === 'function' ? await ctx.bearer() : ctx.bearer;
  const r = await ctx.fetchImpl(`${ctx.base}${path}`, {
    method: 'POST', headers: headers({ assistKey: ctx.assistKey, bearer }), body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  });
  let json = null;
  try { json = JSON.parse(await r.text()); } catch { json = null; }
  return { http: r.status, json };
}

function context({ base, assistKey, bearer, fetchImpl = fetch }) {
  if (!base) throw new Error('base is required (e.g. https://cee-staging.onrender.com)');
  return { base: base.replace(/\/+$/, ''), assistKey, bearer, fetchImpl };
}

/** One served Agent turn on a scenario. Returns what was called, never the credentials. */
export async function sendTurn(opts) {
  const ctx = context(opts);
  const first = opts.first === true;
  // A chip press travels as the served UI sends it: `{ chip: { id, … } }` beside the message (the typed approval is
  // recognised from `agent-approve-proposal:<id>`, `approval-chips.ts`). The caller decides WHICH chip; this only carries it.
  const t = await post(ctx, '/agent/v1/turn', {
    scenario_id: opts.scenarioId, turn_id: randomUUID(), kind: 'message', message: opts.message,
    ...(first ? { stage: 'frame', turn_class: 'frame', source: 'composer' } : {}),
    ...(opts.chip ? { chip: opts.chip, source: 'chip' } : {}),
  }, opts.timeoutMs ?? 300000);
  return {
    scenario_id: opts.scenarioId,
    http: t.http,
    tools: (t.json?._agent?.tool_calls ?? []).map((c) => ({ name: c.name, ok: c.ok !== false })),
    providers: [...new Set((t.json?._provider_calls ?? []).map((p) => p.provider))],
    assistant_message: typeof t.json?.assistant_message === 'string' ? t.json.assistant_message : null,
    suggested_actions: Array.isArray(t.json?.suggested_actions) ? t.json.suggested_actions : [],
    response: t.json,
  };
}

/** Build a model from a fresh brief through the served Agent, on a new scenario. */
export async function buildFromBrief(opts) {
  return sendTurn({ ...opts, scenarioId: opts.scenarioId ?? randomUUID(), message: opts.brief, first: true });
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
  const graphRead = await read(ctx, `/assist/v1/scenarios/${sid}/graph`, {}, opts.timeoutMs ?? 60000);
  const versionsRead = await read(ctx, `/assist/v1/scenarios/${sid}/versions`, {}, opts.timeoutMs ?? 60000);
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

/** Read a KEY=VALUE account file (600-mode, outside every repo). Values are returned, never logged. */
export function parseAccountFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  for (const k of ['LAB_SUPABASE_URL', 'LAB_SUPABASE_ANON_KEY', 'LAB_EMAIL', 'LAB_PASSWORD']) {
    if (!out[k]) throw new Error(`account file is missing ${k}`);
  }
  return out;
}

/**
 * A signed-in user's access token, refreshed by signing in again when under 5 minutes remain (Supabase tokens last
 * an hour; a Lab session can outlast one). The token is never returned in a readback.
 */
export function accountTokenSource(account, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let token = null, expiresAt = 0;
  return async () => {
    if (token !== null && expiresAt - now() > 5 * 60_000) return token;
    const r = await fetchImpl(`${account.LAB_SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: account.LAB_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.LAB_EMAIL, password: account.LAB_PASSWORD }), signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200 || typeof j.access_token !== 'string') throw new Error(`Lab account sign-in failed (HTTP ${r.status})`);
    token = j.access_token;
    expiresAt = now() + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600) * 1000;
    return token;
  };
}

/**
 * Has the model moved on from the brief's construction? Read from the served history, never from host memory (Build
 * 5908915762: an in-memory "edited" marker is lost on a host restart). True only when the construction's version is found
 * in this scenario's history AND the current version comes after it: that is an edit, so the current version may bind.
 * Otherwise the first M2 may bind only the construction itself.
 */
export function editedSinceConstruction(rb) {
  const c = rb?.construction, mv = rb?.model_version;
  return typeof c?.version_id === 'string' && Number.isInteger(c?.sequence)
    && Number.isInteger(mv?.sequence) && mv.sequence > c.sequence;
}

/**
 * A card press, derived ENTIRELY from what the Agent offered (Build 5910076244, AIQ 5909797932). The pressed id must
 * be one of the LAST reply's `suggested_actions`; the message sent is that card's OWN `message` (the exact reading the
 * user is approving; the route binds these words to the approval), never its label and never a caller's text. A caller
 * message that differs is refused, since it would change what the user authorised. The chip carries only the fields
 * the served UI sends (`id`, `action_type`, `intent`, `parameters`; `buildPayload.ts`).
 */
export function chipPressFor(offeredActions, press) {
  const id = press && typeof press === 'object' ? press.chip?.id ?? press.id : undefined;
  if (typeof id !== 'string' || id.length === 0) return { ok: false, reason: 'no_chip_id' };
  const action = (Array.isArray(offeredActions) ? offeredActions : []).find((a) => a && a.id === id);
  if (action === undefined) return { ok: false, reason: 'not_on_offer' };
  // An APPROVAL card must carry its own words (Build 5910539697): the route binds them to what is authorised, so a
  // label is never a substitute. Other cards (amend, run) fall back to the label the user saw.
  const isApproval = id.startsWith('agent-approve-proposal:');
  const own = typeof action.message === 'string' && action.message.trim() ? action.message : null;
  const message = own ?? (!isApproval && typeof action.label === 'string' && action.label.trim() ? action.label : null);
  if (message === null) return { ok: false, reason: 'card_has_no_words' };
  const callerMessage = press.message;
  if (callerMessage !== undefined && callerMessage !== null && callerMessage !== message) {
    return { ok: false, reason: 'message_differs_from_card' };
  }
  const chip = { id };
  for (const k of ['action_type', 'intent', 'parameters']) if (action[k] !== undefined) chip[k] = action[k];
  return { ok: true, message, chip };
}
