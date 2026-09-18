# Murama School Database

The application uses MySQL as its relational database.

## Initial local setup

1. Make sure MySQL is running.
2. Create the local environment file from `backend/.env.example`:
   `backend/.env`
3. Run `database/schema.sql` using MySQL or phpMyAdmin.
4. Verify that the `murama_school` database and initial tables were created.
5. Start the backend and open:
   `http://localhost:5000/api/health/database`

A successful connection returns HTTP 200 with `"status": "connected"`.

## Initial schema

The first schema establishes:

- users and roles
- school settings
- academic years and terms
- classes and streams
- subjects
- news
- events
- announcements
- gallery images/videos

The schema is deliberately limited to foundational entities. Academic marks, attendance, timetables, fees, parent/student relationships, and other workflows will be introduced in later verified stages.

## Security

- Never commit `backend/.env`.
- Never commit real passwords, JWT secrets, or production credentials.
- Never store uploaded media files inside Git.
- Use migrations for future schema changes rather than editing production tables manually.
