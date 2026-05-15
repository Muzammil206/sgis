// src/middleware/auth.js
// JWT authentication middleware + role-based authorization guards.
//
// Usage:
//   import { requireAuth, requireRole } from '../middleware/auth.js';
//
//   router.post('/', requireAuth, handler);                         // any logged-in staff
//   router.post('/', requireAuth, requireRole('admin'), handler);   // admin only

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[Auth] FATAL: JWT_SECRET is not set in environment. Exiting.');
  process.exit(1);
}

/**
 * requireAuth
 * Verifies the Bearer token in the Authorization header.
 * On success: attaches req.user = { id, email, role, fullName } and calls next().
 * On failure: returns 401.
 */
export function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id:       payload.sub,
      email:    payload.email,
      role:     payload.role,
      fullName: payload.fullName,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

/**
 * requireRole(...roles)
 * Must be used AFTER requireAuth.
 * Allows access only if req.user.role is in the provided list.
 *
 * Examples:
 *   requireRole('admin')               // admin only
 *   requireRole('admin', 'staff')      // admin or staff
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}.`,
      });
    }
    next();
  };
}
