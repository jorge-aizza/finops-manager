import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPortalConfig, identificar } from './api/portal'
import PublicCalculadoraView from './views/PublicCalculadoraView'
import type { PortalIdentSessao } from './types/portal'

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

  useEffect(() => {
    document.title = (cfg?.titulo ? cfg.titulo + ' — ' : '') + 'Portal de Serviço'
  }, [cfg?.titulo])

  return (
    <>
      <header className="portal-header">
        <div className="portal-brand">
          {/* Tema claro (padrao): logo original, inalterado */}
          <img src="/finops-logo.png" alt="FinOps" className="finops-logo topbar-logo-light"
               style={{ height: 30, width: 'auto', display: 'block', flexShrink: 0 }} />
          {/* Tema escuro: mesmo logo novo usado no top-bar e login */}
          <img src="/finops-logo-dark.png" alt="FinOps" className="finops-logo topbar-logo-dark"
               style={{ height: 30, width: 'auto', display: 'none', flexShrink: 0 }} />
          <div>
            <div className="portal-brand-name">{titulo}</div>
            <div className="portal-brand-sub">Calculadora Azure</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {ident && (
            <div className="portal-user-badge" style={{ display: 'flex' }}>
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

      {/* Hero sempre visível, mesmo em erro/carregando — igual ao portal.html
          legado, que nunca escondia essa seção (só injetava #portal-inactive
          abaixo dela). Preservado por fidelidade, não é um bug corrigido aqui. */}
      <section className="portal-hero">
        <h1>{heroTitulo}</h1>
        <p>{heroDesc}</p>
        <div className="portal-hero-chips">
          <span className="portal-chip">🔍 Busca por Subscription</span>
          <span className="portal-chip">⏱ Estimativa por horas</span>
          <span className="portal-chip">📊 Pico de custo do período</span>
          <span className="portal-chip">📄 Relatório exportável</span>
        </div>
      </section>

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

      {podeAbrirCalculadora && cfg && <PublicCalculadoraView cfg={cfg} ident={ident} />}

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
          <MascoteLogo />
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

// Porta verbatim do efeito de tingimento roxo do mascote (portal.html legado)
// — remove o fundo por diferença de cor nos cantos + aplica tint roxo Vivo
// (#9333ea, 65%) sobre o resto. Só decorativo, sem dependência de estado.
function MascoteLogo() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const off = new Image()
    off.onload = () => {
      try {
        const W = off.naturalWidth, H = off.naturalHeight
        const scale = 50 / H
        cvs.width = Math.round(W * scale)
        cvs.height = 50
        const tmp = document.createElement('canvas')
        tmp.width = W; tmp.height = H
        const tc = tmp.getContext('2d')!
        tc.drawImage(off, 0, 0)
        const d = tc.getImageData(0, 0, W, H)
        const px = d.data
        const cs = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [Math.floor(W / 2), 0], [0, Math.floor(H / 2)], [W - 1, Math.floor(H / 2)], [Math.floor(W / 2), H - 1]]
        let bgR = 0, bgG = 0, bgB = 0
        for (const [cx, cy] of cs) { const p4 = (cy * W + cx) * 4; bgR += px[p4]; bgG += px[p4 + 1]; bgB += px[p4 + 2] }
        bgR /= cs.length; bgG /= cs.length; bgB /= cs.length
        const HARD = 90, SOFT = 130
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2]
          const dr = r - bgR, dg = g - bgG, db = b - bgB, dSq = dr * dr + dg * dg + db * db
          if (dSq < HARD * HARD) { px[i + 3] = 0 }
          else if (dSq < SOFT * SOFT) { px[i + 3] = Math.round(255 * (Math.sqrt(dSq) - HARD) / (SOFT - HARD)) }
          else {
            px[i] = Math.round(r * 0.35 + 147 * 0.65)
            px[i + 1] = Math.round(g * 0.35 + 51 * 0.65)
            px[i + 2] = Math.round(b * 0.35 + 234 * 0.65)
          }
        }
        tc.putImageData(d, 0, 0)
        cvs.getContext('2d')!.drawImage(tmp, 0, 0, cvs.width, cvs.height)
        setVisible(true)
      } catch {
        setVisible(true)
      }
    }
    off.onerror = () => { if (cvs) cvs.style.display = 'none' }
    off.src = '/mascote.png?' + Date.now()
  }, [])

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 54" width={90} height={44}
        className="ident-vivo-text" style={{ opacity: visible ? 1 : 0, transition: 'opacity .3s ease' }}>
        <text x={2} y={44} fontFamily="'Arial Black','Arial Bold',Arial" fontWeight={900} fontSize={46} fill="#9333ea" letterSpacing={-1}>vivo</text>
      </svg>
      <canvas ref={canvasRef} height={50} className="ident-vivo-mascote"
        style={{ display: 'block', marginBottom: 2, marginLeft: -6, opacity: visible ? 1 : 0, transition: 'opacity .3s ease', flexShrink: 0 }} />
    </div>
  )
}
