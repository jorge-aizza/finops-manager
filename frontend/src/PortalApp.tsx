import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPortalConfig, identificar } from './api/portal'
import PublicCalculadoraView from './views/PublicCalculadoraView'
import PublicOrfaosView from './views/PublicOrfaosView'
import PublicGenieCotasView from './views/PublicGenieCotasView'
import PublicPriceSimulatorView from './views/PublicPriceSimulatorView'
import PortalHome from './components/PortalHome'
import PortalHero from './components/PortalHero'
import FinopsLogo from './components/FinopsLogo'
import { IconCalculadora, IconInicio, IconOrfaos, IconCotaGenie, IconSimulador } from './components/portalIcons'
import { hrefDe, usePortalRoute, type ServicoId } from './lib/portalRoute'
import { consumePortalEntraHandoff, setPortalEntraToken } from './api/portalEntra'
import type { PortalConfig, PortalIdentSessao } from './types/portal'

// Registro de serviços do portal: cada item vira um card na página inicial e um ícone no
// menu. Um novo serviço entra aqui (e ganha rota em portalRoute.ts).
interface ServicoDef {
  id: ServicoId
  titulo: string
  descricao: string
  subtitulo: string
  etiqueta: string
  ativo: (cfg: PortalConfig) => boolean
  icone: (size: number) => React.ReactNode
}
const SERVICOS: ServicoDef[] = [
  {
    id: 'calculadora', titulo: 'Calculadora de Custos', subtitulo: 'Calculadora Azure', etiqueta: 'Estimativa',
    descricao: 'Estime o custo dos seus recursos Azure por horas de uso, com impostos e relatório exportável.',
    ativo: (cfg) => cfg.calculadora_ativa !== false,
    icone: (size) => <IconCalculadora size={size} />,
  },
  {
    id: 'orfaos', titulo: 'Recursos Órfãos', subtitulo: 'Recursos Órfãos', etiqueta: 'Governança',
    descricao: 'Veja discos, IPs, NICs e outros recursos sem uso que continuam gerando custo.',
    ativo: (cfg) => !!cfg.orfaos_ativo,
    icone: (size) => <IconOrfaos size={size} />,
  },
  {
    id: 'genie-cotas', titulo: 'Minha Cota Genie', subtitulo: 'Minha Cota Genie', etiqueta: 'Pessoal',
    descricao: 'Entre com sua conta Microsoft e veja sua cota e consumo do Genie no Databricks.',
    ativo: (cfg) => !!cfg.genie_cotas_ativo,
    icone: (size) => <IconCotaGenie size={size} />,
  },
  {
    id: 'price-simulator', titulo: 'Simulador de Preços', subtitulo: 'Simulador de Preços', etiqueta: 'Planejamento',
    descricao: 'Simule o custo de um recurso Azure antes de provisioná-lo, usando o catálogo público de preços.',
    ativo: (cfg) => !!cfg.price_simulator_ativo,
    icone: (size) => <IconSimulador size={size} />,
  },
]

const LS_THEME = 'finops-theme'
const SS_IDENT = 'portal_ident'

function getIdentSessao(): PortalIdentSessao | null {
  try {
    const raw = sessionStorage.getItem(SS_IDENT)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function isLightTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light'
}

export default function PortalApp() {
  const configQuery = useQuery({ queryKey: ['portal-config'], queryFn: getPortalConfig, retry: false })

  const [ident, setIdent] = useState<PortalIdentSessao | null>(() => getIdentSessao())
  const [light, setLight] = useState(isLightTheme)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Toast global — InvoiceModal (Fase B) chama window.showToast?.() ao gerar
  // uma estimativa, mesmo padrão do bundle autenticado.
  useEffect(() => {
    window.showToast = (msg, type) => {
      clearTimeout(toastTimer.current)
      setToast({ msg, type: type || 'success' })
      toastTimer.current = setTimeout(() => setToast(null), 3500)
    }
    return () => clearTimeout(toastTimer.current)
  }, [])

  // Handoff do login PARALELO de "Minha Cota Genie" (?portal_handoff=): processado aqui, no
  // nível do App, e não dentro de PublicGenieCotasView — a Microsoft redireciona pra
  // portal.html SEM hash, então a view daquele serviço ainda não estaria montada pra tratar
  // o código. Só esse serviço usa esse mecanismo hoje, então força a rota pra ele ao concluir.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('portal_handoff')
    if (!code) return
    window.history.replaceState(null, '', window.location.pathname)
    consumePortalEntraHandoff(code)
      .then(({ token }) => {
        setPortalEntraToken(token)
        window.location.hash = hrefDe('genie-cotas')
      })
      .catch(() => { /* PublicGenieCotasView mostra a tela de login de novo, sem token salvo */ })
  }, [])

  function toggleTheme() {
    const next = !light
    document.documentElement.setAttribute('data-theme', next ? 'light' : 'dark')
    localStorage.setItem(LS_THEME, next ? 'light' : 'dark')
    setLight(next)
  }

  const cfg = configQuery.data
  const dominios = cfg?.dominios_aceitos || []
  const pedirIdent = !!cfg && (cfg.solicitar_identificacao || dominios.length > 0)
  const podeAbrirCalculadora = !!cfg && (!pedirIdent || !!ident)
  // Início + menu só depois da identificação (quando exigida) e só com mais de um serviço ativo.
  // Com um único serviço ativo o portal abre direto nele (como antes, quando só havia a calculadora).
  const rota = usePortalRoute()
  const ativos = cfg ? SERVICOS.filter((s) => s.ativo(cfg)) : []
  const temMenu = podeAbrirCalculadora && ativos.length > 1
  const viewAtual: ServicoId | 'home' | 'nenhum' | null = !podeAbrirCalculadora ? null
    : ativos.length === 0 ? 'nenhum'
    : ativos.length === 1 ? ativos[0].id
    : ativos.some((s) => s.id === rota) ? (rota as ServicoId) : 'home'

  function handleIdentificado(s: PortalIdentSessao) {
    sessionStorage.setItem(SS_IDENT, JSON.stringify(s))
    setIdent(s)
  }

  function handleTrocarIdentificacao() {
    sessionStorage.removeItem(SS_IDENT)
    setIdent(null)
  }

  const titulo = cfg?.titulo || 'Portal de Serviço'
  const heroTitulo = cfg?.titulo || 'Calculadora de Custos Azure'
  const heroDesc = cfg?.descricao
    || 'Estime o custo dos seus recursos Azure de forma rápida e transparente. Selecione os recursos, defina as horas e visualize o custo estimado com impostos.'

  const servicoAtual = SERVICOS.find((s) => s.id === viewAtual)
  useEffect(() => {
    document.title = (cfg?.titulo ? cfg.titulo + ' — ' : '') + (servicoAtual ? servicoAtual.titulo + ' — ' : '') + 'Portal de Serviço'
  }, [cfg?.titulo, servicoAtual])

  const irParaInicio = () => { window.location.hash = hrefDe('home') }
  const subtitulo = viewAtual === 'home' ? 'Portal de Serviços' : servicoAtual?.subtitulo ?? 'Calculadora Azure'

  return (
    <>
      <header className="portal-header">
        <div className={'portal-brand' + (temMenu ? ' clicavel' : '')} onClick={temMenu ? irParaInicio : undefined}
             title={temMenu ? 'Voltar ao início' : undefined}>
          <FinopsLogo height={30} />
          <div>
            <div className="portal-brand-name">{titulo}</div>
            <div className="portal-brand-sub">{subtitulo}</div>
          </div>
        </div>
        <div className="portal-header-actions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {temMenu && (
            <nav className="portal-nav" aria-label="Menu do portal">
              <a className={'portal-nav-btn' + (viewAtual === 'home' ? ' active' : '')} href={hrefDe('home')}
                title="Início" aria-label="Início" aria-current={viewAtual === 'home' ? 'page' : undefined}>
                <IconInicio size={16} />
              </a>
              {ativos.map((s) => (
                <a key={s.id} className={'portal-nav-btn' + (viewAtual === s.id ? ' active' : '')} href={hrefDe(s.id)}
                  title={s.titulo} aria-label={s.titulo} aria-current={viewAtual === s.id ? 'page' : undefined}>
                  {s.icone(16)}
                </a>
              ))}
            </nav>
          )}
          {ident && (
            <div className="portal-user-badge" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              👤 <span className="pub-nome">{ident.nome}</span>
              <span className="pub-email">{ident.email}</span>
              <button className="pub-sair" title="Trocar identificação" onClick={handleTrocarIdentificacao}>✕</button>
            </div>
          )}
          <button className="portal-theme-btn" onClick={toggleTheme} title={light ? 'Modo escuro' : 'Modo claro'}>
            {light ? (
              <svg viewBox="0 0 20 20" fill="none" width={14} height={14}><path d="M17.5 12.5A7.5 7.5 0 018 3a7.5 7.5 0 100 14 7.5 7.5 0 009.5-4.5z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" width={14} height={14}><circle cx={10} cy={10} r={4} stroke="currentColor" strokeWidth={1.5} /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
            )}
          </button>
          <a id="portal-help-btn" href="/docs-portal-faq.html" target="_blank" rel="noreferrer"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s', height: 32, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
            <svg viewBox="0 0 20 20" fill="none" width={14} height={14}><circle cx={10} cy={10} r={8} stroke="currentColor" strokeWidth={1.5} /><path d="M10 14v-1" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /><path d="M10 11c0-1.5 2.5-2 2.5-3.5a2.5 2.5 0 00-5 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
            Ajuda
          </a>
          <span className="portal-badge">⚡ Público</span>
        </div>
      </header>

      {pedirIdent && !ident && cfg && (
        <IdentModal dominios={dominios} onIdentificado={handleIdentificado} />
      )}

      {/* Trilha estrutural: só nas páginas de serviço e só com mais de um serviço (há para onde voltar). */}
      {temMenu && servicoAtual && (
        <nav className="portal-crumbs" aria-label="Você está em">
          <a href={hrefDe('home')}>← Portal de Serviços</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{servicoAtual.titulo}</span>
        </nav>
      )}

      {/* Hero sempre visível, mesmo em erro/carregando — igual ao portal.html
          legado, que nunca escondia essa seção (só injetava #portal-inactive
          abaixo dela). Preservado por fidelidade, não é um bug corrigido aqui.
          Mesmo hero com raios/brilho da página inicial (PortalHero) — layout único em
          todo o portal, não um visual por tela. */}
      {(viewAtual === null || viewAtual === 'calculadora') && (
        <PortalHero titulo={heroTitulo} descricao={heroDesc}>
          <div className="portal-hero-chips">
            <span className="portal-chip">🔍 Busca por Subscription</span>
            <span className="portal-chip">⏱ Estimativa por horas</span>
            <span className="portal-chip">📊 Pico de custo do período</span>
            <span className="portal-chip">📄 Relatório exportável</span>
          </div>
        </PortalHero>
      )}

      {configQuery.isLoading && (
        <div id="portal-loading">
          <div className="portal-spinner" />
          <span>Carregando portal...</span>
        </div>
      )}

      {configQuery.isError && (
        <div id="portal-inactive" style={{ display: 'block' }}>
          <div className="pi-icon">🔒</div>
          <h2>Portal temporariamente indisponível</h2>
          <p>Este portal de serviço está desativado. Entre em contato com o administrador.</p>
        </div>
      )}

      {cfg && viewAtual === 'home' && (
        <PortalHome
          titulo={cfg.titulo || 'Portal de Serviços'}
          descricao={cfg.descricao || 'Escolha um serviço para começar.'}
          nome={ident?.nome}
          servicos={ativos.map((s) => ({ id: s.id, titulo: s.titulo, descricao: s.descricao, etiqueta: s.etiqueta, href: hrefDe(s.id), icone: s.icone(32) }))}
        />
      )}
      {cfg && viewAtual === 'calculadora' && <PublicCalculadoraView cfg={cfg} ident={ident} />}
      {viewAtual === 'orfaos' && <PublicOrfaosView />}
      {viewAtual === 'genie-cotas' && <PublicGenieCotasView />}
      {viewAtual === 'price-simulator' && <PublicPriceSimulatorView />}
      {viewAtual === 'nenhum' && (
        <div id="portal-inactive" style={{ display: 'block' }}>
          <div className="pi-icon">🔒</div>
          <h2>Nenhum serviço disponível</h2>
          <p>Este portal não tem serviços ativos no momento. Entre em contato com o administrador.</p>
        </div>
      )}

      <footer className="portal-footer">
        <span>FinOps Manager · {new Date().getFullYear()}</span>
        <a href="/docs-portal-faq.html" target="_blank" rel="noreferrer">Dúvidas frequentes</a>
      </footer>

      {toast && <div id="toast" className={'toast show ' + toast.type}>{toast.msg}</div>}
    </>
  )
}

function IdentModal({ dominios, onIdentificado }: { dominios: string[]; onIdentificado: (s: PortalIdentSessao) => void }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  async function submit() {
    setErro('')
    if (!nome.trim()) { setErro('Informe seu nome.'); return }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErro('Informe um e-mail válido.'); return }
    setEnviando(true)
    try {
      const data = await identificar(nome.trim(), email.trim())
      onIdentificado({ nome: data.nome, email: data.email })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao identificar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div id="modal-ident" style={{ display: 'flex' }}>
      <div className="ident-rays" />
      <div className="ident-glow" />
      <div className="ident-card">
        <div className="ident-logo">
          <FinopsLogo height={44} />
        </div>
        <h2>Identificação</h2>
        <p>
          {dominios.length
            ? `Informe seu nome e e-mail corporativo (${dominios.map((d) => '@' + d).join(', ')}).`
            : 'Informe seu nome e e-mail corporativo para acessar o portal.'}
        </p>
        <div className="ident-field">
          <label htmlFor="ident-nome">Nome completo</label>
          <input id="ident-nome" type="text" placeholder="Ex: João Silva" autoComplete="name" value={nome}
            onChange={(e) => setNome(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && emailRef.current?.focus()} />
        </div>
        <div className="ident-field">
          <label htmlFor="ident-email">E-mail corporativo</label>
          <input id="ident-email" ref={emailRef} type="email" placeholder="joao.silva@empresa.com.br" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div id="ident-erro">{erro}</div>
        <button className="ident-btn" disabled={enviando} onClick={submit}>
          {enviando ? 'Aguarde...' : 'Confirmar e acessar'}
        </button>
      </div>
    </div>
  )
}
