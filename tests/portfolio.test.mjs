import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const origin = 'http://127.0.0.1:3021';
let child;
test.before(async () => {
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3021', USE_OLLAMA: 'false', KEEP_ALIVE: 'false', OLLAMA_URL: 'http://127.0.0.1:1', OWNER_PASSCODE: '', GEMINI_API_KEY: '', FALLBACK_API_KEY: '', FALLBACK_API_URL: '', FALLBACK_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview server did not start')), 10000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('portfolio running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
  });
});
test.after(async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } });

test('the homepage gives clients useful content without a passcode or AI request', async () => {
  const r = await fetch(origin); const html = await r.text();
  assert.equal(r.status, 200);
  for (const content of ['Connected systems.', 'Connect your systems', 'IT requests, with a clearer route.', 'mailto:casulwendell12@gmail.com', 'Learning goals, separate']) assert.ok(html.includes(content), content);
  assert.ok(!html.includes('id="access-overlay"'));
  assert.ok(!html.includes('wendellcasul.dev'));
});
test('the AI guide retains its invite screen and a route back to the homepage', async () => {
  const r = await fetch(`${origin}/explore.html`); const html = await r.text();
  assert.equal(r.status, 200);
  assert.ok(html.includes('id="access-overlay"'));
  assert.ok(html.includes('This AI guide is invite-only.'));
  assert.ok(html.includes('View the portfolio homepage'));
});
test('the public homepage does not grant access to paid AI or owner invite tools', async () => {
  const chat = await fetch(`${origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{role:'user',content:'Hello'}] }) });
  assert.equal(chat.status, 401);
  assert.equal((await fetch(`${origin}/api/token/list`)).status, 403);
  const token = await fetch(`${origin}/api/token/create`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'QA12',passcode:'test-only'}) });
  assert.equal(token.status, 403);
});
test('scripts parse and the homepage assets are served with the right types', async () => {
  const html = await readFile(new URL('../public/explore.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  new Script(await readFile(new URL('../public/home.js', import.meta.url), 'utf8'));
  for (const [path,type] of [['/home.css','text/css'],['/home.js','javascript'],['/favicon.svg','image/svg+xml'],['/social-card.png','image/png']]) {
    const r = await fetch(origin+path); assert.equal(r.status,200); assert.ok(r.headers.get('content-type').includes(type));
  }
});
