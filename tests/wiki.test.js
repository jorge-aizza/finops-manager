'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { createWikiRouter, extractWikiText, isWikiWriter, sanitizeWikiDocument, slugifyWikiTitle, WIKI_INITIAL_PAGES } = require('../wiki');

test('slug da Wiki normaliza acentos e remove caracteres fora do caminho', () => {
  assert.equal(slugifyWikiTitle('  Guia de FinOps: Ação & Custo  '), 'guia-de-finops-acao-custo');
  assert.equal(slugifyWikiTitle('東京'), '');
});

test('documento aceita blocos e marcas suportados e extrai texto para busca', () => {
  const documento = sanitizeWikiDocument({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Custos', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Veja o ', marks: [] }, { type: 'text', text: 'guia', marks: [{ type: 'link', attrs: { href: 'https://exemplo.com/guia' } }] }] },
    ],
  });

  assert.equal(documento.content[0].attrs.level, 2);
  assert.match(extractWikiText(documento), /Custos/);
  assert.match(extractWikiText(documento), /guia/);
});

test('documento rejeita HTML, protocolos inseguros e headings fora do schema', () => {
  assert.throws(() => sanitizeWikiDocument({ type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] }), /Tipo de bloco não permitido/);
  assert.throws(() => sanitizeWikiDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }), /Protocolo de link não permitido/);
  assert.throws(() => sanitizeWikiDocument({ type: 'doc', content: [{ type: 'heading', attrs: { level: 6 }, content: [] }] }), /Nível de título inválido/);
});

test('somente perfis admin e finops podem editar a Wiki', () => {
  assert.equal(isWikiWriter({ perfil: 'admin' }), true);
  assert.equal(isWikiWriter({ perfil: 'finops' }), true);
  assert.equal(isWikiWriter({ perfil: 'reader' }), false);
  assert.equal(isWikiWriter(null), false);
});

test('conteúdo inicial tem slugs únicos e usa somente blocos TipTap permitidos', () => {
  const slugs = WIKI_INITIAL_PAGES.map((page) => page.slug);
  assert.equal(new Set(slugs).size, WIKI_INITIAL_PAGES.length);
  for (const page of WIKI_INITIAL_PAGES) {
    assert.doesNotThrow(() => sanitizeWikiDocument(page.conteudo), page.titulo);
    assert.ok(extractWikiText(page.conteudo).length > 0, page.titulo);
  }
});

test('router exige autenticacao e filtra rascunhos para leitores', async (t) => {
  const queries = [];
  let page;
  let revisionCount = 0;
  const pool = {
    async query(sql, values = []) {
      queries.push(sql);
      if (sql.includes('SELECT p.id')) {
        return { rows: [{ id: 1, slug: 'guia', titulo: 'Guia', categoria: 'Geral', resumo: null, status: 'publicado', atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z' }] };
      }
      if (sql.includes('INSERT INTO wiki_paginas')) {
        page = {
          id: 7, slug: values[0], titulo: values[1], categoria: values[2], resumo: values[3], conteudo: values[4],
          status: 'rascunho', criado_por: values[6], atualizado_por: values[6], criado_em: '2026-10-30T00:00:00Z', atualizado_em: '2026-10-30T00:00:00Z',
        };
        return { rows: [page] };
      }
      if (sql.includes('FROM wiki_paginas WHERE slug=$1')) {
        return { rows: page?.slug === values[0] && (values[1] || page.status === 'publicado') ? [page] : [] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          queries.push(sql);
          if (sql.startsWith('SELECT * FROM wiki_paginas')) return { rows: page ? [{ ...page }] : [] };
          if (sql.startsWith('SELECT COALESCE(MAX(versao)')) return { rows: [{ versao: revisionCount + 1 }] };
          if (sql.startsWith('INSERT INTO wiki_revisoes')) { revisionCount += 1; return { rows: [] }; }
          if (sql.startsWith("UPDATE wiki_paginas SET status='publicado'")) {
            page = { ...page, status: 'publicado', atualizado_por: values[1] };
            return { rows: [{ id: page.id, slug: page.slug, titulo: page.titulo, categoria: page.categoria, resumo: page.resumo, status: page.status, atualizado_por: page.atualizado_por, atualizado_em: page.atualizado_em }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  let activePool = null;
  const app = express();
  app.use(express.json());
  app.use('/api/wiki', createWikiRouter({
    getPool: () => activePool,
    authMiddleware(req, res, next) {
      const token = req.headers.authorization;
      if (!token) return res.status(401).json({ error: 'Token ausente' });
      req.user = { perfil: token === 'Bearer writer' ? 'finops' : 'reader' };
      next();
    },
    dbMiddleware(_req, _res, next) { next(); },
  }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  activePool = pool;
  const url = `http://127.0.0.1:${server.address().port}/api/wiki/pages`;

  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 401);
  assert.equal(queries.length, 0);

  const reader = await fetch(url, { headers: { Authorization: 'Bearer reader' } });
  assert.equal(reader.status, 200);
  assert.match(queries.at(-1), /p\.status = 'publicado'/);
  assert.equal((await reader.json())[0].slug, 'guia');
  assert.equal(queries.filter((sql) => sql.includes('ON CONFLICT (slug) DO NOTHING')).length, WIKI_INITIAL_PAGES.length);

  const conteudo = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Procedimento FinOps' }] }] };
  const createdResponse = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer writer', 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: 'Guia de FinOps', categoria: 'Operação', conteudo }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.slug, 'guia-de-finops');
  assert.equal(created.status, 'rascunho');

  const hiddenDraft = await fetch(`${url}/guia-de-finops`, { headers: { Authorization: 'Bearer reader' } });
  assert.equal(hiddenDraft.status, 404);

  const publishedResponse = await fetch(`${url}/7/publicar`, {
    method: 'POST', headers: { Authorization: 'Bearer writer', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(publishedResponse.status, 200);
  assert.equal((await publishedResponse.json()).status, 'publicado');
  assert.equal(revisionCount, 1);

  const visiblePage = await fetch(`${url}/guia-de-finops`, { headers: { Authorization: 'Bearer reader' } });
  assert.equal(visiblePage.status, 200);
  assert.equal((await visiblePage.json()).slug, 'guia-de-finops');

  const replacementQueries = [];
  activePool = {
    async query(sql) {
      replacementQueries.push(sql);
      if (sql.includes('SELECT p.id')) return { rows: [] };
      return { rows: [] };
    },
  };
  const afterSetupChange = await fetch(url, { headers: { Authorization: 'Bearer reader' } });
  assert.equal(afterSetupChange.status, 200);
  assert.ok(replacementQueries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS wiki_paginas')));
  assert.equal(replacementQueries.filter((sql) => sql.includes('ON CONFLICT (slug) DO NOTHING')).length, WIKI_INITIAL_PAGES.length);

  const forbidden = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer reader', 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: 'Sem permissão' }),
  });
  assert.equal(forbidden.status, 403);
});