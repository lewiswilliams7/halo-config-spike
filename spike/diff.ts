/**
 * Show every property that differs between two fixtures. The fastest way to find
 * what the Halo UI does that our API build doesn't.
 *
 *   npm run diff -- fixtures/fieldinfo-315.json fixtures/fieldinfo-316.json
 *
 * Ignores identity noise (id, guid, names/labels that are expected to differ).
 */
import { loadJson } from './lib/halo.js';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('Usage: npm run diff -- <fixtureA.json> <fixtureB.json>');
  process.exit(1);
}

const IGNORE = /(^|\.)(id|guid|pk|name|label|labellong|variable_name|lookup|lookupid|seq|entity_id|entity_id2|translation|published_id)$/;

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(value)) {
    out[`${prefix}.length`] = String(value.length);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = JSON.stringify(value);
  }
  return out;
}

const fa = flatten(loadJson(a));
const fb = flatten(loadJson(b));
const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();

let n = 0;
console.log(`\n${'property'.padEnd(44)} ${'A'.padEnd(22)} B`);
for (const k of keys) {
  if (IGNORE.test(k)) continue;
  if (fa[k] === fb[k]) continue;
  n++;
  console.log(`${k.padEnd(44)} ${(fa[k] ?? '(missing)').slice(0, 22).padEnd(22)} ${fb[k] ?? '(missing)'}`);
}
console.log(`\n${n} difference(s).  A = ${a}  B = ${b}\n`);
