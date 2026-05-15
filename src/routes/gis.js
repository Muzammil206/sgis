// src/routes/gis.js
// GIS endpoints — coordinates and map data
//
// GET /api/gis/:planNumber          Full coordinate data for one plan (all 3 DBs)
// GET /api/gis/bbox                 All plans with geometry within a bounding box
// GET /api/gis/lga/:lga             All plans in an LGA with geometry
// GET /api/gis/export/:planNumber   GeoJSON export for a plan

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/gis/:planNumber
// Returns all coordinate data + GeoJSON for map rendering.
// Used by the plan detail map component.
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    const { rows } = await pool.query(
      'SELECT * FROM v_plan_coordinates WHERE plan_number = $1',
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No coordinate data for plan ${planNumber}` });
    }

    const row = rows[0];

    // Build a clean response with map-ready data
    const features = [];

    if (row.db1_geojson) {
      features.push({
        type: 'Feature',
        properties: {
          db: 'DB1',
          label: 'Estimated Location (Application)',
          plan_number: planNumber,
          coord_system: row.db1_coord_system,
          color: '#D97706',  // amber
          icon: 'estimated',
        },
        geometry: row.db1_geojson,
      });
    }

    if (row.db2_geojson) {
      features.push({
        type: 'Feature',
        properties: {
          db: 'DB2',
          label: 'Actual Survey Location',
          plan_number: planNumber,
          coord_system: row.db2_coord_system,
          area_sqm: row.actual_area_sqm,
          scale: row.scale,
          color: '#059669',  // green
          icon: 'surveyed',
        },
        geometry: row.db2_geojson,
      });
    }

    if (row.db3_geojson) {
      features.push({
        type: 'Feature',
        properties: {
          db: 'DB3',
          label: 'Charting Location',
          plan_number: planNumber,
          coord_system: row.db3_coord_system,
          beacon_no: row.beacon_no,
          size_sqm: row.size_sqm,
          color: '#2563EB',  // blue
          icon: 'charted',
        },
        geometry: row.db3_geojson,
      });
    }

    res.json({
      plan_number:        planNumber,
      location:           row.location,
      lga:                row.lga,
      has_geometry:       features.length > 0,
      db1_db2_drift_m:    row.db1_db2_distance_m,   // drift between estimated and actual
      geojson: {
        type:     'FeatureCollection',
        features,
      },
      // Raw coordinate data for the coordinate display table
      coordinates: {
        db1: row.db1_geom_lat ? { lat: row.db1_geom_lat, lng: row.db1_geom_lng, system: row.db1_coord_system, northing: row.db1_utm_northing, easting: row.db1_utm_easting } : null,
        db2: row.db2_geom_lat ? { lat: row.db2_geom_lat, lng: row.db2_geom_lng, system: row.db2_coord_system, northing: row.db2_utm_northing, easting: row.db2_utm_easting } : null,
        db3: row.db3_geom_lat ? { lat: row.db3_geom_lat, lng: row.db3_geom_lng, system: row.db3_coord_system, northing: row.db3_utm_northing, easting: row.db3_utm_easting } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/gis/export/:planNumber
// Returns a clean GeoJSON FeatureCollection for download/external use.
// ---------------------------------------------------------------------------
router.get('/export/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    const { rows } = await pool.query(
      `SELECT
         pa.plan_number, pa.location, pa.lga, pa.land_use_type, pa.status,
         s.name AS surveyor_name, s.surveyor_reg AS surveyor_reg,
         sl.owner_name, sl.actual_area_sqm, sl.scale,
         cl.beacon_no, cl.size_sqm,
         pa.geom  AS db1_geom,
         sl.geom  AS db2_geom,
         cl.geom  AS db3_geom
       FROM pillar_applications pa
       JOIN surveyors s ON s.id = pa.surveyor_id
       LEFT JOIN surveyor_lodgments sl ON sl.plan_number = pa.plan_number
       LEFT JOIN client_lodgments   cl ON cl.plan_number = pa.plan_number
       WHERE pa.plan_number = $1`,
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `Plan ${planNumber} not found` });
    }

    const row      = rows[0];
    const features = [];
    const baseProps = {
      plan_number:   row.plan_number,
      location:      row.location,
      lga:           row.lga,
      land_use_type: row.land_use_type,
      status:        row.status,
      surveyor:      row.surveyor_name,
      surveyor_reg:  row.surveyor_reg,
      owner:         row.owner_name,
      area_sqm:      row.actual_area_sqm,
    };

    const addFeature = (geomJson, extra) => {
      if (geomJson) {
        features.push({ type: 'Feature', properties: { ...baseProps, ...extra }, geometry: geomJson });
      }
    };

    addFeature(row.db1_geom, { source: 'DB1_APPLICATION', label: 'Estimated location' });
    addFeature(row.db2_geom, { source: 'DB2_LODGMENT',    label: 'Actual survey location', scale: row.scale });
    addFeature(row.db3_geom, { source: 'DB3_CHARTING',    label: 'Charting location', beacon_no: row.beacon_no });

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Content-Disposition', `attachment; filename="SGIS_${planNumber.replace(/\//g, '-')}.geojson"`);
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/gis/lga/:lga
// All plans in an LGA that have geometry — for LGA-level map view.
// ---------------------------------------------------------------------------
router.get('/lga/:lga', requireAuth, async (req, res, next) => {
  try {
    const { lga } = req.params;

    const { rows } = await pool.query(
      `SELECT
         plan_number, location, lga, application_status,
         db2_geom_lat AS lat, db2_geom_lng AS lng,
         actual_area_sqm, surveyor_name, db2_geojson
       FROM v_plan_coordinates
       WHERE lga = $1 AND db2_geojson IS NOT NULL
       ORDER BY plan_number`,
      [lga]
    );

    const features = rows.map(r => ({
      type: 'Feature',
      properties: {
        plan_number:  r.plan_number,
        location:     r.location,
        lga:          r.lga,
        status:       r.application_status,
        surveyor:     r.surveyor_name,
        area_sqm:     r.actual_area_sqm,
      },
      geometry: r.db2_geojson,
    }));

    res.json({
      lga,
      total: features.length,
      geojson: { type: 'FeatureCollection', features },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
