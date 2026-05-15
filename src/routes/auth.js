// src/routes/auth.js
// Authentication routes.
//
// POST /api/auth/login            Log in — returns JWT
// POST /api/auth/logout           Client-side token discard (stateless — advises client)
// GET  /api/auth/me               Returns current user from token
// POST /api/auth/change-password  Change own password (authenticated)
//
// Admin-only staff management:
// POST   /api/auth/staff          Create a new staff account (admin only)
// GET    /api/auth/staff          List all staff accounts (admin only)
// PATCH  /api/auth/staff/:id      Update staff role / active status (admin only)

import { Router }      from 'express';
import bcrypt          from 'bcryptjs';
import jwt             from 'jsonwebtoken';
import rateLimit       from 'express-rate-limit';
import pool            from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_ROUNDS  = 12;

// ---------------------------------------------------------------------------
// Rate limiter — applied to login only (brute-force protection)
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // max 10 attempts per IP per window
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body: { email, password }
// Returns: { token, user: { id, email, role, fullName } }
// ---------------------------------------------------------------------------
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_active
       FROM staff_users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (!rows.length) {
      // Don't reveal whether the email exists
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is inactive. Contact your administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      {
        sub:      user.id,
        email:    user.email,
        role:     user.role,
        fullName: user.full_name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id:       user.id,
        email:    user.email,
        role:     user.role,
        fullName: user.full_name,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// JWT is stateless — the client drops the token.
// This endpoint exists so the frontend has a consistent logout call target.
// ---------------------------------------------------------------------------
router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out. Please discard your token on the client.' });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Returns the authenticated user's profile from the token.
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", email, role, is_active AS "isActive", created_at AS "createdAt"
       FROM staff_users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// ---------------------------------------------------------------------------
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const { rows } = await pool.query(
      'SELECT password_hash FROM staff_users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await pool.query(
      'UPDATE staff_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.id]
    );

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/staff  (admin only)
// Create a new staff account.
// Body: { fullName, email, password, role }
// ---------------------------------------------------------------------------
router.post('/staff', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { fullName, email, password, role } = req.body;

    const missing = [];
    if (!fullName)  missing.push('fullName');
    if (!email)     missing.push('email');
    if (!password)  missing.push('password');
    if (!role)      missing.push('role');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }

    const allowedRoles = ['admin', 'sg_office', 'staff', 'carto', 'verification', 'inspection', 'records', 'viewer'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${allowedRoles.join(', ')}` });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await pool.query(
      `INSERT INTO staff_users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name AS "fullName", email, role, is_active AS "isActive", created_at AS "createdAt"`,
      [fullName.trim(), email.trim().toLowerCase(), passwordHash, role]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Email ${req.body.email} is already registered.` });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/staff  (admin only)
// List all staff accounts.
// ---------------------------------------------------------------------------
router.get('/staff', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", email, role, is_active AS "isActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM staff_users
       ORDER BY full_name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/staff/:id  (admin only)
// Update role or active status of a staff account.
// Body: { role?, isActive? }
// ---------------------------------------------------------------------------
router.patch('/staff/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id }             = req.params;
    const { role, isActive } = req.body;

    const allowedRoles = ['admin', 'sg_office', 'staff', 'carto', 'verification', 'inspection', 'records', 'viewer'];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${allowedRoles.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE staff_users
       SET
         role       = COALESCE($1, role),
         is_active  = COALESCE($2, is_active),
         updated_at = NOW()
       WHERE id = $3
       RETURNING id, full_name AS "fullName", email, role, is_active AS "isActive", updated_at AS "updatedAt"`,
      [role ?? null, isActive ?? null, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Staff account not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/setup-admin
// One-time endpoint to set the initial admin password.
// Only works if the admin account still has the placeholder hash.
// No auth required — this is the bootstrap step.
// ---------------------------------------------------------------------------
router.post('/setup-admin', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Check if placeholder hash still exists
    const { rows } = await pool.query(
      "SELECT id FROM staff_users WHERE email = 'admin@kwgis.gov.ng' AND password_hash = 'CHANGE_ME_ON_FIRST_RUN'"
    );

    if (!rows.length) {
      return res.status(409).json({
        error: 'Admin account is already set up. Use /api/auth/change-password to update it.',
      });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(
      "UPDATE staff_users SET password_hash = $1, updated_at = NOW() WHERE email = 'admin@kwgis.gov.ng'",
      [hash]
    );

    res.json({ message: 'Admin password set. You can now log in at /api/auth/login.' });
  } catch (err) {
    next(err);
  }
});

export default router;
