ALTER TABLE users ADD COLUMN IF NOT EXISTS eq_settings JSONB DEFAULT '{"enabled":false,"preset":"flat","gains":[0,0,0,0,0,0,0,0,0,0],"targetDb":0}'::jsonb;
UPDATE users SET eq_settings = '{"enabled":false,"preset":"flat","gains":[0,0,0,0,0,0,0,0,0,0],"targetDb":0}'::jsonb WHERE eq_settings IS NULL;
