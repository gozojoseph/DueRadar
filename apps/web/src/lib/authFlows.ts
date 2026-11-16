import { authClient } from "./auth";

export type OtpPurpose = "email-verification" | "sign-in" | "forget-password";

export interface AuthResultLike {
  data?: unknown;
  error?: unknown;
}

export function authFailureMessage(error: unknown): string {
  if (!error) return "Something went wrong. Try again.";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as { message?: string; statusText?: string; code?: string };
    if (record.message) return record.message;
    if (record.statusText) return record.statusText;
    if (record.code) return humaniseCode(record.code);
  }
  return "Something went wrong. Try again.";
}

function humaniseCode(code: string): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password do not match.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email before signing in.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with that email already exists.";
    case "INVALID_OTP":
      return "That code is not correct. Check it and try again.";
    case "OTP_EXPIRED":
      return "That code has expired. Request a new one.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return code.replaceAll("_", " ").toLowerCase();
  }
}

function resultOf(value: unknown): AuthResultLike {
  return (value ?? {}) as AuthResultLike;
}

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    signUp: { email: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.signUp.email(input));
}

export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    signIn: { email: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.signIn.email({ ...input, rememberMe: true }));
}

export async function sendOtp(email: string, type: OtpPurpose): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    emailOtp: { sendVerificationOtp: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.emailOtp.sendVerificationOtp({ email, type }));
}

export async function verifyEmailOtp(email: string, otp: string): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    emailOtp: { verifyEmail: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.emailOtp.verifyEmail({ email, otp }));
}

export async function signInWithOtp(email: string, otp: string): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    signIn: { emailOtp: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.signIn.emailOtp({ email, otp }));
}

export async function requestPasswordReset(email: string): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    emailOtp: { requestPasswordReset: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.emailOtp.requestPasswordReset({ email }));
}

export async function resetPassword(input: {
  email: string;
  otp: string;
  password: string;
}): Promise<AuthResultLike> {
  const client = authClient as unknown as {
    emailOtp: { resetPassword: (value: unknown) => Promise<unknown> };
  };
  return resultOf(await client.emailOtp.resetPassword(input));
}

export function hasSessionData(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as { user?: unknown; session?: unknown; token?: unknown };
  return Boolean((record.user && record.session) || record.token);
}

export function isVerificationError(error: unknown): boolean {
  const message = authFailureMessage(error).toLowerCase();
  const code =
    error && typeof error === "object" ? String((error as { code?: string }).code ?? "") : "";
  return (
    code === "EMAIL_NOT_VERIFIED" ||
    message.includes("not verified") ||
    message.includes("verify your email") ||
    message.includes("email verification")
  );
}
