export type PolicyId = 'RC-WIDEN' | 'RC-WHAT-CHANGES' | 'RC-STRENGTHEN-ITEM' | 'RC-PREMORTEM' | 'RC-COACH-EDITS';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export type Variant = 'W1' | 'W2Z' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'S1' | 'S2' | 'S3L' | 'S3V';
export type Target = 'options' | 'risks' | 'factors';
export type LinkSizing = 'user' | 'placeholder' | 'olumi_accepted' | 'olumi_estimate' | 'unmarked';
export type ValueAuthorship = 'yours' | 'olumi_estimate' | 'olumi_accepted' | 'unknown';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue | undefined };
export type StateKeyFields = Readonly<Record<string, JsonValue | undefined>>;

export interface GoalPathLink {
  readonly link_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly link_sizing: LinkSizing;
  readonly option_ids: readonly string[];
  readonly goal_distance: number;
  /** Caller-supplied digest of the link's value (#2465 `linkValueHash`); raw values never leave the caller. */
  readonly value_hash?: string;
}
export interface GoalPathFactor {
  readonly factor_id: string;
  readonly label: string;
  readonly value_authorship: ValueAuthorship;
  readonly goal_distance: number;
  readonly value_hash?: string;
}
export interface GoalPathEdit {
  readonly kind: string;
  readonly entity_id: string;
  readonly field: string;
  readonly after_hash: string;
  readonly label?: string;
}
export interface GuidanceRecord {
  readonly status: 'offered' | 'pressed' | 'completed' | 'dismissed';
  readonly state_key_fields?: StateKeyFields;
  readonly state_key_hash?: string;
  readonly turn_id?: string;
}
export type GuidanceState = Readonly<Record<string, GuidanceRecord | undefined>>;

/** Flat named canonical signals, not readers of TurnContext or conversation text. */
export interface GuidanceSignals {
  readonly 'turn.request'?: 'run_result' | 'narration' | 'turn' | 'method';
  readonly 'open.decision_point'?: boolean;
  readonly 'run.kind'?: string | null;
  readonly 'run.leader_licensed'?: boolean;
  readonly 'run.withheld_reason'?: string | null;
  /** Copy/key metadata already present in the acceptance contract. */
  readonly 'run.leader_option_id'?: string | null;
  readonly 'run.run_key'?: string;
  readonly 'run.decision_sensitivity'?: {
    readonly status: 'measured' | 'none_measurable' | 'not_measured' | 'pending';
    readonly most_sensitive?: { readonly factor_id: string; readonly label: string; readonly range?: 'olumi_assumed' | 'yours' };
  };
  readonly 'model.goal_present'?: boolean;
  readonly 'model.goal_label'?: string | null;
  readonly 'model.goal_horizon'?: { readonly deadline?: string; readonly months?: number } | null;
  readonly 'model.status_quo_option_id'?: string | null;
  readonly 'model.non_sq_option_ids'?: readonly string[];
  readonly 'model.option_labels'?: Readonly<Partial<Record<string, string>>>;
  readonly 'model.same_lever'?: boolean;
  readonly 'model.risk_ids'?: readonly string[];
  readonly 'model.goal_path_factor_ids'?: readonly string[];
  readonly 'model.goal_path_links'?: readonly GoalPathLink[];
  readonly 'model.goal_path_factors'?: readonly GoalPathFactor[];
  readonly 'model.placeholder_goal_links'?: readonly string[];
  readonly 'model.link_sizing'?: Readonly<Partial<Record<string, LinkSizing>>>;
  readonly 'model.value_authorship'?: Readonly<Partial<Record<string, ValueAuthorship>>>;
  readonly 'since_run.goal_path_user_edits'?: { readonly status: 'pending' } | { readonly status: 'available'; readonly edits: readonly GoalPathEdit[] };
  readonly guidance?: GuidanceState;
  readonly 'user.explicit_request'?: PolicyId | null;
  /** The option the user picked on choose_plan, or named by pressing a pre-mortem row (#2466 `user_selected_option_id`). */
  readonly 'user.selected_option_id'?: string | null;
}

export interface RenderedCopy { readonly title: string | null; readonly why: string | null; readonly question: string | null }
export interface SelectedRow {
  readonly policy_id: PolicyId;
  readonly variant?: Variant;
  readonly item?: string;
  readonly target?: Target;
  readonly priority: Priority;
  readonly primary_action: { readonly label: string; readonly action_kind: 'choose_1_of_3' | 'edit_inline' | 'discuss'; readonly target?: string; readonly intent?: string | null };
  readonly state_key_hash: string;
  readonly copy: RenderedCopy;
}
export type RowIdentity = Pick<SelectedRow, 'policy_id' | 'variant' | 'item' | 'target'>;
export type SuppressionReason = 'decision_point' | 'request_1' | 'cooldown' | 'budget' | 'pending_signal' | 'not_eligible';
export type MethodMode = 'honest_limit' | 'choose_plan';
export interface Selection {
  readonly slot1?: SelectedRow;
  readonly slot2?: SelectedRow;
  /** Dispatch description only: the leaf never runs a method. */
  readonly runs_method?: PolicyId;
  /** honest_limit: an asked What-changes with no measured factor; choose_plan: an asked pre-mortem with no plan. */
  readonly mode?: MethodMode;
  /** honest_limit only: the item the honest answer offers to firm up (Strengthen pick order S1, S3L, S3V). */
  readonly item?: string;
  /** choose_plan only: the user's options to pick from, sorted by id. Never a plan chosen for the user. */
  readonly choices?: readonly string[];
  readonly suppressed: readonly { readonly policy_id: PolicyId; readonly reason: SuppressionReason }[];
}

export type MethodTurnId = PolicyId | 'RERUN-EXPLANATION' | 'COMPARISON-ANSWER';
/** One grounded input a pre-mortem story may rest on, in action-priority order (`grounded_inputs_shape`). */
export interface SuppliedItem {
  readonly id: string;
  /** Every label must appear: a link carries both end labels, so a story must name both ends. */
  readonly labels?: readonly string[];
  readonly ref?: string;
}
/** Typed text-check inputs. No structured mechanism assertion is accepted here. */
export interface MethodInputs {
  readonly plan_label?: string;
  readonly current_option_labels?: readonly string[];
  readonly current_risk_labels?: readonly string[];
  readonly current_factor_labels?: readonly string[];
  readonly supplied_items?: readonly SuppliedItem[];
  /** shared.label_masking: EVERY node label of the current model (goal, options, factors, risks, outcomes). */
  readonly model_labels?: readonly string[];
  readonly left_out_labels?: readonly string[];
  readonly supplied_figures?: readonly string[];
  readonly user_figures?: readonly string[];
  readonly brief?: string;
  readonly user_messages?: readonly string[];
  readonly variant?: Variant;
  readonly factor_label?: string;
  readonly factor_current_value?: string | number;
  readonly item_labels?: readonly string[];
  readonly item_current_value?: string | number;
  readonly edited_labels?: readonly string[];
  readonly 'run.kind'?: string;
  /** RERUN-EXPLANATION (run_delta): the changed inputs' labels, the attribution case and the comparison's limits. */
  readonly change_labels?: readonly string[];
  /** COMPARISON-ANSWER: how many input-change rows the pair records, named or not (a `presence` row has no template). */
  readonly changes_recorded?: number;
  readonly attribution_case?: 'C0_identical' | 'C1_attributable' | 'C2_unpaired';
  readonly leader_licensed?: boolean;
  readonly noise_verdict?: string;
  readonly prior_withheld?: boolean;
  readonly no_matched_figures?: boolean;
}
export interface MethodTurnCheck {
  readonly pass: boolean;
  readonly failed: string[];
  /** RC-PREMORTEM only: per numbered story, the id of the first supplied item it rests on, else null. */
  readonly targets: (string | null)[];
}
