import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDatabricksCotas } from '../api/databricksColeta'
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

const TOP_N = 25

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

// "2026-08" -> "ago/2026", mesmo idioma curto ja usado nos eixos do dashboard
function rotuloMes(m: string) {
  const [a, mm] = m.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return (nomes[Number(mm) - 1] || mm) + '/' + a
}

function mesAtual() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
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

export default function DatabricksCotasPanel() {
  // Cota é apurada por MÊS, então o padrão é o mês corrente — é dele que o
  // alerta por e-mail fala. O seletor existe porque a coleta pode estar
  // atrasada (ou o mês recém-virou), e nesses casos olhar o mês anterior é o
  // que responde "como fechamos?".
  const [mes, setMes] = useState(mesAtual())
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
    queryKey: ['databricks-cotas', mes],
    queryFn: () => getDatabricksCotas(mes),
  })

  const d = cotasQuery.data
  const wsOpts = [...new Set((d?.por_workspace || []).map((w) => w.workspace_id))].sort()
  const userOpts = [...new Set((d?.por_usuario || []).map((u) => u.usuario).filter(Boolean))].sort()
  // o mes escolhido entra na lista mesmo sem consumo, senao o <select> ficaria
  // exibindo um mes diferente do que esta sendo consultado
  const mesesOpts = [...new Set([...(d?.meses_disponiveis || []), mes])].sort().reverse()
  const temFiltro = fWs.length > 0 || fUser.length > 0 || mes !== mesAtual()

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
          id="dbx-cotas-mes" value={mes}
          onChange={(e) => e.target.value && setMes(e.target.value)}
        >
          {mesesOpts.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
      </div>
      <button
        type="button" className="ck-ghost" disabled={!temFiltro}
        style={temFiltro ? undefined : { opacity: .5, cursor: 'default' }}
        onClick={() => { setFWs([]); setFUser([]); setMes(mesAtual()) }}
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
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sem consumo no mês {d?.mes || mes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            As cotas são apuradas por mês. Se a coleta estiver atrasada ou o mês tiver virado há pouco,
            escolha outro mês acima.
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

  return (
    <>
      {seletor}
      <div className="stats-grid" style={{ margin: '0 20px 16px' }}>
        <div className="stat-card">
          <div className="stat-label">Consumo no mês</div>
          <div className="stat-value">{usd(custoTotal)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rotuloMes(d.mes)}{filtrando ? ' · filtrado' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cota configurada</div>
          <div className="stat-value">{usd(cotaTotal)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>soma dos orçamentos por workspace</div>
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
