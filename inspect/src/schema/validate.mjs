// Minimal schema DSL and validator, so the package needs no runtime dependency.
// A schema is a function (value, path, errors) => void.

const push = (errors, path, message) => errors.push({ path, message });

export const str = (v, p, e) => typeof v === 'string' || push(e, p, 'expected string');
export const num = (v, p, e) => (typeof v === 'number' && Number.isFinite(v)) || push(e, p, 'expected number');
export const int = (v, p, e) => Number.isInteger(v) || push(e, p, 'expected integer');
export const bool = (v, p, e) => typeof v === 'boolean' || push(e, p, 'expected boolean');
export const any = () => true;

export const literal = (x) => (v, p, e) => v === x || push(e, p, `expected ${JSON.stringify(x)}`);
export const oneOf = (xs) => (v, p, e) => xs.includes(v) || push(e, p, `expected one of ${xs.join(', ')}`);
export const nullable = (s) => (v, p, e) => v === null || s(v, p, e);
export const range = (lo, hi) => (v, p, e) => (typeof v === 'number' && v >= lo && v <= hi) || push(e, p, `expected number ${lo} to ${hi}`);

export const arr = (s, { min = 0, max = Infinity } = {}) => (v, p, e) => {
  if (!Array.isArray(v)) return push(e, p, 'expected array');
  if (v.length < min) push(e, p, `expected at least ${min} item(s)`);
  if (v.length > max) push(e, p, `expected at most ${max} item(s)`);
  v.forEach((x, i) => s(x, `${p}[${i}]`, e));
};

export const dict = (s) => (v, p, e) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return push(e, p, 'expected object');
  for (const [k, x] of Object.entries(v)) s(x, `${p}.${k}`, e);
};

// obj(required, optional): unknown keys are allowed (forward compatible readers).
export const obj = (required, optional = {}) => {
  const check = (v, p, e) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return push(e, p, 'expected object');
    for (const [k, s] of Object.entries(required)) {
      if (!(k in v)) push(e, `${p}.${k}`, 'required');
      else s(v[k], `${p}.${k}`, e);
    }
    for (const [k, s] of Object.entries(optional)) if (k in v && v[k] !== undefined) s(v[k], `${p}.${k}`, e);
  };
  check.required = Object.keys(required);
  return check;
};

export function validate(schema, value) {
  const errors = [];
  schema(value, '$', errors);
  return { ok: errors.length === 0, errors };
}

export function assertValid(schema, value, name) {
  const r = validate(schema, value);
  if (!r.ok) {
    const lines = r.errors.slice(0, 10).map((x) => `${x.path}: ${x.message}`);
    throw new Error(`${name} failed schema: ${lines.join('; ')}`);
  }
  return value;
}
