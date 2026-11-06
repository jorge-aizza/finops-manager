'use strict';

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const WIKI_INITIAL_PAGES = require('./wikiConteudoInicial');
const { convertDocxToWikiDocument, convertPdfToWikiDocument } = require('./wikiImport');

const MAX_DOCUMENT_NODES = 10000;
const MAX_DOCUMENT_TEXT = 200000;
const BLOCK_NODES = new Set([
  'blockquote', 'bulletList', 'codeBlock', 'heading', 'horizontalRule', 'listItem',
  'orderedList', 'paragraph', 'table', 'tableCell', 'tableHeader', 'tableRow', 'wikiImage',
]);
const INLINE_NODES = new Set(['hardBreak', 'text']);
const MARKS = new Set(['bold', 'code', 'italic', 'strike', 'textStyle', 'underline', 'link']);
const TEXT_FONTS = new Set(['Arial', 'Calibri', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana']);
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const SEARCH_VECTOR = `to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(resumo, '') || ' ' || coalesce(texto_busca, ''))`;
const MAX_WIKI_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_WIKI_IMPORT_BYTES = 12 * 1024 * 1024;
const wikiMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_WIKI_IMPORT_BYTES, files: 1 },
});
const wikiImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_WIKI_IMAGE_BYTES, files: 1 },
});

function uploadFile(upload, fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => middleware(req, res, (error) => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: status === 413 ? 'O arquivo excede o limite permitido.' : 'Não foi possível receber o arquivo.' });
    }
    next();
  });
}

function imageMimeFromBuffer(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function collectWikiMediaIds(document) {
  return collectWikiMedia(document).map((image) => image.mediaId);
}

function collectWikiMedia(document) {
  const ids = new Set();
  const images = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'wikiImage' && Number.isSafeInteger(Number(node.attrs?.mediaId))) {
      const mediaId = Number(node.attrs.mediaId);
      ids.add(mediaId);
      images.set(mediaId, images.get(mediaId) || node.attrs?.portalPublico === true);
    }
    for (const child of node.content || []) visit(child);
  }
  visit(document);
  return [...ids].map((mediaId) => ({ mediaId, portalPublico: images.get(mediaId) === true }));
}

class WikiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function slugifyWikiTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}

function sanitizeWikiDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.type !== 'doc') {
    throw new WikiError(400, 'Conteúdo inválido.');
  }

  let nodeCount = 0;
  let textLength = 0;

  function sanitizeNode(node, depth) {
    nodeCount += 1;
    if (nodeCount > MAX_DOCUMENT_NODES || depth > 30 || !node || typeof node !== 'object' || Array.isArray(node)) {
      throw new WikiError(400, 'O documento excede os limites permitidos.');
    }

    const type = node.type;
    if (type !== 'doc' && !BLOCK_NODES.has(type) && !INLINE_NODES.has(type)) {
      throw new WikiError(400, `Tipo de bloco não permitido: ${String(type || '')}.`);
    }

    const clean = { type };
    if (type === 'text') {
      if (typeof node.text !== 'string') throw new WikiError(400, 'Texto inválido.');
      textLength += node.text.length;
      if (textLength > MAX_DOCUMENT_TEXT) throw new WikiError(400, 'O texto excede o limite permitido.');
      clean.text = node.text;
    }

    if (type === 'heading') {
      const level = Number(node.attrs?.level ?? 2);
      if (![1, 2, 3].includes(level)) throw new WikiError(400, 'Nível de título inválido.');
      clean.attrs = { level };
    }

    if (type === 'heading' || type === 'paragraph') {
      const textAlign = node.attrs?.textAlign;
      if (textAlign != null && !TEXT_ALIGNMENTS.has(textAlign)) throw new WikiError(400, 'Alinhamento inválido.');
      if (textAlign) clean.attrs = { ...(clean.attrs || {}), textAlign };
    }

    if (type === 'tableCell' || type === 'tableHeader') {
      const colspan = Number(node.attrs?.colspan ?? 1);
      const rowspan = Number(node.attrs?.rowspan ?? 1);
      const colwidth = node.attrs?.colwidth;
      if (!Number.isInteger(colspan) || colspan < 1 || colspan > 10 || !Number.isInteger(rowspan) || rowspan < 1 || rowspan > 10) {
        throw new WikiError(400, 'Dimensões de célula inválidas.');
      }
      if (colwidth !== null && colwidth !== undefined && (!Array.isArray(colwidth) || colwidth.length > 10 || colwidth.some((width) => !Number.isInteger(width) || width < 40 || width > 1600))) {
        throw new WikiError(400, 'Largura de coluna inválida.');
      }
      clean.attrs = { colspan, rowspan, colwidth: colwidth || null };
    }

    if (type === 'wikiImage') {
      const mediaId = Number(node.attrs?.mediaId);
      const alt = String(node.attrs?.alt || '').trim();
      const width = node.attrs?.width === null || node.attrs?.width === undefined ? null : Number(node.attrs.width);
      if (!Number.isSafeInteger(mediaId) || mediaId < 1 || alt.length > 300 || (width !== null && (!Number.isInteger(width) || width < 80 || width > 1600))) {
        throw new WikiError(400, 'Imagem inválida.');
      }
      clean.attrs = { mediaId, alt, width, portalPublico: node.attrs?.portalPublico === true };
    }

    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => {
        if (!mark || typeof mark !== 'object' || !MARKS.has(mark.type)) {
          throw new WikiError(400, 'Formatação não permitida.');
        }
        if (mark.type === 'textStyle') {
          const attrs = {};
          const color = mark.attrs?.color;
          const fontSize = mark.attrs?.fontSize;
          const fontFamily = mark.attrs?.fontFamily;
          if (color != null) {
            if (!/^#[0-9a-f]{6}$/i.test(color)) throw new WikiError(400, 'Cor inválida.');
            attrs.color = color;
          }
          if (fontSize != null) {
            const size = Number.parseInt(fontSize, 10);
            if (!/^\d{1,2}px$/.test(fontSize) || size < 8 || size > 48) throw new WikiError(400, 'Tamanho de fonte inválido.');
            attrs.fontSize = `${size}px`;
          }
          if (fontFamily != null) {
            if (!TEXT_FONTS.has(fontFamily)) throw new WikiError(400, 'Fonte não permitida.');
            attrs.fontFamily = fontFamily;
          }
          return { type: 'textStyle', attrs };
        }
        if (mark.type !== 'link') return { type: mark.type };
        const href = String(mark.attrs?.href || '').trim();
        if (!href || href.length > 2048 || /[\u0000-\u001f]/.test(href)) {
          throw new WikiError(400, 'Link inválido.');
        }
        const protocol = href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))
          ? 'https:'
          : (() => { try { return new URL(href).protocol; } catch { return ''; } })();
        if (!['https:', 'http:', 'mailto:'].includes(protocol)) throw new WikiError(400, 'Protocolo de link não permitido.');
        return { type: 'link', attrs: { href } };
      });
    }

    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new WikiError(400, 'Estrutura de conteúdo inválida.');
      clean.content = node.content.map((child) => sanitizeNode(child, depth + 1));
    }
    return clean;
  }

  return sanitizeNode(document, 0);
}

function extractWikiText(document) {
  const parts = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
    else if (node.type === 'hardBreak' || node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem' || node.type === 'tableCell' || node.type === 'tableHeader') parts.push('\n');
    for (const child of node.content || []) visit(child);
  }
  visit(document);
  return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
}

function isWikiWriter(user) {
  return user?.perfil === 'admin' || user?.perfil === 'finops';
}

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) throw new WikiError(400, `${label} obrigatório (máximo de ${maxLength} caracteres).`);
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw new WikiError(400, `O texto excede ${maxLength} caracteres.`);
  return text || null;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new WikiError(400, 'Identificador inválido.');
  return id;
}

function editorName(user) {
  return String(user?.nome || user?.email || user?.id || 'Usuário').slice(0, 200);
}

function editorIdentity(user) {
  return String(user?.id || user?.sub || user?.email || user?.nome || 'Usuário').slice(0, 200);
}

function respondError(res, error) {
  if (error instanceof WikiError) return res.status(error.status).json({ error: error.message });
  console.error('[Wiki] erro na API:', error?.message || error);
  return res.status(500).json({ error: 'Não foi possível concluir a operação da Wiki.' });
}

async function ensureWikiSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_paginas (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(160) NOT NULL UNIQUE,
      titulo VARCHAR(180) NOT NULL,
      categoria VARCHAR(100) NOT NULL DEFAULT 'Geral',
      resumo VARCHAR(500),
      conteudo JSONB NOT NULL,
      texto_busca TEXT NOT NULL DEFAULT '',
      portal_publico BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(16) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicado', 'arquivado')),
      criado_por VARCHAR(200) NOT NULL,
      atualizado_por VARCHAR(200) NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE wiki_paginas ADD COLUMN IF NOT EXISTS portal_publico BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wiki_paginas_categoria ON wiki_paginas (categoria, atualizado_em DESC) WHERE status <> 'arquivado'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wiki_paginas_publicas ON wiki_paginas (atualizado_em DESC) WHERE status='publicado' AND portal_publico=true`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wiki_paginas_busca ON wiki_paginas USING GIN (${SEARCH_VECTOR}) WHERE status <> 'arquivado'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_revisoes (
      id BIGSERIAL PRIMARY KEY,
      pagina_id INT NOT NULL REFERENCES wiki_paginas(id) ON DELETE CASCADE,
      versao INT NOT NULL,
      titulo VARCHAR(180) NOT NULL,
      categoria VARCHAR(100) NOT NULL,
      resumo VARCHAR(500),
      conteudo JSONB NOT NULL,
      status VARCHAR(16) NOT NULL,
      portal_publico BOOLEAN NOT NULL DEFAULT false,
      alterado_por VARCHAR(200) NOT NULL,
      alterado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pagina_id, versao)
    )
  `);
  await pool.query(`ALTER TABLE wiki_revisoes ADD COLUMN IF NOT EXISTS portal_publico BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wiki_revisoes_pagina ON wiki_revisoes (pagina_id, versao DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_midias (
      id SERIAL PRIMARY KEY,
      mime_type VARCHAR(32) NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/gif','image/webp')),
      dados BYTEA NOT NULL,
      tamanho INT NOT NULL CHECK (tamanho > 0 AND tamanho <= ${MAX_WIKI_IMAGE_BYTES}),
      criado_por VARCHAR(200) NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_pagina_midias (
      pagina_id INT NOT NULL REFERENCES wiki_paginas(id) ON DELETE CASCADE,
      midia_id INT NOT NULL REFERENCES wiki_midias(id) ON DELETE RESTRICT,
      portal_publico BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (pagina_id, midia_id)
    )
  `);
  await pool.query(`ALTER TABLE wiki_pagina_midias ADD COLUMN IF NOT EXISTS portal_publico BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wiki_pagina_midias_midia ON wiki_pagina_midias (midia_id, pagina_id)`);
  for (const page of WIKI_INITIAL_PAGES) {
    await pool.query(
      `INSERT INTO wiki_paginas (slug,titulo,categoria,resumo,conteudo,texto_busca,status,criado_por,atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,'publicado','FinOps Manager','FinOps Manager')
       ON CONFLICT (slug) DO NOTHING`,
      [page.slug, page.titulo, page.categoria, page.resumo, page.conteudo, extractWikiText(page.conteudo)],
    );
  }
}

async function inTransaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveRevision(client, page, user) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(versao), 0) + 1 AS versao FROM wiki_revisoes WHERE pagina_id = $1',
    [page.id],
  );
  await client.query(
    `INSERT INTO wiki_revisoes (pagina_id, versao, titulo, categoria, resumo, conteudo, status, portal_publico, alterado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [page.id, rows[0].versao, page.titulo, page.categoria, page.resumo, page.conteudo, page.status, !!page.portal_publico, editorName(user)],
  );
}

async function syncWikiMedia(client, pageId, document, user, restoredMediaIds = []) {
  const media = collectWikiMedia(document);
  const mediaIds = media.map((image) => image.mediaId);
  if (media.length > 50) throw new WikiError(400, 'Um artigo pode conter no máximo 50 imagens.');
  const { rows: available } = await client.query(
    `SELECT id FROM wiki_midias
     WHERE id = ANY($1::int[])
       AND (criado_por=$2 OR id = ANY($4::int[]) OR EXISTS (
         SELECT 1 FROM wiki_pagina_midias pm WHERE pm.pagina_id=$3 AND pm.midia_id=wiki_midias.id
       ))`,
    [mediaIds, editorIdentity(user), pageId, restoredMediaIds],
  );
  if (available.length !== mediaIds.length) throw new WikiError(400, 'Uma ou mais imagens não pertencem a este artigo ou não existem.');
  await client.query('DELETE FROM wiki_pagina_midias WHERE pagina_id=$1', [pageId]);
  for (const image of media) {
    await client.query('INSERT INTO wiki_pagina_midias (pagina_id,midia_id,portal_publico) VALUES ($1,$2,$3)', [pageId, image.mediaId, image.portalPublico]);
  }
}

function createWikiRouter({ pool, getPool, authMiddleware, dbMiddleware }) {
  const router = express.Router();
  const resolvePool = getPool || (() => pool);
  let schemaPromise;
  let schemaPool;
  router.use(authMiddleware, dbMiddleware);
  router.use(async (req, res, next) => {
    try {
      const activePool = resolvePool();
      if (!activePool) throw new WikiError(503, 'Banco não configurado.');
      if (schemaPool !== activePool) {
        schemaPool = activePool;
        schemaPromise = ensureWikiSchema(activePool).catch((error) => {
          if (schemaPool === activePool) { schemaPool = null; schemaPromise = null; }
          throw error;
        });
      }
      await schemaPromise;
      next();
    } catch (error) {
      respondError(res, error);
    }
  });

  router.get('/pages', async (req, res) => {
    try {
      const params = [];
      const where = ["p.status <> 'arquivado'"];
      if (!isWikiWriter(req.user)) where.push("p.status = 'publicado'");
      const busca = String(req.query.busca || '').trim().slice(0, 120);
      if (busca) {
        params.push(busca);
        where.push(`${SEARCH_VECTOR} @@ websearch_to_tsquery('portuguese', $${params.length})`);
      }
      const categoria = String(req.query.categoria || '').trim().slice(0, 100);
      if (categoria) {
        params.push(categoria);
        where.push(`p.categoria = $${params.length}`);
      }
      const relevancia = busca
        ? `ts_rank(${SEARCH_VECTOR}, websearch_to_tsquery('portuguese', $1))`
        : '0';
      const order = busca
        ? `ts_rank(${SEARCH_VECTOR}, websearch_to_tsquery('portuguese', $1)) DESC, p.atualizado_em DESC`
        : 'p.atualizado_em DESC';
      const { rows } = await resolvePool().query(
        `SELECT p.id,p.slug,p.titulo,p.categoria,p.resumo,p.status,p.portal_publico,p.atualizado_por,p.atualizado_em,
                ${relevancia} AS relevancia
         FROM wiki_paginas p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`,
        params,
      );
      res.json(rows);
    } catch (error) { respondError(res, error); }
  });

  router.get('/categorias', async (req, res) => {
    try {
      const publishedOnly = !isWikiWriter(req.user);
      const { rows } = await resolvePool().query(
        `SELECT categoria, COUNT(*)::int AS total
         FROM wiki_paginas
         WHERE status <> 'arquivado' AND ($1 = false OR status = 'publicado')
         GROUP BY categoria ORDER BY LOWER(categoria)`,
        [publishedOnly],
      );
      res.json(rows);
    } catch (error) { respondError(res, error); }
  });

  router.post('/midias/imagens', uploadFile(wikiImageUpload, 'imagem'), async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode enviar imagens.');
      const buffer = req.file?.buffer;
      if (!buffer?.length) throw new WikiError(400, 'Selecione uma imagem PNG, JPG, GIF ou WEBP.');
      const mimeType = imageMimeFromBuffer(buffer);
      if (!mimeType) throw new WikiError(400, 'O arquivo não é uma imagem PNG, JPG, GIF ou WEBP válida.');
      const { rows } = await resolvePool().query(
        'INSERT INTO wiki_midias (mime_type,dados,tamanho,criado_por) VALUES ($1,$2,$3,$4) RETURNING id',
        [mimeType, buffer, buffer.length, editorIdentity(req.user)],
      );
      res.status(201).json({ mediaId: rows[0].id, mimeType });
    } catch (error) { respondError(res, error); }
  });

  router.get('/midias/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const { rows } = await resolvePool().query(
        `SELECT m.mime_type,m.dados
         FROM wiki_midias m
         WHERE m.id=$1 AND (
           m.criado_por=$2 OR EXISTS (
             SELECT 1 FROM wiki_pagina_midias pm JOIN wiki_paginas p ON p.id=pm.pagina_id
             WHERE pm.midia_id=m.id AND ($3::boolean OR p.status='publicado')
           )
           OR ($3::boolean AND EXISTS (
             SELECT 1 FROM wiki_revisoes r
             WHERE jsonb_path_exists(r.conteudo, '$.**.attrs.mediaId ? (@ == $mediaId)'::jsonpath, jsonb_build_object('mediaId', m.id))
           ))
         )`,
        [id, editorIdentity(req.user), isWikiWriter(req.user)],
      );
      if (!rows.length) return res.status(404).json({ error: 'Imagem não encontrada.' });
      res.set('Content-Type', rows[0].mime_type)
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'private, max-age=60')
        .send(rows[0].dados);
    } catch (error) { respondError(res, error); }
  });

  router.post('/importar', uploadFile(wikiMemoryUpload, 'documento'), async (req, res) => {
    const mediaIds = [];
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode importar documentos.');
      if (!req.file?.buffer?.length) throw new WikiError(400, 'Selecione um arquivo PDF ou DOCX.');
      const filename = String(req.file.originalname || '').slice(0, 255);
      const extension = filename.split('.').pop()?.toLowerCase();
      let document;
      let avisos = [];

      if (extension === 'pdf' && req.file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        document = await convertPdfToWikiDocument(req.file.buffer);
      } else if (extension === 'docx' && req.file.buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
        const result = await convertDocxToWikiDocument(req.file.buffer, async (buffer, declaredMime) => {
          if (mediaIds.length >= 50) throw new WikiError(400, 'O documento contém mais de 50 imagens.');
          if (buffer.length > MAX_WIKI_IMAGE_BYTES) throw new WikiError(413, 'Uma imagem do documento excede 5 MB.');
          const mimeType = imageMimeFromBuffer(buffer);
          if (!mimeType || mimeType !== declaredMime) throw new WikiError(400, 'Uma imagem incorporada ao DOCX não é válida.');
          const { rows } = await resolvePool().query(
            'INSERT INTO wiki_midias (mime_type,dados,tamanho,criado_por) VALUES ($1,$2,$3,$4) RETURNING id',
            [mimeType, buffer, buffer.length, editorIdentity(req.user)],
          );
          mediaIds.push(rows[0].id);
          return rows[0].id;
        });
        document = result.document;
        avisos = result.avisos;
      } else {
        throw new WikiError(415, 'Formato não suportado. Envie PDF ou Word moderno (.docx).');
      }

      document = sanitizeWikiDocument(document);
      const basename = filename.replace(/\.(pdf|docx)$/i, '').replace(/[\u0000-\u001f]/g, '').trim();
      res.json({
        titulo: basename.slice(0, 180) || 'Documento importado',
        categoria: 'Importado',
        resumo: '',
        conteudo: document,
        avisos,
      });
    } catch (error) {
      if (mediaIds.length) {
        await resolvePool().query('DELETE FROM wiki_midias WHERE id = ANY($1::int[])', [mediaIds]).catch(() => {});
      }
      if (error instanceof WikiError) return respondError(res, error);
      console.error('[Wiki] erro ao importar documento:', error?.message || error);
      return res.status(422).json({ error: 'Não foi possível converter o documento. Verifique se o PDF/DOCX está íntegro.' });
    }
  });

  router.get('/pages/:slug', async (req, res) => {
    try {
      const { rows } = await resolvePool().query(
        `SELECT id,slug,titulo,categoria,resumo,conteudo,status,portal_publico,criado_por,atualizado_por,criado_em,atualizado_em
         FROM wiki_paginas WHERE slug=$1 AND status <> 'arquivado' AND ($2 = true OR status = 'publicado')`,
        [String(req.params.slug).slice(0, 160), isWikiWriter(req.user)],
      );
      if (!rows.length) return res.status(404).json({ error: 'Artigo não encontrado.' });
      res.json(rows[0]);
    } catch (error) { respondError(res, error); }
  });

  router.post('/pages', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode criar artigos.');
      const titulo = requiredText(req.body?.titulo, 'Título', 180);
      const slug = slugifyWikiTitle(titulo);
      if (!slug) throw new WikiError(400, 'O título precisa conter letras ou números.');
      const categoria = requiredText(req.body?.categoria || 'Geral', 'Categoria', 100);
      const resumo = optionalText(req.body?.resumo, 500);
      const conteudo = sanitizeWikiDocument(req.body?.conteudo);
      const autor = editorName(req.user);
      const page = await inTransaction(resolvePool(), async (client) => {
        const { rows } = await client.query(
          `INSERT INTO wiki_paginas (slug,titulo,categoria,resumo,conteudo,texto_busca,portal_publico,criado_por,atualizado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
           ON CONFLICT (slug) DO NOTHING
           RETURNING id,slug,titulo,categoria,resumo,conteudo,status,portal_publico,criado_por,atualizado_por,criado_em,atualizado_em`,
          [slug, titulo, categoria, resumo, conteudo, extractWikiText(conteudo), req.body?.portal_publico === true, autor],
        );
        if (!rows.length) throw new WikiError(409, 'Já existe um artigo com esse título.');
        await syncWikiMedia(client, rows[0].id, conteudo, req.user);
        return rows[0];
      });
      res.status(201).json(page);
    } catch (error) { respondError(res, error); }
  });

  router.put('/pages/:id', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode editar artigos.');
      const id = parseId(req.params.id);
      const portalPublico = req.body?.portal_publico === true;
      const titulo = requiredText(req.body?.titulo, 'Título', 180);
      const categoria = requiredText(req.body?.categoria || 'Geral', 'Categoria', 100);
      const resumo = optionalText(req.body?.resumo, 500);
      const conteudo = sanitizeWikiDocument(req.body?.conteudo);
      const autor = editorName(req.user);
      const page = await inTransaction(resolvePool(), async (client) => {
        const { rows } = await client.query('SELECT * FROM wiki_paginas WHERE id=$1 FOR UPDATE', [id]);
        if (!rows.length || rows[0].status === 'arquivado') throw new WikiError(404, 'Artigo não encontrado.');
        await saveRevision(client, rows[0], req.user);
        const { rows: updated } = await client.query(
          `UPDATE wiki_paginas SET titulo=$2,categoria=$3,resumo=$4,conteudo=$5,texto_busca=$6,portal_publico=$7,atualizado_por=$8,atualizado_em=NOW()
           WHERE id=$1
           RETURNING id,slug,titulo,categoria,resumo,conteudo,status,portal_publico,criado_por,atualizado_por,criado_em,atualizado_em`,
          [id, titulo, categoria, resumo, conteudo, extractWikiText(conteudo), portalPublico, autor],
        );
        await syncWikiMedia(client, id, conteudo, req.user);
        return updated[0];
      });
      res.json(page);
    } catch (error) { respondError(res, error); }
  });

  router.post('/pages/:id/publicar', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode publicar artigos.');
      const id = parseId(req.params.id);
      const page = await inTransaction(resolvePool(), async (client) => {
        const { rows } = await client.query('SELECT * FROM wiki_paginas WHERE id=$1 FOR UPDATE', [id]);
        if (!rows.length || rows[0].status === 'arquivado') throw new WikiError(404, 'Artigo não encontrado.');
        if (rows[0].status !== 'publicado') await saveRevision(client, rows[0], req.user);
        const { rows: updated } = await client.query(
          `UPDATE wiki_paginas SET status='publicado',atualizado_por=$2,atualizado_em=NOW()
           WHERE id=$1 RETURNING id,slug,titulo,categoria,resumo,status,atualizado_por,atualizado_em`,
          [id, editorName(req.user)],
        );
        return updated[0];
      });
      res.json(page);
    } catch (error) { respondError(res, error); }
  });

  router.post('/pages/:id/arquivar', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode arquivar artigos.');
      const id = parseId(req.params.id);
      const page = await inTransaction(resolvePool(), async (client) => {
        const { rows } = await client.query('SELECT * FROM wiki_paginas WHERE id=$1 FOR UPDATE', [id]);
        if (!rows.length || rows[0].status === 'arquivado') throw new WikiError(404, 'Artigo não encontrado.');
        await saveRevision(client, rows[0], req.user);
        const { rows: updated } = await client.query(
          `UPDATE wiki_paginas SET status='arquivado',atualizado_por=$2,atualizado_em=NOW()
           WHERE id=$1 RETURNING id,slug,titulo,status,atualizado_por,atualizado_em`,
          [id, editorName(req.user)],
        );
        return updated[0];
      });
      res.json(page);
    } catch (error) { respondError(res, error); }
  });

  router.delete('/pages/:id', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode excluir artigos.');
      const id = parseId(req.params.id);
      const { rows } = await resolvePool().query('DELETE FROM wiki_paginas WHERE id=$1 RETURNING id', [id]);
      if (!rows.length) throw new WikiError(404, 'Artigo não encontrado.');
      res.json({ ok: true, id: rows[0].id });
    } catch (error) { respondError(res, error); }
  });

  router.get('/pages/:id/revisoes', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode consultar o histórico.');
      const id = parseId(req.params.id);
      const { rows } = await resolvePool().query(
        'SELECT id,versao,titulo,categoria,resumo,conteudo,status,portal_publico,alterado_por,alterado_em FROM wiki_revisoes WHERE pagina_id=$1 ORDER BY versao DESC LIMIT 100',
        [id],
      );
      res.json(rows);
    } catch (error) { respondError(res, error); }
  });

  router.post('/pages/:id/revisoes/:revisionId/restaurar', async (req, res) => {
    try {
      if (!isWikiWriter(req.user)) throw new WikiError(403, 'Seu perfil não pode restaurar revisões.');
      const id = parseId(req.params.id);
      const revisionId = parseId(req.params.revisionId);
      const page = await inTransaction(resolvePool(), async (client) => {
        const { rows: pages } = await client.query('SELECT * FROM wiki_paginas WHERE id=$1 FOR UPDATE', [id]);
        if (!pages.length || pages[0].status === 'arquivado') throw new WikiError(404, 'Artigo não encontrado.');
        const { rows: revisions } = await client.query(
          'SELECT * FROM wiki_revisoes WHERE id=$1 AND pagina_id=$2', [revisionId, id],
        );
        if (!revisions.length) throw new WikiError(404, 'Revisão não encontrada.');
        await saveRevision(client, pages[0], req.user);
        const revision = revisions[0];
        const { rows } = await client.query(
          `UPDATE wiki_paginas SET titulo=$2,categoria=$3,resumo=$4,conteudo=$5,texto_busca=$6,portal_publico=$7,atualizado_por=$8,atualizado_em=NOW()
           WHERE id=$1 RETURNING id,slug,titulo,categoria,resumo,conteudo,status,portal_publico,criado_por,atualizado_por,criado_em,atualizado_em`,
          [id, revision.titulo, revision.categoria, revision.resumo, revision.conteudo, extractWikiText(revision.conteudo), !!revision.portal_publico, editorName(req.user)],
        );
        await syncWikiMedia(client, id, revision.conteudo, req.user, collectWikiMediaIds(revision.conteudo));
        return rows[0];
      });
      res.json(page);
    } catch (error) { respondError(res, error); }
  });

  return router;
}

function createPublicWikiRouter({ pool, getPool, getPortalConfig }) {
  const router = express.Router();
  const resolvePool = getPool || (() => pool);
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
  let schemaPool;
  let schemaPromise;

  router.use(limiter);
  router.use(async (req, res, next) => {
    try {
      const config = await getPortalConfig();
      if (!config?.ativo || config.wiki_ativa !== true) throw new WikiError(404, 'Wiki pública não encontrada.');
      const activePool = resolvePool();
      if (!activePool) throw new WikiError(503, 'Banco não configurado.');
      if (schemaPool !== activePool) {
        schemaPool = activePool;
        schemaPromise = ensureWikiSchema(activePool).catch((error) => {
          if (schemaPool === activePool) { schemaPool = null; schemaPromise = null; }
          throw error;
        });
      }
      req.wikiPool = activePool;
      await schemaPromise;
      next();
    } catch (error) { respondError(res, error); }
  });

  router.get('/pages', async (req, res) => {
    try {
      const params = [];
      const where = ["p.status='publicado'", 'p.portal_publico=true'];
      const busca = String(req.query.busca || '').trim().slice(0, 120);
      if (busca) {
        params.push(busca);
        where.push(`${SEARCH_VECTOR} @@ websearch_to_tsquery('portuguese', $${params.length})`);
      }
      const categoria = String(req.query.categoria || '').trim().slice(0, 100);
      if (categoria) {
        params.push(categoria);
        where.push(`p.categoria=$${params.length}`);
      }
      const order = busca
        ? `ts_rank(${SEARCH_VECTOR}, websearch_to_tsquery('portuguese', $1)) DESC, p.atualizado_em DESC`
        : 'p.atualizado_em DESC';
      const { rows } = await req.wikiPool.query(
        `SELECT p.slug,p.titulo,p.categoria,p.resumo,p.atualizado_em
         FROM wiki_paginas p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`,
        params,
      );
      res.json(rows);
    } catch (error) { respondError(res, error); }
  });

  router.get('/categorias', async (req, res) => {
    try {
      const { rows } = await req.wikiPool.query(
        `SELECT categoria,COUNT(*)::int AS total FROM wiki_paginas
         WHERE status='publicado' AND portal_publico=true GROUP BY categoria ORDER BY LOWER(categoria)`,
      );
      res.json(rows);
    } catch (error) { respondError(res, error); }
  });

  router.get('/pages/:slug', async (req, res) => {
    try {
      const { rows } = await req.wikiPool.query(
        `SELECT slug,titulo,categoria,resumo,conteudo,atualizado_em FROM wiki_paginas
         WHERE slug=$1 AND status='publicado' AND portal_publico=true`,
        [String(req.params.slug).slice(0, 160)],
      );
      if (!rows.length) throw new WikiError(404, 'Artigo não encontrado.');
      const page = rows[0];
      function publicDocument(node) {
        if (node?.type === 'wikiImage' && node.attrs?.portalPublico !== true) {
          return { type: 'paragraph', content: [{ type: 'text', text: 'Imagem não disponibilizada no portal público.' }] };
        }
        return { ...node, ...(Array.isArray(node?.content) ? { content: node.content.map(publicDocument) } : {}) };
      }
      res.json({ ...page, conteudo: publicDocument(page.conteudo) });
    } catch (error) { respondError(res, error); }
  });

  router.get('/midias/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const { rows } = await req.wikiPool.query(
        `SELECT m.mime_type,m.dados FROM wiki_midias m
         JOIN wiki_pagina_midias pm ON pm.midia_id=m.id
         JOIN wiki_paginas p ON p.id=pm.pagina_id
         WHERE m.id=$1 AND pm.portal_publico=true AND p.portal_publico=true AND p.status='publicado'`,
        [id],
      );
      if (!rows.length) throw new WikiError(404, 'Imagem não encontrada.');
      res.set('Content-Type', rows[0].mime_type)
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'no-store')
        .send(rows[0].dados);
    } catch (error) { respondError(res, error); }
  });

  return router;
}

module.exports = {
  createPublicWikiRouter,
  createWikiRouter,
  ensureWikiSchema,
  extractWikiText,
  isWikiWriter,
  sanitizeWikiDocument,
  slugifyWikiTitle,
  WIKI_INITIAL_PAGES,
};