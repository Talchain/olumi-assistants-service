// Revision CAS ships for every graph-bearing append; the seam retains legacy coverage.
export const USE_APPEND_V6 = true;
let appendV6Enabled: boolean = USE_APPEND_V6;

export function useAppendV6(): boolean {
  return appendV6Enabled;
}

/** Test-only seam; restore the shipped default after each v6 test. */
export function __setUseAppendV6ForTest(value: boolean): void {
  appendV6Enabled = value;
}
