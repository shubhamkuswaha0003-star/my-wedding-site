const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable. Set it in Render → Environment.');
  process.exit(1);
}

let db;
const client = new MongoClient(MONGODB_URI);

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const DEFAULT_DATA = {
  _id: 'wedding',
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
  adminPasswordHash: hashPassword("wedding2026")
};

async function getWeddingDoc() {
  const doc = await db.collection('site').findOne({ _id: 'wedding' });
  if (doc) return doc;
  await db.collection('site').insertOne(DEFAULT_DATA);
  return DEFAULT_DATA;
}
async function saveWeddingDoc(data) {
  const { _id, ...rest } = data;
  await db.collection('site').updateOne({ _id: 'wedding' }, { $set: rest }, { upsert: true });
}

// ---------- simple in-memory admin session tokens ----------
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

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// Photos are stored as base64 in MongoDB (not on local disk), so they
// survive restarts too. 8MB limit keeps documents well under Mongo's 16MB cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ================= PUBLIC API =================

app.get('/api/wedding', async (req, res) => {
  try {
    const data = await getWeddingDoc();
    const { adminPasswordHash, _id, ...safe } = data;
    res.json(safe);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load site data' });
  }
});

app.post('/api/rsvp', async (req, res) => {
  const { name, attending, guests, events, notes } = req.body || {};
  if (!name || !attending) {
    return res.status(400).json({ error: 'Name and attendance are required' });
  }
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name: String(name).slice(0, 200),
    attending: attending === 'yes' ? 'yes' : 'no',
    guests: String(guests || '1').slice(0, 10),
    events: String(events || '').slice(0, 500),
    notes: String(notes || '').slice(0, 1000),
    submittedAt: new Date().toISOString()
  };
  try {
    await db.collection('rsvps').insertOne(entry);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save RSVP' });
  }
});

// ================= ADMIN AUTH =================

app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body || {};
  const data = await getWeddingDoc();
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

app.put('/api/admin/wedding', requireAuth, async (req, res) => {
  try {
    const current = await getWeddingDoc();
    const incoming = req.body || {};
    delete incoming.adminPasswordHash;
    delete incoming._id;
    const merged = { ...current, ...incoming, adminPasswordHash: current.adminPasswordHash };
    await saveWeddingDoc(merged);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save changes' });
  }
});

app.post('/api/admin/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const current = await getWeddingDoc();
  current.adminPasswordHash = hashPassword(newPassword);
  await saveWeddingDoc(current);
  res.json({ ok: true });
});

// ================= ADMIN: PHOTOS =================

app.post('/api/admin/photos', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const base64 = req.file.buffer.toString('base64');
    const url = `data:${req.file.mimetype};base64,${base64}`;
    const current = await getWeddingDoc();
    current.photos.push({ url, caption: (req.body.caption || '').slice(0, 200) });
    await saveWeddingDoc(current);
    res.json({ ok: true, url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/api/admin/photos/:index', requireAuth, async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const current = await getWeddingDoc();
  if (idx >= 0 && idx < current.photos.length) {
    current.photos.splice(idx, 1);
    await saveWeddingDoc(current);
  }
  res.json({ ok: true });
});

// ================= ADMIN: RSVPS =================

app.get('/api/admin/rsvps', requireAuth, async (req, res) => {
  const list = await db.collection('rsvps').find({}).toArray();
  res.json(list.map(({ _id, ...rest }) => rest));
});

app.delete('/api/admin/rsvps/:id', requireAuth, async (req, res) => {
  await db.collection('rsvps').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

// ================= START =================

async function start() {
  await client.connect();
  db = client.db('wedding');
  await getWeddingDoc(); // ensures default doc exists
  app.listen(PORT, () => {
    console.log(`Wedding site running on port ${PORT}, connected to MongoDB`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
