import test from "node:test";
import assert from "node:assert/strict";
import { EXP_TABLE, LOG_TABLE, gfMul, gfDiv, gfPow, gfPolyEval } from "../src/galois.js";

test("exp/log tables are inverses and cover all 255 non-zero elements", () => {
  assert.equal(EXP_TABLE[0], 1);
  assert.equal(EXP_TABLE[255], 1); // 2^255 = 1 (field order)
  const seen = new Set<number>();
  for (let i = 0; i < 255; i++) {
    seen.add(EXP_TABLE[i]!);
    assert.equal(LOG_TABLE[EXP_TABLE[i]!]!, i);
  }
  assert.equal(seen.size, 255);
  assert.equal(LOG_TABLE[1], 0);
  assert.equal(LOG_TABLE[2], 1);
});

test("multiplication: identity, zero, and commutativity", () => {
  for (const a of [1, 2, 0x53, 0xab, 0xff]) {
    assert.equal(gfMul(a, 1), a);
    assert.equal(gfMul(a, 0), 0);
    assert.equal(gfMul(1, a), a);
  }
  // 2 * 0x80 wraps through the primitive polynomial: 0x100 ^ 0x11d = 0x1d.
  assert.equal(gfMul(2, 0x80), 0x1d);
  for (const [a, b] of [[0x53, 0xca], [0x11, 0x22], [0xab, 0xcd]] as const) {
    assert.equal(gfMul(a, b), gfMul(b, a));
  }
});

test("division inverts multiplication", () => {
  for (const [a, b] of [[0x53, 0xca], [0x01, 0xff], [0xab, 0x02], [0x70, 0x70]] as const) {
    assert.equal(gfDiv(gfMul(a, b), b), a);
    assert.equal(gfMul(gfDiv(a, b), b), a);
  }
  assert.throws(() => gfDiv(1, 0), /division by zero/);
});

test("powers follow the exponent table", () => {
  assert.equal(gfPow(2, 0), 1);
  assert.equal(gfPow(2, 8), 0x1d); // 2^8 mod 0x11d
  assert.equal(gfPow(0x53, 3), gfMul(gfMul(0x53, 0x53), 0x53));
  assert.equal(gfPow(0x53, 255), 1); // Fermat: a^255 = 1 for a != 0
  assert.equal(gfPow(0, 5), 0);
});

test("polynomial evaluation (Horner)", () => {
  // x^2 + 2x + 3 at x = 2: 4 ^ 4 ^ 3 = 3.
  assert.equal(gfPolyEval([1, 2, 3], 2), 3);
  assert.equal(gfPolyEval([1], 0x53), 1);
  assert.equal(gfPolyEval([], 5), 0);
});
