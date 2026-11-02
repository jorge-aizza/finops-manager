import { EditorContent, useEditor } from '@tiptap/react'
import type { WikiPage } from '../types/wiki'
import { createWikiExtensions } from './WikiExtensions'

export default function WikiArticle({ page }: { page: WikiPage }) {
  const editor = useEditor({
    extensions: createWikiExtensions(),
    content: page.conteudo,
    editable: false,
    editorProps: { attributes: { class: 'wiki-content-body' } },
  }, [page.id, page.atualizado_em])
  return <EditorContent editor={editor} className="wiki-content" />
}