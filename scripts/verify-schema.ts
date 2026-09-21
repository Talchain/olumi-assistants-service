#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://etmmuzwxtcjipwphdola.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

async function main() {
  if (!SUPABASE_KEY) {
    console.error('SUPABASE_KEY is required');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Query one row to see the columns
  const { data, error } = await supabase
    .from('cee_prompts')
    .select('id, model_config, design_version')
    .limit(1);

  if (error) {
    console.log('Error:', error.message);
    if (error.message.includes('model_config')) {
      console.log('\n❌ model_config column does NOT exist');
    }
    if (error.message.includes('design_version')) {
      console.log('❌ design_version column does NOT exist');
    }
    process.exit(1);
  }

  console.log('Success! Table columns verified.');
  console.log('Sample data:', JSON.stringify(data, null, 2));
  console.log('');
  console.log('✓ model_config column exists');
  console.log('✓ design_version column exists');
}

main().catch(console.error);
