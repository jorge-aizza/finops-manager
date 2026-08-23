import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { executarPurge, getAzureResumo, getImports, getPurgePreview } from '../api/coleta'

type Modo = 'periodo' | 'arquivo' | 'tudo'

interface Props {
  onClose: () => void
}

function brl(v: number, moeda: string): string {
  return moeda + ' ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Porta de #cpurge-modal / abrirPurge()/verificarPurge()/executarPurge()
// (calculadora.js). Antes acionado só por abrirPurgeAzure() (app.js), cujo
// botão vivia dentro de #view-coleta — inalcançável desde que 'coleta' virou
// view migrada (React é dono da tela), deixando Expurgo/Diagnóstico
// completamente inacessíveis no app até esta fase.
export default function ExpurgoModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [modo, setModo] = useState<Modo>('periodo')
  const [dataIni, setDataIni] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [arquivo, setArquivo] = useState('')
  const [preview, setPreview] = useState<{ total: number } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const resumoQuery = useQuery({ queryKey: ['azure-resumo'], queryFn: getAzureResumo })
  const importsQuery = useQuery({ queryKey: ['coleta-historico', 'manual'], queryFn: getImports })

  const previewMutation = useMutation({
    mutationFn: () => {
      if (modo === 'arquivo') return getPurgePreview({ arquivo })
      return getPurgePreview({ data_inicio: dataIni || undefined, data_fim: dataFim || undefined })
    },
    onSuccess: (d) => setPreview(d),
  })

  const purgeMutation = useMutation({
    mutationFn: () => {
      if (modo === 'arquivo') return executarPurge({ arquivo })
      if (modo === 'tudo') return executarPurge({})
      return executarPurge({ data_inicio: dataIni || undefined, data_fim: dataFim || undefined })
    },
    onSuccess: (d) => {
      setResult({ ok: true, msg: d.message })
      queryClient.invalidateQueries({ queryKey: ['coleta-cobertura'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
      queryClient.invalidateQueries({ queryKey: ['azure-resumo'] })
      setTimeout(() => { onClose(); window.showToast?.('Dados removidos! Reimporte o arquivo, se necessário.', 'success') }, 2200)
    },
    onError: (e: Error) => setResult({ ok: false, msg: e.message }),
  })

  function handleVerificar() {
    if (modo === 'arquivo' && !arquivo) { window.showToast?.('Selecione um arquivo.', 'error'); return }
    if (modo === 'periodo' && !dataIni && !dataFim) { window.showToast?.('Informe ao menos uma data.', 'error'); return }
    setPreview(null)
    previewMutation.mutate()
  }

  function handleConfirmar() {
    const label = modo === 'tudo'
      ? 'TODOS os dados de custo Azure'
      : modo === 'arquivo'
        ? `os registros do arquivo "${arquivo}"`
        : `os registros do período ${dataIni || '—'} → ${dataFim || '—'}`
    if (!confirm(`Tem certeza que deseja remover ${label}? Esta ação não pode ser desfeita.`)) return
    setResult(null)
    purgeMutation.mutate()
  }

  const r = resumoQuery.data?.resumo
  const podeConfirmar = modo === 'tudo' || (preview !== null && preview.total > 0)

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(92vw, 500px)' }}>
        <div className="modal-header">
          <span>🗑 Expurgo de Dados</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: 'rgba(147,51,234,.07)', border: '1px solid rgba(147,51,234,.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            {resumoQuery.isLoading && <span><span style={{ color: 'var(--accent)' }}>⟳</span> Carregando dados do banco...</span>}
            {resumoQuery.isError && <span style={{ color: 'var(--danger)' }}>Erro ao carregar dados.</span>}
            {r && (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Total de registros</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{r.total.toLocaleString('pt-BR')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Período coberto</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{(r.data_inicio || '—').slice(0, 10)} → {(r.data_fim || '—').slice(0, 10)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Custo total</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.total_billing != null ? brl(r.total_billing, r.moeda || '') : '—'}</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Escopo do expurgo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="radio" name="purge-tipo" aria-label="Por período" checked={modo === 'periodo'} onChange={() => { setModo('periodo'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Por período</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remove todos os registros dentro de um intervalo de datas</div></div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="radio" name="purge-tipo" aria-label="Por arquivo importado" checked={modo === 'arquivo'} onChange={() => { setModo('arquivo'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Por arquivo importado</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remove apenas registros de um CSV/Parquet específico</div></div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,77,106,.3)', background: 'rgba(255,77,106,.04)' }}>
              <input type="radio" name="purge-tipo" aria-label="Todos os dados" checked={modo === 'tudo'} onChange={() => { setModo('tudo'); setPreview(null) }} style={{ width: 'auto', flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>Todos os dados</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Apaga toda a base de custos — requer reimportação completa</div></div>
            </label>
          </div>

          {modo === 'periodo' && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label htmlFor="purge-data-ini" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Data início</label>
                  <input id="purge-data-ini" type="date" className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={dataIni} onChange={(e) => { setDataIni(e.target.value); setPreview(null) }} />
                </div>
                <div>
                  <label htmlFor="purge-data-fim" style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Data fim</label>
                  <input id="purge-data-fim" type="date" className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={dataFim} onChange={(e) => { setDataFim(e.target.value); setPreview(null) }} />
                </div>
              </div>
              <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px' }} disabled={previewMutation.isPending} onClick={handleVerificar}>
                🔍 Verificar quantos registros serão removidos
              </button>
            </div>
          )}

          {modo === 'arquivo' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Arquivo importado</label>
              <select className="cs" style={{ width: '100%', boxSizing: 'border-box' }} value={arquivo} onChange={(e) => { setArquivo(e.target.value); setPreview(null) }}>
                <option value="">— selecione —</option>
                {(importsQuery.data || []).filter((i) => i.arquivo_origem).map((imp) => (
                  <option key={imp.arquivo_origem} value={imp.arquivo_origem}>
                    {imp.arquivo_origem} ({imp.linhas.toLocaleString('pt-BR')} reg · {imp.periodo_inicio.slice(0, 10)}→{imp.periodo_fim.slice(0, 10)})
                  </option>
                ))}
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
