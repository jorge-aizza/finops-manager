# ✨ Tenant Selector Feature — ColetaMonitor v4.2.2

**Data:** 2026-10-08  
**Commit:** 1d7dc8a  
**Status:** ✅ Deployed

---

## 🎯 O Que É?

Novo **seletor de Service Principal (Tenant)** no ColetaMonitor que permite:
- Ver todas as coletas paralelas (padrão)
- Filtrar para ver apenas 1 SP específica
- Útil quando 3+ SPs estão rodando e você quer acompanhar detalhes de uma só

---

## 📍 Onde Usar?

**Menu → Coleta Azure** (seção de monitor ao vivo)

```
┌───────────────────────────────────────────────────────┐
│                   COLETA AZURE — Monitor               │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Filtrar por Service Principal:  [🌐 Todas as SPs ▼]  │
│  ───────────────────────────────────────────────────── │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🟢 SP-Produção (api:7)                          │  │
│  │ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 60% │
│  │ [🔴 Cancelar]  [✕ Fechar]                       │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🟢 SP-Integrações (api:8)                       │  │
│  │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 40% │
│  │ [🔴 Cancelar]  [✕ Fechar]                       │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🟡 Storage Config (storage:5)                   │  │
│  │ ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 15% │
│  │ [🔴 Cancelar]  [✕ Fechar]                       │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 🎮 Exemplos de Uso

### Exemplo 1: Ver todas as coletas (Padrão)

1. Abra **Menu → Coleta Azure**
2. Dropdown padrão: `🌐 Todas as SPs`
3. Veja os 3 cards em paralelo

### Exemplo 2: Acompanhar uma coleta específica

1. Dropdown: `[🌐 Todas as SPs ▼]`
2. Selecione: `SP-Produção`
3. **Resultado:** Vê APENAS o card da SP-Produção
   - Cards das outras SPs desaparecem
   - Foco total naquela execução

```
Antes (todas):          Depois (só Produção):
───────────────────    ─────────────────────
┌─────────────────┐    ┌──────────────────┐
│ SP-Produção 60% │    │ SP-Produção 60%  │
└─────────────────┘    └──────────────────┘
┌─────────────────┐    
│ SP-Integ... 40% │    (desaparece)
└─────────────────┘    
┌─────────────────┐    
│ Storage... 15%  │    (desaparece)
└─────────────────┘    
```

### Exemplo 3: Mudar de SP enquanto coleta roda

1. Coletas rodando nas 3 SPs
2. Você seleciona: `SP-Integrações` (curioso para ver)
3. Vê apenas o progresso da SP-Integrações
4. Muda novamente para: `🌐 Todas as SPs`
5. Vê as 3 de novo

---

## 💾 Persistência

A seleção é **lembrada** entre sessões:

```javascript
// localStorage key: "coleta_monitor_tenant_filter"
localStorage.setItem('coleta_monitor_tenant_filter', 'sp_id')
```

**Exemplo:**
- Você seleciona "SP-Produção"
- Fecha a aba do navegador
- Reabre o FinOps
- Dropdown ainda mostra "SP-Produção" selecionada ✅

Para **resetar**, selecione `🌐 Todas as SPs` (deleta do localStorage).

---

## 🎨 Design

### Seletor (dropdown)

```
┌──────────────────────────────────────────────┐
│ Filtrar por Service Principal:  [🌐 Todas ▼] │
└──────────────────────────────────────────────┘
```

- Aparece **APENAS se houver 2+ SPs ativas**
- Se há 1 SP ou menos, seletor fica oculto
- Espaçamento: 8px antes e depois
- Font: 12px, gray-text (var(--text-muted))

### Dropdown Expandido

```
┌─────────────────────────────────────┐
│ 🌐 Todas as SPs                     │ ← default
├─────────────────────────────────────┤
│ SP-Produção                         │ ← active
├─────────────────────────────────────┤
│ SP-Integrações                      │
├─────────────────────────────────────┤
│ SP-Sandbox                          │
├─────────────────────────────────────┤
│ Storage Config (storage:5)          │ ← se houver
└─────────────────────────────────────┘
```

---

## 🔧 Implementação Técnica

### Estado (ColetaMonitor.tsx)

```typescript
// Seletor de tenant — null = todos, número = sp_id específica
const [selectedTenantId, setSelectedTenantId] = useState<number | null>(() => {
  const stored = localStorage.getItem('coleta_monitor_tenant_filter')
  return stored ? parseInt(stored, 10) : null
})
```

### Query (SPs Ativas)

```typescript
const spsQuery = useQuery({
  queryKey: ['coleta-sps'],
  queryFn: () => listSPs().then(sps => sps.filter(sp => sp.ativo)),
})
```

### Filtro

```typescript
const filteredExecucoes = execucoes.filter((exec) => {
  const key = `${exec.tipo}:${exec.id || 'null'}`
  if (exec.status && dismissedKeys.has(key)) return false
  // Se tem tenant selecionado, filtra por aquele ID
  if (selectedTenantId !== null) {
    if (exec.tipo === 'api' || exec.tipo === 'storage') {
      return exec.id === selectedTenantId
    }
    return false
  }
  return true
})
```

---

## 📊 Casos de Uso

| Cenário | Uso | Benefício |
|---------|-----|-----------|
| **3 SPs coletando ao mesmo tempo** | Selecione 1 SP | Ver logs detalhados sem ruído |
| **Debugar coleta lenta** | Filtre a SP problemática | Acompanhar apenas sua execução |
| **Agendar múltiplas SPs para mesmo horário** | Ver todas (default) | Confirmar paralelismo funciona |
| **Monitorar health-check de 1 SP** | Selecione a SP | Status isolado em time-real |

---

## 🔄 Compatibilidade

- ✅ Funciona com Azure (api + storage)
- ✅ Funciona com Databricks (independente, seletor próprio)
- ✅ Funciona com Log Analytics (independente, não afetado)
- ✅ Backward compatible (seletor escondido se 1 SP ou menos)

---

## 🚀 Roadmap

Futuras melhorias (out of scope v4.2):
- [ ] Multi-select (ver 2 SPs escolhidas)
- [ ] Bookmarks (salvar "vistas" predefinidas)
- [ ] Filtro por tipo (api vs storage)
- [ ] Ordenação (por tempo, por status)

---

## 📝 Checklist para Produção

- ✅ Build sem erros (491.95 KB)
- ✅ TypeScript compilation OK
- ✅ Seletor renderiza apenas com 2+ SPs
- ✅ localStorage.setItem/getItem funciona
- ✅ Filtro aplica corretamente
- ✅ UI responsiva (mobile-friendly)
- ✅ Commit e git push feitos

---

**Feature Completa!** 🎉

Versão: 4.2.2  
Commit: 1d7dc8a  
Data: 2026-10-08
