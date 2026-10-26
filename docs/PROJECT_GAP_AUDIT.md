# Murama Digital School: project gap audit

**Audit baseline:** `main` after security PRs #11 and #12  
**Purpose:** track verified implementation, remaining requirements, risks, and a safe build order.  
**Rule:** a route, table, mock screen, successful compile, or deploy preview is not proof of an end-to-end production workflow.

## Product goal

MURAMA DIGITAL SCHOOL is the bilingual (English/Kinyarwanda) digital platform for École Secondaire de Murama. It should combine the public school website, secure administration, academic management, parent/student/teacher self-service, communications, media, and finance while remaining portable across low-cost hosting and Supabase PostgreSQL.

## Verified existing foundation

- React + TypeScript + Vite frontend and Express + TypeScript API.
- Netlify configuration serves the SPA and API function on the same origin.
- Supabase PostgreSQL runtime and an explicit MySQL/XAMPP-to-Supabase importer.
- Public bilingual school homepage, school settings, published public announcements.
- School role types and active-account checks; admin routes require authenticated ADMIN role.
- Admin screens and API handlers for school users/roles/status, academics (years, terms, classes, streams, subjects), student records/enrollments, attendance, assessments/results, report-card generation, timetable, fees/payments, messages, settings, announcements and audit logs.
- Google sign-in verifies a Supabase Auth identity and matches it to an existing active school account.
- GitHub Actions validates frontend build, backend typecheck, backend tests and backend build.
- Password login rate limiting merged in PR #11; fresh database-backed role/account validation merged in PR #12.
- Schema includes students, parents, student-parent links, academic records, finance, messages, notifications, media metadata, and audit tables.

## Gaps and risks found during repository review

### P0 — security and operational correctness
- The rate limiter uses process-local memory; it is not shared across serverless invocations or multiple instances.
- Several dependencies in package manifests are declared as `latest`; clean-install reproducibility must be established before switching CI/Netlify to strict lockfile installs.
- Existing automated tests cover SQL compatibility, rate limiting and auth middleware, but not the full route/business-rule surface or live integration workflows.
- Account recovery, secure invitations/provisioning, and the full onboarding lifecycle need an end-to-end design and provider configuration.
- Production environment variables, live Google OAuth redirects, Supabase permissions/RLS, real database operations, monitoring and backup/restore need explicit verification against the deployed project.
- Admin route protection is present; tests must prove it remains present on every sensitive endpoint, including child-data access.

### P1 — parent/student self-service
- No dedicated student or parent portal route was found in the Express app or current frontend entry structure.
- Add server-authorized self-service for student identity/enrollment, published results/report cards, attendance, timetable, fees/payments/receipts, notifications and messages.
- Parent data must be derived only from the authenticated parent's `parents` record and `student_parents` links. A client-supplied student ID alone must never authorize access.
- Student data must be scoped from the authenticated user's linked `students.user_id`; do not accept a student ID from the browser as proof of ownership.
- Report results only when the school has generated/published the corresponding report card; do not leak unpublished grades.

### P2 — role-based school operations
- Implement dedicated teacher self-service and verify that teachers can only access assigned classes/subjects and authorized students.
- Complete secure account invitations, parent-child linking, password recovery, and activation/deactivation workflows without allowing self-assigned roles.
- Add lifecycle and edge-case tests for enrollment, assessment publication, term/year transitions, payment reconciliation, receipt integrity, and concurrent admin changes.
- Verify school-specific rules with real school stakeholders; never seed fake student, grade, attendance or finance records.

### P3 — media and communication
- Complete authenticated upload/review/publication for school photos/videos, with file size/type validation, safe object storage, private/public access rules, and cleanup of rejected/unreferenced uploads.
- Complete recipient permissions, read/unread state, notification delivery, and operational handling for failed message delivery.
- Verify bilingual text and accessible mobile behavior throughout admin and portal flows, not only the public homepage.

### P4 — data migration and integrity
- Back up the authoritative XAMPP database before migration.
- Run the importer in a write freeze and compare table-by-table row counts, foreign keys, identity sequences, enrollment, attendance, grades, report cards, fee balances and receipts.
- Treat Supabase Auth identities/passwords as a separate migration/provisioning workflow; the legacy data importer does not migrate those credentials.
- Document and test a backup/restore and rollback procedure before production cutover.

### P5 — quality and user experience
- Add API route tests, permission-boundary tests, component/form tests, and browser end-to-end smoke tests.
- Test loading, empty, validation, permission-denied, network-failure and retry states.
- Audit accessibility, keyboard navigation, focus management, color contrast, responsive layouts, and English/Kinyarwanda completeness.
- Add pagination/search where records grow; do not return unbounded student, audit, message or transaction collections.
- Add observability for request failures, database outages, authentication failures and key business operations without logging secrets or sensitive student data.

## Implementation order

1. **Student/parent API foundation:** secure self-scoped endpoints for linked students, published results, attendance, timetable, fees, notifications and messages. Add permission-focused tests.
2. **Student/parent frontend:** routed, responsive, bilingual portal experiences consuming only these APIs.
3. **Secure account provisioning:** invitation lifecycle, parent-child relationship verification, recovery, expiry and revocation.
4. **Teacher portal and teacher-scoped authorization.**
5. **Media storage/upload/publication and complete messaging/notifications.**
6. **Dependency pinning and reproducible install pipeline** once lockfiles can be regenerated and verified with the actual package manager.
7. **Comprehensive regression/E2E tests and operational hardening.**
8. **Live migration reconciliation, deployment smoke tests, backup/restore drill and production acceptance.**

## Acceptance criteria

- No synthetic student, grade, attendance or financial data in production.
- All sensitive APIs derive access from the authenticated user and database relationships.
- Parent cannot access an unlinked student's records by guessing an ID.
- Student cannot access another student's records by changing a URL or request parameter.
- Unpublished assessment/report data is not exposed.
- Changes pass clean dependency installation, frontend build, backend typecheck, tests and backend build.
- Netlify preview succeeds; live health checks and authenticated real-data smoke tests are recorded separately.
- Each feature has explicit loading, empty, error, permission and success states.
- Changes are implemented on a feature branch, reviewed and tested before merging to `main`.

## Live Supabase snapshot (2026-10-26)\n\nThe connected project reports 36 public tables and migration history through the initial school schema, security hardening and locale defaults. The `roles` table has 6 rows and `school_settings` has 5; the `users`, `students`, academic, attendance, assessment, report-card and finance tables currently report 0 rows. The invitation migration is a repository change and has not yet been applied to the live database. Treat data migration, initial administrator setup and real-account testing as production blockers.\n\n## Verification boundary

This is a repository-based code review, not a live audit of the school's Supabase data, OAuth provider configuration, production secrets, or actual school records. Those checks require the configured environments and authorized test accounts. Any item not tested against those systems must remain marked unverified.
