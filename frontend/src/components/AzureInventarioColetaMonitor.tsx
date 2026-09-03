import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAzureInventarioStatus } from '../api/azureInventario'

// Card de progresso ao vivo pra Coleta de Inventário/Auditoria — mesmo padrão de
// ColetaMonitor.tsx (Azure)/DatabricksColetaMonitor.tsx (Databricks), pedido do usuário
// pra poder acompanhar a coleta em tempo real, não só o resumo final. "Fechar" não é
// persistido em localStorage (estado só da sessão) — mesma simplificação já usada no
// monitor Databricks, dado o volume de execuções esperado (1x por hora, no máximo).
export default function AzureInventarioColetaMonitor() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const wasRunning = useRef(false)

  const statusQuery = useQuery({
    queryKey: ['azure-inv-status'],
    queryFn: getAzureInventarioStatus,
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
      queryClient.invalidateQueries({ queryKey: ['azure-inv-recursos'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-auditoria'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-historico'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-config'] })
    }
    prevEmExecucao.current = emExecucao
  }, [emExecucao, queryClient])

  if (!progresso || !progresso.fase || (dismissed && !emExecucao)) return null

  const houveErro = !emExecucao && progresso.log?.some((l) => l.msg.startsWith('ERRO'))
  const corBorda = emExecucao ? 'var(--accent)' : (houveErro ? 'var(--danger)' : 'var(--green,#22c55e)')
  // Mesmo estado/monitor da coleta normal (Activity Log) e da reconciliação (Resource Graph,
  // ver server.js `_reconciliarInventarioResourceGraph`) — só o rótulo muda conforme `tipo`.
  const isReconciliacao = progresso.tipo === 'reconciliacao'
  const titulo = isReconciliacao ? 'Reconciliação (Resource Graph)' : 'Coleta de Inventário'

  return (
    <div className="stat-card" style={{ margin: '16px 20px 0', padding: '16px 20px', borderColor: corBorda, borderWidth: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {emExecucao ? `⏳ ${titulo} em andamento` : (houveErro ? `❌ ${titulo} com erro` : `✅ ${titulo} concluída`)}
        </span>
        {!emExecucao && (
          <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setDismissed(true)}>Fechar</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {progresso.fase}
        {progresso.sub_total > 0 && ` (${progresso.sub_idx}/${progresso.sub_total})`}
      </div>

      <div style={{ display: 'flex', gap: 18, fontSize: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span>{isReconciliacao ? 'Recursos encontrados' : 'Eventos'}: <strong>{progresso.eventos.toLocaleString('pt-BR')}</strong></span>
        <span>Novos: <strong style={{ color: 'var(--green,#22c55e)' }}>{progresso.novos.toLocaleString('pt-BR')}</strong></span>
        {!isReconciliacao && (
          <>
            <span>Atualizados: <strong style={{ color: 'var(--accent)' }}>{progresso.atualizados.toLocaleString('pt-BR')}</strong></span>
            <span>Excluídos: <strong style={{ color: 'var(--red,#ff4d6a)' }}>{progresso.excluidos.toLocaleString('pt-BR')}</strong></span>
            {!!progresso.descartadas && (
              <span title="Propriedades vistas na Change Analysis que não bateram na allowlist curada (ruído)">
                Descartadas: <strong style={{ color: 'var(--text-muted)' }}>{progresso.descartadas.toLocaleString('pt-BR')}</strong>
              </span>
            )}
          </>
        )}
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
