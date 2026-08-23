import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Porta de _abrirPreviewModal/fecharPreviewModal/voltarParaConfirmacao/
// imprimirEstimativa (calculadora.js) — visualizador do documento gerado por
// buildPdfHtml(). Compartilhado pelos dois call sites que geram PDF: o fluxo
// "Visualizar Estimativa" da Calculadora e o botão "Gerar PDF" de uma
// estimativa já salva (EstimativasView) — nunca duas implementações do
// preview, só do builder de HTML (já unificado em buildPdfHtml.ts).
interface InvoicePreviewModalProps {
  html: string
  title: string
  onClose: () => void
  onVoltar?: () => void
}

export default function InvoicePreviewModal({ html, title, onClose, onVoltar }: InvoicePreviewModalProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function handleFrameLoad() {
    const frame = frameRef.current
    if (!frame) return
    try {
      const h = frame.contentDocument?.documentElement.scrollHeight
      if (h && h > 200) frame.style.minHeight = h + 'px'
    } catch { /* cross-origin ou ainda não carregado — ignora */ }
  }

  function imprimir() {
    frameRef.current?.contentWindow?.print()
  }

  // Portal pro <body> — mesmo fix de ConfigurarEstimativaOverlay.tsx: sem
  // isso, este modal fica recortado pelo overflow:hidden do container raiz
  // de CalculadoraView.tsx.
  return createPortal(
    <div style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, flexDirection: 'column', background: '#f0f2f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', background: 'rgba(255,255,255,.92)', borderBottom: '1px solid #e5e7eb', flexShrink: 0, backdropFilter: 'blur(16px)' }}>
        {onVoltar && (
          <button className="cbtn-sec" style={{ gap: 6, flexShrink: 0 }} onClick={onVoltar}>
            <svg viewBox="0 0 16 16" fill="none" width={13} height={13}><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></svg>
            Editar Dados
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.14em', color: '#6b7280', marginBottom: 1 }}>Prévia da Estimativa</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        </div>
        <button className="cbtn-go" style={{ gap: 6, flexShrink: 0 }} onClick={imprimir}>
          <svg viewBox="0 0 16 16" fill="none" width={13} height={13}><path d="M4 6V2h8v4M4 11H2V6h12v5h-2M4 11v3h8v-3" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" /></svg>
          Imprimir / Salvar PDF
        </button>
        <button title="Fechar" onClick={onClose}
          style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#ef4444', cursor: 'pointer', padding: '5px 9px', fontSize: 15, lineHeight: 1, borderRadius: 7, flexShrink: 0 }}>
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 20px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 900 }}>
          <iframe
            ref={frameRef}
            srcDoc={html}
            onLoad={handleFrameLoad}
            title={title}
            style={{ position: 'relative', width: '100%', minHeight: '80vh', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.10)', background: '#fff', display: 'block' }}
          />
        </div>
        <div style={{ marginTop: 18, fontSize: 11, color: '#6b7280', textAlign: 'center', letterSpacing: '.05em' }}>
          Use <strong style={{ color: '#374151' }}>Imprimir / Salvar PDF</strong> para exportar &nbsp;·&nbsp; Pressione <strong style={{ color: '#374151' }}>Ctrl+P</strong> para imprimir direto
        </div>
      </div>
    </div>,
    document.body,
  )
}
