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
              ? `Todos os ${itens.length} ${substantivo[1]} com consumo no mês`
              : `Top ${n} ${n === 1 ? substantivo[0] : substantivo[1]} com maior consumo no mês`}
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
  const [detalhe, setDetalhe] = useState<
    { tipo: 'workspace'; item: DatabricksCotaWorkspace } |
    { tipo: 'usuario'; item: DatabricksCotaUsuario } | null
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
    queryFn: () => getDatabricksCotaSerie(range, wsSel, userSel),
    enabled: wsSel != null || userSel != null,
  })

  const d = cotasQuery.data
  const wsOpts = [...new Set((d?.por_workspace || []).map((w) => w.workspace_id))].sort()
  const userOpts = [...new Set((d?.por_usuario || []).map((u) => u.usuario).filter(Boolean))].sort()
  // o mes escolhido entra na lista mesmo sem consumo, senao o <select> ficaria
  // exibindo um mes diferente do que esta sendo consultado
  const temFiltro = fWs.length > 0 || fUser.length > 0 || periodo !== ''

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

  // Series dos graficos. A cota nao varia dia a dia (e um teto configurado),
  // entao vira uma barra de referencia constante -- e so e desenhada quando
  // existe de verdade: uma barra fixa em zero passaria a falsa impressao de
  // "cota zero" pra quem simplesmente nao configurou teto.
  const cotaWsSel = wsSel ? (d.por_workspace.find((w) => w.workspace_id === wsSel)?.cota ?? null) : null
  // O MESMO usuario tem uma linha por workspace (nos dados reais, os 6 usuarios
  // aparecem nos 4 workspaces), e o teto por usuario e configurado POR
  // workspace. Procurar so pelo nome pegava uma linha arbitraria -- podia
  // anunciar "sem cota" tendo cota, ou a cota de outro workspace.
  const linhasUser = userSel != null ? d.por_usuario.filter((u) => u.usuario === userSel) : []
  const limiteUserSel = !linhasUser.length ? null
    : wsSel
      // com um workspace escolhido, o teto e o daquele workspace
      ? (linhasUser.find((u) => u.workspace_id === wsSel)?.limite ?? null)
      // sem workspace escolhido, o consumo mostrado e a soma de todos eles --
      // o teto comparavel e a soma dos tetos que existem; null se nenhum existe
      : (linhasUser.some((u) => u.limite != null)
          ? linhasUser.reduce((a, u) => a + (u.limite || 0), 0) : null)

  // A cota e um teto do PERIODO; o grafico e DIARIO. Desenhar o teto cheio como
  // barra (o que o cockpit faz) deixa o consumo do dia rente ao chao -- medido
  // com dado real: cota de US$ 24.000 contra ~US$ 300/dia, e so a cota aparece.
  // A referencia vira o RITMO diario que a cota permite (teto / dias do
  // recorte), que e a leitura util: consumi acima ou abaixo do ritmo? O rotulo
  // diz exatamente isso, e a nota do painel segue anunciando o teto cheio.
  const porDia = (teto: number | null, dias: number) =>
    teto == null || dias <= 0 ? null : teto / dias

  const diasWs = (serieQuery.data?.workspace || []).map((x) => x.dia)
  const ritmoWs = porDia(cotaWsSel, diasWs.length)
  const serieWs: CkSerie[] = [
    { label: 'Consumo do Workspace (USD)', cor: 'var(--ck-teal)', fmt: usd,
      valores: (serieQuery.data?.workspace || []).map((x) => x.custo) },
    ...(ritmoWs != null ? [{
      label: 'Ritmo da cota (USD/dia)', cor: 'var(--ck-lilac-hover)', fmt: usd,
      valores: diasWs.map(() => ritmoWs),
    }] : []),
  ]

  const diasUser = (serieQuery.data?.usuario || []).map((x) => x.dia)
  const ritmoUser = porDia(limiteUserSel, diasUser.length)
  const serieUser: CkSerie[] = [
    // DBU e USD em escalas separadas: na mesma, uma das duas viraria uma
    // linha rente ao chao (DBU costuma ser ordens de grandeza maior)
    { label: 'DBU Free', cor: 'var(--ck-lilac-hover)', eixo: 'b',
      valores: (serieQuery.data?.usuario || []).map((x) => x.dbus_free) },
    { label: 'Uso do usuário (USD)', cor: 'var(--ck-teal)', fmt: usd,
      valores: (serieQuery.data?.usuario || []).map((x) => x.custo) },
    ...(ritmoUser != null ? [{
      label: 'Ritmo da cota (USD/dia)', cor: 'var(--ck-red)', fmt: usd,
      valores: diasUser.map(() => ritmoUser),
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

      <div style={{ display: 'grid', gap: 16, margin: '0 20px 16px' }}>
        <PainelGrafico
          titulo="Cota e consumo do Workspace"
          nota={wsSel
            ? `${wsSel} — ${cotaWsSel != null
                ? 'cota configurada de ' + usd(cotaWsSel)
                : 'sem cota de workspace configurada'}, dia a dia`
            : 'Cota e consumo (USD) do workspace selecionado, dia a dia'}
          vazio={wsSel ? null : 'Selecione um workspace no filtro para ver a cota e o consumo dele ao longo do tempo.'}
        >
          <CkBarChart dias={diasWs} series={serieWs} />
        </PainelGrafico>

        <PainelGrafico
          titulo="Cota e uso do usuário"
          nota={userSel != null
            ? `${userSel || '(não identificado)'} — ${limiteUserSel != null
                ? 'cota configurada de ' + usd(limiteUserSel)
                : 'sem cota por usuário configurada'}, dia a dia`
            : 'Cota, uso (USD) e DBU Free do usuário selecionado, dia a dia'}
          vazio={userSel != null ? null : 'Selecione um usuário no filtro para ver a cota, o uso e o DBU Free dele ao longo do tempo.'}
        >
          <CkBarChart dias={diasUser} series={serieUser} />
        </PainelGrafico>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '0 20px', alignItems: 'start' }}>
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
              onClick={() => setDetalhe({ tipo: 'workspace', item: w })}
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
              onClick={() => setDetalhe({ tipo: 'usuario', item: u })}
            />
          )}
        />
      </div>

      {detalhe && (
        <DatabricksCotaDetalheModal
          item={detalhe.item}
          tipo={detalhe.tipo}
          usuariosDoWs={detalhe.tipo === 'workspace'
            ? d.por_usuario.filter((x) => x.workspace_id === detalhe.item.workspace_id)
            : []}
          onClose={() => setDetalhe(null)}
        />
      )}
    </>
  )
}
