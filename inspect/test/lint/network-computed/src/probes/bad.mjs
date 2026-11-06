const name = 'fe' + 'tch';
export const ping = (u) => globalThis[name](u);
export const load = (m) => import(m);
