const f = fetch; export const alias = (u) => f(u);
export const fallback = (opts, u) => (opts.fetch ?? fetch)(u);
export const comma = (u) => (0, fetch)(u);
export const h = process['getBuiltinModule']('node:http');
export const beacon = (u, b) => navigator.sendBeacon(u, b);
export const ctor = (s) => (() => 0)['constructor'](s);
const p = process; export const viaAlias = () => p.getBuiltinModule;
export const tpl = (u) => `${fetch(u)}`;
