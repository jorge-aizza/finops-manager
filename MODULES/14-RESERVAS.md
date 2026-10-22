# 14-RESERVAS — Reservas e Savings Plans (multi-cloud)

Compromissos de reserva/savings plan com vigência, custo e vencimento. Tabela `reservas_cloud`,
rotas `/api/reservas`. O cadastro manual cobre Azure, AWS, GCP, Oracle e Multicloud; a
sincronização automática hoje é só Azure.

## Quatro caminhos de entrada, uma tabela

| Caminho | `origem` | Como |
|---|---|---|
| Cadastro manual pela tela | `manual` | `azure_id` fica NULL |
| Sincronização por Service Principal (ARM) | `azure` | `POST /api/reservas/sincronizar-azure` — traz Reservas **e** Savings Plans |
| Export "Reservations" lido do Storage | `storage` | prefixo `reservas_prefix` em `azure_storage_config`, dentro da coleta por Storage |
| Upload do CSV pela tela de Reservas | `import` | `POST /api/reservas/importar` (multipart, campo `arquivo`) — botão "Importar CSV" |

Os três caminhos automáticos convergem na MESMA linha pelo índice único
`uq_reservas_azure_id` — a primeira armadilha abaixo é o motivo de isso funcionar, e o que
quebraria se alguém adicionar uma 4ª via de importação.

**Upload e Storage usam o MESMO parser** (`_importReservasFromCSV`): o que muda é só de onde
vem o arquivo e o valor de `origem`, passado por parâmetro. A separação dos dois valores é
deliberada — "veio do export agendado" e "alguém subiu um arquivo" respondem diferente na hora
de auditar de onde saiu uma linha. A tela mostra isso na coluna Origem, com rótulos distintos.

## Peças principais

| O quê | Onde |
|---|---|
| Mapeadores puros (sem I/O), testáveis isoladamente | `azureReservas.js` |
| Da API ARM → formato da tabela | `mapReservation()`, `mapSavingsPlan()` |
| Do relatório exportado → formato da tabela | `mapReservationRelatorio()` |
| Importação do arquivo — Storage e upload usam esta mesma função | `_importReservasFromCSV(caminho, nome, origem)` (`server.js`) |
| Upload pela tela (multer, 20 MB, arquivo temporário apagado sempre) | `POST /api/reservas/importar` |
| Dicionário de tipo de recurso — os DOIS lados precisam casar | `TIPO_RECURSO` (backend) + `TIPOS_RECURSO.Azure` (`frontend/src/config/reservaScopes.ts`) |
| Permissões exigidas da SP | **Reservations Reader** (`/providers/Microsoft.Capacity`) e **Savings plan Reader** |

**Sem Savings Plans pelo Storage**: o export "Reservations" é só a grade de Reservas. Quem usa
apenas esse caminho não vê Savings Plans até sincronizar também por SP.

## Armadilhas

**Reserva vinda via Storage precisa colidir com a mesma reserva vinda via SP, não duplicar.**
`mapReservationRelatorio()` (`azureReservas.js`) reconstrói o `azure_id` do jeito que a API ARM
grava (`/providers/microsoft.capacity/reservationorders/{order}/reservations/{id}`, minúsculo) a
partir das colunas "Reservation Id" + "Reservation order Id" do export. É o MESMO índice único
(`uq_reservas_azure_id`) que a sincronização por SP já usa — por isso as vias convergem numa
linha só em vez de criar duplicata. O upload pela tela (`origem='import'`) herda isso de graça
porque usa o MESMO mapeador; é também o motivo de ele não precisar de índice próprio. Se um dia
aparecer uma via nova de importação (AWS/GCP/Oracle, ou outro relatório Azure), ela só evita
duplicar reservas que a SP também vê se reconstruir o MESMO formato de id — senão nasce uma 2ª
linha para a mesma reserva física. Pelo mesmo motivo, `opcao_pagamento` fica de fora do
`UPDATE SET` do upsert vindo de relatório: o arquivo nunca traz essa coluna, e incluí-la
apagaria um valor que a sincronização por SP já tinha preenchido.

**Cabeçalho + uma linha real do export Azure estão confirmados; o resto ainda é defensivo.**
Confirmado contra uma linha real (2026-10-22, teste `linha real (AVS, export de produção)`):
`Status: Expired` → Expirada, `Term: P1Y` (formato ISO, não texto "1 Year") → "1 ano", `Scope:
Shared` com "All subscriptions"/"All resource groups" nas colunas de escopo (texto, não vazio —
por isso `mapEscopoRelatorio` ignora essas colunas quando o escopo é Shared, nunca lê como se
fossem um valor real). O link da própria Azure confirmou também que o `azure_id` reconstruído
bate exatamente com o formato real. Ainda SEM amostra real: `Status` com outros textos
("Succeeded"/"Active"/"Cancelled"), e `Scope: Single subscription`/`Single resource group`/
`Management group` — esses continuam por casamento de substring com fallback pela data, não
igualdade exata. Tipo de recurso novo encontrado: `AVS` (Azure VMware Solution), já adicionado
ao dicionário (`TIPO_RECURSO` em `azureReservas.js` + `TIPOS_RECURSO.Azure` no frontend) — é o
padrão a seguir quando aparecer outro tipo não mapeado: aparece como texto cru, não quebra, mas
cadastra no dicionário dos dois lados assim que confirmado, senão o formulário manual não
reconhece a reserva importada ao editar.

**`azureReservas.js` tem seu PRÓPRIO desempate de data M/D vs D/M — não é o mesmo código do `_toDate()` em `server.js`.**
O módulo é deliberadamente "puro, sem I/O" (comentário no topo do arquivo), então a lógica de
desambiguação (lado >12 só pode ser dia; ambíguo → padrão MM/DD) foi PORTADA, não importada —
existem duas cópias. Mudar o comportamento numa não muda a outra. A prova de que isso importava:
numa linha real de reserva, Compra e Vencimento tinham o mesmo par dia/mês ("05/09"), então
"bate 1 ano certinho" era verdade nas duas leituras possíveis — não dava pra confirmar o formato
só por consistência interna, por isso a função antes usava `new Date(v)` cru (parsing
implementation-defined da engine para string não-ISO, funcionava no V8 por coincidência, não por
garantia).

---

See **04-AZURE-API.md** for the Storage collection this import rides on.
