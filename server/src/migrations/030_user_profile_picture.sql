ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(100) DEFAULT 'fine';
UPDATE users SET profile_picture = 'fine' WHERE profile_picture IS NULL;
