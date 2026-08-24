import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PorServicoTable from './PorServicoTable'
import type { PorServicoRow } from '../types/calculadora'

// Bug real: o tipo PorServicoRow declarava `consumed_service`, mas
// GET /api/calculadora/por-servico retorna `service_name` — a coluna
// "Serviço" (a razão da tabela existir) ficava sempre em branco.
const rows: PorServicoRow[] = [
  { service_name: 'Microsoft.Compute', qtd_recursos: 12, qtd_rgs: 3, total_brl: 4000 },
  { service_name: 'Microsoft.Storage', qtd_recursos: 5, qtd_rgs: 2, total_brl: 1000 },
]

describe('PorServicoTable', () => {
  it('mostra o nome do serviço em cada linha (não mais em branco)', () => {
    render(<PorServicoTable rows={rows} />)
    expect(screen.getByText('Microsoft.Compute')).toBeInTheDocument()
    expect(screen.getByText('Microsoft.Storage')).toBeInTheDocument()
  });
});
