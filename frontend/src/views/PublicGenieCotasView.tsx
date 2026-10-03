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
import type { GenieCotaPublicaWorkspace } from '../types/genieCotasPublica'

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
    { label: 'Uso (USD)', cor: 'var(--ck-teal)', fmt: fmtBRL, valores: dias.map((d) => mapa.get(d)?.custo || 0) },
    ...(ws.limite_local != null ? [{ label: 'Cota configurada (USD)', cor: 'var(--ck-red)', fmt: fmtBRL, valores: dias.map(() => ws.limite_local!) }] : []),
    ...(ws.quota_nativa != null ? [{ label: 'Quota Genie nativa (USD)', cor: 'var(--ck-yellow)', fmt: fmtBRL, valores: dias.map(() => ws.quota_nativa!) }] : []),
  ]
  const acaoTxt = ws.acao_nativa === 'BLOCK_USAGE' ? 'de bloqueio' : ws.acao_nativa === 'EMAIL_NOTIFICATION' ? 'de notificação' : null

  return (
    <div className="card ck-cotas" style={{ padding: 20, marginBottom: 16 }}>
      <div className="ck-panel-head">
        <div>
          <h2>{ws.workspace_id}</h2>
          <div className="ck-panel-note">
            Consumo no mês: <strong>{fmtBRL(ws.custo)}</strong>
            {ws.limite_local != null && <> · cota configurada de {fmtBRL(ws.limite_local)}</>}
            {ws.quota_nativa != null && acaoTxt && <> · quota nativa {acaoTxt} de {fmtBRL(ws.quota_nativa)}</>}
          </div>
        </div>
      </div>
      <CkBarChart dias={dias} series={series} />
    </div>
  )
}

export default function PublicGenieCotasView() {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => getPortalEntraToken())
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState('')

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
    queryKey: ['portal-genie-cotas'],
    queryFn: getGenieCotasPublica,
    enabled: !!token,
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
      {query.isLoading && <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--text-muted)' }}>Carregando sua cota...</div>}
      {query.isError && (
        <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--red,#ff4d6a)' }}>
          {(query.error as Error).message}
        </div>
      )}
      {query.data && query.data.workspaces.length === 0 && (
        <div className="card" style={{ margin: '16px 0', padding: 20, color: 'var(--text-muted)' }}>
          Nenhum consumo de Genie encontrado para {query.data.nome} neste mês.
        </div>
      )}
      {query.data?.workspaces.map((ws) => <WorkspaceCard key={ws.workspace_id} ws={ws} />)}
      </div>
    </>
  )
}
