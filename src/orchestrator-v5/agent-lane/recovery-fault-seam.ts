import { getRuntimeEnvResolution, isProductionDeployment, recoveryFaultSeamSwitchOn } from '../../config/env-resolver.js';

/**
 * ⭐ THE RECOVERY FAULT SEAM (DL 20:10Z 15 Oct, for Paul's A6 served recovery proof; map: e2e/verify/RECOVERY-SEAMS.md). Nothing
 * guarded could interrupt a turn on staging at the three windows recovery rests on, so none could be witnessed. This ends ONE
 * outer agent turn at one named point, as a crash there would, and changes nothing else:
 *   · `before_write`: an approval press reached CEE, and its write has not run;
 *   · `after_write`: this turn's write committed, before its automatic Run, coaching and answer;
 *   · `after_run`: this turn's Run is recorded, before its answer is appended.
 * The proof is then the ordinary path: a re-press or retry applies ONCE (`authorisationTurnId`), with no second write, Run or
 * answer, and the readback shows the true state. No store, schema, Stop or fence semantics change.
 *
 * ⛔ IMPOSSIBLE IN PRODUCTION, OFF BY DEFAULT. Armed only when ALL hold:
 *   1. the process is POSITIVELY identified as staging (`env-resolver`: `staging` from a DISCRIMINATING source, never the
 *      NODE_ENV fallback that cannot tell the staging service from production) AND is not the declared production deployment
 *      (`isProductionDeployment`, OLUMI_DEPLOYMENT=production wins over any staging label: BUDDY-A #3262 B1);
 *   2. `CEE_RECOVERY_FAULT_SEAM` is exactly `on` (unset everywhere by default);
 *   3. the request body carries `_recovery_fault: { scenario_id, point }` naming THIS request's own scenario and a known point
 *      (the browser proxy forwards the body and no custom header, so the verifier's harness adds it to the one request it means
 *      to interrupt; every other request, the retry included, runs normally).
 */
export const RECOVERY_FAULT_FIELD = '_recovery_fault' as const;
export const RECOVERY_FAULT_POINTS = ['before_write', 'after_write', 'after_run'] as const;
export type RecoveryFaultPoint = typeof RECOVERY_FAULT_POINTS[number];

/** Thrown at the armed point; the route answers it as an interrupted turn (no answer row), never as a refusal. */
export class RecoveryFaultInterrupt extends Error {
  constructor(readonly point: RecoveryFaultPoint) {
    super(`recovery fault seam: turn interrupted at ${point}`);
    this.name = 'RecoveryFaultInterrupt';
  }
}

/** The point this request arms, or `undefined` (always, unless every condition above holds). */
export function armedRecoveryFault(body: Record<string, unknown>, scenarioId: string): RecoveryFaultPoint | undefined {
  const field = body[RECOVERY_FAULT_FIELD];
  if (field === undefined) return undefined;
  const resolution = getRuntimeEnvResolution();
  if (isProductionDeployment() || resolution.env !== 'staging' || !resolution.discriminating || !recoveryFaultSeamSwitchOn()) return undefined;
  if (field === null || typeof field !== 'object' || Array.isArray(field)) return undefined;
  const { scenario_id: armedFor, point } = field as { scenario_id?: unknown; point?: unknown };
  if (scenarioId === '' || armedFor !== scenarioId) return undefined;
  return (RECOVERY_FAULT_POINTS as readonly unknown[]).includes(point) ? point as RecoveryFaultPoint : undefined;
}

/** Ends the turn here when this request armed THIS point; otherwise does nothing. */
export function interruptIfArmed(armed: RecoveryFaultPoint | undefined, point: RecoveryFaultPoint): void {
  if (armed === point) throw new RecoveryFaultInterrupt(point);
}
