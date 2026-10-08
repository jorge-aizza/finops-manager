# 🌍 Global Tenant Filter Architecture — FinOps Manager v4.3+

**Proposta:** Implementar um **seletor de Service Principal (Tenant) global** que funcione em múltiplas telas do sistema.

**Data:** 2026-10-08  
**Status:** 📋 Design Document (não implementado ainda)

---

## 📊 Mapa de Telas × Filtro de SP

| Tela | View | Suporta Multi-SP? | Faz Sentido Filtrar? | Prioridade |
|------|------|-------------------|----------------------|-----------|
| **Coleta Azure** | ColetaView | ✅ v4.2 | ✅ SIM | 🔴 P0 (implementado) |
| **Log Analytics** | LogAnalyticsView | ❓ Parcial | ✅ SIM | 🟡 P1 |
| **Recursos Órfãos** | DesperdícioView* | ❓ Desconhecido | ✅ SIM | 🟡 P1 |
| **Inventário** | InventarioView | ❓ Desconhecido | ✅ SIM | 🟡 P1 |
| **Reservas** | ReservasView | ❓ Desconhecido | ✅ SIM | 🟡 P1 |
| **Dashboard** | DashboardView | ❓ Não (ações/estimativas) | ❌ NÃO | 🟢 P2 |
| **Databricks** | DatabricksDashboardView | ✅ Próprio | ✅ SIM | 🟡 P1 |
| **Calculadora** | CalculadoraView | ❓ Desconhecido | ❓ TALVEZ | 🟢 P3 |
| **Projetos** | ProjetosView | ❌ Não | ❌ NÃO | 🟢 P2 |
| **Ações** | AcoesView | ❌ Não | ❌ NÃO | 🟢 P2 |
| **Estimativas** | EstimativasView | ❌ Não | ❌ NÃO | 🟢 P2 |
| **Alocação** | AlocacaoView | ❌ Não | ❌ NÃO | 🟢 P2 |

---

## 🎯 Candidatas para Filtro Global

### 🔴 **P0 - Já Implementado (v4.2.2)**

**Coleta Azure**
```
Menu → Coleta Azure
├─ Filtro: [🌐 Todas as SPs ▼]  ← ATIVO
├─ ColetaMonitor (cards paralelos)
├─ Histórico (tabela de execuções)
└─ SPs (tabela de cadastro)
```

---

### 🟡 **P1 - Próximos Candidatos (v4.3)**

#### **1. Log Analytics**
```
Menu → Log Analytics
├─ Filtro: [🌐 Todas as SPs ▼]  ← NOVO
├─ Período de coleta
├─ Workspace info (filtrável por SP)
├─ Gráfico de consumo diário (por SP)
└─ Tabela de retenção e custo real (por SP)
```

**Por que faz sentido:**
- Cada SP pode ter seu próprio Log Analytics workspace
- Consumo e retenção variam por SP
- Usuário quer ver "quanto custa meu Log Analytics em SP-Produção vs SP-Integrações"

---

#### **2. Recursos Órfãos (Desperdício)**
```
Menu → Desperdício → Recursos Órfãos  
├─ Filtro: [🌐 Todas as SPs ▼]  ← NOVO
├─ Tabela de discos/VMs órfãos
├─ Ações recomendadas (por SP)
└─ Economia potencial (filtrável por SP)
```

**Por que faz sentido:**
- Recursos órfãos são POR SUBSCRIPTION (que pertence a uma SP)
- Diferentes SPs têm diferentes níveis de desperdício
- "SP-Produção tem $5K em desperdício, SP-Sandbox tem $200"

---

#### **3. Inventário (Recursos Azure)**
```
Menu → Inventário
├─ Filtro: [🌐 Todas as SPs ▼]  ← NOVO
├─ Tabela de VMs, Networks, Storages
├─ Contadores por tipo de recurso
└─ Filtros adicionais (RG, tipo recurso)
```

**Por que faz sentido:**
- Cada SP pode gerenciar diferentes assinaturas
- Inventário varia muito por SP
- "SP-Produção tem 250 VMs, SP-Sandbox tem 12"

---

#### **4. Reservas (Azure Reservations)**
```
Menu → Reservas
├─ Filtro: [🌐 Todas as SPs ▼]  ← NOVO
├─ Tabela de RIs (Reserved Instances)
├─ Utilização por SP
└─ Recomendações de compra (por SP)
```

**Por que faz sentido:**
- RIs são compradas POR SUBSCRIPTION (vinculadas a uma SP)
- Diferentes SPs têm diferentes cobertura de RI
- "Preciso de RI em SP-Produção mas não em SP-Dev"

---

#### **5. Databricks (Já tem próprio)**
```
Menu → Databricks → Dashboard
├─ Filtro: [🌐 Todos os Workspace ▼]  ← JÁ EXISTE (separado)
├─ Stats de uso por workspace
├─ Tabela de clusters
└─ Logs de execução (por workspace)
```

**Nota:** Databricks usa "workspace ID", não "SP ID"
- Pode ter N workspaces por SP
- Cada workspace é independente
- Seletor de workspace já existe separado → deixar como está

---

### 🟢 **P2 - Não Faz Sentido**

| Tela | Por que NÃO filtrar? |
|------|----------------------|
| **Dashboard (Ações/Estimativas)** | Ações e estimativas não são vinculadas a SP — são globais por projeto |
| **Projetos** | Projetos são globais, não pertencem a uma SP específica |
| **Ações** | Mesma razão (global) |
| **Estimativas** | Mesma razão (global) |
| **Alocação** | Aloca custos globais, não por SP |

---

## 🏗️ Arquitetura Recomendada

### **Opção 1: Filtro LOCAL (por tela)**
```
Cada tela implementa seu próprio seletor de SP
├─ ColetaMonitor ← v4.2.2 (implementado)
├─ LogAnalyticsView ← novo
├─ DesperdícioView ← novo
├─ InventarioView ← novo
└─ ReservasView ← novo

Cada um com seu próprio localStorage key
```

**Pros:** Simples, independente  
**Cons:** Repetição de código, UI inconsistente

---

### **Opção 2: Filtro GLOBAL via Context** ✨ RECOMENDADO
```
TenantProvider (React Context)
├─ selectedTenantId (state)
├─ useTenantFilter() (hook)
└─ localStorage: 'global_tenant_filter'

App.tsx
└─ <TenantProvider>
   ├─ ColetaView (usa useTenantFilter())
   ├─ LogAnalyticsView (usa useTenantFilter())
   ├─ DesperdícioView (usa useTenantFilter())
   └─ etc...
```

**Pros:** 
- Consistência global
- Usuário seleciona 1x, afeta múltiplas telas
- Fácil de manter

**Cons:** 
- Requer refactoring de componentes
- Maior acoplamento

---

### **Opção 3: Filtro HÍBRIDO** ✨ MELHOR COMPROMISSO
```
TenantFilter Context (global, compartilhado)
├─ selectedTenantId
├─ localStorage persistence
└─ useTenantFilter() hook

Cada tela OPCIONALMENTE usa:
├─ Usa contexto global? SIM → mostra seletor no topo
├─ Usa contexto global? NÃO → sem seletor

Exemplo:
- ColetaView: usa global (já faz hoje)
- LogAnalyticsView: usa global (novo)
- DashboardView: NÃO usa (não faz sentido)
- AcoesView: NÃO usa (não faz sentido)
```

---

## 🎨 UI Proposta

### **Header Global (App.tsx)**

```
┌─────────────────────────────────────────────────┐
│ FinOps Manager  [Menu] [Perfil] [Logout]       │
├─────────────────────────────────────────────────┤
│ Filtro Global: [🌐 Todas as SPs ▼]             │ ← NOVO
├─────────────────────────────────────────────────┤
│ Menu → Coleta Azure                            │
└─────────────────────────────────────────────────┘
```

Ou no **lado de cada seção** (menos intrusivo):

```
┌─────────────────────────────────────────────────┐
│ Coleta Azure                                    │
│ Filtro: [🌐 Todas as SPs ▼]                    │
├─────────────────────────────────────────────────┤
│ [cards de coleta]                              │
└─────────────────────────────────────────────────┘
```

---

## 📋 Implementação por Fase

### **Fase 1 (Atual v4.2.2):** ✅ COMPLETA
- ✅ ColetaMonitor seletor (local)
- ✅ Persistência em localStorage
- ✅ Filtro funcional

### **Fase 2 (v4.3):** 📋 PROPOSTO
- [ ] Criar `TenantFilterContext` (React Context)
- [ ] Criar `useTenantFilter()` hook
- [ ] Integrar em ColetaMonitor (usar contexto)
- [ ] Integrar em LogAnalyticsView
- [ ] Integrar em DesperdícioView
- [ ] Integrar em InventarioView
- [ ] Integrar em ReservasView

### **Fase 3 (v4.4+):** 🔮 FUTURO
- [ ] Sincronizar seleção com filtros de Resource Group
- [ ] Lembrar seleções por view
- [ ] Dashboard widget "Resumo por SP"

---

## 🔗 Donde Apareceria

### **LOG ANALYTICS**
```
Menu → Log Analytics
┌─────────────────────────────────────┐
│ Log Analytics FinOps                │
├─────────────────────────────────────┤
│ Filtro: [🌐 Todas as SPs ▼]        │ ← SELETOR
├─────────────────────────────────────┤
│ Período: [últimos 30 dias]          │
├─────────────────────────────────────┤
│ 📊 Workspace LAW-Prod-001           │
│ • Retenção: 30 dias                 │
│ • Custo real (mês): R$ 1.250        │
│ • GB ingerido: 125 GB               │
│                                     │
│ 📊 Workspace LAW-Integ-001          │
│ • Retenção: 7 dias                  │
│ • Custo real (mês): R$ 200          │
│ • GB ingerido: 18 GB                │
├─────────────────────────────────────┤
│ [Gráfico de consumo diário]         │
│ [Recomendação de tier]              │
└─────────────────────────────────────┘
```

**Com Filtro Aplicado:**
```
Filtro: [SP-Produção ▼]
┌─────────────────────────────────────┐
│ 📊 Workspace LAW-Prod-001           │
│ • Retenção: 30 dias                 │
│ • Custo real (mês): R$ 1.250        │
│ • GB ingerido: 125 GB               │
├─────────────────────────────────────┤
│ [Gráfico filtrando só Produção]     │
└─────────────────────────────────────┘
(SP-Integrações desaparece)
```

---

### **RECURSOS ÓRFÃOS (DESPERDÍCIO)**
```
Menu → Desperdício → Recursos Órfãos
┌─────────────────────────────────────┐
│ Recursos Órfãos (Disco não utilizado)│
├─────────────────────────────────────┤
│ Filtro: [🌐 Todas as SPs ▼]        │ ← SELETOR
├─────────────────────────────────────┤
│ Tabela de discos órfãos:            │
│ ID | RG | Tamanho | Custo/mês | SP │
│ ────────────────────────────────────│
│ dk1 | rg1| 100 GB | R$ 5      | Prod│
│ dk2 | rg2| 50 GB  | R$ 2.50   | Prod│
│ dk3 | rg3| 20 GB  | R$ 1      | Integ│
│ dk4 | rg4| 10 GB  | R$ 0.50   | Integ│
│ ────────────────────────────────────│
│ Total desperdício: R$ 8.50          │
└─────────────────────────────────────┘
```

**Com Filtro Aplicado:**
```
Filtro: [SP-Produção ▼]
┌─────────────────────────────────────┐
│ ID | RG | Tamanho | Custo/mês | SP │
│ ────────────────────────────────────│
│ dk1 | rg1| 100 GB | R$ 5      | Prod│
│ dk2 | rg2| 50 GB  | R$ 2.50   | Prod│
│ ────────────────────────────────────│
│ Total desperdício: R$ 7.50          │
│ (SP-Integrações removido)           │
└─────────────────────────────────────┘
```

---

## 💡 Benefícios

| Benefício | Impacto |
|-----------|--------|
| **Análise por SP** | FinOps lead vê custos isolados per-SP |
| **Multi-tenant** | Suporta crescimento (Prod/Dev/Test) |
| **UX consistente** | Mesma experiência em todas as telas |
| **Rastreamento** | Sabe qual SP consome mais |
| **Compliance** | Chargeback por SP (se necessário) |

---

## 🚀 Recomendação Final

**Implementar Fase 2 (v4.3) com Opção 3 (Híbrida):**

```javascript
// TenantFilterContext.tsx (novo arquivo)
export const TenantFilterContext = createContext<...>(...);

export function useTenantFilter() {
  return useContext(TenantFilterContext);
}

// App.tsx
<TenantFilterProvider>
  <Router>
    {/* Todas as telas têm acesso via useTenantFilter() */}
  </Router>
</TenantFilterProvider>

// LogAnalyticsView.tsx (exemplo)
export function LogAnalyticsView() {
  const { selectedTenantId } = useTenantFilter();
  const data = /* filtra por selectedTenantId */;
  return (
    <div>
      <TenantSelector /> {/* Reutilizável */}
      {/* Renderiza data filtrada */}
    </div>
  );
}
```

**Esforço Estimado:** 4-6 horas  
**Risco:** Baixo (mudança de UI, sem lógica de negócio)  
**ROI:** Alto (melhora UX em 5+ telas)

---

**Status:** 📋 Design Ready → Aguardando aprovação para implementação v4.3
