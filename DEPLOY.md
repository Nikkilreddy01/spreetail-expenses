# DEPLOY

The app is a standard Next.js server with a SQLite database. Two supported paths.

## Option A — Render / Railway / Fly (SQLite on a persistent disk)

This keeps SQLite. The only requirement is that the database file lives on a
**persistent volume** (the default ephemeral filesystem is wiped on each deploy).

`render.yaml` in the repo describes this. Steps:

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint**, point it at the repo.
   Render reads `render.yaml`:
   - build: `npm install && npm run build`
   - start: `npm run db:push && npm run seed && npm start`
   - a 1 GB disk mounted at `/data`, with `DATABASE_URL=file:/data/prod.db`
3. Set `AUTH_SECRET` to a random string in the Render dashboard.
4. First deploy runs `db:push` (creates tables) and `seed` (imports the CSV →
   creates the "Flat 4B" group and logins). Remove `&& npm run seed` from the
   start command after the first successful deploy so it doesn't reset data.

> Why a disk: serverless filesystems are read-only/ephemeral, so a bare SQLite
> file would reset every cold start. The disk makes it durable.

## Option B — Vercel + Postgres (swap the provider)

For a serverless host, point Prisma at Postgres (e.g. Neon/Supabase free tier):

1. In `prisma/schema.prisma` change `provider = "sqlite"` → `provider = "postgresql"`.
2. Set `DATABASE_URL` to the Postgres connection string (Vercel env var).
3. `npx prisma migrate deploy` (or `db push`) then `npm run seed` once.
4. Deploy to Vercel — the app code is unchanged; only the datasource differs.

No application code depends on the database engine; all DB access is through
Prisma and the pure logic in `src/core` is storage-agnostic.

## Smoke test after deploy

1. Visit the URL → redirected to `/login`.
2. Log in as `aisha@flat.local` / `password`.
3. Group **Flat 4B** shows non-zero balances that sum to zero.
4. Open the **Import report** tab → anomalies listed, some "awaiting approval".
