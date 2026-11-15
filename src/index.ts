/**
 * Public API of the QR generator.
 *
 *   import { encodeQr, toSvg, toPng, toAscii } from "typescript-qr-generator";
 *   const qr = encodeQr("https://example.com", "M");
 *   console.log(toAscii(qr));
 */
export { encodeQr, QrCode, formatInfo, versionInfo, penaltyScore } from "./encoder.js";
export type { EncodeOptions } from "./encoder.js";
export { toAscii, toSvg, toPng, QUIET_ZONE } from "./render.js";
export type { RenderOptions } from "./render.js";
export {
  getVersion,
  dataCapacity,
  smallestVersion,
  maxBytes,
  versionSize,
  MAX_VERSION,
} from "./capacity.js";
export type { EcLevel, VersionInfo } from "./capacity.js";
export { generatorPolynomial, computeEcc, verifyCodewords } from "./reedsolomon.js";
export { gfMul, gfDiv, gfPow } from "./galois.js";
