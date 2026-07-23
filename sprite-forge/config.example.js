// CRIPTA Sprite Forge — public configuration template
// Copy this file to config.js and fill in your Supabase project details.
// Only put the PUBLISHABLE (anon) key here — never the service_role key.
//
// The Cloudflare API token must NEVER appear here.
// It lives exclusively in Supabase Edge Functions → Secrets.

window.CRIPTA_SPRITE_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseKey: 'your_supabase_publishable_anon_key',
  projectsTable: 'sprite_projects',
  assetsBucket: 'sprite-assets',
  generationFunction: 'generate-sprite',
  appVersion: '0.3.0-cloud'
});
