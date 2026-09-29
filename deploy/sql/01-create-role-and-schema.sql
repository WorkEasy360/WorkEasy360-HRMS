-- ---------------------------------------------------------------------------
-- WorkEasy360 HRMS — own role + own schema inside the EXISTING shared database.
--
-- Run ONCE, as the admin user, connected to the shared database (`postgres`).
-- From the EC2 host (psql runs in a throwaway container):
--
--   docker run --rm -i -e PGPASSWORD -v "$PWD/sql:/sql:ro" postgres:18-alpine \
--     psql "host=<writer-endpoint> port=5432 dbname=postgres user=postgres sslmode=require" \
--          -v pw='<hrms_app password>' -v db=postgres \
--          -f /sql/01-create-role-and-schema.sql
--
-- What this touches: it creates ONE role (hrms_app) and ONE schema (hrms), and grants
-- that role CONNECT on the database. It does not alter, grant on, or revoke from any
-- existing object, role or schema. `public` (another product) and `helpdesk` (the help
-- desk app) and their grants are left exactly as they are.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- 1. The application role. LOGIN only: no superuser, createdb, createrole or
--    replication. The password is passed with -v pw=... so it never lands in a file.
CREATE ROLE hrms_app LOGIN PASSWORD :'pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Keep the app from hogging the shared cluster: the api uses at most 10 connections
-- (connection_limit=10 in DATABASE_URL) plus a couple for the one-off migrate job.
ALTER ROLE hrms_app CONNECTION LIMIT 20;

-- 2. Its own schema, owned by the role, so Prisma can create/alter tables, enums and
--    indexes there (and only there) during `prisma migrate deploy`.
--    PostgreSQL 16+ only lets the creator hand ownership to the role while it may
--    SET ROLE to it, so that is granted for this one statement and withdrawn again.
GRANT hrms_app TO CURRENT_USER WITH SET TRUE;
CREATE SCHEMA hrms AUTHORIZATION hrms_app;
GRANT hrms_app TO CURRENT_USER WITH SET FALSE;

-- 3. Unqualified names resolve to hrms. Prisma already sets search_path from
--    ?schema=hrms; this covers psql sessions and anything else connecting as the role.
ALTER ROLE hrms_app SET search_path = hrms;

-- 4. Let the role connect to this database (explicit in case PUBLIC's CONNECT was
--    revoked by the DBA). Affects only hrms_app.
GRANT CONNECT ON DATABASE :"db" TO hrms_app;

-- ---------------------------------------------------------------------------
-- Deliberately NOT done here:
--  * REVOKE ... FROM PUBLIC on any schema or database — that would change what EVERY
--    role in the shared database may do.
--  * CREATE EXTENSION — the migrations need none (scripts/check-migrations.sh enforces it).
--  * Any statement on `public` or `helpdesk`.
-- ---------------------------------------------------------------------------

-- Verify (as admin):
--   \dn+ hrms
--   SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolconnlimit, rolconfig
--     FROM pg_roles WHERE rolname = 'hrms_app';
