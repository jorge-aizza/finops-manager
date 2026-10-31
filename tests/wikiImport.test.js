'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { convertDocxToWikiDocument, convertPdfToWikiDocument, pdfLinesToWikiDocument } = require('../wikiImport');

function docxFixture() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Guia de FinOps</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Texto importante</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Passo inicial</w:t></w:r></w:p>
</w:body></w:document>`));
  return zip.toBuffer();
}

test('DOCX vira documento TipTap estruturado com heading e ênfase', async () => {
  const result = await convertDocxToWikiDocument(docxFixture(), async () => 1);

  assert.equal(result.document.type, 'doc');
  assert.ok(result.document.content.some((node) => node.type === 'heading' && node.attrs.level === 1));
  assert.ok(result.document.content.some((node) => node.content?.some((child) => child.marks?.some((mark) => mark.type === 'bold'))));
});

test('PDF preserva a separação por página e parágrafo', () => {
  const document = pdfLinesToWikiDocument([['Resumo mensal', 'Custo total: R$ 1.250'], ['Detalhamento', 'Equipe FinOps']]);

  assert.deepEqual(document.content.filter((node) => node.type === 'heading').map((node) => node.content[0].text), ['Página 1', 'Página 2']);
  assert.ok(document.content.some((node) => node.content?.[0]?.text === 'Custo total: R$ 1.250'));
});

test('PDF sem texto extraível informa que pode exigir OCR', () => {
  assert.throws(() => pdfLinesToWikiDocument([['', '  ']]), /precisa de OCR/);
});

test('parser PDF rejeita arquivo que não seja PDF', async () => {
  await assert.rejects(convertPdfToWikiDocument(Buffer.from('arquivo inválido')));
});
