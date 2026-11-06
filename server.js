import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { checkFfmpeg, convertMovToMp4, cleanVideo } from './lib/video.js';
import { cleanImage } from './lib/image.js';
import { inspectDocx, cleanDocx } from './lib/docx.js';
import { inspectPdf, cleanPdf } from './lib/pdf.js';
import { analyzeText, countWords } from './lib/textstats.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const TMP = process.env.MIDIALOCAL_TMP || path.join(ROOT, 'tmp');
const PORT = Number(process.env.PORT) || 3000;
const JOB_TTL_MS = 60 * 60 * 1000;

const PAGES = { '/': 'index.html', '/limpar': 'limpar.html', '/documentos': 'documentos.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DOCUMENTS = {
  '.docx': { inspect: inspectDocx, clean: cleanDocx },
  '.pdf': { inspect: inspectPdf, clean: cleanPdf },
};
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

const jobs = new Map();

// FFmpeg is only needed for video. Without it the rest of the site still works.
const NO_FFMPEG = 'O FFmpeg não está instalado, então os vídeos estão desativados. Instale com "winget install Gyan.FFmpeg" e reinicie o MídiaLocal.';
let hasFfmpeg = true;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function rejectUpload(req, res, message, status = 400) {
  res.setHeader('Connection', 'close');
  sendJson(res, status, { error: message });
  req.destroy();
}

function uploadName(req) {
  try {
    return path.basename(decodeURIComponent(req.headers['x-filename'] || ''));
  } catch {
    return '';
  }
}

async function receiveUpload(req, ext) {
  const id = crypto.randomUUID();
  const inPath = path.join(TMP, `${id}-in${ext}`);
  await pipeline(req, createWriteStream(inPath));
  return { id, inPath };
}

function startJob(id, { inPath, outPath, outName }, work) {
  const job = { status: 'processing', progress: 0, created: Date.now(), inPath, outPath, outName };
  jobs.set(id, job);
  work((p) => { job.progress = p; })
    .then(async (result) => {
      const [inStat, outStat] = await Promise.all([fs.stat(inPath), fs.stat(outPath)]);
      Object.assign(job, {
        status: 'done',
        progress: 1,
        result: { ...result, name: outName, inputSize: inStat.size, size: outStat.size },
      });
    })
    .catch((err) => {
      console.error(`[${id}]`, err.message);
      Object.assign(job, { status: 'error', error: err.message });
      fs.rm(outPath, { force: true });
    })
    .finally(() => fs.rm(inPath, { force: true }));
}

async function handleConvert(req, res) {
  const name = uploadName(req);
  const ext = path.extname(name).toLowerCase();
  if (ext !== '.mov') return rejectUpload(req, res, 'Envie um arquivo .mov.');
  if (!hasFfmpeg) return rejectUpload(req, res, NO_FFMPEG, 503);

  const { id, inPath } = await receiveUpload(req, ext);
  const outPath = path.join(TMP, `${id}-out.mp4`);
  const outName = `${path.basename(name, path.extname(name))}.mp4`;
  startJob(id, { inPath, outPath, outName }, (onProgress) => convertMovToMp4(inPath, outPath, onProgress));
  sendJson(res, 202, { id });
}

async function handleClean(req, res) {
  const name = uploadName(req);
  const ext = path.extname(name).toLowerCase();
  const isImage = IMAGE_EXT.has(ext);
  if (!isImage && !VIDEO_EXT.has(ext)) {
    return rejectUpload(req, res, 'Formato não suportado. Use JPG, PNG, WebP, MP4, MOV, M4V, WebM ou MKV.');
  }
  if (!isImage && !hasFfmpeg) return rejectUpload(req, res, NO_FFMPEG, 503);

  const { id, inPath } = await receiveUpload(req, ext);
  const outPath = path.join(TMP, `${id}-out${ext}`);
  const outName = `${path.basename(name, path.extname(name))}_limpo${ext}`;
  startJob(id, { inPath, outPath, outName }, async (onProgress) => {
    if (!isImage) return { kind: 'video', ...(await cleanVideo(inPath, outPath, onProgress)) };
    const { data, ...report } = cleanImage(await fs.readFile(inPath));
    await fs.writeFile(outPath, data);
    return { kind: 'image', ...report };
  });
  sendJson(res, 202, { id });
}

async function handleDocument(req, res) {
  const name = uploadName(req);
  const ext = path.extname(name).toLowerCase();
  const handler = DOCUMENTS[ext];
  if (!handler) return rejectUpload(req, res, 'Formato não suportado. Use DOCX ou PDF.');
  if (Number(req.headers['content-length']) > MAX_DOCUMENT_BYTES) {
    return rejectUpload(req, res, 'Arquivo maior que 50 MB.', 413);
  }

  const { id, inPath } = await receiveUpload(req, ext);
  const outPath = path.join(TMP, `${id}-out${ext}`);
  const outName = `${path.basename(name, path.extname(name))}_limpo${ext}`;
  startJob(id, { inPath, outPath, outName }, async () => {
    const buf = await fs.readFile(inPath);
    const { text, metadata, signals } = await handler.inspect(buf);
    const { data, removed } = await handler.clean(buf);
    await fs.writeFile(outPath, data);
    const report = countWords(text) ? analyzeText(text) : null;
    return { kind: 'document', format: ext.slice(1), text: report, metadata, signals, removed };
  });
  sendJson(res, 202, { id });
}

async function handleAnalyzeText(req, res) {
  const tooBig = 'Texto grande demais (máximo de 1 MB).';
  if (Number(req.headers['content-length']) > MAX_TEXT_BYTES) return rejectUpload(req, res, tooBig, 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_TEXT_BYTES) return rejectUpload(req, res, tooBig, 413);
    chunks.push(chunk);
  }
  let text;
  try {
    ({ text } = JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return sendJson(res, 400, { error: 'JSON inválido.' });
  }
  if (typeof text !== 'string' || !text.trim()) return sendJson(res, 400, { error: 'Envie um texto para analisar.' });
  sendJson(res, 200, analyzeText(text));
}

function handleJob(res, id) {
  const job = jobs.get(id);
  if (!job) return sendJson(res, 404, { error: 'Tarefa não encontrada (talvez tenha expirado).' });
  sendJson(res, 200, { status: job.status, progress: job.progress, result: job.result, error: job.error });
}

async function handleDownload(res, id) {
  const job = jobs.get(id);
  const exists = job?.status === 'done' && (await fs.stat(job.outPath).catch(() => null));
  if (!exists) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Arquivo não disponível (o servidor foi reiniciado ou ele expirou). Converta de novo.');
  }
  const asciiName = job.outName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': job.result.size,
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(job.outName)}`,
  });
  createReadStream(job.outPath).pipe(res);
}

async function serveStatic(res, urlPath) {
  const file = PAGES[urlPath] ?? urlPath.slice(1);
  const full = path.resolve(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: 'Proibido.' });
  try {
    const body = await fs.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && pathname === '/api/convert') return await handleConvert(req, res);
    if (req.method === 'POST' && pathname === '/api/clean') return await handleClean(req, res);
    if (req.method === 'POST' && pathname === '/api/document') return await handleDocument(req, res);
    if (req.method === 'POST' && pathname === '/api/analyze-text') return await handleAnalyzeText(req, res);
    // The trailing file name is ignored by the server; it lets the browser name the download.
    const jobMatch = /^\/api\/(jobs|download)\/([\w-]+)(?:\/[^/]*)?$/.exec(pathname);
    if (req.method === 'GET' && jobMatch) {
      return jobMatch[1] === 'jobs' ? handleJob(res, jobMatch[2]) : await handleDownload(res, jobMatch[2]);
    }
    if (req.method === 'GET') return await serveStatic(res, pathname);
    sendJson(res, 405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
  }
});

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.created < cutoff && job.status !== 'processing') {
      fs.rm(job.outPath, { force: true });
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

try {
  await checkFfmpeg();
} catch {
  hasFfmpeg = false;
  console.warn('Aviso: FFmpeg/ffprobe não encontrado no PATH. Fotos e documentos funcionam, mas vídeos ficam desativados.');
  console.warn('       Para ativar os vídeos, instale com: winget install Gyan.FFmpeg  (macOS: brew install ffmpeg)');
}

const url = `http://localhost:${PORT}`;

function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const [cmd, args] = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
  }[process.platform] ?? ['xdg-open', [url]];
  // A missing opener (e.g. a Linux server without a desktop) is not an error.
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Another instance already owns the port (and the tmp folder): just point the user to it.
  console.log(`O MídiaLocal já está rodando em ${url}. Abrindo no navegador.`);
  openBrowser();
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', async () => {
  // Only wipe leftovers once this instance owns the port, so a second launch
  // never deletes files that a running instance is still serving.
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(TMP, { recursive: true });
  console.log(`MídiaLocal rodando em ${url}  (Ctrl+C para parar)`);
  openBrowser();
});
