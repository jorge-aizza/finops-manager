'use strict';

const mammoth = require('mammoth');
const parse5 = require('parse5');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const INLINE_MARKS = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike', code: 'code',
};

function safeHref(value) {
  const href = String(value || '').trim();
  if (!href || href.length > 2048 || /[\u0000-\u001f]/.test(href)) return null;
  const protocol = href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))
    ? 'https:'
    : (() => { try { return new URL(href).protocol; } catch { return ''; } })();
  return ['https:', 'http:', 'mailto:'].includes(protocol) ? href : null;
}

function safeTextStyle(node) {
  const style = Object.fromEntries((node.attrs || [])
    .find((attr) => attr.name === 'style')?.value.split(';').map((entry) => {
      const [key, ...value] = entry.split(':');
      return [key?.trim().toLowerCase(), value.join(':').trim()];
    }).filter(([key, value]) => key && value) || []);
  const attrs = {};
  if (/^#[0-9a-f]{6}$/i.test(style.color || '')) attrs.color = style.color;
  if (/^(10|11|12|14|16|18|20|24|28|32|36)px$/.test(style['font-size'] || '')) attrs.fontSize = style['font-size'];
  const family = (style['font-family'] || '').replace(/["']/g, '').split(',')[0].trim();
  if (['Arial', 'Calibri', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'].includes(family)) attrs.fontFamily = family;
  return Object.keys(attrs).length ? attrs : null;
}

function inlineText(value, marks) {
  if (!value) return [];
  const text = { type: 'text', text: value };
  if (marks.length) text.marks = marks;
  return [text];
}

async function convertInline(node, marks, saveImage) {
  if (!node) return [];
  if (node.nodeName === '#text') return inlineText(node.value, marks);
  if (node.nodeName === '#comment') return [];
  if (node.tagName === 'img') {
    const src = (node.attrs || []).find((attr) => attr.name === 'src')?.value || '';
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(src);
    if (!match) return [];
    const mimeType = match[1].toLowerCase();
    if (!IMAGE_TYPES.has(mimeType)) return [];
    const bytes = Buffer.from(match[2], 'base64');
    const mediaId = await saveImage(bytes, mimeType);
    const alt = (node.attrs || []).find((attr) => attr.name === 'alt')?.value || '';
    return [{ type: 'wikiImage', attrs: { mediaId, alt: alt.slice(0, 300) } }];
  }

  const nextMarks = [...marks];
  const mark = INLINE_MARKS[node.tagName];
  if (mark && !nextMarks.some((item) => item.type === mark)) nextMarks.push({ type: mark });
  if (node.tagName === 'a') {
    const href = safeHref((node.attrs || []).find((attr) => attr.name === 'href')?.value);
    if (href) nextMarks.push({ type: 'link', attrs: { href } });
  }
  if (node.tagName === 'span') {
    const attrs = safeTextStyle(node);
    if (attrs) nextMarks.push({ type: 'textStyle', attrs });
  }

  const output = [];
  for (const child of node.childNodes || []) output.push(...await convertInline(child, nextMarks, saveImage));
  return output;
}

async function inlineBlocks(node, blockType, saveImage) {
  const blocks = [];
  let content = [];
  const flush = () => {
    if (content.length || !blocks.length) blocks.push({ type: blockType, ...(blockType === 'heading' ? { attrs: node.attrsWiki } : {}), content });
    content = [];
  };
  for (const child of node.childNodes || []) {
    const converted = await convertInline(child, [], saveImage);
    for (const item of converted) {
      if (item.type === 'wikiImage') {
        flush();
        blocks.push(item);
      } else content.push(item);
    }
  }
  flush();
  return blocks;
}

function getAttribute(node, name) {
  return (node.attrs || []).find((attr) => attr.name === name)?.value;
}

function cellAttrs(node) {
  const colspan = Math.max(1, Math.min(10, Number(getAttribute(node, 'colspan')) || 1));
  const rowspan = Math.max(1, Math.min(10, Number(getAttribute(node, 'rowspan')) || 1));
  return { colspan, rowspan, colwidth: null };
}

async function convertBlocks(nodes, saveImage) {
  const blocks = [];
  for (const node of nodes || []) {
    if (!node.tagName) {
      if (node.nodeName === '#text' && node.value.trim()) blocks.push({ type: 'paragraph', content: inlineText(node.value.trim(), []) });
      continue;
    }
    if (node.tagName === 'p') {
      blocks.push(...await inlineBlocks(node, 'paragraph', saveImage));
    } else if (/^h[1-3]$/.test(node.tagName)) {
      const level = Number(node.tagName.slice(1));
      const heading = { ...node, attrsWiki: { level } };
      blocks.push(...await inlineBlocks(heading, 'heading', saveImage));
    } else if (node.tagName === 'ul' || node.tagName === 'ol') {
      const items = [];
      for (const child of node.childNodes || []) {
        if (child.tagName !== 'li') continue;
        const content = await convertBlocks(child.childNodes, saveImage);
        items.push({ type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] });
      }
      if (items.length) blocks.push({ type: node.tagName === 'ul' ? 'bulletList' : 'orderedList', content: items });
    } else if (node.tagName === 'blockquote') {
      const content = await convertBlocks(node.childNodes, saveImage);
      blocks.push({ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] });
    } else if (node.tagName === 'pre') {
      const raw = node.childNodes?.map((child) => child.value || '').join('') || '';
      blocks.push({ type: 'codeBlock', content: raw ? [{ type: 'text', text: raw }] : [] });
    } else if (node.tagName === 'hr') {
      blocks.push({ type: 'horizontalRule' });
    } else if (node.tagName === 'table') {
      const rows = [];
      const visitRows = async (children) => {
        for (const child of children || []) {
          if (child.tagName === 'tr') {
            const cells = [];
            for (const cell of child.childNodes || []) {
              if (!['td', 'th'].includes(cell.tagName)) continue;
              const content = await convertBlocks(cell.childNodes, saveImage);
              cells.push({ type: cell.tagName === 'th' ? 'tableHeader' : 'tableCell', attrs: cellAttrs(cell), content: content.length ? content : [{ type: 'paragraph' }] });
            }
            if (cells.length) rows.push({ type: 'tableRow', content: cells });
          } else await visitRows(child.childNodes);
        }
      };
      await visitRows(node.childNodes);
      if (rows.length) blocks.push({ type: 'table', content: rows });
    } else {
      blocks.push(...await convertBlocks(node.childNodes, saveImage));
    }
  }
  return blocks;
}

async function convertDocxToWikiDocument(buffer, saveImage) {
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: ['u => u'],
    convertImage: mammoth.images.imgElement((image) => image.read('base64').then((base64) => ({
      src: `data:${image.contentType};base64,${base64}`,
    }))),
  });
  const fragment = parse5.parseFragment(result.value);
  const content = await convertBlocks(fragment.childNodes, saveImage);
  return {
    document: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    avisos: result.messages.filter((message) => message.type === 'warning').map((message) => message.message).slice(0, 20),
  };
}

function pdfLinesToWikiDocument(pageLines) {
  const content = [];
  for (const [index, lines] of pageLines.entries()) {
    const textLines = lines.map((line) => String(line || '').trim()).filter(Boolean);
    if (!textLines.length) continue;
    content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `Página ${index + 1}` }] });
    for (const text of textLines) content.push({ type: 'paragraph', content: [{ type: 'text', text }] });
  }
  if (!content.length) throw new Error('Não foi encontrado texto no documento. PDF digitalizado precisa de OCR, que não está disponível.');
  return { type: 'doc', content };
}

async function convertPdfToWikiDocument(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > 200) throw new Error('O PDF excede o limite de 200 páginas.');
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = [];
      let currentY = null;
      let currentLine = '';
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;
        const y = Number(item.transform?.[5] || 0);
        if (currentY !== null && Math.abs(y - currentY) > 2) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        if (currentLine && !currentLine.endsWith(' ')) currentLine += ' ';
        currentLine += item.str;
        currentY = y;
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      pages.push(lines);
      page.cleanup();
    }
    return pdfLinesToWikiDocument(pages);
  } finally {
    await pdf.destroy();
  }
}

module.exports = { convertDocxToWikiDocument, convertPdfToWikiDocument, pdfLinesToWikiDocument };