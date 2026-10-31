import { useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { WikiDocument, WikiNode, WikiPage, WikiPageInput } from '../types/wiki'
import { importWikiDocument, uploadWikiImage } from '../api/wiki'
import { createWikiExtensions } from './WikiExtensions'

const EMPTY_DOCUMENT: WikiDocument = { type: 'doc', content: [{ type: 'paragraph' }] }
const MAX_WIKI_IMAGES = 50

function countWikiImages(node: WikiNode): number {
  return Number(node.type === 'wikiImage') + (node.content || []).reduce((count, child) => count + countWikiImages(child), 0)
}

interface WikiEditorProps {
  initial?: WikiPage
  saving: boolean
  onCancel: () => void
  onSave: (input: WikiPageInput) => void
}

export default function WikiEditor({ initial, saving, onCancel, onSave }: WikiEditorProps) {
  const [titulo, setTitulo] = useState(initial?.titulo || '')
  const [categoria, setCategoria] = useState(initial?.categoria || 'Geral')
  const [resumo, setResumo] = useState(initial?.resumo || '')
  const [conteudo, setConteudo] = useState<WikiDocument>(initial?.conteudo || EMPTY_DOCUMENT)
  const [portalPublico, setPortalPublico] = useState(initial?.portal_publico || false)
  const [liberarNovasImagens, setLiberarNovasImagens] = useState(false)
  const [corTexto, setCorTexto] = useState('#1f2937')
  const [importando, setImportando] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const editor = useEditor({
    extensions: createWikiExtensions(),
    content: conteudo,
    onUpdate: ({ editor: currentEditor }) => setConteudo(currentEditor.getJSON() as WikiDocument),
    editorProps: { attributes: { class: 'wiki-content wiki-editor-content', 'aria-label': 'Conteúdo do artigo' } },
  })

  function applyLink() {
    if (!editor) return
    const href = window.prompt('URL do link (http, https ou mailto):', 'https://')
    if (href === null) return
    if (!href.trim()) editor.chain().focus().unsetLink().run()
    else editor.chain().focus().setLink({ href: href.trim() }).run()
  }

  async function handleImage(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || !editor) return

    const currentImageCount = (editor.getJSON() as WikiDocument).content.reduce((count, node) => count + countWikiImages(node), 0)
    const availableSlots = Math.max(0, MAX_WIKI_IMAGES - currentImageCount)
    const filesToUpload = files.slice(0, availableSlots)
    if (filesToUpload.length < files.length) {
      window.showToast?.(`O artigo aceita até ${MAX_WIKI_IMAGES} imagens.`, 'warn')
    }
    if (!filesToUpload.length) return

    setUploadingImage(true)
    const imageNodes: WikiNode[] = []
    const failedFiles: string[] = []
    for (const file of filesToUpload) {
      try {
        const { mediaId } = await uploadWikiImage(file)
        imageNodes.push({ type: 'wikiImage', attrs: { mediaId, alt: file.name.replace(/\.[^.]+$/, '').slice(0, 300), portalPublico: liberarNovasImagens } })
      } catch {
        failedFiles.push(file.name)
      }
    }
    if (imageNodes.length) editor.chain().focus().insertContent(imageNodes).run()
    if (failedFiles.length) {
      window.showToast?.(`Falha ao enviar ${failedFiles.length} imagem(ns): ${failedFiles.join(', ')}`, 'error')
    }
    setUploadingImage(false)
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editor) return
    if ((titulo.trim() || editor.getText().trim()) && !window.confirm('Substituir o conteúdo atual pelo documento importado?')) return
    setImportando(true)
    try {
      const imported = await importWikiDocument(file)
      setTitulo(imported.titulo)
      setCategoria(imported.categoria)
      setResumo(imported.resumo)
      setConteudo(imported.conteudo)
      editor.commands.setContent(imported.conteudo)
      if (imported.avisos.length) window.showToast?.(`Documento importado com ${imported.avisos.length} aviso(s). Revise o conteúdo antes de publicar.`, 'warn')
    } catch (error) {
      window.showToast?.((error as Error).message, 'error')
    } finally {
      setImportando(false)
    }
  }

  function applyBlockStyle(value: string) {
    if (!editor || !value) return
    if (value === 'paragraph') editor.chain().focus().setParagraph().run()
    else editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run()
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({ titulo, categoria, resumo, conteudo, portal_publico: portalPublico })
  }

  return (
    <form className="wiki-edit-form" onSubmit={save}>
      <div className="wiki-edit-heading">
        <div>
          <div className="wiki-eyebrow">EDITOR DE ARTIGO</div>
          <h2>{initial ? 'Editar artigo' : 'Novo artigo'}</h2>
        </div>
        <div className="wiki-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving || !titulo.trim() || !editor}>
            {saving ? 'Salvando...' : initial?.status === 'publicado' ? 'Salvar alterações' : 'Salvar rascunho'}
          </button>
        </div>
      </div>

      <label className="wiki-field">
        <span>Título</span>
        <input autoFocus maxLength={180} value={titulo} onChange={(event) => setTitulo(event.target.value)} required />
      </label>
      <div className="wiki-field-row">
        <label className="wiki-field">
          <span>Categoria</span>
          <input maxLength={100} value={categoria} onChange={(event) => setCategoria(event.target.value)} required />
        </label>
        <label className="wiki-field">
          <span>Resumo</span>
          <input maxLength={500} value={resumo} onChange={(event) => setResumo(event.target.value)} placeholder="Opcional" />
        </label>
      </div>
      <label className="wiki-public-toggle">
        <input type="checkbox" checked={portalPublico} onChange={(event) => setPortalPublico(event.target.checked)} />
        <span><strong>Disponibilizar artigo no Portal Público</strong><small>O artigo precisa estar publicado; imagens só aparecem se forem liberadas individualmente.</small></span>
      </label>

      <div className="wiki-editor-frame">
        <div className="wiki-editor-toolbar" role="toolbar" aria-label="Formatação do artigo">
          <div className="wiki-toolbar-group">
            <button type="button" title="Desfazer" aria-label="Desfazer" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>↶</button>
            <button type="button" title="Refazer" aria-label="Refazer" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>↷</button>
          </div>
          <div className="wiki-toolbar-group">
            <select aria-label="Estilo do parágrafo" defaultValue="paragraph" onChange={(event) => applyBlockStyle(event.target.value)}>
              <option value="paragraph">Parágrafo</option><option value="1">Título 1</option><option value="2">Título 2</option><option value="3">Título 3</option>
            </select>
            <select aria-label="Fonte" defaultValue="Arial" onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}>
              {['Arial', 'Calibri', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'].map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
            <select aria-label="Tamanho da fonte" defaultValue="16px" onChange={(event) => editor?.chain().focus().setFontSize(event.target.value).run()}>
              {['12px', '14px', '16px', '18px', '24px', '32px', '48px'].map((size) => <option key={size} value={size}>{Number.parseInt(size, 10)}</option>)}
            </select>
            <label className="wiki-color-control" title="Cor do texto">
              <span aria-hidden="true">A</span>
              <span className="wiki-color-swatch" style={{ backgroundColor: corTexto }} aria-hidden="true" />
              <span aria-hidden="true">Cor</span>
              <input aria-label="Cor do texto" type="color" value={corTexto} onChange={(event) => {
                setCorTexto(event.target.value)
                editor?.chain().focus().setColor(event.target.value).run()
              }} />
            </label>
          </div>
          <div className="wiki-toolbar-group">
            <button type="button" title="Negrito" aria-label="Negrito" aria-pressed={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
            <button type="button" title="Itálico" aria-label="Itálico" aria-pressed={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
            <button type="button" title="Sublinhado" aria-label="Sublinhado" aria-pressed={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
            <button type="button" title="Tachado" aria-label="Tachado" aria-pressed={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></button>
          </div>
          <div className="wiki-toolbar-group">
            <button type="button" title="Alinhar à esquerda" aria-label="Alinhar à esquerda" onClick={() => editor?.chain().focus().setTextAlign('left').run()}>≡</button>
            <button type="button" title="Centralizar" aria-label="Centralizar" onClick={() => editor?.chain().focus().setTextAlign('center').run()}>≣</button>
            <button type="button" title="Alinhar à direita" aria-label="Alinhar à direita" onClick={() => editor?.chain().focus().setTextAlign('right').run()}>≡</button>
            <button type="button" title="Justificar" aria-label="Justificar" onClick={() => editor?.chain().focus().setTextAlign('justify').run()}>☷</button>
          </div>
          <div className="wiki-toolbar-group">
            <button type="button" title="Lista com marcadores" aria-label="Lista com marcadores" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
            <button type="button" title="Lista numerada" aria-label="Lista numerada" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
            <button type="button" title="Citação" aria-label="Citação" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❞</button>
            <button type="button" title="Bloco de código" aria-label="Bloco de código" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>&lt;/&gt;</button>
            <button type="button" title="Linha horizontal" aria-label="Linha horizontal" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>―</button>
          </div>
          <div className="wiki-toolbar-group">
            <button type="button" title="Inserir tabela 3 x 3" aria-label="Inserir tabela" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</button>
            <button type="button" title="Adicionar linha" aria-label="Adicionar linha" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addRowAfter().run()}>+↵</button>
            <button type="button" title="Adicionar coluna" aria-label="Adicionar coluna" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addColumnAfter().run()}>+↦</button>
            <button type="button" title="Inserir link" aria-label="Inserir link" onClick={applyLink}>↗</button>
          </div>
          <div className="wiki-toolbar-group">
            <label className="wiki-new-image-public-toggle">
              <input type="checkbox" checked={liberarNovasImagens} onChange={(event) => setLiberarNovasImagens(event.target.checked)} />
              Liberar novas imagens no portal
            </label>
            <button type="button" title="Inserir capturas ou imagens" aria-label="Inserir imagens" disabled={uploadingImage} onClick={() => document.getElementById('wiki-image-input')?.click()}>{uploadingImage ? 'Enviando…' : 'Inserir imagens'}</button>
            <button type="button" title="Importar PDF ou Word" aria-label="Importar PDF ou Word" disabled={importando} onClick={() => document.getElementById('wiki-import-input')?.click()}>{importando ? 'Importando…' : 'Importar PDF/Word'}</button>
          </div>
        </div>
        <input id="wiki-image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={handleImage} />
        <input id="wiki-import-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handleImport} />
        <EditorContent editor={editor} />
      </div>
    </form>
  )
}