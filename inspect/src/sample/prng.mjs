// Seeded PRNG for the sampler (mulberry32): the same seed gives the same draw,
// so a sample is reproducible from the seed printed in the report footer.
import { randomInt } from 'node:crypto';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fresh run seed: a positive 31-bit integer (facts.run.seed is an integer).
export const newSeed = () => randomInt(1, 2 ** 31 - 1);
