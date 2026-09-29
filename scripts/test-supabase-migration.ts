#!/usr/bin/env tsx
/**
 * Test Supabase connection and run migration
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://etmmuzwxtcjipwphdola.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function main() {
  if (!SUPABASE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  console.log('Connecting to Supabase...');
  console.log('URL:', SUPABASE_URL);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Test connection by querying prompts table
  console.log('Testing connection...');
  const { data, error } = await supabase.from('prompts').select('id, model_config').limit(1);

  if (error) {
    console.error('Connection failed:', error.message);
    console.error('Full error:', error);

    if (error.message.includes('model_config')) {
      console.log('\nThe model_config column does not exist yet.');
      console.log('Please run this migration in the Supabase SQL Editor:');
      console.log('');
      console.log('ALTER TABLE prompts ADD COLUMN IF NOT EXISTS model_config JSONB DEFAULT NULL;');
      console.log("COMMENT ON COLUMN prompts.model_config IS 'Environment-specific model configuration';");
    }
    process.exit(1);
  }

  console.log('Connection successful!');
  console.log('Sample prompt data:', JSON.stringify(data, null, 2));

  // Check if model_config column exists
  if (data && data.length > 0 && 'model_config' in data[0]) {
    console.log('\nmodel_config column already exists!');
  } else if (data && data.length > 0) {
    console.log('\nmodel_config column may not exist. Check the data above.');
  } else {
    console.log('\nNo prompts found in the table.');
  }
}

main().catch(console.error);
