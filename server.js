'use strict';
/**
 * Quizzy – zelfstandige live quiz (Kahoot-stijl)
 * Eén dependency: ws. Spelers hebben geen account nodig.
 * Alle logica (tijd, scores, goede antwoorden) draait op de server.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const QUIZ_FILE = path.join(DATA_DIR, 'quiz.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''; // bv. https://quiz.example.nl (optioneel)
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 300;

let HOST_PASSWORD = process.env.HOST_PASSWORD;
if (!HOST_PASSWORD) {
  HOST_PASSWORD = crypto.randomBytes(4).toString('hex');
  console.log('Geen HOST_PASSWORD ingesteld. Tijdelijk host-wachtwoord: ' + HOST_PASSWORD);
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const passOk = (pw) => crypto.timingSafeEqual(sha(pw), sha(HOST_PASSWORD));

/* ---------------- statische bestanden ---------------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end('index.html ontbreekt'); }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('Niet gevonden');
});

/* ---------------- hulpfuncties ---------------- */
function cleanQuiz(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return { error: 'Ongeldige quiz.' };
  if (raw.questions.length < 1) return { error: 'Voeg minstens één vraag toe.' };
  if (raw.questions.length > 100) return { error: 'Maximaal 100 vragen.' };
  const qs = [];
  for (let n = 0; n < raw.questions.length; n++) {
    const x = raw.questions[n] || {};
    const text = String(x.q || '').trim().slice(0, 200);
    const src = Array.isArray(x.o) ? x.o.slice(0, 4) : [];
    const opts = []; let c = -1;
    src.forEach((o, i) => { const t = String(o || '').trim().slice(0, 80); if (t) { if (i === x.c) c = opts.length; opts.push(t); } });
    if (!text) return { error: 'Vraag ' + (n + 1) + ' heeft nog geen vraagtekst.' };
    if (opts.length < 2) return { error: 'Vraag ' + (n + 1) + ' heeft minstens 2 antwoorden nodig.' };
    if (c < 0) return { error: 'Bij vraag ' + (n + 1) + ' is het goede antwoord leeg.' };
    let t = Math.round(Number(x.t)); if (!(t >= 5 && t <= 120)) t = 20;
    qs.push({ q: text, o: opts, c, t });
  }
  return { quiz: { title: String(raw.title || '').trim().slice(0, 80) || 'Quiz', questions: qs } };
}
function loadQuiz() {
  try { const r = cleanQuiz(JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8'))); return r.quiz || null; } catch (e) { return null; }
}
function saveQuiz(q) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(QUIZ_FILE, JSON.stringify(q, null, 2)); return true; }
  catch (e) { console.error('Quiz opslaan mislukt:', e.message); return false; }
}
const points = (ms, t) => Math.round(1000 * (1 - Math.min(1, Math.max(0, ms / (t * 1000))) / 2));
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const token = () => crypto.randomBytes(16).toString('hex');

/* ---------------- spelstatus ---------------- */
const games = new Map();
function newPin() {
  for (;;) { const p = String(100000 + crypto.randomInt(900000)); if (!games.has(p)) return p; }
}
function createGame(quiz) {
  const g = {
    pin: newPin(), hostToken: token(), hostWs: null, title: quiz.title, qs: quiz.questions,
    status: 'lobby', qi: -1, qStart: 0, correct: null, dist: [], board: [],
    players: new Map(), timer: null, last: Date.now()
  };
  games.set(g.pin, g);
  return g;
}
const connected = (g) => [...g.players.values()].filter((p) => p.ws && p.ws.readyState === 1);
const answeredCount = (g) => [...g.players.values()].filter((p) => p.answers[g.qi]).length;
const leftMs = (g) => Math.max(0, g.qStart + g.qs[g.qi].t * 1000 - Date.now());
const qPublic = (g) => { const q = g.qs[g.qi]; return { q: q.q, o: q.o, t: q.t }; };

function computeBoard(g) {
  const board = [];
  for (const [tk, p] of g.players) {
    let total = 0, delta = 0, ok = false;
    for (let k = 0; k <= g.qi; k++) {
      const a = p.answers[k];
      if (a && a.c === g.qs[k].c) { const pts = points(a.ms, g.qs[k].t); total += pts; if (k === g.qi) { delta = pts; ok = true; } }
    }
    p.score = total; p.delta = delta; p.ok = ok;
    board.push({ tk, n: p.name, s: total, d: delta, ok });
  }
  board.sort((a, b) => b.s - a.s);
  g.board = board;
}

function hostView(g) {
  const v = { t: 'state', role: 'host', status: g.status, pin: g.pin, title: g.title, total: g.qs.length, qi: g.qi,
    players: [...g.players.values()].map((p) => p.name) };
  if (g.status === 'question') { v.q = qPublic(g); v.left = leftMs(g); v.answered = answeredCount(g); }
  if (g.status === 'reveal') { v.q = qPublic(g); v.correct = g.correct; v.dist = g.dist; v.board = g.board.slice(0, 5).map(({ n, s, d, ok }) => ({ n, s, d, ok })); v.last = g.qi >= g.qs.length - 1; }
  if (g.status === 'finished') v.board = g.board.map(({ n, s }) => ({ n, s }));
  return v;
}
function playerView(g, tk, p) {
  const v = { t: 'state', role: 'player', status: g.status, title: g.title, total: g.qs.length, qi: g.qi, name: p.name };
  const a = g.qi >= 0 ? p.answers[g.qi] : null;
  if (g.status === 'question') { v.q = qPublic(g); v.left = leftMs(g); v.choice = a ? a.c : null; }
  if (g.status === 'reveal') {
    const rank = g.board.findIndex((b) => b.tk === tk);
    Object.assign(v, { q: qPublic(g), correct: g.correct, choice: a ? a.c : null, ok: p.ok, delta: p.delta, score: p.score, rank: rank + 1, of: g.board.length });
  }
  if (g.status === 'finished') {
    const rank = g.board.findIndex((b) => b.tk === tk);
    Object.assign(v, { score: p.score, rank: rank + 1, of: g.board.length, board: g.board.slice(0, 5).map(({ n, s }) => ({ n, s })) });
  }
  return v;
}
function pushHost(g) { g.last = Date.now(); send(g.hostWs, hostView(g)); }
function pushPlayer(g, tk) { const p = g.players.get(tk); if (p) send(p.ws, playerView(g, tk, p)); }
function pushAll(g) { pushHost(g); for (const tk of g.players.keys()) pushPlayer(g, tk); }

function startQuestion(g) {
  g.qi += 1; g.status = 'question'; g.qStart = Date.now(); g.correct = null; g.dist = [];
  clearTimeout(g.timer);
  g.timer = setTimeout(() => reveal(g), g.qs[g.qi].t * 1000 + 500);
  pushAll(g);
}
function reveal(g) {
  if (g.status !== 'question') return;
  clearTimeout(g.timer);
  computeBoard(g);
  const q = g.qs[g.qi];
  g.dist = q.o.map(() => 0);
  for (const p of g.players.values()) { const a = p.answers[g.qi]; if (a && a.c < g.dist.length) g.dist[a.c]++; }
  g.correct = q.c; g.status = 'reveal';
  pushAll(g);
}
function nextStep(g) {
  if (g.status !== 'lobby' && g.status !== 'reveal') return;
  if (g.qi + 1 >= g.qs.length) { computeBoard(g); g.status = 'finished'; pushAll(g); return; }
  startQuestion(g);
}
function closeGame(g) {
  clearTimeout(g.timer);
  for (const p of g.players.values()) send(p.ws, { t: 'closed' });
  games.delete(g.pin);
}

/* ---------------- websockets ---------------- */
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
const fails = new Map(); // ip -> {n, until}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

wss.on('connection', (ws, req) => {
  if (ALLOWED_ORIGIN && req.headers.origin !== ALLOWED_ORIGIN) return ws.close(1008, 'origin');
  ws.alive = true; ws.isHost = false; ws.game = null; ws.tk = null; ws.ip = ipOf(req); ws.msgs = 0;
  ws.on('pong', () => { ws.alive = true; });
  const rate = setInterval(() => { ws.msgs = 0; }, 1000);
  ws.on('close', () => {
    clearInterval(rate);
    const g = ws.game; if (!g) return;
    if (g.hostWs === ws) g.hostWs = null;
    if (ws.tk) { const p = g.players.get(ws.tk); if (p && p.ws === ws) { p.ws = null; pushHost(g); } }
  });
  ws.on('message', (data) => {
    if (++ws.msgs > 30) return;
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { t: 'error', msg: 'Er ging iets mis op de server.' }); }
  });
});

function handle(ws, m) {
  const err = (msg, code) => send(ws, { t: 'error', msg, code });
  switch (m.t) {
    /* ----- host ----- */
    case 'hostAuth': {
      const f = fails.get(ws.ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return err('Te veel pogingen. Probeer het over een paar minuten opnieuw.');
      if (!passOk(m.pw || '')) {
        f.n += 1; if (f.n >= 5) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0; }
        fails.set(ws.ip, f); return err('Verkeerd wachtwoord.');
      }
      fails.delete(ws.ip); ws.isHost = true;
      return send(ws, { t: 'hostOk', quiz: loadQuiz() });
    }
    case 'saveQuiz': {
      if (!ws.isHost) return err('Niet ingelogd als host.');
      const r = cleanQuiz(m.quiz); if (r.error) return err(r.error);
      return send(ws, { t: 'saved', ok: saveQuiz(r.quiz), quiz: r.quiz });
    }
    case 'create': {
      if (!ws.isHost) return err('Niet ingelogd als host.');
      const r = cleanQuiz(m.quiz); if (r.error) return err(r.error);
      saveQuiz(r.quiz);
      const g = createGame(r.quiz); g.hostWs = ws; ws.game = g;
      send(ws, { t: 'hosting', pin: g.pin, hostToken: g.hostToken });
      return pushHost(g);
    }
    case 'hostResume': {
      const g = games.get(String(m.pin));
      if (!g || typeof m.hostToken !== 'string' || m.hostToken !== g.hostToken) return err('Spel niet gevonden.', 'nogame');
      g.hostWs = ws; ws.game = g; ws.isHost = true;
      send(ws, { t: 'hosting', pin: g.pin, hostToken: g.hostToken });
      return pushHost(g);
    }
    case 'start': case 'next': case 'reveal': case 'close': {
      const g = ws.game; if (!g || g.hostWs !== ws) return;
      if (m.t === 'start') { if (g.status === 'lobby' && g.players.size > 0) nextStep(g); }
      else if (m.t === 'next') nextStep(g);
      else if (m.t === 'reveal') reveal(g);
      else { closeGame(g); ws.game = null; send(ws, { t: 'closed' }); }
      return;
    }
    /* ----- speler ----- */
    case 'join': {
      const g = games.get(String(m.pin));
      if (!g) return err('Geen spel gevonden met deze pincode.', 'nogame');
      let tk = typeof m.token === 'string' ? m.token : null;
      let p = tk && g.players.get(tk);
      if (p) { if (p.ws && p.ws !== ws) { p.ws.game = null; try { p.ws.close(); } catch (e) {} } p.ws = ws; }
      else {
        if (g.players.size >= MAX_PLAYERS) return err('Dit spel zit vol.');
        let name = String(m.name || '').trim().slice(0, 20);
        if (!name) return err('Vul een naam in.');
        const taken = new Set([...g.players.values()].map((x) => x.name.toLowerCase()));
        let base = name, i = 2; while (taken.has(name.toLowerCase())) name = base + ' (' + (i++) + ')';
        tk = token(); p = { name, ws, answers: {}, score: 0, delta: 0, ok: false };
        g.players.set(tk, p);
      }
      ws.game = g; ws.tk = tk;
      send(ws, { t: 'joined', token: tk, pin: g.pin, name: p.name });
      pushPlayer(g, tk); return pushHost(g);
    }
    case 'leave': {
      const g = ws.game; if (!g || !ws.tk) return;
      if (g.status === 'lobby') g.players.delete(ws.tk);
      ws.game = null; ws.tk = null; return pushHost(g);
    }
    case 'answer': {
      const g = ws.game; if (!g || !ws.tk || g.status !== 'question') return;
      const p = g.players.get(ws.tk); if (!p || p.answers[g.qi]) return;
      const q = g.qs[g.qi], c = Number(m.c);
      if (!Number.isInteger(c) || c < 0 || c >= q.o.length) return;
      const ms = Date.now() - g.qStart; if (ms > q.t * 1000 + 700) return;
      p.answers[g.qi] = { c, ms };
      pushPlayer(g, ws.tk); pushHost(g);
      const online = connected(g);
      if (online.length && online.every((x) => x.answers[g.qi])) setTimeout(() => reveal(g), 400);
      return;
    }
  }
}

/* ---------------- onderhoud ---------------- */
setInterval(() => { wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }); }, 30000);
setInterval(() => { for (const g of games.values()) if (Date.now() - g.last > 6 * 3600 * 1000) closeGame(g); }, 15 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => console.log('Quizzy draait op http://localhost:' + PORT));
module.exports = { server, wss };
