# Arquivos SQL obsoletos (v1.0/v2.0) — NÃO USAR

Estes 7 arquivos foram a base inicial do schema (commits `9ec94dd` e `c7138e6`,
ainda na v1.0/v2.0) e ficaram na raiz do repositório por muito tempo sem
acompanhar a evolução do banco. Hoje (v4.1) eles **divergem** do schema real:

- `azure_costs_migration.sql` define `meter_id` e `subscription_id` como
  `UUID` — o schema atual (inline em `server.js`) usa `VARCHAR(200)`. Rodar
  este script contra um banco novo quebraria o INSERT/UPSERT do código atual.
- `schema.sql` / `init.sql` só criam 2 tabelas (`projetos`, `acoes_finops`),
  com nomes de coluna em inglês/português misturados — o schema atual tem
  mais de 50 tabelas, todas criadas automaticamente pelo `server.js` no boot.
- `migration_fix_nulls.sql`, `normalizar_resource_group.sql`,
  `indices_performance.sql` são correções pontuais já absorvidas pelo
  código atual (normalização via `UPPER()`, índices já criados no startup).
- `rollback_performance_indexes.sql` é o rollback manual da v2.0 — útil só
  como referência histórica, não reflete os índices atuais.

**A fonte de verdade do schema é só o `server.js`** (blocos
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
idempotentes, executados automaticamente a cada boot). Não execute nenhum
destes arquivos manualmente contra um banco de produção.

Mantidos aqui apenas por histórico. Ver `MODULES/06-DATABASE.md`.
