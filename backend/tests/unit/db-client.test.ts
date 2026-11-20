import { describe, expect, test } from "bun:test";
import { redact } from "../../src/db/client";

describe("redact", () => {
  test("hides the password and keeps the rest of the URL", () => {
    expect(redact("postgresql://postgres.ref:s3cr%40t@pooler.example.com:5432/postgres")).toBe(
      "postgresql://postgres.ref:***@pooler.example.com:5432/postgres",
    );
  });

  test("a URL without a password is unchanged; a malformed one is not echoed", () => {
    expect(redact("postgresql://localhost/db")).toBe("postgresql://localhost/db");
    expect(redact("not a url with secret")).toBe("(invalid DATABASE_URL)");
  });
});
