import { request } from 'node:http';

export const ping = (u) => request(u);
