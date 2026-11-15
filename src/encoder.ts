/**
 * QR symbol encoder (byte mode, versions 1–10).
 *
 * Pipeline: UTF-8 text -> data codewords (mode indicator, character count,
 * payload, terminator, pad bytes) -> split into blocks -> Reed-Solomon ECC
 * per block -> interleave -> zig-zag placement into the module matrix ->
 * try all 8 mask patterns, keep the one with the lowest penalty score.
 *
 * Format and version information use the standard BCH codes from
 * ISO/IEC 18004; the values are verified against the spec's known vectors
 * in the tests (format M/0 = 0x5412, version 7 = 0x07C94).
 */
import {
  charCountBits,
  dataCapacity,
  getVersion,
  smallestVersion,
  versionSize,
  type EcLevel,
  type VersionInfo,
} from "./capacity.js";
import { computeEcc } from "./reedsolomon.js";

/** Remainder bits per version (ISO/IEC 18004): 7 for versions 2–6, else 0. */
const REMAINDER_BITS: readonly number[] = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

export interface EncodeOptions {
  /** Force a specific version instead of auto-selecting the smallest. */
  version?: number | undefined;
  /** Force a specific mask (0–7) instead of evaluating all eight. */
  mask?: number | undefined;
}

export class QrCode {
  readonly version: number;
  readonly level: EcLevel;
  readonly mask: number;
  readonly size: number;
  /** modules[row][col]: true = dark. Includes no quiet zone. */
  readonly modules: readonly (readonly boolean[])[];

  constructor(version: number, level: EcLevel, mask: number, modules: boolean[][]) {
    this.version = version;
    this.level = level;
    this.mask = mask;
    this.size = modules.length;
    this.modules = modules;
  }

  isDark(row: number, col: number): boolean {
    return this.modules[row]?.[col] ?? false;
  }

  /** Dark-module ratio, 0–1. */
  darkRatio(): number {
    let dark = 0;
    for (const row of this.modules) for (const m of row) if (m) dark++;
    return dark / (this.size * this.size);
  }
}

/** Encode `text` into a QR symbol. Throws when the text is too long. */
export function encodeQr(text: string, level: EcLevel, options: EncodeOptions = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const minVersion = smallestVersion(bytes.length, level);
  if (minVersion === null) {
    throw new Error(
      `Text too long: ${bytes.length} UTF-8 bytes exceed the version 10 ${level} capacity`,
    );
  }
  const version = options.version ?? minVersion;
  if (version < minVersion) {
    throw new Error(
      `Text needs at least version ${minVersion} at level ${level} (${bytes.length} bytes)`,
    );
  }
  const info = getVersion(version);
  const dataCodewords = encodeDataCodewords(bytes, info, level);
  const finalBits = interleaveBlocks(dataCodewords, info, level);
  const built = buildMatrix(finalBits, info, level, options.mask);
  return new QrCode(version, level, built.mask, built.final);
}

/* ------------------------------------------------------------------ */
/* Data encoding                                                       */
/* ------------------------------------------------------------------ */

/** Minimal bit writer used while building the data codeword stream. */
class BitWriter {
  private bits: boolean[] = [];

  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push(((value >> i) & 1) === 1);
  }

  writeBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.write(b, 8);
  }

  get length(): number {
    return this.bits.length;
  }

  toCodewords(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ? 1 : 0);
      out.push(byte);
    }
    return out;
  }
}

/**
 * Build the data codewords for `bytes`: mode indicator (0100), character
 * count, payload, terminator, byte alignment, then alternating 0xEC/0x11
 * pad bytes up to the version's data capacity.
 */
export function encodeDataCodewords(bytes: Uint8Array, info: VersionInfo, level: EcLevel): number[] {
  const capacity = dataCapacity(info.version, level);
  const w = new BitWriter();
  w.write(0b0100, 4); // byte mode
  w.write(bytes.length, charCountBits(info.version));
  w.writeBytes(bytes);
  const terminator = Math.min(4, capacity * 8 - w.length);
  w.write(0, terminator);
  while (w.length % 8 !== 0) w.write(0, 1);
  const codewords = w.toCodewords();
  const pad = [0xec, 0x11];
  const padStart = codewords.length;
  for (let i = codewords.length; i < capacity; i++) {
    codewords.push(pad[(i - padStart) % 2]!);
  }
  return codewords;
}

/**
 * Split data codewords into blocks, compute each block's ECC, then
 * interleave data codewords across blocks, then ECC codewords, and append
 * the version's remainder bits (as zero bits).
 */
export function interleaveBlocks(
  dataCodewords: readonly number[],
  info: VersionInfo,
  level: EcLevel,
): boolean[] {
  const ecPerBlock = info.ecCodewordsPerBlock[level];
  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const group of info.blocks[level]) {
    for (let b = 0; b < group.blocks; b++) {
      const block = dataCodewords.slice(offset, offset + group.dataCodewords);
      offset += group.dataCodewords;
      blocks.push([...block]);
      eccBlocks.push(computeEcc(block, ecPerBlock));
    }
  }

  const bits: boolean[] = [];
  const pushByte = (byte: number): void => {
    for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) === 1);
  };
  const maxDataLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) if (i < block.length) pushByte(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ecc of eccBlocks) pushByte(ecc[i]!);
  }
  for (let i = 0; i < REMAINDER_BITS[info.version - 1]!; i++) bits.push(false);
  return bits;
}

/* ------------------------------------------------------------------ */
/* Format / version information (BCH codes)                            */
/* ------------------------------------------------------------------ */

const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const VERSION_GENERATOR = 0x1f25;

function bchRemainder(data: number, dataBits: number, generator: number, remBits: number): number {
  let rem = data << remBits;
  for (let i = dataBits + remBits - 1; i >= remBits; i--) {
    if ((rem >> i) & 1) rem ^= generator << (i - remBits);
  }
  return rem & ((1 << remBits) - 1);
}

/** 15-bit format information for an EC level and mask (already XOR-masked). */
export function formatInfo(level: EcLevel, mask: number): number {
  const levelBits: Record<EcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  const data = (levelBits[level] << 3) | mask;
  const rem = bchRemainder(data, 5, FORMAT_GENERATOR, 10);
  return ((data << 10) | rem) ^ FORMAT_MASK;
}

/** 18-bit version information (versions 7 and up). */
export function versionInfo(version: number): number {
  const rem = bchRemainder(version, 6, VERSION_GENERATOR, 12);
  return (version << 12) | rem;
}

/* ------------------------------------------------------------------ */
/* Mask patterns and penalty scoring                                   */
/* ------------------------------------------------------------------ */

/** True when the mask flips the module at (row, col). */
export function maskApplies(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return (row * col) % 2 + (row * col) % 3 === 0;
    case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
    case 7: return ((row + col) % 2 + (row * col) % 3) % 2 === 0;
    default: throw new Error(`Invalid mask ${mask}`);
  }
}

/**
 * Penalty score of a completed matrix (ISO/IEC 18004 rules N1–N4).
 * Lower is better; the encoder keeps the mask with the lowest score.
 */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;

  // N1: runs of 5+ same-colour modules in rows and columns.
  const scoreRuns = (line: readonly boolean[]): void => {
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  };
  for (let r = 0; r < size; r++) scoreRuns(modules[r]!);
  for (let c = 0; c < size; c++) {
    scoreRuns(modules.map((row) => row[c]!));
  }

  // N2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c]!;
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }

  // N3: finder-like patterns 1011101 with four light modules on either side.
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const matchesAt = (line: readonly boolean[], at: number, pat: readonly boolean[]): boolean => {
    for (let i = 0; i < pat.length; i++) if (line[at + i] !== pat[i]) return false;
    return true;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matchesAt(modules[r]!, c, patternA) || matchesAt(modules[r]!, c, patternB)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const col = modules.map((row) => row[c]!);
    for (let r = 0; r <= size - 11; r++) {
      if (matchesAt(col, r, patternA) || matchesAt(col, r, patternB)) score += 40;
    }
  }

  // N4: dark-module proportion deviating from 50%.
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/* ------------------------------------------------------------------ */
/* Matrix construction                                                 */
/* ------------------------------------------------------------------ */

interface MatrixBuild {
  /** Matrix with function patterns + unmasked data placed. */
  base: boolean[][];
  /** True where a module is a function pattern (never masked). */
  isFunction: boolean[][];
  /** Final matrix with the chosen mask + format/version info applied. */
  final: boolean[][];
  /** The mask used in `final`. */
  mask: number;
}

function emptyMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function buildMatrix(
  dataBits: readonly boolean[],
  info: VersionInfo,
  level: EcLevel,
  forcedMask?: number,
): MatrixBuild {
  const size = versionSize(info.version);
  const modules = emptyMatrix(size);
  const isFunction = emptyMatrix(size);

  const set = (r: number, c: number, dark: boolean, fn = true): void => {
    modules[r]![c]! = dark;
    if (fn) isFunction[r]![c]! = true;
  };

  // Finder patterns (7x7) + separators at the three corners.
  const finder = (top: number, left: number): void => {
    for (let r = -1; r < 8; r++) {
      for (let c = -1; c < 8; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(row, col, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns (alternating, row 6 and column 6).
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns (5x5, centred on the table's coordinates).
  for (const cy of info.alignmentCenters) {
    for (const cx of info.alignmentCenters) {
      // Skip the three positions that overlap a finder pattern.
      const overlapsFinder =
        (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8);
      if (overlapsFinder) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          set(cy + r, cx + c, dark);
        }
      }
    }
  }

  // Dark module (always dark, left of the bottom-left finder).
  set(size - 8, 8, true);

  // Reserve the format-information areas (filled in per mask below).
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8]![i] = true;
      isFunction[i]![8] = true;
    }
  }
  // Second copy: 8 modules down column 8 (rows size-8..size-1, which
  // includes the dark-module cell) and 8 modules along row 8.
  for (let i = 0; i < 8; i++) {
    isFunction[8]![size - 1 - i] = true;
    isFunction[size - 1 - i]![8] = true;
  }
  // Reserve the version-information areas (versions 7+).
  if (info.version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        isFunction[i]![size - 11 + j] = true;
        isFunction[size - 11 + j]![i] = true;
      }
    }
  }

  // Data placement: zig-zag up the matrix in two-column strips, right to left.
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (isFunction[row]![cc]) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex]! : false;
        bitIndex++;
        modules[row]![cc]! = bit;
      }
    }
    upward = !upward;
  }

  // Place version information (mask-independent).
  if (info.version >= 7) {
    const v = versionInfo(info.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      modules[r]![size - 11 + c] = dark;
      modules[size - 11 + c]![r] = dark;
    }
  }

  let final: boolean[][];
  let mask: number;
  if (forcedMask !== undefined) {
    mask = forcedMask;
    final = applyMaskAndFormat(modules, isFunction, info, level, forcedMask);
  } else {
    // Try all eight masks and keep the one with the lowest penalty score.
    let best: boolean[][] | null = null;
    let bestScore = Infinity;
    let bestMask = 0;
    for (let m = 0; m < 8; m++) {
      const candidate = applyMaskAndFormat(modules, isFunction, info, level, m);
      const score = penaltyScore(candidate);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
        bestMask = m;
      }
    }
    mask = bestMask;
    final = best!;
  }
  return { base: modules, isFunction, final, mask };
}

/** Place format info and apply one mask to the data modules. */
function applyMaskAndFormat(
  base: boolean[][],
  isFunction: boolean[][],
  info: VersionInfo,
  level: EcLevel,
  mask: number,
): boolean[][] {
  const size = base.length;
  const out = base.map((row) => [...row]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r]![c]! && maskApplies(mask, r, c)) out[r]![c]! = !out[r]![c]!;
    }
  }
  placeFormatInfo(out, level, mask);
  // The dark module (row size-8, column 8) is always dark. It is a
  // separate cell just above the second format copy's vertical strip;
  // re-assert it here so no mask or format step can clear it.
  out[size - 8]![8] = true;
  return out;
}

/** Write the 15 format bits into their two fixed locations (MSB first). */
function placeFormatInfo(modules: boolean[][], level: EcLevel, mask: number): void {
  const size = modules.length;
  const fmt = formatInfo(level, mask);
  const bit = (i: number): boolean => ((fmt >> i) & 1) === 1; // i = 0 (LSB) .. 14 (MSB)
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) modules[8]![i] = bit(14 - i);
  modules[8]![7] = bit(8);
  modules[8]![8] = bit(7);
  modules[7]![8] = bit(6);
  for (let i = 0; i <= 5; i++) modules[5 - i]![8] = bit(5 - i);
  // Second copy, split: 7 modules down column 8 (bits 14..8) and 8 modules
  // along row 8 (bits 7..0). The dark-module cell (size-8, 8) sits just
  // above the vertical strip and is not a format cell.
  for (let i = 0; i < 7; i++) modules[size - 1 - i]![8] = bit(14 - i);
  for (let i = 0; i < 8; i++) modules[8]![size - 8 + i] = bit(7 - i);
}

