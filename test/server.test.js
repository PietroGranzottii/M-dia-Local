// Starts the real server (it needs FFmpeg on the PATH, like the app itself)
// on a separate port and temp folder, so a running instance is not touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { makeDocx } from './fixtures.js';
import { AI_LIKE_PT } from './samples.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const NO_FFMPEG_PORT = 3998;
const servers = [];

async function startServer(port, env = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'midialocal-test-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MIDIALOCAL_TMP: tmp, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  servers.push({ proc, tmp });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('Ctrl+C')) resolve(); });
    proc.on('exit', (code) => reject(new Error(`o servidor saiu com código ${code}`)));
  });
}

before(async () => {
  await Promise.all([
    startServer(PORT),
    startServer(NO_FFMPEG_PORT, { FFMPEG_PATH: 'ffmpeg-que-nao-existe', FFPROBE_PATH: 'ffprobe-que-nao-existe' }),
  ]);
});

after(async () => {
  for (const { proc, tmp } of servers) {
    proc.kill();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

async function postFile(name, body) {
  return fetch(`${BASE}/api/document`, { method: 'POST', headers: { 'X-Filename': encodeURIComponent(name) }, body });
}

async function waitDone(id) {
  for (;;) {
    const job = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
    if (job.status !== 'processing') return job;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('GET /documentos serve a página', async () => {
  const res = await fetch(`${BASE}/documentos`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Analisar documentos/);
});

test('POST /api/analyze-text devolve o relatório', async () => {
  const res = await fetch(`${BASE}/api/analyze-text`, { method: 'POST', body: JSON.stringify({ text: AI_LIKE_PT }) });
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.level, 'alto');
  assert.ok(report.indicators.length > 0);
});

test('POST /api/analyze-text recusa texto vazio e JSON inválido', async () => {
  const empty = await fetch(`${BASE}/api/analyze-text`, { method: 'POST', body: JSON.stringify({ text: '  ' }) });
  assert.equal(empty.status, 400);
  const broken = await fetch(`${BASE}/api/analyze-text`, { method: 'POST', body: '{nope' });
  assert.equal(broken.status, 400);
});

test('POST /api/document recusa extensões não aceitas', async () => {
  const res = await postFile('notas.txt', 'oi');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /DOCX ou PDF/);
});

test('POST /api/document analisa e limpa um DOCX', async () => {
  const res = await postFile('trabalho.docx', makeDocx({ paragraphs: AI_LIKE_PT.split('\n\n') }));
  assert.equal(res.status, 202);
  const { id } = await res.json();
  const job = await waitDone(id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.kind, 'document');
  assert.equal(job.result.format, 'docx');
  assert.equal(job.result.name, 'trabalho_limpo.docx');
  assert.equal(job.result.text.level, 'alto');
  assert.ok(job.result.signals.some((s) => s.message.includes('ChatGPT')));
  assert.ok(job.result.removed.length > 0);

  const download = await fetch(`${BASE}/api/download/${id}`);
  assert.equal(download.status, 200);
  const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
  assert.ok(!strFromU8(files['docProps/core.xml']).includes('Fulano'));
});

test('POST /api/document marca a tarefa como erro para DOCX inválido', async () => {
  const { id } = await (await postFile('ruim.docx', 'não é zip')).json();
  const job = await waitDone(id);
  assert.equal(job.status, 'error');
  assert.match(job.error, /DOCX corrompido/);
});

test('sem FFmpeg o site sobe, documentos funcionam e vídeos são recusados com aviso', async () => {
  const base = `http://127.0.0.1:${NO_FFMPEG_PORT}`;
  const page = await fetch(`${base}/documentos`);
  assert.equal(page.status, 200);

  const text = await fetch(`${base}/api/analyze-text`, { method: 'POST', body: JSON.stringify({ text: AI_LIKE_PT }) });
  assert.equal(text.status, 200);

  const headers = { 'X-Filename': encodeURIComponent('video.mov') };
  for (const route of ['/api/convert', '/api/clean']) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers, body: 'x' });
    assert.equal(res.status, 503, route);
    assert.match((await res.json()).error, /FFmpeg não está instalado/);
  }
});
