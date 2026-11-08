# PENDING-1-additive.sql — applied

Applied to production 2026-11-08, with the owner's approval and the safeguards
they set.

## Provenance

| | |
|---|---|
| File | `supabase/PENDING-1-additive.sql` |
| sha256 | `f96873814e6a02c73414f66d39a9d15e7cb9d844736f2db725dc0affaa932d2a` |
| File last changed in | `2cdfab29d379ac6b52bb05511fbf749eb4aeef51` |
| Repo HEAD at application | `b8d6211783e35084257a4c1c405cfe28c9178b57` |
| Execution | wrapped in `BEGIN; … COMMIT;` — the file has no transaction control of its own, and nothing in it needs to run outside one |

## Backup

A fresh **physical** backup could not be taken: the Management API exposes no
on-demand backup, and `pg_dump` needs the database password, which is not held
here. What was taken instead, and verified:

- the platform's own daily backups exist — 7 retained, newest completed the
  morning of application, WAL-G enabled (PITR is **not** enabled)
- a full data export of the only two existing tables the migration alters,
  each verified against its live row count before proceeding
- the pre-change function list and column list, proving all six functions and
  both columns were absent
- row counts for all 24 public tables

This is proportionate because the migration **only creates**. It adds six
functions and one defaulted column to two tables, and changes no existing row.
The rollback is therefore complete without a dump.

## Rollback

`supabase/rollback/PENDING-1-rollback.sql`

Tested in **both directions before the migration was applied**, against tables
generated from production's real column definitions rather than invented
stubs — the first attempt used stubs and failed on a column that does not
exist in them, which proved only that the stubs were wrong.

Forward applied 6 of 6 functions and 2 of 2 columns; the rollback removed all
of them and verified so inside its own transaction; forward applied cleanly
again afterwards; and a second forward run on top of itself produced no errors.

## Verification after application

- all six functions present, with the expected signatures, all `SECURITY DEFINER`
- `channel` on both tables: `text`, `NOT NULL`, default `'both'`, one CHECK
  constraint each
- `EXECUTE` granted to `anon` and `authenticated` on all six
- every pre-existing row carries `channel = 'both'` — the default means an
  existing promotion applies everywhere, never nowhere
- **all 24 tables have exactly the row counts recorded before the migration**
- `web_deals()` returns HTTP 200 through the public API, the path the
  storefront will use
- the till still reads products, sales and promos

## Not included

`PENDING-2-closing.sql` remains unapplied. It narrows access rather than
adding, and its header states what must be true first.
