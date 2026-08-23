import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CheckboxSearchList from './CheckboxSearchList'

const items = [{ id: 'a', label: 'Item A' }, { id: 'b', label: 'Item B' }]

// Bug real: `.form-group input { width:100% }` (styles.css) cascateia pra
// qualquer <input> dentro de um .form-group ancestral (ex: SPModal.tsx),
// inflando o checkbox pra ocupar o espaço sobrando na linha flex — o
// quadradinho visível "deriva" horizontalmente conforme o texto ao lado
// fica mais curto/mais longo. jsdom não computa layout real (getBoundingClientRect
// sempre retorna 0), então o teste que realmente prova a correção é
// garantir que o <input> sempre declara width:auto explicitamente — sem
// isso a regra externa do .form-group ganha, com ou sem jsdom conseguir
// "ver" o efeito visual aqui.
describe('CheckboxSearchList — checkbox imune a `.form-group input { width:100% }`', () => {
  it('cada checkbox declara width:auto/flexShrink:0 explicitamente', () => {
    render(
      <div className="form-group">
        <CheckboxSearchList items={items} selected={new Set()} onToggle={vi.fn()} onSelectAll={vi.fn()} />
      </div>,
    )
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(2)
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).style.width).toBe('auto')
      expect((cb as HTMLInputElement).style.flexShrink).toBe('0')
    }
  });
});
