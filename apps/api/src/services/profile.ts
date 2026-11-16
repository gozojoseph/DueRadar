import { and, eq, sql } from "drizzle-orm";
import { categories, profiles } from "@dueradar/db/schema";
import type { Profile } from "@dueradar/db/schema";
import type { Database } from "../db.js";
import type { AuthUser } from "../auth/jwt.js";
import { unauthorized } from "../lib/errors.js";

const DEFAULT_CATEGORIES = [
  { name: "Entertainment", color: "#7c3aed", icon: "clapperboard" },
  { name: "Utilities", color: "#0ea5e9", icon: "zap" },
  { name: "Internet & data", color: "#0f766e", icon: "wifi" },
  { name: "Housing", color: "#b45309", icon: "home" },
  { name: "Health", color: "#dc2626", icon: "heart-pulse" },
  { name: "Education", color: "#2563eb", icon: "graduation-cap" },
  { name: "Family", color: "#db2777", icon: "users" },
  { name: "Other", color: "#64748b", icon: "tag" },
];

export interface AuthIdentity {
  email: string | null;
  name: string | null;
}

/** Reads the managed auth user's identity without leaving the database. */
export async function lookupAuthIdentity(
  db: Database,
  userId: string,
): Promise<AuthIdentity> {
  try {
    const result = await db.execute(
      sql`select email, name from neon_auth."user" where id = ${userId}::uuid limit 1`,
    );
    const row = (result as unknown as { rows: Array<{ email?: string; name?: string }> }).rows[0];
    return { email: row?.email ?? null, name: row?.name ?? null };
  } catch {
    return { email: null, name: null };
  }
}

/** True only while the managed `neon_auth.user` row still exists. */
export async function authUserExists(db: Database, userId: string): Promise<boolean> {
  const result = await db.execute(
    sql`select 1 from neon_auth."user" where id = ${userId}::uuid limit 1`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows;
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureProfile(db: Database, user: AuthUser): Promise<Profile> {
  const existing = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  if (existing[0]) {
    const profile = existing[0];
    const email = user.email ?? (await lookupAuthIdentity(db, user.id)).email;
    if (email && email !== profile.email) {
      const [updated] = await db
        .update(profiles)
        .set({ email, updatedAt: new Date() })
        .where(eq(profiles.userId, user.id))
        .returning();
      return updated ?? { ...profile, email };
    }
    return profile;
  }

  // A deleted account leaves no profile. A bearer token can outlive deletion by
  // up to its 15-minute lifetime, so never recreate a profile for a user whose
  // auth identity is gone.
  if (!(await authUserExists(db, user.id))) {
    throw unauthorized("Your account no longer exists. Sign in again.");
  }

  const identity = await lookupAuthIdentity(db, user.id);
  const email = user.email ?? identity.email ?? "";
  const displayName = user.name ?? identity.name ?? null;

  const [created] = await db
    .insert(profiles)
    .values({ userId: user.id, email, displayName })
    .onConflictDoNothing()
    .returning();

  if (created) {
    await db
      .insert(categories)
      .values(
        DEFAULT_CATEGORIES.map((category) => ({
          userId: user.id,
          name: category.name,
          color: category.color,
          icon: category.icon,
          isDefault: true,
        })),
      )
      .onConflictDoNothing();
    return created;
  }

  const [raced] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);
  if (!raced) throw new Error("Failed to create profile");
  return raced;
}

export async function listCategories(db: Database, userId: string) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(categories.isDefault, categories.name);
}

export async function findOwnedCategory(db: Database, userId: string, categoryId: string) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return row ?? null;
}
