import { readFile } from 'node:fs/promises';
import { posix } from 'node:path/posix';
export const read = (p) => readFile(posix.join('.', p), 'utf8');
