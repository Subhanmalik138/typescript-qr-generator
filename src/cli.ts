#!/usr/bin/env node
/**
 * qr-gen CLI — generate QR codes from the terminal.
 *
 * Usage:
 *   qr-gen <text> [--level L|M|Q|H] [--format ascii|svg|png]
 *          [--output <file>] [--scale <n>] [--margin <n>]
 *          [--version <n>] [--mask <n>] [--info]
 *   echo "hello" | qr-gen --format svg --output hello.svg
 *
 * Examples:
 *   qr-gen "https://example.com"
 *   qr-gen "WIFI:T:WPA;S:HomeNet;P:secret;;" --level H --format png --output wifi.png
 *   qr-gen "hello world" --format svg --scale 10 > hello.svg
 */
import { readFileSync, writeFileSync } from "node:fs";
import { encodeQr } from "./encoder.js";
import { toAscii, toPng, toSvg } from "./render.js";
import { maxBytes, type EcLevel } from "./capacity.js";

const LEVELS: EcLevel[] = ["L", "M", "Q", "H"];
const FORMATS = ["ascii", "svg", "png"] as const;
type Format = (typeof FORMATS)[number];

interface CliArgs {
  text: string | null;
  level: EcLevel;
  format: Format;
  output: string | null;
  scale: number;
  margin: number;
  version: number | undefined;
  mask: number | undefined;
  info: boolean;
  help: boolean;
}

function usage(): string {
  return [
    "Usage: qr-gen <text> [options]",
    "",
    "  <text>              text to encode (or pipe it on stdin)",
    "",
    "Options:",
    "  --level <L|M|Q|H>   error-correction level (default: M)",
    "                      L ~7%, M ~15%, Q ~25%, H ~30% recoverable",
    "  --format <fmt>      ascii | svg | png (default: ascii)",
    "  --output <file>     write to a file instead of stdout",
    "  --scale <n>         pixels per module for svg/png (default: 8)",
    "  --margin <n>        quiet-zone modules around the symbol (default: 4)",
    "  --version <n>       force QR version 1-10 (default: smallest that fits)",
    "  --mask <n>          force mask pattern 0-7 (default: best by penalty score)",
    "  --info              print version, level, mask and size on stderr",
    "  --help              show this help",
    "",
    `Capacity at each level (version 10, byte mode): L ${maxBytes("L")}B, M ${maxBytes("M")}B, Q ${maxBytes("Q")}B, H ${maxBytes("H")}B.`,
  ].join("\n");
}

function fail(message: string): never {
  console.error(`qr-gen: ${message}\nRun 'qr-gen --help' for usage.`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    text: null,
    level: "M",
    format: "ascii",
    output: null,
    scale: 8,
    margin: 4,
    version: undefined,
    mask: undefined,
    info: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const takeValue = (flag: string): string => {
      const value = argv[++i];
      if (value === undefined) fail(`${flag} needs a value`);
      return value;
    };
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--info") args.info = true;
    else if (arg === "--level") {
      const v = takeValue("--level").toUpperCase();
      if (!(LEVELS as string[]).includes(v)) fail(`--level must be one of L, M, Q, H (got ${v})`);
      args.level = v as EcLevel;
    } else if (arg === "--format") {
      const v = takeValue("--format").toLowerCase();
      if (!(FORMATS as readonly string[]).includes(v)) fail(`--format must be ascii, svg or png (got ${v})`);
      args.format = v as Format;
    } else if (arg === "--output" || arg === "-o") args.output = takeValue(arg);
    else if (arg === "--scale") {
      args.scale = Number(takeValue("--scale"));
      if (!Number.isInteger(args.scale) || args.scale < 1) fail("--scale must be an integer >= 1");
    } else if (arg === "--margin") {
      args.margin = Number(takeValue("--margin"));
      if (!Number.isInteger(args.margin) || args.margin < 0) fail("--margin must be an integer >= 0");
    } else if (arg === "--version") {
      args.version = Number(takeValue("--version"));
      if (!Number.isInteger(args.version) || args.version < 1 || args.version > 10) {
        fail("--version must be an integer between 1 and 10");
      }
    } else if (arg === "--mask") {
      args.mask = Number(takeValue("--mask"));
      if (!Number.isInteger(args.mask) || args.mask < 0 || args.mask > 7) {
        fail("--mask must be an integer between 0 and 7");
      }
    } else if (arg.startsWith("-")) {
      fail(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) fail("expected a single text argument");
  args.text = positional[0] ?? null;
  return args;
}

function readStdin(): string {
  return readFileSync(0, "utf-8").replace(/\r?\n$/, "");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  let text = args.text;
  if (text === null) {
    if (process.stdin.isTTY) fail("no text given — pass text as an argument or pipe it on stdin");
    text = readStdin();
  }
  if (text.length === 0) fail("cannot encode empty text");

  let qr;
  try {
    qr = encodeQr(text, args.level, { version: args.version, mask: args.mask });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (args.info) {
    console.error(
      `version ${qr.version}  level ${qr.level}  mask ${qr.mask}  size ${qr.size}x${qr.size}  ` +
        `${new TextEncoder().encode(text).length} bytes`,
    );
  }

  const renderOptions = { scale: args.scale, margin: args.margin };
  if (args.format === "png") {
    const png = toPng(qr, renderOptions);
    if (args.output) writeFileSync(args.output, png);
    else process.stdout.write(png);
  } else {
    const out = args.format === "svg" ? toSvg(qr, renderOptions) : toAscii(qr, renderOptions);
    if (args.output) writeFileSync(args.output, out + "\n");
    else console.log(out);
  }
}

main();
