#!/usr/bin/env tsx
/**
 * Database Migration Runner
 *
 * Runs a SQL migration file against Supabase using the JS client.
 *
 * Prerequisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env
 *
 * Usage:
 *   pnpm exec tsx scripts/run-migration.ts migrations/005_add_model_config.sql
 *
 * This script uses Supabase's REST API to execute raw SQL via a stored procedure.
 * If that fails, it will provide instructions for running via Supabase dashboard.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('Usage: pnpm exec tsx scripts/run-migration.ts <migration-file>');
    console.error('Example: pnpm exec tsx scripts/run-migration.ts migrations/005_add_model_config.sql');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('');
    console.error('Please either:');
    console.error('1. Add these to your .env file');
    console.error('2. Run the migration manually in Supabase dashboard SQL editor');
    console.error('');
    console.error('SQL to run:');
    console.error('---');
    try {
      const sql = readFileSync(migrationFile, 'utf-8');
      console.log(sql);
    } catch (e) {
      console.error(`Could not read migration file: ${migrationFile}`);
    }
    process.exit(1);
  }

  // Read migration SQL
  let sql: string;
  try {
    sql = readFileSync(migrationFile, 'utf-8');
  } catch (e) {
    console.error(`Error reading migration file: ${migrationFile}`);
    process.exit(1);
  }

  console.log(`Running migration: ${migrationFile}`);
  console.log('---');
  console.log(sql);
  console.log('---');

  // Create Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Try to run via RPC (requires a stored procedure for raw SQL execution)
  // Most Supabase setups don't have this, so we'll catch the error
  try {
    // First, try using Supabase's built-in query method
    // Note: This requires the service role key and proper permissions
    const { data, error } = await supabase.rpc('exec_sql', { sql_text: sql });

    if (error) {
      throw error;
    }

    console.log('Migration completed successfully!');
    console.log('Result:', data);
  } catch (rpcError) {
    // exec_sql RPC doesn't exist, fall back to direct fetch
    console.log('Note: exec_sql RPC not available, trying direct REST API...');

    try {
      // Use Supabase's REST endpoint for raw queries (service role only)
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql_text: sql }),
      });

      if (!response.ok) {
        throw new Error(`REST API error: ${response.status} ${await response.text()}`);
      }

      console.log('Migration completed successfully via REST API!');
    } catch (restError) {
      console.error('');
      console.error('Could not run migration automatically.');
      console.error('');
      console.error('Please run this SQL manually in your Supabase dashboard:');
      console.error('1. Go to your Supabase project dashboard');
      console.error('2. Navigate to SQL Editor');
      console.error('3. Paste and run the following SQL:');
      console.error('');
      console.error('---');
      console.log(sql);
      console.error('---');
      console.error('');
      console.error('Technical details:', restError);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
