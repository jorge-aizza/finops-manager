# 11-LOG-ANALYTICS — Workspaces, retenção, volume e commitment tier

Bloco **"LOG ANALYTICS FINOPS"** em `server.js`. Cobre workspace/tabela/retenção/custo real,
Diagnostic Settings, DCR, Application Insights, auditoria de consultas KQL, Sentinel e
Commitment Tier (contabilizados separados) e sugestão de tier.

## Peças principais

| O quê | Onde |
|---|---|
| Janela do mês corrente (termina no último dia com custo fechado) | `_janelaLogAnalytics()` — é `async` |
| Rollup diário usado para fechar a janela e comparar custos | `azure_custo_diario`, sincronizado após importações API, Storage e manuais |
| Retenção REAL por tabela, usada como clamp | `_laRetencaoTabela()` |
| Volume de ingestão coletado por nós | tabela `log_analytics_ingestao_diaria` |
| Snapshot diário de commitment por workspace | tabela `log_analytics_commitment_snapshot` |
| Sugestão de tier, calibrada pelo preço real por GB da fatura | `_sugerirCommitmentTier()` |
| Progresso de coleta (fase/atual/total por tipo), lido de 2 em 2s | `_laProgresso` (Map), `GET /log-analytics/progresso`, `LogAnalyticsProgressoBar.tsx` |
| Backfill sob demanda, limitado pela retenção real | `_backfillVolumeLogAnalytics()`, `_backfillAtribuicaoRecursoLogAnalytics()` |

## Armadilhas

**A janela do mês corrente corta no último dia com custo fechado.**
`_janelaLogAnalytics()` é `async` e termina no `_ultimoDiaCustoFechado()`, não em hoje — o billing da Azure atrasa. Qualquer tela nova que some custo precisa usar a mesma janela, senão os números não fecham entre cards.
O fechamento lê `azure_custo_diario`, não `azure_costs`: se o rollup ficar para trás, todos os gráficos que compartilham essa janela também cortam cedo, mesmo com a coleta bruta em dia. Cada importação de custo reconstrói apenas os meses afetados; o builder periódico continua como recuperação.

**A coleta própria de GB (`log_analytics_ingestao_diaria`) começou em 30/08/2026.**
Meses anteriores têm cobertura parcial. Número em GB para mês antigo é parcial, não baixo — a tela
avisa via `dias_com_gb` vs `dias_janela`. Dá pra ampliar até onde a Azure ainda guarda, pelo
backfill sob demanda da tela (ver armadilha de retenção abaixo).

**Pedir período maior que a retenção NÃO dá erro — devolve vazio.**
É a armadilha central de qualquer coleta de Log Analytics: a Query API não reclama de um período
já expurgado, só retorna menos, e isso vira "consumo zero" quando o certo é "não sabemos" (mesma
família do `null` vs zero acima). Toda consulta com janela parametrizável precisa passar pelo
clamp contra a retenção REAL antes de sair — `_laRetencaoTabela()`. Medido: 91% das tabelas desta
base retêm 30 dias, `Usage` retém 90 em 188 workspaces e 365 em 3. Use `retencao_dias`
(interativa), nunca `retencao_total_dias`: o total inclui Archive Tier, que exige search job
assíncrono e cobrado por GB varrido — usá-lo prometeria alcance que a consulta não entrega.
O clamp do volume é por workspace; o da atribuição por recurso é **por tabela**, porque cada
tabela do top-N tem retenção própria dentro do mesmo workspace.

---

See **04-AZURE-API.md** for how the Azure credential/token is obtained; **06-DATABASE.md** for table layout.
