import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FinopsLogo from './FinopsLogo'

describe('FinopsLogo', () => {
  it('renderiza as duas variantes de tema com as classes do Sistema', () => {
    const { container } = render(<FinopsLogo height={26} />)
    const claro = container.querySelector('img.topbar-logo-light') as HTMLImageElement
    const escuro = container.querySelector('img.topbar-logo-dark') as HTMLImageElement
    expect(claro.getAttribute('src')).toBe('/finops-logo.png')
    expect(escuro.getAttribute('src')).toBe('/finops-logo-dark.png')
    expect(claro.className).toContain('finops-logo')
    expect(escuro.className).toContain('finops-logo')
    expect(claro.style.height).toBe('26px')
  })
})
