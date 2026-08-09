/**
 * COLLAB U-S0 — the production store (Supabase, service-role).
 *
 * Implements the `CollabStore` port against the U-S0 tables. Constructed
 * LAZILY, at call time, exactly like the decision-records and model-management
 * stores: importing a route module must never require SUPABASE_* to be set.
 *
 * ⚠ THAT LAZINESS IS WHAT MAKES THE CEE HALF SAFE TO DEPLOY BEFORE THE
 * MIGRATION RUNS. Nothing here touches the new tables at boot; the routes mount
 * and sit inert until a request arrives. A CEE deploy with no migration and no
 * UI caller changes nothing for any existing user.
 *
 * ── WRITES GO THROUGH THE SERVICE ROLE ONLY ───────────────────────────────
 * The tables carry FORCE RLS, owner-only SELECT for `authenticated`, and NO
 * write grant for any JWT role. Participants hold no Supabase identity at all,
 * so there is nothing for RLS to hide from them — blindness is a property of
 * the response shape, enforced in `packet-read-model.ts`, and the DB posture is
 * the second, independent line.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getModelManagementService } from '../orchestrator-v5/model-management/index.js';
import {
  refuse,
  type CollabParticipant,
  type CollabRound,
  type CollabStore,
  type ElicitationEventRow,
  type ParticipantStatus,
  type RedactionAuditRow,
  type RoundEventRow,
} from './types.js';

/** Fail loud on any Postgres error: a swallowed write is the defect class. */
function must<T>(what: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error !== null) {
    throw new Error(`collab store: ${what} failed: ${res.error.message}`);
  }
  return res.data;
}

interface RoundRecord {
  round_id: string;
  scenario_id: string;
  graph_version_ref: string;
  target_manifest: unknown;
  context_note: string | null;
  status: string;
  created_by: string;
  created_at: string;
}

function toRound(r: RoundRecord): CollabRound {
  return {
    round_id: r.round_id,
    scenario_id: r.scenario_id,
    graph_version_ref: r.graph_version_ref,
    target_manifest: Array.isArray(r.target_manifest)
      ? (r.target_manifest as CollabRound['target_manifest'])
      : [],
    context_note: r.context_note,
    status: r.status as CollabRound['status'],
    created_by: r.created_by,
    created_at: r.created_at,
  };
}

export class SupabaseCollabStore implements CollabStore {
  constructor(private readonly db: SupabaseClient) {}

  async getRound(round_id: string): Promise<CollabRound | null> {
    const { data, error } = await this.db
      .from('elicitation_rounds')
      .select('*')
      .eq('round_id', round_id)
      .maybeSingle();
    if (error !== null) throw new Error(`collab store: getRound failed: ${error.message}`);
    return data === null ? null : toRound(data as RoundRecord);
  }

  async getScenarioOwnerUserId(scenario_id: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('scenarios')
      .select('user_id')
      .eq('id', scenario_id)
      .maybeSingle();
    if (error !== null) throw new Error(`collab store: getScenarioOwner failed: ${error.message}`);
    const userId = (data as { user_id?: string | null } | null)?.user_id;
    return typeof userId === 'string' ? userId : null;
  }

  async insertRound(row: CollabRound): Promise<void> {
    must(
      'insertRound',
      await this.db.from('elicitation_rounds').insert({
        round_id: row.round_id,
        scenario_id: row.scenario_id,
        owner_user_id: row.created_by,
        graph_version_ref: row.graph_version_ref,
        target_manifest: row.target_manifest,
        context_note: row.context_note,
        status: row.status,
        created_by: row.created_by,
        created_at: row.created_at,
      }),
    );
  }

  /**
   * Append a round transition AND move the materialised `status` column.
   * The events are the truth; the column is a read optimisation, written in the
   * same call so the two cannot drift silently.
   */
  async appendRoundEvent(row: RoundEventRow): Promise<void> {
    const round = await this.getRound(row.round_id);
    must(
      'appendRoundEvent',
      await this.db.from('round_events').insert({
        round_id: row.round_id,
        owner_user_id: round?.created_by ?? null,
        transition: row.transition,
        actor: row.actor,
        created_at: row.created_at,
      }),
    );
    must(
      'appendRoundEvent:status',
      await this.db
        .from('elicitation_rounds')
        .update({ status: row.transition })
        .eq('round_id', row.round_id),
    );
  }

  async insertParticipant(row: CollabParticipant): Promise<void> {
    const round = await this.getRound(row.round_id);
    must(
      'insertParticipant',
      await this.db.from('elicitation_participants').insert({
        participant_id: row.participant_id,
        scenario_id: row.scenario_id,
        round_id: row.round_id,
        owner_user_id: round?.created_by ?? null,
        display_name: row.display_name,
        supabase_user_id: row.supabase_user_id,
        token_hash: row.token_hash,
        status: row.status,
        pseudonym: row.pseudonym,
        created_at: row.created_at,
      }),
    );
  }

  private async participantWhere(
    column: string,
    value: string,
    extra?: { round_id?: string; status?: ParticipantStatus },
  ): Promise<CollabParticipant | null> {
    let q = this.db.from('elicitation_participants').select('*').eq(column, value);
    if (extra?.round_id !== undefined) q = q.eq('round_id', extra.round_id);
    if (extra?.status !== undefined) q = q.eq('status', extra.status);
    const { data, error } = await q.maybeSingle();
    if (error !== null) throw new Error(`collab store: participant lookup failed: ${error.message}`);
    return data === null ? null : (data as CollabParticipant);
  }

  async getParticipant(participant_id: string): Promise<CollabParticipant | null> {
    return this.participantWhere('participant_id', participant_id);
  }

  /**
   * ⚠ ROUND SCOPING IS IN THE QUERY. A token minted for round 1 is not merely
   * rejected on round 2 — it is never found there.
   */
  async findActiveParticipantByTokenHash(
    round_id: string,
    token_hash: string,
  ): Promise<CollabParticipant | null> {
    return this.participantWhere('token_hash', token_hash, { round_id, status: 'active' });
  }

  async findParticipantByTokenHash(
    round_id: string,
    token_hash: string,
  ): Promise<CollabParticipant | null> {
    return this.participantWhere('token_hash', token_hash, { round_id });
  }

  async listParticipants(round_id: string): Promise<CollabParticipant[]> {
    const { data, error } = await this.db
      .from('elicitation_participants')
      .select('*')
      .eq('round_id', round_id)
      .order('created_at', { ascending: true });
    if (error !== null) throw new Error(`collab store: listParticipants failed: ${error.message}`);
    return (data ?? []) as CollabParticipant[];
  }

  async appendParticipantStatusEvent(args: {
    participant_id: string;
    status: ParticipantStatus;
    actor: string;
  }): Promise<void> {
    must(
      'appendParticipantStatusEvent',
      await this.db.from('elicitation_participant_events').insert({
        participant_id: args.participant_id,
        status: args.status,
        actor: args.actor,
        created_at: new Date().toISOString(),
      }),
    );
    must(
      'appendParticipantStatusEvent:status',
      await this.db
        .from('elicitation_participants')
        .update({ status: args.status })
        .eq('participant_id', args.participant_id),
    );
  }

  /**
   * ⭐ THE BLIND READ. Scoped to ONE participant in the SQL itself. This is the
   * only event query reachable while a round is open, and it physically cannot
   * return a sibling's row.
   */
  async listOwnEvents(round_id: string, participant_id: string): Promise<ElicitationEventRow[]> {
    const { data, error } = await this.db
      .from('elicitation_events')
      .select('*')
      .eq('round_id', round_id)
      .eq('participant_id', participant_id)
      .order('created_at', { ascending: true });
    if (error !== null) throw new Error(`collab store: listOwnEvents failed: ${error.message}`);
    return (data ?? []) as ElicitationEventRow[];
  }

  /** Reveal-time only. Never reachable from the open-packet path. */
  async listAllRoundEvents(round_id: string): Promise<ElicitationEventRow[]> {
    const { data, error } = await this.db
      .from('elicitation_events')
      .select('*')
      .eq('round_id', round_id)
      .order('created_at', { ascending: true });
    if (error !== null) throw new Error(`collab store: listAllRoundEvents failed: ${error.message}`);
    return (data ?? []) as ElicitationEventRow[];
  }

  async appendElicitationEvent(row: ElicitationEventRow): Promise<void> {
    const round = await this.getRound(row.round_id);
    must(
      'appendElicitationEvent',
      await this.db.from('elicitation_events').insert({
        event_id: row.event_id,
        round_id: row.round_id,
        participant_id: row.participant_id,
        owner_user_id: round?.created_by ?? null,
        event_version: row.event_version,
        kind: row.kind,
        target: row.target,
        belief: row.belief,
        provenance: row.provenance,
        created_at: row.created_at,
      }),
    );
  }

  /**
   * The model's value for each target AT THE PINNED VERSION — not "now". A
   * reveal read weeks later must say what the panel was actually asked about.
   */
  async getModelValuesAtVersion(
    graph_version_ref: string,
    targetIds: string[],
  ): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const id of targetIds) out[id] = null;

    const { data, error } = await this.db
      .from('model_versions')
      .select('graph')
      .eq('id', graph_version_ref)
      .maybeSingle();
    if (error !== null || data === null) return out;

    const graph = (data as { graph?: unknown }).graph;
    const nodes = (graph as { nodes?: unknown[] } | null)?.nodes;
    if (!Array.isArray(nodes)) return out;
    for (const node of nodes) {
      const n = node as { id?: unknown; value?: unknown };
      if (typeof n.id === 'string' && n.id in out && typeof n.value === 'number') {
        out[n.id] = n.value;
      }
    }
    return out;
  }

  /**
   * ROADMAP 2.910 — the EXPLICIT version mint.
   *
   * ⚠ FAILS LOUD RATHER THAN PINNING NOTHING. `saveVersion` is gated by the
   * pre-existing `CEE_MODEL_VERSIONS_ENABLED` flag and returns `disabled` when
   * it is off. A round that shrugged at that and stored a null ref would look
   * minted and mean nothing — which is precisely the failure 2.910 exists to
   * prevent. So: no version, no round.
   */
  async createModelVersion(args: {
    scenario_id: string;
    provenance: 'elicitation_round_mint';
  }): Promise<{ model_version_id: string }> {
    const { data, error } = await this.db
      .from('scenarios')
      .select('graph, user_id')
      .eq('id', args.scenario_id)
      .maybeSingle();
    if (error !== null || data === null) {
      throw new Error('collab store: cannot read scenario graph to pin a round version');
    }
    const row = data as { graph?: unknown; user_id?: string | null };
    if (row.user_id === null || row.user_id === undefined) {
      refuse('collab_guest_scenario', 'This scenario has no owner.');
    }

    const service = getModelManagementService();
    const result = await service.saveVersion({
      scenario_id: args.scenario_id,
      graph: row.graph,
      provenance: args.provenance,
      label: 'Panel round',
    });

    if (result.status === 'disabled') {
      throw new Error(
        'collab store: model versioning is disabled (CEE_MODEL_VERSIONS_ENABLED), so a round cannot pin the graph it asked about. Refusing rather than minting an unpinned round.',
      );
    }
    if (result.status !== 'ok') {
      throw new Error(
        `collab store: could not pin a model version for this round (${result.status}).`,
      );
    }
    const versionId = (result.value as { version_id?: string } | undefined)?.version_id;
    if (typeof versionId !== 'string' || versionId === '') {
      throw new Error('collab store: model version mint returned no id.');
    }
    return { model_version_id: versionId };
  }

  /**
   * Present ONLY so the N-suite can prove the mint never reads it. There is no
   * production caller and there must not be one: this pointer is nullable and,
   * measured, frozen.
   */
  async getScenarioCurrentModelVersionPointer(scenario_id: string): Promise<string | null> {
    const { data } = await this.db
      .from('scenarios')
      .select('current_model_version_id')
      .eq('id', scenario_id)
      .maybeSingle();
    const ptr = (data as { current_model_version_id?: string | null } | null)
      ?.current_model_version_id;
    return typeof ptr === 'string' ? ptr : null;
  }

  /* ── R-1/R-2 erasure ─────────────────────────────────────────────────────
   * The single sanctioned exception to append-only, and the ONLY mutation of
   * persisted participant identity. Routed through a SECURITY DEFINER routine
   * rather than a direct UPDATE so the narrowness, the audit row and the
   * idempotency are properties of the DATABASE, not of this client.
   */
  async redactParticipantDisplayName(participant_id: string, pseudonym: string): Promise<void> {
    const { error } = await this.db.rpc('collab_redact_participant', {
      p_participant_id: participant_id,
      p_pseudonym: pseudonym,
      p_requested_by: 'service',
    });
    if (error !== null) {
      throw new Error(`collab store: redactParticipantDisplayName failed: ${error.message}`);
    }
  }

  /**
   * The audit row is written INSIDE `collab_redact_participant`, in the same
   * transaction as the name detach — so a redaction cannot land unaudited, and
   * an audit row cannot exist for a redaction that did not happen. Writing it
   * from here would be two round trips with a window between them.
   */
  async appendRedactionAuditRow(_row: RedactionAuditRow): Promise<void> {
    /* intentionally a no-op: see above */
  }

  async listRedactionAuditRows(participant_id: string): Promise<RedactionAuditRow[]> {
    const { data, error } = await this.db
      .from('collab_redaction_audit')
      .select('participant_id, requested_by, created_at')
      .eq('participant_id', participant_id)
      .order('created_at', { ascending: true });
    if (error !== null) {
      throw new Error(`collab store: listRedactionAuditRows failed: ${error.message}`);
    }
    return (data ?? []) as RedactionAuditRow[];
  }
}

let cached: CollabStore | null = null;

/** Lazily construct the service-role store. See the module header. */
export function getCollabStore(): CollabStore {
  if (cached !== null) return cached;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (mirrors model-management/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (mirrors model-management/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Collab: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getCollabStore()',
    );
  }
  cached = new SupabaseCollabStore(
    createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
  return cached;
}

/** Test-only: reset the singleton so a subsequent call picks up fresh env. */
export function resetCollabStoreForTests(): void {
  cached = null;
}
