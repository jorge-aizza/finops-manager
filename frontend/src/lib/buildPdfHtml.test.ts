import { describe, expect, it } from 'vitest'
import { buildPdfHtml } from './buildPdfHtml'
import type { PdfInvoiceInput } from '../types/invoice'
import type { ResultadoEstimativa } from '../types/calculadora'

function makeItem(overrides: Partial<ResultadoEstimativa>): ResultadoEstimativa {
  return {
    resource_id: 'r1', nome: 'vm-produção-01', sku: 'D4s v3', categoria: 'Virtual Machines',
    consumed_service: 'Microsoft.Compute', resource_group: 'RG-PROD', uom: '1 Hour',
    tipo_custo: 'hora', fixo_mensal: false, isHora: true, horas: 720, custo_hora: 2,
    fonte_estimado: 'billing', custo_mes: 1440, dias_ativos: 30, total_cobrado: 1440,
    estimado_brl: 1440, moeda: 'BRL',
    ...overrides,
  }
}

function makeInput(overrides: Partial<PdfInvoiceInput> = {}): PdfInvoiceInput {
  return {
    invoiceNum: 'EST-123456', dataFmt: '20/08/2026', dataValid: '25/08/2026',
    nomeProjeto: 'Projeto Alpha · Diretoria X', titulo: 'Estimativa de Custos Azure',
    resp: 'Ana Souza', email: 'ana@empresa.com', obs: 'Ambiente de POC',
    itens: [makeItem({})],
    total_brl: 1440, total_fixo_mes: 0, total_final: 1440,
    pct_imposto: 0, vl_imposto: 0, pct_cond: 0, vl_cond: 0,
    ...overrides,
  }
}

describe('buildPdfHtml', () => {
  it('usa o logo FinOps padrão (sem o "vivo"/mascote antigos)', () => {
    const html = buildPdfHtml(makeInput())
    expect(html).toContain('/finops-logo.png')
    expect(html).toContain('id="pdf-logo"')
    expect(html).not.toContain('mascote')
    expect(html).not.toMatch(/>vivo<\/text>/)
  });

  it('inclui o número da estimativa no <title> do documento (nome sugerido ao salvar o PDF)', () => {
    const semOrigem = buildPdfHtml(makeInput({ invoiceNum: 'EST-000111', titulo: 'Calculadora de Custos' }))
    expect(semOrigem).toMatch(/<title>FinOps Manager — EST-000111 — Calculadora de Custos<\/title>/)

    const app = buildPdfHtml(makeInput({ invoiceNum: 'EST-000111', titulo: 'Calculadora de Custos', origem: 'app' }))
    expect(app).toMatch(/<title>FinOps Manager — EST-000111 — Calculadora de Custos<\/title>/)

    const portal = buildPdfHtml(makeInput({ invoiceNum: 'EST-000111', titulo: 'Calculadora de Custos', origem: 'portal' }))
    expect(portal).toMatch(/<title>Portal de Servi[çc]o — EST-000111 — Calculadora de Custos<\/title>/)
  });

  it('remove caracteres proibidos em nome de arquivo do <title>', () => {
    const html = buildPdfHtml(makeInput({ invoiceNum: 'EST-000111', titulo: 'Projeto: A/B "teste"?' }))
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m![1]).not.toMatch(/[\\/:*?"<>|]/)
  });

  it('inclui número, título, projeto e valores no documento gerado', () => {
    const html = buildPdfHtml(makeInput())
    expect(html).toContain('EST-123456')
    expect(html).toContain('Estimativa de Custos Azure')
    expect(html).toContain('Projeto Alpha')
    expect(html).toContain('R$')
  });

  it('escapa caracteres HTML no título e observações (evita XSS/quebra de layout)', () => {
    const html = buildPdfHtml(makeInput({ titulo: '<script>alert(1)</script>', obs: 'Motivo & "razão"' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  });

  it('agrupa itens dinâmicos por categoria e soma o total de cada grupo', () => {
    const html = buildPdfHtml(makeInput({
      itens: [
        makeItem({ resource_id: 'a', categoria: 'Virtual Machines', estimado_brl: 100 }),
        makeItem({ resource_id: 'b', categoria: 'Virtual Machines', estimado_brl: 200 }),
        makeItem({ resource_id: 'c', categoria: 'Storage', estimado_brl: 50, tipo_custo: 'periodo', isHora: false }),
      ],
      total_brl: 350, total_final: 350,
    }))
    expect(html).toContain('Virtual Machines')
    expect(html).toContain('Storage')
    // Virtual Machines: 100+200=300
    expect(html).toContain(brlOf(300))
  });

  it('itens tipo=mes ficam separados como "Infra Fixa" e não entram no total dinâmico', () => {
    const html = buildPdfHtml(makeInput({
      itens: [
        makeItem({ resource_id: 'a', estimado_brl: 100 }),
        makeItem({ resource_id: 'b', tipo_custo: 'mes', estimado_brl: 50, custo_mes: 50, isHora: false }),
      ],
      total_fixo_mes: 50,
    }))
    expect(html).toContain('Infra Fixa')
    expect(html).toContain('Custos Fixos Mensais')
    expect(html).toContain('não estão incluídos no Total Estimado')
  });

  it('omite a linha de Imposto/Condomínio quando os percentuais são 0', () => {
    const html = buildPdfHtml(makeInput({ pct_imposto: 0, pct_cond: 0 }))
    expect(html).not.toContain('Imposto (');
    expect(html).not.toContain('+ Condomínio');
  });

  it('mostra Imposto/Condomínio quando os percentuais são > 0', () => {
    const html = buildPdfHtml(makeInput({ pct_imposto: 18.65, vl_imposto: 268.56, pct_cond: 13, vl_cond: 187.2, total_final: 1895.76 }))
    // Sem "+": imposto já vem embutido no Subtotal por recurso, não é mais somado separadamente.
    expect(html).toContain('Imposto (18.65%)')
    expect(html).toContain('+ Condomínio (13%)')
    expect(html).toContain(brlOf(1895.76))
  });

  it('mostra a sub-linha de horas (⏱) no card de total só quando p.horas está presente (estimativas salvas não têm)', () => {
    const comHoras = buildPdfHtml(makeInput({ horas: 720 }))
    expect(comHoras).toContain('720')
    expect(comHoras).toContain('⏱')
    const semHoras = buildPdfHtml(makeInput({ horas: undefined }))
    expect(semHoras).not.toContain('⏱')
  });

  it('mostra o bloco de períodos só quando p.periodos está presente e não vazio', () => {
    const comPeriodos = buildPdfHtml(makeInput({ periodos: [{ inicio: '2026-08-01T00:00', fim: '2026-08-02T00:00', horas: 24, horasTotal: 24, horasLivres: 0 }] }))
    expect(comPeriodos).toContain('Períodos de Estimativa')
    const semPeriodos = buildPdfHtml(makeInput({ periodos: null }))
    expect(semPeriodos).not.toContain('Períodos de Estimativa')
  });

  it('omite o bloco de observações quando obs está vazio', () => {
    const semObs = buildPdfHtml(makeInput({ obs: '' }))
    expect(semObs).not.toContain('Observações')
    const comObs = buildPdfHtml(makeInput({ obs: 'Motivo real' }))
    expect(comObs).toContain('Motivo real')
  });

  it('é uma função pura — mesma entrada produz a mesma saída, sem tocar no DOM', () => {
    const input = makeInput()
    expect(buildPdfHtml(input)).toBe(buildPdfHtml(input))
  });
});

function brlOf(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}
