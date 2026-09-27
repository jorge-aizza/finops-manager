interface FinopsLogoProps {
  height?: number
}

// Logo FinOps no padrão de temas do Sistema (index.html: top-bar): dois PNGs, um por tema.
// styles.css mostra só um por vez — `.topbar-logo-dark` no escuro (padrão do projeto, sem
// data-theme) e `.topbar-logo-light` no claro — e aplica o realce `.finops-logo` por tema.
export default function FinopsLogo({ height = 30 }: FinopsLogoProps) {
  return (
    <>
      <img src="/finops-logo.png" alt="FinOps" className="finops-logo topbar-logo-light"
           style={{ height, width: 'auto', display: 'block', flexShrink: 0 }} />
      <img src="/finops-logo-dark.png" alt="FinOps" className="finops-logo topbar-logo-dark"
           style={{ height, width: 'auto', display: 'none', flexShrink: 0 }} />
    </>
  )
}
