import { describe, expect, it } from "bun:test";
import { priceFor } from "../src/pricing";

describe("priceFor", () => {
  it.only("discounts members", () => {
    expect(priceFor({ kind: "book", qty: 1, member: true }, 10)).toBe(9);
  });

  it.skip("handles coupons", () => {
    expect(priceFor({ kind: "other", qty: 1, coupon: "HALF" }, 10)).toBe(5);
  });
});
