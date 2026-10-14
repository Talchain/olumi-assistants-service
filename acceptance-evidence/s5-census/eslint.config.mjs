import config from '../../eslint.config.js';
export default config.filter(entry => !entry.ignores).map(entry => {
  if (entry.files?.includes('**/*.ts')) return { ...entry, files: [...entry.files, '**/*.mts'] };
  return entry;
});
