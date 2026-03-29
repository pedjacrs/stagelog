// routes/api.js
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { requireAuth, adminOnly, adminOrPM, canEditProject, allRoles, superAdminOnly } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// PDF upload storage
const pdfStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const dir = path.join(__dirname, '..', 'public', 'pdfs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e6);
    cb(null, 'pullsheet-' + unique + '.pdf');
  }
});
const uploadPDF = multer({
  storage: pdfStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed.'));
  }
});

// ── Branding (public) ─────────────────────────
router.get("/settings/branding", async (req, res) => {
  try {
    const r = await pool.query("SELECT key,value FROM settings WHERE key IN ('login_bg_color','login_bg_image')");
    const s = {};
    r.rows.forEach(row => s[row.key] = row.value);
    res.json({bg_color: s.login_bg_color||'#F5F4F0', bg_image: s.login_bg_image||null});
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.use(requireAuth);

// ── TENANT INFO (for current user's tenant) ───
router.get('/tenant/info', allRoles, async (req, res) => {
  if (!req.user.tenant_id) return res.json({name:null, expires_at:null});
  try {
    const r = await pool.query('SELECT name, expires_at, active FROM tenants WHERE id=$1', [req.user.tenant_id]);
    if (!r.rows[0]) return res.json({name:null, expires_at:null});
    res.json({name: r.rows[0].name, expires_at: r.rows[0].expires_at, active: r.rows[0].active});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Tenant helpers ────────────────────────────
// Super admin vidi sve, obični user vidi samo svoj tenant
function tClause(user, alias) {
  // alias npr 'p' za 'p.tenant_id', ili '' za 'tenant_id'
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return user.is_super_admin ? { where: '', params: [] } : { where: ` AND ${col}=$`, params: [user.tenant_id] };
}
// Gradi WHERE klauzulu sa ispravnim $N indexom
function withTenant(user, baseParams, alias) {
  if (user.is_super_admin) return { extra: '', params: baseParams };
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return { extra: ` AND ${col}=$${baseParams.length + 1}`, params: [...baseParams, user.tenant_id] };
}
function tenantVal(user) {
  return user.tenant_id;
}
// Provjeri da li resurs pripada korisniku (za UPDATE/DELETE po ID)
async function ownsResource(table, id, tenantId) {
  const r = await pool.query(`SELECT tenant_id FROM ${table} WHERE id=$1`, [id]);
  if (!r.rows[0]) return false;
  return r.rows[0].tenant_id === tenantId;
}

// AV_ROLES now stored per-tenant in av_roles table

// ── Mailer helper (reused from auth) ─────────────────────
function getMailer() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'jovanovicmpredrag@gmail.com', pass: process.env.GMAIL_APP_PASS }
  });
}

// ── Default data for new tenants ─────────────────────────
const DEFAULT_PROJECT_TYPES = [
  {name:'Concert',        color:'#7C3AED'},
  {name:'Corporate Event',color:'#2563EB'},
  {name:'Conference',     color:'#0891B2'},
  {name:'Exhibition',     color:'#D97706'},
  {name:'Festival',       color:'#DC2626'},
  {name:'Installation',   color:'#059669'},
  {name:'Broadcast',      color:'#B45309'},
];
const DEFAULT_AV_ROLES = [
  'Project Manager','Project Lead','Audio Tech','Video Tech',
  'SI Engineer','Runner','Lighting Tech','Stage Manager','Crew'
];

async function seedTenantDefaults(tid) {
  // Insert default project types
  for (const pt of DEFAULT_PROJECT_TYPES) {
    await pool.query(
      'INSERT INTO project_types (name,color,tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [pt.name, pt.color, tid]
    );
  }
  // Insert default AV roles
  for (const role of DEFAULT_AV_ROLES) {
    await pool.query(
      'INSERT INTO av_roles (name,tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [role, tid]
    );
  }
}

// ── PROJECT TYPES ─────────────────────────────
router.get('/project-types', allRoles, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  const r = await pool.query(
    'SELECT * FROM project_types WHERE tenant_id=$1 ORDER BY name',
    [tid]
  );
  res.json(r.rows);
});
router.post('/project-types', adminOnly, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    const r = await pool.query(
      'INSERT INTO project_types (name,color,tenant_id) VALUES ($1,$2,$3) RETURNING *',
      [name, color||'#2D5BE3', tenantVal(req.user)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error: 'Type already exists.' });
    res.status(500).json({ error: err.message });
  }
});
router.put('/project-types/:id', adminOnly, async (req, res) => {
  const { name, color } = req.body;
  const t = withTenant(req.user, [name, color, req.params.id]);
  try {
    await pool.query('UPDATE project_types SET name=$1,color=$2 WHERE id=$3' + t.extra, t.params);
    res.json({message:'Updated.'});
  } catch (err) {
    if(err.code==='23505') return res.status(409).json({error:'Name already exists.'});
    res.status(500).json({error:err.message});
  }
});
router.delete('/project-types/:id', adminOnly, async (req, res) => {
  const t = withTenant(req.user, [req.params.id]);
  try {
    await pool.query('DELETE FROM project_types WHERE id=$1' + t.extra, t.params);
    res.json({message:'Deleted.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── EMPLOYEES ─────────────────────────────────
router.get('/employees', allRoles, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  const activeFilter = req.query.active;
  let whereActive = 'AND active=TRUE'; // default
  if (activeFilter === 'all') whereActive = '';
  else if (activeFilter === 'inactive') whereActive = 'AND active=FALSE';
  const r = await pool.query(
    `SELECT id,badge_number,name,email,role,employment,daily_hours,active,created_at FROM employees WHERE tenant_id=$1 ${whereActive} ORDER BY name`,
    [tid]
  );
  res.json(r.rows);
});
router.post('/employees', adminOnly, async (req, res) => {
  const { badge_number, name, email, password, role, employment, daily_hours } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    // Check user limit for tenant
    const tid = tenantVal(req.user);
    if (tid) {
      const tInfo = await pool.query('SELECT max_users FROM tenants WHERE id=$1', [tid]);
      const maxU = tInfo.rows[0]?.max_users;
      if (maxU) {
        const cnt = await pool.query('SELECT COUNT(*) FROM employees WHERE tenant_id=$1 AND active=TRUE', [tid]);
        if (parseInt(cnt.rows[0].count) >= maxU) {
          return res.status(403).json({ error: `User limit reached. Your plan allows ${maxU} users. Please upgrade to add more.` });
        }
      }
    }
    let hash = null;
    if (password) hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO employees (badge_number,name,email,password,role,employment,daily_hours,tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,badge_number,name,email,role,employment,daily_hours,active`,
      [badge_number||null, name, email?.toLowerCase()||null, hash, role||'viewer', employment||'full_time', daily_hours||8, tenantVal(req.user)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error: 'Email or badge number already exists.' });
    res.status(500).json({ error: err.message });
  }
});
router.put('/employees/:id', adminOnly, async (req, res) => {
  const { badge_number, name, email, password, role, employment, daily_hours, active, _reactivate } = req.body;
  const t = withTenant(req.user, []);
  try {
    if (!req.user.is_super_admin) {
      // For reactivation, check against all employees including inactive
      const r = await pool.query('SELECT tenant_id FROM employees WHERE id=$1', [req.params.id]);
      if (!r.rows[0] || r.rows[0].tenant_id !== req.user.tenant_id) return res.status(403).json({error:'Access denied.'});
    }
    // Quick reactivation — check user limit first
    if (_reactivate) {
      const tid = req.user.is_super_admin ? null : req.user.tenant_id;
      if (tid) {
        const tInfo = await pool.query('SELECT max_users FROM tenants WHERE id=$1', [tid]);
        const maxU = tInfo.rows[0]?.max_users;
        if (maxU) {
          const cnt = await pool.query('SELECT COUNT(*) FROM employees WHERE tenant_id=$1 AND active=TRUE', [tid]);
          if (parseInt(cnt.rows[0].count) >= maxU) {
            return res.status(403).json({ error: `User limit reached. Your plan allows ${maxU} active users. Deactivate another user first.` });
          }
        }
      }
      await pool.query('UPDATE employees SET active=TRUE WHERE id=$1', [req.params.id]);
      return res.json({message:'Employee reactivated.'});
    }
    if (password && password.length >= 8) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        `UPDATE employees SET badge_number=$1,name=$2,email=$3,password=$4,role=$5,employment=$6,daily_hours=$7,active=$8 WHERE id=$9`,
        [badge_number||null, name, email?.toLowerCase()||null, hash, role||'viewer', employment||'full_time', daily_hours||8, active!==false, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE employees SET badge_number=$1,name=$2,email=$3,role=$4,employment=$5,daily_hours=$6,active=$7 WHERE id=$8`,
        [badge_number||null, name, email?.toLowerCase()||null, role||'viewer', employment||'full_time', daily_hours||8, active!==false, req.params.id]
      );
    }
    res.json({message:'Employee updated.'});
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error: 'Email or badge number already exists.' });
    res.status(500).json({ error: err.message });
  }
});
router.delete('/employees/:id', adminOnly, async (req, res) => {
  if (parseInt(req.params.id)===req.user.id) return res.status(400).json({error:'Cannot deactivate your own account.'});
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('employees', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('UPDATE employees SET active=FALSE WHERE id=$1',[req.params.id]);
    res.json({message:'Employee deactivated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// AV roles list
// ── AV ROLES (per-tenant) ─────────────────────────────────
router.get('/av-roles', allRoles, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    const r = await pool.query('SELECT id,name FROM av_roles WHERE tenant_id=$1 ORDER BY name', [tid]);
    res.json(r.rows.map(function(row){ return row.name; }));
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/av-roles', adminOnly, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({error:'Name required.'});
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    await pool.query('INSERT INTO av_roles (name,tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [name.trim(), tid]);
    res.status(201).json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.put('/av-roles/:name', adminOnly, async (req, res) => {
  const { newName } = req.body;
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    await pool.query('UPDATE av_roles SET name=$1 WHERE name=$2 AND tenant_id=$3', [newName.trim(), req.params.name, tid]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/av-roles/:name', adminOnly, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    await pool.query('DELETE FROM av_roles WHERE name=$1 AND tenant_id=$2', [req.params.name, tid]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Branding image upload
const brandingStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const dir = path.join(__dirname, '../public/uploads/branding');
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
    cb(null, dir);
  },
  filename: function(req, file, cb) {
    cb(null, 'login-bg' + path.extname(file.originalname).toLowerCase());
  }
});
const brandingUpload = multer({storage:brandingStorage, limits:{fileSize:5*1024*1024}, fileFilter:function(req,file,cb){
  if(file.mimetype.startsWith('image/')) cb(null,true); else cb(new Error('Images only'));
}});

// ── PROJECTS ──────────────────────────────────
router.get('/projects', allRoles, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  const archived = req.query.archived === 'true';
  try {
    const r = await pool.query(
      `SELECT p.*, pt.name AS type_name, pt.color AS type_color,
              e.name AS created_by_name
       FROM projects p
       LEFT JOIN project_types pt ON pt.id = p.type_id
       LEFT JOIN employees e ON e.id = p.created_by
       WHERE p.tenant_id=$1 AND p.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
       ORDER BY p.created_at DESC`,
      [tid]
    );
    res.json(r.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

// Archive project
router.post('/projects/:id/archive', adminOnly, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    // Brisanje time entries, crew i vozila — ostaju samo detalji projekta
    await pool.query('DELETE FROM time_entries WHERE project_id=$1', [req.params.id]);
    await pool.query('DELETE FROM project_crew WHERE project_id=$1', [req.params.id]);
    await pool.query('DELETE FROM project_vehicles WHERE project_id=$1', [req.params.id]);
    await pool.query('DELETE FROM project_day_vehicles WHERE project_id=$1', [req.params.id]);
    await pool.query('UPDATE projects SET archived_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Restore project from archive
router.post('/projects/:id/restore', adminOnly, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('UPDATE projects SET archived_at=NULL WHERE id=$1', [req.params.id]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/projects', canEditProject, async (req, res) => {
  const { name, type_id, location, client_name, start_date, deadline, description, status, default_start, default_end } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required.' });
  try {
    // Generate job number: SL-YYYY-NNNN
    const countR = await pool.query('SELECT COUNT(*) FROM projects WHERE tenant_id=$1', [tenantVal(req.user)]);
    const seq = parseInt(countR.rows[0].count) + 1;
    const year = new Date().getFullYear();
    const jobNum = 'SL-' + year + '-' + String(seq).padStart(4,'0');
    const r = await pool.query(
      `INSERT INTO projects (name,type_id,location,client_name,start_date,deadline,description,status,default_start,default_end,tenant_id,created_by,job_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, type_id||null, location, client_name, start_date||null, deadline||null, description, status||'confirmed', default_start||'09:00', default_end||'17:00', tenantVal(req.user), req.user.id, jobNum]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.put('/projects/:id', adminOrPM, async (req, res) => {
  const { name, type_id, location, client_name, start_date, deadline, description, status, progress, default_start, default_end } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query(
      `UPDATE projects SET name=$1,type_id=$2,location=$3,client_name=$4,start_date=$5,deadline=$6,description=$7,status=$8,progress=$9,default_start=$10,default_end=$11 WHERE id=$12`,
      [name, type_id||null, location, client_name, start_date||null, deadline||null, description, status, progress||0, default_start||'09:00', default_end||'17:00', req.params.id]
    );
    res.json({message:'Project updated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.delete('/projects/:id', adminOnly, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('DELETE FROM projects WHERE id=$1',[req.params.id]);
    res.json({message:'Deleted.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── PROJECT CREW ──────────────────────────────
// Crew je vezan za project — project je već tenant-filtriran
// Dodajemo JOIN na projects da osiguramo tenant izolaciju
router.get('/projects/:id/crew', allRoles, async (req, res) => {
  const t = withTenant(req.user, [req.params.id]);
  const r = await pool.query(`
    SELECT pc.id, pc.project_id, pc.employee_id, pc.av_role, pc.start_time, pc.end_time,
           e.name, e.email, e.badge_number, e.employment
    FROM project_crew pc
    JOIN employees e ON e.id = pc.employee_id
    JOIN projects p ON p.id = pc.project_id
    WHERE pc.project_id = $1${t.extra.replace('tenant_id','p.tenant_id')}
    ORDER BY pc.av_role, e.name
  `, t.params);
  res.json(r.rows);
});
router.post('/projects/:id/crew', adminOrPM, async (req, res) => {
  const { employee_id, av_role, start_time, end_time } = req.body;
  if (!employee_id || !av_role) return res.status(400).json({ error: 'Employee and role are required.' });
  // Provjeri da project pripada tenantu
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    const r = await pool.query(
      `INSERT INTO project_crew (project_id, employee_id, av_role, start_time, end_time) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, employee_id) DO UPDATE SET av_role=EXCLUDED.av_role, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time RETURNING *`,
      [req.params.id, employee_id, av_role, start_time||null, end_time||null]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { console.error('Crew POST error:', e.message); res.status(500).json({error: e.message}); }
});
router.put('/projects/:id/crew/:crewId', adminOrPM, async (req, res) => {
  const { av_role, start_time, end_time } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query(
      'UPDATE project_crew SET av_role=$1, start_time=$2, end_time=$3 WHERE id=$4 AND project_id=$5',
      [av_role, start_time||null, end_time||null, req.params.crewId, req.params.id]
    );
    res.json({message:'Updated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.delete('/projects/:id/crew/:crewId', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('DELETE FROM project_crew WHERE id=$1 AND project_id=$2',[req.params.crewId, req.params.id]);
    res.json({message:'Removed.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── TIME ENTRIES ──────────────────────────────
router.get('/time-entries', allRoles, async (req, res) => {
  const { date_from, date_to, project_id, employee_id } = req.query;
  let q = `
    SELECT te.*, e.name AS employee_name, p.name AS project_name,
           pc.av_role AS employee_av_role
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN projects p ON p.id = te.project_id
    LEFT JOIN project_crew pc ON pc.project_id=te.project_id AND pc.employee_id=te.employee_id
    WHERE p.archived_at IS NULL
  `;
  const params = [];
  // Uvijek filtriraj po tenant_id — svaki user vidi samo svoje
  params.push(req.user.tenant_id); q+=` AND te.tenant_id=$${params.length}`;
  if (date_from)   { params.push(date_from);   q+=` AND te.entry_date >= $${params.length}`; }
  if (date_to)     { params.push(date_to);     q+=` AND te.entry_date <= $${params.length}`; }
  if (project_id)  { params.push(project_id);  q+=` AND te.project_id = $${params.length}`; }
  if (employee_id) { params.push(employee_id); q+=` AND te.employee_id = $${params.length}`; }
  q += ' ORDER BY te.entry_date DESC, e.name';
  try { const r = await pool.query(q,params); res.json(r.rows); }
  catch { res.status(500).json({error:'Server error.'}); }
});
router.post('/time-entries', canEditProject, async (req, res) => {
  const { employee_id, project_id, entry_date, task, start_time, end_time, notes } = req.body;
  if (!employee_id||!project_id||!entry_date) return res.status(400).json({error:'Employee, project and date are required.'});
  // Provjeri da project pripada tenantu
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', project_id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  let duration_min = null;
  if (start_time && end_time) {
    const [sh,sm]=start_time.split(':').map(Number), [eh,em]=end_time.split(':').map(Number);
    duration_min=(eh*60+em)-(sh*60+sm); if(duration_min<0)duration_min+=1440;
  }
  try {
    const r = await pool.query(
      `INSERT INTO time_entries (employee_id,project_id,entry_date,task,start_time,end_time,duration_min,notes,created_by,tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [employee_id,project_id,entry_date,task,start_time||null,end_time||null,duration_min,notes,req.user.id,tenantVal(req.user)]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.put('/time-entries/:id', adminOrPM, async (req, res) => {
  const { employee_id, project_id, entry_date, task, start_time, end_time, notes, keep_status } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('time_entries', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  let duration_min = null;
  if (start_time && end_time) {
    const [sh,sm]=start_time.split(':').map(Number), [eh,em]=end_time.split(':').map(Number);
    duration_min=(eh*60+em)-(sh*60+sm); if(duration_min<0) duration_min+=1440;
  }
  try {
    const statusClause = keep_status ? '' : `,status='pending'`;
    await pool.query(
      `UPDATE time_entries SET employee_id=$1,project_id=$2,entry_date=$3,task=$4,start_time=$5,end_time=$6,duration_min=$7,notes=$8${statusClause} WHERE id=$9`,
      [employee_id,project_id,entry_date,task,start_time||null,end_time||null,duration_min,notes,req.params.id]
    );
    res.json({message:'Updated.'});
  } catch(e) { console.error('TE PUT error:', e.message); res.status(500).json({error: e.message}); }
});
router.patch('/time-entries/:id/approve', adminOrPM, async (req, res) => {
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('time_entries', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('UPDATE time_entries SET status=$1,approved_by=$2 WHERE id=$3',[status,req.user.id,req.params.id]);
    res.json({message:'Updated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.delete('/time-entries/:id', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('time_entries', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('DELETE FROM time_entries WHERE id=$1',[req.params.id]);
    res.json({message:'Deleted.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── PULL SHEET ────────────────────────────────
router.get('/pull-sheet', allRoles, async (req, res) => {
  const { project_id, date_from, date_to } = req.query;
  if (!project_id) return res.status(400).json({error:'project_id is required.'});
  // Provjeri da project pripada tenantu
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', project_id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  let q = `SELECT ps.*, p.name AS project_name, p.location
           FROM pull_sheet_entries ps
           JOIN projects p ON p.id=ps.project_id
           WHERE ps.project_id=$1`;
  const params = [project_id];
  if (date_from) { params.push(date_from); q+=` AND ps.entry_date >= $${params.length}`; }
  if (date_to)   { params.push(date_to);   q+=` AND ps.entry_date <= $${params.length}`; }
  q += ' ORDER BY ps.entry_date DESC, ps.employee_name';
  try { const r = await pool.query(q,params); res.json(r.rows); }
  catch { res.status(500).json({error:'Server error.'}); }
});
router.post('/pull-sheet', adminOrPM, async (req, res) => {
  const { project_id, entry_date, employee_id, employee_name, av_role, hours_worked, overtime, notes } = req.body;
  if (!project_id||!entry_date) return res.status(400).json({error:'Project and date are required.'});
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', project_id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  let finalName = employee_name;
  if (employee_id) {
    try { const er=await pool.query('SELECT name FROM employees WHERE id=$1',[employee_id]); if(er.rows[0]) finalName=er.rows[0].name; } catch {}
  }
  try {
    const r = await pool.query(
      `INSERT INTO pull_sheet_entries (project_id,entry_date,employee_id,employee_name,av_role,hours_worked,overtime,notes,created_by,tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [project_id,entry_date,employee_id||null,finalName,av_role,hours_worked||0,overtime||0,notes,req.user.id,tenantVal(req.user)]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.put('/pull-sheet/:id', adminOrPM, async (req, res) => {
  const { entry_date, employee_id, employee_name, av_role, hours_worked, overtime, notes } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('pull_sheet_entries', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  let finalName = employee_name;
  if (employee_id) {
    try { const er=await pool.query('SELECT name FROM employees WHERE id=$1',[employee_id]); if(er.rows[0]) finalName=er.rows[0].name; } catch {}
  }
  try {
    await pool.query(
      `UPDATE pull_sheet_entries SET entry_date=$1,employee_id=$2,employee_name=$3,av_role=$4,hours_worked=$5,overtime=$6,notes=$7 WHERE id=$8`,
      [entry_date,employee_id||null,finalName,av_role,hours_worked||0,overtime||0,notes,req.params.id]
    );
    res.json({message:'Updated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.delete('/pull-sheet/:id', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('pull_sheet_entries', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('DELETE FROM pull_sheet_entries WHERE id=$1',[req.params.id]);
    res.json({message:'Deleted.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── PDF PULL SHEET ────────────────────────────
router.post('/pull-sheet/upload-pdf', adminOrPM, uploadPDF.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required.' });
    if (!req.user.is_super_admin) {
      const owns = await ownsResource('projects', project_id, req.user.tenant_id);
      if (!owns) return res.status(403).json({error:'Access denied.'});
    }
    const old = await pool.query('SELECT pdf_filename FROM projects WHERE id=$1', [project_id]);
    if (old.rows[0]?.pdf_filename) {
      const oldPath = path.join(__dirname, '..', 'public', 'pdfs', old.rows[0].pdf_filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await pool.query(
      'UPDATE projects SET pdf_filename=$1, pdf_original=$2 WHERE id=$3',
      [req.file.filename, req.file.originalname, project_id]
    );
    res.json({ ok: true, filename: req.file.filename, original: req.file.originalname });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/pull-sheet/pdf/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'pdfs', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found.' });
  res.sendFile(filePath);
});
router.delete('/pull-sheet/pdf/:projectId', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.projectId, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    const r = await pool.query('SELECT pdf_filename FROM projects WHERE id=$1', [req.params.projectId]);
    const fn = r.rows[0]?.pdf_filename;
    if (fn) {
      const p = path.join(__dirname, '..', 'public', 'pdfs', fn);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      await pool.query('UPDATE projects SET pdf_filename=NULL, pdf_original=NULL WHERE id=$1', [req.params.projectId]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CONFLICT CHECK ────────────────────────────
function toMin(t){ if(!t)return null; const [h,m]=t.slice(0,5).split(':').map(Number); return h*60+m; }

async function checkScheduleConflicts(excludeProjectId, dateFrom, dateTo, employeeIds, vehicleIds, startTime, endTime){
  const conflicts=[], warnings=[];
  const newStart=toMin(startTime), newEnd=toMin(endTime);
  if(newStart===null||newEnd===null) return {conflicts,warnings};
  const dates=[];
  let cur=new Date(dateFrom+'T12:00:00');
  const end=new Date(dateTo+'T12:00:00');
  while(cur<=end){ dates.push(cur.toISOString().split('T')[0]); cur=new Date(cur.getTime()+86400000); }
  for(const date of dates){
    if(employeeIds && employeeIds.length){
      const r=await pool.query(`
        SELECT te.employee_id, e.name as emp_name, p.name as proj_name, pc.start_time, pc.end_time
        FROM time_entries te
        JOIN employees e ON e.id=te.employee_id
        JOIN projects p ON p.id=te.project_id
        LEFT JOIN project_crew pc ON pc.project_id=te.project_id AND pc.employee_id=te.employee_id
        WHERE te.entry_date=$1 AND te.employee_id=ANY($2) AND te.project_id!=$3
          AND p.archived_at IS NULL
      `,[date, employeeIds, excludeProjectId||0]);
      for(const row of r.rows){
        const s=toMin(row.start_time), e2=toMin(row.end_time);
        if(s===null||e2===null) continue;
        if(newStart<e2 && newEnd>s){
          conflicts.push(`${row.emp_name} is already on "${row.proj_name}" on ${date} (${row.start_time?.slice(0,5)}–${row.end_time?.slice(0,5)})`);
        } else {
          const gap = newStart>=e2 ? newStart-e2 : s-newEnd;
          if(gap>=0 && gap<=60) warnings.push(`${row.emp_name} has only ${gap} min gap before/after "${row.proj_name}" on ${date}`);
        }
      }
    }
    if(vehicleIds && vehicleIds.length){
      const r=await pool.query(`
        SELECT pv.vehicle_id, v.name as veh_name, p.name as proj_name, p.default_start, p.default_end
        FROM project_vehicles pv
        JOIN vehicles v ON v.id=pv.vehicle_id
        JOIN projects p ON p.id=pv.project_id
        JOIN time_entries te ON te.project_id=p.id AND te.entry_date=$1
        WHERE pv.vehicle_id=ANY($2) AND pv.project_id!=$3
          AND p.archived_at IS NULL
      `,[date, vehicleIds, excludeProjectId||0]);
      const seen=new Set();
      for(const row of r.rows){
        const key=`${row.vehicle_id}-${row.proj_name}`;
        if(seen.has(key)) continue; seen.add(key);
        const s=toMin(row.default_start), e2=toMin(row.default_end);
        if(s===null||e2===null) continue;
        if(newStart<e2 && newEnd>s){
          conflicts.push(`Vehicle "${row.veh_name}" is already assigned to "${row.proj_name}" on ${date} (${row.default_start?.slice(0,5)}–${row.default_end?.slice(0,5)})`);
        } else {
          const gap = newStart>=e2 ? newStart-e2 : s-newEnd;
          if(gap>=0 && gap<=60) warnings.push(`Vehicle "${row.veh_name}" has only ${gap} min gap before/after "${row.proj_name}" on ${date}`);
        }
      }
    }
  }
  return {conflicts:[...new Set(conflicts)], warnings:[...new Set(warnings)]};
}

router.post('/check-conflicts', adminOrPM, async (req, res) => {
  const { exclude_project_id, date_from, date_to, employee_ids, vehicle_ids, start_time, end_time } = req.body;
  if(!date_from||!date_to) return res.status(400).json({error:'date_from and date_to required.'});
  try {
    const result = await checkScheduleConflicts(
      exclude_project_id, date_from, date_to,
      employee_ids||[], vehicle_ids||[], start_time, end_time
    );
    res.json(result);
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

// ── VEHICLES ──────────────────────────────────
router.get('/vehicles', allRoles, async (req, res) => {
  const tid = req.user.tenant_id;
  try {
    const r = await pool.query('SELECT * FROM vehicles WHERE active=TRUE AND tenant_id=$1 ORDER BY name', [tid]);
    res.json(r.rows);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.post('/vehicles', adminOrPM, async (req, res) => {
  const { name, plate } = req.body;
  if (!name) return res.status(400).json({error:'Name is required.'});
  try {
    const r = await pool.query(
      'INSERT INTO vehicles (name,plate,tenant_id) VALUES ($1,$2,$3) RETURNING *',
      [name, plate||null, tenantVal(req.user)]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.put('/vehicles/:id', adminOrPM, async (req, res) => {
  const { name, plate } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('vehicles', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('UPDATE vehicles SET name=$1,plate=$2 WHERE id=$3',[name,plate||null,req.params.id]);
    res.json({message:'Updated.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.delete('/vehicles/:id', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('vehicles', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('UPDATE vehicles SET active=FALSE WHERE id=$1',[req.params.id]);
    res.json({message:'Deleted.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── PROJECT VEHICLES ──────────────────────────
router.get('/projects/:id/vehicles', allRoles, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    const r = await pool.query(
      'SELECT pv.id, v.id AS vehicle_id, v.name, v.plate FROM project_vehicles pv JOIN vehicles v ON v.id=pv.vehicle_id WHERE pv.project_id=$1 ORDER BY v.name',
      [req.params.id]
    );
    res.json(r.rows);
  } catch { res.status(500).json({error:'Server error.'}); }
});
router.post('/projects/:id/vehicles', adminOrPM, async (req, res) => {
  const { vehicle_id } = req.body;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    const r = await pool.query(
      'INSERT INTO project_vehicles (project_id,vehicle_id) VALUES ($1,$2) RETURNING *',
      [req.params.id, vehicle_id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) {
    if(e.code==='23505') return res.status(409).json({error:'Already assigned.'});
    res.status(500).json({error:'Server error.'});
  }
});
router.delete('/projects/:id/vehicles/:vid', adminOrPM, async (req, res) => {
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query('DELETE FROM project_vehicles WHERE project_id=$1 AND vehicle_id=$2',[req.params.id,req.params.vid]);
    res.json({message:'Removed.'});
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── PROJECT DAY VEHICLES ──────────────────────
router.get('/projects/:id/day-vehicles', allRoles, async (req, res) => {
  const { date } = req.query;
  if(!date) return res.status(400).json({error:'date required.'});
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    const r = await pool.query(
      'SELECT pdv.id, v.id AS vehicle_id, v.name, v.plate FROM project_day_vehicles pdv JOIN vehicles v ON v.id=pdv.vehicle_id WHERE pdv.project_id=$1 AND pdv.entry_date=$2 ORDER BY v.name',
      [req.params.id, date]
    );
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/projects/:id/day-vehicles', adminOrPM, async (req, res) => {
  const { vehicle_id, date } = req.body;
  if(!vehicle_id||!date) return res.status(400).json({error:'vehicle_id and date required.'});
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query(
      'INSERT INTO project_day_vehicles (project_id,vehicle_id,entry_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, vehicle_id, date]
    );
    res.status(201).json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/projects/:id/day-vehicles/:vid', adminOrPM, async (req, res) => {
  const { date } = req.query;
  if (!req.user.is_super_admin) {
    const owns = await ownsResource('projects', req.params.id, req.user.tenant_id);
    if (!owns) return res.status(403).json({error:'Access denied.'});
  }
  try {
    await pool.query(
      'DELETE FROM project_day_vehicles WHERE project_id=$1 AND vehicle_id=$2 AND entry_date=$3',
      [req.params.id, req.params.vid, date]
    );
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── SETTINGS BRANDING ─────────────────────────
router.get('/settings/branding', async (req, res) => {
  try {
    const r = await pool.query("SELECT key,value FROM settings WHERE key IN ('login_bg_color','login_bg_image')");
    const s = {};
    r.rows.forEach(row => s[row.key] = row.value);
    res.json({bg_color: s.login_bg_color||'#F5F4F0', bg_image: s.login_bg_image||null});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/settings/branding', adminOnly, async (req, res) => {
  const { bg_color } = req.body;
  try {
    if(bg_color) await pool.query("INSERT INTO settings(key,value) VALUES('login_bg_color',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[bg_color]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/settings/branding/image', adminOnly, brandingUpload.single('image'), async (req, res) => {
  if(!req.file) return res.status(400).json({error:'No file.'});
  const imgPath = '/uploads/branding/' + req.file.filename;
  try {
    await pool.query("INSERT INTO settings(key,value) VALUES('login_bg_image',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[imgPath]);
    res.json({ok:true, path:imgPath});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/settings/branding/image', adminOnly, async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='login_bg_image'");
    if(r.rows[0]&&r.rows[0].value){
      const fp = path.join(__dirname,'../public',r.rows[0].value);
      if(fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query("UPDATE settings SET value=NULL WHERE key='login_bg_image'");
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── DASHBOARD STATS ───────────────────────────
router.get('/dashboard/stats', allRoles, async (req, res) => {
  try {
    const tid = req.user.tenant_id;
    const sa = req.user.is_super_admin;
    const [projects, employees, pending] = await Promise.all([
      sa ? pool.query(`SELECT COUNT(*) FROM projects WHERE status NOT IN ('completed')`)
         : pool.query(`SELECT COUNT(*) FROM projects WHERE status NOT IN ('completed') AND tenant_id=$1`,[tid]),
      sa ? pool.query(`SELECT COUNT(*) FROM employees WHERE active=TRUE`)
         : pool.query(`SELECT COUNT(*) FROM employees WHERE active=TRUE AND tenant_id=$1`,[tid]),
      sa ? pool.query(`SELECT COUNT(*) FROM time_entries WHERE status='pending'`)
         : pool.query(`SELECT COUNT(*) FROM time_entries WHERE status='pending' AND tenant_id=$1`,[tid]),
    ]);
    res.json({
      active_projects: parseInt(projects.rows[0].count),
      total_employees: parseInt(employees.rows[0].count),
      pending_entries: parseInt(pending.rows[0].count),
      total_users:     parseInt(employees.rows[0].count),
    });
  } catch { res.status(500).json({error:'Server error.'}); }
});

// ── TENANT MANAGEMENT (super admin only) ──────
router.get('/tenants', superAdminOnly, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM employees WHERE tenant_id=t.id AND active=TRUE) as employee_count,
        (SELECT COUNT(*) FROM projects   WHERE tenant_id=t.id) as project_count
      FROM tenants t ORDER BY t.id
    `);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.post('/tenants', superAdminOnly, async (req, res) => {
  const { name, slug, expires_at, plan, max_users } = req.body;
  if (!name||!slug) return res.status(400).json({error:'Name and slug required.'});
  try {
    const r = await pool.query(
      'INSERT INTO tenants (name,slug,expires_at,plan,max_users) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, slug.toLowerCase().replace(/[^a-z0-9-]/g,''), expires_at||null, plan||'unlimited', max_users||null]
    );
    const newTid = r.rows[0].id;
    await seedTenantDefaults(newTid);
    res.status(201).json(r.rows[0]);
  } catch(e){
    if(e.code==='23505') return res.status(409).json({error:'Slug already exists.'});
    res.status(500).json({error:e.message});
  }
});
router.put('/tenants/:id', superAdminOnly, async (req, res) => {
  const { name, active } = req.body;
  if (req.params.id == 1 && active === false) return res.status(400).json({error:'Cannot deactivate primary tenant.'});
  try {
    await pool.query('UPDATE tenants SET name=$1,active=$2 WHERE id=$3',[name,active!==false,req.params.id]);
    res.json({message:'Updated.'});
  } catch(e){ res.status(500).json({error:e.message}); }
});
router.delete('/tenants/:id', superAdminOnly, async (req, res) => {
  if (req.params.id == 1) return res.status(400).json({error:'Cannot delete primary tenant.'});
  const tid = req.params.id;
  try {
    // Cascading delete — order matters due to FK constraints
    await pool.query('DELETE FROM pull_sheet_entries WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM time_entries WHERE tenant_id=$1',[tid]);
    // project_crew, project_vehicles, project_day_vehicles cascade from projects
    await pool.query('DELETE FROM project_crew WHERE project_id IN (SELECT id FROM projects WHERE tenant_id=$1)',[tid]);
    await pool.query('DELETE FROM project_day_vehicles WHERE project_id IN (SELECT id FROM projects WHERE tenant_id=$1)',[tid]);
    await pool.query('DELETE FROM project_vehicles WHERE project_id IN (SELECT id FROM projects WHERE tenant_id=$1)',[tid]);
    await pool.query('DELETE FROM projects WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM project_types WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM vehicles WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM employees WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM tenants WHERE id=$1',[tid]);
    res.json({message:'Tenant and all data deleted.'});
  } catch(e){ res.status(500).json({error:e.message}); }
});


// ── CREATE USER IN SPECIFIC TENANT (super admin) ──
router.post('/tenants/:id/users', superAdminOnly, async (req, res) => {
  const { name, email, password, role } = req.body;
  const tenantId = parseInt(req.params.id);
  if (!name||!email||!password) return res.status(400).json({error:'Name, email and password are required.'});
  if (password.length < 8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  // Check tenant exists and user limit
  const tr = await pool.query('SELECT id,active,max_users FROM tenants WHERE id=$1',[tenantId]);
  if (!tr.rows[0]) return res.status(404).json({error:'Tenant not found.'});
  if (tr.rows[0].max_users) {
    const cnt = await pool.query('SELECT COUNT(*) FROM employees WHERE tenant_id=$1 AND active=TRUE',[tenantId]);
    if (parseInt(cnt.rows[0].count) >= tr.rows[0].max_users) {
      return res.status(403).json({error:`User limit reached. This plan allows ${tr.rows[0].max_users} users.`});
    }
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO employees (name,email,password,role,employment,daily_hours,tenant_id,active)
       VALUES ($1,$2,$3,$4,'full_time',8,$5,TRUE)
       RETURNING id,name,email,role,tenant_id`,
      [name, email.toLowerCase(), hash, role||'administrator', tenantId]
    );
    // Send welcome email
    if (email) {
      let tenantName = 'StageLog';
      try {
        const tn = await pool.query('SELECT name FROM tenants WHERE id=$1', [tenantId]);
        if (tn.rows[0]) tenantName = tn.rows[0].name;
      } catch {}
      getMailer().sendMail({
        from: '"StageLog" <jovanovicmpredrag@gmail.com>',
        to: email.toLowerCase(),
        subject: 'Your StageLog account has been created',
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#1a1a1a;">Welcome to StageLog, ${name}!</h2>
            <p>An administrator account has been created for <strong>${tenantName}</strong>.</p>
            <div style="background:#f5f4f0;border-radius:8px;padding:16px;margin:20px 0;">
              <p style="margin:0 0 8px;"><strong>Login URL:</strong> <a href="https://stagelog.site">stagelog.site</a></p>
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${email.toLowerCase()}</p>
              <p style="margin:0;color:#666;">Your administrator will provide you with your password.</p>
            </div>
            <p style="color:#666;font-size:13px;">— The StageLog Team</p>
          </div>
        `
      }).catch(e => console.error('Tenant user welcome email failed:', e.message));
    }
    res.status(201).json(r.rows[0]);
  } catch(e) {
    if(e.code==='23505') return res.status(409).json({error:'Email already exists.'});
    res.status(500).json({error:e.message});
  }
});

// ── ABSENCES ──────────────────────────────────────────────────
router.get('/absences', allRoles, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  const { employee_id, from, to } = req.query;
  let q = `SELECT a.*, e.name AS employee_name FROM absences a JOIN employees e ON e.id = a.employee_id WHERE a.tenant_id = $1`;
  const params = [tid];
  if (employee_id) { params.push(employee_id); q += ` AND a.employee_id = $${params.length}`; }
  if (from)        { params.push(from);         q += ` AND a.end_date >= $${params.length}`; }
  if (to)          { params.push(to);            q += ` AND a.start_date <= $${params.length}`; }
  q += ' ORDER BY a.start_date DESC, e.name';
  try { const r = await pool.query(q, params); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/absences/check', allRoles, async (req, res) => {
  const { employee_ids, from, to } = req.query;
  if (!employee_ids || !from || !to) return res.json([]);
  const ids = employee_ids.split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT a.*, e.name AS employee_name FROM absences a JOIN employees e ON e.id = a.employee_id
       WHERE a.employee_id = ANY($1::int[]) AND a.start_date <= $2 AND a.end_date >= $3`,
      [ids, to, from]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/absences', adminOnly, async (req, res) => {
  const { employee_id, start_date, end_date, type, note } = req.body;
  if (!employee_id || !start_date || !end_date || !type)
    return res.status(400).json({ error: 'Employee, start date, end date and type are required.' });
  if (new Date(end_date) < new Date(start_date))
    return res.status(400).json({ error: 'End date must be after start date.' });
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  const empCheck = await pool.query('SELECT tenant_id FROM employees WHERE id=$1', [employee_id]);
  if (!empCheck.rows[0]) return res.status(404).json({ error: 'Employee not found.' });
  if (!req.user.is_super_admin && empCheck.rows[0].tenant_id !== tid)
    return res.status(403).json({ error: 'Access denied.' });
  try {
    // 1. Spremi absence
    const r = await pool.query(
      `INSERT INTO absences (employee_id, tenant_id, start_date, end_date, type, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [employee_id, tid, start_date, end_date, type, note||null, req.user.id]
    );

    // 2. Pronadji sve projekte gdje je ovaj zaposleni u crew-u
    //    i koji se vremenski preklapaju sa periodom absence
    const conflictProjs = await pool.query(
      `SELECT DISTINCT p.id, p.name, p.start_date, p.deadline, p.job_number
       FROM project_crew pc
       JOIN projects p ON p.id = pc.project_id
       WHERE pc.employee_id = $1
         AND p.tenant_id = $2
         AND p.archived_at IS NULL
         AND (
           -- Projekat se preklapa sa absence periodom
           (p.start_date IS NOT NULL AND p.start_date <= $4 AND COALESCE(p.deadline, p.start_date) >= $3)
           OR
           -- Projekat nema deadline, ali start_date pada u period
           (p.start_date IS NOT NULL AND p.start_date >= $3 AND p.start_date <= $4)
         )`,
      [employee_id, tid, start_date, end_date]
    );

    // 3. Skini zaposlenog sa tih projekata + prikupi info za email
    const removedFrom = [];
    for (const proj of conflictProjs.rows) {
      await pool.query(
        'DELETE FROM project_crew WHERE employee_id=$1 AND project_id=$2',
        [employee_id, proj.id]
      );
      await pool.query(
        `DELETE FROM time_entries
         WHERE employee_id=$1 AND project_id=$2
           AND entry_date >= $3 AND entry_date <= $4`,
        [employee_id, proj.id, start_date, end_date]
      );

      // Dohvati owner projekta (created_by) + njegov email
      const ownerR = await pool.query(
        `SELECT e.name AS owner_name, e.email AS owner_email, p.created_by
         FROM projects p
         LEFT JOIN employees e ON e.id = p.created_by
         WHERE p.id = $1`,
        [proj.id]
      );
      const owner = ownerR.rows[0] || {};

      removedFrom.push({
        project_id:   proj.id,
        project_name: proj.name,
        job_number:   proj.job_number,
        start_date:   proj.start_date,
        deadline:     proj.deadline,
        owner_name:   owner.owner_name  || null,
        owner_email:  owner.owner_email || null,
      });
    }

    // 4. Dohvati podatke o zaposlenom i tipu absence za email
    const empR = await pool.query(
      'SELECT name FROM employees WHERE id=$1', [employee_id]
    );
    const empName  = empR.rows[0]?.name || 'Unknown';
    const typeLabels = {
      sick:     'Sick Leave',
      vacation: 'Vacation',
      internal: 'Internal Work / Company Task',
      day_off:  'Day Off'
    };
    const absTypeLabel = typeLabels[type] || type;

    const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : '—';

    // 5. Posalji email svakom owneru projekta (bez duplikata)
    if (removedFrom.length > 0) {
      const sentTo = new Set();
      for (const proj of removedFrom) {
        if (!proj.owner_email || sentTo.has(proj.owner_email)) continue;
        sentTo.add(proj.owner_email);

        // Projekti ovog ownera koji su afektirani
        const ownerProjects = removedFrom
          .filter(p => p.owner_email === proj.owner_email)
          .map(p =>
            `<tr>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${p.job_number || '—'}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;">${p.project_name}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;">${fmt(p.start_date)}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;">${fmt(p.deadline)}</td>
            </tr>`
          ).join('');

        const html = `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#f5f4f0;padding:24px;">
            <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
              
              <!-- Header -->
              <div style="background:#1A1917;padding:20px 24px;display:flex;align-items:center;gap:12px;">
                <div style="font-size:22px;font-weight:800;color:#C9A84C;letter-spacing:-1px;">StageLog</div>
              </div>

              <!-- Body -->
              <div style="padding:24px;">
                <div style="background:#FEF5E4;border:1px solid #F59E0B;border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start;">
                  <span style="font-size:20px;">⚠️</span>
                  <div>
                    <div style="font-weight:700;font-size:14px;color:#92400E;">Staff Absence — Crew Updated</div>
                    <div style="font-size:13px;color:#78350F;margin-top:3px;">
                      <strong>${empName}</strong> has been marked as <strong>${absTypeLabel}</strong>
                      (${fmt(start_date)} – ${fmt(end_date)})
                      and has been <strong>automatically removed</strong> from your project(s).
                    </div>
                    ${note ? `<div style="font-size:12px;color:#92400E;margin-top:6px;font-style:italic;">Reason: ${note}</div>` : ''}
                  </div>
                </div>

                <div style="font-size:13px;font-weight:600;color:#6B6860;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Affected Projects</div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #eee;">
                  <thead>
                    <tr style="background:#F5F4F0;">
                      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9E9C96;text-transform:uppercase;letter-spacing:.5px;">Job #</th>
                      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9E9C96;text-transform:uppercase;letter-spacing:.5px;">Project</th>
                      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9E9C96;text-transform:uppercase;letter-spacing:.5px;">Start</th>
                      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9E9C96;text-transform:uppercase;letter-spacing:.5px;">End</th>
                    </tr>
                  </thead>
                  <tbody>${ownerProjects}</tbody>
                </table>

                <div style="margin-top:20px;padding:12px 16px;background:#EEF2FD;border-radius:8px;font-size:13px;color:#2D5BE3;">
                  💡 Please review your crew and reassign if needed.
                  <a href="https://stagelog.site" style="color:#2D5BE3;font-weight:600;text-decoration:none;margin-left:6px;">Open StageLog →</a>
                </div>
              </div>

              <!-- Footer -->
              <div style="padding:14px 24px;background:#F5F4F0;font-size:11px;color:#9E9C96;text-align:center;">
                This is an automated notification from StageLog · <a href="https://stagelog.site" style="color:#9E9C96;">stagelog.site</a>
              </div>
            </div>
          </div>`;

        getMailer().sendMail({
          from: '"StageLog" <jovanovicmpredrag@gmail.com>',
          to:   proj.owner_email,
          subject: `⚠️ Crew Change: ${empName} removed from ${removedFrom.filter(p=>p.owner_email===proj.owner_email).length} project(s) — Absence`,
          html
        }).catch(e => console.error('Absence email error:', e.message));
      }
    }

    // 6. Vrati response
    res.status(201).json({
      absence: r.rows[0],
      removed_from_projects: removedFrom
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/absences/:id', adminOnly, async (req, res) => {
  const { start_date, end_date, type, note } = req.body;
  if (!start_date || !end_date || !type)
    return res.status(400).json({ error: 'Start date, end date and type are required.' });
  if (new Date(end_date) < new Date(start_date))
    return res.status(400).json({ error: 'End date must be after start date.' });
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    const owns = await pool.query('SELECT tenant_id FROM absences WHERE id=$1', [req.params.id]);
    if (!owns.rows[0]) return res.status(404).json({ error: 'Not found.' });
    if (!req.user.is_super_admin && owns.rows[0].tenant_id !== tid)
      return res.status(403).json({ error: 'Access denied.' });
    await pool.query(
      `UPDATE absences SET start_date=$1, end_date=$2, type=$3, note=$4 WHERE id=$5`,
      [start_date, end_date, type, note||null, req.params.id]
    );
    res.json({ message: 'Updated.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/absences/:id', adminOnly, async (req, res) => {
  const tid = req.user.is_super_admin ? 1 : req.user.tenant_id;
  try {
    const owns = await pool.query('SELECT tenant_id FROM absences WHERE id=$1', [req.params.id]);
    if (!owns.rows[0]) return res.status(404).json({ error: 'Not found.' });
    if (!req.user.is_super_admin && owns.rows[0].tenant_id !== tid)
      return res.status(403).json({ error: 'Access denied.' });
    await pool.query('DELETE FROM absences WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.seedTenantDefaults = seedTenantDefaults;
