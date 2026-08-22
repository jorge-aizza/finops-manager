import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAcoes } from '../api/acoes'
import { CLOUDS, STATUS_COLORS, STATUS_OPTIONS } from '../config/acaoOptions'
import type { Acao } from '../types/acao'
import AcaoModal from './AcaoModal'

function formatBRL(v: number | null): string {
  return v ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

function isAtrasada(a: Acao): boolean {
  if (!['Em Andamento', 'Planejado'].includes(a.status) || !a.data_conclusao) return false
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return new Date(a.data_conclusao) < hoje
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#7b6a9e'
  return (
    <span style={{ background: c + '22', color: c, border: '1px solid ' + c + '55', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  )
}

export default function AcoesView() {
  const acoesQuery = useQuery({ queryKey: ['acoes'], queryFn: () => listAcoes() })
  const all = acoesQuery.data || []

  const [search, setSearch] = useState('')
  const [filterCloud, setFilterCloud] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Acao | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return all.filter(
      (a) =>
        (!filterCloud || a.cloud === filterCloud) &&
        (!filterStatus || a.status === filterStatus) &&
        (!q ||
          a.acao.toLowerCase().includes(q) ||
          (a.responsavel || '').toLowerCase().includes(q) ||
          a.id_finops.toLowerCase().includes(q)),
    )
  }, [all, search, filterCloud, filterStatus])

  function openNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(a: Acao) {
    setEditing(a)
    setModalOpen(true)
  }

  return (
    <div>
      <div className="filters-bar" style={{ alignItems: 'center' }}>
        <input
          type="text"
          className="filter-input"
          placeholder="Buscar ação, responsável..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterCloud} onChange={(e) => setFilterCloud(e.target.value)}>
          <option value="">Todas as Clouds</option>
          {CLOUDS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Todos os Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={openNew}>
          Nova Ação
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Ações FinOps</span>
          <span className="badge">{all.length}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID FinOps</th>
                <th>Projeto</th>
                <th>Ação</th>
                <th>Cloud</th>
                <th>Responsável</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Impacto/Mês</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Retorno Ano</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {acoesQuery.isLoading && (
                <tr><td colSpan={10} className="empty-state">Carregando...</td></tr>
              )}
              {acoesQuery.isError && (
                <tr><td colSpan={10} className="empty-state">Erro ao carregar ações: {(acoesQuery.error as Error).message}</td></tr>
              )}
              {!acoesQuery.isLoading && !acoesQuery.isError && filtered.length === 0 && (
                <tr><td colSpan={10} className="empty-state">Nenhuma ação encontrada</td></tr>
              )}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td><span className="finops-id">{a.id_finops}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{a.projeto_nome || '—'}</td>
                  <td style={{ fontWeight: 500 }}>{a.acao}</td>
                  <td>{a.cloud || '—'}</td>
                  <td>{a.responsavel || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{a.tipo_acao || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{formatBRL(a.impacto_atual_mes)}</td>
                  <td>
                    <StatusBadge status={a.status} />
                    {isAtrasada(a) && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--danger)' }}>⚠ Atrasado</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{formatBRL(a.retorno_ano_atual)}</td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title="Editar" onClick={() => openEdit(a)}>
                        <svg viewBox="0 0 16 16" fill="none">
                          <path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && <AcaoModal acao={editing} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
