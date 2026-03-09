import { Hono, type Context } from "hono";

type AppBindings = CloudflareBindings & {
  DB?: D1Database;
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
};

type SyncOperation = {
  opId: string;
  trackId: string;
  type: "upsert" | "delete";
  updatedAt: number;
  track?: unknown;
};

const app = new Hono<{ Bindings: AppBindings }>();

const TRACKS_TABLE_SQL = "CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)";

type AppContext = Context<{ Bindings: AppBindings }>;

function parseBasicAuth(headerValue: string | undefined) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  const encoded = headerValue.slice("Basic ".length).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

app.use("/api/*", async (c, next) => {
  const expectedUsername = c.env.BASIC_AUTH_USERNAME;
  const expectedPassword = c.env.BASIC_AUTH_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return c.json(
      {
        ok: false,
        error: "Basic auth not configured. Set BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD.",
      },
      503,
    );
  }

  const credentials = parseBasicAuth(c.req.header("authorization"));
  const authorized =
    credentials?.username === expectedUsername && credentials?.password === expectedPassword;

  if (!authorized) {
    c.header("WWW-Authenticate", 'Basic realm="Apex Lap Timer API"');
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  await next();
});

async function ensureDb(c: AppContext) {
  const db = c.env.DB;
  if (!db) {
    return c.json(
      {
        ok: false,
        error: "D1 binding not configured. Please bind DB in wrangler.jsonc.",
      },
      503,
    );
  }

  await db.prepare(TRACKS_TABLE_SQL).run();
  return db;
}

app.get("/api/tracks", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const sinceParam = c.req.query("since");
  const since = sinceParam ? Number(sinceParam) : 0;

  const result = Number.isFinite(since) && since > 0
    ? await db
        .prepare("SELECT id, data, updated_at, deleted FROM tracks WHERE updated_at > ? ORDER BY updated_at ASC")
        .bind(since)
        .all()
    : await db
        .prepare("SELECT id, data, updated_at, deleted FROM tracks ORDER BY updated_at ASC")
        .all();

  const tracks = (result.results ?? []).map((row: Record<string, unknown>) => {
    const deleted = Number(row.deleted ?? 0) === 1;
    return {
      id: String(row.id),
      updatedAt: Number(row.updated_at),
      deleted,
      track: deleted ? null : row.data ? JSON.parse(String(row.data)) : null,
    };
  });

  return c.json({
    ok: true,
    serverTime: Date.now(),
    tracks,
  });
});

app.post("/api/sync", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const body = await c.req.json<{ operations?: SyncOperation[] }>().catch(
    (): { operations?: SyncOperation[] } => ({}),
  );
  const operations = Array.isArray(body.operations) ? body.operations : [];

  if (operations.length === 0) {
    return c.json({ ok: true, ackOperationIds: [], serverTime: Date.now() });
  }

  const ackOperationIds: string[] = [];

  for (const op of operations) {
    if (!op || !op.opId || !op.trackId || !op.type || !Number.isFinite(op.updatedAt)) {
      continue;
    }

    const existing = await db
      .prepare("SELECT updated_at FROM tracks WHERE id = ?")
      .bind(op.trackId)
      .first<{ updated_at: number }>();

    const existingUpdatedAt = existing?.updated_at ?? 0;
    if (existingUpdatedAt > op.updatedAt) {
      ackOperationIds.push(op.opId);
      continue;
    }

    if (op.type === "delete") {
      await db
        .prepare(
          "INSERT INTO tracks (id, data, updated_at, deleted) VALUES (?, NULL, ?, 1) ON CONFLICT(id) DO UPDATE SET data = NULL, updated_at = excluded.updated_at, deleted = 1",
        )
        .bind(op.trackId, op.updatedAt)
        .run();
      ackOperationIds.push(op.opId);
      continue;
    }

    await db
      .prepare(
        "INSERT INTO tracks (id, data, updated_at, deleted) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = 0",
      )
      .bind(op.trackId, JSON.stringify(op.track ?? null), op.updatedAt)
      .run();
    ackOperationIds.push(op.opId);
  }

  return c.json({ ok: true, ackOperationIds, serverTime: Date.now() });
});

export default app;


