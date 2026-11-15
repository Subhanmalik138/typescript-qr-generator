/**
 * Renderers for a finished QR symbol: terminal ASCII art, SVG, and PNG.
 *
 * The PNG encoder is hand-rolled (signature, IHDR, IDAT, IEND) on top of
 * Node's built-in zlib — no image dependency is needed for a 1-bit image.
 * All renderers add the spec's 4-module quiet zone unless told otherwise.
 */
import { deflateSync } from "node:zlib";
import type { QrCode } from "./encoder.js";

/** Number of quiet-zone modules around the symbol (the spec requires 4). */
export const QUIET_ZONE = 4;

export interface RenderOptions {
  /** Quiet-zone width in modules (default 4; 0 disables it). */
  margin?: number;
  /** Pixels per module for raster output (default 8). */
  scale?: number;
}

/** Terminal-friendly ASCII art: two block characters per dark module. */
export function toAscii(qr: QrCode, options: RenderOptions = {}): string {
  const margin = options.margin ?? QUIET_ZONE;
  const lines: string[] = [];
  const width = qr.size + margin * 2;
  const blank = "  ".repeat(width);
  for (let i = 0; i < margin; i++) lines.push(blank);
  for (let r = 0; r < qr.size; r++) {
    let line = "  ".repeat(margin);
    for (let c = 0; c < qr.size; c++) line += qr.isDark(r, c) ? "██" : "  ";
    line += "  ".repeat(margin);
    lines.push(line);
  }
  for (let i = 0; i < margin; i++) lines.push(blank);
  return lines.join("\n");
}

/** Standalone SVG: one <rect> per dark module, white background. */
export function toSvg(qr: QrCode, options: RenderOptions = {}): string {
  const margin = options.margin ?? QUIET_ZONE;
  const scale = options.scale ?? 8;
  const total = qr.size + margin * 2;
  const px = total * scale;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">`,
    `<rect width="${px}" height="${px}" fill="white"/>`,
  ];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.isDark(r, c)) continue;
      const x = (c + margin) * scale;
      const y = (r + margin) * scale;
      parts.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="black"/>`);
    }
  }
  parts.push("</svg>");
  return parts.join("\n");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  // CRC-32 (IEEE) table, built lazily once.
  if (!crc32Table) {
    crc32Table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32Table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
let crc32Table: Int32Array | null = null;

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

/**
 * 8-bit grayscale PNG. Each module becomes a scale x scale block of
 * pixels; 0 = black, 255 = white. Scanlines use filter type 0 (none).
 */
export function toPng(qr: QrCode, options: RenderOptions = {}): Buffer {
  const margin = options.margin ?? QUIET_ZONE;
  const scale = options.scale ?? 8;
  const modules = qr.size + margin * 2;
  const px = modules * scale;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: grayscale

  const raw = Buffer.alloc(px * (px + 1));
  for (let y = 0; y < px; y++) {
    const rowStart = y * (px + 1);
    raw[rowStart] = 0; // filter: none
    const moduleRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < px; x++) {
      const moduleCol = Math.floor(x / scale) - margin;
      const dark =
        moduleRow >= 0 &&
        moduleRow < qr.size &&
        moduleCol >= 0 &&
        moduleCol < qr.size &&
        qr.isDark(moduleRow, moduleCol);
      raw[rowStart + 1 + x] = dark ? 0 : 255;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
