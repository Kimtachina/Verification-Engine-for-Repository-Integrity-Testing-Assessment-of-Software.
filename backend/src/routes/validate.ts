import { type ZodType, z } from "zod";
import { HttpError } from "../services/http-error";

/** Parses request input with a shared schema; invalid input becomes a 400 naming the field. */
export function parseInput<T>(schema: ZodType<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, `Invalid ${what}`, z.prettifyError(result.error));
  return result.data;
}
