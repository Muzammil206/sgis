-- =============================================================================
-- SGIS — 007_gis_extended.sql
-- Extends GIS/PostGIS support across all 3 databases.
-- Adds optional coordinate fields to DB1 and DB3.
-- Adds coordinate_system_type enum for multi-CRS support.
-- Run after: 006_client_workflow.sql
-- =============================================================================

-- =============================================================================
-- PART 1: Coordinate system type enum
-- =============================================================================

CREATE TYPE coordinate_system_enum AS ENUM (
  'utm_minna_zone31',   -- UTM Zone 31N / Minna Datum (SRID 26331) — most of Kwara
  'utm_minna_zone32',   -- UTM Zone 32N / Minna Datum (SRID 26332) — far east Nigeria
  'wgs84',              -- WGS84 Geographic (GPS/Google Maps lat/lng)
  'township_local',     -- Local township/state grid — store text only, no geometry
  'unknown'             -- Old records — coordinate system not recorded
);

-- =============================================================================
-- PART 2: Add coordinate fields to DB1 (pillar_applications)
-- These are ESTIMATED coordinates at application stage — before fieldwork.
-- All optional — many old applications have no coordinates.
-- =============================================================================

ALTER TABLE pillar_applications
  ADD COLUMN IF NOT EXISTS coordinate_system    coordinate_system_enum,
  ADD COLUMN IF NOT EXISTS utm_northing         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS utm_easting          VARCHAR(30),
  ADD COLUMN IF NOT EXISTS township_northing    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS township_easting     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS wgs84_lat            NUMERIC(10,7),  -- WGS84 latitude
  ADD COLUMN IF NOT EXISTS wgs84_lng            NUMERIC(10,7);  -- WGS84 longitude
  -- geom column already added in 005_postgis_geometry.sql

-- =============================================================================
-- PART 3: Add WGS84 fields to DB2 (surveyor_lodgments)
-- DB2 already has utm_northing/easting from schema.
-- Adding WGS84 and coordinate_system_type for proper multi-CRS support.
-- =============================================================================

ALTER TABLE surveyor_lodgments
  ADD COLUMN IF NOT EXISTS coordinate_system_type  coordinate_system_enum,
  ADD COLUMN IF NOT EXISTS wgs84_lat               NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS wgs84_lng               NUMERIC(10,7);

-- =============================================================================
-- PART 4: Add coordinate fields to DB3 (client_lodgments)
-- DB3 already has utm_northing/easting for charting data.
-- Adding geometry and WGS84.
-- =============================================================================

ALTER TABLE client_lodgments
  ADD COLUMN IF NOT EXISTS coordinate_system_type  coordinate_system_enum,
  ADD COLUMN IF NOT EXISTS wgs84_lat               NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS wgs84_lng               NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS geom                    GEOMETRY(POINT, 4326);
  -- DB3 stores in WGS84 (4326) since charting often uses GPS

CREATE INDEX IF NOT EXISTS idx_cl_geom ON client_lodgments USING GIST (geom);

-- =============================================================================
-- PART 5: Extended geometry function — handles WGS84 and UTM input
-- Returns POINT in SRID 4326 (WGS84) for consistent map display.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_coords_to_wgs84(
  p_coord_system  coordinate_system_enum,
  p_utm_easting   TEXT    DEFAULT NULL,
  p_utm_northing  TEXT    DEFAULT NULL,
  p_wgs84_lng     NUMERIC DEFAULT NULL,
  p_wgs84_lat     NUMERIC DEFAULT NULL
)
RETURNS GEOMETRY(POINT, 4326) AS $$
DECLARE
  v_easting   NUMERIC;
  v_northing  NUMERIC;
  v_srid      INTEGER;
  v_utm_geom  GEOMETRY;
BEGIN
  -- WGS84 input — direct point creation
  IF p_coord_system = 'wgs84' AND p_wgs84_lat IS NOT NULL AND p_wgs84_lng IS NOT NULL THEN
    RETURN ST_SetSRID(ST_MakePoint(p_wgs84_lng, p_wgs84_lat), 4326);
  END IF;

  -- UTM input — parse, create UTM point, reproject to WGS84
  IF p_coord_system IN ('utm_minna_zone31', 'utm_minna_zone32')
     AND p_utm_easting IS NOT NULL AND p_utm_northing IS NOT NULL THEN

    BEGIN
      v_easting  := CAST(REGEXP_REPLACE(TRIM(p_utm_easting),  '(?i)[a-z\s]+$', '') AS NUMERIC);
      v_northing := CAST(REGEXP_REPLACE(TRIM(p_utm_northing), '(?i)[a-z\s]+$', '') AS NUMERIC);
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;

    v_srid := CASE p_coord_system
      WHEN 'utm_minna_zone31' THEN 26331
      WHEN 'utm_minna_zone32' THEN 26332
      ELSE 26331
    END;

    v_utm_geom := ST_SetSRID(ST_MakePoint(v_easting, v_northing), v_srid);

    -- Reproject to WGS84 for universal map display
    RETURN ST_Transform(v_utm_geom, 4326);
  END IF;

  -- township_local or unknown — no geometry possible
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_coords_to_wgs84 IS
  'Converts any supported coordinate input to WGS84 POINT (SRID 4326) for map display.
   Handles UTM Zone 31/32 Minna and WGS84 GPS. Township/local grid returns NULL.';

-- =============================================================================
-- PART 6: Update DB1 trigger — compute geom from coordinates
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_pa_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := fn_coords_to_wgs84(
    NEW.coordinate_system,
    NEW.utm_easting,
    NEW.utm_northing,
    NEW.wgs84_lng,
    NEW.wgs84_lat
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if exists, recreate properly
DROP TRIGGER IF EXISTS trg_pa_geom ON pillar_applications;
CREATE TRIGGER trg_pa_geom
  BEFORE INSERT OR UPDATE OF utm_easting, utm_northing, wgs84_lat, wgs84_lng, coordinate_system
  ON pillar_applications
  FOR EACH ROW EXECUTE FUNCTION fn_update_pa_geom();

-- =============================================================================
-- PART 7: Update DB2 trigger — reproject using new function
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_sl_geom()
RETURNS TRIGGER AS $$
BEGIN
  -- Change DB2 geom to also store in WGS84 (4326) for consistency
  NEW.geom := fn_coords_to_wgs84(
    NEW.coordinate_system_type,
    NEW.utm_easting,
    NEW.utm_northing,
    NEW.wgs84_lng,
    NEW.wgs84_lat
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sl_geom ON surveyor_lodgments;
CREATE TRIGGER trg_sl_geom
  BEFORE INSERT OR UPDATE OF utm_easting, utm_northing, wgs84_lat, wgs84_lng, coordinate_system_type
  ON surveyor_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_update_sl_geom();

-- Also change DB2 geom SRID to 4326 for consistency
ALTER TABLE surveyor_lodgments ALTER COLUMN geom TYPE GEOMETRY(POINT, 4326)
  USING CASE WHEN geom IS NOT NULL THEN ST_Transform(geom, 4326) ELSE NULL END;

-- =============================================================================
-- PART 8: DB3 trigger — compute geom from charting coordinates
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_cl_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := fn_coords_to_wgs84(
    NEW.coordinate_system_type,
    NEW.utm_easting,
    NEW.utm_northing,
    NEW.wgs84_lng,
    NEW.wgs84_lat
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cl_geom
  BEFORE INSERT OR UPDATE OF utm_easting, utm_northing, wgs84_lat, wgs84_lng, coordinate_system_type
  ON client_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_update_cl_geom();

-- =============================================================================
-- PART 9: GIS view — all plan coordinates in one place for map display
-- =============================================================================

CREATE OR REPLACE VIEW v_plan_coordinates AS
SELECT
  pa.plan_number,
  pa.lga,
  pa.location,
  pa.land_use_type,
  pa.status                           AS application_status,
  s.name                              AS surveyor_name,

  -- DB1 estimated point
  pa.coordinate_system                AS db1_coord_system,
  pa.utm_northing                     AS db1_utm_northing,
  pa.utm_easting                      AS db1_utm_easting,
  pa.wgs84_lat                        AS db1_lat,
  pa.wgs84_lng                        AS db1_lng,
  ST_Y(pa.geom::geometry)            AS db1_geom_lat,
  ST_X(pa.geom::geometry)            AS db1_geom_lng,

  -- DB2 actual surveyed point
  sl.coordinate_system_type           AS db2_coord_system,
  sl.utm_northing                     AS db2_utm_northing,
  sl.utm_easting                      AS db2_utm_easting,
  sl.wgs84_lat                        AS db2_lat,
  sl.wgs84_lng                        AS db2_lng,
  ST_Y(sl.geom::geometry)            AS db2_geom_lat,
  ST_X(sl.geom::geometry)            AS db2_geom_lng,
  sl.actual_area_sqm,
  sl.scale,

  -- DB3 charting point
  cl.coordinate_system_type           AS db3_coord_system,
  cl.utm_northing                     AS db3_utm_northing,
  cl.utm_easting                      AS db3_utm_easting,
  cl.wgs84_lat                        AS db3_lat,
  cl.wgs84_lng                        AS db3_lng,
  ST_Y(cl.geom::geometry)            AS db3_geom_lat,
  ST_X(cl.geom::geometry)            AS db3_geom_lng,
  cl.beacon_no,
  cl.size_sqm,

  -- Distance between DB1 estimate and DB2 actual (metres) — drift indicator
  CASE
    WHEN pa.geom IS NOT NULL AND sl.geom IS NOT NULL
    THEN ROUND(ST_Distance(
      ST_Transform(pa.geom::geometry, 26331),
      ST_Transform(sl.geom::geometry, 26331)
    )::numeric, 1)
    ELSE NULL
  END                                 AS db1_db2_distance_m,

  -- GeoJSON for frontend map rendering
  CASE WHEN pa.geom IS NOT NULL
    THEN ST_AsGeoJSON(pa.geom::geometry)::jsonb
    ELSE NULL
  END                                 AS db1_geojson,
  CASE WHEN sl.geom IS NOT NULL
    THEN ST_AsGeoJSON(sl.geom::geometry)::jsonb
    ELSE NULL
  END                                 AS db2_geojson,
  CASE WHEN cl.geom IS NOT NULL
    THEN ST_AsGeoJSON(cl.geom::geometry)::jsonb
    ELSE NULL
  END                                 AS db3_geojson

FROM pillar_applications      pa
JOIN surveyors                s   ON s.id  = pa.surveyor_id
LEFT JOIN surveyor_lodgments  sl  ON sl.plan_number = pa.plan_number
LEFT JOIN client_lodgments    cl  ON cl.plan_number = pa.plan_number;

COMMENT ON VIEW v_plan_coordinates IS
  'All coordinate data for every plan across DB1/DB2/DB3. Includes GeoJSON for frontend maps and distance between estimated and actual points.';

-- =============================================================================
-- PART 10: Backfill geom on DB2 records that already have UTM data
-- Uses utm_minna_zone31 as default for existing records
-- =============================================================================

UPDATE surveyor_lodgments
SET
  coordinate_system_type = 'utm_minna_zone31'::coordinate_system_enum,
  geom = fn_coords_to_wgs84(
    'utm_minna_zone31'::coordinate_system_enum,
    utm_easting, utm_northing, NULL, NULL
  )
WHERE utm_easting IS NOT NULL
  AND utm_northing IS NOT NULL
  AND geom IS NULL
  AND coordinate_system_type IS NULL;

DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM surveyor_lodgments WHERE geom IS NOT NULL;
  RAISE NOTICE 'GIS backfill complete — % DB2 records now have geometry', v_count;
END;
$$;

-- =============================================================================
-- MIGRATION COMPLETE
-- New type    : coordinate_system_enum
-- DB1 additions: coordinate_system, utm_northing/easting, township_northing/easting,
--                wgs84_lat/lng — all optional
-- DB2 additions: coordinate_system_type, wgs84_lat/lng
-- DB3 additions: coordinate_system_type, wgs84_lat/lng, geom
-- New function : fn_coords_to_wgs84 — multi-CRS converter
-- Updated triggers on all 3 tables
-- New view    : v_plan_coordinates — all coords + GeoJSON + drift distance
-- =============================================================================
