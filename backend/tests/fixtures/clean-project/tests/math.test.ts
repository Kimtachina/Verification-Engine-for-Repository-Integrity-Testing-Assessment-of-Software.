import { expect, test } from "bun:test";
import { clamp } from "../src/math";

test("clamp", () => {
  expect(clamp(5, 0, 3)).toBe(3);
});
