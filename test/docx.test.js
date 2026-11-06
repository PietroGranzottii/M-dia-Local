import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { inspectDocx, cleanDocx } from '../lib/docx.js';
import { makeDocx } from './fixtures.js';

const LONG = Array.from({ length: 60 }, (_, i) => `Parágrafo número ${i} com algumas palavras de exemplo aqui.`);

test('inspectDocx lê o texto em parágrafos', () => {
  const { text } = inspectDocx(makeDocx({ paragraphs: ['Primeiro & único.', 'Segundo parágrafo.'] }));
  assert.equal(text, 'Primeiro & único.\n\nSegundo parágrafo.');
});

test('inspectDocx mostra os metadados principais', () => {
  const { metadata } = inspectDocx(makeDocx());
  const byLabel = Object.fromEntries(metadata.map((m) => [m.label, m.value]));
  assert.equal(byLabel['Programa'], 'Microsoft Office Word 16.0000');
  assert.equal(byLabel['Autor'], 'Fulano de Tal');
  assert.equal(byLabel['Revisão'], '7');
  assert.equal(byLabel['Criado em'], '2026-10-01 10:00:00 UTC');
  assert.equal(byLabel['Tempo total de edição'], '2 min');
  assert.equal(byLabel['Sessões de edição (rsid)'], '2');
});

test('inspectDocx alerta texto colado, poucas sessões e marcador de IA', () => {
  const { signals } = inspectDocx(makeDocx({ paragraphs: LONG, totalTime: 1, rsids: 1 }));
  const messages = signals.filter((s) => s.level === 'warn').map((s) => s.message);
  assert.ok(messages.some((m) => m.includes('provavelmente foi colado')), messages.join(' | '));
  assert.ok(messages.some((m) => m.includes('Só 1 sessão de edição para')), messages.join(' | '));
  assert.ok(messages.some((m) => m.includes('ChatGPT')), messages.join(' | '));
});

test('inspectDocx não alerta quando o tempo de edição é compatível', () => {
  const { signals } = inspectDocx(makeDocx({ paragraphs: LONG, totalTime: 90, rsids: 12, custom: false }));
  assert.deepEqual(signals, [{ level: 'info', message: '12 sessões de edição registradas.' }]);
});

test('inspectDocx recusa arquivos que não são DOCX', () => {
  assert.throws(() => inspectDocx(Buffer.from('não é zip')), /DOCX corrompido/);
});

test('cleanDocx remove os metadados e preserva o texto', () => {
  const original = makeDocx({ paragraphs: ['Texto que não pode mudar.'] });
  const now = new Date('2026-11-05T12:00:00.000Z');
  const { data, removed } = cleanDocx(original, now);
  const files = unzipSync(new Uint8Array(data));
  const core = strFromU8(files['docProps/core.xml']);
  const app = strFromU8(files['docProps/app.xml']);

  assert.ok(!core.includes('Fulano'));
  assert.ok(!core.includes('Trabalho final'));
  assert.match(core, /<cp:revision>1<\/cp:revision>/);
  assert.match(core, /<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-05T12:00:00Z<\/dcterms:created>/);
  assert.ok(!app.includes('TotalTime'));
  assert.ok(!app.includes('Application') && !app.includes('Company') && !app.includes('Template'));

  assert.equal(files['docProps/custom.xml'], undefined);
  assert.equal(files['docProps/thumbnail.jpeg'], undefined);
  assert.ok(!strFromU8(files['[Content_Types].xml']).includes('custom.xml'));
  const rels = strFromU8(files['_rels/.rels']);
  assert.ok(!rels.includes('custom.xml') && !rels.includes('thumbnail'));

  assert.ok(!strFromU8(files['word/settings.xml']).includes('rsid'));
  assert.ok(!strFromU8(files['word/document.xml']).includes('rsid'));

  assert.equal(inspectDocx(data).text, inspectDocx(original).text);
  assert.equal(inspectDocx(data).signals.filter((s) => s.level === 'warn').length, 0);

  const fields = removed.map((r) => r.field);
  for (const f of ['Autor', 'Título', 'Revisão', 'Tempo total de edição', 'Programa', 'Empresa', 'Propriedades personalizadas', 'Miniatura', 'Sessões de edição (rsid)']) {
    assert.ok(fields.includes(f), `faltou ${f}`);
  }
  assert.deepEqual(removed.find((r) => r.field === 'Propriedades personalizadas'), { field: 'Propriedades personalizadas', value: 'GeneratedBy' });
});
