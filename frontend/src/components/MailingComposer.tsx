import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { uploadImagemMailing } from '../api/mailing'

// TipTap só preserva, ao CARREGAR um HTML pronto (ex: um modelo), os atributos que a
// extensão declara entender — `style` arbitrário em cima de <img>/<hr>/cor de texto é
// descartado silenciosamente no parse, mesmo que aquele exato `style` fosse o que a
// própria extensão geraria via botão da toolbar (confirmado testando o round-trip real,
// 2026-10-16 — não é suposição). Por isso:
//   - Tamanho de imagem usa o atributo HTML `width` (extensão abaixo, não vem no
//     @tiptap/extension-image padrão), não `style="width:..."` — funciona nos dois
//     sentidos (sobrevive ao editor E é o jeito mais compatível entre clientes de
//     e-mail, que costumam respeitar `width=""` melhor que CSS)
//   - Cor de marca em título/divisória é o PADRÃO da extensão (HTMLAttributes abaixo),
//     não algo pintado por instância no HTML do modelo — isso sim sobrevive, porque é
//     a própria regra de renderização da extensão, não um atributo solto que o parser
//     precisa reconhecer
const ImageComTamanho = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('width'),
        renderHTML: (attrs: { width?: string | null }) => (attrs.width ? { width: attrs.width } : {}),
      },
    }
  },
})

// Editor visual do comunicado — monta HTML pronto pra e-mail (sem depender de colar
// formatação suja do Outlook, ver decisão registrada no plano: um editor próprio com
// blocos visuais é mais previsível entre clientes de e-mail do que tentar importar
// markup do Outlook 1:1). `onChange` recebe o HTML atualizado a cada edição.
interface MailingComposerProps {
  value: string
  onChange: (html: string) => void
  editable?: boolean
}

const CORES = ['#1b2a4a', '#4a0080', '#7b2fbe', '#ff4d6a', '#ff8c42', '#22c55e', '#4da6ff']

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { url } = await uploadImagemMailing(file)
      // URL relativa (/mailing-uploads/...) — o navegador resolve contra a origem atual
      // no preview; no envio real o servidor já monta a URL absoluta (ver baseUrl em
      // _executarEnvioCampanha, server.js), então o <img src> relativo funciona nos dois.
      editor.chain().focus().setImage({ src: window.location.origin + url }).run()
    } catch (err) {
      window.showToast?.('Erro ao enviar imagem: ' + (err as Error).message, 'error')
    }
  }

  function setLink() {
    const url = window.prompt('URL do link:', editor.getAttributes('link').href || 'https://')
    if (url === null) return
    if (!url) { editor.chain().focus().unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const btn = (ativo: boolean): React.CSSProperties => ({
    padding: '5px 9px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border)',
    background: ativo ? 'var(--accent-dim)' : 'var(--bg)', color: ativo ? 'var(--accent)' : 'var(--text)',
    cursor: 'pointer', lineHeight: 1,
  })

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', borderRadius: '8px 8px 0 0' }}>
      <select
        aria-label="Estilo de texto"
        value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
        }}
        style={{ fontSize: 12, padding: '4px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
      >
        <option value="p">Parágrafo</option>
        <option value="h1">Título 1</option>
        <option value="h2">Título 2</option>
        <option value="h3">Título 3</option>
      </select>
      <button type="button" title="Negrito" style={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}><strong>N</strong></button>
      <button type="button" title="Itálico" style={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button type="button" title="Sublinhado" style={btn(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>S</u></button>
      <span style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
      <button type="button" title="Lista com marcadores" style={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Lista</button>
      <button type="button" title="Lista numerada" style={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Lista</button>
      <button type="button" title="Citação / destaque" style={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>" Destaque</button>
      <span style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
      <button type="button" title="Alinhar à esquerda" style={btn(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⬅</button>
      <button type="button" title="Centralizar" style={btn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()}>⬌</button>
      <button type="button" title="Alinhar à direita" style={btn(editor.isActive({ textAlign: 'right' }))} onClick={() => editor.chain().focus().setTextAlign('right').run()}>➡</button>
      <span style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
      <button type="button" title="Link" style={btn(editor.isActive('link'))} onClick={setLink}>🔗</button>
      <button type="button" title="Inserir imagem" style={btn(false)} onClick={() => fileRef.current?.click()}>🖼 Imagem</button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }} onChange={handleImagem} />
      <button type="button" title="Linha divisória" style={btn(false)} onClick={() => editor.chain().focus().setHorizontalRule().run()}>— Linha</button>
      <span style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
      {CORES.map((c) => (
        <button
          key={c} type="button" title={`Cor do texto`} aria-label={`Cor do texto ${c}`}
          onClick={() => editor.chain().focus().setColor(c).run()}
          style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid var(--border)', cursor: 'pointer', padding: 0 }}
        />
      ))}
    </div>
  )
}

export default function MailingComposer({ value, onChange, editable = true }: MailingComposerProps) {
  const editor = useEditor({
    extensions: [
      // link/underline: false — o StarterKit desta versão (3.32) já empacota as duas,
      // e eu configuro versões próprias logo abaixo (cor de marca no link, etc.). Sem
      // desativar as de dentro do StarterKit, ficam duas instâncias de cada registradas
      // ("Duplicate extension names found", aviso real do TipTap) e qual delas "vence"
      // fica por conta da ordem interna da lib, não da minha config — melhor não depender disso.
      StarterKit.configure({
        heading: { levels: [1, 2, 3], HTMLAttributes: { style: 'color:#4a0080' } },
        horizontalRule: { HTMLAttributes: { style: 'border:none;border-top:2px solid #7b2fbe;margin:20px 0' } },
        link: false,
        underline: false,
      }),
      ImageComTamanho.configure({ HTMLAttributes: { style: 'max-width:100%;height:auto' } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { style: 'color:#7b2fbe' } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      // Tabela — único jeito confiável de texto ao lado de imagem que sobrevive ao editor
      // (2026-10-17, pedido do usuário: "quero o texto na frente da imagem como o MSG
      // consegue" — a assinatura original do .msg usava uma tabela pra isso). `img`
      // dentro de `<p>` nunca fica ao lado de texto porque a extensão de imagem é
      // BLOCO, não inline — quebra a imagem pro próprio parágrafo dela, sempre.
      // `border:0`/cellpadding/cellspacing como atributo HTML (não só CSS) de propósito:
      // é o jeito mais respeitado entre clientes de e-mail pra garantir tabela sem
      // bordas visíveis (mesmo raciocínio do `width` na imagem, acima).
      Table.configure({
        resizable: false,
        HTMLAttributes: { border: '0', cellpadding: '0', cellspacing: '0', style: 'border-collapse:collapse;border:none' },
      }),
      TableRow,
      TableHeader,
      TableCell.configure({ HTMLAttributes: { style: 'border:none;vertical-align:top;padding:0' } }),
    ],
    content: value,
    editable,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Bug real corrigido (2026-10-16, achado pelo usuário: "Não aparece o modelo que do
  // MSG que te mandei"): `content: value` acima só é lido na CRIAÇÃO do editor — trocar
  // `value` depois (ex: clicar em "Usar modelo" em MailingCampanhaModal, que chama
  // setCorpoHtml) não reflete na tela sozinho, porque o TipTap não observa a prop pra
  // re-sincronizar. Confirmado rodando de verdade (não só lendo o código): um teste
  // trocando `value` de fora mostrava o editor intocado. `setContent(value, false)` força
  // a sincronização; o `false` evita disparar `onUpdate` de volta (senão era loop: troca
  // externa → onUpdate → onChange → novo value → troca externa de novo). O `if` evita
  // mexer no documento quando a mudança já veio de dentro do próprio editor (o usuário
  // digitando) — nesse caso `editor.getHTML()` já é igual a `value`, nada a fazer.
  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return null

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)' }}>
      {editable && <Toolbar editor={editor} />}
      <div style={{ padding: '16px 20px', minHeight: 280, maxHeight: 560, overflowY: 'auto' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
