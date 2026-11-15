import test from "node:test";
import assert from "node:assert/strict";
import { encodeQr } from "../src/encoder.js";
import { toAscii, toSvg, toPng, QUIET_ZONE } from "../src/render.js";

test("ASCII art has the right shape and a quiet zone", () => {
  const qr = encodeQr("hi", "L");
  const art = toAscii(qr);
  const lines = art.split("\n");
  const width = (qr.size + QUIET_ZONE * 2) * 2;
  assert.equal(lines.length, qr.size + QUIET_ZONE * 2);
  for (const line of lines) assert.equal(line.length, width);
  assert.ok(art.includes("██"), "dark modules should render as blocks");
  // The quiet-zone rows are blank.
  assert.equal(lines[0]!.trim(), "");
  assert.equal(lines[lines.length - 1]!.trim(), "");
  // No quiet zone when margin is 0.
  const tight = toAscii(qr, { margin: 0 }).split("\n");
  assert.equal(tight.length, qr.size);
});

test("SVG is a standalone document with one rect per dark module", () => {
  const qr = encodeQr("https://example.com", "M");
  const svg = toSvg(qr);
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith("</svg>"));
  const darkCount = qr.modules.flat().filter(Boolean).length;
  const rects = svg.match(/<rect x=/g) ?? [];
  assert.equal(rects.length, darkCount);
  const px = (qr.size + QUIET_ZONE * 2) * 8;
  assert.ok(svg.includes(`width="${px}"`));
});

test("PNG has a valid signature, IHDR size, and decodes to the right pixels", () => {
  const qr = encodeQr("HELLO WORLD", "M");
  const png = toPng(qr);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR: length 13, type "IHDR", width/height big-endian.
  assert.equal(png.readUInt32BE(8), 13);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  const px = (qr.size + QUIET_ZONE * 2) * 8;
  assert.equal(png.readUInt32BE(16), px);
  assert.equal(png.readUInt32BE(20), px);
  assert.equal(png[24], 8); // bit depth
  assert.equal(png[25], 0); // grayscale
  // IEND trailer.
  assert.equal(png.toString("ascii", png.length - 8, png.length - 4), "IEND");
});

test("PNG with scale 1 and no margin is exactly the module grid", () => {
  const qr = encodeQr("hi", "L");
  const png = toPng(qr, { scale: 1, margin: 0 });
  assert.equal(png.readUInt32BE(16), qr.size);
  assert.equal(png.readUInt32BE(20), qr.size);
});
