import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPriceSimCategorias, getPriceSimRegioes, buscarPrecos, getFacetas, type PriceSimItem } from '../api/priceSimulator'
import PortalHero from '../components/PortalHero'
import PriceSimWizard from '../components/PriceSimWizard'
import { fmtBRL, projecaoMensal, dimensaoMeter, custoMensal, HORAS_MES } from '../lib/priceSimFormat'

interface ItemCarrinho {
  chave: string
  item: PriceSimItem
  quantidade: number
  // Horas de uso no mês — só faz diferença em meter horário (uma VM 24/7 usa 730 h; uma de
  // dev/test ligada 8 h por dia útil usa ~176 h, e é aí que mora a economia).
  horasMes: number
}

// Simulador de Preços — nos moldes da calculadora pública da Azure
// (azure.microsoft.com/pricing/calculator): busca sobre o catálogo PÚBLICO de preços já
// sincronizado em azure_price_list (Configurações → Price List, todas as regiões), sem
// depender de nenhum recurso já provisionado — diferente da Calculadora normal, que só
// estima recursos que já existem e já têm billing real.
export default function PublicPriceSimulatorView() {
  const [categoria, setCategoria] = useState('')
  const [regiao, setRegiao] = useState('')
  const [buscaInput, setBuscaInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [produto, setProduto] = useState('')
  const [sku, setSku] = useState('')
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const categoriasQuery = useQuery({ queryKey: ['price-sim-categorias'], queryFn: getPriceSimCategorias, staleTime: 30 * 60 * 1000 })
  const regioesQuery = useQuery({ queryKey: ['price-sim-regioes'], queryFn: getPriceSimRegioes, staleTime: 30 * 60 * 1000 })
  const buscaQuery = useQuery({
    queryKey: ['price-sim-busca', categoria, regiao, produto, sku, q, page],
    queryFn: () => buscarPrecos({ categoria: categoria || undefined, regiao: regiao || undefined, produto: produto || undefined, sku: sku || undefined, q: q || undefined, page }),
    retry: false,
    enabled: buscaAberta,
  })

  // Nível 1 da busca estruturada: produtos da categoria (para Compute, as famílias de VM).
  const produtosQuery = useQuery({
    queryKey: ['price-sim-facetas-produtos', categoria, regiao],
    queryFn: () => getFacetas({ categoria: categoria || undefined, regiao: regiao || undefined }),
    enabled: buscaAberta && !!categoria,
    staleTime: 30 * 60 * 1000,
  })
  // Nível 2: SKUs/tiers do produto escolhido (para VM, os tamanhos; para serviços, os tiers).
  const skusQuery = useQuery({
    queryKey: ['price-sim-facetas-skus', categoria, regiao, produto],
    queryFn: () => getFacetas({ categoria: categoria || undefined, regiao: regiao || undefined, produto }),
    enabled: buscaAberta && !!produto,
    staleTime: 30 * 60 * 1000,
  })

  function trocarCategoria(v: string) {
    setCategoria(v); setProduto(''); setSku(''); setPage(1)
  }
  function trocarProduto(v: string) {
    setProduto(v); setSku(''); setPage(1)
  }

  function aplicarBusca() {
    setQ(buscaInput.trim())
    setPage(1)
  }

  function adicionarAoCarrinho(item: PriceSimItem, chaveSufixo: string | number) {
    const chave = `${item.produto}·${item.sku}·${item.meter}·${item.regiao}·${chaveSufixo}`
    setCarrinho((atual) => atual.some((c) => c.chave === chave) ? atual : [...atual, { chave, item, quantidade: 1, horasMes: HORAS_MES }])
  }

  function atualizarQuantidade(chave: string, quantidade: number) {
    setCarrinho((atual) => atual.map((c) => c.chave === chave ? { ...c, quantidade: Math.max(0, quantidade) } : c))
  }

  function atualizarHoras(chave: string, horasMes: number) {
    setCarrinho((atual) => atual.map((c) => c.chave === chave ? { ...c, horasMes: Math.min(HORAS_MES, Math.max(0, horasMes)) } : c))
  }

  function removerDoCarrinho(chave: string) {
    setCarrinho((atual) => atual.filter((c) => c.chave !== chave))
  }

  const itens = buscaQuery.data?.itens ?? []
  const total = buscaQuery.data?.total ?? 0
  const porPagina = buscaQuery.data?.por_pagina ?? 50
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))
  const totalMensal = carrinho.reduce((a, c) => a + custoMensal(c.item.preco_brl, c.item.unidade, c.quantidade, c.horasMes), 0)

  // Estimativa agrupada por tipo de recurso. A categoria vem do `service_family` do catálogo,
  // não de palpite pelo nome do produto — por isso o item do carrinho carrega esse campo.
  function descricaoQtd(c: ItemCarrinho): string {
    const { base, rotuloQtd } = dimensaoMeter(c.item.unidade)
    return `${c.quantidade} ${rotuloQtd}${base === 'hora' ? ` × ${c.horasMes} h` : ''}`
  }
  const grupos = (() => {
    const mapa = new Map<string, { total: number; linhas: { nome: string; detalhe: string; mensal: number }[] }>()
    for (const c of carrinho) {
      const cat = c.item.categoria || 'Outros'
      if (!mapa.has(cat)) mapa.set(cat, { total: 0, linhas: [] })
      const g = mapa.get(cat)!
      const mensal = custoMensal(c.item.preco_brl, c.item.unidade, c.quantidade, c.horasMes)
      g.total += mensal
      g.linhas.push({ nome: `${c.item.produto} — ${c.item.sku}`, detalhe: descricaoQtd(c), mensal })
    }
    return [...mapa.entries()].sort((a, b) => b[1].total - a[1].total)
  })()
  const regioesNoCarrinho = [...new Set(carrinho.map((c) => c.item.regiao).filter(Boolean))]

  function textoEstimativa(): string {
    const l: string[] = [
      `ESTIMATIVA DE CUSTO AZURE — ${new Date().toLocaleDateString('pt-BR')}`,
      `Região: ${regioesNoCarrinho.join(', ') || '—'}`,
      '',
    ]
    for (const [cat, g] of grupos) {
      l.push(`${cat.toUpperCase()} — ${fmtBRL(g.total)}/mês`)
      for (const i of g.linhas) l.push(`   ${i.nome} (${i.detalhe}) ... ${fmtBRL(i.mensal)}`)
      l.push('')
    }
    l.push(`TOTAL MENSAL: ${fmtBRL(totalMensal)}`)
    l.push(`TOTAL ANUAL (x12): ${fmtBRL(totalMensal * 12)}`)
    l.push('')
    l.push('Preço de lista pública da Azure convertido para BRL. Sem imposto e sem descontos contratuais.')
    return l.join('\n')
  }
  async function copiarEstimativa() {
    try {
      await navigator.clipboard.writeText(textoEstimativa())
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <>
      <PortalHero
        titulo="Simulador de Preços Azure"
        descricao="Simule o custo de um recurso antes de provisioná-lo, usando o catálogo público de preços da Azure — igual à calculadora de preços da Microsoft, só que direto no seu portal."
      >
        <div className="portal-hero-chips">
          <span className="portal-chip">🧭 Assistente guiado</span>
          <span className="portal-chip">🌍 Todas as regiões</span>
          <span className="portal-chip">🛒 Carrinho de simulação</span>
        </div>
      </PortalHero>
      <div className="portal-calc-wrap" data-testid="public-price-simulator">
        {/* O assistente é o ponto de partida: vem aberto na página, sem depender de botão. */}
        <PriceSimWizard onAdicionarItem={adicionarAoCarrinho}
          totalCarrinho={totalMensal} qtdItensCarrinho={carrinho.length} />

        <div className="card" style={{ margin: '16px 0' }}>
          <div className="card-header">
            <span className="card-title">🔍 Busca manual</span>
            <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }}
              onClick={() => setBuscaAberta((v) => !v)}>
              {buscaAberta ? 'Ocultar' : 'Procurar um serviço ou SKU específico'}
            </button>
          </div>
          {buscaAberta && (
          <>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Preços públicos da Azure Retail Prices API, convertidos para BRL. São valores de
            referência (lista pública) — não incluem descontos contratuais nem o imposto
            configurado no restante do portal.
          </div>

          <div style={{ padding: '0 20px 16px' }}>
            {/* Dois níveis: Categoria → Produto → SKU/Tier. Para Compute o nível de produto são
                as famílias de VM e o de SKU são os tamanhos; para um serviço como o Azure
                Firewall o nível de SKU são os tiers. A busca livre continua valendo, sozinha
                ou combinada com os filtros. */}
            <div className="filters-bar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="filter-select" aria-label="Categoria" value={categoria}
                onChange={(e) => trocarCategoria(e.target.value)}>
                <option value="">Todas as categorias</option>
                {(categoriasQuery.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="filter-select" aria-label="Região" value={regiao}
                onChange={(e) => { setRegiao(e.target.value); setPage(1) }}>
                <option value="">Todas as regiões</option>
                {(regioesQuery.data ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select className="filter-select" aria-label="Produto ou família" value={produto}
                disabled={!categoria || produtosQuery.isLoading}
                onChange={(e) => trocarProduto(e.target.value)} style={{ maxWidth: 300 }}>
                <option value="">
                  {!categoria ? 'Escolha a categoria primeiro'
                    : produtosQuery.isLoading ? 'Carregando...'
                    : `Todos os produtos (${produtosQuery.data?.itens.length ?? 0})`}
                </option>
                {(produtosQuery.data?.itens ?? []).map((p) => (
                  <option key={p.nome} value={p.nome}>{p.nome} ({p.meters})</option>
                ))}
              </select>
              <select className="filter-select" aria-label="SKU ou tier" value={sku}
                disabled={!produto || skusQuery.isLoading}
                onChange={(e) => { setSku(e.target.value); setPage(1) }} style={{ maxWidth: 260 }}>
                <option value="">
                  {!produto ? 'SKU / tier' : skusQuery.isLoading ? 'Carregando...' : `Todos os SKUs (${skusQuery.data?.itens.length ?? 0})`}
                </option>
                {(skusQuery.data?.itens ?? []).map((s) => (
                  <option key={s.nome} value={s.nome}>{s.nome}</option>
                ))}
              </select>
              <input type="text" className="filter-input" style={{ minWidth: 200 }}
                placeholder="...ou busque livre por nome/meter" value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()} />
              <button className="btn-primary" style={{ fontSize: 12 }} onClick={aplicarBusca}>Buscar</button>
              {(categoria || regiao || produto || sku || q) && (
                <button className="btn-ghost" style={{ fontSize: 12 }}
                  onClick={() => { setCategoria(''); setRegiao(''); setProduto(''); setSku(''); setBuscaInput(''); setQ(''); setPage(1) }}>
                  Limpar filtros
                </button>
              )}
            </div>

            {buscaQuery.isLoading && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>Buscando preços...</div>
            )}
            {buscaQuery.isError && (
              <div style={{ fontSize: 12, color: 'var(--red,#ff4d6a)', padding: '12px 0' }}>{(buscaQuery.error as Error).message}</div>
            )}
            {buscaQuery.data && total === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>
                Nenhum preço encontrado — ajuste a busca ou os filtros. Se nada aparecer em
                nenhuma busca, confirme com o administrador se o Price List já foi sincronizado.
              </div>
            )}

            {itens.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 6px' }}>
                  {total.toLocaleString('pt-BR')} resultado(s) — página {page} de {totalPaginas}
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Produto</th><th>SKU</th><th>Meter</th><th>Região</th>
                        <th style={{ textAlign: 'right' }}>Unidade</th>
                        <th style={{ textAlign: 'right' }}>Preço</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((it, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: 12 }}>{it.produto || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.sku || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.meter || ''}>{it.meter || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.regiao || '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{it.unidade || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtBRL(it.preco_brl)}
                            {projecaoMensal(it.preco_brl, it.unidade) && (
                              <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>{projecaoMensal(it.preco_brl, it.unidade)}</div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn-ghost" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => adicionarAoCarrinho(it, idx)}>
                              + Adicionar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button className="btn-ghost" style={{ fontSize: 12 }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
                  <button className="btn-ghost" style={{ fontSize: 12 }} disabled={page >= totalPaginas} onClick={() => setPage((p) => p + 1)}>Próxima →</button>
                </div>
              </>
            )}
          </div>
          </>
          )}
        </div>

        <div className="card" style={{ margin: '16px 0' }}>
          <div className="card-header">
            <span className="card-title">🛒 Simulação</span>
            {carrinho.length > 0 && <span className="badge">{carrinho.length}</span>}
          </div>
          <div style={{ padding: '0 20px 16px' }}>
            {carrinho.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                Nenhum item adicionado ainda — clique em &ldquo;+ Adicionar&rdquo; num resultado da busca acima.
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th><th style={{ textAlign: 'right' }}>Preço unitário</th>
                        <th style={{ textAlign: 'right' }}>Qtd.</th>
                        <th style={{ textAlign: 'right' }}>Horas/mês</th>
                        <th style={{ textAlign: 'right' }}>Custo mensal</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {carrinho.map((c) => {
                        const { base, rotuloQtd } = dimensaoMeter(c.item.unidade)
                        return (
                          <tr key={c.chave}>
                            <td style={{ fontSize: 12 }}>
                              {c.item.produto} — {c.item.sku}
                              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{c.item.meter} ({c.item.unidade || '—'}, {c.item.regiao})</div>
                            </td>
                            <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtBRL(c.item.preco_brl)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                                <input type="number" min={0} step={1} value={c.quantidade}
                                  onChange={(e) => atualizarQuantidade(c.chave, parseFloat(e.target.value) || 0)}
                                  style={{ width: 66, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '4px 6px', color: 'var(--text)' }} />
                                <span style={{ fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{rotuloQtd}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {base === 'hora' ? (
                                <input type="number" min={0} max={HORAS_MES} step={1} value={c.horasMes}
                                  onChange={(e) => atualizarHoras(c.chave, parseFloat(e.target.value) || 0)}
                                  style={{ width: 66, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '4px 6px', color: 'var(--text)' }} />
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--text-dim)' }} title={base === 'mes' ? 'Meter já cobrado por mês' : 'Cobrança pontual, não depende de horas'}>—</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtBRL(custoMensal(c.item.preco_brl, c.item.unidade, c.quantidade, c.horasMes))}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn-ghost delete" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => removerDoCarrinho(c.chave)}>✕</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>
                  A quantidade significa coisas diferentes conforme o meter — veja o rótulo ao lado de cada campo:
                  em meter por hora é número de <strong>instâncias</strong>, em meter por GB é o <strong>volume</strong>
                  (armazenado ou de tráfego), em meter por 10K é <strong>bloco de operações</strong>.
                  Os cobrados por hora são multiplicados pelas horas de uso no mês ({HORAS_MES} h = mês cheio, 24/7) e
                  os por dia pelos dias do mês; os já mensais e os por volume entram pelo valor cheio — assim tudo
                  soma na mesma base.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-dim)', maxWidth: 420 }}>
                    Preço de lista pública da Azure (Retail Prices API) convertido para BRL.
                    <strong> Sem imposto</strong> e sem descontos contratuais — portanto não é comparável
                    direto com o valor da Calculadora, que aplica o imposto configurado no portal.
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Total mensal estimado</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{fmtBRL(totalMensal)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {carrinho.length > 0 && (
          <div className="card" style={{ margin: '16px 0' }}>
            <div className="card-header">
              <span className="card-title">📄 Estimativa</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={copiarEstimativa}>
                {copiado ? '✓ Copiado' : 'Copiar como texto'}
              </button>
            </div>
            <div style={{ padding: '0 20px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
                {new Date().toLocaleDateString('pt-BR')} · região: {regioesNoCarrinho.join(', ') || '—'} · {carrinho.length} item(ns)
              </div>

              {grupos.map(([cat, g]) => (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingBottom: 5, borderBottom: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>{cat}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtBRL(g.total)}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/mês</span></span>
                  </div>
                  {g.linhas.map((i, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '5px 0 0' }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{i.nome} <span style={{ color: 'var(--text-muted)' }}>({i.detalhe})</span></span>
                      <span style={{ fontSize: 11.5, flexShrink: 0 }}>{fmtBRL(i.mensal)}</span>
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginTop: 18, paddingTop: 12, borderTop: '2px solid var(--border)' }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', maxWidth: 380 }}>
                  Preço de lista pública da Azure. <strong>Sem imposto</strong> e sem descontos contratuais.
                  O valor anual é a projeção do mensal, sem considerar reserva de 1 ou 3 anos — que costuma reduzir bastante.
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Total mensal</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{fmtBRL(totalMensal)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    anual (×12): <strong>{fmtBRL(totalMensal * 12)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
