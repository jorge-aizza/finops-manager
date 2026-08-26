import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDatabricksStatus } from '../api/databricksColeta'

// Porta simplificada de ColetaMonitor.tsx (Coleta Azure) — card de progresso ao vivo pra
// coleta Databricks. Progresso é mais simples que o do Azure (sem sub-assinaturas/chunks,
// já que a Fase 2 coleta as System Tables inteiras num único statement) — sem circuit
// breaker próprio ainda (ver nota em _dbxFetch, server.js). Diferente do ColetaMonitor
// original, o "fechar" aqui não é persistido em localStorage (estado só da sessão) —
// simplificação deliberada dado o volume bem menor de execuções esperado nesta fase.
export default function DatabricksColetaMonitor() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const wasRunning = useRef(false)

  const statusQuery = useQuery({
    queryKey: ['databricks-coleta-status'],
    queryFn: getDatabricksStatus,
    refetchInterval: (query) => (query.state.data?.em_execucao ? 3000 : 20000),
  })

  const status = statusQuery.data
  const emExecucao = !!status?.em_execucao
  const progresso = status?.progresso || null

  useEffect(() => {
    if (emExecucao && !wasRunning.current) setDismissed(false)
    wasRunning.current = emExecucao
  }, [emExecucao])

  const prevEmExecucao = useRef(emExecucao)
  useEffect(() => {
    if (prevEmExecucao.current && !emExecucao) {
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
    }
    prevEmExecucao.current = emExecucao
  }, [emExecucao, queryClient])

  if (!progresso || !progresso.fase || (dismissed && !emExecucao)) return null

  const houveErro = !emExecucao && progresso.err > 0
  const corBorda = emExecucao ? 'var(--accent)' : (houveErro ? 'var(--danger)' : 'var(--green,#22c55e)')

  return (
    <div className="stat-card" style={{ padding: '16px 20px', borderColor: corBorda, borderWidth: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {emExecucao ? '⏳ Coleta Databricks em andamento' : (houveErro ? '❌ Coleta Databricks com erro' : '✅ Coleta Databricks concluída')}
        </span>
        {!emExecucao && (
          <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setDismissed(true)}>Fechar</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{progresso.fase}</div>

      <div style={{ display: 'flex', gap: 18, fontSize: 12, marginBottom: 10 }}>
        <span>Inseridos: <strong style={{ color: '#22c55e' }}>{progresso.ins.toLocaleString('pt-BR')}</strong></span>
        <span>Atualizados: <strong style={{ color: 'var(--accent)' }}>{progresso.upd.toLocaleString('pt-BR')}</strong></span>
        <span>Erros: <strong style={{ color: progresso.err > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{progresso.err.toLocaleString('pt-BR')}</strong></span>
      </div>

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
