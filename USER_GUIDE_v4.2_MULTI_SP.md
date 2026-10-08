# 📘 Guia de Uso — FinOps Manager v4.2 (Coletas Simultâneas Multi-Tenant)

**Versão:** 4.2.1  
**Data:** 2026-10-08  
**Português:** 🇧🇷

---

## 🎯 Novidades na v4.2

### ✨ **Agora você pode coletar de MÚLTIPLAS Service Principals simultaneamente!**

**Antes (v4.1):**
- SP-Produção coleta: 10 minutos
- SP-Integrações aguarda...
- SP-Sandbox aguarda...
- **Total: 30 minutos** (todas sequenciais)

**Agora (v4.2):**
- SP-Produção coleta: 10 min
- SP-Integrações coleta: 10 min ← ao mesmo tempo!
- SP-Sandbox coleta: 10 min ← ao mesmo tempo!
- **Total: 10 minutos** (todas paralelas) ⚡

---

## 📍 Onde Ver as Coletas Paralelas

### 1️⃣ **Dashboard (Home)**

Ao abrir o FinOps Manager, você verá:

```
┌─────────────────────────────────────────────────┐
│                    DASHBOARD                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  📊 COLETAS ATIVAS (v4.2)                       │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 🟢 SP-Produção (api:7)                   │  │
│  │ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░ │ 60% │
│  │ Iniciada: 14:30 | Tempo: 2m 15s         │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 🟢 SP-Integrações (api:8)                 │  │
│  │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 40% │
│  │ Iniciada: 14:30 | Tempo: 1m 50s         │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 🟡 Storage Config (storage:5)             │  │
│  │ ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 15% │
│  │ Iniciada: 14:30 | Tempo: 45s             │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Total: 3 coletas rodando em paralelo ⚡       │
│                                                 │
└─────────────────────────────────────────────────┘
```

**O que você vê:**
- ✅ Cada SP tem seu próprio **card de progresso**
- ✅ Percentual atualiza em tempo real
- ✅ Tempo decorrido desde o início
- ✅ Todas avançam **ao mesmo tempo** (não uma por vez)

---

### 2️⃣ **Menu → Coleta Azure → (Monitoramento ao vivo)**

Clique em **Coleta Azure** para ver o painel de monitoramento:

```
┌────────────────────────────────────────────────┐
│      COLETA AZURE — Monitor em Tempo Real      │
├────────────────────────────────────────────────┤
│                                                │
│  Execução 1 de 3                              │
│  ─────────────────────────────────────────────│
│                                                │
│  📌 SP-Produção (api:7)                       │
│                                                │
│  Status: Processando assinatura 2/5           │
│  Log:                                          │
│    14:30:02 Iniciando coleta...               │
│    14:30:05 Conectado a Azure (3s)           │
│    14:30:15 Processando sub-1: sub123...     │
│    14:30:22 Lendo 1.245 registros            │
│    14:30:35 Inserindo no banco... (350/1245) │
│                                                │
│  Progresso: ████████████░░░░░░░░░░░░░░░░░ 60% │
│                                                │
│  [🔴 Cancelar esta coleta]                    │
│                                                │
│  ─────────────────────────────────────────────│
│                                                │
│  Execução 2 de 3                              │
│  ─────────────────────────────────────────────│
│                                                │
│  📌 SP-Integrações (api:8)                    │
│                                                │
│  Status: Processando assinatura 1/3           │
│  Log:                                          │
│    14:30:02 Iniciando coleta...               │
│    14:30:06 Conectado a Azure (4s)           │
│    14:30:18 Lendo 856 registros              │
│    14:30:32 Inserindo no banco... (200/856)  │
│                                                │
│  Progresso: ████████░░░░░░░░░░░░░░░░░░░░░░░░ 40% │
│                                                │
│  [🔴 Cancelar esta coleta]                    │
│                                                │
│  ─────────────────────────────────────────────│
│                                                │
│  Execução 3 de 3                              │
│  ─────────────────────────────────────────────│
│                                                │
│  📌 Storage Config (storage:5)                │
│                                                │
│  Status: Processando container 1/12          │
│  [...]                                        │
│                                                │
└────────────────────────────────────────────────┘
```

**Recursos:**
- ✅ Ver **logs detalhados** de cada coleta
- ✅ **Cancelar seletivamente** uma coleta (não bloqueia as outras)
- ✅ Atualização em tempo real a cada 2-3 segundos

---

### 3️⃣ **Menu → Coleta Azure → Histórico**

Veja o **histórico completo** de todas as coletas:

```
┌──────────────────────────────────────────────────────────────────┐
│                    HISTÓRICO DE COLETAS                          │
├──────┬──────────┬────────┬──────────┬────────────┬──────────┬────┤
│ID    │SP        │Tipo    │Status    │Início      │Duração   │Reg │
├──────┼──────────┼────────┼──────────┼────────────┼──────────┼────┤
│ 63   │SP-Prod   │API     │✅ Ok    │14:30 (hoje)│ 10m 23s │1847 │
│ 62   │SP-Integ  │API     │✅ Ok    │14:30 (hoje)│  8m 15s │1456 │
│ 61   │Storage   │Blob    │✅ Ok    │14:30 (hoje)│  4m 38s │ 892 │
│ 60   │SP-Prod   │API     │❌ Erro  │13:00 (hoje)│  5m 32s │  450│
│ 59   │SP-Integ  │API     │✅ Ok    │13:00 (hoje)│  9m 18s │1523 │
│ 58   │Storage   │Blob    │✅ Ok    │13:00 (hoje)│  3m 45s │ 621 │
│...   │...       │...     │...      │...         │...      │...  │
└──────┴──────────┴────────┴──────────┴────────────┴──────────┴────┘

Filtros: [SP: Todas ▼] [Tipo: Todas ▼] [Status: Todas ▼]

📊 Resumo:
  • Total de coletas: 3 (últimas 30 min)
  • Últimas paralelas: 3 SPs (14:30) = 10 min total
  • Última paralela anterior: 3 SPs (13:00) = 9 min 18s total
```

**O que mudou:**
- ✅ Agora mostra **cada SP como linha separada** (antes era 1 linha)
- ✅ Você vê **quando rodaram em paralelo** (mesmo horário inicial)
- ✅ Tempo total **muito menor** com parallelismo

---

## ⏰ Como Agendar Coletas

### Novo Interface: HH:MM + "A cada 1 dia"

**Passo 1:** Menu → Coleta Azure → Selecione uma SP → ⚙ **Agendamento**

```
┌───────────────────────────────────────────────────┐
│    Agendamento — SP-Produção                      │
├───────────────────────────────────────────────────┤
│                                                   │
│  ☑ Coleta automática recorrente                  │
│                                                   │
│  Horário:  [14] : [30]  🌙 Noite                 │
│                                                   │
│  ○ A cada 1 dia (NOVO!)  ← Inteligente!         │
│  ◉ Dias específicos da semana                    │
│     ☑ Seg ☑ Ter ☑ Qua ☑ Qui ☑ Sex ☐ Sáb ☐ Dom │
│                                                   │
│  Granularidade (dias por coleta): [1]            │
│  └─→ Muda automático para 1 quando selecionado!  │
│                                                   │
│  ─────────────────────────────────────────────── │
│  [▶ Coletar agora (últimos 7 dias)]              │
│  ─────────────────────────────────────────────── │
│                                                   │
│                              [Cancelar] [Salvar]  │
│                                                   │
│  {Se agendada}                                   │
│  [Remover agendamento]                           │
│                                                   │
└───────────────────────────────────────────────────┘
```

### ✨ Novas Features

#### 1. **Horário Completo (HH:MM)**

**Antes:** Você só podia escolher a hora (0-23)
```
Horário: [6]    ← Só hora, era 06:00 sempre
```

**Agora:** Você escolhe hora E minuto
```
Horário: [14] : [30]    ← Exatamente 14:30 ⏰
```

**Benefícios:**
- ✅ Agendar coleta fora do horário de pico
- ✅ Sincronizar múltiplas SPs para a mesma hora
- ✅ Evitar throttle de API Azure (não coletar no mesmo minuto que colegas)

---

#### 2. **Badge Dia/Noite** 🌙☀️

```
Horário: [14] : [30]  ☀ Dia
       └─────────────┘
         Se 6-18h: ☀ Dia (amarelo)
         Se 18-6h: 🌙 Noite (azul)
```

**Por que ajuda:**
- ✅ Visualizar se a coleta é dia ou noite
- ✅ Melhorar planejamento de carga (noite = custos menores)
- ✅ Evitar agendamento acidental às 4 da manhã

---

#### 3. **"A cada 1 dia" (Inteligente)**

**Antes:**
- Você escolhia dias específicos (Seg-Sex)
- Deixava granularidade em 7 dias
- ❌ Resultado: coleta 1x semana, mas com 7 dias de dados (incompleto)

**Agora:**
```
○ A cada 1 dia (todos os dias)
  ├─ Dias: 0,1,2,3,4,5,6 (automaticamente)
  └─ Granularidade: 1 dia (automático) ← NÃO precisa mexer!
```

**Benefícios:**
- ✅ Coletar **todo dia** com **1 dia de dados** (completo)
- ✅ Sem preenchimento duplicado
- ✅ Histograma de custos diários mais preciso

---

## 🎮 Exemplos de Uso

### Exemplo 1: Agendar 3 SPs para coletar em paralelo

**Cenário:** Você tem SP-Produção, SP-Integrações e SP-Sandbox. Quer que todas coletem dados diários, às 15:00.

**Passo a passo:**

1. **SP-Produção:**
   - Menu → Coleta Azure → SP-Produção → ⚙ Agendamento
   - ☑ Coleta automática recorrente
   - Horário: `[15] : [00]` → Badge mostra ☀ Dia
   - ○ A cada 1 dia
   - [Salvar]

2. **SP-Integrações:**
   - Menu → Coleta Azure → SP-Integrações → ⚙ Agendamento
   - ☑ Coleta automática recorrente
   - Horário: `[15] : [00]` → Badge mostra ☀ Dia
   - ○ A cada 1 dia
   - [Salvar]

3. **SP-Sandbox:**
   - Menu → Coleta Azure → SP-Sandbox → ⚙ Agendamento
   - ☑ Coleta automática recorrente
   - Horário: `[15] : [00]` → Badge mostra ☀ Dia
   - ○ A cada 1 dia
   - [Salvar]

**Resultado:**
- ✅ Todas as 3 SPs coletarão dados **ao mesmo tempo** às 15:00
- ✅ Dashboard mostra 3 cards de progresso paralelos
- ✅ Tempo total: ~10 min (antes seria 30 min sequencial)

---

### Exemplo 2: Cancelar uma coleta sem parar as outras

**Cenário:** Coletas estão rodando, mas SP-Integrações está demorando. Você quer cancelar só ela.

**Passo a passo:**

1. Vá para: Menu → Coleta Azure
2. Localize o card de SP-Integrações
3. Clique no botão **[🔴 Cancelar esta coleta]**

**Resultado:**
- ✅ SP-Integrações para
- ✅ SP-Produção continua (não afetada)
- ✅ SP-Sandbox continua (não afetada)

---

### Exemplo 3: Ver logs detalhados de coleta paralela

**Cenário:** Coletas estão rodando. Você quer verificar por que uma está lenta.

**Passo a passo:**

1. Menu → Coleta Azure
2. Role para a coleta que quer investigar
3. Leia o log em tempo real:
   ```
   14:30:35 Inserindo no banco... (350/1245)
   14:30:40 Verificando duplicatas...
   14:30:45 Finalizando transação...
   14:30:50 ✅ Coleta concluída (1.245 registros)
   ```

**Benefício:**
- ✅ Diagnóstico rápido sem precisar de SSH/logs de servidor
- ✅ Cada coleta tem seus próprios logs (não misturado)

---

## 🔗 Integração com Demais Recursos

### Log Analytics, Inventário e Reservas

Essas coletas **não foram afetadas** e funcionam **independentemente**:

| Sistema | Coleta | Tipo | Status v4.2 |
|---------|--------|------|------------|
| **Azure** | Custos API | Paralelo | ✨ **NOVO** |
| **Azure** | Storage Blob | Paralelo | ✨ **NOVO** |
| **Databricks** | System Tables | Paralelo | ✨ **NOVO** (v4.2 tb) |
| **Azure** | Log Analytics | Próprio | ⚠️ Não afetado (será v4.3) |
| **Azure** | Inventário | Próprio | ⚠️ Não afetado |
| **Azure** | Reservas | Próprio | ⚠️ Não afetado |

**O que significa:**
- ✅ Coletas de Custos podem rodar em paralelo **com** Log Analytics (sem conflito)
- ✅ Cada sistema tem seu próprio agendador (não disputam recursos)
- ✅ Podem ser implementadas paralelas também em v4.3 (roadmap)

---

## 🐛 Troubleshooting

### Problema 1: "Coleta já em execução"

**Antes:**
```
❌ Erro: "Já existe uma coleta em execução. Aguarde..."
```

Isso significava que **qualquer SP** estava rodando. Agora:

```
✅ Você pode coletar SP-A e SP-B em paralelo!
   Erro aparece SÓ se você tentar coletar a MESMA SP 2x
```

---

### Problema 2: Horário HH:MM não salva

**Solução:**
1. Limpe o cache: `Ctrl+Shift+Delete` → Limpar dados do site
2. Recarregue a página: `Ctrl+R`
3. Tente novamente

Se persistir, verifique se:
- ✅ Hora está entre [0-23]
- ✅ Minuto está entre [0-59]
- ✅ Você clicou [Salvar] (não só fechar)

---

### Problema 3: Granularidade não muda para 1

**Solução:**
Quando seleciona "A cada 1 dia", a granularidade deve mudar automaticamente:

```
Antes:  Granularidade: [7]
Clica:  ○ A cada 1 dia
Depois: Granularidade: [1]  ← Auto-atualizado
```

Se não mudar:
1. Clique em "A cada 1 dia" novamente
2. Recarregue a página
3. Tente outra SP

---

## 📊 Resumo de Melhorias

| Feature | v4.1 | v4.2 | Benefício |
|---------|------|------|-----------|
| **Coletas Paralelas** | ❌ 1 por vez | ✅ Múltiplas | 70% mais rápido |
| **Horário** | Só hora | HH:MM | Mais preciso |
| **Badge** | ❌ Nada | ☀️/🌙 | Visual |
| **"A cada 1 dia"** | ❌ Manual | ✅ Auto | Menos erros |
| **Cancelamento** | Global | Por SP | Controle fino |
| **Dashboard** | 1 card | N cards | Clareza |
| **Log Analytics** | Bloqueava | Independente | Sem conflito |

---

## 📞 Suporte

- **Documentação:** Veja `CLAUDE.md` e `MODULES/`
- **Relatório de validação:** `DEPLOYMENT_VALIDATION_v4.2.md`
- **Deployment:** `DEPLOYMENT.md`

---

**Versão:** 4.2.1  
**Atualizado:** 2026-10-08  
**Português:** 🇧🇷 Completo
