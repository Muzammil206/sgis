-- =============================================================================
-- SGIS — 005_postgis_geometry.sql
-- Makes UTM coordinates optional on DB1 and DB2.
-- Adds PostGIS geometry (POINT) columns to both tables.
-- Geometry is auto-computed from UTM coordinates when provided.
-- Run after: 004_decouple_lodgments.sql
-- =============================================================================

-- =============================================================================
-- PART 1: Make UTM / coordinate fields optional in surveyor_lodgments (DB2)
-- These were NOT NULL — some plans do not have UTM coordinates
-- =============================================================================

ALTER TABLE surveyor_lodgments
  ALTER COLUMN coordinate_system DROP NOT NULL,
  ALTER COLUMN utm_northing       DROP NOT NULL,
  ALTER COLUMN utm_easting        DROP NOT NULL;

-- =============================================================================
-- PART 2: Add PostGIS POINT geometry columns
-- SRID 26331 = UTM Zone 31N (Minna Datum) — standard for Nigeria
-- Both columns are nullable — only populated when UTM data is provided
-- =============================================================================

-- DB1 — Pillar Applications (estimated location from application stage)
ALTER TABLE pillar_applications
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(POINT, 26331);

-- DB2 — Surveyor Lodgments (actual surveyed location — more accurate)
ALTER TABLE surveyor_lodgments
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(POINT, 26331);

-- Spatial indexes for both tables
CREATE INDEX IF NOT EXISTS idx_pa_geom  ON pillar_applications  USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_sl_geom  ON surveyor_lodgments   USING GIST (geom);

-- =============================================================================
-- PART 3: Function to build geometry from UTM northing/easting strings
-- Strips trailing units (mN, mE, m) and casts to numeric before creating point.
-- Returns NULL if either value is NULL or cannot be parsed.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_utm_to_geom(p_easting TEXT, p_northing TEXT)
RETURNS GEOMETRY(POINT, 26331) AS $$
DECLARE
  v_easting  NUMERIC;
  v_northing NUMERIC;
BEGIN
  IF p_easting IS NULL OR p_northing IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip any trailing units (mE, mN, m) and whitespace
  BEGIN
    v_easting  := CAST(REGEXP_REPLACE(TRIM(p_easting),  '(?i)[a-z\s]+$', '') AS NUMERIC);
    v_northing := CAST(REGEXP_REPLACE(TRIM(p_northing), '(?i)[a-z\s]+$', '') AS NUMERIC);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;  -- Unparseable — return NULL silently
  END;

  RETURN ST_SetSRID(ST_MakePoint(v_easting, v_northing), 26331);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_utm_to_geom IS
  'Converts UTM easting/northing text strings to a PostGIS POINT (SRID 26331 = UTM Zone 31N / Minna Datum). Strips trailing unit labels. Returns NULL if either value is missing or unparseable.';

-- =============================================================================
-- PART 4: Triggers — auto-update geom when UTM fields change
-- =============================================================================

-- DB1 trigger function
CREATE OR REPLACE FUNCTION fn_update_pa_geom()
RETURNS TRIGGER AS $$
BEGIN
  -- DB1 does not have UTM fields — geometry cannot be computed here.
  -- Reserved for future use if UTM is ever added to DB1.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DB2 trigger function — runs on INSERT and UPDATE
CREATE OR REPLACE FUNCTION fn_update_sl_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := fn_utm_to_geom(NEW.utm_easting, NEW.utm_northing);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sl_geom
  BEFORE INSERT OR UPDATE OF utm_easting, utm_northing
  ON surveyor_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_update_sl_geom();

-- =============================================================================
-- PART 5: Backfill geometry for existing DB2 records that have UTM data
-- =============================================================================

UPDATE surveyor_lodgments
SET geom = fn_utm_to_geom(utm_easting, utm_northing)
WHERE utm_easting IS NOT NULL
  AND utm_northing IS NOT NULL
  AND geom IS NULL;

-- Report
DO $$
DECLARE
  v_total   INT;
  v_with_geom INT;
BEGIN
  SELECT COUNT(*) INTO v_total       FROM surveyor_lodgments;
  SELECT COUNT(*) INTO v_with_geom   FROM surveyor_lodgments WHERE geom IS NOT NULL;
  RAISE NOTICE 'Backfill complete — % of % surveyor_lodgments have geometry', v_with_geom, v_total;
END;
$$;

-- =============================================================================
-- MIGRATION COMPLETE
-- Changes:
--   surveyor_lodgments.coordinate_system — now nullable
--   surveyor_lodgments.utm_northing      — now nullable
--   surveyor_lodgments.utm_easting       — now nullable
--   pillar_applications.geom             — new GEOMETRY(POINT, 26331) nullable
--   surveyor_lodgments.geom              — new GEOMETRY(POINT, 26331) nullable
--   fn_utm_to_geom()                     — text → geometry converter
--   fn_update_sl_geom() + trigger        — auto-updates geom on DB2 insert/update
-- =============================================================================
