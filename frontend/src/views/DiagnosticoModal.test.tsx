import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DiagnosticoModal from './DiagnosticoModal'
import * as coletaApi from '../api/coleta'
import type { DiagnosticoLinha } from '../types/coleta'

vi.mock('../api/coleta')

const mockDados: DiagnosticoLinha[] = [
  { meter_category: 'Virtual Machines', meter_sub_category: 'Dv3', consumed_service: 'Microsoft.Compute', charge_type: 'Usage', unit_of_measure: '1 Hour', pricing_model: 'OnDemand', publisher_type: null, recursos: 12, linhas: 500, total_billing: 4321.5, moeda: 'BRL' },
  { meter_category: 'Storage', meter_sub_category: 'Blob', consumed_service: 'Microsoft.Storage', charge_type: 'Purchase', unit_of_measure: '1 GB', pricing_model: 'Reservation', publisher_type: null, recursos: 3, linhas: 40, total_billing: 90, moeda: 'BRL' },
]

function renderWithClient(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <DiagnosticoModal onClose={onClose} />
    </QueryClientProvider>,
  ) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DiagnosticoModal', () => {
  it('lista as combinações vindas de GET /calculadora/diagnostico', async () => {
    vi.mocked(coletaApi.getDiagnostico).mockResolvedValue(mockDados)
    renderWithClient()
    expect(await screen.findByText('Virtual Machines')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('2 combinações')).toBeInTheDocument()
  });

  it('filtra por texto livre em qualquer coluna', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getDiagnostico).mockResolvedValue(mockDados)
    renderWithClient()
    await screen.findByText('Virtual Machines')

    await user.type(screen.getByPlaceholderText('Filtrar por qualquer coluna...'), 'storage')

    await waitFor(() => expect(screen.queryByText('Virtual Machines')).not.toBeInTheDocument())
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('1 combinações')).toBeInTheDocument()
  });

  it('filtra pelo select de charge_type', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getDiagnostico).mockResolvedValue(mockDados)
    renderWithClient()
    await screen.findByText('Virtual Machines')

    await user.selectOptions(screen.getByDisplayValue('Todos charge_type'), 'Purchase')

    expect(screen.queryByText('Virtual Machines')).not.toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
  });
});
