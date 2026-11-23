import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDatabricksCotas, getDatabricksCotaSerie, getDatabricksGenieCotasInternas } from '../api/databricksColeta'
import { getGenieQuotaUsuario, listGenieBudgets, listGenieWorkspaces } from '../api/genieBudgets'
import CkBarChart from './CkBarChart'
import type { CkSerie } from './CkBarChart'
import DatabricksCotaDetalheModal from './DatabricksCotaDetalheModal'
import CkCombo from './CkCombo'
import type { DatabricksCotaStatus, DatabricksCotaUsuario, DatabricksCotaWorkspace } from '../types/databricksResumo'

// Semáforo de cotas — porte fiel do cockpit "Gestão de Cotas" (v56).
//
// A diferença que importa: no cockpit o percentual vinha pronto numa planilha,
// custo exibido ao lado.
//
// O visual (cartões, farol com halo, barra quadrada de 7px, paleta própria) vem
// do CSS .ck-* em styles.css.

// O servidor classifica com os thresholds configuráveis do orçamento (75/90 por
// padrão) e tem um estado `estourado` próprio. O cockpit usa 70/90 fixos e não
// distingue estourado de crítico. Mantemos a classificação do servidor — é ela
// que o alerta por e-mail usa — e traduzimos só a APRESENTAÇÃO.
const STATUS: Record<DatabricksCotaStatus, { cls: string; rotulo: string }> = {
  ok:        { cls: 'green',   rotulo: 'Normal' },
  atencao:   { cls: 'yellow',  rotulo: 'Atenção' },
  critico:   { cls: 'red',     rotulo: 'Crítico' },
  estourado: { cls: 'red',     rotulo: 'Crítico' },
  sem_cota:  { cls: 'neutral', rotulo: 'Sem cota' },
}

// Igual ao `format` do cockpit: no máximo 2 casas, sem mínimo — US$ 1.500, e
// não US$ 1.500,00.
const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v)
const usd = (v: number) => 'US$ ' + fmt(v)
const dbu = (v: number) => fmt(v) + ' DBU'
const pctTxt = (v: number | null) => (v == null ? '—' : fmt(v) + '%')
const statusPorPercentual = (pct: number | null): DatabricksCotaStatus => pct == null ? 'sem_cota'
  : pct >= 100 ? 'estourado'
    : pct >= 90 ? 'critico'
      : pct >= 75 ? 'atencao' : 'ok'

// Top 10 (o cockpit corta em 25). Dez cabe numa tela sem rolagem e e o
// recorte que responde "quem pesa"; o botao abaixo abre a lista inteira.
const TOP_N = 10

function Cartao({ prefixo, titulo, custo, dbus, dbusFree, dbusPago, teto, pct, status, extra, statusLabel, disabled, onClick }: {
  prefixo: string; titulo: string; custo: number; dbus: number
  dbusFree: number; dbusPago: number
  teto: number | null; pct: number | null; status: DatabricksCotaStatus
  extra?: string | null; statusLabel?: string; disabled?: boolean; onClick: () => void
}) {
  const s = STATUS[status]
  // A barra satura em 100% para não transbordar o cartão; o número em cima
  // continua mostrando o valor real (446,7% aparece como barra cheia + "446,7%").
  const largura = Math.min(pct ?? 0, 100)
  return (
    <button
      type="button"
      className={'ck-quota ' + s.cls}
      disabled={disabled}
      onClick={onClick}
      aria-label={disabled ? `${prefixo} ${titulo}, sem consumo no período` : `Ver detalhes de ${prefixo} ${titulo}`}
    >
      <div className="ck-quota-top">
        <span>{prefixo} · {titulo}</span>
        <b>{pctTxt(pct)}</b>
      </div>
      <div className="ck-quota-meta">
        {usd(custo)} consumidos · {dbu(dbus)}{teto != null ? ` · de ${usd(teto)} disponíveis` : ' · limite não informado'}
        {extra ? ' · ' + extra : ''}
      </div>
      <div className="ck-quota-meta">Free: {dbu(dbusFree)} · Pago: {dbu(dbusPago)}</div>
      <div className="ck-traffic">
        <i className="ck-light" />
        <div className="ck-bar"><span style={{ width: largura + '%' }} /></div>
        <strong>{statusLabel || s.rotulo}</strong>
      </div>
    </button>
  )
}

function Legenda() {
  // O cockpit escreve "acima de 90% ou bloqueado"; nossos orçamentos alertam e
  // nunca bloqueiam (bloqueio real só existe nas Quotas Genie), então a faixa é
  // rotulada pelo que de fato acontece aqui.
  const itens: [string, string][] = [
    ['até 70%', 'var(--ck-green)'],
    ['71–90%', 'var(--ck-yellow)'],
    ['acima de 90% ou estourado', 'var(--ck-red)'],
  ]
  return (
    <div className="ck-legend">
      {itens.map(([r, c]) => (
        <span key={r}><i style={{ background: c }} />{r}</span>
      ))}
    </div>
  )
}

// Componentes LOCAIS da data, nunca toISOString() — em UTC-3 o ISO devolve o
// dia anterior depois das 21h, que era exatamente o bug de fuso já corrigido
// em outras telas deste app.
const ymd = (d: Date) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// Painel de um lado (Workspace ou Usuário): ordena por maior consumo, corta no
// Top 25 como o cockpit, mas deixa expandir — o cockpit não tem saída quando o
// item que interessa cai fora do corte.
function PainelCotas<T>({ titulo, substantivo, itens, chave, render }: {
  titulo: string
  substantivo: [string, string]           // [singular, plural]
  itens: T[]
  chave: (x: T) => string
  render: (x: T) => React.ReactNode
}) {
  const [tudo, setTudo] = useState(false)
  const visiveis = tudo ? itens : itens.slice(0, TOP_N)
  const n = visiveis.length
  return (
    <div className="card ck-cotas" style={{ padding: 20 }}>
      <div className="ck-panel-head">
        <div>
          <h2>{titulo}</h2>
          <div className="ck-panel-note">
            {tudo
              ? `Todos os ${itens.length} ${substantivo[1]} com consumo no período`
              : `Top ${n} ${n === 1 ? substantivo[0] : substantivo[1]} com maior consumo em DBU`}
            {' · clique num item para ver o detalhe'}
          </div>
        </div>
        <span className="badge">{itens.length}</span>
      </div>
      {itens.length === 0
        ? <div className="ck-chart-empty">Nenhuma quota configurada para os filtros atuais.</div>
        : <div className="ck-semaphores">
            {visiveis.map((x) => <div key={chave(x)}>{render(x)}</div>)}
          </div>}
      {itens.length > TOP_N && (
        <button
          className="btn-ghost"
          style={{ marginTop: 12 }}
          onClick={() => setTudo((v) => !v)}
        >
          {tudo ? `Mostrar só o top ${TOP_N}` : `Ver todos os ${itens.length}`}
        </button>
      )}
      <Legenda />
    </div>
  )
}

// Um painel de grafico com cabecalho + estado vazio, no formato do cockpit
// (.panel > .panel-head + .chart-wrap/.empty).
function PainelGrafico({ titulo, nota, vazio, children }: {
  titulo: string; nota: string; vazio: string | null; children?: React.ReactNode
}) {
  return (
    <div className="card ck-cotas" style={{ padding: 20 }}>
      <div className="ck-panel-head">
        <div>
          <h2>{titulo}</h2>
          <div className="ck-panel-note">{nota}</div>
        </div>
      </div>
      {vazio ? <div className="ck-chart-empty">{vazio}</div> : children}
    </div>
  )
}

export default function DatabricksCotasPanel() {
  // A quota e mensal e reinicia a cada ciclo; esta tela sempre acompanha o mês corrente.
  const hoje = new Date()
  const range = {
    data_inicio: ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    data_fim: ymd(hoje),
  }
  const periodo = 'month'
  // Filtros de EXIBICAO (nao mexem na conta da cota, so em o que aparece).
  // O campo "Produto" do cockpit ficou de fora: esta tela le do banco e o
  // produto nao e uma escolha de quem consulta.
  const [fWs, setFWs] = useState<string[]>([])
  const [fUser, setFUser] = useState<string[]>([])
  // `origem` guarda o workspace de onde o usuario foi aberto, para o caminho
  // de volta -- sem isso o drill-down substitui o modal e nao ha como voltar.
  const [detalhe, setDetalhe] = useState<
    { tipo: 'workspace'; item: DatabricksCotaWorkspace } |
    { tipo: 'usuario'; item: DatabricksCotaUsuario; origem?: DatabricksCotaWorkspace } | null
  >(null)
  const cotasQuery = useQuery({
    queryKey: ['databricks-cotas', range.data_inicio || '', range.data_fim || '', 'genie', 'completo'],
    queryFn: () => getDatabricksCotas(range, true, true),
  })

  // Os dois graficos so fazem sentido com UM workspace / UM usuario: somar dias
  // de varios workspaces numa serie so nao diz nada, e a "cota" viraria uma
  // soma sem significado. Mesma regra do cockpit (selected.length !== 1).
  const wsSel = fWs.length === 1 ? fWs[0] : null
  const userSel = fUser.length === 1 ? fUser[0] : null
  const serieQuery = useQuery({
    queryKey: ['databricks-cotas-serie', range.data_inicio || '', range.data_fim || '', wsSel, userSel, 'genie'],
    // Toda a tela e restrita ao Genie, a pedido -- inclusive os cartoes de
    // cota. Nos dados de hoje o Genie e 100% free-tier (custo US$ 0,00), entao
    // os valores em dolar saem zerados; o sinal que sobra e o DBU. Isso e uma
    // caracteristica do dado atual, nao da tela: a cobranca de Genie existe
    // desde 2026-07-08 e uma coleta real com Genie pago preenche os mesmos
    // graficos sem nenhuma mudanca aqui.
    queryFn: () => getDatabricksCotaSerie(range, wsSel, userSel, true),
    // sempre: sem workspace escolhido o painel mostra a serie agregada
  })

  // Quota Genie NATIVA (Budgets API — pode bloquear o Genie de verdade), distinta do
  // orcamento local acima (so alerta). So busca com usuario selecionado -- sem usuario nao
  // ha "de quem" resolver o principal_id. retry:false: 400 (sem conexao OAuth M2M
  // configurada) e o caso comum, nao uma falha transitoria pra insistir.
  const quotaGenieQuery = useQuery({
    queryKey: ['genie-quota-usuario', userSel, wsSel],
    queryFn: () => getGenieQuotaUsuario(userSel!, wsSel),
    enabled: userSel != null,
    retry: false,
  })
  const genieCotasInternasQuery = useQuery({
    queryKey: ['databricks-genie-cotas-internas', 'month'],
    queryFn: () => getDatabricksGenieCotasInternas('month'),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  })
  const genieBudgetsQuery = useQuery({
    queryKey: ['genie-budgets'],
    queryFn: listGenieBudgets,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const dLocal = cotasQuery.data
  const dadosGenieNativos = genieCotasInternasQuery.data
  const budgetsGenie = genieBudgetsQuery.data?.budgets ?? []
  const workspaceIdsBudgets = [...new Set(budgetsGenie
    .flatMap((budget) => budget.filter?.workspace_id?.values?.map(String) ?? []))]
  const dBase = (() => {
    if (!dLocal || periodo !== 'month' || !dadosGenieNativos
        || (!dadosGenieNativos.workspaces.length && !dadosGenieNativos.usuarios.length)) return dLocal

    const workspaceIdsNativos = new Set(dadosGenieNativos.workspaces.map((item) => item.workspace_id))
    const usuarioIdsNativos = new Set(dadosGenieNativos.usuarios.map((item) => `${item.workspace_id}|${item.usuario.toLowerCase()}`))
    const porWorkspace = [
      ...dadosGenieNativos.workspaces.map((nativo) => {
        const local = dLocal.por_workspace.find((item) => item.workspace_id === nativo.workspace_id)
        const cota = nativo.cota ?? local?.cota ?? null
        const pct = nativo.pct ?? (cota != null && cota > 0 ? nativo.custo / cota * 100 : local?.pct ?? null)
        return {
          ...local,
          workspace_id: nativo.workspace_id,
          custo: nativo.custo,
          dbus: nativo.dbus,
          dbus_free: nativo.dbus_free,
          dbus_pago: nativo.dbus_pago,
          cota,
          pct,
          budget_nome: nativo.budget_nome ?? local?.budget_nome ?? null,
          budget_acao: nativo.budget_acao ?? local?.budget_acao ?? null,
          status: cota != null && cota > 0 ? statusPorPercentual(pct) : nativo.status,
        }
      }),
      ...dLocal.por_workspace.filter((item) => !workspaceIdsNativos.has(item.workspace_id)),
    ]
    const porUsuario = [
      ...dadosGenieNativos.usuarios.map((nativo) => {
        const local = dLocal.por_usuario.find((item) => item.workspace_id === nativo.workspace_id
          && item.usuario.toLowerCase() === nativo.usuario.toLowerCase())
        const limite = nativo.limite ?? local?.limite ?? null
        const pct = nativo.pct ?? (limite != null && limite > 0 ? nativo.custo / limite * 100 : local?.pct ?? null)
        return {
          ...local,
          workspace_id: nativo.workspace_id,
          usuario: nativo.usuario,
          custo: nativo.custo,
          dbus: nativo.dbus,
          dbus_free: nativo.dbus_free,
          dbus_pago: nativo.dbus_pago,
          limite,
          pct,
          origem_limite: nativo.origem_limite ?? local?.origem_limite ?? null,
          budget_nome: nativo.budget_nome ?? local?.budget_nome ?? null,
          budget_acao: nativo.budget_acao ?? local?.budget_acao ?? null,
          status: limite != null && limite > 0 ? statusPorPercentual(pct) : local?.status ?? nativo.status,
        }
      }),
      ...dLocal.por_usuario.filter((item) => !usuarioIdsNativos.has(`${item.workspace_id}|${item.usuario.toLowerCase()}`)),
    ]
    const comCota = porWorkspace.filter((item) => item.cota != null)
    return {
      ...dLocal,
      por_workspace: porWorkspace,
      por_usuario: porUsuario,
      resumo: {
        ...dLocal.resumo,
        custo_total: porWorkspace.reduce((total, item) => total + item.custo, 0),
        cota_total: comCota.reduce((total, item) => total + (item.cota || 0), 0),
        workspaces_sem_cota: porWorkspace.length - comCota.length,
        usuarios_acima_do_limite: porUsuario.filter((item) => item.status === 'estourado').length,
      },
    }
  })()
  const d = dBase ? {
    ...dBase,
    por_workspace: [
      ...dBase.por_workspace,
      ...workspaceIdsBudgets
        .filter((workspaceId) => !dBase.por_workspace.some((workspace) => workspace.workspace_id === workspaceId))
        .map((workspace_id) => ({
          workspace_id, custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0,
          cota: null, pct: null, budget_nome: null, budget_acao: null, status: 'sem_cota' as const,
        })),
    ],
  } : dBase
  const wsOpts = [...new Set((d?.por_workspace || []).map((w) => w.workspace_id))].sort()
  const workspaceNamesQuery = useQuery({
    queryKey: ['genie-workspaces', wsOpts.join(',')],
    queryFn: () => listGenieWorkspaces(wsOpts),
    enabled: wsOpts.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const workspaceNameById = new Map((workspaceNamesQuery.data || []).map((ws) => [ws.workspace_id, ws.nome]))
  const workspaceNome = (id: string) => workspaceNameById.get(id) || 'Nome indisponível'
  const workspaceLabels = Object.fromEntries(wsOpts.map((id) => [id, workspaceNome(id)]))
  const userOpts = [...new Set((d?.por_usuario || [])
    .filter((user) => user.limite != null
      || (fWs.includes(user.workspace_id) && (user.custo !== 0 || user.dbus !== 0)))
    .map((user) => user.usuario)
    .filter((user) => !!user && user !== 'Sem consumo'))].sort()
  const quotaNativaPorWorkspace = new Map<string, {
    limite: number; nome: string; acao: string; filtradaPorTags: boolean
    consumo: number | null; percentual: number | null
  }>()
  for (const budget of budgetsGenie) {
    const alertas = (budget.alert_configurations || [])
      .filter((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED')
    if (!alertas.length) continue
    const limite = Math.max(...alertas.map((alerta) => Number(alerta.quantity_threshold) || 0))
    if (!Number.isFinite(limite)) continue
    const alertaLimite = alertas.find((alerta) => Number(alerta.quantity_threshold) === limite)
    const acao = alertaLimite?.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE')
      ? 'Bloqueia' : 'Alerta'
    const gastoStatus = (budget._spend_status?.alert_spend_statuses || []).find((status) =>
      status.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED' && Number(status.threshold) === limite,
    ) || (budget._spend_status?.alert_spend_statuses || []).find((status) =>
      status.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
    )
    const gastoReportado = gastoStatus?.spend == null ? null : Number(gastoStatus.spend)
    const percentualReportado = gastoStatus?.percent_consumed == null ? null : Number(gastoStatus.percent_consumed)
    const percentual = percentualReportado != null && Number.isFinite(percentualReportado) ? percentualReportado : null
    const consumo = gastoReportado != null && Number.isFinite(gastoReportado)
      ? gastoReportado
      : percentual != null && limite > 0 ? limite * percentual / 100 : null
    const idsExplicitos = budget.filter?.workspace_id?.values?.map(String) ?? []
    const ids = idsExplicitos.length ? idsExplicitos : budget.filter?.tags?.length ? [] : wsOpts
    const filtradaPorTags = !!budget.filter?.tags?.length
    for (const workspace_id of ids) {
      const atual = quotaNativaPorWorkspace.get(workspace_id)
      if (!atual || limite < atual.limite) {
        quotaNativaPorWorkspace.set(workspace_id, {
          limite, nome: budget.display_name, acao, filtradaPorTags, consumo, percentual,
        })
      }
    }
  }
  // o mes escolhido entra na lista mesmo sem consumo, senao o <select> ficaria
  // exibindo um mes diferente do que esta sendo consultado
  const temFiltro = fWs.length > 0 || fUser.length > 0

  // Clicar num cartao SELECIONA aquele item no filtro e abre o detalhe -- as
  // duas coisas, como no cockpit (selectEntityFromCard -> combo.setValue(v, true),
  // e setValue faz replaceValues([v]), ou seja SUBSTITUI a selecao em vez de
  // somar). Isso e o que faz "Cotas Usuario" passar a mostrar os usuarios
  // daquele workspace: sem isso o painel e um ranking GLOBAL e so 2 ou 3 dos 6
  // usuarios de um workspace apareciam nele, divergindo do modal.
  const selecionarWs = (w: DatabricksCotaWorkspace) => {
    setFWs([w.workspace_id])
    setDetalhe({ tipo: 'workspace', item: w })
  }
  const selecionarUser = (u: DatabricksCotaUsuario) => {
    setFWs([u.workspace_id])
    setFUser([u.usuario])
    const origem = d?.por_workspace.find((workspace) => workspace.workspace_id === u.workspace_id)
    setDetalhe({ tipo: 'usuario', item: u, ...(origem ? { origem } : {}) })
  }

  const seletor = (
    <div className="ck-cotas ck-controls" style={{ margin: '0 20px' }}>
      <CkCombo
        id="dbx-cotas-ws" rotulo="Workspace" placeholder="Todos os workspaces"
        opcoes={wsOpts} rotulos={workspaceLabels} valor={fWs} onChange={setFWs}
      />
      <CkCombo
        id="dbx-cotas-user" rotulo="Usuário" placeholder="Todos os usuários"
        opcoes={userOpts} valor={fUser} onChange={setFUser}
      />
      <button
        type="button" className="ck-ghost" disabled={!temFiltro}
        style={temFiltro ? undefined : { opacity: .5, cursor: 'default' }}
        onClick={() => { setFWs([]); setFUser([]) }}
      >Limpar filtros</button>
    </div>
  )

  if (cotasQuery.isLoading) {
    return <>{seletor}<div className="card" style={{ margin: '0 20px', padding: 20, color: 'var(--text-muted)' }}>Carregando cotas...</div></>
  }
  if (cotasQuery.isError) {
    return (
      <>
        {seletor}
        <div role="alert" className="card" style={{ margin: '0 20px', padding: 20, color: 'var(--red,#ff4d6a)' }}>
          <div style={{ marginBottom: 8 }}>Erro ao carregar as cotas Genie: {(cotasQuery.error as Error).message}</div>
          <button type="button" className="btn-ghost" onClick={() => { void cotasQuery.refetch() }}>Tentar novamente</button>
        </div>
      </>
    )
  }
  if (!d || (!d.por_workspace.length && !d.por_usuario.length)) {
    // Acontece de verdade no começo do mês ou com a coleta atrasada: as cotas
    // são mensais, então sem consumo no mês não há o que medir. Dizer isso é
    // melhor do que mostrar uma tela vazia que parece quebrada.
    return (
      <>
        {seletor}
        <div className="card" style={{ margin: '0 20px', padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Sem consumo no mês atual
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum registro de consumo nesse recorte. Escolha outro período acima — a coleta pode
            estar atrasada, ou o período escolhido pode ser anterior ao primeiro dado coletado.
          </div>
        </div>
      </>
    )
  }

  // Genie Free tem custo zero, mas continua consumindo DBUs. O ranking prioriza
  // volume utilizado e usa custo USD como desempate para incluir Genie pago.
  const porConsumo = <T extends { custo: number; dbus: number }>(a: T, b: T) =>
    Math.abs(b.dbus) - Math.abs(a.dbus) || Math.abs(b.custo) - Math.abs(a.custo)
  // Workspace e Usuario filtram os DOIS paineis: escolher um workspace tambem
  // restringe a lista de usuarios aos dele, senao os dois lados da tela
  // estariam falando de recortes diferentes.
  const workspacesNoEscopo = d.por_workspace
    .filter((w) => (!fWs.length || fWs.includes(w.workspace_id))
      && (!fUser.length || d.por_usuario.some((u) => u.workspace_id === w.workspace_id && fUser.includes(u.usuario))))
  const usuariosNoEscopo = d.por_usuario
    .filter((u) => (!fWs.length || fWs.includes(u.workspace_id))
      && (!fUser.length || fUser.includes(u.usuario)))
  const workspaces = workspacesNoEscopo
    .filter((workspace) => workspace.cota != null || quotaNativaPorWorkspace.has(workspace.workspace_id))
    .sort(porConsumo)
  const usuarios = usuariosNoEscopo
    .filter((user) => user.limite != null
      || (fWs.includes(user.workspace_id) && (user.custo !== 0 || user.dbus !== 0)))
    .sort(porConsumo)

  // KPIs recalculados sobre o que esta filtrado -- mesmas formulas que o
  // servidor usa em `resumo` (ele tambem as deriva destas listas), entao sem
  // filtro os numeros batem exatamente com os dele.
  const comCota = workspaces.filter((w) => w.cota != null)
  const custoTotal = workspacesNoEscopo.reduce((a, w) => a + w.custo, 0)
  const cotaTotal = comCota.reduce((a, w) => a + (w.cota || 0), 0)
  const semCota = workspacesNoEscopo.filter((workspace) => workspace.cota == null
    && !quotaNativaPorWorkspace.has(workspace.workspace_id)).length
  const acima = usuariosNoEscopo.filter((u) => u.status === 'estourado').length
  const filtrando = fWs.length > 0 || fUser.length > 0
  const rotuloPeriodo = 'Mês atual'
  // A cota cadastrada e MENSAL. Quando o recorte cobre mais de um mes o
  // servidor escala o teto por esse numero (senao o acumulado seria medido
  // contra o teto de um mes so) -- a tela precisa dizer isso, ou o numero
  // parece errado pra quem cadastrou a cota.
  const mesesConsid = d.meses_considerados || 1
  const workspacesComQuotaNativa = workspaces.filter((workspace) => quotaNativaPorWorkspace.has(workspace.workspace_id)).length

  // ---- Graficos do cockpit v56, restritos ao Genie ----
  // Sao os dois paineis do v56: "Cota e consumo do Workspace" (usageChart) e
  // "Genie - Cota e uso do usuario" (productChart). Cada um so desenha com UM
  // item selecionado -- somar dias de varios workspaces numa serie so nao diz
  // nada, e a cota viraria uma soma sem significado.
  // O servidor so devolve dias COM registro. Os vazios entram como zero para o
  // eixo ser um calendario de verdade e a leitura "quanto por dia" bater.
  const preencher = <T extends { dia: string }>(linhas: T[]) => {
    if (!linhas.length) return [] as string[]
    const lista: string[] = []
    const fim = new Date(linhas[linhas.length - 1].dia + 'T12:00:00')
    for (const d = new Date(linhas[0].dia + 'T12:00:00'); d <= fim; d.setDate(d.getDate() + 1)) {
      lista.push(ymd(d))
    }
    return lista
  }
  const diaBR = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4)
  const picoDe = (v: number[]) => {
    if (!v.length) return -1
    const i2 = v.reduce((m, x, k) => (x > v[m] ? k : m), 0)
    return v[i2] > 0 ? i2 : -1
  }

  // --- 1) Cota e consumo do Workspace ---
  const workspaceSerieNativa = periodo === 'month' && dadosGenieNativos
    ? (wsSel
      ? dadosGenieNativos.workspaces.find((item) => item.workspace_id === wsSel)?.dias ?? []
        : [...dadosGenieNativos.workspaces.reduce((porDia, workspace) => {
        for (const dia of workspace.dias ?? []) {
              const atual = porDia.get(dia.dia) || { dia: dia.dia, custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0 }
              atual.custo += dia.custo
              atual.dbus += dia.dbus
              atual.dbus_free += dia.dbus_free
              atual.dbus_pago += dia.dbus_pago ?? Math.max(0, dia.dbus - dia.dbus_free)
              porDia.set(dia.dia, atual)
            }
            return porDia
          }, new Map<string, { dia: string; custo: number; dbus: number; dbus_free: number; dbus_pago: number }>()).values()]
      )
    : []
  const linhasWs = workspaceSerieNativa.length ? workspaceSerieNativa : serieQuery.data?.workspace || []
  const diasWs = preencher(linhasWs)
  const mapaWs = new Map(linhasWs.map((x) => [x.dia, x]))
  const pagoDoDia = (dia?: { dbus: number; dbus_free: number; dbus_pago?: number }) =>
    dia?.dbus_pago ?? Math.max(0, (dia?.dbus || 0) - (dia?.dbus_free || 0))
  const custoWsDia = diasWs.map((d) => mapaWs.get(d)?.custo || 0)
  const cotaWsSel = wsSel ? (d.por_workspace.find((w) => w.workspace_id === wsSel)?.cota ?? null) : null
  const quotaNativaWsSel = wsSel ? quotaNativaPorWorkspace.get(wsSel) : null
  const picoWs = picoDe(custoWsDia)
  const serieWsChart: CkSerie[] = [
    { label: 'Consumo do Workspace (USD)', cor: 'var(--ck-teal)', fmt: usd, valores: custoWsDia },
    { label: 'DBU Free', cor: 'var(--ck-lilac-hover)', eixo: 'b', fmt: dbu,
      valores: diasWs.map((d) => mapaWs.get(d)?.dbus_free || 0) },
    { label: 'DBU Pago', cor: 'var(--ck-magenta)', eixo: 'b', fmt: dbu,
      valores: diasWs.map((d) => pagoDoDia(mapaWs.get(d))) },
    // so desenha o teto quando ele existe: uma barra fixa em zero passaria a
    // falsa impressao de "cota zero" pra quem nao configurou nenhuma
    ...(cotaWsSel != null && cotaWsSel !== quotaNativaWsSel?.limite ? [{
      label: 'Cota do Workspace (USD)', cor: 'var(--ck-lilac-hover)', fmt: usd,
      valores: diasWs.map(() => cotaWsSel),
    }] : []),
    ...(quotaNativaWsSel ? [{
      label: 'Quota Genie nativa (USD)', cor: 'var(--ck-yellow)', fmt: usd,
      valores: diasWs.map(() => quotaNativaWsSel.limite),
    }] : []),
  ]

  // --- 2) Genie - Cota e uso do usuario ---
  // O MESMO usuario tem uma linha por workspace (nos dados reais, os 6 usuarios
  // aparecem nos 4) e o teto e configurado POR workspace. Procurar so pelo nome
  // pegaria uma linha arbitraria -- podia anunciar "sem cota" tendo cota.
  const linhasUserCota = userSel != null ? d.por_usuario.filter((u) => u.usuario === userSel) : []
  const limiteUserSel = !linhasUserCota.length ? null
    : wsSel
      ? (linhasUserCota.find((u) => u.workspace_id === wsSel)?.limite ?? null)
      : (linhasUserCota.some((u) => u.limite != null)
          ? linhasUserCota.reduce((a, u) => a + (u.limite || 0), 0) : null)

  const usuarioSerieNativa = periodo === 'month' && wsSel && userSel != null
    ? dadosGenieNativos?.usuarios.find((item) => item.workspace_id === wsSel
      && item.usuario.toLowerCase() === userSel.toLowerCase())?.dias ?? []
    : []
  const linhasUser = usuarioSerieNativa.length ? usuarioSerieNativa : serieQuery.data?.usuario || []
  const diasUser = preencher(linhasUser)
  const mapaUser = new Map(linhasUser.map((x) => [x.dia, x]))
  const picoUser = picoDe(diasUser.map((dd) => mapaUser.get(dd)?.dbus_free || 0))
  // Quota Genie NATIVA (Budgets API) resolvida para o usuario selecionado -- so entra
  // quando configurada (limite != null); nunca desenhada em zero, mesmo motivo da cota
  // local logo acima ("uma barra fixa em zero passaria a falsa impressao de cota zero").
  const quotaGenieNativa = quotaGenieQuery.data?.limite ?? null
  const serieUserChart: CkSerie[] = [
    // DBU e USD em escalas separadas: na mesma, uma das duas viraria uma linha
    // rente ao chao (o Genie e free-tier, entao o USD dele e zero)
    { label: 'DBU Free', cor: 'var(--ck-lilac-hover)', eixo: 'b', fmt: dbu,
      valores: diasUser.map((dd) => mapaUser.get(dd)?.dbus_free || 0) },
    { label: 'DBU Pago', cor: 'var(--ck-magenta)', eixo: 'b', fmt: dbu,
      valores: diasUser.map((dd) => pagoDoDia(mapaUser.get(dd))) },
    { label: 'Uso de usuário (USD)', cor: 'var(--ck-teal)', fmt: usd,
      valores: diasUser.map((dd) => mapaUser.get(dd)?.custo || 0) },
    ...(limiteUserSel != null ? [{
      label: 'Cota do Usuário (USD)', cor: 'var(--ck-red)', fmt: usd,
      valores: diasUser.map(() => limiteUserSel),
    }] : []),
    ...(quotaGenieNativa != null ? [{
      label: 'Quota Genie nativa (USD)', cor: 'var(--ck-yellow)', fmt: usd,
      valores: diasUser.map(() => quotaGenieNativa),
    }] : []),
  ]

  const itemDetalhe = (() => {
    if (!detalhe) return null
    const dataNativa = genieCotasInternasQuery.data
    if (detalhe.tipo === 'workspace') {
      const nativo = dataNativa?.workspaces.find((item) => item.workspace_id === detalhe.item.workspace_id)
      const quota = quotaNativaPorWorkspace.get(detalhe.item.workspace_id)
      const custo = nativo?.custo ?? quota?.consumo ?? detalhe.item.custo
      const cota = nativo?.cota ?? quota?.limite ?? detalhe.item.cota
      const pct = nativo?.pct ?? quota?.percentual
        ?? (cota != null && cota > 0 ? custo / cota * 100 : detalhe.item.pct)
      return {
        ...detalhe.item,
        custo,
        dbus: nativo?.dbus ?? detalhe.item.dbus,
        dbus_free: nativo?.dbus_free ?? detalhe.item.dbus_free,
        dbus_pago: nativo?.dbus_pago ?? detalhe.item.dbus_pago,
        cota,
        pct,
        budget_nome: nativo?.budget_nome ?? quota?.nome ?? detalhe.item.budget_nome,
        budget_acao: nativo?.budget_acao ?? quota?.acao ?? detalhe.item.budget_acao,
        status: nativo || quota ? statusPorPercentual(pct) : detalhe.item.status,
      }
    }
    const nativo = dataNativa?.usuarios.find((item) => item.workspace_id === detalhe.item.workspace_id
      && item.usuario.toLowerCase() === detalhe.item.usuario.toLowerCase())
    return nativo ? {
      ...detalhe.item,
      custo: nativo.custo,
      dbus: nativo.dbus,
      dbus_free: nativo.dbus_free,
      dbus_pago: nativo.dbus_pago,
      limite: nativo.limite,
      pct: nativo.pct,
      origem_limite: nativo.origem_limite,
      budget_nome: nativo.budget_nome,
      budget_acao: nativo.budget_acao,
      status: statusPorPercentual(nativo.pct),
    } : detalhe.item
  })()
  const workspaceDetalhe = (() => {
    if (!detalhe || detalhe.tipo !== 'usuario') return null
    const workspace = d?.por_workspace.find((item) => item.workspace_id === detalhe.item.workspace_id)
    if (!workspace) return null
    const nativo = dadosGenieNativos?.workspaces.find((item) => item.workspace_id === workspace.workspace_id)
    const quota = quotaNativaPorWorkspace.get(workspace.workspace_id)
    const custo = nativo?.custo ?? quota?.consumo ?? workspace.custo
    const cota = nativo?.cota ?? quota?.limite ?? workspace.cota
    const pct = nativo?.pct ?? quota?.percentual
      ?? (cota != null && cota > 0 ? custo / cota * 100 : workspace.pct)
    return {
      ...workspace,
      custo,
      dbus: nativo?.dbus ?? workspace.dbus,
      dbus_free: nativo?.dbus_free ?? workspace.dbus_free,
      dbus_pago: nativo?.dbus_pago ?? workspace.dbus_pago,
      cota,
      pct,
      budget_nome: nativo?.budget_nome ?? quota?.nome ?? workspace.budget_nome,
      budget_acao: nativo?.budget_acao ?? quota?.acao ?? workspace.budget_acao,
      status: nativo || quota ? statusPorPercentual(pct) : workspace.status,
    }
  })()

  return (
    <>
      {seletor}
      {genieBudgetsQuery.isPending && (
        <div role="status" style={{ margin: '0 20px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Consultando quotas nativas Genie...
        </div>
      )}
      {genieBudgetsQuery.isError && (
        <div role="alert" style={{ margin: '0 20px 12px', fontSize: 12, color: 'var(--orange,#ff8c42)' }}>
          Quotas nativas indisponíveis: {(genieBudgetsQuery.error as Error).message}. Os valores de consumo continuam disponíveis.
        </div>
      )}
      {periodo === 'month' && genieCotasInternasQuery.isPending && (
        <div role="status" style={{ margin: '0 20px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Carregando consumo Genie e limites por usuário...
        </div>
      )}
      {genieCotasInternasQuery.isError && (
        <div role="alert" style={{ margin: '0 20px 12px', fontSize: 12, color: 'var(--orange,#ff8c42)' }}>
          Consumo Genie oficial indisponível: {(genieCotasInternasQuery.error as Error).message}. Exibindo os dados locais e quotas compartilhadas disponíveis.
        </div>
      )}
      {(genieCotasInternasQuery.data?.avisos || []).map((aviso) => (
        <div key={aviso} role="status" style={{ margin: '0 20px 12px', fontSize: 12, color: 'var(--orange,#ff8c42)' }}>
          Coleta Genie parcial: {aviso}
        </div>
      ))}
      {genieCotasInternasQuery.data?.cache && (
        <div style={{ margin: '0 20px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
          Última coleta oficial: {new Date(genieCotasInternasQuery.data.cache.atualizado_em).toLocaleString('pt-BR')}
          {genieCotasInternasQuery.data.cache.desatualizado
            ? genieCotasInternasQuery.data.cache.atualizando ? ' · Atualizando dados' : ' · Dados desatualizados'
            : ''}
        </div>
      )}
      <div className="stats-grid" style={{ margin: '0 20px 16px' }}>
        <div className="stat-card">
          <div className="stat-label">Consumo no mês</div>
          <div className="stat-value">{usd(custoTotal)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {rotuloPeriodo}{filtrando ? ' · filtrado' : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cota configurada</div>
          <div className="stat-value">{usd(cotaTotal)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {mesesConsid > 1
              ? `soma dos orçamentos × ${mesesConsid} meses do período`
              : 'soma dos orçamentos por workspace'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Workspaces sem cota</div>
          <div className="stat-value" style={{ color: semCota ? 'var(--orange)' : undefined }}>{semCota}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>consomem sem teto definido</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Workspaces com quota Genie nativa</div>
          <div className="stat-value">{workspacesComQuotaNativa}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>inclui workspaces sem consumo no período</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Usuários acima do limite</div>
          <div className="stat-value" style={{ color: acima ? 'var(--red)' : undefined }}>{acima}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>estouraram o teto individual</div>
        </div>
      </div>

      {/* layout do cockpit (.grid): graficos empilhados a esquerda, semaforos
          a direita, alinhados no topo */}
      <div className="ck-analise" style={{ margin: '0 20px 16px' }}>
        <div className="ck-chart-stack">
        <PainelGrafico
          titulo="Cota e consumo do Workspace"
          nota={wsSel
            ? `${workspaceNome(wsSel)} — ${cotaWsSel != null
                ? 'cota configurada de ' + usd(cotaWsSel)
                : 'sem cota de workspace configurada'}, dia a dia`
              + (picoWs >= 0 ? ` · maior dia: ${diaBR(diasWs[picoWs])}` : '')
            : 'Consumo Genie agregado de todos os workspaces, dia a dia'}
          vazio={null}
        >
          <CkBarChart dias={diasWs} series={serieWsChart}
            destaqueIndice={picoWs >= 0 ? picoWs : undefined} />
        </PainelGrafico>

        <PainelGrafico
          titulo="Genie · Cota e uso do usuário"
          nota={(() => {
            if (userSel == null) return 'Cota, uso (USD) e DBU Free do usuário selecionado, dia a dia'
            const partes: string[] = []
            if (limiteUserSel != null) partes.push('cota configurada de ' + usd(limiteUserSel))
            if (quotaGenieNativa != null) {
              const acaoTxt = quotaGenieQuery.data?.acao === 'BLOCK_USAGE' ? 'de bloqueio' : 'de notificação'
              partes.push(`quota nativa ${acaoTxt} de ${usd(quotaGenieNativa)}`)
            }
            if (!partes.length) partes.push('sem cota por usuário configurada')
            return `${userSel || '(não identificado)'} — ${partes.join(' · ')}, dia a dia`
              + (picoUser >= 0 ? ` · maior dia de DBU: ${diaBR(diasUser[picoUser])}` : '')
          })()}
          vazio={userSel != null ? null : 'Selecione um usuário no filtro para ver a cota, o uso e o DBU Free dele ao longo do tempo.'}
        >
          <CkBarChart dias={diasUser} series={serieUserChart}
            destaqueIndice={picoUser >= 0 ? picoUser : undefined} />
        </PainelGrafico>
        </div>

        <div className="ck-chart-stack">
        <PainelCotas
          titulo="Cotas Workspace"
          substantivo={['workspace', 'workspaces']}
          itens={workspaces}
          chave={(w) => w.workspace_id}
          render={(w) => {
            const quotaNativa = quotaNativaPorWorkspace.get(w.workspace_id)
            const usoNativo = dadosGenieNativos?.workspaces.find((item) => item.workspace_id === w.workspace_id)
            const teto = quotaNativa?.limite ?? usoNativo?.cota ?? w.cota
            const custo = quotaNativa?.consumo ?? usoNativo?.custo ?? w.custo
            const pct = quotaNativa?.percentual ?? usoNativo?.pct
              ?? (teto != null && teto > 0 ? custo / teto * 100 : w.pct)
            const status = quotaNativa || usoNativo ? statusPorPercentual(pct) : w.status
            return (
              <Cartao
                prefixo="Workspace"
                titulo={workspaceNome(w.workspace_id)}
                custo={custo} dbus={usoNativo?.dbus ?? w.dbus}
                dbusFree={usoNativo?.dbus_free ?? w.dbus_free}
                dbusPago={usoNativo?.dbus_pago ?? w.dbus_pago}
                teto={teto} pct={pct} status={status}
                extra={[
                  w.budget_nome,
                  quotaNativa ? `Genie nativo · ${quotaNativa.acao}${quotaNativa.filtradaPorTags ? ' · filtrada por tags' : ''}` : null,
                  quotaNativa && quotaNativa.consumo == null && quotaNativa.percentual != null && quotaNativa.limite === 0
                    ? `${fmt(quotaNativa.percentual)}% informado pelo Databricks; gasto não informado` : null,
                ].filter(Boolean).join(' · ') || null}
                statusLabel={quotaNativa && pct == null ? 'Quota sem uso reportado' : undefined}
                onClick={() => selecionarWs(w)}
              />
            )
          }}
        />

        <PainelCotas
          titulo="Cotas Usuário"
          substantivo={['usuário', 'usuários']}
          itens={usuarios}
          chave={(u) => u.workspace_id + '|' + u.usuario}
          render={(u) => (
            <Cartao
              prefixo="Usuário"
              titulo={u.usuario}
              custo={u.custo} dbus={u.dbus} dbusFree={u.dbus_free} dbusPago={u.dbus_pago}
              teto={u.limite} pct={u.pct} status={u.status}
              disabled={u.usuario === 'Sem consumo'}
              extra={u.origem_limite === 'individual' ? 'limite individual'
                : u.origem_limite === 'workspace' ? `teto do workspace · ${workspaceNome(u.workspace_id)}` : workspaceNome(u.workspace_id)}
              onClick={() => { if (u.usuario !== 'Sem consumo') selecionarUser(u) }}
            />
          )}
        />
        </div>
      </div>

      {detalhe && (
        <DatabricksCotaDetalheModal
          item={itemDetalhe || detalhe.item}
          tipo={detalhe.tipo}
          workspaceContext={workspaceDetalhe}
          carregandoQuotaNativa={genieCotasInternasQuery.isLoading}
          erroQuotaNativa={genieCotasInternasQuery.isError ? (genieCotasInternasQuery.error as Error).message : null}
          workspaceName={workspaceNome(detalhe.item.workspace_id)}
          voltarPara={detalhe.tipo === 'usuario' && detalhe.origem ? workspaceNome(detalhe.origem.workspace_id) : null}
          onVoltar={detalhe.tipo === 'usuario' && detalhe.origem
            ? () => setDetalhe({ tipo: 'workspace', item: detalhe.origem! })
            : undefined}
          onClose={() => setDetalhe(null)}
        />
      )}
    </>
  )
}
