import { upload, waitForJob, setupDropZone, createCard, downloadLink, row, extOf, formatBytes } from './shared.js';

const MODE = document.body.dataset.mode;
const ENDPOINT = MODE === 'convert' ? '/api/convert' : '/api/clean';
const ALLOWED = MODE === 'convert'
  ? ['.mov']
  : ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.m4v', '.webm', '.mkv'];

const queue = document.getElementById('queue');
let chain = Promise.resolve();

setupDropZone(document.getElementById('drop'), document.getElementById('picker'), addFiles);

function addFiles(files) {
  for (const file of files) {
    const card = createCard(queue, file.name, formatBytes(file.size));
    const ext = extOf(file.name);
    if (!ALLOWED.includes(ext)) {
      card.fail(`Formato ${ext || 'desconhecido'} não é aceito nesta página.`);
      continue;
    }
    // One file at a time keeps FFmpeg from fighting itself for CPU.
    chain = chain.then(() => processFile(file, card));
  }
}

async function processFile(file, card) {
  try {
    card.progress('Enviando', 0);
    const { id } = await upload(ENDPOINT, file, (p) => card.progress('Enviando', p));
    card.progress('Processando', 0);
    const result = await waitForJob(id, (p) => card.progress('Processando', p));
    card.finish();
    card.body.append(...(MODE === 'convert' ? convertReport(result) : cleanReport(result)), downloadLink(id, result.name));
  } catch (err) {
    card.fail(err.message);
  }
}

function convertReport(r) {
  const codecs = [r.videoCodec, ...r.audioCodecs].map((c) => c.toUpperCase()).join(' + ');
  const lines = [];
  if (r.mode === 'remux') {
    lines.push(row('badge ok', 'Sem recompressão', `Vídeo e áudio copiados bit a bit (${codecs}).`));
  } else {
    const parts = [];
    if (r.videoReencoded) parts.push(`o vídeo ${r.videoCodec.toUpperCase()} foi recodificado em ${r.encoder}, visualmente sem perdas`);
    else parts.push('o vídeo foi copiado sem recompressão');
    if (r.audioReencoded) parts.push('o áudio foi convertido para AAC 320 kbps');
    lines.push(row('badge warn', 'Recodificado', `O codec original não é compatível com MP4: ${parts.join('; ')}.`));
  }
  lines.push(row('badge', 'Tamanho', `${formatBytes(r.inputSize)} → ${formatBytes(r.size)}`));
  return lines;
}

function cleanReport(r) {
  const lines = [];
  lines.push(r.hintsBefore.length
    ? row('badge warn', 'Rótulos de IA encontrados', null, r.hintsBefore)
    : row('badge', 'Rótulos de IA', 'Nenhum indício de IA nos metadados originais.'));
  lines.push(r.removed.length
    ? row('badge', 'Metadados removidos', null, r.removed)
    : row('badge', 'Metadados removidos', 'O arquivo já não tinha metadados extras.'));
  lines.push(r.hintsAfter.length
    ? row('badge error', 'Ainda presente', null, r.hintsAfter)
    : row('badge ok', 'Verificação final', 'Nenhum rótulo de IA restante. Pixels e áudio intactos.'));
  if (r.orientationKept) lines.push(row('badge', 'Rotação', 'A orientação da foto foi preservada.'));
  lines.push(row('badge', 'Tamanho', `${formatBytes(r.inputSize)} → ${formatBytes(r.size)}`));
  return lines;
}
