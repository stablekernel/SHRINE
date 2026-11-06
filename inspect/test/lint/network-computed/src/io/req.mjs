import { createRequire } from 'node:module';
const r = createRequire(import.meta.url);
export const load = (m) => r(m);
