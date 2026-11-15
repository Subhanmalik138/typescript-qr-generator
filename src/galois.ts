/**
 * Arithmetic in GF(2^8), the Galois field used by QR codes.
 *
 * The field is built from the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
 * (0x11D) with generator alpha = 2. Every non-zero element is a power of 2,
 * so multiplication and division become additions/subtractions of exponents
 * modulo 255, looked up through exp/log tables built once at load time.
 */

/** Primitive polynomial for QR codes: x^8 + x^4 + x^3 + x^2 + 1. */
export const PRIMITIVE_POLY = 0x11d;

/** exp[i] = 2^i in GF(256); duplicated so exp[i + 255] works without a mod. */
export const EXP_TABLE: readonly number[] = buildExpTable();

/** log[x] = i such that 2^i = x (log[0] is undefined and left as 0). */
export const LOG_TABLE: readonly number[] = buildLogTable();

function buildExpTable(): number[] {
  const exp = new Array<number>(512);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE_POLY;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255]!;
  return exp;
}

function buildLogTable(): number[] {
  const log = new Array<number>(256).fill(0);
  for (let i = 0; i < 255; i++) log[EXP_TABLE[i]!] = i;
  return log;
}

/** Addition in GF(2^8) is XOR. */
export function gfAdd(a: number, b: number): number {
  return a ^ b;
}

/** Subtraction in GF(2^8) is also XOR (characteristic 2). */
export function gfSub(a: number, b: number): number {
  return a ^ b;
}

/** Multiplication via exponent tables; 0 is the annihilator. */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a]! + LOG_TABLE[b]!]!;
}

/** Division via exponent tables. Throws on division by zero. */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("gfDiv: division by zero");
  if (a === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a]! - LOG_TABLE[b]! + 255]!;
}

/** a^n in GF(2^8); a^0 = 1, 0^0 is treated as 1. */
export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a]! * n) % 255]!;
}

/**
 * Evaluate a polynomial (coefficients highest-degree first) at x.
 * Horner's method; used by the Reed-Solomon encoder and its tests.
 */
export function gfPolyEval(coefficients: readonly number[], x: number): number {
  let result = 0;
  for (const c of coefficients) result = gfMul(result, x) ^ c;
  return result;
}
