# Ecole Secondaire de Murama Digital School Platform

A bilingual (Kinyarwanda / English) school website and management platform for Ecole Secondaire de Murama.

## Project structure

- `frontend/` - React + TypeScript web application
- `backend/` - Node.js + Express API
- `database/` - MySQL schema and database documentation
- `docs/` - architecture and project documentation

## Development rule

Build in small verified stages:

1. Build
2. Run
3. Test
4. Fix
5. Commit
6. Push
7. Continue

The frontend, backend, database, and media storage are designed to remain replaceable so the application can move between hosting providers without a rewrite.

## Current stage

**Stage 6 - Academic setup, student roster, and public CMS integration**

The project has a MySQL schema and connection health check, JWT login, role-protected admin APIs, and an admin workspace at `/admin` for user roles and account status, school settings, announcements, recent audit activity, academic setup (years, terms, classes, streams, and subjects), student records, and enrollment. New student portal access remains disabled until secure invitations are configured. The bilingual public homepage now displays published all-audience announcements and school contact settings from the CMS. Parent/teacher portals, attendance, grading, and production hosting remain future work.

## Local development

1. Start MySQL in XAMPP. For a fresh local database, import
   `database/xampp/murama_school_xampp.sql` using phpMyAdmin or the MySQL CLI.
2. Copy `backend/.env.example` to `backend/.env` and set a private
   `JWT_SECRET` (at least 32 characters) and the local database connection.
   Keep this file local; never send its values in chat or commit them.
3. Install and start the backend in one terminal:

   ```powershell
   cd backend
   npm ci
   npm run dev
   ```

4. Install and start the frontend in a second terminal:

   ```powershell
   cd frontend
   npm ci
   npm run dev
   ```

5. Create the first administrator in the backend terminal with
   `npm run create-admin`. Enter the admin password directly into that local
   terminal prompt; do not share it in chat.

The public site runs at `http://localhost:5173/`, the admin workspace at
`http://localhost:5173/admin`, and the backend health check at
`http://localhost:5000/api/health/database`.









## School operations API and modules

The administrator workspace now includes live operational screens backed by Express/MySQL:
- **Attendance:** daily class register by class, term and date. Only selected statuses are saved; missing attendance remains unmarked.
- **Gradebook:** assessment creation, score entry, validation against each assessment's maximum score, and report-card generation from recorded assessment results and attendance.
- **Timetable:** class, stream, subject, teacher, room, day and period management with overlap-conflict checks.
- **Fees:** fee structures, assigning balances to active students, outstanding-balance views and receipt-backed payments allocated against assigned fee items.
- **Messaging:** send messages to active users or a role audience. Message, recipients, notifications and audit entry are recorded transactionally.

These endpoints are mounted under `/api/admin/operations` and remain behind the existing administrator authentication/role middleware. The primary SQL schema now includes the operational tables already defined in the XAMPP schema. Fresh databases should apply `database/schema.sql`; XAMPP-based local setups may continue importing `database/xampp/murama_school_xampp.sql`.

No live data is seeded automatically. Empty tables produce empty states; the school must enter real academic terms, students, assessments, fee structures and other records before operational totals or workflows can be used. Build checks do not replace end-to-end tests against a configured MySQL database.

## Public school website

The public homepage is built around the live public API contracts:
- School name, address, email and phone from `GET /api/public/school`
- Published all-audience announcements from `GET /api/public/announcements`
- English/Kinyarwanda switching, accessible navigation, responsive layouts, retry states, and direct email/phone links when the school has published those details
- A direct link to the protected administration portal

The previous future-feature tiles and copy about unimplemented school modules have been removed. The site does not fabricate school statistics, gallery entries, attendance, grades or events. Any additional public modules need real backend endpoints and school data before they should be shown as operational.

## Modern administration workspace

The administrator interface uses a responsive navigation shell and a live operations dashboard. The overview fetches student records, enrollment, user accounts, academic years/classes, announcements, audit activity, and MySQL health from existing API endpoints. If an endpoint is unavailable, that metric is shown as unavailable instead of substituting sample data.

The existing functional modules remain API-backed:
- Student register and enrollment
- Academic years, terms, classes, streams and subjects
- Account roles and access status
- School settings
- Announcements
- Audit activity

The user account table supports live text search and role/status filtering. The responsive sidebar adapts to smaller screens. No attendance, grading, fee collection, parent portal or report-card UI is presented as operational because those workflows do not yet have complete backend APIs in this repository.

## Supabase Google sign-in

A separate feature branch adds Google sign-in through Supabase Auth while retaining MySQL as the source of truth for school accounts, roles, and access permissions. The existing email/password login remains available.

Read **[Supabase Google sign-in setup](docs/supabase-google-auth.md)** before enabling it. Google sign-in requires a Supabase project, Google OAuth provider configuration, redirect allow-list entries, and local environment variables. It does not automatically provision school accounts or grant administrator access.

## Planned stages

1. Foundation
2. Public website
3. Database foundation
4. Authentication and RBAC
5. Admin CMS
6. Academic management
7. Parent and student portals
8. Timetable and attendance
9. Communication and notifications
10. Finance and reporting
11. Production deployment, security, testing, and backups
