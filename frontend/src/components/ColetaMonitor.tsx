import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelarColeta, getColetaStatus } from '../api/coleta'

const STATUS_LABEL: Record<string, string> = {
  concluido: '✅ Concluído', cancelado: '⊘ Cancelado', erro: '❌ Erro',
}
const STATUS_COLOR: Record<string, string> = {
  concluido: '#22c55e', cancelado: '#ff8c42', erro: '#ff4d6a',
}

// Porta de #coleta-monitor + loadColetaStatus()/_coletaPolling (app.js) —
// card de progresso ao vivo de uma coleta em execução (via API oficial ou
// Storage). Poll leve (20s) quando ocioso pra detectar coletas disparadas
// pelo agendador sem ação do usuário nesta aba; poll rápido (3s) enquanto
// em_execucao=true. Fica visível em "estado final" colorido após terminar,
// até o usuário fechar — mesmo padrão do legado.
export default function ColetaMonitor() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const wasRunning = useRef(false)

  const statusQuery = useQuery({
    queryKey: ['coleta-status'],
    queryFn: getColetaStatus,
    refetchInterval: (query) => (query.state.data?.em_execucao ? 3000 : 20000),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelarColeta,
    onSuccess: () => {
      window.showToast?.('Cancelamento solicitado.', 'warn')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao cancelar: ' + e.message, 'error'),
  })

  const status = statusQuery.data
  const emExecucao = !!status?.em_execucao
  const progresso = status?.progresso || null

  // Nova coleta começou — reabre o monitor mesmo se o usuário tinha fechado a anterior.
  useEffect(() => {
    if (emExecucao && !wasRunning.current) setDismissed(false)
    wasRunning.current = emExecucao
  }, [emExecucao])

  // Ao concluir, atualiza cobertura/notificações (mesmos efeitos colaterais do legado).
  const prevEmExecucao = useRef(emExecucao)
  useEffect(() => {
    if (prevEmExecucao.current && !emExecucao) {
      queryClient.invalidateQueries({ queryKey: ['coleta-cobertura'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
    }
    prevEmExecucao.current = emExecucao
  }, [emExecucao, queryClient])

  if (!progresso || (dismissed && !emExecucao)) return null

  const ultimoRelevante = progresso.tipo === 'storage' ? status?.ultimo_storage : status?.ultimo_api
  const statusFinal = !emExecucao ? ultimoRelevante?.status : null
  const corBorda = emExecucao ? 'var(--accent)' : (statusFinal ? STATUS_COLOR[statusFinal] || 'var(--border)' : 'var(--border)')

  return (
    <div className="stat-card" style={{ padding: '16px 20px', borderColor: corBorda, borderWidth: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {emExecucao ? '⏳ Coleta em andamento' : (statusFinal ? STATUS_LABEL[statusFinal] || 'Coleta finalizada' : 'Coleta finalizada')}
          {' — '}{progresso.tipo === 'api' ? 'API Oficial' : 'Via Storage'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {emExecucao && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }}
              disabled={cancelMutation.isPending || status?.cancelando} onClick={() => cancelMutation.mutate()}>
              {status?.cancelando ? 'Cancelando...' : 'Cancelar'}
            </button>
          )}
          {!emExecucao && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setDismissed(true)}>Fechar</button>
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

      {progresso.tipo === 'api' && status?.circuit_breaker && status.circuit_breaker.state !== 'closed' && (
        <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,140,66,.1)', border: '1px solid rgba(255,140,66,.3)', color: 'var(--orange,#ff8c42)', marginBottom: 10 }}>
          ⚠ Circuit breaker: {status.circuit_breaker.state} — {status.circuit_breaker.failures} falha(s)
          {status.circuit_breaker.open_until && <> · reabre {new Date(status.circuit_breaker.open_until).toLocaleTimeString('pt-BR')}</>}
        </div>
      )}

      {progresso.log?.length > 0 && (
        <div style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--bg)', borderRadius: 6, padding: '6px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--text-muted)' }}>
          {progresso.log.map((l, i) => (
            <div key={i}>[{new Date(l.ts).toLocaleTimeString('pt-BR')}] {l.msg}</div>
          ))}
        </div>
      )}
    </div>
  )
}
