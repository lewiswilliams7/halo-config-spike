/**
 * Does Halo's label list already know these fields? (rule U1 investigation)
 *
 *   npm run labelcheck -- 319 320
 *
 * Fetches /agent/me, the same response the browser loads at login, which carries
 * the language pack (labels like field_319 → "Items"). If the API sees the new labels
 * straight after a build, the stale labels are only in the browser session; if it
 * doesn't, Halo's server is caching them.
 */
import { firstRecord, haloGet } from './lib/halo.js';

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: npm run labelcheck -- <fieldinfo id> [more ids]');
  process.exit(1);
}

const me = firstRecord(await haloGet('/agent/me')) ?? {};
const pack = ((me.languagepack as Record<string, unknown> | undefined)?.translations ?? []) as { label?: string; value?: string }[];
console.log(`\nLanguage pack from /agent/me: ${pack.length} labels\n`);
for (const id of ids) {
  const hit = pack.find((t) => t.label === `field_${id}`);
  console.log(`  field_${id}: ${hit ? `"${hit.value}"  ✅ server already has it` : '❌ not in the pack yet'}`);
}
console.log('');
