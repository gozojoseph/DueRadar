import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { profiles } from "@dueradar/db/schema";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { onboardingSchema, profileUpdateSchema } from "../schemas.js";
import { ensureProfile, listCategories } from "../services/profile.js";
import { resyncUserReminders } from "@dueradar/scheduling";

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/me", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const profile = await ensureProfile(db, user);
    return {
      user: { id: user.id, email: profile.email, name: profile.displayName },
      profile,
      needsOnboarding: !profile.onboardedAt,
    };
  });

  app.get("/api/v1/profile", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const profile = await ensureProfile(db, user);
    const categories = await listCategories(db, user.id);
    return { profile, categories };
  });

  app.patch("/api/v1/profile", async (request) => {
    const user = await requireUser(request, env);
    const input = parseBody(profileUpdateSchema, request.body);
    const existing = await ensureProfile(db, user);

    const [updated] = await db
      .update(profiles)
      .set({
        ...input,
        displayName: input.displayName === undefined ? undefined : input.displayName,
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, user.id))
      .returning();

    if (!updated) throw notFound("Profile not found.");

    const reminderSettingsChanged =
      input.timezone !== undefined ||
      input.reminderTime !== undefined ||
      input.quietHoursStart !== undefined ||
      input.quietHoursEnd !== undefined ||
      input.emailReminders !== undefined ||
      input.pushReminders !== undefined;

    if (reminderSettingsChanged) {
      await resyncUserReminders(db, user.id);
    }

    await recordAudit(db, request, {
      userId: user.id,
      action: "profile.updated",
      entityType: "profile",
      entityId: user.id,
      metadata: {
        before: {
          timezone: existing.timezone,
          reminderTime: existing.reminderTime,
          emailReminders: existing.emailReminders,
          pushReminders: existing.pushReminders,
        },
      },
    });

    return { profile: updated };
  });

  app.post("/api/v1/profile/onboarding", async (request) => {
    const user = await requireUser(request, env);
    const input = parseBody(onboardingSchema, request.body ?? {});
    await ensureProfile(db, user);

    const [updated] = await db
      .update(profiles)
      .set({
        ...input,
        onboardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, user.id))
      .returning();

    if (!updated) throw notFound("Profile not found.");
    await resyncUserReminders(db, user.id);
    await recordAudit(db, request, {
      userId: user.id,
      action: "profile.onboarded",
      entityType: "profile",
      entityId: user.id,
    });
    return { profile: updated };
  });
}
