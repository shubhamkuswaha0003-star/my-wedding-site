# Our Wedding — website

A wedding website with a live itinerary, RSVP form, venue info, photo gallery,
and a password-protected admin page for editing everything.

Guests always see the latest itinerary at your one shared link — no
re-sending invites when a plan changes.

## What's inside

- `server.js` — the backend (Express). Serves the site and a small API.
- `public/index.html` — the whole frontend (guest view + admin view in one file).
- `data/` — created automatically on first run. Stores your wedding details
  and guest RSVPs as JSON files. **Do not delete this folder** once you're live.
- `public/uploads/` — stores uploaded photos.

## Running it locally (to test before deploying)

```
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

Go to `http://localhost:3000#admin` to log in to the admin panel.

**Default admin password: `wedding2026`**
Change this immediately from inside the admin panel (there's a
"Change admin password" button) once you're set up.

## Deploying so guests can actually use it

This is a real Node.js server (not a static site), so it needs a host that
runs Node — Netlify/GitHub Pages won't work for this. Two free, easy options:

### Option 1 — Render (recommended, easiest)

1. Create a free account at render.com
2. Push this folder to a GitHub repository (see below if you're not familiar with git)
3. In Render: New → Web Service → connect your repo
4. Build command: `npm install`
5. Start command: `npm start`
6. Click deploy. Render gives you a URL like `https://your-wedding.onrender.com`
   — that's the link you share with guests.

Note: Render's free tier "sleeps" the app after inactivity, so the first
visit after a while takes ~30 seconds to wake up. Fine for a wedding site.

**Important on Render's free tier**: its filesystem is not persistent across
deploys/restarts, so your `data/` folder (RSVPs, itinerary edits, photos)
can reset. For a wedding site where RSVPs matter, either:
- Upgrade to Render's smallest paid instance with a persistent disk (a few
  dollars/month), or
- Use Railway instead (see below), which handles this more simply.

### Option 2 — Railway

1. Create a free account at railway.app
2. New Project → Deploy from GitHub repo (push this folder to GitHub first)
3. Railway auto-detects Node and runs `npm start`
4. Add a Volume (Railway's persistent storage) mounted at `/app/data` and
   another at `/app/public/uploads` so your data survives restarts
5. Railway gives you a public URL to share with guests

### If you're not familiar with git/GitHub

Tell me and I'll walk you through pushing this folder to a new GitHub
repository step by step — it's the one prerequisite both hosting options need.

## Security notes

- The admin password is never stored in plain text (it's hashed).
- Only the admin (logged in) can edit the itinerary, venue, photos, or see/delete RSVPs.
- Anyone with the link can submit an RSVP — that's expected, it's how guests respond.
