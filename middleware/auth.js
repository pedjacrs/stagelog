// middleware/auth.js
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const r = await pool.query(
      'SELECT id,name,email,role,active,tenant_id,is_super_admin FROM employees WHERE id=$1',
      [decoded.id]
    );
    if (!r.rows[0] || !r.rows[0].active) return res.status(401).json({ error: 'Account not found or inactive.' });

    // ── Single session validation ─────────────────────────
    const activeSessions = req.app.locals.activeSessions;
    if (activeSessions) {
      const session = activeSessions.get(decoded.id);
      if (!session) {
        // Session not found — another login may have cleared it
        return res.status(401).json({ error: 'Session expired or logged in elsewhere. Please log in again.' });
      }
      if (session.token !== token) {
        // Different token — user logged in elsewhere
        return res.status(401).json({ error: 'Your account was logged in from another location. Please log in again.' });
      }
    }

    // Check tenant active + not expired
    if (r.rows[0].tenant_id && !r.rows[0].is_super_admin) {
      const tr = await pool.query('SELECT active,expires_at FROM tenants WHERE id=$1', [r.rows[0].tenant_id]);
      if (tr.rows[0]) {
        if (!tr.rows[0].active) return res.status(403).json({ error: 'Account suspended.' });
        if (tr.rows[0].expires_at && new Date(tr.rows[0].expires_at) < new Date()) {
          return res.status(403).json({ error: 'Demo period expired. Please contact your administrator.' });
        }
      }
    }
    req.user = r.rows[0];
    next();
  } catch { res.status(401).json({ error: 'Invalid session.' }); }
}

const adminOnly      = [requireAuth, (req,res,next) => (req.user.is_super_admin || req.user.role==='administrator') ? next() : res.status(403).json({error:'Administrators only.'})];
const adminOrPM      = [requireAuth, (req,res,next) => (req.user.is_super_admin || ['administrator','project_manager'].includes(req.user.role)) ? next() : res.status(403).json({error:'Access denied.'})];
const canEditProject = [requireAuth, (req,res,next) => (req.user.is_super_admin || ['administrator','project_manager','project_lead'].includes(req.user.role)) ? next() : res.status(403).json({error:'Access denied.'})];
const allRoles       = [requireAuth];
const superAdminOnly = [requireAuth, (req,res,next) => req.user.is_super_admin ? next() : res.status(403).json({error:'Super admin only.'})];

module.exports = { requireAuth, adminOnly, adminOrPM, canEditProject, allRoles, superAdminOnly };
