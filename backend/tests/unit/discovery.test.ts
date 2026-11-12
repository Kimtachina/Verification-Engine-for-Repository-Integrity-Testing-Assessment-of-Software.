import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_IGNORE } from "@veritas/shared";
import { discoverFiles } from "../../src/engine/discovery/discover-files";
import type { DiscoveryResult } from "../../src/engine/discovery/source-file";
import { splitLines } from "../../src/engine/discovery/source-file";
import { tempTree } from "../helpers";

let tree: ReturnType<typeof tempTree>;
let result: DiscoveryResult;

beforeAll(async () => {
  tree = tempTree({
    "src/b.ts": "export const b = 1;\n",
    "src/a.ts": "a\nb\nc",
    "src/bom.py": "﻿print(1)\n",
    "src/latin1.txt": new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
    "assets/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
    "node_modules/pkg/index.js": "ignored",
    "lib/node_modules/pkg/x.js": "ignored",
    "dist/out.js": "ignored",
    "app.min.js": "ignored",
    "generated/schema.ts": "ignored by user pattern",
  });
  symlinkSync("/etc/hosts", join(tree.dir, "src/link-outside"));
  result = await discoverFiles({
    rootDir: tree.dir,
    ignorePatterns: [...DEFAULT_IGNORE, "generated/**"],
  });
});

afterAll(() => tree.cleanup());

const byPath = (path: string) => result.files.find((f) => f.path === path);

describe("discoverFiles", () => {
  test("finds files in sorted order with relative forward-slash paths", () => {
    expect(result.files.map((f) => f.path)).toEqual([
      "assets/logo.png",
      "src/a.ts",
      "src/b.ts",
      "src/bom.py",
      "src/latin1.txt",
    ]);
  });

  test("applies default and user ignore patterns, including nested dependency folders", () => {
    const paths = result.files.map((f) => f.path).join(" ");
    expect(paths).not.toContain("node_modules");
    expect(paths).not.toContain("dist/");
    expect(paths).not.toContain(".min.js");
    expect(paths).not.toContain("generated/");
  });

  test("never follows symlinks, and records them", () => {
    expect(byPath("src/link-outside")).toBeUndefined();
    expect(result.skipped).toContainEqual({ path: "src/link-outside", reason: "symlink" });
  });

  test("classifies encoding and loads text content", () => {
    expect(byPath("src/a.ts")).toMatchObject({
      encoding: "utf-8",
      lines: 3,
      language: "typescript",
    });
    expect(byPath("src/bom.py")).toMatchObject({
      encoding: "utf-8-bom",
      content: "print(1)\n",
      lines: 1,
    });
    expect(byPath("src/latin1.txt")).toMatchObject({ encoding: "invalid", content: null });
    expect(byPath("assets/logo.png")).toMatchObject({ encoding: "binary", content: null, size: 6 });
  });
});

describe("splitLines", () => {
  test.each([
    ["", []],
    ["a", ["a"]],
    ["a\n", ["a"]],
    ["a\r\nb\rc\n", ["a", "b", "c"]],
    ["\n\n", ["", ""]],
  ] as const)("%j", (input, expected) => {
    expect(splitLines(input)).toEqual([...expected]);
  });
});
