-- 0018_reset_unverified_known_hosts.sql
-- One-time reset for VULN-01 (legacy auto-trusted fingerprints).
-- The DELETE ran once during the original release - do not re-run on every startup.
SELECT 1;
