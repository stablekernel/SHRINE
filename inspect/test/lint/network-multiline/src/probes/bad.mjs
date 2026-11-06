import {
  request,
} from 'node:https';

export const ping = (u) => request(u);
export const late = (u) => fetch
  (u);
