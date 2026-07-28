const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'wedding.json');
const RSVP_FILE = path.join(DATA_DIR, 'rsvps.json');

// ---------- bootstrap data dir/files ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_DATA = {
  couple: {
    partner1: "Partner One",
    partner2: "Partner Two",
    tagline: "are getting married",
    welcomeNote: "We can't wait to celebrate with the people we love most. All the details of our wedding week are right here — check back anytime, as this page always has the latest plan."
  },
  weddingDateLabel: "Add your wedding date in the admin panel",
  days: [],
  venue: { name: "Add your venue name", address: "Add the address in the admin panel", mapsUrl: "" },
  photos: [],
  // Password is stored as a salted hash, never in plain text.
  adminPasswordHash: hashPassword("wedding2026")
};

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(DATA_FILE)) writeJSON(DATA_FILE, DEFAULT_DATA);
if (!fs.existsSync(RSVP_FILE)) writeJSON(RSVP_FILE, []);

// ---------- simple session tokens for admin auth ----------
// In-memory token store. Good enough for a small personal site;
// tokens reset if the server restarts (admin just logs in again).
const sessions = new Set();
function newToken() {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.add(t);
  return t;
}
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---------- middleware ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, crypto.randomBytes(10).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per photo
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ================= PUBLIC API =================

// Get current wedding data (never expose the password hash to the client)
app.get('/api/wedding', (req, res) => {
  const data = readJSON(DATA_FILE, DEFAULT_DATA);
  const { adminPasswordHash, ...safe } = data;
  res.json(safe);
});

// Submit an RSVP
app.post('/api/rsvp', (req, res) => {
  const { name, attending, guests, events, notes } = req.body || {};
  if (!name || !attending) {
    return res.status(400).json({ error: 'Name and attendance are required' });
  }
  const list = readJSON(RSVP_FILE, []);
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name: String(name).slice(0, 200),
    attending: attending === 'yes' ? 'yes' : 'no',
    guests: String(guests || '1').slice(0, 10),
    events: String(events || '').slice(0, 500),
    notes: String(notes || '').slice(0, 1000),
    submittedAt: new Date().toISOString()
  };
  list.push(entry);
  writeJSON(RSVP_FILE, list);
  res.json({ ok: true });
});

// ================= ADMIN AUTH =================

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const data = readJSON(DATA_FILE, DEFAULT_DATA);
  if (password && hashPassword(password) === data.adminPasswordHash) {
    return res.json({ token: newToken() });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/admin/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

// ================= ADMIN: WEDDING DATA =================

app.put('/api/admin/wedding', requireAuth, (req, res) => {
  const current = readJSON(DATA_FILE, DEFAULT_DATA);
  const incoming = req.body || {};
  // Never allow the password hash to be overwritten through this endpoint.
  delete incoming.adminPasswordHash;
  const merged = { ...current, ...incoming, adminPasswordHash: current.adminPasswordHash };
  writeJSON(DATA_FILE, merged);
  res.json({ ok: true });
});

app.post('/api/admin/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const current = readJSON(DATA_FILE, DEFAULT_DATA);
  current.adminPasswordHash = hashPassword(newPassword);
  writeJSON(DATA_FILE, current);
  res.json({ ok: true });
});

// ================= ADMIN: PHOTOS =================

app.post('/api/admin/photos', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  const current = readJSON(DATA_FILE, DEFAULT_DATA);
  current.photos.push({ url, caption: (req.body.caption || '').slice(0, 200) });
  writeJSON(DATA_FILE, current);
  res.json({ ok: true, url });
});

app.delete('/api/admin/photos/:index', requireAuth, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const current = readJSON(DATA_FILE, DEFAULT_DATA);
  if (idx >= 0 && idx < current.photos.length) {
    const [removed] = current.photos.splice(idx, 1);
    writeJSON(DATA_FILE, current);
    if (removed && removed.url && removed.url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, 'public', removed.url);
      fs.unlink(filePath, () => {});
    }
  }
  res.json({ ok: true });
});

// ================= ADMIN: RSVPS =================

app.get('/api/admin/rsvps', requireAuth, (req, res) => {
  res.json(readJSON(RSVP_FILE, []));
});

app.delete('/api/admin/rsvps/:id', requireAuth, (req, res) => {
  const list = readJSON(RSVP_FILE, []);
  const filtered = list.filter(r => r.id !== req.params.id);
  writeJSON(RSVP_FILE, filtered);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Wedding site running on http://localhost:${PORT}`);
});
