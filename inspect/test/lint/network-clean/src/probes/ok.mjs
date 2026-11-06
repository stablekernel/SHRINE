import {
  join,
} from 'node:path';
import( './local.mjs');
export const p = join('a', 'b');
export const load = () =>
  import(
    './other.mjs'
  );
