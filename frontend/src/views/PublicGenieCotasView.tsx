import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getPortalEntraLoginUrl,
  getPortalEntraToken, clearPortalEntraToken,
  getGenieCotasPublica,
} from '../api/portalEntra'
import CkBarChart from '../components/CkBarChart'
import type { CkSerie } from '../components/CkBarChart'
import PortalHero from '../components/PortalHero'
import type { GenieCotaPublicaWorkspace, GenieCotasPeriodoPublico } from '../types/genieCotasPublica'

function fmtBRL(v: number): string {
  return 'US$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// Preenche os dias sem registro com zero — mesmo motivo do painel interno
// (DatabricksCotasPanel.tsx): sem isso o eixo do gráfico vira um calendário incompleto.
function preencherDias(linhas: { dia: string }[]): string[] {
  if (!linhas.length) return []
  const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const lista: string[] = []
  const fim = new Date(linhas[linhas.length - 1].dia + 'T12:00:00')
  for (const d = new Date(linhas[0].dia + 'T12:00:00'); d <= fim; d.setDate(d.getDate() + 1)) lista.push(ymd(d))
  return lista
}

function WorkspaceCard({ ws }: { ws: GenieCotaPublicaWorkspace }) {
  const dias = preencherDias(ws.dias)
  const mapa = new Map(ws.dias.map((d) => [d.dia, d]))
  const series: CkSerie[] = [
    { label: 'DBU Free', cor: 'var(--ck-lilac-hover)', eixo: 'b', fmt: (v) => v.toLocaleString('pt-BR') + ' DBU', valores: dias.map((d) => mapa.get(d)?.dbus_free || 0) },
    { label: 'Seu uso (USD)', cor: 'var(--ck-teal)', fmt: fmtBRL, valores: dias.map((d) => mapa.get(d)?.custo || 0) },
    ...(ws.limite_per_user != null ? [{ label: 'Limite pessoal (USD)', cor: 'var(--ck-red)', fmt: fmtBRL, valores: dias.map(() => ws.limite_per_user!) }] : []),
    ...(ws.quota_nativa != null ? [{ label: 'Quota Genie nativa (USD)', cor: 'var(--ck-yellow)', fmt: fmtBRL, valores: dias.map(() => ws.quota_nativa!) }] : []),
  ]
  return (
    <div className="card ck-cotas" style={{ padding: 20, marginBottom: 16 }}>
      <div className="ck-panel-head">
        <div>
          <h2>{ws.workspace_nome}</h2>
          <div className="ck-panel-note">
            ID {ws.workspace_id} · Seu consumo: <strong>{fmtBRL(ws.custo)}</strong> · {ws.dbus.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} DBU
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, margin: '16px 0', fontSize: 13 }}>
        <span>Quota do workspace: <strong>{ws.quota_nativa == null ? 'Não configurada' : fmtBRL(ws.quota_nativa)}</strong></span>
        <span>Limite pessoal: <strong>{ws.limite_per_user == null ? 'Não configurado' : fmtBRL(ws.limite_per_user)}</strong></span>
        <span>Status pessoal: <strong>{ws.status_usuario || ws.status || 'Sem limite per-user'}</strong></span>
      </div>
      <CkBarChart dias={dias} series={series} />
      {ws.detalhes.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Detalhamento por produto e SKU ({ws.detalhes.length})</summary>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead><tr>{['Data', 'Produto', 'SKU', 'Endpoint', 'DBU', 'Custo'].map((col) => <th key={col} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-color, #ddd)' }}>{col}</th>)}</tr></thead>
              <tbody>{ws.detalhes.map((item, index) => (
                <tr key={`${item.dia}-${item.sku}-${item.endpoint}-${index}`}>
                  <td style={{ padding: '8px 10px' }}>{item.dia}</td>
                  <td style={{ padding: '8px 10px' }}>{item.produto}</td>
                  <td style={{ padding: '8px 10px' }}>{item.sku}</td>
                  <td style={{ padding: '8px 10px' }}>{item.endpoint}</td>
                  <td style={{ padding: '8px 10px' }}>{item.dbus.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtBRL(item.custo)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

export default function PublicGenieCotasView() {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => getPortalEntraToken())
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState('')
  const [period, setPeriod] = useState<GenieCotasPeriodoPublico>('month')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')

  // O handoff do login (?portal_handoff=) é processado em PortalApp.tsx, não aqui: o
  // redirect da Microsoft chega em portal.html SEM hash, então esta view (só montada quando
  // a rota já é #/genie-cotas) ainda não existiria pra tratar o código. Aqui só reagimos ao
  // token já salvo — 'storage' cobre o caso em que PortalApp salvou o token e navegou pra
  // esta rota no mesmo ciclo (o componente monta depois, sem ver o evento de state do pai).
  useEffect(() => {
    const atual = getPortalEntraToken()
    if (atual && atual !== token) setToken(atual)
  }, [token])

  const query = useQuery({
    queryKey: ['portal-genie-cotas', period],
    queryFn: () => getGenieCotasPublica(period),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    if (query.isError) { clearPortalEntraToken(); setToken(null) }
  }, [query.isError])

  async function entrar() {
    setErro(''); setEntrando(true)
    try {
      window.location.href = await getPortalEntraLoginUrl()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao iniciar login.')
      setEntrando(false)
    }
  }

  function sair() {
    clearPortalEntraToken()
    setToken(null)
    qc.removeQueries({ queryKey: ['portal-genie-cotas'] })
  }

  const workspaces = query.data?.workspaces || []
  const workspacesVisiveis = workspaces.filter((ws) => {
    const workspaceMatch = workspaceFilter === 'all' || ws.workspace_id === workspaceFilter
    return workspaceMatch
  })
  const custoTotal = workspacesVisiveis.reduce((total, ws) => total + ws.custo, 0)
  const dbusTotal = workspacesVisiveis.reduce((total, ws) => total + ws.dbus, 0)
  const dbusFreeTotal = workspacesVisiveis.reduce((total, ws) => total + (ws.dbus_free ?? ws.dias.reduce((sum, dia) => sum + dia.dbus_free, 0)), 0)
  const limitePessoalTotal = workspacesVisiveis.reduce((total, ws) => total + (ws.limite_per_user ?? 0), 0)

  // Mesmo hero com raios/brilho das outras telas do portal (PortalHero) — layout único em
  // todo o portal, não um visual por serviço.
  const hero = (
    <PortalHero titulo="Minha Cota Genie" descricao="Consulte, com sua conta Microsoft, sua cota e seu consumo pessoal do Genie no Databricks.">
      <div className="portal-hero-chips">
        <span className="portal-chip">🔐 Login com sua conta Microsoft</span>
        <span className="portal-chip">📊 Consumo diário (DBU e USD)</span>
        <span className="portal-chip">🎯 Cota configurada e quota nativa</span>
      </div>
    </PortalHero>
  )

  if (!token) {
    return (
      <>
        {hero}
        <div className="portal-calc-wrap" data-testid="public-genie-cotas-login">
          <div className="card" style={{ margin: '16px 0', padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Entre com sua conta Microsoft</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, maxWidth: 420, marginInline: 'auto' }}>
              Sua Cota Genie é pessoal — para ver seu consumo e sua cota, confirme quem você é
              com a mesma conta Microsoft corporativa usada no Databricks.
            </div>
            <button className="btn-primary" disabled={entrando} onClick={entrar}>
              {entrando ? 'Redirecionando...' : 'Entrar com Microsoft'}
            </button>
            {erro && <div style={{ color: 'var(--red,#ff4d6a)', fontSize: 12, marginTop: 12 }}>{erro}</div>}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {hero}
      <div className="portal-calc-wrap" data-testid="public-genie-cotas">
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '16px 0 0' }}>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={sair}>Trocar de conta</button>
      </div>
      {query.data && (
        <>
          <div className="ck-controls">
            <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Período
              <select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as GenieCotasPeriodoPublico)}>
                <option value="today">Hoje</option><option value="month">Mês atual</option><option value="all">Todo o histórico</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Workspace
              <select aria-label="Workspace" value={workspaceFilter} onChange={(e) => setWorkspaceFilter(e.target.value)}>
                <option value="all">Todos</option>{workspaces.map((ws) => <option key={ws.workspace_id} value={ws.workspace_id}>{ws.workspace_nome}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Produto
              <select aria-label="Produto" value="Genie" disabled><option value="Genie">Genie</option></select>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Usuário autenticado: <strong>{query.data.nome}</strong></div>
          </div>
          {query.data.cache && (
            <div style={{ margin: '-4px 0 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              Última coleta: {new Date(query.data.cache.atualizado_em).toLocaleString('pt-BR')}
              {query.data.cache.desatualizado
                ? query.data.cache.atualizando ? ' · Atualizando dados' : ' · Dados desatualizados'
                : ''}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Consumo no período</div><strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>{fmtBRL(custoTotal)}</strong></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>DBUs consumidas</div><strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>{dbusTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>DBU Free</div><strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>{dbusFreeTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Limites pessoais configurados</div><strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>{fmtBRL(limitePessoalTotal)}</strong></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Workspaces com consumo</div><strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>{workspacesVisiveis.length}</strong></div>
          </div>
        </>
      )}
      {query.isLoading && <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--text-muted)' }}>Carregando sua cota...</div>}
      {query.isError && (
        <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--red,#ff4d6a)' }}>
          {(query.error as Error).message}
        </div>
      )}
      {query.data && query.data.workspaces.length === 0 && (
        <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--text-muted)' }}>
          Nenhum consumo de Genie encontrado para {query.data.nome} neste período.
        </div>
      )}
      {query.data && query.data.workspaces.length > 0 && workspacesVisiveis.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)' }}>Nenhum resultado para os filtros selecionados.</div>}
      {workspacesVisiveis.map((ws) => <WorkspaceCard key={ws.workspace_id} ws={ws} />)}
      </div>
    </>
  )
}
