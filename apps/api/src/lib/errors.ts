import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, "bad_request", message, details);
}

export function unauthorized(message = "Sign in to continue."): ApiError {
  return new ApiError(401, "unauthorized", message);
}

export function forbidden(message = "You do not have access to this item."): ApiError {
  return new ApiError(403, "forbidden", message);
}

export function notFound(message = "Not found."): ApiError {
  return new ApiError(404, "not_found", message);
}

export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, "conflict", message, details);
}

export function tooMany(message = "Too many requests. Try again later."): ApiError {
  return new ApiError(429, "rate_limited", message);
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Please check the highlighted fields.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}
