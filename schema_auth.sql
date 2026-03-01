-- ============================================================
--  SellerOS — Auth Migration
--  Run this AFTER schema.sql (only once)
--  Command: mysql -u root -p selleros < schema_auth.sql
-- ============================================================

USE selleros;

-- Add phone number & profile fields to users table
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone        VARCHAR(20)  DEFAULT NULL AFTER email,
    ADD COLUMN IF NOT EXISTS avatar_initials VARCHAR(4) DEFAULT NULL AFTER phone,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- ─────────────────────────────────────────────────────────────
--  PASSWORD RESET TOKENS
--  Stores OTP codes for forgot-password flow
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT         NOT NULL,
    token       VARCHAR(6)  NOT NULL,          -- 6-digit OTP
    identifier  VARCHAR(150) NOT NULL,         -- email or phone used to request
    expires_at  TIMESTAMP   NOT NULL,          -- valid for 15 minutes
    used        BOOLEAN     DEFAULT FALSE,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────
--  USER ACTIVITY LOG
--  Tracks login, register, password change, profile edits
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT         NOT NULL,
    action      VARCHAR(50) NOT NULL,   -- LOGIN, REGISTER, CHANGE_PASSWORD, EDIT_PROFILE, RESET_PASSWORD
    detail      TEXT,
    ip_address  VARCHAR(50),
    logged_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast OTP lookup
CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens(user_id, token);
CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity_log(user_id);

-- Update existing seed users with phone numbers
UPDATE users SET phone = '9876543210' WHERE username = 'arjun';
UPDATE users SET phone = '9876543211' WHERE username = 'preeti';
UPDATE users SET phone = '9876543212' WHERE username = 'rahul';
UPDATE users SET phone = '9876543213' WHERE username = 'neha';
UPDATE users SET phone = '9876543214' WHERE username = 'karan';
UPDATE users SET phone = '9876543215' WHERE username = 'sunita';
UPDATE users SET phone = '9876543216' WHERE username = 'amit';
UPDATE users SET phone = '9876543217' WHERE username = 'vijay';
