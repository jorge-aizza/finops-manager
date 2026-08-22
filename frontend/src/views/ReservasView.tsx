import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listReservas } from '../api/reservas'
import { listSubscriptions } from '../api/azure'
import { CLOUD_COLORS, CLOUDS, SCOPE_CONFIG, STATUS_COLORS, type Cloud } from '../config/reservaScopes'
import type { Reserva } from '../types/reserva'
import ReservaModal from './ReservaModal'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function formatBRL(v: number | null): string {
  return v ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#7b6a9e'
  return (
    <span
      style={{
        background: c + '22', color: c, border: '1px solid ' + c + '55',
        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      }}
    >
      {status}
    </span>
  )
}

function VencimentoLabel({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <>—</>
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const diff = Math.floor((d.getTime() - hoje.getTime()) / 86400000)
  let badge: ReactNode = null
  if (diff < 0) badge = <span style={{ color: '#ff4d6a', fontSize: 10, marginLeft: 4 }}>⚠ expirada</span>
  else if (diff <= 30) badge = <span style={{ color: '#ff8c42', fontSize: 10, marginLeft: 4 }}>⚠ {diff}d</span>
  else if (diff <= 90) badge = <span style={{ color: '#f9e2af', fontSize: 10, marginLeft: 4 }}>~{Math.round(diff / 30)}m</span>
  return (
    <>
      {formatDate(dateStr)}
      {badge}
    </>
  )
}

export default function ReservasView() {
  const reservasQuery = useQuery({ queryKey: ['reservas'], queryFn: () => listReservas() })
  const subsQuery = useQuery({ queryKey: ['azure-subscriptions'], queryFn: listSubscriptions })
  const subscriptions = subsQuery.data || []

  const [search, setSearch] = useState('')
  const [filterCloud, setFilterCloud] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Reserva | null>(null)

  const all = reservasQuery.data || []

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return all.filter(
      (r) =>
        (!filterCloud || r.cloud === filterCloud) &&
        (!filterStatus || r.status === filterStatus) &&
        (!q || r.nome_reserva.toLowerCase().includes(q) || r.tipo_recurso.toLowerCase().includes(q)),
    )
  }, [all, search, filterCloud, filterStatus])

  const stats = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const em90 = new Date(hoje); em90.setDate(hoje.getDate() + 90)
    const ativas = all.filter((r) => r.status === 'Ativa')
    const vencendo = ativas.filter((r) => new Date(r.data_vencimento) <= em90)
    const custoMes = ativas.reduce((s, r) => s + (r.custo_mensal || 0), 0)
    return { total: all.length, ativas: ativas.length, vencendo: vencendo.length, custoMes }
  }, [all])

  function subRgDisplay(r: Reserva): string {
    const escopo = r.tipo_escopo || 'Shared'
    const cfg = (SCOPE_CONFIG[r.cloud as Cloud] || {})[escopo] || {}
    const subDisplay = subscriptions.find((s) => s.subscription_id === r.subscription_id)?.subscription_name
      || r.subscription_id
    if (cfg.rg && r.resource_group_name) return r.resource_group_name
    if (cfg.sub && subDisplay) return subDisplay
    return '—'
  }

  function openNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(r: Reserva) {
    setEditing(r)
    setModalOpen(true)
  }

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card accent">
          <div className="stat-label">Total de Reservas</div>
          <div className="stat-value">{stats.total || '—'}</div>
          <div className="stat-sub">cadastradas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ativas</div>
          <div className="stat-value">{stats.ativas || '—'}</div>
          <div className="stat-sub">em vigor</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Vencendo em 90 dias</div>
          <div className="stat-value">{stats.vencendo || '—'}</div>
          <div className="stat-sub">requerem atenção</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo Mensal Total</div>
          <div className="stat-value">{formatBRL(stats.custoMes)}</div>
          <div className="stat-sub">reservas ativas</div>
        </div>
      </div>

      <div className="filters-bar" style={{ alignItems: 'center' }}>
        <input
          type="text"
          className="filter-input"
          placeholder="Buscar reserva..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterCloud} onChange={(e) => setFilterCloud(e.target.value)}>
          <option value="">Todas as Clouds</option>
          {CLOUDS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Todos os Status</option>
          <option>Ativa</option>
          <option>Expirada</option>
          <option>Cancelada</option>
        </select>
        <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={openNew}>
          Nova Reserva
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cloud</th>
              <th>Nome da Reserva</th>
              <th>Tipo de Recurso</th>
              <th>Escopo</th>
              <th>Subscription / RG</th>
              <th>Prazo</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Custo/Mês</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {reservasQuery.isLoading && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  Carregando...
                </td>
              </tr>
            )}
            {reservasQuery.isError && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  Erro ao carregar reservas: {(reservasQuery.error as Error).message}
                </td>
              </tr>
            )}
            {!reservasQuery.isLoading && !reservasQuery.isError && filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  Nenhuma reserva encontrada
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <span style={{ color: CLOUD_COLORS[r.cloud] || '#9333ea', fontWeight: 600 }}>{r.cloud}</span>
                </td>
                <td style={{ fontWeight: 500 }}>{r.nome_reserva}</td>
                <td>{r.tipo_recurso}</td>
                <td style={{ fontSize: 12 }}>{r.tipo_escopo || 'Shared'}</td>
                <td
                  style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={subRgDisplay(r)}
                >
                  {subRgDisplay(r)}
                </td>
                <td>{r.prazo || '—'}</td>
                <td>
                  <VencimentoLabel dateStr={r.data_vencimento} />
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ textAlign: 'right' }}>{formatBRL(r.custo_mensal)}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon" title="Editar" onClick={() => openEdit(r)}>
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

      {modalOpen && (
        <ReservaModal reserva={editing} subscriptions={subscriptions} onClose={() => setModalOpen(false)} />
      )}
    </div>
  )
}
