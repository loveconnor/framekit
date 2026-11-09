import * as recast from "recast";
import { parse as babelParse } from "@babel/parser";
import type { File } from "@babel/types";

/** Babel 8 parser configured for TS + JSX; recast needs tokens to reprint untouched code. */
const babelTs = {
  parse(source: string) {
    return babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      tokens: true,
      plugins: ["jsx", "typescript", "decorators"],
    });
  },
};

export type ParsedFile = {
  ast: File;
  code: string;
};

export class SourceParseError extends Error {
  constructor(message: string, public readonly file: string) {
    super(message);
  }
}

/** Parse TS/TSX/JS/JSX with Babel through recast so unchanged code round-trips byte for byte. */
export function parseSource(code: string, file: string): ParsedFile {
  try {
    const ast = recast.parse(code, { parser: babelTs }) as File;
    return { ast, code };
  } catch (error) {
    throw new SourceParseError(`${file}: ${(error as Error).message}`, file);
  }
}

export type PrintOptions = { tabWidth: number; quote: "single" | "double" };

export function detectPrintOptions(code: string): PrintOptions {
  const indents = code.match(/^( +)\S/gm) ?? [];
  let twoSpace = 0;
  let fourSpace = 0;
  for (const match of indents) {
    const width = match.length - 1;
    if (width % 4 === 0) fourSpace++;
    else if (width % 2 === 0) twoSpace++;
  }
  const doubleQuotes = (code.match(/=\s*"/g) ?? []).length + (code.match(/from\s+"/g) ?? []).length;
  const singleQuotes = (code.match(/=\s*'/g) ?? []).length + (code.match(/from\s+'/g) ?? []).length;
  return {
    tabWidth: twoSpace >= fourSpace ? 2 : 4,
    quote: singleQuotes > doubleQuotes ? "single" : "double",
  };
}

export function printSource(ast: File, options: PrintOptions): string {
  return recast.print(ast, {
    tabWidth: options.tabWidth,
    quote: options.quote,
    reuseWhitespace: true,
    wrapColumn: 100,
  }).code;
}

/** Throws if `code` is not parseable. Used after every mutation before the draft is accepted. */
export function assertParses(code: string, file: string): void {
  parseSource(code, file);
}
