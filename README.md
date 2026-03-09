## Development

```txt
npm install
npm run dev:frontend
```

Run Cloudflare Worker locally (builds frontend into `public` first):

```txt
npm run dev
```

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

## Types

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```
