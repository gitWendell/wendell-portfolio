import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL || 'llama3.1';
const USE_OLLAMA    = process.env.USE_OLLAMA !== 'false'; // default ON
const MAX_RETRIES   = 5;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Gemini client (fallback) ──────────────────────────────
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// ── Load system prompt ────────────────────────────────────
function loadPrompt() {
  const p = path.join(__dirname, 'prompt.txt');
  if (!fs.existsSync(p)) { console.warn('⚠️  prompt.txt not found.'); return ''; }
  return fs.readFileSync(p, 'utf-8').trim();
}

// ── Rate limiter ──────────────────────────────────────────
const requestCounts = new Map();
const LIMIT  = 20;
const WINDOW = 60 * 1000;

function rateLimit(req, res, next) {
  const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const entry = requestCounts.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  requestCounts.set(ip, entry);
  if (entry.count > LIMIT) return res.status(429).json({ error: 'Too many requests — slow down a bit!' });
  next();
}

// ── Ollama call ───────────────────────────────────────────
async function callOllama(systemPrompt, messages) {
  // Ollama /api/chat uses OpenAI-style messages directly
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: ollamaMessages,
      stream: false,
    }),
    signal: AbortSignal.timeout(60000), // 60s timeout
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.message?.content || '';
}

// ── Gemini call with retry (fallback) ─────────────────────
async function callGeminiWithRetry(systemPrompt, messages) {
  if (!gemini) throw new Error('Gemini API key not configured.');

  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1].content;

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const chat = gemini.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction: systemPrompt },
        history,
      });
      const response = await chat.sendMessage({ message: lastMessage });
      return response.text;
    } catch (err) {
      lastError = err;
      const is503 = err.message?.includes('503') || err.message?.includes('UNAVAILABLE');
      if (!is503 || attempt === MAX_RETRIES) break;
      const delay = Math.pow(2, attempt) * 500;
      console.warn(`⚠️  Gemini attempt ${attempt}/${MAX_RETRIES} failed. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ── Main AI router: Ollama → Gemini fallback ──────────────
async function callAI(systemPrompt, messages) {
  if (USE_OLLAMA) {
    try {
      console.log(`🤖 Calling Ollama (${OLLAMA_MODEL})...`);
      const text = await callOllama(systemPrompt, messages);
      console.log('✅ Ollama responded.');
      return { text, provider: 'ollama' };
    } catch (err) {
      console.warn(`⚠️  Ollama failed: ${err.message}`);
      console.warn('↩️  Falling back to Gemini...');
    }
  }

  const text = await callGeminiWithRetry(systemPrompt, messages);
  console.log('✅ Gemini responded.');
  return { text, provider: 'gemini' };
}

// ── API Route ─────────────────────────────────────────────
app.post('/api/chat', requireAccess, rateLimit, async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format.' });
  }

  try {
    const systemPrompt = loadPrompt();
    const { text, provider } = await callAI(systemPrompt, messages);
    res.json({ content: [{ text }], provider });
  } catch (err) {
    console.error('AI error:', err.message);
    res.status(500).json({ error: err.message || 'Server error. Please try again.' });
  }
});

// ── Visitor counter — persists to visitors.json ─────────────
const VISITORS_FILE = path.join(__dirname, 'visitors.json');

function loadVisitors() {
  try {
    if (fs.existsSync(VISITORS_FILE)) {
      return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf-8'));
    }
  } catch {}
  return { total: 0, days: {} };
}

function saveVisitors(data) {
  try { fs.writeFileSync(VISITORS_FILE, JSON.stringify(data, null, 2)); } catch {}
}

function recordVisit(ip) {
  const data  = loadVisitors();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (!data.days[today]) data.days[today] = new Set();

  // Convert array back to Set after JSON parse
  if (Array.isArray(data.days[today])) {
    data.days[today] = new Set(data.days[today]);
  }

  const isNew = !data.days[today].has(ip);
  if (isNew) {
    data.days[today].add(ip);
    data.total++;
  }

  // Save — Sets aren't JSON-serializable, convert to arrays
  const saveable = { total: data.total, days: {} };
  for (const [day, ips] of Object.entries(data.days)) {
    saveable.days[day] = [...ips];
  }

  // Keep only last 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  for (const day of Object.keys(saveable.days)) {
    if (new Date(day) < cutoff) delete saveable.days[day];
  }

  saveVisitors(saveable);
  return { today: data.days[today].size, total: data.total };
}

// ── Visitor API routes ────────────────────────────────────
app.get('/api/visitors', (req, res) => {
  const ip    = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const stats = recordVisit(ip);
  res.json(stats);
});

// ── Share tokens — one-time trackable referral codes ──────
// Persisted to tokens.json. Each token maps a short code (e.g. "A7K2")
// to an optional label, plus how many times its link was opened.
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
    }
  } catch {}
  return { tokens: {} };
}

function saveTokens(data) {
  try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2)); } catch {}
}

// Keep codes safe: uppercase alphanumerics only, max 12 chars.
function cleanCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

// ── Access control ────────────────────────────────────────
// OWNER_PASSCODE (from .env) is your master key: it unlocks the site
// and authorizes owner-only actions (generating/listing invites).
// Each invite (ref) also carries its own passcode for visitors.

// Owner-only guard — used for creating and listing invites.
function requireOwner(req, res, next) {
  const ownerPass = process.env.OWNER_PASSCODE;
  const given = req.headers['x-owner-pass'];
  if (ownerPass && given && given === ownerPass) return next();
  return res.status(403).json({ error: 'Owner access required.' });
}

// Access guard for the paid AI — allows the owner OR a valid ref+passcode.
// This is the real protection: no valid passcode ⇒ no LLM call ⇒ no spend.
function requireAccess(req, res, next) {
  const ownerPass  = process.env.OWNER_PASSCODE;
  const givenOwner = req.headers['x-owner-pass'];
  if (ownerPass && givenOwner && givenOwner === ownerPass) return next();

  const ref      = cleanCode(req.headers['x-ref']);
  const passcode = String(req.headers['x-passcode'] || '');
  if (ref && passcode) {
    const t = loadTokens().tokens[ref];
    if (t && t.passcode && t.passcode === passcode) return next();
  }
  return res.status(401).json({ error: 'Access denied — a valid invite passcode is required.' });
}

// The access wall calls this to validate a passcode at the door.
// A correct ref+passcode also counts as an "open" for that invite.
app.post('/api/access', (req, res) => {
  const passcode  = String(req.body?.passcode || '');
  const ownerPass = process.env.OWNER_PASSCODE;
  if (ownerPass && passcode && passcode === ownerPass) {
    return res.json({ ok: true, owner: true });
  }

  const code = cleanCode(req.body?.code);
  if (code && passcode) {
    const data = loadTokens();
    const t = data.tokens[code];
    if (t && t.passcode && t.passcode === passcode) {
      t.opens++;
      t.lastOpened = new Date().toISOString();
      data.tokens[code] = t;
      saveTokens(data);
      return res.json({ ok: true, owner: false, label: t.label });
    }
  }
  return res.status(401).json({ ok: false, error: 'Invalid passcode.' });
});

// Register a freshly generated invite: code + passcode + optional label. Owner only.
app.post('/api/token/create', requireOwner, (req, res) => {
  const code     = cleanCode(req.body?.code);
  const label    = String(req.body?.label || '').trim().slice(0, 60);
  const passcode = String(req.body?.passcode || '').trim().slice(0, 32);
  if (!code)     return res.status(400).json({ error: 'Invalid code.' });
  if (!passcode) return res.status(400).json({ error: 'A passcode is required.' });

  const data = loadTokens();
  if (!data.tokens[code]) {
    data.tokens[code] = { label, passcode, created: new Date().toISOString(), opens: 0, lastOpened: null };
  } else {
    if (label) data.tokens[code].label = label;
    data.tokens[code].passcode = passcode;
  }
  saveTokens(data);
  res.json({ ok: true, code, label: data.tokens[code].label, passcode });
});

// List all invites (with passcodes + open counts), most-recent first. Owner only.
app.get('/api/token/list', requireOwner, (req, res) => {
  const data = loadTokens();
  const list = Object.entries(data.tokens)
    .map(([code, t]) => ({ code, ...t }))
    .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || '') || b.opens - a.opens);
  res.json({ tokens: list });
});

// ── Status route — see which provider is active ───────────
app.get('/api/status', async (req, res) => {
  let ollamaOnline = false;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    ollamaOnline = r.ok;
  } catch {}

  res.json({
    ollama: { online: ollamaOnline, model: OLLAMA_MODEL, url: OLLAMA_URL },
    gemini: { configured: !!process.env.GEMINI_API_KEY },
    active: ollamaOnline && USE_OLLAMA ? 'ollama' : 'gemini',
  });
});

// ── Catch-all ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`\n✅  Wendell's portfolio running at http://localhost:${PORT}`);
  console.log(`📝  System prompt: prompt.txt`);

  // Check Ollama on startup
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const tags = await r.json();
      const models = tags.models?.map(m => m.name).join(', ') || 'none pulled yet';
      console.log(`🤖  Ollama online  → using ${OLLAMA_MODEL}`);
      console.log(`📦  Available models: ${models}`);
    } else {
      console.log(`☁️   Ollama offline → falling back to Gemini`);
    }
  } catch {
    console.log(`☁️   Ollama offline → falling back to Gemini`);
  }
  console.log(`🔍  Check status:  http://localhost:${PORT}/api/status\n`);
});
