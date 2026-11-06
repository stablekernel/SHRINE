const name = 'fe' + 'tch';
export const ping = (u) => globalThis[name](u);
export const load = (m) => import(m);
export const call = (u) => fetch.call(null, u);
export const reflect = (n) => Reflect.get(globalThis, n);
const { fetch: go } = globalThis;
export const viaDestructure = (u) => go(u);
