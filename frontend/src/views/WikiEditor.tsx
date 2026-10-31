import { useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import type { WikiDocument, WikiPage, WikiPageInput } from '../types/wiki'

const EMPTY_DOCUMENT: WikiDocument = { type: 'doc', content: [{ type: 'paragraph' }] }

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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
      Underline,
    ],
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

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({ titulo, categoria, resumo, conteudo })
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

      <div className="wiki-editor-frame">
        <div className="wiki-editor-toolbar" role="toolbar" aria-label="Formatação do artigo">
          <button type="button" title="Negrito" aria-label="Negrito" onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
          <button type="button" title="Itálico" aria-label="Itálico" onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
          <button type="button" title="Título 2" aria-label="Título 2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button type="button" title="Lista com marcadores" aria-label="Lista com marcadores" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
          <button type="button" title="Lista numerada" aria-label="Lista numerada" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
          <button type="button" title="Citação" aria-label="Citação" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❞</button>
          <button type="button" title="Inserir link" aria-label="Inserir link" onClick={applyLink}>↗</button>
        </div>
        <EditorContent editor={editor} />
      </div>
    </form>
  )
}