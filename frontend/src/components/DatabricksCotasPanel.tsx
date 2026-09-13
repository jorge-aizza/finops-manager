import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDatabricksCotas, getDatabricksCotaSerie } from '../api/databricksColeta'
import CkBarChart from './CkBarChart'
import type { CkSerie } from './CkBarChart'
import DatabricksCotaDetalheModal from './DatabricksCotaDetalheModal'
import CkCombo from './CkCombo'
import type { DatabricksCotaStatus, DatabricksCotaUsuario, DatabricksCotaWorkspace } from '../types/databricksResumo'

// Semáforo de cotas — porte fiel do cockpit "Gestão de Cotas" (v56).
//
// A diferença que importa: no cockpit o percentual vinha pronto numa planilha,
// descolado das linhas de consumo — auditado e medido, o declarado chegava a 28×
// o que as linhas sustentavam. Aqui o percentual é sempre DERIVADO de
// databricks_consumo no servidor, então não existe caminho onde ele divirja do
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
const pctTxt = (v: number | null) => (v == null ? '—' : fmt(v) + '%')

// Top 10 (o cockpit corta em 25). Dez cabe numa tela sem rolagem e e o
// recorte que responde "quem pesa"; o botao abaixo abre a lista inteira.
const TOP_N = 10

function Cartao({ prefixo, titulo, custo, teto, pct, status, extra, onClick }: {
  prefixo: string; titulo: string; custo: number
  teto: number | null; pct: number | null; status: DatabricksCotaStatus
  extra?: string | null; onClick: () => void
}) {
  const s = STATUS[status]
  // A barra satura em 100% para não transbordar o cartão; o número em cima
  // continua mostrando o valor real (446,7% aparece como barra cheia + "446,7%").
  const largura = Math.min(pct ?? 0, 100)
  return (
    <button
      type="button"
      className={'ck-quota ' + s.cls}
      onClick={onClick}
      aria-label={`Ver detalhes de ${prefixo} ${titulo}`}
    >
      <div className="ck-quota-top">
        <span>{prefixo} · {titulo}</span>
        <b>{pctTxt(pct)}</b>
      </div>
      <div className="ck-quota-meta">
        {usd(custo)} consumidos {teto != null ? `de ${usd(teto)} disponíveis` : '· limite não informado'}
        {extra ? ' · ' + extra : ''}
      </div>
      <div className="ck-traffic">
        <i className="ck-light" />
        <div className="ck-bar"><span style={{ width: largura + '%' }} /></div>
        <strong>{s.rotulo}</strong>
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

// Períodos do cockpit v56 (<select id="period">), na mesma ordem e com os
// mesmos rótulos. "Todos os períodos" é o padrão lá e aqui.
const PERIODOS: [string, string][] = [
  ['', 'Todos os períodos'],
  ['today', 'Hoje'],
  ['month', 'Mês atual'],
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
  ['90', 'Últimos 90 dias'],
  ['year', 'Este ano'],
  ['custom', 'Personalizado'],
]

// Componentes LOCAIS da data, nunca toISOString() — em UTC-3 o ISO devolve o
// dia anterior depois das 21h, que era exatamente o bug de fuso já corrigido
// em outras telas deste app.
const ymd = (d: Date) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

/** Traduz a opção escolhida no select para o intervalo que a API espera. */
function rangeDoPeriodo(p: string, ini: string, fim: string): { data_inicio?: string; data_fim?: string } {
  const hoje = new Date()
  const menos = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d }
  switch (p) {
    case 'today': return { data_inicio: ymd(hoje), data_fim: ymd(hoje) }
    case 'month': return { data_inicio: ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), data_fim: ymd(hoje) }
    case '7':     return { data_inicio: ymd(menos(6)), data_fim: ymd(hoje) }
    case '30':    return { data_inicio: ymd(menos(29)), data_fim: ymd(hoje) }
    case '90':    return { data_inicio: ymd(menos(89)), data_fim: ymd(hoje) }
    case 'year':  return { data_inicio: ymd(new Date(hoje.getFullYear(), 0, 1)), data_fim: ymd(hoje) }
    case 'custom': return {
      ...(ini ? { data_inicio: ini } : {}),
      ...(fim ? { data_fim: fim } : {}),
    }
    default: return {}   // "" = todos os períodos, sem recorte
  }
}

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
              : `Top ${n} ${n === 1 ? substantivo[0] : substantivo[1]} com maior consumo no período`}
            {' · clique num item para ver o detalhe'}
          </div>
        </div>
        <span className="badge">{itens.length}</span>
      </div>
      <div className="ck-semaphores">
        {visiveis.map((x) => <div key={chave(x)}>{render(x)}</div>)}
      </div>
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
  // Cota é apurada por MÊS, então o padrão é o mês corrente — é dele que o
  // alerta por e-mail fala. O seletor existe porque a coleta pode estar
  // atrasada (ou o mês recém-virou), e nesses casos olhar o mês anterior é o
  // que responde "como fechamos?".
  // Padrão do cockpit: "Todos os períodos".
  const [periodo, setPeriodo] = useState('')
  const [pIni, setPIni] = useState('')
  const [pFim, setPFim] = useState('')
  const range = rangeDoPeriodo(periodo, pIni, pFim)
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
    queryKey: ['databricks-cotas', range.data_inicio || '', range.data_fim || ''],
    queryFn: () => getDatabricksCotas(range),
  })

  // Os dois graficos so fazem sentido com UM workspace / UM usuario: somar dias
  // de varios workspaces numa serie so nao diz nada, e a "cota" viraria uma
  // soma sem significado. Mesma regra do cockpit (selected.length !== 1).
  const wsSel = fWs.length === 1 ? fWs[0] : null
  const userSel = fUser.length === 1 ? fUser[0] : null
  const serieQuery = useQuery({
    queryKey: ['databricks-cotas-serie', range.data_inicio || '', range.data_fim || '', wsSel, userSel],
    // Os dois graficos do v56 sao em USD (consumo x cota). Medido: com o
    // recorte de Genie o consumo em dolar e ZERO -- o Genie e free-tier -- e os
    // dois graficos ficam em branco (ws-ml-platform: 88 dias/US$ 21.965 sem o
    // filtro, 10 dias/US$ 0,00 com ele; e o usuario, 0 dias). Por isso a serie
    // vem sem o recorte; o sinal do Genie fica na serie "DBU Free", que e o
    // volume free-tier de verdade. O parametro `genie=1` continua existindo na
    // rota para quando houver Genie pago.
    queryFn: () => getDatabricksCotaSerie(range, wsSel, userSel, false),
    // sempre: sem workspace escolhido o painel mostra a serie agregada
  })

  const d = cotasQuery.data
  const wsOpts = [...new Set((d?.por_workspace || []).map((w) => w.workspace_id))].sort()
  const userOpts = [...new Set((d?.por_usuario || []).map((u) => u.usuario).filter(Boolean))].sort()
  // o mes escolhido entra na lista mesmo sem consumo, senao o <select> ficaria
  // exibindo um mes diferente do que esta sendo consultado
  const temFiltro = fWs.length > 0 || fUser.length > 0 || periodo !== ''

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
    setFUser([u.usuario])
    setDetalhe({ tipo: 'usuario', item: u })
  }

  const seletor = (
    <div className="ck-cotas ck-controls" style={{ margin: '0 20px' }}>
      <CkCombo
        id="dbx-cotas-ws" rotulo="Workspace" placeholder="Todos os workspaces"
        opcoes={wsOpts} valor={fWs} onChange={setFWs}
      />
      <CkCombo
        id="dbx-cotas-user" rotulo="Usuário" placeholder="Todos os usuários"
        opcoes={userOpts} valor={fUser} onChange={setFUser}
      />
      <div className="ck-field">
        <label htmlFor="dbx-cotas-mes">Período</label>
        <select
          id="dbx-cotas-mes" value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
        >
          {PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {periodo === 'custom' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              type="date" aria-label="Data inicial" value={pIni}
              onChange={(e) => setPIni(e.target.value)}
            />
            <input
              type="date" aria-label="Data final" value={pFim}
              onChange={(e) => setPFim(e.target.value)}
            />
          </div>
        )}
      </div>
      <button
        type="button" className="ck-ghost" disabled={!temFiltro}
        style={temFiltro ? undefined : { opacity: .5, cursor: 'default' }}
        onClick={() => { setFWs([]); setFUser([]); setPeriodo(''); setPIni(''); setPFim('') }}
      >Limpar filtros</button>
    </div>
  )

  if (cotasQuery.isLoading) {
    return <>{seletor}<div className="card" style={{ margin: '0 20px', padding: 20, color: 'var(--text-muted)' }}>Carregando cotas...</div></>
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
            Sem consumo em {(PERIODOS.find(([v]) => v === periodo) || ['', ''])[1].toLowerCase()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum registro de consumo nesse recorte. Escolha outro período acima — a coleta pode
            estar atrasada, ou o período escolhido pode ser anterior ao primeiro dado coletado.
          </div>
        </div>
      </>
    )
  }

  // Como no cockpit: maior consumo primeiro. abs() porque um estorno pode
  // deixar o custo negativo, e ele continua sendo um item de peso.
  const porConsumo = <T extends { custo: number }>(a: T, b: T) => Math.abs(b.custo) - Math.abs(a.custo)
  // Workspace e Usuario filtram os DOIS paineis: escolher um workspace tambem
  // restringe a lista de usuarios aos dele, senao os dois lados da tela
  // estariam falando de recortes diferentes.
  const workspaces = d.por_workspace
    .filter((w) => (!fWs.length || fWs.includes(w.workspace_id))
      && (!fUser.length || d.por_usuario.some((u) => u.workspace_id === w.workspace_id && fUser.includes(u.usuario))))
    .sort(porConsumo)
  const usuarios = d.por_usuario
    .filter((u) => (!fWs.length || fWs.includes(u.workspace_id))
      && (!fUser.length || fUser.includes(u.usuario)))
    .sort(porConsumo)

  // KPIs recalculados sobre o que esta filtrado -- mesmas formulas que o
  // servidor usa em `resumo` (ele tambem as deriva destas listas), entao sem
  // filtro os numeros batem exatamente com os dele.
  const comCota = workspaces.filter((w) => w.cota != null)
  const custoTotal = workspaces.reduce((a, w) => a + w.custo, 0)
  const cotaTotal = comCota.reduce((a, w) => a + (w.cota || 0), 0)
  const semCota = workspaces.length - comCota.length
  const acima = usuarios.filter((u) => u.status === 'estourado').length
  const filtrando = fWs.length > 0 || fUser.length > 0
  const rotuloPeriodo = periodo === 'custom'
    ? [pIni, pFim].filter(Boolean).join(' a ') || 'Personalizado'
    : (PERIODOS.find(([v]) => v === periodo) || ['', ''])[1]
  // A cota cadastrada e MENSAL. Quando o recorte cobre mais de um mes o
  // servidor escala o teto por esse numero (senao o acumulado seria medido
  // contra o teto de um mes so) -- a tela precisa dizer isso, ou o numero
  // parece errado pra quem cadastrou a cota.
  const mesesConsid = d.meses_considerados || 1

  // ---- Graficos do cockpit v56, restritos ao Genie ----
  // Sao os dois paineis do v56: "Cota e consumo do Workspace" (usageChart) e
  // "Genie - Cota e uso do usuario" (productChart). Cada um so desenha com UM
  // item selecionado -- somar dias de varios workspaces numa serie so nao diz
  // nada, e a cota viraria uma soma sem significado.
  const dbu = (v: number) => fmt(v) + ' DBU'

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
  const linhasWs = serieQuery.data?.workspace || []
  const diasWs = preencher(linhasWs)
  const mapaWs = new Map(linhasWs.map((x) => [x.dia, x]))
  const custoWsDia = diasWs.map((d) => mapaWs.get(d)?.custo || 0)
  const cotaWsSel = wsSel ? (d.por_workspace.find((w) => w.workspace_id === wsSel)?.cota ?? null) : null
  const picoWs = picoDe(custoWsDia)
  const serieWsChart: CkSerie[] = [
    { label: 'Consumo do Workspace (USD)', cor: 'var(--ck-teal)', fmt: usd, valores: custoWsDia },
    // so desenha o teto quando ele existe: uma barra fixa em zero passaria a
    // falsa impressao de "cota zero" pra quem nao configurou nenhuma
    ...(cotaWsSel != null ? [{
      label: 'Cota do Workspace (USD)', cor: 'var(--ck-lilac-hover)', fmt: usd,
      valores: diasWs.map(() => cotaWsSel),
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

  const linhasUser = serieQuery.data?.usuario || []
  const diasUser = preencher(linhasUser)
  const mapaUser = new Map(linhasUser.map((x) => [x.dia, x]))
  const picoUser = picoDe(diasUser.map((dd) => mapaUser.get(dd)?.dbus_free || 0))
  const serieUserChart: CkSerie[] = [
    // DBU e USD em escalas separadas: na mesma, uma das duas viraria uma linha
    // rente ao chao (o Genie e free-tier, entao o USD dele e zero)
    { label: 'DBU Free', cor: 'var(--ck-lilac-hover)', eixo: 'b', fmt: dbu,
      valores: diasUser.map((dd) => mapaUser.get(dd)?.dbus_free || 0) },
    { label: 'Uso de usuário (USD)', cor: 'var(--ck-teal)', fmt: usd,
      valores: diasUser.map((dd) => mapaUser.get(dd)?.custo || 0) },
    ...(limiteUserSel != null ? [{
      label: 'Cota do Usuário (USD)', cor: 'var(--ck-red)', fmt: usd,
      valores: diasUser.map(() => limiteUserSel),
    }] : []),
  ]

  return (
    <>
      {seletor}
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
            ? `${wsSel} — ${cotaWsSel != null
                ? 'cota configurada de ' + usd(cotaWsSel)
                : 'sem cota de workspace configurada'}, dia a dia`
              + (picoWs >= 0 ? ` · maior dia: ${diaBR(diasWs[picoWs])}` : '')
            : 'Cota e consumo (USD) do workspace selecionado, dia a dia'}
          vazio={wsSel ? null : 'Selecione um workspace no filtro para ver a cota e o consumo dele ao longo do tempo.'}
        >
          <CkBarChart dias={diasWs} series={serieWsChart}
            destaqueIndice={picoWs >= 0 ? picoWs : undefined} />
        </PainelGrafico>

        <PainelGrafico
          titulo="Genie · Cota e uso do usuário"
          nota={userSel != null
            ? `${userSel || '(não identificado)'} — ${limiteUserSel != null
                ? 'cota configurada de ' + usd(limiteUserSel)
                : 'sem cota por usuário configurada'}, dia a dia`
              + (picoUser >= 0 ? ` · maior dia de DBU: ${diaBR(diasUser[picoUser])}` : '')
            : 'Cota, uso (USD) e DBU Free do usuário selecionado, dia a dia'}
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
          render={(w) => (
            <Cartao
              prefixo="Workspace"
              titulo={w.workspace_id}
              custo={w.custo} teto={w.cota} pct={w.pct} status={w.status}
              extra={w.budget_nome}
              onClick={() => selecionarWs(w)}
            />
          )}
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
              custo={u.custo} teto={u.limite} pct={u.pct} status={u.status}
              extra={u.origem_limite === 'individual' ? 'limite individual'
                : u.origem_limite === 'workspace' ? 'teto do workspace' : u.workspace_id}
              onClick={() => selecionarUser(u)}
            />
          )}
        />
        </div>
      </div>

      {detalhe && (
        <DatabricksCotaDetalheModal
          item={detalhe.item}
          tipo={detalhe.tipo}
          voltarPara={detalhe.tipo === 'usuario' ? detalhe.origem?.workspace_id ?? null : null}
          onVoltar={detalhe.tipo === 'usuario' && detalhe.origem
            ? () => setDetalhe({ tipo: 'workspace', item: detalhe.origem! })
            : undefined}
          onClose={() => setDetalhe(null)}
        />
      )}
    </>
  )
}
