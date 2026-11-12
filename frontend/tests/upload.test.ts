import { describe, expect, test } from "bun:test";
import { isSafeRelativePath, UPLOAD_LIMITS, uploadDecision } from "@veritas/shared";
import { projectName } from "../src/components/scan/recent-scans";
import { selectUploadFiles } from "../src/lib/upload";

const f = (fullPath: string, size = 10) => ({ file: { size }, fullPath });

describe("selectUploadFiles", () => {
  test("strips the chosen folder's name and keeps it as the project name", () => {
    const s = selectUploadFiles([
      f("my-app/src/a.ts"),
      f("my-app/README.md"),
      f("my-app/package-lock.json"),
    ]);
    expect(s.name).toBe("my-app");
    expect(s.files.map((x) => x.path)).toEqual(["src/a.ts", "README.md", "package-lock.json"]);
    expect(s.bytes).toBe(30);
    expect(s.error).toBeNull();
  });

  test("skips dependency, build and VCS folders at any depth, and oversized files", () => {
    const s = selectUploadFiles([
      f("app/src/a.ts"),
      f("app/node_modules/react/index.js"),
      f("app/packages/web/node_modules/x/y.js"),
      f("app/.git/HEAD"),
      f("app/dist/bundle.js"),
      f("app/data/huge.csv", UPLOAD_LIMITS.maxFileBytes + 1),
    ]);
    expect(s.files.map((x) => x.path)).toEqual(["src/a.ts"]);
    expect(s.skipped).toEqual({ "ignored-folder": 4, "too-large": 1, "unsafe-path": 0 });
  });

  test("loose files without a common folder are uploaded as they are", () => {
    const s = selectUploadFiles([f("a.ts"), f("b/c.ts"), f("d/e.ts")]);
    expect(s.name).toBe("project");
    expect(s.files.map((x) => x.path)).toEqual(["a.ts", "b/c.ts", "d/e.ts"]);
  });

  test("errors: nothing uploadable, too many files, too large in total", () => {
    expect(selectUploadFiles([f("app/node_modules/x.js")]).error).toContain("ไม่มีไฟล์");
    const many = Array.from({ length: UPLOAD_LIMITS.maxFiles + 1 }, (_, i) => f(`app/f${i}.ts`, 1));
    expect(selectUploadFiles(many).error).toContain("เกินขีดจำกัด");
    const heavy = Array.from({ length: 30 }, (_, i) =>
      f(`app/f${i}.bin`, UPLOAD_LIMITS.maxFileBytes),
    );
    expect(selectUploadFiles(heavy).error).toContain("ขนาดรวม");
  });
});

describe("upload path rules (shared with the server)", () => {
  test.each([
    ["src/a.ts", true],
    ["a", true],
    ["โฟลเดอร์/ไฟล์.ts", true],
    ["../a.ts", false],
    ["src/../../a.ts", false],
    ["/abs.ts", false],
    ["src\\a.ts", false],
    ["C:/a.ts", false],
    ["src//a.ts", false],
    ["./a.ts", false],
    ["a\u0000b", false],
    ["", false],
    [`${"x".repeat(256)}.ts`, false],
  ])("isSafeRelativePath(%p) = %p", (path, safe) => {
    expect(isSafeRelativePath(path)).toBe(safe);
  });

  test("lockfiles are uploaded; the dependencies dimension reads them", () => {
    expect(uploadDecision("package-lock.json", 100)).toEqual({ upload: true });
    expect(uploadDecision("poetry.lock", 100)).toEqual({ upload: true });
  });
});

describe("projectName", () => {
  test.each([
    ["/x/.veritas/uploads/123/my-app", "my-app"],
    ["/repo/code", "code"],
    ["/repo/code/", "code"],
  ])("%p -> %p", (root, name) => {
    expect(projectName(root)).toBe(name);
  });
});
