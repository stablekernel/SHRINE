import fs from 'node:fs';

export function save(p, d) {
  fs.writeFileSync(p, d);
}
