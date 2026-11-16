import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { emailAliases } from "@dueradar/db/schema";
import type { EmailAlias } from "@dueradar/db/schema";
import type { Database } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";

const MAX_RECIPIENTS = 60;

/** A fresh, unguessable local part. Lowercase keeps mail routing predictable. */
export function newAliasToken(): string {
  return randomBytes(12).toString("base64url").toLowerCase();
}

export function aliasAddress(token: string, domain: string): string {
  return `dr-${token}@${domain.trim().toLowerCase()}`;
}

/** Accepts `Name <a@b>`, `<a@b>` and a bare address. */
export function extractEmailAddress(value: string): string | null {
  const angle = /<([^<>]+)>/.exec(value);
  const candidate = (angle?.[1] ?? value).trim().toLowerCase().replace(/[.,;:]+$/, "");
  if (!candidate || candidate.length > 320) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate)) return null;
  return candidate;
}

export function extractEmailAddresses(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const found: string[] = [];
  for (const value of values.slice(0, MAX_RECIPIENTS)) {
    const address = extractEmailAddress(value);
    if (address && !found.includes(address)) found.push(address);
  }
  return found;
}

/** Plus tags route to the same mailbox, so `dr-x+netflix@` must match `dr-x@`. */
export function baseAliasAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const base = local.split("+")[0] ?? local;
  return `${base}@${domain}`;
}
const withoutPlusTag = baseAliasAddress;

export interface AliasMatch {
  alias: EmailAlias;
  recipient: string;
}

/**
 * Finds the active alias among all recipients. Revoked addresses never match,
 * even if a provider keeps delivering to them.
 */
export async function findActiveAlias(
  db: Database,
  recipients: readonly string[],
): Promise<AliasMatch | null> {
  const candidates: Array<{ address: string; recipient: string }> = [];
  for (const recipient of recipients) {
    for (const address of [recipient, withoutPlusTag(recipient)]) {
      if (!candidates.some((entry) => entry.address === address)) {
        candidates.push({ address, recipient });
      }
    }
  }
  if (candidates.length === 0) return null;

  const rows = await db
    .select()
    .from(emailAliases)
    .where(
      and(
        inArray(
          emailAliases.address,
          candidates.map((entry) => entry.address),
        ),
        isNull(emailAliases.revokedAt),
      ),
    )
    .limit(2);

  const alias = rows[0];
  if (!alias) return null;
  const match = candidates.find((entry) => entry.address === alias.address);
  return { alias, recipient: match?.recipient ?? alias.address };
}

export async function getActiveAlias(
  db: Database,
  userId: string,
): Promise<EmailAlias | null> {
  const [row] = await db
    .select()
    .from(emailAliases)
    .where(and(eq(emailAliases.userId, userId), isNull(emailAliases.revokedAt)))
    .orderBy(desc(emailAliases.createdAt))
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Creates the user's forwarding address or rotates it. Rotation revokes the old
 * address before issuing a new one, so a leaked address stops working at once.
 */
export async function createAlias(
  db: Database,
  userId: string,
  domain: string,
  options: { rotate?: boolean } = {},
): Promise<EmailAlias> {
  if (!domain) {
    throw conflict("Email forwarding is not available yet. Contact support.");
  }

  const existing = await getActiveAlias(db, userId);
  if (existing && !options.rotate) return existing;

  if (existing && options.rotate) {
    await db
      .update(emailAliases)
      .set({ revokedAt: new Date() })
      .where(and(eq(emailAliases.id, existing.id), eq(emailAliases.userId, userId)));
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const [created] = await db
        .insert(emailAliases)
        .values({ userId, address: aliasAddress(newAliasToken(), domain) })
        .returning();
      if (created) return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not allocate a forwarding address");
}

export async function revokeAlias(
  db: Database,
  userId: string,
  aliasId?: string,
): Promise<boolean> {
  const active = aliasId
    ? await (async () => {
        const [row] = await db
          .select()
          .from(emailAliases)
          .where(and(eq(emailAliases.id, aliasId), eq(emailAliases.userId, userId)))
          .limit(1);
        return row ?? null;
      })()
    : await getActiveAlias(db, userId);

  if (!active) {
    if (aliasId) throw notFound("Forwarding address not found.");
    return false;
  }
  await db
    .update(emailAliases)
    .set({ revokedAt: new Date() })
    .where(and(eq(emailAliases.id, active.id), eq(emailAliases.userId, userId)));
  return true;
}

export async function touchAlias(db: Database, aliasId: string): Promise<void> {
  await db
    .update(emailAliases)
    .set({ lastReceivedAt: new Date() })
    .where(eq(emailAliases.id, aliasId));
}
