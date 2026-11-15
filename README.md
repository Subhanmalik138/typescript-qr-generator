# QR Code Generator CLI

A zero-dependency QR code generator in TypeScript. It implements the QR
spec from scratch — Galois-field arithmetic, Reed–Solomon error correction,
mask evaluation — instead of wrapping a library, so the whole pipeline is
visible and testable.

```
$ qr-gen "https://example.com"
```

![ASCII QR code for https://example.com](docs/example-ascii.txt)

## Features

- **Byte-mode encoding**, QR versions 1–10, all four error-correction
  levels (L ~7%, M ~15%, Q ~25%, H ~30% recoverable)
- **Hand-rolled Reed–Solomon** ECC over GF(2^8) with the QR primitive
  polynomial 0x11D
- **All 8 mask patterns evaluated** with the spec's four penalty rules;
  the lowest-scoring mask wins
- **Three output formats**: terminal ASCII art, SVG, and PNG (the PNG
  encoder is hand-written on top of Node's built-in zlib — no image deps)
- **UTF-8 input**, including multi-byte characters (capacity counts bytes)
- Usable as a **library** (`encodeQr`, `toSvg`, `toPng`, `toAscii`) or as
  the `qr-gen` CLI

## Installation

Requires Node.js 20+.

```sh
npm install
npm run build
```

## Usage

```sh
# ASCII art on the terminal (default)
qr-gen "https://example.com"

# SVG / PNG files
qr-gen "https://example.com" --format svg --output example.svg
qr-gen "WIFI:T:WPA;S:HomeNet;P:secret;;" --level H --format png --output wifi.png

# Pipe text in, custom scale and quiet zone
echo "hello world" | qr-gen --format svg --scale 10 > hello.svg

# See which version / mask was chosen
qr-gen "hello" --info
# version 1  level M  mask 2  size 21x21  5 bytes
```

### Options

| Flag | Default | Description |
| --- | --- | --- |
| `--level <L\|M\|Q\|H>` | `M` | Error-correction level |
| `--format <ascii\|svg\|png>` | `ascii` | Output format |
| `--output <file>` | stdout | Write to a file instead of stdout |
| `--scale <n>` | `8` | Pixels per module (svg/png) |
| `--margin <n>` | `4` | Quiet-zone modules around the symbol |
| `--version <n>` | auto | Force QR version 1–10 |
| `--mask <n>` | auto | Force mask pattern 0–7 |
| `--info` | off | Print version, level, mask and size on stderr |

Capacity (byte mode, version 10): L 2953 B, M 2331 B, Q 1663 B, H 1273 B.
Input longer than the chosen level's capacity is rejected with an error.

## Library

```ts
import { encodeQr, toSvg, toPng, toAscii } from "./dist/index.js";

const qr = encodeQr("https://example.com", "M");
console.log(qr.version, qr.size, qr.mask); // 1 21 2
console.log(toAscii(qr));
```

## How it works

1. **Data encoding** — mode indicator (`0100`, byte mode), character count,
   UTF-8 payload, terminator, byte alignment, then alternating `0xEC` /
   `0x11` pad bytes up to the version's data capacity.
2. **Error correction** — data is split into blocks per the version table;
   each block gets Reed–Solomon ECC bytes from a generator polynomial of
   degree equal to the block's ECC count. Data and ECC codewords are then
   interleaved across blocks.
3. **Matrix layout** — finder patterns, timing patterns, alignment patterns,
   the dark module, and format/version information (BCH-coded) are placed
   first; data bits fill the remaining modules in the standard zig-zag.
4. **Masking** — all eight mask patterns are applied in turn and scored
   with the four penalty rules (runs, 2×2 blocks, finder-like patterns,
   dark-module ratio). The lowest score wins.

## Design decisions

- **Zero runtime dependencies.** The only imports are Node built-ins
  (`node:zlib` for PNG compression, `node:fs` for the CLI). A QR encoder
  is small enough to own outright, and owning it makes the Reed–Solomon
  and masking logic testable against the spec's published vectors.
- **Versions 1–10 only.** That covers payloads up to ~2.9 KB, which is
  every realistic CLI use (URLs, Wi-Fi credentials, vCards). Supporting
  versions 11–40 would triple the capacity tables for no practical gain.
- **Byte mode only.** Numeric and alphanumeric modes save bits for
  digit/uppercase-only payloads, but byte mode handles every input and
  keeps the encoder to one code path.
- **Penalty-driven mask choice, not a fixed mask.** The spec's scoring
  rules exist because some masks scan badly on some payloads; evaluating
  all eight costs almost nothing at these sizes.

## Testing

```sh
npm test
```

26 tests cover the Galois field, the Reed–Solomon encoder (including the
spec's "HELLO WORLD" version 1-M walkthrough vector), format/version
information known values, capacity-table consistency, matrix structure,
mask selection, and all three renderers.

## License

MIT
