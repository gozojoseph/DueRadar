/**
 * Package-local HTTP-shaped error. The API maps these onto its own ApiError at
 * the route boundary; the worker logs them. Carrying statusCode and code keeps
 * the mapping lossless.
 */
export class ProviderError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
