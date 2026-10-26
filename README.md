# Murama School Platform

A bilingual school website and management system for Ecole Secondaire de Murama.

## Architecture

## Addressable administration routes

The administration UI uses browser-history routes, including direct-link and refresh support for these pages:

- `/admin/dashboard`
- `/admin/students`
- `/admin/academics`
- `/admin/users`
- `/admin/operations/attendance`
- `/admin/operations/gradebook`
- `/admin/operations/timetable`
- `/admin/operations/finance`
- `/admin/operations/messages`
- `/admin/announcements`
- `/admin/activity`
- `/admin/settings`

The Netlify SPA fallback serves the application for direct visits to these paths. Each admin module continues to use the authenticated Express API; the database credentials remain server-only.


- **Frontend:** React + TypeScript + Vite, public school information, admin dashboard, academic records, attendance, gradebook/report cards, timetable, finance and messaging screens.
- **API:** Node.js + Express. Existing authenticated route contracts and school business rules remain in the API layer.
- **Primary database:** Supabase-hosted PostgreSQL. All application API reads/writes and transaction workflows use the server-side PostgreSQL connection.
- **Identity:** Existing school roles and active-account checks are still determined by the public.users and public.roles records. Supabase Auth verifies Google identity; a verified email is matched to an existing school account before the API issues the platform JWT.
- **Legacy importer:** mysql2 remains only for the explicit, one-time MySQL/XAMPP data transfer command.

## Supabase project setup

1. Use the existing production Supabase project **muramaSDMS** (`ilmvmqxmasgasrtokjmz`, region `us-east-1`) and keep its database password private. Do not create a duplicate project.
2. Copy **backend/.env.example** to **backend/.env**. Set **SUPABASE_DB_URL** to the Supabase **session pooler** URI from Dashboard → Connect, **SUPABASE_URL** to the project URL, **SUPABASE_PUBLISHABLE_KEY** to the publishable key, and a private **JWT_SECRET** of at least 32 characters. Do not use a service-role/secret key in frontend variables.
3. The initial school schema and performance/security hardening migrations have already been applied to this Supabase project. Their tracked files are in `supabase/migrations/`. To reconcile or apply later checked-in migrations from the repository root:

   ~~~powershell
   npx supabase login
   npx supabase link --project-ref ilmvmqxmasgasrtokjmz
   npx supabase db push
   ~~~

   Use a new/empty Supabase project for the initial baseline. The SQL migration creates all current school tables, indexes, identity-backed IDs, updated_at triggers, RLS protections, profile metadata policies and baseline roles/settings. It does not copy the contents of an existing XAMPP database.
4. From **backend/**, run **npm install**, then **npm run create-admin** to create the first school administrator in the now-Supabase-backed application database.
5. Copy **frontend/.env.example** to **frontend/.env.local** and set **VITE_API_URL**, **VITE_SUPABASE_URL**, and **VITE_SUPABASE_PUBLISHABLE_KEY**. These frontend values must never include the database connection string, a service-role key or the platform JWT secret.
6. Start the API and frontend in separate terminals with **npm run dev**. The frontend runs on port 5173 and the API on port 5000 by default.


## Netlify full-stack deployment

The production Netlify configuration builds both packages and exposes the existing Express API through a same-origin Netlify Function at `/api/*`. The React frontend uses relative API paths in production; local development continues to default to `http://localhost:5000`.

Before deploying, configure these **production Function-scoped** variables in Netlify Project configuration → Environment variables:

- `SUPABASE_DB_URL`: the PostgreSQL connection URI copied from Supabase Dashboard → Connect. For serverless hosting, choose the **Transaction pooler** URI (port 6543). Store the real password only in Netlify; never commit it.
- `JWT_SECRET`: a private random secret of at least 32 characters.
- `SUPABASE_URL`: the existing project URL.
- `SUPABASE_PUBLISHABLE_KEY`: the browser-safe publishable key used for Supabase Auth verification.
- `FRONTEND_URL`: the deployed Netlify origin.
- `DB_POOL_SIZE`: `1` for serverless invocations.

Link the GitHub repository `cedrick-web/murama-school` to the Netlify site with `main` as its production branch so future commits build and publish automatically. After the first deploy, verify `/api/health` and `/api/health/database`, then test a real create/read/update through the authenticated school UI. The database schema contains no real school accounts until the backed-up XAMPP/MySQL database is imported, and the initial administrator must be created securely before admin operations can be tested.

## Existing MySQL/XAMPP data transfer

If the school already has records in MySQL, take a full backup of that database first. Apply the Supabase schema migration to the target project before importing records. Configure **MYSQL_URL**, or **MYSQL_HOST/MYSQL_PORT/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD**, in **backend/.env** for the old source database. Then, from **backend/**, run:

~~~powershell
npm run migrate:mysql-to-supabase
~~~

The default command is a **read-only preflight**: it checks source/target table presence, column compatibility and row counts without writing to Supabase. Review every result and resolve any schema mismatch before proceeding. Back up the source and destination, freeze source writes, then explicitly enable write mode only when ready:

~~~powershell
$env:MIGRATION_ALLOW_WRITES = "true"
npm run migrate:mysql-to-supabase -- --apply
Remove-Item Env:MIGRATION_ALLOW_WRITES
~~~

Apply mode upserts rows in foreign-key order, preserves primary keys, updates identity sequences, maps MySQL boolean fields to PostgreSQL booleans, and commits each table in its own transaction. It verifies source/destination row counts and stops with a reconciliation error if counts differ. A failed run can leave earlier tables committed, so resolve the reported issue and rerun against the still-authoritative source; the importer does not delete destination-only records. Do not direct production traffic until counts and samples from attendance, grades, report cards, fee balances and payment receipts have been accepted. Supabase Auth identities are not created by this script and must be configured and tested separately.

The original **database/xampp/murama_school_xampp.sql** and **database/schema.sql** are retained as legacy MySQL/XAMPP source definitions and data-migration references. They are no longer the application runtime database schema; the runtime baseline is in **supabase/migrations/**.

## Functional workflows

The admin APIs remain protected by authentication and the current ADMIN role check:
- Academic years, terms, classes, streams, subjects, users, roles, student roster and enrollment.
- Attendance registers with explicit unmarked states and transactional audit events.
- Assessments, score entry, score validation, normalized report-card averages, rank ties and attendance measures.
- Timetable CRUD and overlap checks for classes/streams and teachers.
- Fee structures, assignment to actively enrolled students, balance reconciliation and transactional receipt-backed payments.
- School messages, recipients, notification records and audit entries in a transaction.
- Public school settings and published all-audience announcements.
- Health checks at **/api/health** and **/api/health/database**.

No synthetic student records, fake grades, pretend balances or sample counts are seeded. Fresh projects receive only the baseline role and site-setting records needed to initialize school administration.

## Google sign-in and permissions

Follow [Supabase Google sign-in setup](docs/supabase-google-auth.md) to enable the provider and redirect URLs. Google sign-in is for existing, active school accounts only. A Supabase Auth identity does not automatically receive a school account or an administrator role; school permissions continue to come from the authoritative database role and active-account fields.

## Checks and current verification boundary

From **backend/**:

~~~powershell
npm install
npm run typecheck
npm test
~~~

From **frontend/**:

~~~powershell
npm install
npm run build
~~~

The SQL translation regression tests run without a live database. Build and unit tests do not replace an end-to-end pass against the school's own Supabase project, real imported records, provider configuration and user accounts. No Supabase project credentials are stored in this repository.

## Secure student, parent and teacher account invitations

The administrator workspace can create a one-time invitation for an existing **inactive** student, parent or teacher account. The school fixes the email and role; the invitee only chooses a password. Parent invitations also require an administrator-verified student relationship. Teacher invitations require an existing teacher profile linked to the account. Invitation tokens are stored as SHA-256 hashes, expire within 1–168 hours, can be revoked, and are accepted once.

Before using this workflow against Supabase:

1. Apply the migration `supabase/migrations/20261026162842_account_invitations.sql` to the target database using the project's reviewed Supabase migration workflow.
2. Ensure `FRONTEND_URL` is set to the canonical frontend origin (for example, the production Netlify URL). Invitation links use this origin.
3. In the admin workspace, open **Users**, select an eligible inactive student, parent or teacher account, and create the invitation. Parent invitations also require a linked student and relationship.
4. Copy the returned link and deliver it privately to the intended account holder. The raw token is not stored or shown again; issuing a replacement revokes older pending invitations for that account.
5. Test token expiry, single-use acceptance, revocation, wrong-role attempts, and parent-child isolation using dedicated test accounts before production rollout.

Email delivery is not configured yet, so administrators must share the generated link manually. The invitation API intentionally does not create school records or assign roles from user input. Create the student, parent or teacher record first using the school data/admin workflow, then invite its existing inactive account.

## Live data readiness

The Supabase schema can exist while school data is still empty. Before production use, confirm the correct source database, take a backup, run the migration/import process, reconcile table counts and relationships, create the first administrator securely, and test with authorized real school accounts. A successful frontend/backend build or Netlify preview is not proof that production school records have been imported.
