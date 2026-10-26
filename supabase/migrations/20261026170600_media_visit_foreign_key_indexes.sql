BEGIN;

CREATE INDEX IF NOT EXISTS idx_school_media_items_uploaded_by
  ON public.school_media_items (uploaded_by)
  WHERE uploaded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_school_visit_requests_handled_by
  ON public.school_visit_requests (handled_by)
  WHERE handled_by IS NOT NULL;

COMMIT;
