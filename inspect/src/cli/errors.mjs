// Error type and exit codes shared by every module.
export const EXIT = Object.freeze({
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  GATE_WAITING: 3,
  UNSUPPORTED_FORMAT: 4,
  INTEGRITY: 5,
});

export class InspectError extends Error {
  constructor(code, message, { hint = '', exit = EXIT.INTERNAL } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.exit = exit;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, hint: this.hint } };
  }
}
