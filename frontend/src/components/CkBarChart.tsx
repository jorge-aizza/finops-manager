// Barras agrupadas por dia — porte do usageChart/productChart do cockpit v56.
//
// SVG proprio, sem lib de grafico: e a politica ja seguida em todo o resto do
// app (DatabricksDashboardView, RankingCard, MonthlyBarChart) e o cockpit
// desenha barras agrupadas simples, que cabem em SVG sem esforco.
//
// Suporta DUAS escalas verticais independentes ('a' e 'b') porque o grafico de
// usuario mistura USD com DBU — a mesma escala achataria uma das duas.

export interface CkSerie {
  label: string
  cor: string
  valores: number[]
  eixo?: 'a' | 'b'
  fmt?: (v: number) => string
}

interface Props {
  dias: string[]
  series: CkSerie[]
  /** Empilha as series numa barra por dia (grafico "Consumo por produto" do v51). */
  empilhado?: boolean
  /** Indice do dia de pico: pinta a barra em destaque e rotula o valor. */
  destaqueIndice?: number
}

const W = 900
const H = 300
const PAD = { top: 22, right: 12, bottom: 30, left: 52 }

const nice = (max: number) => {
  if (max <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  return Math.ceil(max / exp) * exp
}

const curto = (v: number) =>
  Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'
    : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

export default function CkBarChart({ dias, series, empilhado = false, destaqueIndice }: Props) {
  const largura = W - PAD.left - PAD.right
  const altura = H - PAD.top - PAD.bottom

  // uma escala por eixo usado; sem dado, `nice` devolve 1 e a barra fica rente
  // ao chao em vez de dividir por zero
  const maxPorEixo: Record<string, number> = {}
  if (empilhado) {
    // o topo da barra e a SOMA do dia; usar o maior valor isolado cortaria a pilha
    let maxDia = 0
    for (let i = 0; i < dias.length; i++) {
      maxDia = Math.max(maxDia, series.reduce((a, s) => a + Math.abs(s.valores[i] || 0), 0))
    }
    maxPorEixo.a = nice(maxDia)
  } else {
    for (const s of series) {
      const e = s.eixo || 'a'
      maxPorEixo[e] = Math.max(maxPorEixo[e] || 0, ...s.valores.map((v) => Math.abs(v)), 0)
    }
    for (const e of Object.keys(maxPorEixo)) maxPorEixo[e] = nice(maxPorEixo[e])
  }

  const passo = dias.length ? largura / dias.length : largura
  const vao = Math.min(6, passo * 0.2)
  const larguraBarra = empilhado
    ? Math.max(1, passo - vao)
    : (series.length ? Math.max(1, (passo - vao) / series.length) : passo)

  // no maximo ~12 rotulos no eixo X, senao as datas viram um borrao
  const saltoRotulo = Math.max(1, Math.ceil(dias.length / 12))
  const eixoPrincipal = series.find((s) => (s.eixo || 'a') === 'a') || series[0]

  return (
    <>
      <div className="ck-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`Barras por dia: ${series.map((s) => s.label).join(', ')}`}>
          {/* linhas de grade horizontais, discretas */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = PAD.top + altura * (1 - f)
            return (
              <g key={f}>
                <line className="ck-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                <text className="ck-chart-axis" x={PAD.left - 6} y={y + 3} textAnchor="end">
                  {eixoPrincipal ? curto(maxPorEixo[eixoPrincipal.eixo || 'a'] * f) : ''}
                </text>
              </g>
            )
          })}

          {dias.map((dia, i) => {
            const x0 = PAD.left + i * passo + vao / 2
            let base = 0        // altura ja ocupada na pilha deste dia
            let topo = 0        // altura do ponto mais alto do dia (rotulo do pico)
            return (
              <g key={dia}>
                {series.map((s, j) => {
                  const v = s.valores[i] || 0
                  const max = maxPorEixo[s.eixo || 'a'] || 1
                  const h = Math.max(v > 0 ? 1 : 0, (Math.abs(v) / max) * altura)
                  const x = empilhado ? x0 : x0 + j * larguraBarra
                  const y = PAD.top + altura - h - base
                  if (empilhado) base += h
                  // empilhado: o topo e a soma; agrupado: a maior barra do dia
                  topo = empilhado ? base : Math.max(topo, h)
                  return (
                    <rect
                      key={s.label}
                      x={x} y={y}
                      width={Math.max(1, larguraBarra - 1)} height={h}
                      // o dia de pico sai na cor de destaque, o resto na cor da serie
                      fill={i === destaqueIndice ? 'var(--ck-magenta)' : s.cor} rx={2}
                    >
                      <title>{`${dia} · ${s.label}: ${(s.fmt || curto)(v)}`}</title>
                    </rect>
                  )
                })}
                {i === destaqueIndice && (
                  // valor do pico rotulado: e a pergunta "qual foi o maior dia"
                  <text
                    className="ck-chart-pico"
                    x={x0 + (passo - vao) / 2}
                    y={PAD.top + altura - topo - 6}
                    textAnchor="middle"
                  >
                    {curto(series.reduce((a, s) => a + (s.valores[i] || 0), 0))}
                  </text>
                )}
                {i % saltoRotulo === 0 && (
                  <text className="ck-chart-axis" x={x0 + (passo - vao) / 2} y={H - 10} textAnchor="middle">
                    {dia.slice(8, 10)}/{dia.slice(5, 7)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="ck-chart-legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.cor }} />{s.label}</span>
        ))}
      </div>
    </>
  )
}
