#!/usr/bin/env tsx
/**
 * Run SQL migration against Supabase postgres
 */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ||
  `postgresql://postgres.etmmuzwxtcjipwphdola:${process.env.DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

async function main() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('Usage: DB_PASSWORD=xxx pnpm exec tsx scripts/run-sql-migration.ts <migration-file>');
    process.exit(1);
  }

  // Read migration SQL
  let sqlContent: string;
  try {
    sqlContent = readFileSync(migrationFile, 'utf-8');
  } catch (e) {
    console.error(`Error reading migration file: ${migrationFile}`);
    process.exit(1);
  }

  console.log(`Running migration: ${migrationFile}`);
  console.log('---');
  console.log(sqlContent);
  console.log('---');

  const sql = postgres(DATABASE_URL, {
    ssl: 'require',
    connect_timeout: 10,
  });

  try {
    // Execute the migration
    await sql.unsafe(sqlContent);
    console.log('Migration completed successfully!');

    // Verify the column exists
    const result = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'prompts' AND column_name = 'model_config'
    `;

    if (result.length > 0) {
      console.log('Verified: model_config column exists');
      console.log('Column details:', result[0]);
    } else {
      console.warn('Warning: model_config column not found after migration');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
