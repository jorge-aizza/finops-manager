# 16-WIKI — Base de Conhecimento

## Objetivo e escopo

Base de conhecimento privada dentro do FinOps Manager para guias, FAQs e procedimentos operacionais revisados pelo time. Usa a sessão atual da aplicação e não cria uma conta, serviço ou armazenamento externo.

O MVP não inclui conteúdo público, ACL por tenant, edição simultânea, comentários, anexos ou respostas por IA. A documentação técnica do código continua em `MODULES/` e no Git; a Wiki deve evitar copiar essa fonte de verdade.

## Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `wiki.js` | Router Express, validação do documento, schema PostgreSQL, revisões e permissões |
| `frontend/src/api/wiki.ts` | Cliente da API autenticada |
| `frontend/src/types/wiki.ts` | Contratos de página, categoria, revisão e documento TipTap |
| `frontend/src/views/WikiView.tsx` | Busca, categorias, leitura, publicação, arquivamento e histórico |
| `frontend/src/views/WikiEditor.tsx` | Edição TipTap e metadados do artigo |
| `frontend/src/views/WikiView.css` | Layout responsivo da Wiki |
| `tests/wiki.test.js` | Validação de conteúdo, perfis, autenticação e filtro de rascunhos |
| `frontend/src/views/WikiView.test.tsx` | Estado inicial, busca e controles por perfil |

## Acesso

Todas as rotas ficam sob `/api/wiki` e passam por `authMiddleware` e `dbMiddleware`.

| Perfil | Permissão |
|--------|-----------|
| `admin` | Ler, criar, editar, publicar, arquivar e restaurar revisões |
| `finops` | Ler, criar, editar, publicar, arquivar e restaurar revisões |
| `reader` | Ler páginas publicadas e pesquisar conteúdo publicado |

O frontend esconde comandos de escrita para leitores por conveniência. A autorização efetiva é aplicada novamente no router. Páginas em rascunho e arquivadas não são retornadas para leitores.

## Dados e busca

- `wiki_paginas` guarda slug estável, título, categoria textual, resumo, documento JSONB, texto derivado para busca, status, autor e timestamps.
- `wiki_revisoes` guarda snapshots anteriores; a revisão atual é registrada antes de editar, publicar, arquivar ou restaurar.
- Salvar um rascunho mantém o estado de rascunho; salvar um artigo publicado atualiza a versão visível imediatamente e preserva o conteúdo anterior no histórico.
- O schema e os índices são criados idempotentemente na primeira chamada autenticada da API. O router resolve o pool por `getPool`, pois ele começa `null` até o Setup Wizard configurar o banco.
- `wikiConteudoInicial.js` fornece cinco artigos de orientação criados como publicados quando o schema é preparado. O seed usa `ON CONFLICT (slug) DO NOTHING`: não atualiza nem restaura páginas existentes.
- Busca usa `websearch_to_tsquery('portuguese', ...)` e índice GIN. O título, resumo e texto extraído do documento participam da busca.
- Categorias são texto livre com filtro e agrupamento; não existe cadastro separado de categorias no MVP.

## Conteúdo seguro

O documento canônico é JSON TipTap. `sanitizeWikiDocument()` aceita somente os nós e marcas necessários ao StarterKit, valida níveis de título, limita tamanho/profundidade e permite links `http`, `https`, `mailto`, fragmentos e caminhos relativos seguros. HTML arbitrário não é aceito nem renderizado com `dangerouslySetInnerHTML`.

Ao ampliar o editor, a allowlist do backend e as extensões TipTap devem mudar juntas. Não adicionar imagem, embed ou atributo de HTML sem validar tipo, tamanho, URL e armazenamento.

## API

| Método e caminho | Uso |
|------------------|-----|
| `GET /api/wiki/pages?busca=&categoria=` | Listar e pesquisar páginas visíveis ao perfil |
| `GET /api/wiki/categorias` | Listar categorias e totais visíveis ao perfil |
| `GET /api/wiki/pages/:slug` | Abrir artigo |
| `POST /api/wiki/pages` | Criar rascunho |
| `PUT /api/wiki/pages/:id` | Editar artigo e guardar snapshot anterior |
| `POST /api/wiki/pages/:id/publicar` | Publicar rascunho |
| `POST /api/wiki/pages/:id/arquivar` | Arquivar sem apagar o histórico |
| `GET /api/wiki/pages/:id/revisoes` | Listar versões anteriores |
| `POST /api/wiki/pages/:id/revisoes/:revisionId/restaurar` | Restaurar snapshot e preservar o estado anterior |

Slugs são derivados do título na criação e permanecem estáveis quando o título muda. Títulos que resultem no mesmo slug retornam `409`; não renomeie slugs automaticamente sem implementar redirecionamentos.

## Operação e testes

Não há nova dependência de runtime. A tela entra no bundle autenticado React e deve ser incluída no build de produção:

```bash
node --test tests/wiki.test.js
npm test --prefix frontend -- src/views/WikiView.test.tsx
npm run frontend:build
```

Antes de produção, confirme backup do PostgreSQL conforme `MODULES/06-DATABASE.md`. O schema nasce sob demanda na primeira chamada autenticada; a aplicação não deve expor rotas da Wiki sem autenticação.

## Evolução

Próximos candidatos: importar e revisar artigos selecionados de `docs-usuario.html` e FAQs; upload protegido de anexos; comparação visual de revisões; métricas de busca sem resultado. Cada novo formato de conteúdo deve incluir validação no servidor e testes de autorização.