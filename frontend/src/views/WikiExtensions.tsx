import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Link from '@tiptap/extension-link'
import { fetchWikiImage } from '../api/wiki'

function WikiImageNodeView({ node }: NodeViewProps) {
  const [src, setSrc] = useState('')
  const mediaId = Number(node.attrs?.mediaId)
  const alt = String(node.attrs?.alt || '')
  const width = Number(node.attrs?.width) || undefined

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setSrc('')
    void fetchWikiImage(mediaId).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setSrc(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => { if (active) setSrc('') })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaId])

  return (
    <NodeViewWrapper className="wiki-image-node">
      {src ? <img src={src} alt={alt} width={width} draggable={false} contentEditable={false} /> : <span className="wiki-image-loading">Carregando imagem...</span>}
    </NodeViewWrapper>
  )
}

const WikiImage = Node.create({
  name: 'wikiImage',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      mediaId: { default: null },
      alt: { default: '' },
      width: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'img[data-wiki-media-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { 'data-wiki-media-id': HTMLAttributes.mediaId })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikiImageNodeView)
  },
})

export function createWikiExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
    Underline,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    FontFamily,
    FontSize,
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    WikiImage,
  ]
}