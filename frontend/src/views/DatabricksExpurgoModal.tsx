import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { executarDatabricksPurge, getDatabricksPurgePreview, getDatabricksResumo } from '../api/databricksColeta'

type Modo = 'periodo' | 'workspace' | 'tudo'

interface Props {
  onClose: () => void
}

function brl(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Porta de ExpurgoModal.tsx (Azure) — mesma UX (3 modos, preview antes de habilitar
// "Confirmar", segundo gate via confirm()), mas escopado por workspace_id em vez de
// arquivo_origem: databricks_consumo não rastreia de qual arquivo cada linha veio
// (config_id fica NULL pra import manual), então "por arquivo" não é um filtro
// possível hoje — "por workspace" cobre o caso de uso real (limpar um workspace de
// teste específico) sem precisar de coluna nova. Pedido do usuário (2026-08-27) depois
// de gerar dados de teste repetidamente via script Python pra validar a Importação
// Manual — precisava de um jeito de limpar isso sem esperar um "Limpar Dados" geral.
export default function DatabricksExpurgoModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [modo, setModo] = useState<Modo>('periodo')
  const [dataIni, setDataIni] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [preview, setPreview] = useState<{ total: number } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Range bem largo (não os últimos 6 meses padrão do dashboard) — pra listar
  // workspaces antigos também, já que o objetivo aqui é justamente limpar dados
  // velhos/de teste que o dashboard normal pode nem estar mostrando.
  const resumoQuery = useQuery({
    queryKey: ['databricks-resumo-purge'],
    queryFn: () => getDatabricksResumo('2015-01-01', new Date().toISOString().slice(0, 10)),
  })

  const previewMutation = useMutation({
    mutationFn: () => {
      if (modo === 'workspace') return getDatabricksPurgePreview({ workspace_id: workspaceId })
      return getDatabricksPurgePreview({ data_inicio: dataIni || undefined, data_fim: dataFim || undefined })
    },
    onSuccess: (d) => setPreview(d),
  })

  const purgeMutation = useMutation({
    mutationFn: () => {
      if (modo === 'workspace') return executarDatabricksPurge({ workspace_id: workspaceId })
      if (modo === 'tudo') return executarDatabricksPurge({})
      return executarDatabricksPurge({ data_inicio: dataIni || undefined, data_fim: dataFim || undefined })
    },
    onSuccess: (d) => {
      setResult({ ok: true, msg: d.message })
      queryClient.invalidateQueries({ queryKey: ['databricks-resumo'] })
      queryClient.invalidateQueries({ queryKey: ['databricks-resumo-purge'] })
      queryClient.invalidateQueries({ queryKey: ['databricks-alertas'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
      setTimeout(() => { onClose(); window.showToast?.('Dados removidos!', 'success') }, 2200)
    },
    onError: (e: Error) => setResult({ ok: false, msg: e.message }),
  })

  function handleVerificar() {
    if (modo === 'workspace' && !workspaceId) { window.showToast?.('Selecione um workspace.', 'error'); return }
    if (modo === 'periodo' && !dataIni && !dataFim) { window.showToast?.('Informe ao menos uma data.', 'error'); return }
    setPreview(null)
    previewMutation.mutate()
  }

  function handleConfirmar() {
    const label = modo === 'tudo'
      ? 'TODOS os dados de consumo Databricks'
      : modo === 'workspace'
        ? `os registros do workspace "${workspaceId}"`
        : `os registros do período ${dataIni || '—'} → ${dataFim || '—'}`
    if (!confirm(`Tem certeza que deseja remover ${label}? Esta ação não pode ser desfeita.`)) return
    setResult(null)
    purgeMutation.mutate()
  }

  const workspaces = resumoQuery.data?.por_workspace.map((w) => w.workspace_id) || []
  const podeConfirmar = modo === 'tudo' || (preview !== null && preview.total > 0)

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(92vw, 500px)' }}>
        <div className="modal-header">
          <span>🗑 Expurgo de Dados Databricks</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'rgba(147,51,234,.07)', border: '1px solid rgba(147,51,234,.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            {resumoQuery.isLoading && <span><span style={{ color: 'var(--accent)' }}>⟳</span> Carregando dados do banco...</span>}
            {resumoQuery.isError && <span style={{ color: 'var(--danger)' }}>Erro ao carregar dados.</span>}
            {resumoQuery.data && (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Custo total registrado</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{brl(resumoQuery.data.total_custo)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Workspaces</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{workspaces.length || '—'}</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Escopo do expurgo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="radio" name="dbx-purge-tipo" aria-label="Por período" checked={modo === 'periodo'} onChange={() => { setModo('periodo'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Por período</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remove todos os registros dentro de um intervalo de datas</div></div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="radio" name="dbx-purge-tipo" aria-label="Por workspace" checked={modo === 'workspace'} onChange={() => { setModo('workspace'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Por workspace</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remove apenas registros de um workspace específico (ex: dados de teste)</div></div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,77,106,.3)', background: 'rgba(255,77,106,.04)' }}>
              <input type="radio" name="dbx-purge-tipo" aria-label="Todos os dados" checked={modo === 'tudo'} onChange={() => { setModo('tudo'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>Todos os dados</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Apaga toda a base de consumo Databricks</div></div>
            </label>
          </div>

          {modo === 'periodo' && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label htmlFor="dbx-purge-data-ini" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Data início</label>
                  <input id="dbx-purge-data-ini" type="date" className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={dataIni} onChange={(e) => { setDataIni(e.target.value); setPreview(null) }} />
                </div>
                <div>
                  <label htmlFor="dbx-purge-data-fim" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Data fim</label>
                  <input id="dbx-purge-data-fim" type="date" className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={dataFim} onChange={(e) => { setDataFim(e.target.value); setPreview(null) }} />
                </div>
              </div>
              <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px' }} disabled={previewMutation.isPending} onClick={handleVerificar}>
                🔍 Verificar quantos registros serão removidos
              </button>
            </div>
          )}

          {modo === 'workspace' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Workspace</label>
              <select className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={workspaceId} onChange={(e) => { setWorkspaceId(e.target.value); setPreview(null) }}>
                <option value="">— selecione —</option>
                {workspaces.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
              </select>
              <button type="button" className="btn-ghost" style={{ marginTop: 8, fontSize: 12, padding: '6px 16px' }} disabled={previewMutation.isPending} onClick={handleVerificar}>
                🔍 Verificar
              </button>
            </div>
          )}

          {previewMutation.isPending && (
            <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--accent)', background: 'rgba(147,51,234,.08)', border: '1px solid rgba(147,51,234,.2)', marginBottom: 12 }}>
              ⟳ Verificando...
            </div>
          )}
          {!previewMutation.isPending && preview && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12,
              color: preview.total === 0 ? 'var(--green,#22c55e)' : 'var(--danger)',
              background: preview.total === 0 ? 'rgba(34,197,94,.08)' : 'rgba(255,77,106,.08)',
              border: '1px solid ' + (preview.total === 0 ? 'rgba(34,197,94,.2)' : 'rgba(255,77,106,.2)'),
            }}>
              {preview.total === 0 ? '✓ Nenhum registro encontrado nesse critério.' : `⚠ ${preview.total.toLocaleString('pt-BR')} registros serão removidos permanentemente.`}
            </div>
          )}

          {result && (
            <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 6, color: result.ok ? 'var(--accent)' : '#ff4d6a', background: result.ok ? 'rgba(147,51,234,.08)' : 'rgba(255,77,106,.1)', border: '1px solid ' + (result.ok ? 'rgba(147,51,234,.3)' : 'rgba(255,77,106,.3)') }}>
              {result.ok ? '✅ ' : '❌ '}{result.msg}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            disabled={!podeConfirmar || purgeMutation.isPending}
            onClick={handleConfirmar}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 36, borderRadius: 6, border: 'none',
              background: '#ff4d6a', color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: (!podeConfirmar || purgeMutation.isPending) ? 'not-allowed' : 'pointer',
              opacity: (!podeConfirmar || purgeMutation.isPending) ? 0.45 : 1,
            }}
          >
            🗑 {purgeMutation.isPending ? 'Removendo...' : 'Confirmar Expurgo'}
          </button>
        </div>
      </div>
    </div>
  )
}
