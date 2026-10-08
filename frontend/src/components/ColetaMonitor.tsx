import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelarColeta, getColetaStatus, listSPs } from '../api/coleta'
import type { ExecucaoAtiva } from '../types/coleta'

const STATUS_LABEL: Record<string, string> = {
  concluido: '✅ Concluído', cancelado: '⊘ Cancelado', erro: '❌ Erro',
}
const STATUS_COLOR: Record<string, string> = {
  concluido: '#22c55e', cancelado: '#ff8c42', erro: '#ff4d6a',
}

// Persistido em localStorage — rastreia quais execuções foram dispensadas pelo usuário.
// Chave composta "tipo:id" (ex. "api:3", "storage:5").
const DISMISS_PREFIX = 'coleta_monitor_dismissed_'
// Seletor de tenant — null = todos, número = sp_id específica
const TENANT_FILTER_KEY = 'coleta_monitor_tenant_filter'

// Porta de #coleta-monitor + loadColetaStatus()/_coletaPolling (app.js) —
// renderiza cards de progresso ao vivo para cada coleta ativa (via API oficial ou
// Storage). Poll leve (20s) quando ocioso pra detectar coletas disparadas
// pelo agendador; poll rápido (3s) enquanto houver execução ativa. Cada card
// fica visível em "estado final" colorido até o usuário fechar — mesmo padrão do legado.
export default function ColetaMonitor() {
  const queryClient = useQueryClient()
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => {
    const stored = Object.entries(localStorage)
      .filter(([k]) => k.startsWith(DISMISS_PREFIX))
      .map(([k]) => k.slice(DISMISS_PREFIX.length))
    return new Set(stored)
  })
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(() => {
    const stored = localStorage.getItem(TENANT_FILTER_KEY)
    return stored ? parseInt(stored, 10) : null
  })
  const wasRunning = useRef(false)

  const spsQuery = useQuery({
    queryKey: ['coleta-sps'],
    queryFn: () => listSPs().then(sps => sps.filter(sp => sp.ativo)),
  })

  const statusQuery = useQuery({
    queryKey: ['coleta-status'],
    queryFn: getColetaStatus,
    refetchInterval: (query) => (query.state.data?.em_execucao ? 3000 : 20000),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ tipo, id }: { tipo: 'api' | 'storage'; id: number | null }) =>
      cancelarColeta(tipo, id),
    onSuccess: () => {
      window.showToast?.('Cancelamento solicitado.', 'warn')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao cancelar: ' + e.message, 'error'),
  })

  const status = statusQuery.data
  const emExecucao = !!status?.em_execucao
  const execucoes = status?.execucoes || []

  useEffect(() => {
    if (emExecucao && !wasRunning.current) {
      setDismissedKeys(new Set())
      for (const [k] of Object.entries(localStorage)) {
        if (k.startsWith(DISMISS_PREFIX)) localStorage.removeItem(k)
      }
    }
    wasRunning.current = emExecucao
  }, [emExecucao])

  useEffect(() => {
    if (wasRunning.current && !emExecucao) {
      queryClient.invalidateQueries({ queryKey: ['coleta-cobertura'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
    }
    wasRunning.current = emExecucao
  }, [emExecucao, queryClient])

  // Filtrar por tenant selecionado e por dismissal
  const filteredExecucoes = execucoes.filter((exec) => {
    const key = `${exec.tipo}:${exec.id || 'null'}`
    if (exec.status && dismissedKeys.has(key)) return false
    // Se tem tenant selecionado, filtra por api ou storage com aquele ID
    if (selectedTenantId !== null) {
      if (exec.tipo === 'api' || exec.tipo === 'storage') {
        return exec.id === selectedTenantId
      }
      return false
    }
    return true
  })

  function handleTenantChange(newId: number | null) {
    setSelectedTenantId(newId)
    if (newId === null) {
      localStorage.removeItem(TENANT_FILTER_KEY)
    } else {
      localStorage.setItem(TENANT_FILTER_KEY, String(newId))
    }
  }

  if (filteredExecucoes.length === 0) return null

  function handleFechar(exec: ExecucaoAtiva) {
    const key = `${exec.tipo}:${exec.id || 'null'}`
    localStorage.setItem(DISMISS_PREFIX + key, '1')
    setDismissedKeys(new Set([...dismissedKeys, key]))
  }

  const sps = spsQuery.data || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Seletor de Tenant */}
      {sps.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Filtrar por Service Principal:</label>
          <select
            value={selectedTenantId === null ? 'all' : String(selectedTenantId)}
            onChange={(e) => handleTenantChange(e.target.value === 'all' ? null : parseInt(e.target.value, 10))}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            <option value="all">🌐 Todas as SPs</option>
            {sps.map((sp) => (
              <option key={sp.id} value={String(sp.id)}>
                {sp.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Cards de Execução */}
      {filteredExecucoes.map((exec) => (
        <CardExecucao
          key={`${exec.tipo}:${exec.id || 'null'}`}
          exec={exec}
          emExecucao={exec.status === null}
          isLoading={cancelMutation.isPending}
          onCancelar={() => cancelMutation.mutate({ tipo: exec.tipo, id: exec.id })}
          onFechar={() => handleFechar(exec)}
          statusCancelando={exec.cancelando}
          cbFetch={status?.circuit_breaker}
        />
      ))}
    </div>
  )
}

interface CardExecucaoProps {
  exec: ExecucaoAtiva
  emExecucao: boolean
  isLoading: boolean
  onCancelar: () => void
  onFechar: () => void
  statusCancelando: boolean
  cbFetch?: { state: string; failures: number; open_until: string | null }
}

function CardExecucao({ exec, emExecucao, isLoading, onCancelar, onFechar, statusCancelando, cbFetch }: CardExecucaoProps) {
  const { progresso, status } = exec
  const statusFinal = !emExecucao ? status : null
  const corBorda = emExecucao ? 'var(--accent)' : (statusFinal ? STATUS_COLOR[statusFinal] || 'var(--border)' : 'var(--border)')

  return (
    <div className="stat-card" style={{ padding: '16px 20px', borderColor: corBorda, borderWidth: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {emExecucao ? '⏳ Coleta em andamento' : (statusFinal ? STATUS_LABEL[statusFinal] || 'Coleta finalizada' : 'Coleta finalizada')}
          {' — '}{progresso.tipo === 'api' ? 'API Oficial' : 'Via Storage'}
          {exec.id !== null && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>(ID {exec.id})</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {emExecucao && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }}
              disabled={isLoading || statusCancelando} onClick={onCancelar}>
              {statusCancelando ? 'Cancelando...' : 'Cancelar'}
            </button>
          )}
          {!emExecucao && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={onFechar}>Fechar</button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
        {progresso.fase}
        {progresso.sub_atual && <span> — {progresso.sub_atual}</span>}
        {progresso.sub_total ? <span> ({(progresso.sub_idx || 0)}/{progresso.sub_total} assinaturas)</span> : null}
        {progresso.chunk_total ? <span> · chunk {(progresso.chunk_atual ?? progresso.chunk_idx ?? 0)}/{progresso.chunk_total}</span> : null}
      </div>

      {progresso.chunk_total ? (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden', marginBottom: 10 }}>
          <div style={{
            height: '100%', borderRadius: 3, background: corBorda,
            width: `${Math.min(100, Math.round(((progresso.chunk_atual ?? progresso.chunk_idx ?? 0) / progresso.chunk_total) * 100))}%`,
            transition: 'width .3s',
          }} />
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 18, fontSize: 12, marginBottom: 10 }}>
        <span>Inseridos: <strong style={{ color: '#22c55e' }}>{progresso.ins.toLocaleString('pt-BR')}</strong></span>
        <span>Atualizados: <strong style={{ color: 'var(--accent)' }}>{progresso.upd.toLocaleString('pt-BR')}</strong></span>
        <span>Erros: <strong style={{ color: progresso.err > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{progresso.err.toLocaleString('pt-BR')}</strong></span>
      </div>

      {progresso.tipo === 'api' && cbFetch && cbFetch.state !== 'closed' && (
        <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,140,66,.1)', border: '1px solid rgba(255,140,66,.3)', color: 'var(--orange,#ff8c42)', marginBottom: 10 }}>
          ⚠ Circuit breaker: {cbFetch.state} — {cbFetch.failures} falha(s)
          {cbFetch.open_until && <> · reabre {new Date(cbFetch.open_until).toLocaleTimeString('pt-BR')}</>}
        </div>
      )}

      {progresso.log?.length > 0 && (
        <div style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--bg)', borderRadius: 6, padding: '6px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--text-muted)' }}>
          {progresso.log.map((l, i) => (
            <div key={i}>[{l.ts}] {l.msg}</div>
          ))}
        </div>
      )}
    </div>
  )
}
