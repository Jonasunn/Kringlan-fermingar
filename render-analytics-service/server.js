import express from "express";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(morgan("dev"));

// ---- CORS ----
// Set ALLOWED_ORIGINS to a comma-separated list of origins you want to allow,
// e.g. "https://vefbordi.is,https://your-banner-host.com"
const allowed = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    if (allowed.includes("*")) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked for origin: " + origin));
  }
}));

// ---- DB ----
// On Render, attach a Persistent Disk and set DB_PATH to that mount,
// e.g. /var/data/data.sqlite
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  create table if not exists events (
    id integer primary key autoincrement,
    received_at text not null,
    client_ts text,
    campaign_id text,
    game_id text,
    session_id text,
    anonymous_user_id text,
    event_name text not null,
    props text
  );
  create index if not exists idx_events_event_ts on events(event_name, client_ts);
  create index if not exists idx_events_campaign on events(campaign_id);
  create index if not exists idx_events_game on events(game_id);
  create index if not exists idx_events_session on events(session_id);

  create table if not exists registrations (
    id integer primary key autoincrement,
    created_at text not null,
    session_id text,
    campaign_id text,
    game_id text,
    name text not null,
    email text not null,
    phone text not null,
    score integer,
    duration_ms integer
  );
  create index if not exists idx_regs_created on registrations(created_at);
  create index if not exists idx_regs_campaign on registrations(campaign_id);
  create index if not exists idx_regs_game on registrations(game_id);
`);

function isoNow(){ return new Date().toISOString(); }

app.get("/healthz", (_req,res)=>res.json({ok:true}));

// Minimal session id generator
app.post("/api/sessions/start", (req,res) => {
  const sid = Math.random().toString(16).slice(2) + Date.now().toString(16);
  res.json({ session_id: sid });
});

app.post("/api/events", (req,res) => {
  const events = req.body?.events;
  if (!Array.isArray(events) || events.length > 500) {
    return res.status(400).json({ error: "Invalid events batch" });
  }
  const stmt = db.prepare(`
    insert into events (received_at, client_ts, campaign_id, game_id, session_id, anonymous_user_id, event_name, props)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const received = isoNow();
  const tx = db.transaction((batch) => {
    for (const e of batch) {
      if (!e || !e.event_name) continue;
      stmt.run(
        received,
        e.client_ts || null,
        e.campaign_id || null,
        e.game_id || null,
        e.session_id || null,
        e.anonymous_user_id || null,
        String(e.event_name).slice(0, 80),
        JSON.stringify(e.props || {})
      );
    }
  });
  tx(events);
  res.json({ ok: true, ingested: events.length });
});

app.post("/api/registrations", (req,res) => {
  const { session_id, campaign_id, game_id, name, email, phone, score, duration_ms } = req.body || {};
  if (!name || !email || !phone) return res.status(400).json({ error: "Missing fields" });

  db.prepare(`
    insert into registrations (created_at, session_id, campaign_id, game_id, name, email, phone, score, duration_ms)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    isoNow(),
    session_id || null,
    campaign_id || null,
    game_id || null,
    String(name),
    String(email),
    String(phone),
    Number.isFinite(score) ? score : null,
    Number.isFinite(duration_ms) ? duration_ms : null
  );

  res.json({ ok: true });
});

app.get("/api/registrations", (req,res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const campaign = String(req.query.campaign_id || "").trim();
  const game = String(req.query.game_id || "").trim();

  let rows = db.prepare(`
    select id, created_at, session_id, campaign_id, game_id, name, email, phone, score, duration_ms
    from registrations
    order by datetime(created_at) desc
    limit 1000
  `).all();

  if (campaign) rows = rows.filter(r => (r.campaign_id || "") === campaign);
  if (game) rows = rows.filter(r => (r.game_id || "") === game);
  if (q) rows = rows.filter(r =>
    (r.name || "").toLowerCase().includes(q) ||
    (r.email || "").toLowerCase().includes(q) ||
    (r.phone || "").toLowerCase().includes(q)
  );

  res.json({ rows });
});

function dayKey(iso){
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

app.get("/api/stats", (req,res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || "28", 10), 1), 365);
  const since = new Date(Date.now() - days*24*3600*1000).toISOString();
  const campaign = String(req.query.campaign_id || "").trim();
  const game = String(req.query.game_id || "").trim();

  let ev = db.prepare(`
    select event_name, client_ts, campaign_id, game_id
    from events
    where client_ts is not null and client_ts >= ?
  `).all(since);

  let regs = db.prepare(`
    select created_at, campaign_id, game_id
    from registrations
    where created_at >= ?
  `).all(since);

  if (campaign) {
    ev = ev.filter(x => (x.campaign_id || "") === campaign);
    regs = regs.filter(x => (x.campaign_id || "") === campaign);
  }
  if (game) {
    ev = ev.filter(x => (x.game_id || "") === game);
    regs = regs.filter(x => (x.game_id || "") === game);
  }

  const byDay = new Map();
  const totals = { starts: 0, wins: 0, regs: 0, views: 0 };

  for (const r of ev) {
    const k = dayKey(r.client_ts);
    if (!byDay.has(k)) byDay.set(k, { date: k, starts: 0, wins: 0, regs: 0, views: 0 });
    const o = byDay.get(k);

    if (r.event_name === "game_start") { o.starts++; totals.starts++; }
    if (r.event_name === "win") { o.wins++; totals.wins++; }
    if (r.event_name === "banner_view" || r.event_name === "page_view") { o.views++; totals.views++; }
  }
  for (const r of regs) {
    const k = dayKey(r.created_at);
    if (!byDay.has(k)) byDay.set(k, { date: k, starts: 0, wins: 0, regs: 0, views: 0 });
    byDay.get(k).regs++;
    totals.regs++;
  }

  const series = [];
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(Date.now() - i*24*3600*1000);
    const k = dayKey(d.toISOString());
    series.push(byDay.get(k) || { date: k, starts: 0, wins: 0, regs: 0, views: 0 });
  }

  const rates = {
    winRate: totals.starts ? totals.wins / totals.starts : 0,
    regRateFromStarts: totals.starts ? totals.regs / totals.starts : 0,
    regRateFromWins: totals.wins ? totals.regs / totals.wins : 0
  };

  const funnel = [
    { label: "Views", value: totals.views },
    { label: "Starts", value: totals.starts },
    { label: "Wins", value: totals.wins },
    { label: "Registrations", value: totals.regs }
  ];

  res.json({ totals, rates, series, funnel });
});

app.get("/api/meta", (_req,res) => {
  const campaigns = db.prepare(`select distinct campaign_id from events where campaign_id is not null and campaign_id != '' order by campaign_id`).all().map(r=>r.campaign_id);
  const games = db.prepare(`select distinct game_id from events where game_id is not null and game_id != '' order by game_id`).all().map(r=>r.game_id);
  res.json({ campaigns, games });
});

// Serve dashboard UI
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));
app.get("/", (_req,res)=>res.redirect("/admin.html"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
