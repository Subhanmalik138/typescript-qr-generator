import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeQr,
  formatInfo,
  versionInfo,
  maskApplies,
  penaltyScore,
} from "../src/encoder.js";
import {
  dataCapacity,
  maxBytes,
  smallestVersion,
  versionSize,
  VERSIONS,
} from "../src/capacity.js";

test("format info known vectors (ISO/IEC 18004 Table C.1)", () => {
  assert.equal(formatInfo("M", 0), 0x5412);
  assert.equal(formatInfo("L", 0), 0b111011111000100);
  assert.equal(formatInfo("H", 0), 0b001011010001001);
  assert.equal(formatInfo("Q", 7), 0b010101111101101);
  // All 32 combinations are 15-bit values.
  for (const level of ["L", "M", "Q", "H"] as const) {
    for (let mask = 0; mask < 8; mask++) {
      const fmt = formatInfo(level, mask);
      assert.ok(fmt >= 0 && fmt < 0x8000, `format ${level}/${mask} out of range`);
    }
  }
});

test("version info known vector: version 7 = 0x07C94", () => {
  assert.equal(versionInfo(7), 0x07c94);
  assert.equal(versionInfo(10), 0x0a4d3);
});

test("version selection picks the smallest fitting version", () => {
  assert.equal(smallestVersion(14, "M"), 1); // 14 bytes fit v1-M (16 codewords)
  assert.equal(smallestVersion(17, "M"), 2);
  assert.equal(smallestVersion(1, "H"), 1);
  assert.equal(smallestVersion(maxBytes("L"), "L"), 10);
  assert.equal(smallestVersion(maxBytes("L") + 1, "L"), null);
});

test("capacity table is internally consistent", () => {
  // data + ECC codewords must equal the version total for every level.
  for (const info of VERSIONS) {
    for (const level of ["L", "M", "Q", "H"] as const) {
      const data = dataCapacity(info.version, level);
      const blocks = info.blocks[level].reduce((s, g) => s + g.blocks, 0);
      assert.equal(
        data + blocks * info.ecCodewordsPerBlock[level],
        info.totalCodewords,
        `v${info.version} ${level}`,
      );
    }
  }
});

test("a version 1 code has the right size and finder patterns", () => {
  const qr = encodeQr("HELLO WORLD", "M");
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(versionSize(1), 21);
  assert.equal(versionSize(10), 57);

  // Finder pattern corners: 7x7 squares with a dark border and dark centre.
  for (const [top, left] of [[0, 0], [0, 14], [14, 0]] as const) {
    assert.equal(qr.isDark(top, left), true);
    assert.equal(qr.isDark(top + 3, left + 3), true); // centre
    assert.equal(qr.isDark(top + 1, left + 1), false); // inner separator ring
    assert.equal(qr.isDark(top + 6, left + 6), true);
  }
  // Timing pattern alternates along row 6 / column 6.
  assert.equal(qr.isDark(6, 8), true);
  assert.equal(qr.isDark(6, 9), false);
  assert.equal(qr.isDark(8, 6), true);
  assert.equal(qr.isDark(9, 6), false);
  // Dark module: row size-8, column 8.
  assert.equal(qr.isDark(13, 8), true);
});

test("mask 0..7 each flip a different set of modules", () => {
  // The 8x8 pattern of each mask must be distinct.
  const patterns = new Set<string>();
  for (let mask = 0; mask < 8; mask++) {
    const key: string[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) key.push(maskApplies(mask, r, c) ? "1" : "0");
    }
    patterns.add(key.join(""));
  }
  assert.equal(patterns.size, 8, "all eight masks should differ");
  assert.equal(maskApplies(0, 2, 2), true); // (2+2) % 2 == 0
  assert.equal(maskApplies(0, 2, 3), false);
  assert.equal(maskApplies(1, 0, 5), true); // row 0 is even
  assert.equal(maskApplies(1, 1, 5), false);
});

test("forced mask changes the matrix; auto mask is one of 0-7", () => {
  const auto = encodeQr("https://example.com", "M");
  assert.ok(auto.mask >= 0 && auto.mask <= 7);
  const forced = encodeQr("https://example.com", "M", { mask: 3 });
  assert.equal(forced.mask, 3);
  // Same version/size, different modules (mask 3 != auto mask in general,
  // and even when equal the format bits differ from other masks).
  const other = encodeQr("https://example.com", "M", { mask: 5 });
  assert.notDeepEqual(forced.modules, other.modules);
});

test("auto mask has the lowest penalty among all eight", () => {
  const text = "https://example.com/some/path?x=1&y=2";
  const auto = encodeQr(text, "M");
  const autoScore = penaltyScore(auto.modules);
  for (let mask = 0; mask < 8; mask++) {
    const forced = encodeQr(text, "M", { mask });
    assert.ok(
      penaltyScore(forced.modules) >= autoScore,
      `mask ${mask} scored lower than the auto mask`,
    );
  }
});

test("longer texts bump the version; UTF-8 counts bytes, not characters", () => {
  const short = encodeQr("hi", "L");
  assert.equal(short.version, 1);
  const medium = encodeQr("a".repeat(100), "L");
  assert.ok(medium.version > 1 && medium.version <= 10);
  // "é" is 2 UTF-8 bytes; 7 of them = 14 bytes, the v1-M payload maximum
  // (16 codewords minus 12 bits of mode/count overhead).
  assert.equal(encodeQr("é".repeat(7), "M").version, 1);
  assert.equal(encodeQr("é".repeat(8), "M").version, 2);
  assert.equal(encodeQr("a".repeat(271), "L").version, 10); // v10-L max payload
});

test("version 7+ codes carry version information", () => {
  const qr = encodeQr("a".repeat(120), "M");
  assert.ok(qr.version >= 7, `expected v7+, got v${qr.version}`);
  assert.equal(qr.size, 21 + (qr.version - 1) * 4);
});

test("too-long input throws a clear error", () => {
  assert.throws(() => encodeQr("a".repeat(maxBytes("H") + 1), "H"), /too long/);
});

test("forced version that is too small throws", () => {
  assert.throws(
    () => encodeQr("a".repeat(100), "M", { version: 1 }),
    /at least version 6/,
  );
});
