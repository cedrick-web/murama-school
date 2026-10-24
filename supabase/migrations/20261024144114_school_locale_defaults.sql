-- School defaults matching the existing XAMPP source configuration.
INSERT INTO public.school_settings (setting_key, setting_value)
VALUES
  ('timezone', 'Africa/Kigali'),
  ('currency', 'RWF')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value;
