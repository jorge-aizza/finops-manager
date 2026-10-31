import { useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useQuery } from '@tanstack/react-query'
import { fetchPublicWikiImage, getPublicWikiPage, listPublicWikiCategories, listPublicWikiPages } from '../api/wiki'
import type { PublicWikiPage } from '../types/wiki'
import { createWikiExtensions } from './WikiExtensions'
import './WikiView.css'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function PublicWikiArticle({ page }: { page: PublicWikiPage }) {
  const editor = useEditor({
    extensions: createWikiExtensions(fetchPublicWikiImage),
    content: page.conteudo,
    editable: false,
    editorProps: { attributes: { class: 'wiki-content-body' } },
  }, [page.slug, page.atualizado_em])
  return <EditorContent editor={editor} className="wiki-content" />
}

export default function PublicWikiView() {
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const pagesQuery = useQuery({ queryKey: ['public-wiki-pages', busca, categoria], queryFn: () => listPublicWikiPages(busca, categoria || undefined) })
  const categoriesQuery = useQuery({ queryKey: ['public-wiki-categories'], queryFn: listPublicWikiCategories })
  const pages = pagesQuery.data || []
  const selectedSlug = pages.some((page) => page.slug === slug) ? slug : pages[0]?.slug || null
  const pageQuery = useQuery({ queryKey: ['public-wiki-page', selectedSlug], queryFn: () => getPublicWikiPage(selectedSlug!), enabled: Boolean(selectedSlug) })
  const page = pageQuery.data

  return (
    <div className="wiki-view public-wiki-view">
      <div className="view-hero">
        <div className="page-title">Base de conhecimento</div>
        <div className="view-hero-sub">Artigos públicos</div>
      </div>

      <div className="wiki-toolbar-row">
        <label className="wiki-search">
          <span className="wiki-search-icon" aria-hidden="true">⌕</span>
          <input aria-label="Buscar artigos públicos" placeholder="Buscar artigos..." value={busca} onChange={(event) => setBusca(event.target.value)} />
        </label>
        <select aria-label="Filtrar categoria" className="filter-select" value={categoria} onChange={(event) => setCategoria(event.target.value)}>
          <option value="">Todas as categorias</option>
          {(categoriesQuery.data || []).map((item) => <option key={item.categoria} value={item.categoria}>{item.categoria} ({item.total})</option>)}
        </select>
      </div>

      <div className="wiki-layout">
        <aside className="wiki-sidebar" aria-label="Artigos públicos">
          <div className="wiki-sidebar-heading">ARTIGOS <span>{pages.length}</span></div>
          {pagesQuery.isLoading && <div className="wiki-state">Carregando artigos...</div>}
          {pagesQuery.isError && <div className="wiki-state wiki-error">Não foi possível carregar os artigos.</div>}
          {!pagesQuery.isLoading && !pagesQuery.isError && pages.length === 0 && <div className="wiki-state">Nenhum artigo público encontrado.</div>}
          <div className="wiki-page-list">
            {pages.map((item) => (
              <button key={item.slug} className={`wiki-page-link${selectedSlug === item.slug ? ' is-active' : ''}`} onClick={() => setSlug(item.slug)}>
                <span className="wiki-page-category">{item.categoria}</span>
                <strong>{item.titulo}</strong>
                {item.resumo && <span className="wiki-page-summary">{item.resumo}</span>}
              </button>
            ))}
          </div>
        </aside>

        <main className="wiki-main">
          {pageQuery.isLoading && <div className="wiki-state">Carregando artigo...</div>}
          {pageQuery.isError && <div className="wiki-state wiki-error">Não foi possível abrir o artigo.</div>}
          {page && (
            <article>
              <div className="wiki-article-head">
                <div>
                  <div className="wiki-eyebrow">{page.categoria.toUpperCase()}</div>
                  <h1>{page.titulo}</h1>
                  {page.resumo && <p className="wiki-lead">{page.resumo}</p>}
                  <div className="wiki-meta">Atualizado em {formatDate(page.atualizado_em)}</div>
                </div>
              </div>
              <PublicWikiArticle key={`${page.slug}-${page.atualizado_em}`} page={page} />
            </article>
          )}
          {!page && !pageQuery.isLoading && !pageQuery.isError && (
            <div className="wiki-welcome">
              <div className="wiki-welcome-mark" aria-hidden="true">W</div>
              <h1>Conhecimento FinOps</h1>
              <p>Selecione um artigo para abrir.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}