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


## XAMPP complete import

For a fresh XAMPP/MySQL setup, the complete import file is:

`database/xampp/murama_school_xampp.sql`

### Import with phpMyAdmin

1. Start **MySQL** in XAMPP.
2. Open `http://localhost/phpmyadmin`.
3. Open the **Import** tab.
4. Select `database/xampp/murama_school_xampp.sql`.
5. Click **Import**.
6. Confirm that the `murama_school` database contains the tables.

The extended schema includes the foundation plus users/roles, teachers, students, parents, enrollments, subjects, assessments, results, grades, report cards, attendance, timetable, fees, invoices, payments, messages, notifications, audit logs, news, events, announcements, and gallery storage metadata.

The SQL file does **not** contain real admin passwords. Authentication accounts will be created by the backend so passwords are hashed and never committed to GitHub.

### Important

XAMPP is providing MySQL/MariaDB and phpMyAdmin. The Murama School application itself remains a Node.js/Express backend and React frontend. Do not copy the Node.js project into XAMPP's `htdocs` folder.
