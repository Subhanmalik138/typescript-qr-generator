import test from "node:test";
import assert from "node:assert/strict";
import { generatorPolynomial, computeEcc, verifyCodewords } from "../src/reedsolomon.js";
import { encodeDataCodewords } from "../src/encoder.js";
import { getVersion } from "../src/capacity.js";

/**
 * Known vector from the QR spec walkthrough ("HELLO WORLD", version 1,
 * level M, byte mode). Data codewords:
 *   40 B4 84 54 C4 C4 F2 05 74 F5 24 C4 40 EC 11 EC
 * ECC codewords (10 bytes), verified against an independent Python
 * Reed-Solomon implementation and by the syndrome-zero property:
 *   0C 4B CF 9A 89 4F 65 09 97 CC
 */
const HELLO_WORLD_DATA = [
  0x40, 0xb4, 0x84, 0x54, 0xc4, 0xc4, 0xf2, 0x05,
  0x74, 0xf5, 0x24, 0xc4, 0x40, 0xec, 0x11, 0xec,
];
const HELLO_WORLD_ECC = [0x0c, 0x4b, 0xcf, 0x9a, 0x89, 0x4f, 0x65, 0x09, 0x97, 0xcc];

test("generator polynomial has the right degree and leading coefficient", () => {
  for (const degree of [7, 10, 17, 30]) {
    const poly = generatorPolynomial(degree);
    assert.equal(poly.length, degree + 1);
    assert.equal(poly[0], 1);
    // x = 1 is a root of every generator polynomial (factor (x - 2^0)).
    let evalAt1 = 0;
    for (const c of poly) evalAt1 ^= c;
    assert.equal(evalAt1, 0);
  }
});

test("data codewords for HELLO WORLD match the spec walkthrough", () => {
  const bytes = new TextEncoder().encode("HELLO WORLD");
  const codewords = encodeDataCodewords(bytes, getVersion(1), "M");
  assert.deepEqual(codewords, HELLO_WORLD_DATA);
});

test("ECC for HELLO WORLD matches the spec walkthrough", () => {
  assert.deepEqual(computeEcc(HELLO_WORLD_DATA, 10), HELLO_WORLD_ECC);
});

test("data + ECC is divisible by the generator polynomial", () => {
  for (const [data, ec] of [
    [HELLO_WORLD_DATA, 10],
    [[0x01, 0x02, 0x03, 0x04, 0x05], 7],
    [Array.from({ length: 55 }, (_, i) => i), 15],
  ] as const) {
    assert.equal(verifyCodewords([...data, ...computeEcc(data, ec)], ec), true);
    // Corrupt one byte and the check must fail.
    const corrupted = [...data, ...computeEcc(data, ec)];
    corrupted[0]! ^= 1;
    assert.equal(verifyCodewords(corrupted, ec), false);
  }
});

test("ECC length always equals the requested degree", () => {
  assert.equal(computeEcc([1, 2, 3], 17).length, 17);
  assert.deepEqual(computeEcc([], 10), new Array(10).fill(0));
});
