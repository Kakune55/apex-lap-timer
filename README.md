## Development

```txt
npm install
npm run dev:frontend
```

Run Cloudflare Worker locally (builds frontend into `public` first):

```txt
npm run dev
```

### Mobile Safari GPS Notes

- iOS Safari only allows geolocation on secure origins (`https://`) or `localhost`.
- Accessing your dev server from phone via `http://<LAN-IP>:<port>` can show no GPS signal even after allowing permission.
- Use a secure URL (for example your deployed `*.workers.dev` domain) when testing on iPhone.
- On iPhone, confirm `Settings > Safari > Location` is set to `Allow`.

## Deploy

```txt
npm run deploy
```

## Cloud Sync (Local + Cloud)

This project now uses a local-first sync model:

- Local first: every change is saved to `localStorage` immediately.
- Cloud second: a background queue retries sync to Cloudflare D1.
- Weak-network tolerance: failed sync operations stay in outbox and retry with exponential backoff.

### 1. Create D1 database

```txt
npx wrangler d1 create apex-lap-timer
```

Copy the returned `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.

### 2. Apply schema

```txt
npx wrangler d1 execute apex-lap-timer --local --file=schema.sql
npx wrangler d1 execute apex-lap-timer --remote --file=schema.sql
```

### 3. Regenerate bindings type

```txt
npm run cf-typegen
```

### 4. Run

```txt
npm run dev
```

Sync API endpoints:

- `POST /api/sync`
- `GET /api/tracks?since=<timestamp>`

Auth API endpoints:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Authentication Model

The app now uses classic login + session token auth:

- Login with username/password via `POST /api/auth/login`.
- Server returns a bearer token.
- Frontend stores token locally and sends `Authorization: Bearer <token>` for `/api/*` requests.
- Session validity is tracked in the `sessions` table.

No Basic Auth environment variables are required anymore.

### User Management (Manual)

This project intentionally does not implement registration/password reset UI yet. Manage users directly in D1.

#### 1. Generate password hash and salt

Use PBKDF2-SHA256 (same as backend verification):

```txt
npm run hash-password -- "YOUR_PASSWORD"
```

Optional args:

```txt
npm run hash-password -- "YOUR_PASSWORD" 100000
npm run hash-password -- "YOUR_PASSWORD" 100000 aabbccddeeff00112233445566778899
```

Use `100000` iterations for Cloudflare Worker compatibility.

Save the printed `salt`, `iter`, and `hash`.

#### 2. Create user

```sql
INSERT INTO users (
	user_id,
	display_name,
	auth_provider,
	password_hash,
	password_salt,
	password_iterations,
	is_active,
	created_at,
	updated_at
) VALUES (
	'kaku',
	'Kaku',
	'local',
	'<hash>',
	'<salt>',
	100000,
	1,
	CAST(strftime('%s','now') AS INTEGER) * 1000,
	CAST(strftime('%s','now') AS INTEGER) * 1000
);
```

#### 3. Update password

Regenerate `hash` + `salt`, then:

```sql
UPDATE users
SET password_hash = '<new_hash>',
		password_salt = '<new_salt>',
		password_iterations = 100000,
		updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE user_id = 'kaku';
```

#### 4. Disable / enable user

```sql
UPDATE users
SET is_active = 0,
		updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE user_id = 'kaku';
```

```sql
UPDATE users
SET is_active = 1,
		updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE user_id = 'kaku';
```

#### 5. Delete user (and all data)

Because of foreign keys with `ON DELETE CASCADE`, deleting a user removes tracks and sessions.

```sql
DELETE FROM users WHERE user_id = 'kaku';
```

#### 6. Useful queries

```sql
SELECT user_id, display_name, is_active, created_at, updated_at
FROM users
ORDER BY updated_at DESC;
```

```sql
SELECT user_id, COUNT(*) AS track_count
FROM tracks
GROUP BY user_id
ORDER BY track_count DESC;
```

## Types

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```
