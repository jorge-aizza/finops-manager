import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PortalHome from './PortalHome'

const servicos = [
  { id: 'calculadora', titulo: 'Calculadora de Custos', descricao: 'Estime custos.', etiqueta: 'Estimativa', href: '#/calculadora', icone: <span>c</span> },
  { id: 'orfaos', titulo: 'Recursos Órfãos', descricao: 'Recursos sem uso.', etiqueta: 'Governança', href: '#/orfaos', icone: <span>o</span> },
]

describe('PortalHome', () => {
  it('mostra título, descrição e um card-link por serviço, com etiqueta', () => {
    render(<PortalHome titulo="Portal FinOps" descricao="Escolha um serviço." servicos={servicos} />)
    expect(screen.getByRole('heading', { name: 'Portal FinOps' })).toBeInTheDocument()
    expect(screen.getByText('Escolha um serviço.')).toBeInTheDocument()
    const calc = screen.getByRole('link', { name: /Calculadora de Custos/ })
    expect(calc).toHaveAttribute('href', '#/calculadora')
    expect(screen.getByRole('link', { name: /Recursos Órfãos/ })).toHaveAttribute('href', '#/orfaos')
    expect(screen.getByText('Estimativa')).toBeInTheDocument()
    expect(screen.getByText('Governança')).toBeInTheDocument()
  })

  it('saúda pelo primeiro nome só quando a pessoa se identificou', () => {
    const { rerender } = render(<PortalHome titulo="Portal" descricao="x" servicos={servicos} />)
    expect(screen.queryByText(/^Olá,/)).not.toBeInTheDocument()
    rerender(<PortalHome titulo="Portal" descricao="x" nome="  Ana Souza " servicos={servicos} />)
    expect(screen.getByText('Olá, Ana')).toBeInTheDocument()
  })

  it('mostra a faixa "Como funciona" com os 3 passos', () => {
    render(<PortalHome titulo="Portal" descricao="x" servicos={servicos} />)
    const passos = screen.getByRole('region', { name: 'Como funciona' })
    expect(passos.querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByText('Escolha o serviço')).toBeInTheDocument()
  })

  it('não mostra contadores nos cards (evita consulta ao Azure a cada visita)', () => {
    render(<PortalHome titulo="Portal" descricao="x" servicos={servicos} />)
    expect(screen.queryByText(/\d+ (recursos|órfãos)/i)).not.toBeInTheDocument()
  })
})
