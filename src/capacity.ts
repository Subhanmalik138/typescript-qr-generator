/**
 * QR version capacity tables (versions 1–10, byte mode), transcribed from
 * ISO/IEC 18004 Table 9. Each block group lists how many blocks of that
 * size exist and how many data codewords each block holds.
 *
 * A block group entry is [blockCount, dataCodewordsPerBlock].
 */

export type EcLevel = "L" | "M" | "Q" | "H";

/** Error-correction level indicator bits used in the format information. */
export const EC_LEVEL_BITS: Record<EcLevel, number> = {
  L: 0b01,
  M: 0b00,
  Q: 0b11,
  H: 0b10,
};

/** Fraction of codewords recoverable at each level (for the README/docs). */
export const EC_RECOVERY: Record<EcLevel, string> = {
  L: "~7%",
  M: "~15%",
  Q: "~25%",
  H: "~30%",
};

export interface BlockGroup {
  blocks: number;
  dataCodewords: number;
}

export interface VersionInfo {
  version: number;
  /** Total codewords in the symbol (data + ECC). */
  totalCodewords: number;
  /** ECC codewords per block, by error-correction level. */
  ecCodewordsPerBlock: Record<EcLevel, number>;
  /** Block layout for each error-correction level. */
  blocks: Record<EcLevel, BlockGroup[]>;
  /** Centres of the alignment patterns (empty for version 1). */
  alignmentCenters: number[];
}

const V: (
  version: number,
  total: number,
  ec: Record<EcLevel, number>,
  blocks: Record<EcLevel, BlockGroup[]>,
  alignment: number[],
) => VersionInfo = (version, totalCodewords, ecCodewordsPerBlock, blocks, alignmentCenters) => ({
  version,
  totalCodewords,
  ecCodewordsPerBlock,
  blocks,
  alignmentCenters,
});

const g = (blocks: number, dataCodewords: number): BlockGroup => ({ blocks, dataCodewords });

export const VERSIONS: readonly VersionInfo[] = [
  V(1, 26,
    { L: 7, M: 10, Q: 13, H: 17 },
    { L: [g(1, 19)], M: [g(1, 16)], Q: [g(1, 13)], H: [g(1, 9)] },
    []),
  V(2, 44,
    { L: 10, M: 16, Q: 22, H: 28 },
    { L: [g(1, 34)], M: [g(1, 28)], Q: [g(1, 22)], H: [g(1, 16)] },
    [6, 18]),
  V(3, 70,
    { L: 15, M: 26, Q: 18, H: 22 },
    { L: [g(1, 55)], M: [g(1, 44)], Q: [g(2, 17)], H: [g(2, 13)] },
    [6, 22]),
  V(4, 100,
    { L: 20, M: 18, Q: 26, H: 16 },
    { L: [g(1, 80)], M: [g(2, 32)], Q: [g(2, 24)], H: [g(4, 9)] },
    [6, 26]),
  V(5, 134,
    { L: 26, M: 24, Q: 18, H: 22 },
    { L: [g(1, 108)], M: [g(2, 43)], Q: [g(2, 15), g(2, 16)], H: [g(2, 11), g(2, 12)] },
    [6, 30]),
  V(6, 172,
    { L: 18, M: 16, Q: 24, H: 28 },
    { L: [g(2, 68)], M: [g(4, 27)], Q: [g(4, 19)], H: [g(4, 15)] },
    [6, 34]),
  V(7, 196,
    { L: 20, M: 18, Q: 18, H: 26 },
    { L: [g(2, 78)], M: [g(4, 31)], Q: [g(2, 14), g(4, 15)], H: [g(4, 13), g(1, 14)] },
    [6, 22, 38]),
  V(8, 242,
    { L: 24, M: 22, Q: 22, H: 26 },
    { L: [g(2, 97)], M: [g(2, 38), g(2, 39)], Q: [g(4, 18), g(2, 19)], H: [g(4, 14), g(2, 15)] },
    [6, 24, 42]),
  V(9, 292,
    { L: 30, M: 22, Q: 20, H: 24 },
    { L: [g(2, 116)], M: [g(3, 36), g(2, 37)], Q: [g(4, 16), g(4, 17)], H: [g(4, 12), g(4, 13)] },
    [6, 26, 46]),
  V(10, 346,
    { L: 18, M: 26, Q: 24, H: 28 },
    { L: [g(2, 68), g(2, 69)], M: [g(4, 43), g(1, 44)], Q: [g(6, 19), g(2, 20)], H: [g(6, 15), g(2, 16)] },
    [6, 28, 50]),
];

export const MAX_VERSION = VERSIONS.length;

/** Side length in modules of a symbol of this version. */
export function versionSize(version: number): number {
  return 21 + (version - 1) * 4;
}

export function getVersion(version: number): VersionInfo {
  const info = VERSIONS[version - 1];
  if (!info) throw new Error(`Unsupported QR version ${version} (supported 1–${MAX_VERSION})`);
  return info;
}

/** Total data codewords available at this version and level. */
export function dataCapacity(version: number, level: EcLevel): number {
  const info = getVersion(version);
  return info.blocks[level].reduce((sum, grp) => sum + grp.blocks * grp.dataCodewords, 0);
}

/** Character-count indicator length for byte mode at this version. */
export function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/**
 * Smallest version that fits `byteLength` bytes at the given level, or
 * null when even version 10 is too small.
 */
export function smallestVersion(byteLength: number, level: EcLevel): number | null {
  for (const info of VERSIONS) {
    // Bits needed: 4 (mode) + char-count bits + 8 per byte.
    const bits = 4 + charCountBits(info.version) + byteLength * 8;
    if (bits <= dataCapacity(info.version, level) * 8) return info.version;
  }
  return null;
}

/** Maximum byte payload at a level (version 10 capacity, minus overhead). */
export function maxBytes(level: EcLevel): number {
  const info = getVersion(MAX_VERSION);
  const bits = dataCapacity(MAX_VERSION, level) * 8 - 4 - charCountBits(MAX_VERSION);
  return Math.floor(bits / 8);
}
