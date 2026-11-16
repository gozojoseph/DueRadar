import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { payments, subscriptions } from "@dueradar/db/schema";
import {
  addDaysToDate,
  daysInMonth,
  formatDate,
  formatMoney,
  sumByCurrency,
  todayInTimeZone,
} from "@dueradar/domain";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { parseBody } from "../lib/errors.js";
import { ensureProfile } from "../services/profile.js";
import { listOccurrences } from "../services/occurrences.js";

const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export async function registerDashboardRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/dashboard", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const profile = await ensureProfile(db, user);
    const today = todayInTimeZone(profile.timezone);
    const horizon = addDaysToDate(today, 30);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = `${today.slice(0, 7)}-${String(
      daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))),
    ).padStart(2, "0")}`;

    const pending = await listOccurrences(db, user.id, profile.timezone, {
      from: addDaysToDate(today, -365),
      to: horizon,
      status: "pending",
      limit: 500,
    });

    const overdue = pending.filter((row) => row.view === "overdue");
    const dueSoon = pending.filter((row) => row.view === "due");
    const upcoming = pending.filter((row) => row.view === "upcoming");
    const trials = pending.filter(
      (row) => row.kind === "trial" && row.dueDate <= addDaysToDate(today, 14),
    );

    const next = [...overdue, ...dueSoon]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
      .slice(0, 6);

    const dueThisMonth = pending.filter(
      (row) => row.dueDate >= monthStart && row.dueDate <= monthEnd,
    );
    const next30 = pending.filter((row) => row.dueDate >= today && row.dueDate <= horizon);

    const [activeCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")));

    const monthStartDate = new Date(`${monthStart}T00:00:00Z`);
    const monthEndDate = new Date(`${monthEnd}T23:59:59Z`);
    const paidRows = await db
      .select({
        currency: payments.currency,
        total: sql<string>`sum(${payments.amountMinor})`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.userId, user.id),
          gte(payments.paidAt, monthStartDate),
          lte(payments.paidAt, monthEndDate),
        ),
      )
      .groupBy(payments.currency);

    const recentPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, user.id))
      .orderBy(desc(payments.paidAt))
      .limit(5);

    return {
      today,
      timezone: profile.timezone,
      currency: profile.currency,
      counts: {
        active: activeCountRow?.count ?? 0,
        dueSoon: dueSoon.length,
        overdue: overdue.length,
        trials: trials.length,
        upcoming: upcoming.length,
      },
      next,
      overdue,
      trials,
      totals: {
        overdue: sumByCurrency(overdue),
        dueThisMonth: sumByCurrency(dueThisMonth),
        next30: sumByCurrency(next30),
        paidThisMonth: paidRows.map((row) => ({
          currency: row.currency,
          amountMinor: Number(row.total ?? 0),
        })),
      },
      recentPayments,
      formatted: {
        overdue: sumByCurrency(overdue).map((total) => formatMoney(total.amountMinor, total.currency)),
        dueThisMonth: sumByCurrency(dueThisMonth).map((total) =>
          formatMoney(total.amountMinor, total.currency),
        ),
        monthLabel: formatDate(`${today.slice(0, 7)}-01`, profile.locale, {
          month: "long",
          year: "numeric",
        }),
      },
    };
  });

  app.get("/api/v1/calendar", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const profile = await ensureProfile(db, user);
    const today = todayInTimeZone(profile.timezone);
    const query = parseBody(calendarQuerySchema, request.query);
    const year = query.year ?? Number(today.slice(0, 4));
    const month = query.month ?? Number(today.slice(5, 7));
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const last = `${year}-${String(month).padStart(2, "0")}-${String(
      daysInMonth(year, month),
    ).padStart(2, "0")}`;

    const occurrences = await listOccurrences(db, user.id, profile.timezone, {
      from: first,
      to: last,
      limit: 500,
    });

    return {
      year,
      month,
      first,
      last,
      today,
      occurrences,
    };
  });
}
