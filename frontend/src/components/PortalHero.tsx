import type { ReactNode } from 'react'

interface PortalHeroProps {
  titulo: string
  descricao: string
  eyebrow?: string
  children?: ReactNode
}

// Hero com raios/brilho roxo — mesmo visual da página inicial "Portal de Serviços"
// (PortalHome.tsx), reaproveitado no topo de cada serviço (Calculadora, Recursos Órfãos) pra
// manter o portal inteiro com um único layout, não um hero por tela.
export default function PortalHero({ titulo, descricao, eyebrow, children }: PortalHeroProps) {
  return (
    <section className="portal-hero portal-hero-home">
      <div className="portal-rays" aria-hidden="true" />
      <div className="portal-glow" aria-hidden="true" />
      <div className="portal-hero-inner">
        {eyebrow && <div className="portal-eyebrow">{eyebrow}</div>}
        <h1>{titulo}</h1>
        <p>{descricao}</p>
        {children}
      </div>
    </section>
  )
}
