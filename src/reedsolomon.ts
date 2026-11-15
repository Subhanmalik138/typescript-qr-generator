/**
 * Reed-Solomon error correction over GF(2^8), as used by QR codes.
 *
 * The generator polynomial of degree `ecCount` is
 *   g(x) = (x - 2^0)(x - 2^1)...(x - 2^(ecCount-1))
 * and the ECC bytes are the remainder of data(x) * x^ecCount divided by g(x),
 * computed with the classic shift-register (polynomial long division) loop.
 * A message with its ECC appended is divisible by g(x), which is exactly
 * what a decoder checks — the tests exploit that property.
 */
import { EXP_TABLE, gfMul } from "./galois.js";

/** Build the generator polynomial of the given degree (highest-first). */
export function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = multiplyByLinearFactor(poly, EXP_TABLE[i]!);
  }
  return poly;
}

/** Multiply `poly` (highest-first) by (x - root); subtraction is XOR here. */
function multiplyByLinearFactor(poly: readonly number[], root: number): number[] {
  const out = new Array<number>(poly.length + 1).fill(0);
  for (let j = 0; j < poly.length; j++) {
    out[j]! ^= poly[j]!; // x term
    out[j + 1]! ^= gfMul(poly[j]!, root); // constant term
  }
  return out;
}

/**
 * Compute `ecCount` error-correction codewords for `data`.
 * Returns the remainder of data(x) * x^ecCount divided by the generator
 * polynomial — i.e. the bytes a QR encoder appends after the data.
 */
export function computeEcc(data: readonly number[], ecCount: number): number[] {
  const generator = generatorPolynomial(ecCount);
  const ecc = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ ecc[0]!;
    ecc.shift();
    ecc.push(0);
    for (let i = 0; i < ecCount; i++) {
      ecc[i]! ^= gfMul(generator[i + 1]!, factor);
    }
  }
  return ecc;
}

/**
 * Verify a full codeword sequence (data + ECC): the remainder of dividing
 * it by the generator polynomial must be all zeros.
 */
export function verifyCodewords(codewords: readonly number[], ecCount: number): boolean {
  return computeEcc(codewords, ecCount).every((b) => b === 0);
}
