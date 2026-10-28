BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE email IS NOT NULL
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate school user emails differ only by letter case; resolve them before applying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_case_insensitive
  ON public.users (LOWER(email))
  WHERE email IS NOT NULL;

COMMIT;
