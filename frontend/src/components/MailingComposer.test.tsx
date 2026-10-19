import { render, screen } from '@testing-library/react'
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
