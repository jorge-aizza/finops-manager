import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOrfaosPublica } from '../api/orfaosPublica'
import type { OrfaoCategoria } from '../types/orfaosPublica'

const CATEGORIA_LABEL: Record<OrfaoCategoria, string> = {
  disco_orfao: '💾 Disco não anexado',
  snapshot_antigo: '📸 Snapshot antigo',
  ip_solto: '🌐 IP público sem uso',
  nic_orfa: '🔌 NIC não anexada',
  app_service_plan_vazio: '🗂️ App Service Plan sem apps',
  lb_sem_backend: '⚖️ Load Balancer sem backend',
  appgw_sem_backend: '🚪 App Gateway sem backend',
  vm_parada: '⏸️ VM parada (sem desalocar)',
}

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PublicOrfaosView() {
  const query = useQuery({
    queryKey: ['portal-orfaos'],
    queryFn: getOrfaosPublica,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const [tipo, setTipo] = useState<'' | OrfaoCategoria>('')
  const [rg, setRg] = useState('')
  const [busca, setBusca] = useState('')

  const itens = query.data?.itens ?? []
  const rgs = Array.from(new Set(itens.map((i) => i.resource_group).filter((r): r is string => !!r))).sort((a, b) => a.localeCompare(b))
  const termo = busca.trim().toLowerCase()
  const filtrados = itens.filter((i) =>
    (!tipo || i.categoria === tipo)
    && (!rg || i.resource_group === rg)
    && (!termo || (i.nome || '').toLowerCase().includes(termo)))
  const custo = filtrados.reduce((a, i) => a + (i.custo_mensal_estimado || 0), 0)
  const semCusto = filtrados.filter((i) => i.custo_mensal_estimado === null).length
  const temFiltro = !!(tipo || rg || termo)

  return (
    <div className="portal-calc-wrap" data-testid="public-orfaos">
      <div className="card" style={{ margin: '16px 0' }}>
        <div className="card-header">
          <span className="card-title">Recursos Órfãos</span>
          {query.data && <span className="badge">{query.data.total_itens}</span>}
        </div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Recursos provisionados que ninguém está usando. O custo é estimado pelo billing observado nos últimos 30 dias.
          Recursos sem billing conhecido aparecem como &ldquo;—&rdquo;, nunca como R$ 0,00.
        </div>

        {query.isLoading && (
          <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            Consultando os recursos… (pode levar alguns segundos)
          </div>
        )}
        {query.isError && (
          <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--red,#ff4d6a)' }}>
            {(query.error as Error).message}
          </div>
        )}

        {query.data && (
          <div style={{ padding: '0 20px 16px' }}>
            <div className="filters-bar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="filter-select" aria-label="Tipo de recurso" value={tipo} onChange={(e) => setTipo(e.target.value as '' | OrfaoCategoria)}>
                <option value="">Todos os tipos</option>
                {query.data.por_categoria.map((c) => (
                  <option key={c.categoria} value={c.categoria}>{CATEGORIA_LABEL[c.categoria] || c.categoria} ({c.itens})</option>
                ))}
              </select>
              <select className="filter-select" aria-label="Resource Group" value={rg} onChange={(e) => setRg(e.target.value)}>
                <option value="">Todos os Resource Groups</option>
                {rgs.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input type="text" className="filter-input" style={{ minWidth: 220 }} placeholder="Buscar por nome do recurso..."
                value={busca} onChange={(e) => setBusca(e.target.value)} />
              {temFiltro && (
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setTipo(''); setRg(''); setBusca('') }}>Limpar filtros</button>
              )}
            </div>

            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', margin: '12px 0' }}>
              <div className="stat-card yellow-card">
                <div className="stat-label">Desperdício estimado por mês</div>
                <div className="stat-value" style={{ color: 'var(--orange,#ff8c42)' }}>{fmtBRL(custo)}</div>
              </div>
              <div className="stat-card danger">
                <div className="stat-label">Projeção anual</div>
                <div className="stat-value">{fmtBRL(custo * 12)}</div>
              </div>
              <div className="stat-card accent">
                <div className="stat-label">Recursos órfãos{temFiltro ? ` (de ${itens.length})` : ''}</div>
                <div className="stat-value">{filtrados.length}</div>
              </div>
            </div>

            {semCusto > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                {semCusto} recurso(s) sem billing conhecido — não saber o custo não é o mesmo que ser de graça.
              </div>
            )}

            {query.data.total_itens === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum recurso órfão para exibir.</div>
            )}
            {query.data.total_itens > 0 && filtrados.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum recurso bate com os filtros selecionados.</div>
            )}

            {filtrados.length > 0 && (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recurso</th><th>Tipo</th><th>Resource Group</th><th>SKU</th>
                      <th style={{ textAlign: 'right' }}>Tam.</th>
                      <th style={{ textAlign: 'right' }}>Custo/mês</th>
                      <th style={{ textAlign: 'right' }}>Dias órfão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((it, idx) => (
                      <tr key={idx}>
                        <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.nome || ''}>{it.nome || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{CATEGORIA_LABEL[it.categoria] || it.categoria}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.resource_group || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.sku || '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{it.tamanho_gb ? it.tamanho_gb + ' GB' : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: it.custo_mensal_estimado ? 'var(--orange,#ff8c42)' : 'var(--text-muted)' }}>
                          {it.custo_mensal_estimado === null ? '—' : fmtBRL(it.custo_mensal_estimado)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: it.dias_orfao !== null ? 'var(--red,#ff4d6a)' : 'var(--text-muted)' }}>
                          {it.dias_orfao !== null ? `${it.dias_orfao}d` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
