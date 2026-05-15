// src/middleware/errorHandler.js
// Central Express error handler — must be the LAST app.use() in index.js

export function errorHandler(err, _req, res, _next) {
  console.error('[Error]', err);
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
}
