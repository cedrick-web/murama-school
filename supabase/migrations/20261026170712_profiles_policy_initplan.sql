BEGIN;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) IS FALSE
  );

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) IS FALSE
  );

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) IS FALSE
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) IS FALSE
  );

COMMIT;
