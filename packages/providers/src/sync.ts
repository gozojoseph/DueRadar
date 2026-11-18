import { and, eq, inArray } from "drizzle-orm";
import { imports, providerConnections } from "@dueradar/db/schema";
import type { PushClient } from "@dueradar/push";
import { ProviderError } from "./errors.js";
import {
  currentGmailTokens,
  extractGmailText,
  gmailApiRequest,
  GMAIL_PAGE_SIZE,
  GMAIL_PROVIDER,
  GMAIL_SEARCH_QUERY,
  header,
  mapConcurrent,
  type GmailClientConfig,
  type GmailConnectionState,
  type GmailMessage,
} from "./gmail-client.js";
import { createMessageImport, type DraftEnhancer, type SuggestionDto } from "./imports-core.js";
import { createDetectionNotifierCore } from "./notify.js";
import type { Database } from "./database.js";

const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailSyncContext {
  db: Database;
  userId: string;
  config: GmailClientConfig;
  encryptionKey: Buffer;
  /** Used to build the push notification's tap-through URL. */
  appOrigin: string;
  push: PushClient;
}

export interface GmailSyncOptions {
  now?: Date;
  enhance?: DraftEnhancer;
  /**
   * Manual syncs resume the stored pagination cursor. Automatic polls pass
   * false: they always read page one (the freshest matches) and leave the
   * user's manual pagination progress untouched.
   */
  useCursor?: boolean;
}

export interface GmailSyncResult {
  imported: number;
  skippedDuplicates: number;
  detected: number;
  hasMore: boolean;
  message: string;
}

export async function syncGmailConnection(
  ctx: GmailSyncContext,
  options: GmailSyncOptions = {},
): Promise<GmailSyncResult> {
  const useCursor = options.useCursor ?? true;
  const clientCtx = {
    db: ctx.db,
    userId: ctx.userId,
    config: ctx.config,
    encryptionKey: ctx.encryptionKey,
  };

  let current: GmailConnectionState = await currentGmailTokens(clientCtx);
  const listUrl = new URL(`${GMAIL_API_URL}/messages`);
  listUrl.searchParams.set("q", GMAIL_SEARCH_QUERY);
  listUrl.searchParams.set("maxResults", String(GMAIL_PAGE_SIZE));
  if (useCursor && current.connection.cursor) {
    listUrl.searchParams.set("pageToken", current.connection.cursor);
  }

  const listed = await gmailApiRequest<GmailMessageList>(
    clientCtx,
    `${listUrl.pathname.replace("/gmail/v1/users/me", "")}${listUrl.search}`,
    current,
  );
  current = listed.current;
  const messageIds = (listed.data.messages ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const importIds = messageIds.map((id) => `gmail:${id}`);
  const existingImports =
    importIds.length > 0
      ? await ctx.db
          .select({ messageId: imports.messageId })
          .from(imports)
          .where(
            and(
              eq(imports.userId, ctx.userId),
              eq(imports.source, "email"),
              inArray(imports.messageId, importIds),
            ),
          )
      : [];
  const importedIds = new Set(
    existingImports.map((entry) => entry.messageId).filter((value): value is string => Boolean(value)),
  );
  const newIds = messageIds.filter((id) => !importedIds.has(`gmail:${id}`));

  const messages = await mapConcurrent(newIds, 5, async (id) => {
    const response = await gmailApiRequest<GmailMessage>(
      clientCtx,
      `/messages/${encodeURIComponent(id)}?format=full`,
      current,
    );
    current = response.current;
    return response.data;
  });

  let detected = 0;
  let imported = 0;
  const collected: SuggestionDto[] = [];
  for (const message of messages) {
    if (!message.id) continue;
    const text = extractGmailText(message);
    if (!text.trim()) continue;
    const result = await createMessageImport(
      ctx.db,
      ctx.userId,
      {
        source: "email",
        text,
        subject: header(message, "subject"),
        fromAddress: header(message, "from"),
        messageId: `gmail:${message.id}`,
        metadata: {
          provider: GMAIL_PROVIDER,
          gmailMessageId: message.id,
          internalDate: message.internalDate ?? null,
        },
      },
      {
        now: options.now,
        enhance: options.enhance,
        onNewDetections: (fresh) => {
          collected.push(...fresh);
        },
      },
    );
    imported += 1;
    detected += result.summary.detected;
  }

  // One batched notification per sync run, never one per message. The user is
  // not looking at the app when Gmail finds something, so push as well.
  if (collected.length > 0) {
    const notifier = createDetectionNotifierCore({
      db: ctx.db,
      userId: ctx.userId,
      push: ctx.push,
      appOrigin: ctx.appOrigin,
    });
    await notifier.notify({
      sourceLabel: "your Gmail",
      suggestions: collected,
      withPush: true,
    });
  }

  const syncedAt = (options.now ?? new Date()).toISOString();
  const hasMore = useCursor && Boolean(listed.data.nextPageToken);
  const metadata = {
    ...(current.connection.metadata ?? {}),
    lastSyncedAt: syncedAt,
  };
  await ctx.db
    .update(providerConnections)
    .set({
      cursor: useCursor ? (listed.data.nextPageToken ?? null) : current.connection.cursor,
      metadata,
    })
    .where(
      and(
        eq(providerConnections.id, current.connection.id),
        eq(providerConnections.userId, ctx.userId),
      ),
    );

  const skippedDuplicates = messageIds.length - newIds.length;
  const message =
    imported > 0
      ? `Imported ${imported} Gmail ${imported === 1 ? "message" : "messages"} and found ${detected} ${detected === 1 ? "candidate" : "candidates"}.${hasMore ? " Scan again to continue through older messages." : ""}`
      : skippedDuplicates > 0
        ? "No new matching messages were found in this batch."
        : "No matching billing messages were found in this batch.";
  return { imported, skippedDuplicates, detected, hasMore, message };
}

interface GmailMessageList {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
}

export { ProviderError };
