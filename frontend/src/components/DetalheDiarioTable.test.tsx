import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import DetalheDiarioTable from './DetalheDiarioTable'
import type { DetalheDiarioRow } from '../types/calculadora'

// Bug real: o tipo DetalheDiarioRow declarava campos (consumed_service/meter_name)
// que não existem na resposta real de GET /api/calculadora/detalhe-diario (que
// retorna nome_recurso/resource_type/location/resource_group_name/subscription_name/
// service_name/meter) — Tipo/Localização/RG/Assinatura ficavam sempre em branco
// ou "—" fixo. Estes testes usam o shape REAL da resposta do servidor.
const rows: DetalheDiarioRow[] = [
  {
    cost_date: '2026-08-20', subscription_id: 'sub-1', subscription_name: 'Assinatura Produção',
    resource_id: '/subscriptions/sub-1/resourceGroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/vm-01',
    nome_recurso: 'vm-01', resource_type: 'Virtual Machines', location: 'brazilsouth',
    resource_group_name: 'RG-PROD', service_name: 'Microsoft.Compute', meter: 'D4s v3', cost: 120.5,
  },
]

describe('DetalheDiarioTable', () => {
  it('mostra Tipo/Localização/Resource Group/Assinatura da linha (não mais "—" fixo)', async () => {
    render(<DetalheDiarioTable rows={rows} />)
    expect(screen.getByText('Virtual Machines')).toBeInTheDocument()
    expect(screen.getByText('brazilsouth')).toBeInTheDocument()
    expect(screen.getByText('RG-PROD')).toBeInTheDocument()
    expect(screen.getByText('Assinatura Produção')).toBeInTheDocument()
  });

  it('expande e mostra Nome do Serviço/Meter corretos no sub-detalhe', async () => {
    const user = userEvent.setup()
    render(<DetalheDiarioTable rows={rows} />)
    await user.click(screen.getByText('vm-01'))
    expect(await screen.findByText('Microsoft.Compute')).toBeInTheDocument()
    expect(screen.getByText('D4s v3')).toBeInTheDocument()
  });
});
