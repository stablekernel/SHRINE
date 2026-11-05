// Linear-time check that does not flake under CPU load: compares the CPU time (not
// wall time; the code under test is synchronous) at 4x the input with the time at
// 1x, best of 5 each, interleaved. The 1x input grows until one run takes at least
// 2ms, so timer resolution is not what is measured. Linear code gives about 4;
// quadratic about 16.
export function growth(build, run) {
  const time = (s) => {
    const t = process.cpuUsage();
    run(s);
    const d = process.cpuUsage(t);
    return (d.user + d.system) / 1000;
  };
  let n = 1000;
  while (time(build(n)) < 2 && n < 5_000_000) n *= 2;
  const small = build(n);
  const large = build(4 * n);
  let a = Infinity;
  let b = Infinity;
  for (let i = 0; i < 5; i++) {
    a = Math.min(a, time(small));
    b = Math.min(b, time(large));
  }
  // Too fast to measure even at the largest size: not growing.
  if (a === 0) return b === 0 ? 1 : Infinity;
  return b / a;
}

// Repeats unit until the string is at least n chars long.
export const repeatTo = (unit) => (n) => unit.repeat(Math.ceil(n / unit.length));
