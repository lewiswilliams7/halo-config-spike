/**
 * Step 1: check the API application works.
 *   npm run auth
 */
import { env, getToken, haloGet, extractList } from './lib/halo.js';

const { raw } = await getToken();
console.log(`\nToken OK for ${env.apiUrl}`);
console.log(`  scope:      ${raw.scope ?? '(not returned)'}`);
console.log(`  expires in: ${raw.expires_in ?? '?'}s`);

// One harmless read to prove the API itself answers, not just the auth server.
const teams = extractList(await haloGet('/Team'));
console.log(`  GET /Team:  ${teams.length} team(s) found`);
console.log(`\nWrites are ${env.allowWrites ? 'ENABLED' : 'disabled'} (HALO_ALLOW_WRITES).\n`);
