import { describe, it, expect } from 'vitest'
import { buildDesperdicioPdfHtml } from './buildDesperdicioPdfHtml'
import type { AzureDesperdicioItem } from '../types/azureInventario'

const item = (over: Partial<AzureDesperdicioItem>): AzureDesperdicioItem => ({
  categoria: 'disco_orfao', subscription_id: 's', resource_id: '/r/1', nome: 'disco-1', resource_group: 'RG-A',
  location: null, sku: 'Premium_LRS', tamanho_gb: 128, criado_em: null, custo_periodo: 10, dias_observados: 30,
  custo_mensal_estimado: 100, marcado_orfao_em: null, dias_orfao: 40, ...over,
})

describe('buildDesperdicioPdfHtml', () => {
  it('inclui o logo FinOps, os filtros e os totais', () => {
    const html = buildDesperdicioPdfHtml([item({}), item({ resource_id: '/r/2', categoria: 'ip_solto', custo_mensal_estimado: 50 })], 'Tipos: Disco')
    expect(html).toContain('/finops-logo.png')
    expect(html).toContain('Tipos: Disco')
    expect(html).toContain('Disco não anexado')
    expect(html).toContain('IP público sem uso')
    expect(html).toMatch(/150,00/)
  })

  it('escapa HTML em nomes de recursos', () => {
    const html = buildDesperdicioPdfHtml([item({ nome: '<script>alert(1)</script>' })], 'x')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
  })

  it('mostra "—" (nunca R$ 0,00) quando não há billing conhecido', () => {
    const html = buildDesperdicioPdfHtml([item({ custo_mensal_estimado: null, dias_orfao: null })], 'x')
    expect(html).toContain('<td class="r">—</td>')
  })
})
