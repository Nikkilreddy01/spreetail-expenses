# DEPLOY

The app is a standard Next.js server with a SQLite database. Two supported paths.

## Option A — Render free tier (SQLite, re-seeded on boot)

`render.yaml` in the repo describes this. Steps:

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint**, point it at the repo.
   Render reads `render.yaml`:
   - build: `npm install --include=dev && npm run build`
   - start: `npm run db:push && npm run seed && npm start`
   - `DATABASE_URL=file:/tmp/prod.db`, `AUTH_SECRET` auto-generated
3. Click **Apply**. The build + first boot create tables and seed the CSV →
   the "Flat 4B" group, member logins, imported expenses, and anomalies.

> Free tier has no persistent disk, so SQLite lives in ephemeral `/tmp`. The
> start command re-seeds on every boot, so data is durable while the service is
> warm (covers a live demo) and rebuilds the exact seeded state after a cold
> restart. For data that survives restarts, use a paid plan + disk, or Option B.

> `--include=dev`: Render sets `NODE_ENV=production`, under which `npm install`
> skips devDependencies — but `prisma`, `typescript`, and `tsx` are needed to
> build and seed, so the flag forces them in.

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
