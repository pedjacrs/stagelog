// server.js - Glavni server
require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const authRouter = require('./routes/auth');
const apiRouter  = require('./routes/api');

// ── Active session store (in-memory) ─────────────────────
// Maps userId -> { token, loginAt }
const activeSessions = new Map();

const app  = express();
app.locals.activeSessions = activeSessions;
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.set('trust proxy',1);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Security headers ─────────────────────────────────────
app.disable('x-powered-by'); // Hide Express
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  next();
});

// CORS - dozvoli samo s tvog domaina u produkciji
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? true  // Cloudflare Tunnel šalje zahtjeve lokalno, ovo je OK
    : 'http://localhost:3000',
  credentials: true
}));

// Rate limiting - zaštita od brute-force napada
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuta
  max: 10,                   // max 10 pokušaja prijave
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});
app.use('/api/auth/login', loginLimiter);

// Generalni rate limit
app.use('/api', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests.' }
}));

// ── Zaštita frontend-a — samo login.html je javna ──────────
const jwt = require('jsonwebtoken');
const PUBLIC_PATHS = ['/login.html', '/register.html', '/favicon.ico'];
const PUBLIC_PREFIXES = ['/api/', '/uploads/'];

app.use((req, res, next) => {
  const p = req.path;
  // Dozvoli javne putanje
  if(PUBLIC_PATHS.includes(p)) return next();
  if(PUBLIC_PREFIXES.some(prefix => p.startsWith(prefix))) return next();
  // Provjeri JWT cookie
  const token = req.cookies && req.cookies.token;
  if(!token) {
    // Ako traži HTML stranicu → redirect na login
    if(!p.includes('.') || p === '/') return res.redirect('/login.html');
    return res.status(401).send('Unauthorized');
  }
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch(e) {
    if(!p.includes('.') || p === '/') return res.redirect('/login.html');
    return res.status(401).send('Unauthorized');
  }
});

// ── Statični fajlovi (frontend) ───────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Rute ──────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api',      apiRouter);

// ── Sve ostalo → frontend (SPA) ───────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Pokretanje servera ────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ TM Time Manager pokrenut!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://0.0.0.0:${PORT}\n`);
});
