// Builds small DOCX and PDF files with known metadata for the tests.
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function makeDocx({
  paragraphs = ['Olá, mundo.'],
  creator = 'Fulano de Tal',
  totalTime = 2,
  revision = 7,
  rsids = 2,
  custom = true,
  thumbnail = true,
} = {}) {
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + (custom ? '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' : '')
    + '</Types>';

  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + (custom ? '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>' : '')
    + (thumbnail ? '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>' : '')
    + '</Relationships>';

  const body = paragraphs
    .map((p) => `<w:p w:rsidR="00A00000" w:rsidRDefault="00A00000"><w:r w:rsidRPr="00A00001"><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('');
  const document = `${XML}<w:document xmlns:w="${W}"><w:body>${body}<w:p w:rsidR="00A00000"/><w:sectPr w:rsidR="00A00000"/></w:body></w:document>`;

  const rsidList = Array.from({ length: rsids }, (_, i) => `<w:rsid w:val="00A0000${i}"/>`).join('');
  const settings = `${XML}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:rsids><w:rsidRoot w:val="00A00000"/>${rsidList}</w:rsids></w:settings>`;

  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>Trabalho final</dc:title><dc:creator>${creator}</dc:creator><cp:lastModifiedBy>${creator}</cp:lastModifiedBy>`
    + `<cp:revision>${revision}</cp:revision>`
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T10:00:00Z</dcterms:created>'
    + '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-01T10:02:00Z</dcterms:modified>'
    + '</cp:coreProperties>';

  const app = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">`
    + `<Template>Normal.dotm</Template><TotalTime>${totalTime}</TotalTime><Application>Microsoft Office Word</Application>`
    + '<AppVersion>16.0000</AppVersion><Company>Universidade</Company></Properties>';

  const customXml = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="GeneratedBy"><vt:lpwstr>ChatGPT</vt:lpwstr></property></Properties>';

  const files = {
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
    'word/settings.xml': strToU8(settings),
    'docProps/core.xml': strToU8(core),
    'docProps/app.xml': strToU8(app),
  };
  if (custom) files['docProps/custom.xml'] = strToU8(customXml);
  if (thumbnail) files['docProps/thumbnail.jpeg'] = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return Buffer.from(zipSync(files));
}

const XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
  + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
  + '<xmp:CreatorTool>ChatGPT</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

export async function makePdf({ lines = ['Primeira linha do texto.', 'Segunda linha do texto.'], xmp = true } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('Trabalho final');
  doc.setAuthor('Fulano de Tal');
  doc.setCreator('Microsoft Word');
  doc.setProducer('Microsoft: Print To PDF');
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 750 - i * 18, size: 12, font }));
  if (xmp) {
    const stream = doc.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  }
  return Buffer.from(await doc.save());
}
