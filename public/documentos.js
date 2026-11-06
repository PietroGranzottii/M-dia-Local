import { upload, waitForJob, setupDropZone, createCard, downloadLink, row, el, extOf, formatBytes } from './shared.js';

const queue = document.getElementById('queue');
const form = document.getElementById('paste');
const textarea = document.getElementById('paste-text');
let chain = Promise.resolve();

const LEVEL_BADGE = { baixo: 'badge ok', médio: 'badge warn', alto: 'badge error' };

setupDropZone(document.getElementById('drop'), document.getElementById('picker'), addFiles);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = textarea.value;
  if (!text.trim()) return textarea.focus();
  const card = createCard(queue, 'Texto colado', `${text.length.toLocaleString('pt-BR')} caracteres`);
  chain = chain.then(() => analyzePasted(text, card));
});

function addFiles(files) {
  for (const file of files) {
    const card = createCard(queue, file.name, formatBytes(file.size));
    const ext = extOf(file.name);
    if (ext === '.txt') chain = chain.then(() => analyzeTxt(file, card));
    else if (ext === '.docx' || ext === '.pdf') chain = chain.then(() => analyzeDocument(file, card));
    else card.fail(`Formato ${ext || 'desconhecido'} não é aceito nesta página.`);
  }
}

async function analyzeTxt(file, card) {
  try {
    card.progress('Lendo');
    await analyzePasted(await file.text(), card);
  } catch (err) {
    card.fail(err.message);
  }
}

async function analyzePasted(text, card) {
  try {
    card.progress('Analisando');
    const res = await fetch('/api/analyze-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    card.finish();
    card.body.append(...textReport(body));
  } catch (err) {
    card.fail(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Ele ainda está rodando?' : err.message);
  }
}

async function analyzeDocument(file, card) {
  try {
    card.progress('Enviando', 0);
    const { id } = await upload('/api/document', file, (p) => card.progress('Enviando', p));
    card.progress('Analisando');
    const result = await waitForJob(id, () => card.progress('Analisando'));
    card.finish();
    card.body.append(...documentReport(result), downloadLink(id, result.name));
  } catch (err) {
    card.fail(err.message);
  }
}

function textReport(r) {
  const parts = [scoreMeter(r)];
  if (r.short) {
    parts.push(row('badge warn', 'Texto curto', `Só ${r.words} palavras: abaixo de 150 o resultado é pouco confiável.`));
  }
  parts.push(indicatorList(r.indicators));
  parts.push(r.phrases.length
    ? row('badge', 'Expressões encontradas', null, r.phrases.map((p) => `${p.phrase} ×${p.count}`))
    : row('badge', 'Expressões', 'Nenhuma expressão típica de IA encontrada.'));
  return parts;
}

function scoreMeter(r) {
  const box = el('div', 'meter');
  const head = el('div', 'meter-head');
  head.append(
    el('span', 'meter-score', String(r.score)),
    el('span', LEVEL_BADGE[r.level], `Indícios de estilo de IA: ${r.level}`),
    el('span', 'row-text', `${r.words} palavras · ${r.language === 'en' ? 'inglês' : 'português'}`),
  );
  const bar = el('div', 'meter-bar');
  const fill = el('span');
  fill.style.width = `${r.score}%`;
  fill.dataset.level = r.level;
  bar.append(fill);
  box.append(head, bar);
  return box;
}

function indicatorList(indicators) {
  const list = el('ul', 'indicators');
  for (const i of indicators) {
    const li = el('li');
    const head = el('div', 'indicator-head');
    head.append(el('span', 'indicator-label', i.label), el('span', 'indicator-score', `${i.score}/100`));
    const bar = el('div', 'indicator-bar');
    const fill = el('span');
    fill.style.width = `${i.score}%`;
    bar.append(fill);
    li.append(head, bar, el('p', 'indicator-detail', i.detail));
    list.append(li);
  }
  return list;
}

function documentReport(r) {
  const parts = r.text
    ? textReport(r.text)
    : [row('badge', 'Texto', 'Não há texto para analisar no documento.')];

  for (const s of r.signals) {
    parts.push(row(s.level === 'warn' ? 'badge warn' : 'badge', s.level === 'warn' ? 'Alerta' : 'Info', s.message));
  }

  if (r.metadata.length) {
    const details = el('details', 'meta');
    details.append(el('summary', null, 'Metadados originais'));
    const dl = el('dl');
    for (const m of r.metadata) dl.append(el('dt', null, m.label), el('dd', null, m.value));
    details.append(dl);
    parts.push(details);
  }

  parts.push(r.removed.length
    ? row('badge ok', 'Removido na cópia limpa', null, r.removed.map((x) => (x.value ? `${x.field}: ${x.value}` : x.field)))
    : row('badge ok', 'Cópia limpa', 'O arquivo já não tinha metadados extras.'));
  parts.push(row('badge', 'Tamanho', `${formatBytes(r.inputSize)} → ${formatBytes(r.size)}`));
  return parts;
}
