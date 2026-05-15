// src/lib/refNumbers.js
// Auto-generates all SGIS reference numbers using the DB sequential counter.
// All formats defined in Master Plan Section 9.

import pool from '../db/pool.js';

/**
 * Atomically increments the counter for a doc type + year
 * and returns the new serial number.
 */
async function nextSerial(docType, year) {
  const { rows } = await pool.query(
    'SELECT generate_reference_number($1, $2) AS serial',
    [docType, year]
  );
  return rows[0].serial;
}

const year = () => new Date().getFullYear();
const pad  = (n, digits) => String(n).padStart(digits, '0');

/**
 * Lodgement Certificate No.
 * Format: KWGIS/OSG/LGC/{3-digit serial}/{year}
 * e.g.   KWGIS/OSG/LGC/023/2025
 */
export async function genCertificateNo() {
  const y = year();
  const s = await nextSerial('LGC', y);
  return `KWGIS/OSG/LGC/${pad(s, 3)}/${y}`;
}

/**
 * CFC No.  (Charting for Confirmation)
 * Format: KWGIS/OSG/{serial}/PG{serial2}
 * Two independent counters: CFC for the outer serial, CFCP for the PG serial.
 * e.g.   KWGIS/OSG/539/PG2275
 */
export async function genCfcNo() {
  const y = year();
  const [s1, s2] = await Promise.all([
    nextSerial('CFC',  y),
    nextSerial('CFCP', y),
  ]);
  return `KWGIS/OSG/${s1}/PG${s2}`;
}

/**
 * CIR REF No. (Charting Information Report)
 * Format: KWGIS/OSG/{serial}/C{serial2}
 * Two independent counters: CIR for the outer serial, CIRC for the C serial.
 * e.g.   KWGIS/OSG/539/C2614
 */
export async function genCirRefNo() {
  const y = year();
  const [s1, s2] = await Promise.all([
    nextSerial('CIR',  y),
    nextSerial('CIRC', y),
  ]);
  return `KWGIS/OSG/${s1}/C${s2}`;
}

/**
 * Lodgement No.
 * Format: LDG/KW/{year}/{4-digit serial}
 * e.g.   LDG/KW/2025/0023
 */
export async function genLodgementNo() {
  const y = year();
  const s = await nextSerial('LDG', y);
  return `LDG/KW/${y}/${pad(s, 4)}`;
}

/**
 * Land No.
 * Format: LND/KW/{year}/{4-digit serial}
 */
export async function genLandNo() {
  const y = year();
  const s = await nextSerial('LND', y);
  return `LND/KW/${y}/${pad(s, 4)}`;
}

/**
 * Survey No.
 * Format: SVY/KW/{year}/{4-digit serial}
 */
export async function genSurveyNo() {
  const y = year();
  const s = await nextSerial('SVY', y);
  return `SVY/KW/${y}/${pad(s, 4)}`;
}
