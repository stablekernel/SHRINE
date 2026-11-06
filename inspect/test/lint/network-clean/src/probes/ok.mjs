import {
  join,
} from 'node:path';
import( './local.mjs');
export const p = join('a', 'b');
export const load = () =>
  import(
    './other.mjs'
  );
// fetch(u) in a comment, /* WebSocket */ in a block comment.
export const viaOption = (opts, u) => opts.fetch(u) ?? opts?.fetch?.(u);
export const words = ['fetch', "XMLHttpRequest", `a fetch ${p} of EventSource`];
export const re = /fetch|globalThis/g;
export const args = process.argv.slice(2);
export class E extends Error {
  constructor(message) {
    super(message);
  }
}
export const pick = (o, k) => o[k];
