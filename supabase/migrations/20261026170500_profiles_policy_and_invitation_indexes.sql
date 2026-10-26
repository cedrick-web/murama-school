BEGIN;

-- The profiles table is only for optional Google identity display metadata.
-- An anonymous Supabase Auth session must not create or modify profile rows.
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND COALESCE((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) IS FALSE
  );

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    AND COALESCE((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) IS FALSE
  );

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    AND COALESCE((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) IS FALSE
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND COALESCE((SELECT (auth.jwt() ->> 'is_anonymous')::boolean), false) IS FALSE
  );

-- These foreign keys are used by administrator invitation and student-link workflows.
CREATE INDEX IF NOT EXISTS idx_account_invitations_invited_by
  ON public.account_invitations (invited_by);

CREATE INDEX IF NOT EXISTS idx_account_invitations_linked_student_id
  ON public.account_invitations (linked_student_id)
  WHERE linked_student_id IS NOT NULL;

COMMIT;
