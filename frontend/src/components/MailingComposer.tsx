import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { uploadImagemMailing } from '../api/mailing'
import './MailingComposer.css'

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

const MODELOS_TABELA = [
  {
    value: 'simples',
    label: 'Tabela simples (3 colunas)',
    html: '<table><tbody><tr><th>Coluna 1</th><th>Coluna 2</th><th>Coluna 3</th></tr><tr><td>Item</td><td>Informação</td><td>Detalhe</td></tr><tr><td>Item</td><td>Informação</td><td>Detalhe</td></tr></tbody></table><p></p>',
  },
  {
    value: 'limites',
    label: 'Limites por ambiente',
    html: '<table><tbody><tr><th>Ambiente</th><th>Cota do Workspace</th><th>Cota por Usuário</th><th>Vigência</th></tr><tr><td>DEV</td><td>1.000</td><td>A definir</td><td>01/11/2026</td></tr><tr><td>TEST</td><td>2.000</td><td>A definir</td><td>15/11/2026</td></tr><tr><td>PROD</td><td>10.000</td><td>A definir</td><td>01/12/2026</td></tr></tbody></table><p></p>',
  },
  {
    value: 'monitoramento',
    label: 'Faixas de monitoramento',
    html: '<table><tbody><tr><th>Status</th><th>Faixa de Consumo</th><th>Ação</th></tr><tr><td>🟡 Atenção</td><td>Acima de 50%</td><td>Avaliação preventiva do consumo</td></tr><tr><td>🟠 Alerta</td><td>Acima de 80%</td><td>Planejamento imediato de mitigação ou expansão</td></tr><tr><td>🔴 Crítico / Excedido</td><td>Acima de 100%</td><td>Bloqueio automático de novas utilizações</td></tr></tbody></table><p></p>',
  },
]

function normalizarTabelasEmail(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html

  for (const table of template.content.querySelectorAll('table')) {
    const assinatura = table.querySelector('img[src*="finops-logo-assinatura"]')
    if (assinatura) {
      const celulaLogo = table.rows[0]?.cells[0]
      const celulaTexto = table.rows[0]?.cells[1]
      const larguraLogo = assinatura.getAttribute('width') || '120'
      table.style.tableLayout = 'fixed'
      if (celulaLogo) {
        celulaLogo.setAttribute('width', larguraLogo)
        celulaLogo.style.width = `${larguraLogo}px`
        celulaLogo.style.paddingRight = '8px'
      }
      if (celulaTexto) celulaTexto.style.paddingLeft = '8px'
    }
    if (!table.hasAttribute('width')) table.setAttribute('width', '100%')
    if (!table.hasAttribute('border')) table.setAttribute('border', '0')
    if (!table.hasAttribute('cellpadding')) table.setAttribute('cellpadding', '0')
    if (!table.hasAttribute('cellspacing')) table.setAttribute('cellspacing', '0')
    if (!table.style.width) table.style.width = '100%'
    if (!table.style.borderCollapse) table.style.borderCollapse = 'collapse'
  }

  for (const cell of template.content.querySelectorAll<HTMLTableCellElement>('td, th')) {
    if (!cell.hasAttribute('valign')) cell.setAttribute('valign', 'top')
    if (!cell.style.verticalAlign) cell.style.verticalAlign = 'top'
  }

  return template.innerHTML
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [corTexto, setCorTexto] = useState('#1f2937')

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
    const { from, to } = editor.state.selection
    const textoSelecionado = editor.state.doc.textBetween(from, to, ' ').trim()
    if (!textoSelecionado) {
      const texto = window.prompt('Texto que aparecerá no comunicado:')
      if (texto === null || !texto.trim()) return
      const url = window.prompt('URL do hyperlink:', 'https://')
      if (url === null || !url.trim()) return
      editor.chain().focus().insertContent({
        type: 'text',
        text: texto.trim(),
        marks: [{ type: 'link', attrs: { href: url.trim() } }],
      }).run()
      return
    }

    const url = window.prompt('URL do link:', editor.getAttributes('link').href || 'https://')
    if (url === null) return
    if (!url) { editor.chain().focus().unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="mailing-editor-toolbar" role="toolbar" aria-label="Formatação da mensagem">
      <div className="mailing-toolbar-group">
        <button type="button" title="Desfazer" aria-label="Desfazer" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</button>
        <button type="button" title="Refazer" aria-label="Refazer" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</button>
      </div>
      <div className="mailing-toolbar-group">
        <select
          aria-label="Estilo de texto"
          value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'p') editor.chain().focus().setParagraph().run()
            else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
          }}
        >
          <option value="p">Parágrafo</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option>
        </select>
        <select aria-label="Tipo de fonte" value={editor.getAttributes('textStyle').fontFamily || ''} onChange={(event) => {
          const family = event.target.value
          if (family) editor.chain().focus().setFontFamily(family).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}>
          <option value="">Fonte padrão</option>
          <option value="Arial, sans-serif">Arial</option><option value="Calibri, sans-serif">Calibri</option>
          <option value="Helvetica, sans-serif">Helvetica</option><option value="Verdana, sans-serif">Verdana</option>
          <option value="Georgia, serif">Georgia</option><option value="'Times New Roman', serif">Times New Roman</option>
          <option value="Tahoma, sans-serif">Tahoma</option>
        </select>
        <select aria-label="Tamanho da fonte" value={editor.getAttributes('textStyle').fontSize || ''} onChange={(event) => {
          const size = event.target.value
          if (size) editor.chain().focus().setFontSize(size).run()
          else editor.chain().focus().unsetFontSize().run()
        }}>
          <option value="">Tamanho</option>
          {['10px', '12px', '14px', '16px', '18px', '24px', '32px', '48px'].map((size) => <option key={size} value={size}>{Number.parseInt(size, 10)}</option>)}
        </select>
        <label className="mailing-color-control" title="Cor do texto">
          <span aria-hidden="true">A</span>
          <span className="mailing-color-swatch" style={{ backgroundColor: corTexto }} aria-hidden="true" />
          <span aria-hidden="true">Cor</span>
          <input aria-label="Cor do texto" type="color" value={corTexto} onChange={(event) => {
            setCorTexto(event.target.value)
            editor.chain().focus().setColor(event.target.value).run()
          }} />
        </label>
      </div>
      <div className="mailing-toolbar-group">
        <button type="button" title="Negrito" aria-label="Negrito" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
        <button type="button" title="Itálico" aria-label="Itálico" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
        <button type="button" title="Sublinhado" aria-label="Sublinhado" aria-pressed={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button type="button" title="Tachado" aria-label="Tachado" aria-pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
      </div>
      <div className="mailing-toolbar-group">
        <button type="button" title="Alinhar à esquerda" aria-label="Alinhar à esquerda" aria-pressed={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>≡</button>
        <button type="button" title="Centralizar" aria-label="Centralizar" aria-pressed={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>≣</button>
        <button type="button" title="Alinhar à direita" aria-label="Alinhar à direita" aria-pressed={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>≡</button>
        <button type="button" title="Justificar" aria-label="Justificar" aria-pressed={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>☷</button>
      </div>
      <div className="mailing-toolbar-group">
        <button type="button" title="Lista com marcadores" aria-label="Lista com marcadores" aria-pressed={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
        <button type="button" title="Lista numerada" aria-label="Lista numerada" aria-pressed={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
        <button type="button" title="Citação" aria-label="Citação" aria-pressed={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❞</button>
        <button type="button" title="Linha horizontal" aria-label="Linha horizontal" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</button>
      </div>
      <div className="mailing-toolbar-group mailing-table-tools">
        <select aria-label="Inserir modelo de tabela" defaultValue="" onChange={(event) => {
          const modelo = MODELOS_TABELA.find((item) => item.value === event.target.value)
          if (modelo) editor.chain().focus().insertContent(modelo.html).run()
          event.target.value = ''
        }}>
          <option value="">Inserir tabela...</option>
          {MODELOS_TABELA.map((modelo) => <option key={modelo.value} value={modelo.value}>{modelo.label}</option>)}
        </select>
        {editor.isActive('table') && <>
          <button type="button" title="Adicionar linha" aria-label="Adicionar linha" onClick={() => editor.chain().focus().addRowAfter().run()}>+↵</button>
          <button type="button" title="Remover linha" aria-label="Remover linha" onClick={() => editor.chain().focus().deleteRow().run()}>−↵</button>
          <button type="button" title="Adicionar coluna" aria-label="Adicionar coluna" onClick={() => editor.chain().focus().addColumnAfter().run()}>+↦</button>
          <button type="button" title="Remover coluna" aria-label="Remover coluna" onClick={() => editor.chain().focus().deleteColumn().run()}>−↦</button>
          <button type="button" title="Excluir tabela" aria-label="Excluir tabela" onClick={() => editor.chain().focus().deleteTable().run()}>Excluir</button>
        </>}
      </div>
      <div className="mailing-toolbar-group">
        <button type="button" title="Inserir ou editar hyperlink" aria-label="Inserir ou editar hyperlink" aria-pressed={editor.isActive('link')} onClick={setLink}>↗</button>
        <button type="button" title="Inserir imagem" aria-label="Inserir imagem" onClick={() => fileRef.current?.click()}>Inserir imagem</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={handleImagem} />
      </div>
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
      ImageComTamanho.configure({
        HTMLAttributes: {
          border: '0',
          style: 'max-width:100%;height:auto;display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none',
        },
      }),
      Link.configure({ openOnClick: false, HTMLAttributes: { style: 'color:#7b2fbe' } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      // Tabela — único jeito confiável de texto ao lado de imagem que sobrevive ao editor
      // (2026-10-17, pedido do usuário: "quero o texto na frente da imagem como o MSG
      // consegue" — a assinatura original do .msg usava uma tabela pra isso). `img`
      // dentro de `<p>` nunca fica ao lado de texto porque a extensão de imagem é
      // BLOCO, não inline — quebra a imagem pro próprio parágrafo dela, sempre.
      // `border:0`/cellpadding/cellspacing como atributo HTML (não só CSS) de propósito:
      // é o jeito mais respeitado entre clientes de e-mail pra garantir tabela sem
      // bordas visíveis. `width="100%"` também evita que o Outlook Word calcule a
      // tabela pelo conteúdo da célula e desalinhe imagem e texto.
      Table.configure({
        resizable: true,
        renderWrapper: true,
        handleWidth: 6,
        HTMLAttributes: { width: '100%', border: '0', cellpadding: '0', cellspacing: '0', style: 'border-collapse:collapse;border:none' },
      }),
      TableRow,
      TableHeader.configure({ HTMLAttributes: { valign: 'top', style: 'border:none;vertical-align:top;padding:0' } }),
      TableCell.configure({ HTMLAttributes: { valign: 'top', style: 'border:none;vertical-align:top;padding:0' } }),
    ],
    content: value,
    parseOptions: { preserveWhitespace: 'full' },
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
    const htmlNormalizado = normalizarTabelasEmail(value)
    const htmlEditorNormalizado = normalizarTabelasEmail(editor.getHTML())
    if (htmlEditorNormalizado !== htmlNormalizado) {
      editor.commands.setContent(htmlNormalizado, {
        emitUpdate: false,
        parseOptions: { preserveWhitespace: 'full' },
      })
    }
    const htmlExibido = normalizarTabelasEmail(editor.getHTML())
    if (htmlExibido !== value) onChange(htmlExibido)
  }, [value, editor, onChange])

  if (!editor) return null

  return (
    <div className="mailing-editor-frame">
      {editable && <Toolbar editor={editor} />}
      <div className="mailing-table-surface mailing-editor-scroll">
        <EditorContent editor={editor} style={{ boxSizing: 'border-box', width: '100%', maxWidth: 640, margin: '0 auto', padding: '16px 24px', background: '#fff', color: '#1f2937', fontFamily: 'Arial,Helvetica,sans-serif', fontSize: 14, lineHeight: '21px', whiteSpace: 'pre-wrap' }} />
      </div>
    </div>
  )
}
