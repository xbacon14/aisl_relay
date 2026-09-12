# @relay/backend — P0, source of truth

**Scope:** Express + TypeScript + PostgreSQL implementing [CONTRACT.md](../../CONTRACT.md) exactly.

**Done when:** `RELAY_API_URL=<your public URL> npm run contract:test` passes from a teammate's machine.

## Start here
- `src/server.ts` currently boots the in-memory contract implementation so the repo works end to end. Replace the store with Postgres; keep the HTTP layer identical (you can import `createApp` from `@relay/contract/mock` and pass your own store, as long as it implements the same methods as `InMemoryTaskStore`).
- `packages/contract/src/store.ts` holds the business rules (next = first PENDING by order, idempotent complete, `allDone`). Port them 1:1.

## Suggested schema
```sql
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('HOUSEHOLD','SCHOOL','EXTRACURRICULAR','OTHER')),
  duration_minutes int null check (duration_minutes > 0),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED')),
  "order" int not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
```
`order` for a batch = `max("order") + i + 1` inside one transaction.

## Local Postgres
```bash
docker run --name relay-pg -e POSTGRES_USER=relay -e POSTGRES_PASSWORD=relay -e POSTGRES_DB=relay -p 5432:5432 -d postgres:16
```

## Deploy
Needs a public HTTPS URL for Alexa. Cloud Run / Railway / Render are all fine. Set `RELAY_API_KEY` in prod and share it with the channel owners.
