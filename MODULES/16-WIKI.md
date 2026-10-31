# 16-WIKI — Base de Conhecimento

## Objetivo e escopo

Base de conhecimento privada dentro do FinOps Manager para guias, FAQs e procedimentos operacionais revisados pelo time. Usa a sessão atual da aplicação e não cria uma conta, serviço ou armazenamento externo.

Não inclui conteúdo público, ACL por tenant, edição simultânea, comentários ou respostas por IA. A documentação técnica do código continua em `MODULES/` e no Git; a Wiki deve evitar copiar essa fonte de verdade.

## Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `wiki.js` | Router Express, validação do documento, schema PostgreSQL, revisões e permissões |
| `frontend/src/api/wiki.ts` | Cliente da API autenticada |
| `frontend/src/types/wiki.ts` | Contratos de página, categoria, revisão e documento TipTap |
| `frontend/src/views/WikiView.tsx` | Busca, categorias, leitura, publicação, arquivamento e histórico |
| `frontend/src/views/WikiEditor.tsx` | Editor TipTap, formatação, tabelas, upload de imagens e importação |
| `frontend/src/views/WikiExtensions.tsx` | Extensões TipTap compartilhadas e renderização autenticada de imagens |
| `wikiImport.js` | Conversão de DOCX/PDF em documento TipTap validável |
| `frontend/src/views/WikiView.css` | Layout responsivo da Wiki |
| `tests/wiki.test.js` | Validação de conteúdo, perfis, autenticação e filtro de rascunhos |
| `tests/wikiImport.test.js` | Conversão e limites dos formatos importados |
| `frontend/src/views/WikiView.test.tsx` | Estado inicial, busca e controles por perfil |
| `frontend/src/views/WikiEditor.test.tsx` | Formatação, importação e envio de imagens |

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

O documento canônico é JSON TipTap. `sanitizeWikiDocument()` aceita somente os nós e marcas da allowlist, valida níveis de título, alinhamento, fontes, cores, tamanhos, dimensões de tabela e referências a imagens, limita tamanho/profundidade e permite links `http`, `https`, `mailto`, fragmentos e caminhos relativos seguros. Atributos nulos padrão do TipTap são normalizados como ausentes. HTML arbitrário não é aceito nem renderizado com `dangerouslySetInnerHTML`.

O editor inclui estilos de parágrafo, fontes e tamanhos permitidos, cor, alinhamento, listas, tabelas, links, desfazer/refazer e imagens. A ação **Inserir imagens** é independente da importação PDF/Word e aceita várias capturas por seleção, na ordem escolhida, até 50 imagens por artigo. Imagens PNG/JPG/GIF/WEBP ficam em `BYTEA`, com limite de 5 MB cada, acesso autenticado e visibilidade condicionada ao vínculo com artigo; a identidade estável do usuário é preferida para controlar a propriedade.

A importação aceita PDF (até 200 páginas) e Word `.docx`; arquivos são limitados a 12 MB. DOCX pode trazer imagens incorporadas, sujeitas aos limites de imagem e de quantidade por artigo. O conteúdo é convertido para JSON TipTap e validado no servidor antes de voltar ao editor; nenhum HTML importado é renderizado diretamente. PDF digitalizado não tem OCR, e formatos antigos `.doc` não são suportados.

No Nginx de produção, `/api/wiki/` deve aceitar corpos de pelo menos 15 MB para comportar o limite de 12 MB do arquivo mais o envelope multipart. A configuração de referência fica em `deploy/finopsmanager.redecorp.br.conf`; no servidor atual, o arquivo ativo é `/etc/nginx/conf.d/finopsmanager.redecorp.br.conf`. Sem `client_max_body_size`, o padrão de 1 MB rejeita os uploads antes de chegarem ao Express. Após aplicar a exceção de `/api/wiki/`, valide com `nginx -t` e recarregue o Nginx.

Ao ampliar o editor, a allowlist do backend e as extensões TipTap devem mudar juntas. Não adicionar embed ou atributo de HTML sem validar tipo, tamanho, URL e armazenamento.

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
| `DELETE /api/wiki/pages/:id` | Excluir definitivamente o artigo e suas revisões; somente escritores |
| `GET /api/wiki/pages/:id/revisoes` | Listar versões anteriores |
| `POST /api/wiki/pages/:id/revisoes/:revisionId/restaurar` | Restaurar snapshot e preservar o estado anterior |
| `POST /api/wiki/midias/imagens` | Enviar imagem privada para uso no editor; somente escritores |
| `GET /api/wiki/midias/:id` | Obter imagem autenticada, conforme propriedade/vínculo e visibilidade do artigo |
| `POST /api/wiki/importar` | Converter PDF ou DOCX para metadados e documento TipTap; somente escritores |

Slugs são derivados do título na criação e permanecem estáveis quando o título muda. Títulos que resultem no mesmo slug retornam `409`; não renomeie slugs automaticamente sem implementar redirecionamentos.

## Operação e testes

PDF.js e Mammoth são dependências de runtime usadas pelos conversores; a tela entra no bundle autenticado React e deve ser incluída no build de produção:

```bash
node --test tests/wiki.test.js
npm test --prefix frontend -- src/views/WikiEditor.test.tsx
npm test --prefix frontend -- src/views/WikiView.test.tsx
npm run frontend:build
```

Antes de produção, confirme backup do PostgreSQL conforme `MODULES/06-DATABASE.md`. O schema nasce sob demanda na primeira chamada autenticada; a aplicação não deve expor rotas da Wiki sem autenticação.

## Evolução

Próximos candidatos: importar e revisar artigos selecionados de `docs-usuario.html` e FAQs; comparação visual de revisões; métricas de busca sem resultado. Cada novo formato de conteúdo deve incluir validação no servidor e testes de autorização.