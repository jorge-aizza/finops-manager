import { describe, expect, it } from 'vitest'
import { tipoRecurso } from './tipoRecurso'
import type { RecursoBilling } from '../types/calculadora'

function makeRecurso(overrides: Partial<RecursoBilling>): RecursoBilling {
  return {
    resource_id: 'r1', resource_group_name: 'RG-PROD', nome_recurso: 'vm1',
    categoria: null, meter_categories: null, subcategoria: null, produto: null,
    consumed_service: null, charge_type: 'Usage', pricing_model: 'OnDemand',
    publisher_type: null, publisher_name: null, regiao: null, location: null,
    moeda: 'BRL', unidade: '1 Hour', tipo_custo: 'hora', taxa_cambio: 0,
    custo_hora_billing: 0, usa_amortizado: false, taxa_hora_rate: 0, custo_uom_billing: 0,
    custo_uom_usd: 0, dias_ativos: 1, total_billing: 0, total_usd: 0, total_qty: 0,
    custo_mes_billing: 0, custo_dia_billing: 0, custo_dia_usd: 0, custo_hora_usd: 0,
    total_upq_brl: 0, total_upq_usd: 0, horas_reais: 0, soma_h_driver: 0, usa_30d: false,
    ...overrides,
  }
}

describe('tipoRecurso — cascata de classificação', () => {
  it('classifica Databricks por consumed_service', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Databricks' }))).toBe('Databricks')
  })

  it('classifica Databricks por resource_group_name (VMs de infra)', () => {
    expect(tipoRecurso(makeRecurso({ resource_group_name: 'databricks-rg-ws1-abc', consumed_service: 'Microsoft.Compute' }))).toBe('Databricks')
  })

  it('Databricks tem prioridade sobre AKS/Compute mesmo se o RG parecer um cluster', () => {
    expect(tipoRecurso(makeRecurso({ resource_group_name: 'databricks-rg-ws1', consumed_service: 'Microsoft.ContainerService' }))).toBe('Databricks')
  })

  it('classifica AKS por nome de nó (aks-*)', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Compute', nome_recurso: 'aks-nodepool1-vm' }))).toBe('AKS')
  })

  it('classifica AKS por resource_group MC_*', () => {
    expect(tipoRecurso(makeRecurso({ resource_group_name: 'MC_rg_cluster1_eastus', consumed_service: 'Microsoft.Compute' }))).toBe('AKS')
  })

  it('classifica Backup por prefixo azurebackup_', () => {
    expect(tipoRecurso(makeRecurso({ nome_recurso: 'azurebackup_vm1_snapshot' }))).toBe('Backup')
  })

  it('classifica VMs genéricas via consumed_service Microsoft.Compute', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Compute' }))).toBe('VMs')
  })

  it('classifica Discos via disk no nome ou pvc-', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Compute', nome_recurso: 'osdisk-vm1' }))).toBe('Discos')
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Compute', nome_recurso: 'pvc-abc123' }))).toBe('Discos')
  })

  it('classifica Storage via consumed_service', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Storage' }))).toBe('Storage')
  })

  it('classifica SQL via consumed_service', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: 'Microsoft.Sql' }))).toBe('SQL')
  })

  it('classifica Reservas quando charge_type é Purchase ou pricing_model é Reservation (fallback final)', () => {
    expect(tipoRecurso(makeRecurso({ charge_type: 'Purchase', consumed_service: null }))).toBe('Reservas')
    expect(tipoRecurso(makeRecurso({ pricing_model: 'Reservation', consumed_service: null }))).toBe('Reservas')
  })

  it('cai em Outros quando nada bate', () => {
    expect(tipoRecurso(makeRecurso({ consumed_service: null, charge_type: 'Usage', pricing_model: 'OnDemand' }))).toBe('Outros')
  })

  it('bug latente preservado: meter_category nunca é lido (campo não existe na API) — classificação depende só de svc/rg/nome', () => {
    // Mesmo com "categoria" (campo real da API) contendo "Virtual Machine",
    // a cascata não usa esse campo (ela leria r.meter_category, que não existe)
    // — então o resultado deve vir do fallback consumed_service, não da categoria.
    const r = makeRecurso({ categoria: 'Virtual Machines', consumed_service: 'Microsoft.Storage' })
    expect(tipoRecurso(r)).toBe('Storage')
  })
})
