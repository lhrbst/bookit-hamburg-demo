-- 0001_enable_btree_gist.sql
--
-- Enables the btree_gist extension, required for the booking exclusion
-- constraint (`EXCLUDE USING GIST (resource_id WITH =, during WITH &&)`)
-- introduced by a later migration (ADR-003). Mixing an equality operator
-- into a GiST index needs btree_gist; without it, that constraint cannot
-- be created.
--
-- The resource/person/booking tables themselves were out of scope for this
-- scaffolding ticket (FS-01 #16) and are added by 0002_create_schema.sql.

CREATE EXTENSION IF NOT EXISTS btree_gist;

