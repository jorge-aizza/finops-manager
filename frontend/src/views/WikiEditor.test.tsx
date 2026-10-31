import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WikiEditor from './WikiEditor'
import * as wikiApi from '../api/wiki'
import type { WikiPage } from '../types/wiki'

vi.mock('../api/wiki')

const importedDocument = {
  type: 'doc' as const,
  content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Manual importado' }] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(wikiApi.fetchWikiImage).mockResolvedValue(new Blob(['image']))
  vi.mocked(wikiApi.uploadWikiImage).mockResolvedValue({ mediaId: 42, mimeType: 'image/png' })
  vi.mocked(wikiApi.importWikiDocument).mockResolvedValue({
    titulo: 'Manual importado', categoria: 'Importado', resumo: 'Resumo extraído', conteudo: importedDocument, avisos: [],
  })
})

describe('WikiEditor', () => {
  it('oferece controles de formatação Office, tabela, imagem e importação', () => {
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={() => {}} />)

    for (const name of [
      'Estilo do parágrafo', 'Fonte', 'Tamanho da fonte', 'Cor do texto', 'Negrito', 'Itálico',
      'Sublinhado', 'Tachado', 'Centralizar', 'Lista com marcadores', 'Inserir tabela',
      'Inserir imagens', 'Importar PDF ou Word', 'Desfazer', 'Refazer',
    ]) {
      const element = name === 'Cor do texto'
        ? screen.getByLabelText('Cor do texto')
        : screen.getByRole(name === 'Fonte' || name === 'Tamanho da fonte' || name === 'Estilo do parágrafo' ? 'combobox' : 'button', { name })
      expect(element).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Importar PDF ou Word' })).toHaveTextContent('Importar PDF/Word')
  })

  it('aplica formatação ao texto selecionado no editor', async () => {
    const user = userEvent.setup()
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={() => {}} />)
    const content = screen.getByLabelText('Conteúdo do artigo')

    await user.click(content)
    await user.type(content, 'Texto formatado')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Negrito' }))

    expect(content.querySelector('strong')).toHaveTextContent('Texto formatado')

    await user.click(screen.getByRole('button', { name: 'Centralizar' }))
    expect(content.querySelector('p')).toHaveAttribute('style', 'text-align: center;')
  })

  it('aplica a cor escolhida ao texto selecionado', async () => {
    const user = userEvent.setup()
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={() => {}} />)
    const content = screen.getByLabelText('Conteúdo do artigo')

    await user.click(content)
    await user.type(content, 'Texto colorido')
    await user.keyboard('{Control>}a{/Control}')
    fireEvent.change(screen.getByLabelText('Cor do texto'), { target: { value: '#ff0000' } })

    expect(content.querySelector('span[style*="color"]')).toHaveTextContent('Texto colorido')
    expect(content.querySelector('span[style*="color"]')).toHaveStyle({ color: 'rgb(255, 0, 0)' })
  })

  it('importa DOCX/PDF para o editor e salva o documento TipTap convertido', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={onSave} />)

    const importInput = document.getElementById('wiki-import-input') as HTMLInputElement
    const file = new File(['%PDF-test'], 'manual.pdf', { type: 'application/pdf' })
    fireEvent.change(importInput, { target: { files: [file] } })

    expect(wikiApi.importWikiDocument).toHaveBeenCalledWith(file)
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Manual importado'))
    expect(await screen.findByText('Manual importado')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ titulo: 'Manual importado', categoria: 'Importado', resumo: 'Resumo extraído' })
    expect(JSON.stringify(saved.conteudo)).toContain('Manual importado')
  })

  it('envia imagem pelo endpoint privado e insere sua referência no documento', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={onSave} />)
    const content = screen.getByLabelText('Conteúdo do artigo')
    await user.click(content)
    const imageInput = document.getElementById('wiki-image-input') as HTMLInputElement
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'grafico.png', { type: 'image/png' })
    fireEvent.change(imageInput, { target: { files: [image] } })

    await waitFor(() => expect(wikiApi.uploadWikiImage).toHaveBeenCalledWith(image))
    await user.type(screen.getByLabelText('Título'), 'Artigo com figura')
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    const serialized = JSON.stringify(saved.conteudo)
    expect(serialized).toContain('"mediaId":42')
  })

  it('salva a liberação do artigo e de cada imagem para o Portal Público', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const initial: WikiPage = {
      id: 8, slug: 'publicacao', titulo: 'Artigo liberado', categoria: 'Geral', resumo: null,
      status: 'publicado', portal_publico: false, atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z',
      criado_por: 'FinOps', criado_em: '2026-10-30T00:00:00Z',
      conteudo: { type: 'doc', content: [{ type: 'wikiImage', attrs: { mediaId: 42, alt: 'Diagrama', portalPublico: false } }] },
    }
    render(<WikiEditor initial={initial} saving={false} onCancel={() => {}} onSave={onSave} />)

    await user.click(screen.getByRole('checkbox', { name: /Disponibilizar artigo no Portal Público/ }))
    await user.click(await screen.findByLabelText('Liberar no portal público'))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ portal_publico: true })
    expect(JSON.stringify(onSave.mock.calls[0][0].conteudo)).toContain('"portalPublico":true')
  })

  it('insere várias capturas selecionadas na ordem dos arquivos', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    vi.mocked(wikiApi.uploadWikiImage)
      .mockResolvedValueOnce({ mediaId: 42, mimeType: 'image/png' })
      .mockResolvedValueOnce({ mediaId: 43, mimeType: 'image/png' })
    render(<WikiEditor saving={false} onCancel={() => {}} onSave={onSave} />)

    const imageInput = document.getElementById('wiki-image-input') as HTMLInputElement
    const first = new File([new Uint8Array([137, 80, 78, 71])], 'tela-1.png', { type: 'image/png' })
    const second = new File([new Uint8Array([137, 80, 78, 71])], 'tela-2.png', { type: 'image/png' })
    fireEvent.change(imageInput, { target: { files: [first, second] } })

    await waitFor(() => expect(wikiApi.uploadWikiImage).toHaveBeenCalledTimes(2))
    await user.type(screen.getByLabelText('Título'), 'Procedimento com capturas')
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const serialized = JSON.stringify(onSave.mock.calls[0][0].conteudo)
    expect(serialized.indexOf('"mediaId":42')).toBeLessThan(serialized.indexOf('"mediaId":43'))
  })
})
