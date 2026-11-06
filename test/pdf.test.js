import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { inspectPdf, cleanPdf } from '../lib/pdf.js';
import { makePdf } from './fixtures.js';

test('inspectPdf lê texto, Info e XMP', async () => {
  const { text, metadata, signals } = await inspectPdf(await makePdf());
  assert.equal(text, 'Primeira linha do texto. Segunda linha do texto.');
  const byLabel = Object.fromEntries(metadata.map((m) => [m.label, m.value]));
  assert.equal(byLabel['Autor'], 'Fulano de Tal');
  assert.equal(byLabel['Gerado por'], 'Microsoft: Print To PDF');
  assert.equal(byLabel['Ferramenta (XMP)'], 'ChatGPT');
  assert.match(byLabel['Criado em'], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(signals, [{ level: 'warn', message: 'Marcador de IA nos metadados: ChatGPT' }]);
});

test('inspectPdf avisa quando não há texto', async () => {
  const { text, signals } = await inspectPdf(await makePdf({ lines: [], xmp: false }));
  assert.equal(text, '');
  assert.ok(signals.some((s) => s.message.includes('sem texto extraível')));
});

test('inspectPdf recusa arquivos que não são PDF', async () => {
  await assert.rejects(inspectPdf(Buffer.from('não é pdf')), /PDF corrompido/);
});

test('cleanPdf remove Info e XMP e preserva o texto', async () => {
  const original = await makePdf();
  const { data, removed } = await cleanPdf(original);

  const after = await inspectPdf(data);
  assert.deepEqual(after.metadata, []);
  assert.deepEqual(after.signals, []);
  assert.equal(after.text, (await inspectPdf(original)).text);
  assert.ok(!data.includes('ChatGPT'));

  const reloaded = await PDFDocument.load(data, { updateMetadata: false });
  assert.equal(reloaded.context.trailerInfo.Info, undefined);

  const fields = removed.map((r) => r.field);
  for (const f of ['Título', 'Autor', 'Criado com', 'Gerado por', 'Criado em', 'Metadados XMP']) {
    assert.ok(fields.includes(f), `faltou ${f}`);
  }
});

test('cleanPdf recusa arquivos que não são PDF', async () => {
  await assert.rejects(cleanPdf(Buffer.from('não é pdf')), /PDF corrompido/);
});
