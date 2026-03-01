/**
 * User Profile Loader — STUB
 *
 * Returns population defaults for user profile.
 *
 * // A.4+: Replace with Supabase read from user_profiles
 */

export interface UserProfile {
  coaching_style: 'socratic';
  calibration_tendency: 'unknown';
  challenge_tolerance: 'medium';
}

export function loadUserProfile(): UserProfile {
  // A.4+: Replace with Supabase read from user_profiles
  return {
    coaching_style: 'socratic',
    calibration_tendency: 'unknown',
    challenge_tolerance: 'medium',
  };
}
