import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import MailingComposer from './MailingComposer'

vi.mock('../api/mailing', () => ({ uploadImagemMailing: vi.fn() }))

describe('MailingComposer', () => {
  it('mostra o conteúdo inicial', async () => {
    render(<MailingComposer value="<p>Olá, pessoal!</p>" onChange={() => {}} />)
    expect(await screen.findByText('Olá, pessoal!')).toBeInTheDocument()
  });

  it('oferece controles de fonte e preserva os estilos de fonte em HTML', async () => {
    let htmlAtualizado = ''
    const user = userEvent.setup()
    render(<MailingComposer value="<p>Texto</p>" onChange={(html) => { htmlAtualizado = html }} />)

    const area = document.querySelector('[contenteditable="true"]') as HTMLElement
    await user.click(area)
    await user.keyboard('{Control>}a{/Control}')
    await user.selectOptions(screen.getByLabelText('Tipo de fonte'), 'Georgia, serif')
    await user.selectOptions(screen.getByLabelText('Tamanho da fonte'), '18px')

    expect(htmlAtualizado).toContain('font-family: Georgia, serif')
    expect(htmlAtualizado).toContain('font-size: 18px')
  });

  it('mantém hyperlink real com estilo ao serializar o conteúdo do e-mail', async () => {
    let htmlAtualizado = ''
    const user = userEvent.setup()
    render(<MailingComposer value={'<p><span style="font-size:18px"><a href="https://example.com/info">Acesse as informações</a></span></p>'} onChange={(html) => { htmlAtualizado = html }} />)

    const link = await screen.findByRole('link', { name: 'Acesse as informações' })
    expect(link).toHaveAttribute('href', 'https://example.com/info')

    const area = document.querySelector('[contenteditable="true"]') as HTMLElement
    area.focus()
    await user.type(area, '!')
    expect(htmlAtualizado).toContain('href="https://example.com/info"')
    expect(htmlAtualizado).toContain('font-size: 18px')
  });

  it('insere hyperlink com texto e URL mesmo sem seleção prévia', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('Acesse o portal')
      .mockReturnValueOnce('https://example.com/portal')
    render(<MailingComposer value="<p></p>" onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Inserir ou editar hyperlink' }))

    expect(await screen.findByRole('link', { name: 'Acesse o portal' })).toHaveAttribute('href', 'https://example.com/portal')
  });

  it('preserva espaços repetidos visualmente no editor', async () => {
    let htmlAtualizado = ''
    const user = userEvent.setup()
    render(<MailingComposer value="<p>Um  dois</p>" onChange={(html) => { htmlAtualizado = html }} />)
    const area = document.querySelector('[contenteditable="true"]') as HTMLElement

    expect(area.textContent).toBe('Um  dois')
    expect(document.querySelector('[style*="white-space: pre-wrap"]')).toBeInTheDocument()

    area.focus()
    await user.type(area, '!')
    expect(htmlAtualizado).toContain('Um  dois')
  });

  it('serializa tabelas com largura fluida e alinhamento de células compatível com Outlook', async () => {
    let htmlAtualizado = ''
    const user = userEvent.setup()
    render(<MailingComposer value={'<table><tbody><tr><td><img src="cid:logo" width="120"></td><td><p>Texto da assinatura</p></td></tr></tbody></table>'} onChange={(html) => { htmlAtualizado = html }} />)

    const area = document.querySelector('[contenteditable="true"]') as HTMLElement
    expect(area.querySelector('td')?.getAttribute('valign')).toBe('top')

    area.focus()
    await user.type(area, '!')
    expect(htmlAtualizado).toContain('width="100%"')
    expect(htmlAtualizado).toContain('valign="top"')
    expect(htmlAtualizado).toContain('width="120"')
    expect(htmlAtualizado).toContain('border="0"')
    expect(htmlAtualizado).toMatch(/max-width:\s*100%/)
    expect(htmlAtualizado).toMatch(/vertical-align:\s*middle/)
  });

  it('insere modelos de tabela editáveis pelo seletor da toolbar', async () => {
    let htmlAtualizado = ''
    const user = userEvent.setup()
    render(<MailingComposer value="<p></p>" onChange={(html) => { htmlAtualizado = html }} />)

    await user.selectOptions(screen.getByLabelText('Inserir modelo de tabela'), 'monitoramento')

    expect(await screen.findByText('Faixa de Consumo')).toBeInTheDocument()
    expect(document.querySelectorAll('[contenteditable="true"] table tr')).toHaveLength(4)
    expect(htmlAtualizado).toContain('Bloqueio automático de novas utilizações')
  });

  it('normaliza tabelas antigas ao carregar, mesmo sem edição manual', async () => {
    const onChange = vi.fn()
    render(<MailingComposer value='<table><tbody><tr><td>Texto legado</td></tr></tbody></table>' onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('width="100%"'))
    })
  });

  it('mantém o texto da assinatura próximo ao logo nas tabelas já salvas', async () => {
    const onChange = vi.fn()
    render(<MailingComposer value='<table><tbody><tr><td><img src="/mailing-uploads/finops-logo-assinatura.png" width="120"></td><td>Assinatura</td></tr></tbody></table>' onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('table-layout: fixed'))
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('padding-left: 8px'))
    })
  })

  // Bug real corrigido (2026-10-16, achado pelo usuário: "Não aparece o modelo que do
  // MSG que te mandei" — clicar em "Usar modelo" no composer não atualizava a tela).
  // Causa: `useEditor({ content: value })` só lê `value` na criação do editor; trocar a
  // prop depois (setCorpoHtml de fora) não sincronizava sozinho — faltava o useEffect
  // que chama `editor.commands.setContent()`. Sem este teste, essa classe de bug nunca
  // aparecia porque nenhum teste existente mudava `value` depois da montagem — os
  // outros arquivos de teste do Mailing mockam este componente inteiro (um textarea no
  // lugar), então nunca exercitavam o editor de verdade.
  it('mudar o value de fora (ex: "Usar modelo") atualiza o editor visível', async () => {
    function Wrapper() {
      const [value, setValue] = useState('<p></p>')
      return (
        <div>
          <button onClick={() => setValue('<p>Conteúdo do modelo carregado</p>')}>Usar modelo</button>
          <MailingComposer value={value} onChange={() => {}} />
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Wrapper />)
    expect(screen.queryByText('Conteúdo do modelo carregado')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Usar modelo' }))
    expect(await screen.findByText('Conteúdo do modelo carregado')).toBeInTheDocument()
  });

  it('digitar no editor continua funcionando normalmente (sem a sincronização entrar em loop)', async () => {
    // Checa que digitar ainda produz conteúdo e dispara onChange, não o texto exato —
    // jsdom não tem motor de layout de verdade, então a ordem dos caracteres simulados
    // por userEvent.type() em contenteditable não é 100% fiel (limitação conhecida de
    // testar editores ricos em jsdom, não desta correção). O que importa aqui é que o
    // useEffect de sincronização (ver MailingComposer.tsx) não trava a digitação nem
    // entra em loop com o onUpdate — se entrasse, nada apareceria ou o teste travaria.
    let ultimoValue = ''
    function Wrapper() {
      const [value, setValue] = useState('<p></p>')
      return <MailingComposer value={value} onChange={(html) => { ultimoValue = html; setValue(html) }} />
    }
    const user = userEvent.setup()
    render(<Wrapper />)
    const area = document.querySelector('[contenteditable="true"]') as HTMLElement
    area.focus()
    await user.type(area, 'Testando digitação')
    expect(ultimoValue.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
  });
})
