-- 0017_license_features.sql
-- Add features_json column to store features from the signed token directly
ALTER TABLE license_state ADD COLUMN features_json TEXT;
