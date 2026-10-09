/** Parked until the provenance-enforcing attestation writer lands. */
export function horizonSteadyAttested(_goal: unknown): boolean {
  // S4 (DL 87114 #2895 P1a): no legitimate writer until S5 2b (#2899) enforces provenance at its one door; any stored triple is forgeable (first-touch append, session append, PostgREST, version restore).
  return false;
}
