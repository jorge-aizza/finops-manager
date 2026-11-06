# 16-WIKI — Base de Conhecimento

## Objetivo e escopo

Base de conhecimento privada dentro do FinOps Manager para guias, FAQs e procedimentos operacionais revisados pelo time. Usa a sessão atual da aplicação e não cria uma conta, serviço ou armazenamento externo.

Não inclui ACL por tenant, edição simultânea, comentários ou respostas por IA. Artigos publicados podem ser liberados individualmente para leitura no Portal Público, sem autenticação; a exposição exige também que o serviço Wiki esteja ativo na configuração administrativa do portal. Imagens são liberadas individualmente. Todos os controles são opt-in e começam desativados. A documentação técnica do código continua em `MODULES/` e no Git; a Wiki deve evitar copiar essa fonte de verdade.

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
| `frontend/src/views/PublicWikiView.tsx` | Leitura pública de artigos explicitamente liberados |
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

O frontend esconde comandos de escrita para leitores por conveniência. A autorização efetiva é aplicada novamente no router. Páginas em rascunho e arquivadas não são retornadas para leitores. A versão do Portal Público usa router separado, sem autenticação, sob `/api/public/wiki`; requer o portal ativo e a flag administrativa `wiki_ativa=true`, e retorna somente artigos publicados com `portal_publico=true`.

## Dados e busca

- `wiki_paginas` guarda slug estável, título, categoria textual, resumo, documento JSONB, texto derivado para busca, status, autor e timestamps.
- `wiki_revisoes` guarda snapshots anteriores, incluindo a flag de exposição pública; a revisão atual é registrada antes de editar, publicar, arquivar ou restaurar.
- Salvar um rascunho mantém o estado de rascunho; salvar um artigo publicado atualiza a versão visível imediatamente e preserva o conteúdo anterior no histórico.
- O schema e os índices são criados idempotentemente na primeira chamada autenticada da API. O router resolve o pool por `getPool`, pois ele começa `null` até o Setup Wizard configurar o banco.
- `wikiConteudoInicial.js` fornece cinco artigos de orientação criados como publicados quando o schema é preparado. O seed usa `ON CONFLICT (slug) DO NOTHING`: não atualiza nem restaura páginas existentes.
- Busca usa `websearch_to_tsquery('portuguese', ...)` e índice GIN. O título, resumo e texto extraído do documento participam da busca.
- Categorias são texto livre com filtro e agrupamento; não existe cadastro separado de categorias no MVP.

## Conteúdo seguro

O documento canônico é JSON TipTap. `sanitizeWikiDocument()` aceita somente os nós e marcas da allowlist, valida níveis de título, alinhamento, fontes, cores, tamanhos, dimensões de tabela e referências a imagens, limita tamanho/profundidade e permite links `http`, `https`, `mailto`, fragmentos e caminhos relativos seguros. Atributos nulos padrão do TipTap são normalizados como ausentes. HTML arbitrário não é aceito nem renderizado com `dangerouslySetInnerHTML`.

O editor inclui estilos de parágrafo, fontes e tamanhos permitidos, cor, alinhamento, listas, tabelas, links, desfazer/refazer e imagens. A ação **Inserir imagens** é independente da importação PDF/Word e aceita várias capturas por seleção, na ordem escolhida, até 50 imagens por artigo. Imagens PNG/JPG/GIF/WEBP ficam em `BYTEA`, com limite de 5 MB cada, acesso autenticado e visibilidade condicionada ao vínculo com artigo; a identidade estável do usuário é preferida para controlar a propriedade.

A importação aceita PDF (até 200 páginas) e Word `.docx`; arquivos são limitados a 12 MB. DOCX pode trazer imagens incorporadas, sujeitas aos limites de imagem e de quantidade por artigo. Imagens permanecem privadas por padrão; o editor permite liberar cada imagem no Portal Público e substituir imagens privadas por um aviso no leitor público. O conteúdo é convertido para JSON TipTap e validado no servidor antes de voltar ao editor; nenhum HTML importado é renderizado diretamente. PDF digitalizado não tem OCR, e formatos antigos `.doc` não são suportados.

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
| `GET /api/wiki/pages/:id/revisoes` | Listar versões anteriores com snapshot JSON TipTap, somente para `admin` e `finops` |
| `POST /api/wiki/pages/:id/revisoes/:revisionId/restaurar` | Restaurar snapshot e preservar o estado anterior |
| `POST /api/wiki/midias/imagens` | Enviar imagem privada para uso no editor; somente escritores |
| `GET /api/wiki/midias/:id` | Obter imagem autenticada, conforme propriedade/vínculo e visibilidade do artigo |
| `POST /api/wiki/importar` | Converter PDF ou DOCX para metadados e documento TipTap; somente escritores |
| `GET /api/public/wiki/pages?busca=&categoria=` | Listar artigos publicados liberados, somente com Portal e Wiki pública ativos |
| `GET /api/public/wiki/categorias` | Listar categorias dos artigos liberados |
| `GET /api/public/wiki/pages/:slug` | Ler artigo liberado; imagens privadas viram aviso no documento |
| `GET /api/public/wiki/midias/:id` | Obter imagem somente quando a mídia e o artigo estiverem liberados |

Slugs são derivados do título na criação e permanecem estáveis quando o título muda. Títulos que resultem no mesmo slug retornam `409`; não renomeie slugs automaticamente sem implementar redirecionamentos.

## Operação e testes

PDF.js e Mammoth são dependências de runtime usadas pelos conversores; as telas privadas e públicas entram no bundle React e devem ser incluídas no build de produção:

```bash
node --test tests/wiki.test.js
npm test --prefix frontend -- src/views/WikiEditor.test.tsx
npm test --prefix frontend -- src/views/WikiView.test.tsx
npm test --prefix frontend -- src/PortalApp.test.tsx
npm run frontend:build
```

Antes de produção, confirme backup do PostgreSQL conforme `MODULES/06-DATABASE.md`. O schema nasce sob demanda na primeira chamada autenticada; a aplicação não deve expor rotas da Wiki sem autenticação.

## Evolução

Próximos candidatos: importar e revisar artigos selecionados de `docs-usuario.html` e FAQs; métricas de busca sem resultado. Cada novo formato de conteúdo deve incluir validação no servidor e testes de autorização.

## Plano de boas práticas: versões e histórico

### Estado atual

- `wiki_revisoes` guarda snapshots do conteúdo anterior com versão, autor, data, status e visibilidade no Portal Público.
- Edição, arquivamento e restauração preservam o estado anterior em transação; restaurar cria uma nova revisão em vez de apagar versões existentes.
- A tela de histórico mostra até 100 revisões, permite pré-visualizar o snapshot somente na Wiki privada e destaca campos diferentes e palavras incluídas/removidas antes da restauração. Ainda não compara mudanças de formatação/estrutura TipTap nem registra motivo da alteração.
- A publicação atualiza o artigo visível imediatamente. Exclusão definitiva remove a página e o histórico relacionado.

### Princípios

- Tratar revisões como imutáveis: correções e restaurações sempre geram uma nova versão, sem editar ou reutilizar snapshots antigos.
- Registrar identidade do autor, instante, ação, origem da alteração e justificativa curta; usar horário UTC no armazenamento e horário local na interface.
- Manter conteúdo privado e público no mesmo artigo como estados de publicação distintos. Histórico, metadados de revisão, comparações e restauração ficam somente na Wiki privada para `admin` e `finops`; a Wiki pública apresenta apenas o conteúdo publicado vigente, sem histórico ou ações de revisão.
- Preferir arquivamento à exclusão; excluir histórico somente por política explícita, perfil autorizado, confirmação e trilha de auditoria.
- Evitar sobrescrita silenciosa quando dois editores trabalham na mesma versão.

### Plano incremental

1. **Integridade e auditoria**: criar uma revisão inicial ao criar o artigo; classificar eventos (criação, edição, publicação, arquivamento e restauração); adicionar motivo opcional e referência à versão restaurada. Preservar cada mutação e seus vínculos de mídia na mesma transação.
2. **Comparação e restauração**: evoluir a comparação textual privada existente para também representar mudanças de formatação e estrutura TipTap com contexto visual claro. Restauração deve continuar criando uma nova revisão e atualizando o índice de busca e os vínculos de mídia.
3. **Publicação controlada**: separar rascunho privado da última versão publicada. Editar um artigo público não deve alterar o conteúdo público até uma ação explícita de publicar; permitir revisar a diferença entre a versão publicada e a proposta. Rascunhos e históricos continuam restritos a `admin` e `finops`.
4. **Concorrência e recuperação**: exigir a versão-base esperada ao salvar e responder conflito recuperável quando o artigo avançou; manter backup do banco, testar restauração e definir retenção operacional sem apagar histórico automaticamente.
5. **Testes de autorização e integridade**: cobrir que leitores públicos recebem somente conteúdo publicado; não conseguem listar revisões, ver rascunhos ou restaurar; alterações de visibilidade e conteúdo são versionadas; restauração não apaga o estado anterior; conflitos entre editores não causam perda silenciosa.

### Critérios de aceite

- Toda alteração relevante é atribuível a uma pessoa e a uma versão, e revisões existentes não são editadas.
- Antes de restaurar, o editor consegue identificar o que mudou entre a versão atual e a selecionada, incluindo conteúdo e estado de publicação.
- Uma restauração é reversível pela própria linha do tempo e recompõe conteúdo, busca e mídias autorizadas.
- O Portal Público mostra somente a publicação vigente; mudanças em edição não ficam visíveis antes da publicação explícita.
- Edição concorrente é detectada e apresentada ao editor sem descartar conteúdo silenciosamente.
- Exclusão permanente é excepcional, autorizada e coberta por política de retenção e backup testado.