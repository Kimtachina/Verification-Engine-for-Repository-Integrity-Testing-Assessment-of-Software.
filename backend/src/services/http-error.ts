/** An error with an HTTP status, turned into a JSON `{ error, details? }` response. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
