-- F14 (2026-07-23 tenant-service audit): logoUrl was a stored URL despite the storage
-- bucket being private (no public-read policy) -- nothing could ever have rendered it
-- correctly as-is, and there was also no API path to ever set it. Renamed to
-- logo_object_key: an S3 object key, resolved to a signed URL on read (GET /organization),
-- matching the same pattern documentAttachments/getDownloadUrl already use everywhere else
-- in this codebase.
ALTER TABLE "organization_settings" RENAME COLUMN "logo_url" TO "logo_object_key";
