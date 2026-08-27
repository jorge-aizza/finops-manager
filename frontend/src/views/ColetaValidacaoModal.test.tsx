import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ColetaValidacaoModal from './ColetaValidacaoModal'
import * as coletaApi from '../api/coleta'
import * as databricksColetaApi from '../api/databricksColeta'
import type { HistoricoItem } from '../types/coleta'

vi.mock('../api/coleta')
vi.mock('../api/databricksColeta')

beforeEach(() => vi.clearAllMocks())

const semValidacao: HistoricoItem = {
  id: 9, tipo: 'api', origem: 'manual', iniciado_em: '2026-08-20T10:00:00.000Z', concluido_em: '2026-08-20T10:05:00.000Z',
  status: 'concluido', linhas_inseridas: 100, linhas_atualizadas: 0, linhas_erro: 0, mensagem: null, detalhes: null,
  periodo_inicio: '2026-08-01', periodo_fim: '2026-08-20', validacao_status: null, validacao_json: null, sp_nome: 'SP Produção',
}

function renderWithClient(item: HistoricoItem, fonte?: 'azure' | 'databricks') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ColetaValidacaoModal item={item} fonte={fonte} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

// Porta de verValidacaoColeta()/revalidarColeta() (app.js) — quando uma coleta
// nunca foi validada, o modal oferece "Validar agora" em vez de mostrar dados.
describe('ColetaValidacaoModal — "Validar agora" numa coleta sem validação prévia', () => {
  it('chama validarHistorico e mostra os números assim que a validação retorna', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.validarHistorico).mockResolvedValue({
      validacao_status: 'aviso',
      validacao_json: {
        total_registros: 800, custo_total: 3000, dias_com_dados: 15, dias_esperados: 20,
        subs_com_dados: 1, subs_esperadas: 1, subs_sem_dados: [], dias_sem_dados: ['2026-08-19'], validado_em: '2026-08-20T11:00:00.000Z',
      },
    })
    renderWithClient(semValidacao)

    expect(screen.getByText('Coleta sem validação registrada.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Validar agora/ }))

    await waitFor(() => expect(coletaApi.validarHistorico).toHaveBeenCalledWith(9))
    expect(await screen.findByText('⚠ Aviso — dados parciais')).toBeInTheDocument()
    expect(screen.getByText('800')).toBeInTheDocument()
    expect(screen.getByText('15 / 20')).toBeInTheDocument()
    expect(screen.getByText('abaixo de 85% — pode ser lag')).toBeInTheDocument()
  });
});

// fonte='databricks' — mesmo modal, chama a rota de validação da Coleta
// Databricks e troca o rótulo "Subscriptions" por "Workspaces" (Databricks
// não tem lista de subscriptions esperada, ver _validarColetaDatabricks).
describe('ColetaValidacaoModal — fonte="databricks"', () => {
  it('chama validarHistoricoDatabricks (não validarHistorico) e rotula como Workspaces', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.validarHistoricoDatabricks).mockResolvedValue({
      validacao_status: 'ok',
      validacao_json: {
        total_registros: 500, custo_total: 1200, dias_com_dados: 7, dias_esperados: 7,
        subs_com_dados: 3, subs_esperadas: 0, subs_sem_dados: [], dias_sem_dados: [], validado_em: '2026-08-27T11:00:00.000Z',
      },
    })
    renderWithClient(semValidacao, 'databricks')

    await user.click(screen.getByRole('button', { name: /Validar agora/ }))

    await waitFor(() => expect(databricksColetaApi.validarHistoricoDatabricks).toHaveBeenCalledWith(9))
    expect(coletaApi.validarHistorico).not.toHaveBeenCalled()
    expect(await screen.findByText('Workspaces')).toBeInTheDocument()
    expect(screen.queryByText('Subscriptions')).not.toBeInTheDocument()
  });
});
