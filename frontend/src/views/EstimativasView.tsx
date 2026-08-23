import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteEstimativa, getEstimativa, listEstimativas, setEstimativaStatus } from '../api/estimativas'
import { buildPdfHtml } from '../lib/buildPdfHtml'
import InvoicePreviewModal from '../components/InvoicePreviewModal'
import type { Estimativa, EstimativaResumo, EstimativaStatus } from '../types/estimativa'

function formatBRL(v: number | null | undefined): string {
  return v ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

function formatData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR')
}

// Validade calculada a partir da data-only (evita fuso deslocando o dia,
// diferente do legado que soma ms sobre new Date(data_estimativa)).
function calcValidade(dataEstimativa: string | null, validadeDias: number): { texto: string; ativa: boolean } {
  if (!dataEstimativa || !validadeDias) return { texto: '—', ativa: false }
  const base = new Date(dataEstimativa.slice(0, 10) + 'T12:00:00')
  const venc = new Date(base.getTime() + validadeDias * 86400000)
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0)
  return { texto: venc.toLocaleDateString('pt-BR'), ativa: venc >= hoje }
}

const STATUS_BADGE: Record<EstimativaStatus, string> = {
  Aprovado: '#22c55e',
  'Nao Aprovado': '#ff4d6a',
  Pendente: '#ff8c42',
}

function StatusBadge({ status }: { status: EstimativaStatus }) {
  const c = STATUS_BADGE[status] || STATUS_BADGE.Pendente
  return (
    <span style={{ background: c + '22', color: c, border: '1px solid ' + c + '55', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {status || 'Pendente'}
    </span>
  )
}

export default function EstimativasView() {
  const queryClient = useQueryClient()
  const estimativasQuery = useQuery({ queryKey: ['estimativas'], queryFn: listEstimativas })
  const all = estimativasQuery.data || []

  const [search, setSearch] = useState('')
  const [filterProjeto, setFilterProjeto] = useState('')
  const [detalheId, setDetalheId] = useState<number | null>(null)

  const projetos = useMemo(
    () => [...new Set(all.map((e) => e.projeto_nome || 'Sem Projeto'))].sort(),
    [all],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return all.filter((e) => {
      const matchesSearch = !q
        || (e.numero || '').toLowerCase().includes(q)
        || (e.projeto_nome || '').toLowerCase().includes(q)
        || (e.titulo || '').toLowerCase().includes(q)
      const matchesProjeto = !filterProjeto || (e.projeto_nome || 'Sem Projeto') === filterProjeto
      return matchesSearch && matchesProjeto
    })
  }, [all, search, filterProjeto])

  const stats = useMemo(() => {
    const groups = new Map<string, { count: number; total: number }>()
    for (const e of filtered) {
      const key = e.projeto_nome || 'Sem Projeto'
      const g = groups.get(key) || { count: 0, total: 0 }
      g.count++
      g.total += e.total_final || 0
      groups.set(key, g)
    }
    return [...groups.entries()]
  }, [filtered])

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: EstimativaStatus }) => setEstimativaStatus(id, status),
    onSuccess: () => {
      window.showToast?.('Status atualizado.', 'success')
      queryClient.invalidateQueries({ queryKey: ['estimativas'] })
      if (detalheId != null) queryClient.invalidateQueries({ queryKey: ['estimativa', detalheId] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteEstimativa(id),
    onSuccess: () => {
      window.showToast?.('Estimativa excluída.', 'success')
      queryClient.invalidateQueries({ queryKey: ['estimativas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  function handleDelete(e: EstimativaResumo) {
    if (!confirm('Excluir esta estimativa? Esta ação não pode ser desfeita.')) return
    deleteMutation.mutate(e.id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="filters-bar">
        <input
          type="text" className="filter-input" placeholder="Buscar por número, projeto, título..."
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterProjeto} onChange={(e) => setFilterProjeto(e.target.value)}>
          <option value="">Todos os Projetos</option>
          {projetos.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {stats.map(([nome, g]) => (
            <div key={nome} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 12, background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <strong>{nome}</strong> · {g.count} · {formatBRL(g.total)}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Estimativas</span>
          <span className="badge">{all.length}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Número</th><th>Projeto</th><th>Título</th><th>Responsável</th>
                <th style={{ textAlign: 'right' }}>Total Final</th><th>Data</th><th>Validade</th><th>Status</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {estimativasQuery.isLoading && <tr><td colSpan={9} className="empty-state">Carregando...</td></tr>}
              {!estimativasQuery.isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="empty-state">Nenhuma estimativa encontrada</td></tr>
              )}
              {filtered.map((e) => {
                const validade = calcValidade(e.data_estimativa, e.validade_dias)
                return (
                  <tr key={e.id}>
                    <td className="finops-id">{e.numero}</td>
                    <td>{e.projeto_nome || '—'}</td>
                    <td>{e.titulo}</td>
                    <td>{e.responsavel || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatBRL(e.total_final)}</td>
                    <td>{formatData(e.data_estimativa)}</td>
                    <td>
                      <span style={{ color: validade.ativa ? 'var(--green)' : 'var(--danger)', fontSize: 11 }}>
                        {validade.ativa ? 'Ativa' : 'Expirada'}
                      </span>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{validade.texto}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <StatusBadge status={e.status} />
                        <div className="table-actions">
                          <button
                            className="btn-icon" title="Aprovar" disabled={e.status === 'Aprovado'}
                            onClick={() => statusMutation.mutate({ id: e.id, status: 'Aprovado' })}
                          >✓</button>
                          <button
                            className="btn-icon" title="Não Aprovar" disabled={e.status === 'Nao Aprovado'}
                            onClick={() => statusMutation.mutate({ id: e.id, status: 'Nao Aprovado' })}
                          >✗</button>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" title="Ver detalhes" onClick={() => setDetalheId(e.id)}>
                          <svg viewBox="0 0 16 16" fill="none"><path d="M1 8s2.7-5 7-5 7 5 7 5-2.7 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth={1.5} /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth={1.5} /></svg>
                        </button>
                        <button className="btn-icon delete" title="Excluir" onClick={() => handleDelete(e)}>
                          <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detalheId != null && (
        <EstimativaDetalheModal
          id={detalheId}
          onClose={() => setDetalheId(null)}
          onStatusChange={(status) => statusMutation.mutate({ id: detalheId, status })}
        />
      )}
    </div>
  )
}

const MAX_ROWS = 150

function EstimativaDetalheModal({ id, onClose, onStatusChange }: {
  id: number
  onClose: () => void
  onStatusChange: (status: EstimativaStatus) => void
}) {
  const detalheQuery = useQuery({ queryKey: ['estimativa', id], queryFn: () => getEstimativa(id) })
  const e = detalheQuery.data
  const [preview, setPreview] = useState<{ html: string; title: string } | null>(null)

  // Porta de gerarPDFSalvo(e) (calculadora.js) — mesmo buildPdfHtml() usado
  // pelo fluxo "Visualizar Estimativa" da Calculadora, pra nunca divergir
  // visualmente entre os dois PDFs gerados a partir do mesmo shape de dados.
  function gerarPDF(estimativa: Estimativa) {
    const dataVal = estimativa.data_estimativa ? String(estimativa.data_estimativa).slice(0, 10) : new Date().toISOString().slice(0, 10)
    const dataFmt = new Date(dataVal + 'T12:00:00').toLocaleDateString('pt-BR')
    const valDias = estimativa.validade_dias || 5
    const dataValid = new Date(new Date(dataVal + 'T12:00:00').getTime() + valDias * 86400000).toLocaleDateString('pt-BR')
    const recursos = Array.isArray(estimativa.recursos) ? estimativa.recursos : []
    const fixoMes = recursos.filter((r) => r.tipo_custo === 'mes').reduce((s, r) => s + (r.estimado_brl || r.custo_mes || 0), 0)
    const html = buildPdfHtml({
      invoiceNum: estimativa.numero || 'EST-000000',
      dataFmt, dataValid,
      nomeProjeto: estimativa.projeto_nome || '',
      titulo: estimativa.titulo || 'Estimativa de Custos Azure',
      resp: estimativa.responsavel || '',
      email: estimativa.email || '',
      obs: estimativa.observacoes || '',
      itens: recursos,
      total_brl: estimativa.total_brl || 0,
      total_fixo_mes: fixoMes,
      total_final: estimativa.total_final || 0,
      pct_imposto: estimativa.pct_imposto || 0,
      vl_imposto: estimativa.vl_imposto || 0,
      pct_cond: estimativa.pct_cond || 0,
      vl_cond: estimativa.vl_cond || 0,
    })
    setPreview({ html, title: (estimativa.titulo || 'Estimativa') + ' · ' + (estimativa.numero || '') })
  }

  return (
    <div className="modal-overlay open" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span>{e?.numero || 'Detalhes da Estimativa'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {detalheQuery.isLoading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>}
          {e && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status:</span>
                  <StatusBadge status={e.status} />
                  <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={e.status === 'Aprovado'} onClick={() => onStatusChange('Aprovado')}>✓ Aprovar</button>
                  <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={e.status === 'Nao Aprovado'} onClick={() => onStatusChange('Nao Aprovado')}>✗ Não Aprovar</button>
                  {e.status !== 'Pendente' && (
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onStatusChange('Pendente')}>↺ Pendente</button>
                  )}
                </div>
                <button className="btn-primary" onClick={() => gerarPDF(e)}>Gerar PDF</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14, fontSize: 12 }}>
                <div><div style={{ color: 'var(--text-muted)' }}>Número</div><div>{e.numero}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Projeto</div><div>{e.projeto_nome || '—'}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Título</div><div>{e.titulo}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Responsável</div><div>{e.responsavel || '—'}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Data</div><div>{formatData(e.data_estimativa)}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Validade até</div><div>{calcValidade(e.data_estimativa, e.validade_dias).texto}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Horas Est.</div><div>{e.horas ?? '—'}</div></div>
                <div><div style={{ color: 'var(--text-muted)' }}>Total Final</div><div style={{ color: 'var(--accent)', fontWeight: 700 }}>{formatBRL(e.total_final)}</div></div>
              </div>

              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>Recurso</th><th>Categoria</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Custo/h</th><th style={{ textAlign: 'right' }}>Estimativa BRL</th></tr>
                  </thead>
                  <tbody>
                    {e.recursos.length === 0 && <tr><td colSpan={5} className="empty-state">Sem recursos registrados</td></tr>}
                    {e.recursos.slice(0, MAX_ROWS).map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r.nome || '—'}
                          {r.sku && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.sku}</div>}
                          {r.uom && <div style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.7, fontFamily: "'IBM Plex Mono',monospace" }}>{r.uom}</div>}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{r.categoria || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{r.isHora ? r.horas + ' h' : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{r.custo_hora != null ? formatBRL(r.custo_hora) + '/h' : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent)' }}>{formatBRL(r.estimado_brl)}</td>
                      </tr>
                    ))}
                    {e.recursos.length > MAX_ROWS && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        + {e.recursos.length - MAX_ROWS} recurso(s) adicionais — ver PDF para lista completa
                      </td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4} style={{ textAlign: 'right' }}>Subtotal</td><td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{formatBRL(e.total_brl)}</td></tr>
                    {e.pct_imposto > 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>+ Imposto ({e.pct_imposto}%)</td><td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{formatBRL(e.vl_imposto)}</td></tr>
                    )}
                    {e.pct_cond > 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>+ Condomínio ({e.pct_cond}%)</td><td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{formatBRL(e.vl_cond)}</td></tr>
                    )}
                    <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total Final</td><td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>{formatBRL(e.total_final)}</td></tr>
                  </tfoot>
                </table>
              </div>

              {e.observacoes && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                  <strong>Observações:</strong> {e.observacoes}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
      {preview && <InvoicePreviewModal html={preview.html} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}
