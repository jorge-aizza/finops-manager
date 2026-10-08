# 🎯 Filtro de Tenant — Opção 2 (Dentro de Cada Tela)

**Data:** 2026-10-08  
**Commit:** 458a12e (Log Analytics) + 10245f8 (Global Context)  
**Status:** ✅ Implementado e em Uso

---

## 📍 **Onde Aparece o Filtro**

### **1. Coleta Azure ✅ (Implementado v4.2.2)**

```
Menu → Coleta Azure
┌─────────────────────────────────────────────────────────┐
│ Coleta Azure — Monitor                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Filtrar por Service Principal: [🌐 Todas as SPs ▼]     │ ← AQUI
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🟢 SP-Produção (api:7)                              │ │
│ │ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │ 60%
│ │ [🔴 Cancelar]                                       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🟢 SP-Integrações (api:8)                           │ │
│ │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │ 40%
│ │ [🔴 Cancelar]                                       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Com filtro aplicado (SP-Produção):**
```
Filtrar por Service Principal: [SP-Produção ▼]

┌─────────────────────────────────────────────────────────┐
│ 🟢 SP-Produção (api:7)                                  │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 60%
│ [🔴 Cancelar]                                           │
└─────────────────────────────────────────────────────────┘

(Cards de SP-Integrações e Storage desaparecem)
```

---

### **2. Log Analytics ✅ (Implementado agora v4.3)**

```
Menu → Log Analytics
┌─────────────────────────────────────────────────────────┐
│ Log Analytics FinOps                                    │
│ Ingestão, retenção e oportunidades...                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Filtrar por Service Principal: [🌐 Todas as SPs ▼]     │ ← AQUI
│                                                         │
│ [Período] [Atualizar] [Diagnostic Settings] [Excel]    │
├─────────────────────────────────────────────────────────┤
│ Custo real    │ Custo ingestão │ Custo retenção │ ...  │
│ R$ 363.190    │ R$ 362.608     │ R$ 582         │      │
├─────────────────────────────────────────────────────────┤
│ Custo por Workspace — TOP 10                            │
│ • LA-SharedServices-PROD    R$ 189.700  (Prod)         │
│ • log-hubapp-production     R$  87.708  (Prod)         │
│ • log-terra-connectivity    R$  18.651  (Integ)        │
│ • log-jarvis-prod           R$  19.852  (Prod)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Com filtro aplicado (SP-Produção):**
```
Filtrar por Service Principal: [SP-Produção ▼]

Custo real    │ Custo ingestão │ Custo retenção │
R$ 295.260    │ R$ 295.060     │ R$ 582         │  ← Só dados de Prod

Custo por Workspace — TOP 10
• LA-SharedServices-PROD    R$ 189.700
• log-hubapp-production     R$  87.708
• log-jarvis-prod           R$  19.852

(Workspaces de outras SPs não aparecem)
```

---

### **3. Recursos Órfãos (Desperdício)**

```
Menu → Inventário → Recursos Órfãos
┌─────────────────────────────────────────────────────────┐
│ Recursos Órfãos (Discos não utilizados)                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Filtrar por Service Principal: [🌐 Todas as SPs ▼]     │ ← AQUI
│                                                         │
│ [Período] [Atualizar] [Excel]                           │
├─────────────────────────────────────────────────────────┤
│ Total desperdício: R$ 8.350                             │
│                                                         │
│ ID   │ RG     │ Tamanho │ Custo/mês │ SP               │
│──────┼────────┼─────────┼───────────┼──────────────────│
│ dk1  │ rg-p1  │ 100 GB  │ R$ 5,00   │ SP-Produção    │
│ dk2  │ rg-p2  │ 50 GB   │ R$ 2,50   │ SP-Produção    │
│ dk3  │ rg-i1  │ 20 GB   │ R$ 1,00   │ SP-Integrações │
│ dk4  │ rg-i2  │ 10 GB   │ R$ 0,50   │ SP-Integrações │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Com filtro aplicado (SP-Produção):**
```
Filtro por Service Principal: [SP-Produção ▼]

Total desperdício: R$ 7.500  ← Só Produção

ID   │ RG     │ Tamanho │ Custo/mês
──────┼────────┼─────────┼──────────
 dk1  │ rg-p1  │ 100 GB  │ R$ 5,00
 dk2  │ rg-p2  │ 50 GB   │ R$ 2,50

(Discos de Integrações e Sandbox desaparecem)
```

---

### **4. Inventário**

```
Menu → Inventário
┌─────────────────────────────────────────────────────────┐
│ Inventário de Recursos Azure                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Filtrar por Service Principal: [🌐 Todas as SPs ▼]     │ ← AQUI
│                                                         │
│ [Config] [Período] [Auditar] [Exportar]                 │
├─────────────────────────────────────────────────────────┤
│ Total de recursos: 307 (todas as SPs)                   │
│ • VMs: 307                                              │
│ • Networks: 112                                         │
│ • Storage: 53                                           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Tabela de recursos...                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Com filtro aplicado (SP-Produção):**
```
Filtrar por Service Principal: [SP-Produção ▼]

Total de recursos: 250 (só Produção)
• VMs: 250
• Networks: 80
• Storage: 45

(Recursos de outras SPs não aparecem)
```

---

### **5. Reservas**

```
Menu → Reservas
┌─────────────────────────────────────────────────────────┐
│ Reservas Azure                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Filtrar por Service Principal: [🌐 Todas as SPs ▼]     │ ← AQUI
│                                                         │
│ [Sincronizar] [Exportar]                                │
├─────────────────────────────────────────────────────────┤
│ Total de RIs: 112 (todas as SPs)                        │
│ Coverage: 72%                                           │
│                                                         │
│ RIs por SP:                                             │
│ • SP-Produção:     100 RIs (85% coverage)             │
│ • SP-Integrações:   10 RIs (40% coverage)             │
│ • SP-Sandbox:        2 RIs (15% coverage)             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Com filtro aplicado (SP-Produção):**
```
Filtrar por Service Principal: [SP-Produção ▼]

Total de RIs: 100 (só Produção)
Coverage: 85%

(RIs de outras SPs não aparecem)
```

---

## 🎨 **Padrão de UI**

Todas as telas usam o mesmo padrão:

```
┌─────────────────────────────────────────┐
│ Título da Tela                          │
├─────────────────────────────────────────┤
│                                         │
│ Filtrar por Service Principal:          │
│ [🌐 Todas as SPs ▼] ← Dropdown global   │
│                                         │
│ (resto do conteúdo filtrado)           │
│                                         │
└─────────────────────────────────────────┘
```

**Componente Reutilizável:**
```typescript
<TenantSelector />
// Renderiza automaticamente:
// - Oculto se < 2 SPs ativas
// - Dropdown com "🌐 Todas as SPs" + lista de SPs
// - Conectado ao Context global
// - Persiste em localStorage
```

---

## 🔗 **Como Funciona**

```
1. Usuário seleciona SP em qualquer tela
   └─ TenantSelector → useTenantFilter()

2. Context global atualiza: selectedTenantId = X
   └─ localStorage['global_tenant_filter'] = X

3. Dados são filtrados automaticamente
   └─ Componentes usam useTenantFilter() para ler valor

4. Muda para outra tela
   └─ TenantSelector lê localStorage (mesma seleção)

5. Volta para tela anterior
   └─ Mesma seleção está lá (persistida)
```

---

## 📋 **Checklist de Implementação**

### ✅ Implementado
- [x] Coleta Azure (ColetaMonitor)
- [x] Log Analytics
- [x] Context global (TenantFilterContext)
- [x] Componente reutilizável (TenantSelector)

### ⏳ Próximo
- [ ] Inventário (conectar ao seletor)
- [ ] Recursos Órfãos (conectar ao seletor)
- [ ] Reservas (conectar ao seletor)

### 📝 Padrão
```typescript
// Em qualquer View que queira filtro de Tenant:

import { TenantSelector } from '../components/TenantSelector'
import { useTenantFilter } from '../contexts/TenantFilterContext'

export function MinhaView() {
  const { selectedTenantId } = useTenantFilter()
  
  return (
    <>
      <div className="view-hero">Título</div>
      <TenantSelector />  {/* ← Só adicionar isso! */}
      
      {/* Dados filtrados por selectedTenantId */}
      {data.filter(item => !selectedTenantId || item.sp_id === selectedTenantId)}
    </>
  )
}
```

---

## 🎯 **Benefícios da Opção 2**

✅ **Proximidade** — Filtro está perto dos dados  
✅ **Contexto** — Claro o que está sendo filtrado  
✅ **Reutilização** — TenantSelector em múltiplas telas  
✅ **Persistência** — Lembra a seleção no localStorage  
✅**Simplicidade** — Não polui o header global  

---

**Status:** 🟢 Ready for all views  
**Commits:** 10245f8 + 458a12e  
**Build:** ✅ 492.48 KB, 0 errors

