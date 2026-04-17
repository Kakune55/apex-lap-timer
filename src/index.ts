import { Hono, type Context } from "hono";

type AppBindings = CloudflareBindings & {
  DB?: D1Database;
};

type SyncOperation = {
  opId: string;
  trackId: string;
  type: "upsert" | "delete";
  updatedAt: number;
  track?: unknown;
};

type AuthUser = {
  userId: string;
  displayName: string | null;
  dashboardAccess: boolean;
  isAdmin: boolean;
};

type AppVars = {
  authUser: AuthUser | null;
  tokenHash: string | null;
};

type UserRow = {
  user_id: string;
  display_name: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  is_active: number;
  dashboard_access: number;
  is_admin: number;
  created_at: number;
  updated_at: number;
};

const app = new Hono<{ Bindings: AppBindings; Variables: AppVars }>();

const USERS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, display_name TEXT, auth_provider TEXT NOT NULL DEFAULT 'local', password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL DEFAULT 100000, is_active INTEGER NOT NULL DEFAULT 1, dashboard_access INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)";
const TRACKS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS tracks (user_id TEXT NOT NULL, track_id TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, track_id), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE)";
const SESSIONS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE)";
const USERS_UPDATED_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)";
const TRACKS_USER_UPDATED_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_tracks_user_updated_at ON tracks(user_id, updated_at)";
const SESSIONS_USER_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at)";
const SESSIONS_EXPIRES_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_SLIDING_TTL_MS = SESSION_TTL_MS;
const PBKDF2_DEFAULT_ITERATIONS = 100000;
const PBKDF2_MAX_ITERATIONS = 100000;

type AppContext = Context<{ Bindings: AppBindings; Variables: AppVars }>;

function normalizeUserId(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeOptionalDisplayName(raw: string | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function normalizePassword(raw: string | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 6 || trimmed.length > 128) {
    return null;
  }

  return raw;
}

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    return null;
  }

  const token = headerValue.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  return token;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function utf8Buffer(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64FromBytes(bytes);
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Buffer(value));
  return bytesToHex(new Uint8Array(digest));
}

async function pbkdf2Sha256Hex(password: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", utf8Buffer(password), "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: utf8Buffer(salt),
      iterations,
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

async function verifyPassword(
  password: string,
  passwordHash: string,
  passwordSalt: string,
  passwordIterations: number,
): Promise<boolean> {
  const computed = await pbkdf2Sha256Hex(password, passwordSalt, passwordIterations);
  return computed === passwordHash;
}

function booleanFlag(value: unknown): number {
  return value ? 1 : 0;
}

function sanitizedDisplayName(userId: string, displayName: string | null): string {
  const trimmed = displayName?.trim();
  return trimmed || userId;
}

function sanitizeSessionUser(user: Pick<UserRow, "user_id" | "display_name" | "dashboard_access" | "is_admin">): AuthUser {
  return {
    userId: user.user_id,
    displayName: sanitizedDisplayName(user.user_id, user.display_name),
    dashboardAccess: Number(user.dashboard_access) === 1,
    isAdmin: Number(user.is_admin) === 1,
  };
}

function sanitizeAdminUser(
  user: Pick<UserRow, "user_id" | "display_name" | "dashboard_access" | "is_admin" | "is_active" | "created_at" | "updated_at">,
) {
  return {
    userId: user.user_id,
    displayName: user.display_name,
    dashboardAccess: Number(user.dashboard_access) === 1,
    isAdmin: Number(user.is_admin) === 1,
    isActive: Number(user.is_active) === 1,
    createdAt: Number(user.created_at),
    updatedAt: Number(user.updated_at),
  };
}

function unauthorized(c: AppContext) {
  return c.json({ ok: false, error: "Unauthorized" }, 401);
}

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

  await db.prepare(USERS_TABLE_SQL).run();
  await db.prepare(TRACKS_TABLE_SQL).run();
  await db.prepare(SESSIONS_TABLE_SQL).run();
  await db.prepare(USERS_UPDATED_INDEX_SQL).run();
  await db.prepare(TRACKS_USER_UPDATED_INDEX_SQL).run();
  await db.prepare(SESSIONS_USER_INDEX_SQL).run();
  await db.prepare(SESSIONS_EXPIRES_INDEX_SQL).run();

  const columns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const columnNames = new Set((columns.results ?? []).map((row) => String(row.name)));

  if (!columnNames.has("dashboard_access")) {
    await db.prepare("ALTER TABLE users ADD COLUMN dashboard_access INTEGER NOT NULL DEFAULT 0").run();
  }

  if (!columnNames.has("is_admin")) {
    await db.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run();
  }

  return db;
}

function authUserIdOr401(c: AppContext): string | Response {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }
  return authUser.userId;
}

function adminUserOr403(c: AppContext): AuthUser | Response {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  if (!authUser.isAdmin) {
    return c.json({ ok: false, error: "Forbidden" }, 403);
  }

  return authUser;
}

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/auth/login") {
    c.set("authUser", null);
    c.set("tokenHash", null);
    await next();
    return;
  }

  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) {
    return unauthorized(c);
  }

  const tokenHash = await sha256Hex(token);
  const nowTs = Date.now();
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowTs).run();

  const session = await db
    .prepare(
      "SELECT s.user_id, s.expires_at, u.display_name, u.is_active, u.dashboard_access, u.is_admin FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ?",
    )
    .bind(tokenHash)
    .first<{
      user_id: string;
      expires_at: number;
      display_name: string | null;
      is_active: number;
      dashboard_access: number;
      is_admin: number;
    }>();

  if (!session || Number(session.is_active) !== 1 || session.expires_at <= nowTs) {
    return unauthorized(c);
  }

  const refreshedExpiresAt = nowTs + SESSION_SLIDING_TTL_MS;
  await db
    .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
    .bind(nowTs, refreshedExpiresAt, tokenHash)
    .run();

  c.set("authUser", sanitizeSessionUser(session));
  c.set("tokenHash", tokenHash);

  await next();
});

app.post("/api/auth/login", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const body = await c.req.json<{ username?: string; password?: string }>().catch(
    (): { username?: string; password?: string } => ({}),
  );

  const username = normalizeUserId(body.username);
  const password = body.password ?? "";

  if (!username || !password) {
    return c.json({ ok: false, error: "Username and password are required" }, 400);
  }

  const user = await db
    .prepare(
      "SELECT user_id, display_name, password_hash, password_salt, password_iterations, is_active, dashboard_access, is_admin, created_at, updated_at FROM users WHERE user_id = ?",
    )
    .bind(username)
    .first<UserRow>();

  if (!user || Number(user.is_active) !== 1) {
    return unauthorized(c);
  }

  const passwordIterations = Number(user.password_iterations) || PBKDF2_DEFAULT_ITERATIONS;
  if (passwordIterations > PBKDF2_MAX_ITERATIONS) {
    return c.json(
      {
        ok: false,
        error: `User password_iterations exceeds Worker PBKDF2 limit (${PBKDF2_MAX_ITERATIONS}). Re-hash with ${PBKDF2_MAX_ITERATIONS}.`,
      },
      500,
    );
  }

  const passwordOk = await verifyPassword(
    password,
    user.password_hash,
    user.password_salt,
    passwordIterations,
  );
  if (!passwordOk) {
    return unauthorized(c);
  }

  const nowTs = Date.now();
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowTs).run();

  const rawToken = randomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const sessionId = crypto.randomUUID();
  const expiresAt = nowTs + SESSION_SLIDING_TTL_MS;

  await db
    .prepare(
      "INSERT INTO sessions (session_id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(sessionId, user.user_id, tokenHash, nowTs, expiresAt, nowTs)
    .run();

  await db.prepare("UPDATE users SET updated_at = ? WHERE user_id = ?").bind(nowTs, user.user_id).run();

  return c.json({
    ok: true,
    token: rawToken,
    expiresAt,
    user: sanitizeSessionUser(user),
  });
});

app.get("/api/auth/me", async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  return c.json({ ok: true, user: authUser });
});

app.post("/api/auth/logout", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const tokenHash = c.get("tokenHash");
  if (tokenHash) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  return c.json({ ok: true });
});

app.get("/api/admin/users", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const adminOrResponse = adminUserOr403(c);
  if (adminOrResponse instanceof Response) {
    return adminOrResponse;
  }

  const rows = await dbOrResponse
    .prepare(
      "SELECT user_id, display_name, dashboard_access, is_admin, is_active, created_at, updated_at FROM users ORDER BY updated_at DESC, user_id ASC",
    )
    .all<UserRow>();

  return c.json({
    ok: true,
    users: (rows.results ?? []).map((row) => sanitizeAdminUser(row)),
  });
});

app.post("/api/admin/users", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const adminOrResponse = adminUserOr403(c);
  if (adminOrResponse instanceof Response) {
    return adminOrResponse;
  }

  const body = await c.req
    .json<{
      userId?: string;
      displayName?: string;
      password?: string;
      dashboardAccess?: boolean;
      isAdmin?: boolean;
      isActive?: boolean;
    }>()
    .catch(() => ({}));

  const userId = normalizeUserId(body.userId);
  const password = normalizePassword(body.password);

  if (!userId || !password) {
    return c.json({ ok: false, error: "Valid userId and password are required" }, 400);
  }

  const existing = await dbOrResponse
    .prepare("SELECT user_id FROM users WHERE user_id = ?")
    .bind(userId)
    .first<{ user_id: string }>();
  if (existing) {
    return c.json({ ok: false, error: "User already exists" }, 409);
  }

  const nowTs = Date.now();
  const salt = randomHex(16);
  const passwordHash = await pbkdf2Sha256Hex(password, salt, PBKDF2_DEFAULT_ITERATIONS);
  const isAdmin = booleanFlag(body.isAdmin);
  const dashboardAccess = isAdmin === 1 ? 1 : booleanFlag(body.dashboardAccess);

  await dbOrResponse
    .prepare(
      "INSERT INTO users (user_id, display_name, auth_provider, password_hash, password_salt, password_iterations, is_active, dashboard_access, is_admin, created_at, updated_at) VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      userId,
      normalizeOptionalDisplayName(body.displayName),
      passwordHash,
      salt,
      PBKDF2_DEFAULT_ITERATIONS,
      booleanFlag(body.isActive ?? true),
      dashboardAccess,
      isAdmin,
      nowTs,
      nowTs,
    )
    .run();

  const created = await dbOrResponse
    .prepare(
      "SELECT user_id, display_name, dashboard_access, is_admin, is_active, created_at, updated_at FROM users WHERE user_id = ?",
    )
    .bind(userId)
    .first<UserRow>();

  return c.json({ ok: true, user: created ? sanitizeAdminUser(created) : null });
});

app.put("/api/admin/users/:userId", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const adminOrResponse = adminUserOr403(c);
  if (adminOrResponse instanceof Response) {
    return adminOrResponse;
  }

  const targetUserId = normalizeUserId(c.req.param("userId"));
  if (!targetUserId) {
    return c.json({ ok: false, error: "Invalid userId" }, 400);
  }

  const body = await c.req
    .json<{
      displayName?: string;
      password?: string;
      dashboardAccess?: boolean;
      isAdmin?: boolean;
      isActive?: boolean;
    }>()
    .catch(() => ({}));

  const existing = await dbOrResponse
    .prepare(
      "SELECT user_id, display_name, password_hash, password_salt, password_iterations, is_active, dashboard_access, is_admin, created_at, updated_at FROM users WHERE user_id = ?",
    )
    .bind(targetUserId)
    .first<UserRow>();
  if (!existing) {
    return c.json({ ok: false, error: "User not found" }, 404);
  }

  const nextDisplayName =
    typeof body.displayName === "string" ? normalizeOptionalDisplayName(body.displayName) : existing.display_name;
  const nextIsAdmin = typeof body.isAdmin === "boolean" ? booleanFlag(body.isAdmin) : Number(existing.is_admin);
  const requestedDashboardAccess =
    typeof body.dashboardAccess === "boolean" ? booleanFlag(body.dashboardAccess) : Number(existing.dashboard_access);
  const nextDashboardAccess = nextIsAdmin === 1 ? 1 : requestedDashboardAccess;
  const nextIsActive = typeof body.isActive === "boolean" ? booleanFlag(body.isActive) : Number(existing.is_active);
  const nowTs = Date.now();

  if (adminOrResponse.userId === targetUserId && nextIsAdmin !== 1) {
    return c.json({ ok: false, error: "You cannot remove your own admin permission" }, 400);
  }

  if (adminOrResponse.userId === targetUserId && nextIsActive !== 1) {
    return c.json({ ok: false, error: "You cannot disable your own account" }, 400);
  }

  let passwordHash = existing.password_hash;
  let passwordSalt = existing.password_salt;
  let passwordIterations = Number(existing.password_iterations) || PBKDF2_DEFAULT_ITERATIONS;

  if (typeof body.password === "string" && body.password.trim()) {
    const nextPassword = normalizePassword(body.password);
    if (!nextPassword) {
      return c.json({ ok: false, error: "Password must be 6-128 characters" }, 400);
    }
    passwordSalt = randomHex(16);
    passwordHash = await pbkdf2Sha256Hex(nextPassword, passwordSalt, PBKDF2_DEFAULT_ITERATIONS);
    passwordIterations = PBKDF2_DEFAULT_ITERATIONS;
  }

  await dbOrResponse
    .prepare(
      "UPDATE users SET display_name = ?, password_hash = ?, password_salt = ?, password_iterations = ?, is_active = ?, dashboard_access = ?, is_admin = ?, updated_at = ? WHERE user_id = ?",
    )
    .bind(
      nextDisplayName,
      passwordHash,
      passwordSalt,
      passwordIterations,
      nextIsActive,
      nextDashboardAccess,
      nextIsAdmin,
      nowTs,
      targetUserId,
    )
    .run();

  const updated = await dbOrResponse
    .prepare(
      "SELECT user_id, display_name, dashboard_access, is_admin, is_active, created_at, updated_at FROM users WHERE user_id = ?",
    )
    .bind(targetUserId)
    .first<UserRow>();

  return c.json({ ok: true, user: updated ? sanitizeAdminUser(updated) : null });
});

app.delete("/api/admin/users/:userId", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const adminOrResponse = adminUserOr403(c);
  if (adminOrResponse instanceof Response) {
    return adminOrResponse;
  }

  const targetUserId = normalizeUserId(c.req.param("userId"));
  if (!targetUserId) {
    return c.json({ ok: false, error: "Invalid userId" }, 400);
  }

  if (adminOrResponse.userId === targetUserId) {
    return c.json({ ok: false, error: "You cannot delete your own account" }, 400);
  }

  await dbOrResponse.prepare("DELETE FROM users WHERE user_id = ?").bind(targetUserId).run();
  return c.json({ ok: true });
});

app.get("/api/tracks", async (c) => {
  const dbOrResponse = await ensureDb(c);
  if (dbOrResponse instanceof Response) {
    return dbOrResponse;
  }

  const db = dbOrResponse;
  const userIdOrResponse = authUserIdOr401(c);
  if (userIdOrResponse instanceof Response) {
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

  const sinceParam = c.req.query("since");
  const since = sinceParam ? Number(sinceParam) : 0;
  const result = Number.isFinite(since) && since > 0
    ? await db
        .prepare(
          "SELECT track_id, data, updated_at, deleted FROM tracks WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC",
        )
        .bind(userId, since)
        .all()
    : await db
        .prepare(
          "SELECT track_id, data, updated_at, deleted FROM tracks WHERE user_id = ? ORDER BY updated_at ASC",
        )
        .bind(userId)
        .all();

  const tracks = (result.results ?? []).map((row: Record<string, unknown>) => {
    const deleted = Number(row.deleted ?? 0) === 1;
    return {
      id: String(row.track_id),
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
  const userIdOrResponse = authUserIdOr401(c);
  if (userIdOrResponse instanceof Response) {
    return userIdOrResponse;
  }
  const userId = userIdOrResponse;

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
      .prepare("SELECT updated_at FROM tracks WHERE user_id = ? AND track_id = ?")
      .bind(userId, op.trackId)
      .first<{ updated_at: number }>();

    const existingUpdatedAt = existing?.updated_at ?? 0;
    if (existingUpdatedAt > op.updatedAt) {
      ackOperationIds.push(op.opId);
      continue;
    }

    if (op.type === "delete") {
      await db
        .prepare(
          "INSERT INTO tracks (user_id, track_id, data, updated_at, deleted) VALUES (?, ?, NULL, ?, 1) ON CONFLICT(user_id, track_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = 1",
        )
        .bind(userId, op.trackId, op.updatedAt)
        .run();
      ackOperationIds.push(op.opId);
      continue;
    }

    await db
      .prepare(
        "INSERT INTO tracks (user_id, track_id, data, updated_at, deleted) VALUES (?, ?, ?, ?, 0) ON CONFLICT(user_id, track_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = 0",
      )
      .bind(userId, op.trackId, JSON.stringify(op.track ?? null), op.updatedAt)
      .run();
    ackOperationIds.push(op.opId);
  }

  return c.json({ ok: true, ackOperationIds, serverTime: Date.now() });
});

export default app;
