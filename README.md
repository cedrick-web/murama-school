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
