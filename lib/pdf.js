// PDF metadata lives in the Info dictionary and in an XMP stream referenced by
// the catalog. Cleaning drops both and rewrites the whole file, so no stale
// copy survives the way it would with an incremental update.
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scanBuffer } from './scan.js';

const INFO_FIELDS = [
  ['Title', 'Título'],
  ['Author', 'Autor'],
  ['Subject', 'Assunto'],
  ['Keywords', 'Palavras-chave'],
  ['Creator', 'Criado com'],
  ['Producer', 'Gerado por'],
  ['CreationDate', 'Criado em'],
  ['ModDate', 'Modificado em'],
];

const PASSWORD_ERROR = 'PDF protegido por senha; não é possível analisar.';
const INVALID_ERROR = 'PDF corrompido ou inválido.';

function formatPdfDate(raw) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return raw;
  const [, y, mo = '01', d = '01', h, mi] = m;
  return h ? `${y}-${mo}-${d} ${h}:${mi ?? '00'}` : `${y}-${mo}-${d}`;
}

function xmpCreatorTool(raw) {
  return /<xmp:CreatorTool>([^<]*)</.exec(raw)?.[1] ?? /xmp:CreatorTool="([^"]*)"/.exec(raw)?.[1] ?? null;
}

async function openPdf(buf) {
  // pdf.js takes ownership of the array it receives, so it gets a copy.
  const task = getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false });
  try {
    return { task, pdf: await task.promise };
  } catch (err) {
    await task.destroy();
    throw new Error(err?.name === 'PasswordException' ? PASSWORD_ERROR : INVALID_ERROR);
  }
}

async function extractText(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
    page.cleanup();
  }
  // PDF lines are layout, not paragraphs: join them into one flowing text.
  return pages
    .join('\n')
    .replace(/-\n(?=\p{Ll})/gu, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export async function inspectPdf(buf) {
  const { task, pdf } = await openPdf(buf);
  try {
    const { info, metadata: xmp } = await pdf.getMetadata();
    const metadata = [];
    const values = [];
    for (const [key, label] of INFO_FIELDS) {
      const value = info?.[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      values.push(value);
      metadata.push({ label, value: key.endsWith('Date') ? formatPdfDate(value) : value.trim() });
    }
    const raw = xmp?.getRaw?.() ?? '';
    const tool = xmpCreatorTool(raw);
    if (tool) metadata.push({ label: 'Ferramenta (XMP)', value: tool });

    const signals = scanBuffer(Buffer.from([...values, raw].join('\n'), 'utf8'))
      .map((label) => ({ level: 'warn', message: `Marcador de IA nos metadados: ${label}` }));

    const text = await extractText(pdf);
    if (!text) {
      signals.push({ level: 'info', message: 'PDF sem texto extraível (provavelmente escaneado): só os metadados foram analisados.' });
    }
    return { text, metadata, signals };
  } finally {
    await task.destroy();
  }
}

export async function cleanPdf(buf) {
  let doc;
  try {
    doc = await PDFDocument.load(buf, { updateMetadata: false });
  } catch (err) {
    throw new Error(/encrypted/i.test(err.message) ? PASSWORD_ERROR : INVALID_ERROR);
  }

  const removed = [];
  const { context, catalog } = doc;
  if (context.trailerInfo.Info) {
    const getters = {
      Title: () => doc.getTitle(),
      Author: () => doc.getAuthor(),
      Subject: () => doc.getSubject(),
      Keywords: () => doc.getKeywords(),
      Creator: () => doc.getCreator(),
      Producer: () => doc.getProducer(),
      CreationDate: () => doc.getCreationDate(),
      ModDate: () => doc.getModificationDate(),
    };
    for (const [key, label] of INFO_FIELDS) {
      let value;
      try { value = getters[key](); } catch { value = undefined; }
      if (value instanceof Date) value = value.toISOString().slice(0, 16).replace('T', ' ');
      if (value) removed.push({ field: label, value: String(value) });
    }
    const infoRef = context.trailerInfo.Info;
    if (infoRef instanceof PDFRef) context.delete(infoRef);
    context.trailerInfo.Info = undefined;
  }

  const xmpRef = catalog.get(PDFName.of('Metadata'));
  if (xmpRef) {
    removed.push({ field: 'Metadados XMP', value: '' });
    if (xmpRef instanceof PDFRef) context.delete(xmpRef);
    catalog.delete(PDFName.of('Metadata'));
  }

  return { data: Buffer.from(await doc.save()), removed };
}
