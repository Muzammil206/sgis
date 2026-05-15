// src/index.js
// SGIS — Backend API
// Runtime: Bun  |  Framework: Express  |  DB: PostgreSQL

import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import helmet     from 'helmet';
import rateLimit  from 'express-rate-limit';
import path       from 'path';
import { fileURLToPath } from 'url';

import { errorHandler }  from './middleware/errorHandler.js';
import { UPLOAD_DIR }    from './lib/upload.js';

import authRoutes        from './routes/auth.js';
import surveyorRoutes    from './routes/surveyors.js';
import applicationRoutes from './routes/applications.js';
import lodgmentRoutes    from './routes/lodgments.js';
import clientRoutes      from './routes/clients.js';
import comparisonRoutes  from './routes/comparison.js';
import documentRoutes    from './routes/documents.js';
import dashboardRoutes   from './routes/dashboard.js';
import uploadRoutes      from './routes/uploads.js';
import lgaRoutes         from './routes/lgas.js';
import formIntakeRoutes from './routes/formIntake.js';
import workflowRoutes   from './routes/workflow.js';
import gisRoutes        from './routes/gis.js';

const app  = express();
const PORT = Number(process.env.PORT) || 4000;

// __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Trust proxy — required for X-Forwarded-For header (Cloudflare Tunnel, etc.)
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security Middleware
// ---------------------------------------------------------------------------

// Helmet — sets secure HTTP response headers
app.use(helmet());

// CORS — allow only the configured frontend origin
app.use(cors({
  origin:      process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// Global rate limiter — 300 requests per 15 minutes per IP
// (auth/login has its own tighter limiter in auth.js)
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Body parsers
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Static file serving — uploaded documents
// Files stored in UPLOAD_DIR are served at /uploads/<folder>/<filename>
// e.g. GET /uploads/plans/1700000000000_abc.pdf
// ---------------------------------------------------------------------------
const uploadDirAbsolute = path.resolve(__dirname, '..', UPLOAD_DIR);
app.use('/uploads', express.static(uploadDirAbsolute));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);
app.use('/api/surveyors',    surveyorRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/lodgments',    lodgmentRoutes);
app.use('/api/clients',      clientRoutes);
app.use('/api/comparison',   comparisonRoutes);
app.use('/api/documents',    documentRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/uploads',      uploadRoutes);
app.use('/api/lgas',         lgaRoutes);
app.use('/api/form-intake', formIntakeRoutes);
app.use('/api/workflow',   workflowRoutes);
app.use('/api/gis',       gisRoutes);

// Health check — public, no auth required
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SGIS API', ts: new Date().toISOString() });
});

// 404 — catch-all for unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler — must be last
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[SGIS] API running → http://localhost:${PORT}`);
  console.log(`[SGIS] Uploads served at → http://localhost:${PORT}/uploads`);
});
