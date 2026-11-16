import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { categories } from "@dueradar/db/schema";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { conflict, notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { categoryInputSchema } from "../schemas.js";
import { ensureProfile, listCategories } from "../services/profile.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function registerCategoryRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/categories", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    await ensureProfile(db, user);
    return { categories: await listCategories(db, user.id) };
  });

  app.post("/api/v1/categories", async (request, reply) => {
    const user = await requireUser(request, env);
    const input = parseBody(categoryInputSchema, request.body);

    try {
      const [created] = await db
        .insert(categories)
        .values({
          userId: user.id,
          name: input.name,
          color: input.color ?? "#0f766e",
          icon: input.icon ?? "tag",
        })
        .returning();
      await recordAudit(db, request, {
        userId: user.id,
        action: "category.created",
        entityType: "category",
        entityId: created?.id,
      });
      return reply.code(201).send({ category: created });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("You already have a category with that name.");
      throw error;
    }
  });

  app.patch("/api/v1/categories/:id", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const input = parseBody(categoryInputSchema.partial(), request.body);

    try {
      const [updated] = await db
        .update(categories)
        .set({
          name: input.name,
          color: input.color,
          icon: input.icon,
        })
        .where(and(eq(categories.id, id), eq(categories.userId, user.id)))
        .returning();
      if (!updated) throw notFound("Category not found.");
      return { category: updated };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("You already have a category with that name.");
      throw error;
    }
  });

  app.delete("/api/v1/categories/:id", async (request, reply) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const [deleted] = await db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, user.id)))
      .returning({ id: categories.id });
    if (!deleted) throw notFound("Category not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "category.deleted",
      entityType: "category",
      entityId: id,
    });
    return reply.code(204).send();
  });
}
