import type { ReactNode } from 'react'

export interface PortalHomeServico {
  id: string
  titulo: string
  descricao: string
  etiqueta?: string
  href: string
  icone: ReactNode
}

interface PortalHomeProps {
  titulo: string
  descricao: string
  /** Nome de quem se identificou; sem ele a saudação não aparece. */
  nome?: string
  servicos: PortalHomeServico[]
}

const PASSOS = [
  { n: 1, titulo: 'Escolha o serviço', texto: 'Selecione acima o que você precisa consultar.' },
  { n: 2, titulo: 'Selecione os recursos', texto: 'Filtre por assinatura, Resource Group ou tipo de recurso.' },
  { n: 3, titulo: 'Veja o resultado', texto: 'Confira os custos e exporte o relatório quando precisar.' },
]

// Página inicial "Portal de Serviços": um card por serviço ativo. Cada card é um link real
// (<a href="#/...">) — funciona por teclado, com clique do meio e com o botão Voltar.
// Sem números nos cards de propósito: contar órfãos exigiria a consulta ao Resource Graph a
// cada visita anônima. Os passos abaixo são texto estático pelo mesmo motivo.
export default function PortalHome({ titulo, descricao, nome, servicos }: PortalHomeProps) {
  const primeiroNome = nome?.trim().split(/\s+/)[0]
  return (
    <>
      <section className="portal-hero portal-hero-home" data-testid="portal-home">
        <div className="portal-rays" aria-hidden="true" />
        <div className="portal-glow" aria-hidden="true" />
        <div className="portal-hero-inner">
          {primeiroNome && <div className="portal-eyebrow">Olá, {primeiroNome}</div>}
          <h1>{titulo}</h1>
          <p>{descricao}</p>
        </div>
      </section>
      <section className="portal-home" aria-label="Serviços disponíveis">
        <div className="portal-home-grid">
          {servicos.map((s, i) => (
            <a key={s.id} className="portal-card" href={s.href} data-testid={'portal-card-' + s.id}
               style={{ animationDelay: `${i * 90}ms` }}>
              <span className="portal-card-top">
                <span className="portal-card-icon">{s.icone}</span>
                {s.etiqueta && <span className="portal-card-tag">{s.etiqueta}</span>}
              </span>
              <span className="portal-card-title">{s.titulo}</span>
              <span className="portal-card-desc">{s.descricao}</span>
              <span className="portal-card-cta">Abrir <span className="portal-card-arrow" aria-hidden="true">→</span></span>
            </a>
          ))}
        </div>
      </section>
      <section className="portal-steps" aria-label="Como funciona">
        <h2>Como funciona</h2>
        <ol className="portal-steps-list">
          {PASSOS.map((p) => (
            <li key={p.n} className="portal-step">
              <span className="portal-step-n" aria-hidden="true">{p.n}</span>
              <span className="portal-step-title">{p.titulo}</span>
              <span className="portal-step-text">{p.texto}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
