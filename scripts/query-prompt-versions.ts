/**
 * Query prompt version history from Supabase
 *
 * Usage: pnpm exec tsx scripts/query-prompt-versions.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

async function main() {
  const client = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log('Querying prompt versions for draft_graph task...\n');

  // First find the prompt ID for draft_graph task
  const { data: prompts, error: promptError } = await client
    .from('cee_prompts')
    .select('id, name, task_id, active_version, staging_version, updated_at')
    .eq('task_id', 'draft_graph');

  if (promptError) {
    console.error('Error fetching prompts:', promptError);
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('PROMPT METADATA');
  console.log('='.repeat(80));
  console.log(JSON.stringify(prompts, null, 2));

  if (!prompts || prompts.length === 0) {
    console.log('No draft_graph prompt found');
    return;
  }

  const promptId = prompts[0].id;
  const stagingVersion = prompts[0].staging_version;

  // Query all versions for this prompt, focusing on recent ones
  const { data: versions, error: versionsError } = await client
    .from('cee_prompt_versions')
    .select('prompt_id, version, created_by, created_at, change_note, content_hash')
    .eq('prompt_id', promptId)
    .order('version', { ascending: false })
    .limit(20);

  if (versionsError) {
    console.error('Error fetching versions:', versionsError);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`RECENT VERSIONS FOR ${promptId}`);
  console.log('='.repeat(80));

  for (const v of versions || []) {
    const isStaging = v.version === stagingVersion;
    const marker = isStaging ? ' <<<< STAGING VERSION' : '';
    console.log(`\nVersion ${v.version}${marker}`);
    console.log(`  Created by: ${v.created_by || 'unknown'}`);
    console.log(`  Created at: ${v.created_at}`);
    console.log(`  Change note: ${v.change_note || '(none)'}`);
    console.log(`  Content hash: ${v.content_hash?.substring(0, 16)}...`);
  }

  // If staging version exists, get its full content
  if (stagingVersion) {
    const { data: stagingData, error: stagingError } = await client
      .from('cee_prompt_versions')
      .select('content')
      .eq('prompt_id', promptId)
      .eq('version', stagingVersion)
      .single();

    if (!stagingError && stagingData) {
      console.log('\n' + '='.repeat(80));
      console.log(`STAGING VERSION ${stagingVersion} CONTENT (first 500 chars)`);
      console.log('='.repeat(80));
      console.log(stagingData.content?.substring(0, 500) + '...');

      // Check for NON_NUMERIC section
      if (stagingData.content?.includes('NON_NUMERIC')) {
        console.log('\n✅ Contains NON_NUMERIC section');
      } else {
        console.log('\n❌ Does NOT contain NON_NUMERIC section');
      }
    }
  }
}

main().catch(console.error);
