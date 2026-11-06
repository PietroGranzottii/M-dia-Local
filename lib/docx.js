// DOCX is a ZIP of XML parts. Metadata lives in docProps/ and in the rsid
// (revision save id) records; the document body is never modified.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { scanBuffer } from './scan.js';
import { countWords } from './textstats.js';

const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024; // guards against zip bombs
const WORDS_PER_MINUTE_FLOOR = 250; // typing faster than this means pasted text
const FEW_SESSIONS = 2;
const FEW_SESSIONS_MIN_WORDS = 500;

const CORE_FIELDS = [
  ['dc:title', 'Título'],
  ['dc:creator', 'Autor'],
  ['cp:lastModifiedBy', 'Última modificação por'],
  ['dcterms:created', 'Criado em'],
  ['dcterms:modified', 'Modificado em'],
  ['cp:revision', 'Revisão'],
];
const CORE_REMOVE = [
  ['dc:creator', 'Autor'],
  ['cp:lastModifiedBy', 'Última modificação por'],
  ['dc:title', 'Título'],
  ['dc:subject', 'Assunto'],
  ['cp:keywords', 'Palavras-chave'],
  ['dc:description', 'Descrição'],
  ['cp:lastPrinted', 'Última impressão'],
];
const APP_REMOVE = [
  ['Application', 'Programa'],
  ['AppVersion', 'Versão do programa'],
  ['Company', 'Empresa'],
  ['Manager', 'Gerente'],
  ['Template', 'Modelo'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function elementRe(tag) {
  const t = escapeRe(tag);
  return new RegExp(`<${t}(?:\\s[^>]*?)?(?:\\/>|>([\\s\\S]*?)<\\/${t}>)`, 'g');
}

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readElement(xml, tag) {
  const m = elementRe(tag).exec(xml ?? '');
  if (!m) return null;
  const value = decodeXml(m[1] ?? '').trim();
  return value || null;
}

function removeElement(xml, tag) {
  return xml.replace(elementRe(tag), '');
}

function setElement(xml, tag, value) {
  return xml.replace(elementRe(tag), (m) => m.replace(/>[\s\S]*<\//, `>${value}</`));
}

function readZip(buf) {
  let total = 0;
  try {
    return unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), {
      filter(file) {
        total += file.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error('too big');
        return true;
      },
    });
  } catch {
    throw new Error('DOCX corrompido ou inválido.');
  }
}

function openDocx(buf) {
  const files = readZip(buf);
  if (!files['word/document.xml']) throw new Error('DOCX corrompido ou inválido.');
  const xml = (name) => (files[name] ? strFromU8(files[name]) : null);
  return { files, xml };
}

export function extractDocxText(documentXml) {
  const paragraphs = [];
  for (const m of documentXml.matchAll(/<w:p(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const body = (m[1] ?? '').replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>');
    const runs = [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((r) => decodeXml(r[1]));
    paragraphs.push(runs.join(''));
  }
  return paragraphs.filter((p) => p.trim()).join('\n\n');
}

function countRsids(settingsXml) {
  const block = /<w:rsids>([\s\S]*?)<\/w:rsids>/.exec(settingsXml ?? '');
  return block ? (block[1].match(/<w:rsid\s/g) ?? []).length : null;
}

function formatDate(iso) {
  return iso ? iso.replace('T', ' ').replace(/(:\d{2})(\.\d+)?Z$/, '$1 UTC') : iso;
}

export function inspectDocx(buf) {
  const { files, xml } = openDocx(buf);
  const core = xml('docProps/core.xml') ?? '';
  const app = xml('docProps/app.xml') ?? '';
  const text = extractDocxText(xml('word/document.xml'));
  const words = countWords(text);

  const metadata = [];
  const application = readElement(app, 'Application');
  if (application) {
    const version = readElement(app, 'AppVersion');
    metadata.push({ label: 'Programa', value: version ? `${application} ${version}` : application });
  }
  for (const [tag, label] of CORE_FIELDS) {
    const value = readElement(core, tag);
    if (value) metadata.push({ label, value: tag.startsWith('dcterms:') ? formatDate(value) : value });
  }

  const signals = [];
  const totalTime = readElement(app, 'TotalTime');
  if (totalTime !== null) {
    const minutes = Number(totalTime);
    metadata.push({ label: 'Tempo total de edição', value: `${minutes} min` });
    if (words > 0 && minutes < words / WORDS_PER_MINUTE_FLOOR) {
      signals.push({
        level: 'warn',
        message: `Tempo de edição de ${minutes} min para ${words} palavras: o texto provavelmente foi colado de outro lugar.`,
      });
    }
  }

  const sessions = countRsids(xml('word/settings.xml'));
  if (sessions !== null) {
    metadata.push({ label: 'Sessões de edição (rsid)', value: String(sessions) });
    const few = sessions <= FEW_SESSIONS && words > FEW_SESSIONS_MIN_WORDS;
    const count = sessions === 1 ? '1 sessão de edição' : `${sessions} sessões de edição`;
    signals.push({
      level: few ? 'warn' : 'info',
      message: few
        ? `Só ${count} para ${words} palavras: o documento foi escrito de uma vez ou colado.`
        : `${count} ${sessions === 1 ? 'registrada' : 'registradas'}.`,
    });
  }

  const metaParts = Object.keys(files).filter((n) => n.startsWith('docProps/') || n.startsWith('customXml/'));
  const markers = new Set(metaParts.flatMap((n) => scanBuffer(Buffer.from(files[n]))));
  for (const label of markers) signals.push({ level: 'warn', message: `Marcador de IA nos metadados: ${label}` });

  return { text, metadata, signals };
}

function dropPart(files, name) {
  delete files[name];
  const n = escapeRe(name);
  const types = files['[Content_Types].xml'];
  if (types) {
    files['[Content_Types].xml'] = strToU8(strFromU8(types).replace(new RegExp(`<Override\\b[^>]*PartName="/${n}"[^>]*/>`, 'g'), ''));
  }
  const rels = files['_rels/.rels'];
  if (rels) {
    files['_rels/.rels'] = strToU8(strFromU8(rels).replace(new RegExp(`<Relationship\\b[^>]*Target="/?${n}"[^>]*/>`, 'g'), ''));
  }
}

export function cleanDocx(buf, now = new Date()) {
  const { files, xml } = openDocx(buf);
  const removed = [];
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z');

  let core = xml('docProps/core.xml');
  if (core) {
    for (const [tag, label] of CORE_REMOVE) {
      const value = readElement(core, tag);
      if (value) removed.push({ field: label, value });
      core = removeElement(core, tag);
    }
    const revision = readElement(core, 'cp:revision');
    if (revision && revision !== '1') {
      removed.push({ field: 'Revisão', value: revision });
      core = setElement(core, 'cp:revision', '1');
    }
    for (const [tag, label] of [['dcterms:created', 'Criado em'], ['dcterms:modified', 'Modificado em']]) {
      const value = readElement(core, tag);
      if (value) removed.push({ field: label, value: formatDate(value) });
      core = setElement(core, tag, stamp);
    }
    files['docProps/core.xml'] = strToU8(core);
  }

  let app = xml('docProps/app.xml');
  if (app) {
    // Removed rather than zeroed: a zero would itself look like pasted text.
    const totalTime = readElement(app, 'TotalTime');
    if (totalTime) removed.push({ field: 'Tempo total de edição', value: `${totalTime} min` });
    app = removeElement(app, 'TotalTime');
    for (const [tag, label] of APP_REMOVE) {
      const value = readElement(app, tag);
      if (value) removed.push({ field: label, value });
      app = removeElement(app, tag);
    }
    files['docProps/app.xml'] = strToU8(app);
  }

  const custom = xml('docProps/custom.xml');
  if (custom) {
    const names = [...custom.matchAll(/<property\b[^>]*\sname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
    removed.push({ field: 'Propriedades personalizadas', value: names.join(', ') || 'custom.xml' });
    dropPart(files, 'docProps/custom.xml');
  }

  for (const name of Object.keys(files).filter((n) => /^docProps\/thumbnail\./.test(n))) {
    removed.push({ field: 'Miniatura', value: name });
    dropPart(files, name);
  }

  const sessions = countRsids(xml('word/settings.xml'));
  if (sessions !== null) removed.push({ field: 'Sessões de edição (rsid)', value: `${sessions} registros` });
  for (const name of Object.keys(files).filter((n) => /^word\/[^/]+\.xml$/.test(n))) {
    let part = strFromU8(files[name]);
    if (name === 'word/settings.xml') part = part.replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, '');
    files[name] = strToU8(part.replace(/\s+w:rsid\w*="[^"]*"/g, ''));
  }

  return { data: Buffer.from(zipSync(files, { level: 6 })), removed };
}
