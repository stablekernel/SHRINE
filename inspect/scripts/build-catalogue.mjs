// Build-time: harvest the SHRINE docs into src/catalogue/catalogue.json.
// Usage: node scripts/build-catalogue.mjs [--docs <path>] [--golden]
//   --golden also writes test/golden/catalogue.json.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PKG_ROOT } from './lib/walk.mjs';
import { buildCatalogue } from '../src/catalogue/build.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--docs');
const docsDir = resolve(i >= 0 ? argv[i + 1] : join(PKG_ROOT, '..', 'docs', 'src', 'content', 'docs'));
const catalogue = buildCatalogue({ docsDir });
const text = `${JSON.stringify(catalogue, null, 2)}\n`;
writeFileSync(join(PKG_ROOT, 'src', 'catalogue', 'catalogue.json'), text);
if (argv.includes('--golden')) writeFileSync(join(PKG_ROOT, 'test', 'golden', 'catalogue.json'), text);
const count = catalogue.principles.length + catalogue.patterns.length + catalogue.stack.length;
console.log(`catalogue: ${count} pages, ${Object.keys(catalogue.entries).length} mapped ids, commit ${catalogue.shrine.commit}`);
