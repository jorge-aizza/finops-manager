# 17-INVENTARIO — Recursos, autoria, carência de dias e reconciliação

Rastreia **todo** recurso Azure das assinaturas configuradas: quando nasceu, quem criou, o que
mudou, quando morreu. Pedido original do usuário: *"ontem tinha X recursos, hoje tenho X+1 — quem
criou, quando, quanto custa"*. 10 abas na tela (`InventarioView.tsx`), ~20 rotas em
`/api/azure-inventario/*`.

## Peças principais

| O quê | Onde |
|---|---|
| Permanente, 1 linha por recurso, `ativo=false` quando excluído | `azure_recursos_inventario` |
| Log de eventos (CRIACAO/ATUALIZACAO/EXCLUSAO), com retenção configurável | `azure_recursos_auditoria_eventos` |
| Antes/depois por propriedade curada (tag, SKU, disco, IP...) | `azure_recursos_mudancas_propriedade` |
| Coleta incremental por watermark, fonte única | `_coletarInventarioAzure()`, Resource Graph Change Analysis |
| Reconciliação semanal (corrige o que a Change Analysis perdeu) | `_reconciliarInventarioResourceGraph()`, `inventarioReconcile.js` |
| GUID→nome via Microsoft Graph, cache permanente | `_graphResolveAutores()`, `azure_autores_cache` |
| Idade de um recurso vivo, em dias — cai em `detectado_em` se faltar `criado_em` | `_invIdadeDiasSql(alias)` |
| Tempo de vida de um recurso já excluído, em dias | `_invVidaDiasSql(alias)` |
| Piso de carência — recurso vira "persistente" com esta idade | `_INV_DIAS_MIN_PERSISTENTE` (7) |
| Purga opcional por tempo de vida (DELETE permanente, opt-in) | `_purgarRecursosEfemeros()` |

## Fonte da coleta: só Resource Graph Change Analysis

O Activity Log foi abandonado no "Inventário 2.0" — nenhum código ativo o consulta para
inventário; menções a ele em UI/comentários antigos são texto legado. `_coletarInventarioAzure`
roda a cada hora, janela incremental por `ultimo_evento_em` (teto de 13 dias — a retenção nativa
da Change Analysis é 14), com margem de 5 min para indexação. "Novo" = primeira vez que o
`resource_id` aparece no banco, não `changeType === 'Create'` (o tipo cru vai para
`operation_name`).

## Armadilhas

**A unidade de verdade da idade é `COALESCE(criado_em, detectado_em)`, nunca só `criado_em`.**
71% do inventário ativo (26.915 de 37.795 nesta base) vem da **reconciliação** — varredura do
Resource Graph — e não tem `criado_em`: o recurso já existia antes do Inventário existir. Duas
consultas que tinham piso de 7 dias descartavam esses recursos (uma pela comparação com NULL,
outra por `COALESCE(...,0)`), e com isso mediam 19% do parque achando que mediam tudo. `criado_em
IS NULL` **não** é "sempre existiu" nem "não existe" — `detectado_em` é o limite inferior real: o
recurso já estava lá quando o Resource Graph o varreu. Toda consulta nova com piso de idade usa
`_invIdadeDiasSql(alias)`; nunca calcule `EXTRACT(EPOCH FROM (NOW() - criado_em))` à mão — há teste
(`tests/inventarioPersistencia.test.js`) que varre `server.js` atrás disso.

**Filtrar efêmeros por TIPO de recurso ou por RG gerenciado não resolve — mede idade.**
Medido em 2026-11 nesta base: 1,53 milhão de recursos já excluídos, 99,2% com vida < 1 dia (disco
+ NIC + VM de autoescala nascendo e morrendo juntos). RG gerenciado (`_detectManagedRg`:
`DATABRICKS-RG-`, `MANAGED-RG-*`, `MC_`) cobre só metade — a outra metade dos efêmeros está em RGs
comuns. O Top Criadores e a lista de Recursos usam o piso de idade (`_INV_DIAS_MIN_PERSISTENTE`),
não o filtro de RG, para não contar nó de cluster como "recurso criado por fulano".

**Recurso novo aparece marcado, nunca escondido.** `persistente=false` não tira da lista — a tela
mostra "⏳ provisório" com o número de dias no ar. Omitir o que ainda não cumpriu a carência faria
quem criou algo hoje achar que o Inventário está quebrado. Mesma convenção de
`feedback-consistencia-metricas`: divergência proposital se expõe, não se omite.

**`atualizado_em` não serve como proxy de idade ou de "última atividade real".** A reconciliação
semanal sobrescreve `atualizado_em = NOW()` em **todo** recurso ativo encontrado no Resource Graph,
estando ele parado ou não. Uma regra que usasse esse campo para medir recência mediria "quando a
reconciliação rodou", não o recurso. O único uso legítimo de `atualizado_em` aqui é `ref_em =
GREATEST(criado_em, atualizado_em, detectado_em)` em `inventarioReconcile.js`, para proteger
recurso recém-tocado contra desativação por snapshot desatualizado — semântica de proteção, não de
idade.

**`azure_inventario_coleta_historico.origem` é `VARCHAR(40)` por boa razão — já estourou uma vez.**
A reconciliação grava `'reconciliacao_' + origem`. Com `origem='manual'` dá exatos 20 caracteres;
com `'agendado'` dá 22. A coluna nasceu `VARCHAR(20)`: a reconciliação **semanal agendada falhava
toda vez**, no primeiro INSERT, sem nem deixar linha no histórico — só a manual (testada à mão)
funcionava. `tests/inventarioHistoricoOrigem.test.js` lê a largura efetiva da coluna (DDL + ALTERs)
contra todas as origens que o código constrói; alargar de novo é seguro (idempotente), estreitar
não.

**Duas retenções de recursos excluídos, critérios diferentes — não confundir.**
`retencao_excluidos_*` apaga pela idade do **registro de exclusão** (`excluido_em < NOW() - dias`,
default 180). `purgar_efemeros_*` apaga pelo **tempo de vida** (`excluido_em - criado/detectado_em
< dias`, default 1, opt-in, desligado por padrão). As duas são DELETE permanente — nunca tocam
`ativo=true`. A segunda existe por pedido explícito do usuário, só depois de confirmação: 1,53
milhão de linhas efêmeras é dado real, apagar é decisão de produto, não só de engenharia.

**Autoria em GUID cru não é bug de código — é permissão faltando.** `_graphResolveAutores` lê a
claim `roles` do token e recusa chamar o Graph sem `Directory.Read.All` (ou
`Directory.ReadWrite.All`) no Service Principal — erro explícito, não silencioso. Sem a permissão,
`azure_autores_cache` fica vazio e a tela cai no GUID cru (`criado_por_nome || criado_por ||
'desconhecido'`). Resolve-se no Entra ID, concedendo a permissão de aplicativo e o consentimento de
admin; não há segunda fonte de autoria (sem tag `Owner`, sem Activity Log de fallback).

---

See **04-AZURE-API.md** for Resource Graph/multi-SP credential scoping; **06-DATABASE.md** for
table layout; **15-TESTING.md** for the `new Function(...)` extraction technique used to test
`server.js` functions without a live server.
