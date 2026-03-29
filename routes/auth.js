// routes/auth.js
const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const pool       = require('../db/pool');
const { seedTenantDefaults } = require('./api');
const nodemailer = require('nodemailer');
const { requireAuth, adminOnly, superAdminOnly } = require('../middleware/auth');

// ── Mailer ────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'jovanovicmpredrag@gmail.com', pass: process.env.GMAIL_APP_PASS }
});

// ── Generate random password ──────────────────────────────
function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// ── Generate slug from company name ──────────────────────
function genSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Date.now().toString(36);
}

// ── DEMO REGISTRATION (public) ────────────────────────────
const registerLimiter = require('express-rate-limit')({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many registration attempts. Please try again later.' }
});

router.post('/register', registerLimiter, async (req, res) => {
  const { company, name, email, size } = req.body;
  if (!company || !name || !email) return res.status(400).json({ error: 'Company name, name and email are required.' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email address.' });

  try {
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM employees WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    const password = genPassword();
    const hash     = await bcrypt.hash(password, 12);
    const slug     = genSlug(company);

    // Set expiry 14 days from now
    const expires = new Date();
    expires.setDate(expires.getDate() + 14);

    // Create tenant
    const tr = await pool.query(
      'INSERT INTO tenants (name, slug, active, expires_at) VALUES ($1,$2,TRUE,$3) RETURNING id',
      [company, slug, expires]
    );
    const tenantId = tr.rows[0].id;
    // Seed default project types and AV roles
    await seedTenantDefaults(tenantId);

    // Create admin user
    await pool.query(
      `INSERT INTO employees (name, email, password, role, employment, daily_hours, tenant_id, active)
       VALUES ($1,$2,$3,'administrator','full_time',8,$4,TRUE)`,
      [name, email.toLowerCase(), hash, tenantId]
    );

    // Send credentials email to registrant
    await mailer.sendMail({
      from: '"StageLog" <jovanovicmpredrag@gmail.com>',
      to: email,
      subject: 'Your StageLog trial is ready! ✅',
      replyTo: 'jovanovicmpredrag@gmail.com',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a1a1a;">Welcome to StageLog, ${name}!</h2>
          <p>Your 14-day free trial for <strong>${company}</strong> is ready.</p>
          <div style="background:#f5f4f0;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:0 0 8px;"><strong>Login URL:</strong> <a href="https://stagelog.site">stagelog.site</a></p>
            <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
            <p style="margin:0;"><strong>Password:</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code></p>
          </div>
          <p style="color:#666;font-size:13px;">Your trial expires on <strong>${expires.toLocaleDateString('en-GB')}</strong>. To continue after the trial, contact us at <a href="mailto:jovanovicmpredrag@gmail.com">jovanovicmpredrag@gmail.com</a>.</p>
          <p style="color:#666;font-size:13px;">— The StageLog Team</p>
        </div>
      `
    }).catch(e => console.error('Email to user failed:', e.message));

    // Notify owner
    await mailer.sendMail({
      from: '"StageLog" <jovanovicmpredrag@gmail.com>',
      to: 'jovanovicmpredrag@gmail.com',
      subject: `New trial signup: ${company}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
          <h2>New Trial Registration</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Company</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${company}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Name</td><td style="padding:8px;border-bottom:1px solid #eee;">${name}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${email}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Team Size</td><td style="padding:8px;border-bottom:1px solid #eee;">${size||'—'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Tenant ID</td><td style="padding:8px;border-bottom:1px solid #eee;">${tenantId}</td></tr>
            <tr><td style="padding:8px;color:#666;">Expires</td><td style="padding:8px;">${expires.toLocaleDateString('en-GB')}</td></tr>
          </table>
        </div>
      `
    }).catch(e => console.error('Email to owner failed:', e.message));

    res.status(201).json({ ok: true, password });

  } catch(e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── DEMO LOGIN (public — no credentials needed) ──────────
router.post('/demo', async (req, res) => {
  try {
    // Get demo user
    const r = await pool.query(
      "SELECT * FROM employees WHERE email='james@avproductions.co.uk' AND active=TRUE LIMIT 1"
    );
    const user = r.rows[0];
    if (!user) return res.status(503).json({ error: 'Demo account not available.' });

    // Check tenant is active
    if (user.tenant_id) {
      const tr = await pool.query('SELECT active FROM tenants WHERE id=$1', [user.tenant_id]);
      if (!tr.rows[0] || !tr.rows[0].active) return res.status(503).json({ error: 'Demo account is currently unavailable.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id, is_super_admin: false },
      process.env.JWT_SECRET,
      { expiresIn: '2h' } // Demo sessions last 2 hours
    );

    // Allow demo sessions to coexist — skip single session check
    const activeSessions = req.app.locals.activeSessions;
    if (activeSessions) {
      activeSessions.set(user.id, { token, loginAt: Date.now(), isDemo: true });
      setTimeout(() => {
        const s = activeSessions.get(user.id);
        if (s && s.token === token) activeSessions.delete(user.id);
      }, 2 * 60 * 60 * 1000);
    }

    res.cookie('token', token, {
      httpOnly: true, secure: false, sameSite: 'lax', maxAge: 2*60*60*1000
    });
    res.json({ ok: true });
  } catch(e) {
    console.error('Demo login error:', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password, badge_number } = req.body;
  if ((!email && !badge_number) || !password) return res.status(400).json({ error: 'Credentials and password are required.' });
  try {
    let r;
    if (badge_number) {
      r = await pool.query('SELECT * FROM employees WHERE LOWER(badge_number)=LOWER($1) AND active=TRUE', [badge_number.trim()]);
    } else {
      r = await pool.query('SELECT * FROM employees WHERE email=$1 AND active=TRUE', [email.toLowerCase()]);
    }
    const user = r.rows[0];
    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    // Check tenant is active
    if (user.tenant_id) {
      const tr = await pool.query('SELECT active FROM tenants WHERE id=$1', [user.tenant_id]);
      if (tr.rows[0] && !tr.rows[0].active) return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    // ── Single session check ──────────────────────────────
    const activeSessions = req.app.locals.activeSessions;
    if (activeSessions && activeSessions.has(user.id)) {
      return res.status(409).json({
        error: 'This account is already logged in on another device or browser. Please log out from there first, or wait for the session to expire.'
      });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id, is_super_admin: user.is_super_admin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // Register session
    if (activeSessions) {
      activeSessions.set(user.id, { token, loginAt: Date.now() });
      // Auto-expire session after 8 hours
      setTimeout(() => {
        const s = activeSessions.get(user.id);
        if (s && s.token === token) activeSessions.delete(user.id);
      }, 8 * 60 * 60 * 1000);
    }

    res.cookie('token', token, {
      httpOnly: true, secure: false, sameSite: 'lax', maxAge: 8*60*60*1000
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id, is_super_admin: user.is_super_admin } });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      const activeSessions = req.app.locals.activeSessions;
      if (activeSessions) activeSessions.delete(decoded.id);
    } catch {}
  }
  res.clearCookie('token');
  res.json({ message: 'Logged out.' });
});
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
