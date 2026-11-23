# 12-DESPERDICIO-ECONOMIA — Órfãos detectados, excluídos e economia auditável

A conta que sustenta o número de economia: **órfão identificado + excluído + custo faturado =
saving auditável**. São dois lados — a DETECÇÃO (o que está órfão agora) e a APURAÇÃO (o que
sumiu da lista viva e virou economia).

## Peças principais

| O quê | Onde |
|---|---|
| Detecção corrente de órfãos | tabela `azure_desperdicio_deteccao` |
| Economia apurada (fato histórico, congelado) | tabela `azure_desperdicio_saving` |
| Apuração: o que sumiu da lista viva virou economia | `_apurarSavingOrfaos()` |
| Resumo das telas (privada e pública usam bases diferentes, de propósito) | `_resumoSavingOrfaos()` |
| Piso de dias como órfão antes de contar | `_SAVING_DIAS_MIN_ORFAO` (30 dias) |
| Categorias que não faturam ao ficar órfãs | `_DESP_CATEGORIAS_SEM_CUSTO` (hoje só `nic_orfa`) |
| "Dias como órfão na exclusão" — ponto ÚNICO de leitura | `diasOrfaoNaExclusao()` em `savingOrfaos.js` |
| Exceção manual, com trilha (quem/quando/por quê) | colunas `ignorado_*` em `azure_desperdicio_saving` |

A apuração também roda após a coleta horária completa dos estados órfãos. Uma coleta parcial de
assinaturas nunca apura ausência, para não transformar falha de permissão em economia. O card
privado “Saving comparável ao portal público” usa toda a allowlist pública e o mesmo recorte de
assinaturas, categorias e Resource Groups do portal, independente do tenant selecionado na lista
privada. O saving principal privado continua incluindo a base completa permitida pela tela.

## Saving de discos e snapshots separados

No portal autenticado, os números são apresentados sem subtrair o custo do snapshot do Saving do disco:

- `saving_disco_mensal` e `saving_disco_acumulado`: economia bruta atribuída somente aos discos excluídos.
- `saving_snapshots_mensal` e `saving_snapshots_acumulado`: run-rate estimado que deixa de ser cobrado após a exclusão confirmada de snapshots, vinculados ou não a discos já contabilizados. O acumulado projeta esse valor mensal desde a data da exclusão do snapshot.
- `saving_outros_mensal` e `saving_outros_acumulado`: economia bruta de outras categorias, como IPs públicos, sem misturá-las com discos ou snapshots.
- `desconto_mensal_snapshots` e `custo_acumulado_snapshots`: custo mensal dos snapshots ainda retidos e custo acumulado estimado durante a retenção, respectivamente. O acumulado projeta o custo mensal observado pelo tempo de retenção; não é a soma exata dos lançamentos da fatura.

O custo pago enquanto o snapshot existiu não é Saving de snapshot. A tela mantém esses custos separados do Saving dos discos. `economia_mensal_bruta` continua sendo o total bruto legado de recursos; `economia_mensal` e `economia_acumulada` continuam líquidos para compatibilidade com consumidores existentes, inclusive o portal público.

## Armadilhas

**Métrica nova tem que usar a MESMA base de recorte da métrica irmã.**
O usuário pegou isto antes dos testes: o card de economia contava disco de PVC/AKS que a tela de
desperdício ao lado já excluía, e o único recurso com custo apurado era justamente um
`pvc-*` num RG `mc_*` — 100% do número exibido estava errado. Antes de mostrar qualquer número
novo, procure a métrica irmã, veja que filtros ela aplica, e ou aplique os mesmos ou explique na
tela por que não. Divergência proposital se expõe ("1 em validação dentro do total"), não se omite.

**`custo_mensal_estimado === null` é "não achamos o billing", NUNCA "é grátis".**
Por isso o recorte do que aparece na visão de FinOps é por TIPO de recurso que não fatura
(`_DESP_CATEGORIAS_SEM_CUSTO`, hoje só `nic_orfa`), não por custo nulo. Medido amostrando 300
recursos vivos de cada tipo: NIC 0/300 faturam; IP público 287/300; disco 293/300; snapshot
273/300. Filtrar por `null` esconderia 182 discos e snapshots reais, um deles órfão há 1242 dias.

**Economia só conta exclusão após 30 dias como órfão (`_SAVING_DIAS_MIN_ORFAO`).**
É o prazo do fluxo real: o time espera isso antes de agir, então exclusão mais rápida veio do
ciclo de vida da infra, não do processo. Vale para todas as categorias. Quem não cumpre o piso
continua visível no detalhe, marcado — "não contabilizamos" é diferente de "não economizamos", e
esconder impediria calibrar o piso. Exceções que a regra não pega têm marcação manual, com motivo
e autor obrigatórios (`ignorado_*` em `azure_desperdicio_saving`).

**Dado que só existe no Resource Graph precisa ser gravado na DETECÇÃO.**
Depois que o recurso é excluído ele some do ARG. `origem_resource_id` (disco que gerou o snapshot,
usado para não contar a mesma economia duas vezes) e `primeira_deteccao_em` são gravados na hora
da detecção/apuração justamente por isso — e `primeira_deteccao_em` fica congelado: "dias como
órfão na data da exclusão" é fato histórico, não algo que deva mudar depois.

**"Dias como órfão" usa `desde_orfao_em`, nunca `primeira_deteccao_em` direto.**
Fix aplicado direto em prod em 19/10/2026 (mesclado depois): `primeira_deteccao_em` é quando
NOSSO coletor viu o recurso pela primeira vez, que pode ser bem depois do Resource Graph já tê-lo
marcado órfão — e isso subestimava os dias, podendo barrar pelo piso de 30 dias (`_SAVING_DIAS_MIN_ORFAO`)
um recurso que na verdade já tinha cumprido. `desde_orfao_em` (`azure_desperdicio_deteccao` e
`azure_desperdicio_saving`) guarda a data REAL do portal (`marcado_orfao_em`, gravada na
detecção, mesmo raciocínio do parágrafo acima), com fallback pra `primeira_deteccao_em` quando
essa data não existe. A leitura é por `diasOrfaoNaExclusao()` (`savingOrfaos.js`) — não reabrir a
conta na mão em `_resumoSavingOrfaos` nem em tela nova, é a função que decide a precedência.

**"Dias no estado atual" é outra métrica, persistida em `azure_desperdicio_estado_historico`.**
O coletor grava episódios horários de NIC/IP sem associação, App Service Plan sem apps, LB/App
Gateway sem backend e VM `PowerState/stopped`. O primeiro ponto é `estado_desde` (observado pelo
FinOps, não necessariamente o começo real); observações seguintes atualizam `ultimo_visto_em` e
preservam esse início. Uma observação completa que não encontre o recurso encerra o episódio.
Falha de Resource Graph nunca encerra episódio: a coleta usa modo estrito e, se necessário,
recua por assinatura. Depois de duas horas sem confirmação, a tela mostra `—` até nova coleta,
em vez de afirmar que o estado continua. Disco e snapshot usam suas datas reais do Azure.
`dias_orfao` permanece inalterado e continua sendo a métrica usada pelo saving e pelo piso do
portal público. A allowlist pública é aplicada antes de anexar a nova duração.

---

See **04-AZURE-API.md** for the Resource Graph collection that feeds detection; **06-DATABASE.md** for `resource_id` case handling.
