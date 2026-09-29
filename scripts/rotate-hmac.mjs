#!/usr/bin/env node
/**
 * HMAC Secret Rotation Helper (v1.10.0)
 *
 * Safely rotates HMAC secrets for SSE resume tokens with zero downtime.
 *
 * Usage:
 *   node scripts/rotate-hmac.mjs --generate          # Generate new secret
 *   node scripts/rotate-hmac.mjs --gradual           # Gradual rotation guide
 *   node scripts/rotate-hmac.mjs --verify            # Verify current setup
 *
 * Safety:
 * - Generates cryptographically secure 32-byte secrets
 * - Provides gradual rotation steps to avoid token invalidation
 * - Validates secret format and strength
 */

import { randomBytes } from 'node:crypto';

const COMMANDS = {
  generate: generateSecret,
  gradual: showGradualRotation,
  verify: verifySetup,
};

/**
 * Generate a new cryptographically secure HMAC secret
 */
function generateSecret() {
  const secret = randomBytes(32).toString('base64');

  console.log('🔐 New HMAC Secret Generated');
  console.log('');
  console.log(`  ${secret}`);
  console.log('');
  console.log('✅ Secret strength: 256 bits (32 bytes)');
  console.log('');
  console.log('⚠️  Store this securely! Once you close this terminal, it cannot be retrieved.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Save to password manager');
  console.log('  2. Update environment variables (see --gradual)');
  console.log('  3. Never commit to git');
  console.log('');
}

/**
 * Show gradual rotation procedure
 */
function showGradualRotation() {
  console.log('🔄 Gradual HMAC Secret Rotation Procedure');
  console.log('');
  console.log('Purpose: Rotate secrets without invalidating active resume tokens');
  console.log('');
  console.log('═══ Step 1: Generate New Secret ═══');
  console.log('');
  console.log('  node scripts/rotate-hmac.mjs --generate');
  console.log('');
  console.log('═══ Step 2: Set as Secondary Secret ═══');
  console.log('');
  console.log('In Render dashboard, set BOTH secrets:');
  console.log('');
  console.log('  SSE_RESUME_SECRET=<old-secret>     # Primary (still validates tokens)');
  console.log('  HMAC_SECRET=<new-secret>           # Secondary (signs new tokens)');
  console.log('');
  console.log('✅ Result: Old tokens still work, new tokens use new secret');
  console.log('');
  console.log('═══ Step 3: Wait for Token TTL ═══');
  console.log('');
  console.log('  Default TTL: 15 minutes (SSE_SNAPSHOT_TTL_SEC)');
  console.log('  Wait time: 20-30 minutes to be safe');
  console.log('');
  console.log('═══ Step 4: Promote New Secret ═══');
  console.log('');
  console.log('After TTL expires, update environment:');
  console.log('');
  console.log('  SSE_RESUME_SECRET=<new-secret>     # Promote to primary');
  console.log('  HMAC_SECRET=<new-secret>           # Keep as secondary');
  console.log('');
  console.log('✅ Result: All tokens now use new secret');
  console.log('');
  console.log('═══ Step 5: Verify ═══');
  console.log('');
  console.log('  node scripts/rotate-hmac.mjs --verify');
  console.log('');
  console.log('═══ Important Notes ═══');
  console.log('');
  console.log('⚠️  Never rotate both secrets simultaneously');
  console.log('⚠️  Always keep old secret for TTL duration');
  console.log('⚠️  Test in staging first');
  console.log('⚠️  Monitor resume success rate during rotation');
  console.log('');
}

/**
 * Verify current HMAC setup
 */
function verifySetup() {
  console.log('🔍 Verifying HMAC Setup');
  console.log('');

  const primary = process.env.SSE_RESUME_SECRET;
  const secondary = process.env.HMAC_SECRET;

  if (!primary && !secondary) {
    console.log('❌ No secrets configured');
    console.log('');
    console.log('SSE resume functionality is DISABLED');
    console.log('');
    console.log('To enable:');
    console.log('  1. Run: node scripts/rotate-hmac.mjs --generate');
    console.log('  2. Set SSE_RESUME_SECRET and HMAC_SECRET to generated value');
    console.log('');
    process.exit(1);
  }

  console.log('Primary secret (SSE_RESUME_SECRET):');
  if (primary) {
    console.log(`  ✅ Set (${primary.substring(0, 8)}...)`);
    console.log(`  Length: ${primary.length} chars`);

    if (primary.length < 32) {
      console.log('  ⚠️  WARNING: Secret shorter than recommended 32 bytes');
    }
  } else {
    console.log('  ❌ Not set');
  }

  console.log('');
  console.log('Secondary secret (HMAC_SECRET):');
  if (secondary) {
    console.log(`  ✅ Set (${secondary.substring(0, 8)}...)`);
    console.log(`  Length: ${secondary.length} chars`);

    if (secondary.length < 32) {
      console.log('  ⚠️  WARNING: Secret shorter than recommended 32 bytes');
    }
  } else {
    console.log('  ⚠️  Not set (will fall back to SSE_RESUME_SECRET)');
  }

  console.log('');
  if (primary === secondary) {
    console.log('✅ Secrets match (normal operation)');
  } else if (primary && secondary) {
    console.log('⚠️  Secrets differ (rotation in progress or misconfigured)');
    console.log('');
    console.log('If rotating:');
    console.log('  - Verify old tokens still validate with primary');
    console.log('  - Verify new tokens sign with secondary');
    console.log('  - Complete rotation after TTL expires');
  }

  console.log('');
}

/**
 * Show usage
 */
function showUsage() {
  console.log('HMAC Secret Rotation Helper');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/rotate-hmac.mjs --generate    Generate new secret');
  console.log('  node scripts/rotate-hmac.mjs --gradual     Show rotation procedure');
  console.log('  node scripts/rotate-hmac.mjs --verify      Verify current setup');
  console.log('');
  process.exit(0);
}

// Main
const command = process.argv[2]?.replace('--', '');

if (!command || !COMMANDS[command]) {
  showUsage();
}

COMMANDS[command]();
