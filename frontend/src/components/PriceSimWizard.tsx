import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buscarPrecos, getPriceSimRegioes, getCatalogo, getVmFamilias, getVmSkus, type PriceSimItem } from '../api/priceSimulator'
import { agruparServicos } from '../lib/priceSimServicos'
import { TIPOS_RECURSO, tipoPorId, type RefinoBusca, type Respostas, type TipoRecursoDef, type Valor } from '../lib/priceSimWizardTipos'
import { fmtBRL, projecaoMensal, dimensaoMeter, HORAS_MES } from '../lib/priceSimFormat'
import { TIPOS_VM, ARQUITETURAS, familiaDoProduto, tipoDaFamilia, tipoRecomendado, arquiteturaDaFamilia, rotuloArquitetura, type ArquiteturaCpu } from '../lib/priceSimVmTaxonomia'

type Tela = 'regiao' | 'tipo' | 'pergunta' | 'resultado'

// Aplica o refinamento da busca sobre o que o catálogo devolveu: separa o meter que interessa
// (capacidade de disco, VM de verdade, SO e modelo de compra escolhidos) do resto que casa o
// mesmo texto. Cada regra é uma preferência — se esvaziaria o grupo, é ignorada, porque mostrar
// algo levemente mais amplo é melhor do que um grupo vazio por causa de uma heurística de nome.
function refinarItens(itens: PriceSimItem[], refino?: RefinoBusca): PriceSimItem[] {
  if (!refino) return itens
  const txt = (s: string | null) => (s || '').toLowerCase()
  let atual = itens
  const preferir = (ok: (i: PriceSimItem) => boolean) => {
    const filtrado = atual.filter(ok)
    if (filtrado.length > 0) atual = filtrado
  }
  if (refino.produtoComecaCom) {
    const v = refino.produtoComecaCom.toLowerCase()
    preferir((i) => txt(i.produto).startsWith(v))
  }
  if (refino.produtoContem) {
    const v = refino.produtoContem.toLowerCase()
    preferir((i) => txt(i.produto).includes(v))
  }
  if (refino.produtoNaoContem) {
    const v = refino.produtoNaoContem.toLowerCase()
    preferir((i) => !txt(i.produto).includes(v))
  }
  if (refino.meterTerminaCom) {
    const v = refino.meterTerminaCom.toLowerCase()
    preferir((i) => txt(i.meter).endsWith(v))
  }
  if (refino.meterContem) {
    const v = refino.meterContem.toLowerCase()
    preferir((i) => txt(i.meter).includes(v))
  }
  if (refino.meterNaoContem) {
    const vs = refino.meterNaoContem.map((x) => x.toLowerCase())
    preferir((i) => !vs.some((v) => txt(i.meter).includes(v)))
  }
  return refino.ordenarPorPreco ? [...atual].sort((a, b) => a.preco_brl - b.preco_brl) : atual
}

interface PriceSimWizardProps {
  onAdicionarItem: (item: PriceSimItem, chaveExtra: string) => void
  totalCarrinho: number
  qtdItensCarrinho: number
  // Sem `onClose` o assistente renderiza embutido na página (card), em vez de modal — é o
  // modo usado como ponto de partida do simulador.
  onClose?: () => void
}

// Assistente guiado — monta um cenário recurso por recurso, do jeito que a Azure cobra de
// verdade: você escolhe um TIPO de recurso (VM, Disco, Firewall, IP Público, Load Balancer,
// Backup, Bandwidth, AKS, Storage, SQL), responde uma pergunta por vez sobre ele, vê os preços
// e, ao final, o assistente propõe os recursos que normalmente faltam para aquele cenário
// (grafo `relacionados` em priceSimWizardTipos.ts) — até o cenário ficar completo. A região é
// escolhida uma vez e vale para todas as buscas. Regras determinísticas, não IA.
export default function PriceSimWizard({ onClose, onAdicionarItem, totalCarrinho, qtdItensCarrinho }: PriceSimWizardProps) {
  const [regiao, setRegiao] = useState('')
  const [tipoId, setTipoId] = useState<string | null>(null)
  const [respostas, setRespostas] = useState<Respostas>({})
  const [perguntaIdx, setPerguntaIdx] = useState(0)
  const [cenario, setCenario] = useState<Set<string>>(new Set())
  // Filtro de processador na tela de famílias — é um recorte da lista, não uma resposta do
  // questionário: a arquitetura fica implícita na família que o usuário escolher.
  const [filtroArq, setFiltroArq] = useState<ArquiteturaCpu | 'todas'>('todas')
  const [filtroCat, setFiltroCat] = useState<string>('todas')
  const [buscaServico, setBuscaServico] = useState('')
  const [catalogoAberto, setCatalogoAberto] = useState(false)

  const regioesQuery = useQuery({ queryKey: ['price-sim-regioes'], queryFn: getPriceSimRegioes, staleTime: 30 * 60 * 1000 })

  const tipo = tipoId ? tipoPorId(tipoId) || null : null
  const perguntasVisiveis = tipo ? tipo.perguntas.filter((p) => !p.mostrarSe || p.mostrarSe(respostas)) : []
  const tela: Tela = !regiao ? 'regiao' : !tipo ? 'tipo'
    : perguntaIdx < perguntasVisiveis.length ? 'pergunta' : 'resultado'
  const perguntaAtual = tela === 'pergunta' ? perguntasVisiveis[perguntaIdx] : null
  const fonteAtual = perguntaAtual?.tipo === 'dinamica' ? perguntaAtual.fonte : null
  const buscas = tipo ? tipo.gerarBuscas(respostas) : []
  const sugeridos = tipo
    ? tipo.relacionados.map(tipoPorId).filter((t): t is TipoRecursoDef => !!t && !cenario.has(t.id))
    : []

  const resultadosQuery = useQuery({
    queryKey: ['price-sim-wizard-resultados', regiao, tipoId, JSON.stringify(respostas)],
    queryFn: async () => Promise.all(buscas.map(async (b) => ({
      busca: b,
      resp: b.semPreco
        ? { itens: [], total: 0, page: 1, por_pagina: 0 }
        : b.vmSkus
          ? await getVmSkus({ produto: b.produto || '', regiao: regiao || undefined, so: b.vmSkus.so, modelo: b.vmSkus.modelo })
          : await buscarPrecos({ categoria: b.categoria || undefined, q: b.q || undefined, produto: b.produto, produtos: b.produtos, sku: b.sku, regiao: b.ignorarRegiao ? undefined : (regiao || undefined), comPreco: true, page: 1 }),
    }))),
    enabled: tela === 'resultado' && buscas.length > 0,
  })

  // Famílias de VM da região, carregadas só quando o usuário já respondeu SO e modelo de
  // compra — são eles que definem quais famílias existem (ex.: "Dsv7-series Linux" não tem
  // variante Windows) e o preço de entrada de cada uma.
  const precisaFamilias = fonteAtual === 'vm-tipo' || fonteAtual === 'vm-familia'
  const familiasQuery = useQuery({
    queryKey: ['price-sim-vm-familias', regiao, respostas.so, respostas.modelo],
    queryFn: () => getVmFamilias({ regiao: regiao || undefined, so: String(respostas.so || ''), modelo: String(respostas.modelo || '') }),
    enabled: precisaFamilias && !!regiao,
    staleTime: 30 * 60 * 1000,
  })

  // Catálogo da região, agrupado em serviços — é o que alimenta as caixas de "todos os
  // serviços" na tela de tipos. Os serviços que já têm tipo curado ficam de fora para não
  // duplicar (e para não gerar uma caixa com 270 produtos de VM).
  const catalogoQuery = useQuery({
    queryKey: ['price-sim-catalogo', regiao],
    queryFn: () => getCatalogo(regiao || undefined),
    enabled: tela === 'tipo' && !!regiao,
    staleTime: 30 * 60 * 1000,
  })
  const servicosCurados = ['Virtual Machines', 'Managed Disks', 'Azure Firewall', 'IP Addresses',
    'Load Balancer', 'Backup', 'Bandwidth', 'Azure Kubernetes Service', 'Blob Storage', 'SQL Database']
  const servicos = agruparServicos(catalogoQuery.data?.itens ?? [])
    .filter((s) => !servicosCurados.includes(s.nome))
  const categoriasServicos = [...new Set(servicos.map((s) => s.categoria))].sort()
  const servicosFiltrados = servicos.filter((s) =>
    (filtroCat === 'todas' || s.categoria === filtroCat) &&
    (!buscaServico.trim() || s.nome.toLowerCase().includes(buscaServico.trim().toLowerCase())))

  // Agrupa as famílias do catálogo pelos tipos da taxonomia da Azure, mantendo só os tipos
  // que têm família de fato naquela região.
  const familias = familiasQuery.data ?? []
  const porTipo = TIPOS_VM.map((t) => ({
    tipo: t,
    familias: familias.filter((f) => tipoDaFamilia(familiaDoProduto(f.produto)) === t.id),
  })).filter((g) => g.familias.length > 0)

  function configurarTipo(id: string) {
    setTipoId(id); setRespostas({}); setPerguntaIdx(0)
  }
  // Caixa de um serviço sem tipo curado: cai direto no resultado, porque o tipo "outro" não
  // tem perguntas — as respostas já vêm prontas daqui.
  function selecionarServico(s: { nome: string; produtos: string[] }) {
    setTipoId('outro')
    setRespostas({ servico: s.nome, produtos: s.produtos.join('|') })
    setPerguntaIdx(0)
    setCenario((c) => new Set(c).add('outro'))
  }
  function responder(id: string, valor: Valor) {
    if (!tipo) return
    const novas: Respostas = { ...respostas, [id]: valor }
    const visiveis = tipo.perguntas.filter((p) => !p.mostrarSe || p.mostrarSe(novas))
    setRespostas(novas)
    setPerguntaIdx((i) => i + 1)
    // Última pergunta respondida → o recurso entra no cenário montado.
    if (perguntaIdx + 1 >= visiveis.length) setCenario((c) => new Set(c).add(tipo.id))
  }
  function toggleCheckbox(id: string, atual: boolean) {
    setRespostas((r) => ({ ...r, [id]: !atual }))
  }
  function escolherOutroTipo() {
    // `catalogoAberto` é preservado de propósito: quem veio do catálogo volta pra ele aberto,
    // em vez de ter que reabrir a lista a cada recurso adicionado.
    setTipoId(null); setRespostas({}); setPerguntaIdx(0)
  }
  function voltar() {
    if (tela === 'tipo') { setRegiao(''); return }
    if (tela === 'pergunta') {
      if (perguntaIdx === 0) { setTipoId(null); return }
      setPerguntaIdx((i) => i - 1)
      return
    }
    if (tela === 'resultado') {
      // Um tipo sem perguntas (o do catálogo) não tem passo anterior para voltar: o Voltar
      // precisa sair do resultado, senão vira botão morto.
      if (perguntasVisiveis.length === 0) { setTipoId(null); return }
      setPerguntaIdx(Math.max(0, perguntasVisiveis.length - 1))
    }
  }

  function reiniciar() {
    setRegiao(''); setTipoId(null); setRespostas({}); setPerguntaIdx(0); setCenario(new Set())
    setFiltroArq('todas'); setCatalogoAberto(false); setFiltroCat('todas'); setBuscaServico('')
  }

  const embutido = !onClose

  const conteudo = (
    <>
        <div className={embutido ? 'card-header' : 'modal-header'}>
          <span className={embutido ? 'card-title' : undefined}>🧭 Assistente Guiado — Simulador de Preços</span>
          {onClose && <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>}
        </div>
        <div className={embutido ? undefined : 'modal-body'} style={embutido ? { padding: '0 20px 16px' } : undefined}>
          {cenario.size > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Cenário</span>
              {[...cenario].map((id) => {
                const t = tipoPorId(id)
                return t ? <span key={id} className="badge" style={{ fontSize: 10 }}>{t.icone} {t.titulo}</span> : null
              })}
              {qtdItensCarrinho > 0 && (
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {qtdItensCarrinho} item(ns) · {fmtBRL(totalCarrinho)}/mês
                </span>
              )}
            </div>
          )}

          {tela === 'regiao' && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Vamos montar seu cenário. Primeiro: em qual região Azure você vai provisionar? O preço varia por região.
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="filter-select" aria-label="Região" value={regiao}
                  onChange={(e) => setRegiao(e.target.value)} style={{ minWidth: 220 }}>
                  <option value="">Selecione uma região...</option>
                  {(regioesQuery.data ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="btn-primary" style={{ fontSize: 12 }} disabled={!regiao} onClick={() => setRegiao(regiao)}>
                  Continuar →
                </button>
              </div>
            </>
          )}

          {tela === 'tipo' && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {cenario.size === 0
                  ? `Qual tipo de recurso você quer dimensionar primeiro? (região: ${regiao})`
                  : `O que mais entra no cenário? (região: ${regiao})`}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                {/* 'outro' fica fora da grade: ele não tem perguntas próprias — é preenchido
                    pela caixa de serviço que o usuário escolhe na tela do catálogo. */}
                {TIPOS_RECURSO.filter((t) => t.id !== 'outro').map((t) => (
                  <button key={t.id} type="button" onClick={() => configurarTipo(t.id)}
                    style={{ textAlign: 'left', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 20 }}>{t.icone}</span>
                      <span className="badge" style={{ fontSize: 9.5 }}>{cenario.has(t.id) ? '✓ no cenário' : t.tipoServico}</span>
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.titulo}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.descricao}</span>
                  </button>
                ))}

                {/* Caixa do catálogo — expande a lista logo abaixo, sem trocar de tela e sem
                    esconder as caixas curadas. */}
                <button type="button" onClick={() => setCatalogoAberto((v) => !v)}
                  style={{ textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5,
                    border: `1px ${catalogoAberto ? 'solid' : 'dashed'} var(--accent)`,
                    background: catalogoAberto ? 'var(--bg)' : 'var(--bg-card)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 20 }}>🧩</span>
                    <span className="badge" style={{ fontSize: 9.5 }}>{cenario.has('outro') ? '✓ no cenário' : 'Catálogo'}</span>
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {catalogoAberto ? '▾ Todos os serviços' : '▸ Todos os serviços'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {catalogoAberto ? 'Lista aberta abaixo — clique para fechar.'
                      : servicos.length > 0
                        ? `Abrir os ${servicos.length} outros serviços da região — Databricks, PostgreSQL, Redis, Monitor, OpenAI...`
                        : 'Abrir o catálogo completo da região.'}
                  </span>
                </button>
              </div>

              {/* Catálogo expandido na mesma tela: as caixas curadas continuam visíveis acima. */}
              {catalogoAberto && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {servicosFiltrados.length === servicos.length
                        ? `${servicos.length} serviços em ${regiao}`
                        : `${servicosFiltrados.length} de ${servicos.length} serviços em ${regiao}`}
                    </span>
                    <select className="filter-select" value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}
                      style={{ fontSize: 11, marginLeft: 'auto' }}>
                      <option value="todas">Todas as categorias</option>
                      {categoriasServicos.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input type="text" className="filter-input" placeholder="filtrar por nome..." value={buscaServico}
                      onChange={(e) => setBuscaServico(e.target.value)} style={{ fontSize: 11, minWidth: 170 }} />
                  </div>

                  {catalogoQuery.isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando o catálogo da região...</div>}
                  {catalogoQuery.isError && <div style={{ fontSize: 12, color: 'var(--red,#ff4d6a)' }}>{(catalogoQuery.error as Error).message}</div>}
                  {catalogoQuery.data && servicosFiltrados.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum serviço com esse filtro.</div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                    {servicosFiltrados.map((s) => (
                      <button key={s.categoria + s.nome} type="button" onClick={() => selecionarServico(s)}
                        style={{ textAlign: 'left', padding: '10px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{s.nome}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                          {s.categoria} · {s.meters} meters
                          {s.produtos.length > 1 ? ` · ${s.produtos.length} produtos` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}

          {tela === 'pergunta' && tipo && perguntaAtual && (
            <>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 4 }}>
                {tipo.icone} {tipo.titulo} — pergunta {perguntaIdx + 1} de {perguntasVisiveis.length}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 12 }}>{perguntaAtual.titulo}</div>

              {perguntaAtual.tipo === 'opcoes' && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {perguntaAtual.opcoes.map((o) => (
                    <button key={o.valor} type="button" onClick={() => responder(perguntaAtual.id, o.valor)}
                      style={{ flex: '1 1 200px', textAlign: 'left', padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{o.label}</div>
                      {o.descricao && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{o.descricao}</div>}
                    </button>
                  ))}
                </div>
              )}

              {perguntaAtual.tipo === 'dinamica' && (
                <>
                  {familiasQuery.isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando o catálogo da região...</div>}
                  {familiasQuery.isError && <div style={{ fontSize: 12, color: 'var(--red,#ff4d6a)' }}>{(familiasQuery.error as Error).message}</div>}

                  {perguntaAtual.fonte === 'vm-tipo' && familiasQuery.data && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                      {porTipo.map(({ tipo: t, familias: fs }) => {
                        const recomendado = t.id === tipoRecomendado(String(respostas.finalidade || 'web'))
                        return (
                          <button key={t.id} type="button" onClick={() => responder(perguntaAtual.id, t.id)}
                            style={{ textAlign: 'left', padding: 12, borderRadius: 10, border: `1px solid ${recomendado ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-card)', cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</span>
                              {recomendado && <span className="badge" style={{ fontSize: 9.5 }}>recomendado</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0' }}>{t.descricao}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                              {fs.length} família(s) · {fs.reduce((a, f) => a + f.skus, 0)} tamanhos
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {perguntaAtual.fonte === 'vm-familia' && familiasQuery.data && (() => {
                    const grupo = porTipo.find((g) => g.tipo.id === respostas.tipoVm)
                    const todas = [...(grupo?.familias ?? [])].sort((a, b) => a.preco_min - b.preco_min)
                    if (todas.length === 0) {
                      return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma família desse tipo nessa região com o SO e o modelo de compra escolhidos.</div>
                    }
                    const arqDe = (produto: string) => arquiteturaDaFamilia(familiaDoProduto(produto))
                    const presentes = ARQUITETURAS.filter((a) => todas.some((f) => arqDe(f.produto) === a.id))
                    // Filtro é preferência: se o recorte escolhido não existe neste tipo (ex.:
                    // ficou em ARM e o usuário entrou em HPC, onde não há chip para desfazer),
                    // mostramos tudo em vez de deixar a tela vazia sem saída.
                    const filtrada = filtroArq === 'todas' ? todas : todas.filter((f) => arqDe(f.produto) === filtroArq)
                    const lista = filtrada.length > 0 ? filtrada : todas
                    const filtroIgnorado = filtrada.length === 0 && filtroArq !== 'todas'
                    const chip = (ativo: boolean) => ({
                      fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                      border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`,
                      background: ativo ? 'var(--accent)' : 'var(--bg-card)',
                      color: ativo ? '#fff' : 'var(--text-muted)',
                    })
                    return (
                      <>
                        {presentes.length > 1 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                            <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>Processador:</span>
                            <button type="button" style={chip(filtroArq === 'todas')} onClick={() => setFiltroArq('todas')}>Todos</button>
                            {presentes.map((a) => (
                              <button key={a.id} type="button" style={chip(filtroArq === a.id)} onClick={() => setFiltroArq(a.id)} title={a.descricao}>
                                {a.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {filtroIgnorado && (
                          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 8 }}>
                            Nenhuma família desse tipo usa o processador filtrado — mostrando todas.
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
                          {lista.map((f) => {
                            const arq = arqDe(f.produto)
                            return (
                              <button key={f.produto} type="button" onClick={() => responder(perguntaAtual.id, f.produto)}
                                style={{ textAlign: 'left', padding: 10, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{familiaDoProduto(f.produto)}</span>
                                  {arq !== 'indefinida' && <span className="badge" style={{ fontSize: 9 }}>{rotuloArquitetura(arq)}</span>}
                                </div>
                                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                                  {f.skus} tamanho(s) · a partir de {fmtBRL(f.preco_min * HORAS_MES)}/mês
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )
                  })()}
                </>
              )}

              {perguntaAtual.tipo === 'checkbox' && (() => {
                const atual = (respostas[perguntaAtual.id] as boolean | undefined) ?? perguntaAtual.padrao
                return (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12.5 }}>
                      <input type="checkbox" checked={atual} onChange={() => toggleCheckbox(perguntaAtual.id, atual)} style={{ width: 14, height: 14 }} />
                      {perguntaAtual.label}
                    </label>
                    <div style={{ marginTop: 16 }}>
                      <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => responder(perguntaAtual.id, atual)}>
                        Continuar →
                      </button>
                    </div>
                  </>
                )
              })()}
            </>
          )}

          {tela === 'resultado' && tipo && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {tipo.icone} <strong>{String(respostas.servico || tipo.titulo)}</strong> em <strong>{regiao}</strong> — adicione os meters que fazem
                sentido; são preços de referência da lista pública, não um dimensionamento exato.
              </div>
              {resultadosQuery.isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Buscando preços...</div>}
              {resultadosQuery.isError && <div style={{ fontSize: 12, color: 'var(--red,#ff4d6a)' }}>{(resultadosQuery.error as Error).message}</div>}
              {resultadosQuery.data?.map(({ busca, resp }, grupoIdx) => (
                <div key={grupoIdx} style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8 }}>{busca.justificativa}</div>
                  {busca.semPreco ? null : resp.itens.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Nenhum resultado para &ldquo;{busca.produto || busca.q}&rdquo; — tente a busca manual, ou confirme com o administrador se o Price List foi sincronizado.</div>
                  ) : (
                    refinarItens(resp.itens, busca.refino).slice(0, busca.limite ?? 5).map((it, idx) => {
                      const mensal = projecaoMensal(it.preco_brl, it.unidade)
                      const dim = dimensaoMeter(it.unidade)
                      return (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: idx > 0 ? '1px solid var(--border-light)' : undefined }}>
                          <div style={{ fontSize: 12 }}>
                            {it.produto} — {it.sku}
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{it.meter} ({it.unidade || '—'}, {it.regiao})</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700, fontSize: 12 }}>
                                {fmtBRL(it.preco_brl)}
                                {/* Deixa explícito que o preço é por unidade de consumo, não por
                                    recurso: num meter "1 GB/Month" são R$ X POR GB. */}
                                {dim.volume && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}> / {dim.rotuloQtd}</span>}
                              </div>
                              {mensal && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{mensal}</div>}
                            </div>
                            <button className="btn-ghost" style={{ padding: '3px 10px', fontSize: 11 }}
                              onClick={() => onAdicionarItem(it, `wizard-${tipo.id}-${grupoIdx}-${idx}`)}>
                              + Adicionar
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              ))}

              {sugeridos.length > 0 && (
                <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: '1px dashed var(--border)' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Para um cenário de <strong>{tipo.titulo}</strong> funcionar na prática, normalmente ainda falta:
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sugeridos.map((s) => (
                      <button key={s.id} className="btn-ghost" style={{ fontSize: 11.5, padding: '5px 12px' }}
                        onClick={() => configurarTipo(s.id)}>
                        {s.icone} Configurar {s.titulo}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={escolherOutroTipo}>
                  + Outro tipo de recurso
                </button>
              </div>
            </>
          )}
        </div>
        <div className={embutido ? undefined : 'modal-footer'}
          style={embutido ? { display: 'flex', gap: 8, padding: '12px 20px 4px', borderTop: '1px solid var(--border)' } : undefined}>
          {tela !== 'regiao' && <button className="btn-ghost" onClick={voltar}>← Voltar</button>}
          {onClose
            ? <button className="btn-ghost" onClick={onClose}>{cenario.size > 0 ? 'Concluir' : 'Cancelar'}</button>
            : (regiao || cenario.size > 0) && <button className="btn-ghost" onClick={reiniciar}>Começar de novo</button>}
        </div>
    </>
  )

  if (embutido) return <div className="card" style={{ margin: '16px 0' }}>{conteudo}</div>

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: 680 }}>{conteudo}</div>
    </div>
  )
}
