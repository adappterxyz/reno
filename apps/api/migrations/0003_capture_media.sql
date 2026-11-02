-- Persist the phone-captured media (R2 keys) on the splat model so a failed/
-- abandoned build can be resumed without re-capturing.
ALTER TABLE splat_models ADD COLUMN capture_media TEXT;  -- JSON array of R2 keys
ALTER TABLE splat_models ADD COLUMN capture_kind TEXT;   -- 'video' | 'photos'
