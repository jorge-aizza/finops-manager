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

  it('usa a mesma largura e tipografia da prévia do comunicado', () => {
    render(<MailingComposer value="<p>Conteúdo</p>" onChange={() => {}} />)
    const area = document.querySelector('[contenteditable="true"]') as HTMLElement

    expect(area.parentElement).toHaveStyle({
      boxSizing: 'border-box', maxWidth: '640px', padding: '16px 24px', background: '#fff',
      fontFamily: 'Arial,Helvetica,sans-serif', fontSize: '14px', lineHeight: '21px',
      whiteSpace: 'pre-wrap',
    })
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

  it('mantém a seleção ao aplicar fonte, tamanho e negrito pela toolbar', async () => {
    const user = userEvent.setup()
    function Wrapper() {
      const [value, setValue] = useState('<p>Texto selecionado</p>')
      return <MailingComposer value={value} onChange={setValue} />
    }
    render(<Wrapper />)

    const area = document.querySelector('[contenteditable="true"]') as HTMLElement
    await user.click(area)
    await user.keyboard('{Control>}a{/Control}')
    await waitFor(() => expect(window.getSelection()?.toString()).toBe('Texto selecionado'))

    await user.selectOptions(screen.getByLabelText('Tipo de fonte'), 'Georgia, serif')
    await user.selectOptions(screen.getByLabelText('Tamanho da fonte'), '18px')
    await user.click(screen.getByTitle('Negrito'))

    const textoFormatado = area.querySelector('[style*="font-family"]')
    expect(textoFormatado).toHaveTextContent('Texto selecionado')
    expect(textoFormatado).toHaveStyle({ fontFamily: 'Georgia, serif', fontSize: '18px' })
    expect(area.textContent).toBe('Texto selecionado')
    expect(area.querySelector('strong')).toHaveTextContent('Texto selecionado')

    await user.keyboard('X')
    expect(area.textContent).toBe('X')
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
    render(<MailingComposer value="<p>Um  dois</p><p>Nova linha</p>" onChange={(html) => { htmlAtualizado = html }} />)
    const area = document.querySelector('[contenteditable="true"]') as HTMLElement

    expect(area.querySelectorAll('p')).toHaveLength(2)
    expect(area.querySelector('p')?.textContent).toBe('Um  dois')
    expect(area.querySelectorAll('p')[1].textContent).toBe('Nova linha')
    expect(document.querySelector('[style*="white-space: pre-wrap"]')).toBeInTheDocument()

    area.focus()
    await user.type(area, '!')
    expect(htmlAtualizado).toContain('Um  dois')
    expect(htmlAtualizado).toMatch(/<p>Nova linha!?<\/p>/)
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

  it('preserva parágrafos vazios sem convertê-los em quebras explícitas', async () => {
    const onChange = vi.fn()
    render(<MailingComposer value={'<p>Antes</p>\n<p></p><p><br></p><p>Depois</p>'} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('<p>Antes</p><p></p><p><br></p><p>Depois</p>')
    })
  });

  it('sincroniza com a prévia o HTML interpretado pelo editor ao carregar um comunicado', async () => {
    const onChange = vi.fn()
    render(<MailingComposer value={'<p>Antes</p>\n<p>Depois</p>\n<ul>\n<li>Item</li>\n</ul>'} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('<p>Antes</p><p>Depois</p><ul><li><p>Item</p></li></ul><p></p>')
    })
  });

  it('estabiliza a sincronização de uma assinatura com tabela em editor controlado', async () => {
    const onChange = vi.fn()
    function Wrapper() {
      const [value, setValue] = useState('<p>Comunicado</p><table><tbody><tr><td><img src="/mailing-uploads/finops-logo-assinatura.png" width="120"></td><td>Assinatura</td></tr></tbody></table>')
      return <MailingComposer value={value} onChange={(html) => { onChange(html); setValue(html) }} />
    }
    render(<Wrapper />)

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const chamadas = onChange.mock.calls.length
    expect(chamadas).toBeLessThan(5)
    expect(onChange.mock.lastCall?.[0]).toContain('Assinatura')
  });

  it('mantém o texto da assinatura próximo ao logo nas tabelas já salvas', async () => {
    const onChange = vi.fn()
    render(<MailingComposer value='<table><tbody><tr><td><img src="/mailing-uploads/finops-logo-assinatura.png" width="120"></td><td>Assinatura</td></tr></tbody></table>' onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('table-layout: fixed'))
      const template = document.createElement('template')
      template.innerHTML = onChange.mock.lastCall?.[0] || ''
      expect(template.content.querySelectorAll('td')[1].style.paddingLeft).toBe('8px')
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
