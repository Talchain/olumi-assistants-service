// Slice ii-a ships the existing v5 path. Commit B flips this one constant;
// tests exercise the dormant revision read and RPC through the same reader.
export const USE_APPEND_V6 = false;
let appendV6Enabled: boolean = USE_APPEND_V6;

export function useAppendV6(): boolean {
  return appendV6Enabled;
}

/** Test-only seam; restore the shipped default after each v6 test. */
export function __setUseAppendV6ForTest(value: boolean): void {
  appendV6Enabled = value;
}
