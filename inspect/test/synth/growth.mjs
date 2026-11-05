// Linear-time check that does not flake under CPU load: compares the CPU time (not
// wall time; the code under test is synchronous) at 4x the input with the time at
// 1x, best of 7 each, interleaved. The 1x input grows until the best of 3 runs takes
// at least 8ms: fixed overhead and timer noise shrink next to the real work, and one
// GC pause in one run cannot stop the search at a size too small to time. Linear
// code gives about 4; quadratic 13-16.
// minMs and tries are options so a test can pin the size search (growth.test.mjs).
export const MAX_N = 1 << 18;

export function growth(build, run, { minMs = 8, tries = 7 } = {}) {
  const time = (s) => {
    const t = process.cpuUsage();
    run(s);
    const d = process.cpuUsage(t);
    return (d.user + d.system) / 1000;
  };
  // Inputs stop at MAX_N chars, the 4x input included: megabyte strings measure
  // allocator and cache effects (11-12x seen on CI for single linear scans), not the
  // code. Code still under minMs at MAX_N / 4 cannot be quadratic, so it reads as
  // linear.
  let n = 1000;
  let slow = false;
  for (;;) {
    const s = build(n);
    slow = Math.min(time(s), time(s), time(s)) >= minMs;
    if (slow || 4 * n * 2 > MAX_N) break;
    n *= 2;
  }
  if (!slow) return 1;
  const small = build(n);
  const large = build(4 * n);
  let a = Infinity;
  let b = Infinity;
  for (let i = 0; i < tries; i++) {
    a = Math.min(a, time(small));
    b = Math.min(b, time(large));
  }
  // Too fast to measure even at the largest size: not growing.
  if (a === 0) return b === 0 ? 1 : Infinity;
  return b / a;
}

// Repeats unit until the string is at least n chars long.
export const repeatTo = (unit) => (n) => unit.repeat(Math.ceil(n / unit.length));
