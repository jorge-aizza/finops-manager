import { useEffect, useRef, useState } from 'react'

// Combo multi-selecao com chips — porte do .combo-control do cockpit v56
// (Workspace / Usuario da barra de filtros).
//
// Diferente de CmsMultiSelect.tsx (checkbox + pending->commit com botao "OK"):
// aqui a selecao e imediata e aparece como chip dentro do proprio campo, e o
// texto digitado filtra a lista. E o idioma do cockpit, nao o do resto do app.

interface Props {
  id: string
  rotulo: string
  placeholder: string
  opcoes: string[]
  valor: string[]
  onChange: (v: string[]) => void
}

const MAX_CHIPS = 2   // acima disso vira "+N", senao o campo de 41px estoura

export default function CkCombo({ id, rotulo, placeholder, opcoes, valor, onChange }: Props) {
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const filtradas = opcoes.filter(
    (o) => !valor.includes(o) && o.toLowerCase().includes(busca.trim().toLowerCase())
  )
  const visiveis = valor.slice(0, MAX_CHIPS)
  const extras = valor.length - visiveis.length

  const alternar = (o: string) => {
    onChange(valor.includes(o) ? valor.filter((x) => x !== o) : [...valor, o])
    setBusca('')
  }

  return (
    <div className="ck-field" ref={wrapRef}>
      <label htmlFor={id}>{rotulo}</label>
      <div className="ck-combo-control" onClick={() => setAberto(true)}>
        {visiveis.map((v) => (
          <span className="ck-combo-chip" key={v} title={v}>
            <span className="ck-chip-label">{v}</span>
            <button
              type="button"
              aria-label={`Remover ${v}`}
              onClick={(e) => { e.stopPropagation(); alternar(v) }}
            >×</button>
          </span>
        ))}
        {extras > 0 && <span className="ck-combo-chip ck-combo-more">+{extras}</span>}
        <input
          id={id}
          type="text"
          value={busca}
          placeholder={valor.length ? '' : placeholder}
          onChange={(e) => { setBusca(e.target.value); setAberto(true) }}
          onFocus={() => setAberto(true)}
        />
      </div>
      {valor.length > 0 && (
        <button
          type="button"
          className="ck-combo-clear"
          aria-label={`Limpar ${rotulo}`}
          onClick={() => { onChange([]); setBusca('') }}
        >×</button>
      )}
      {aberto && (
        <ul className="ck-combo-list">
          {valor.map((v) => (
            <li key={'sel-' + v} className="ck-combo-selected" onClick={() => alternar(v)}>
              {v} ×
            </li>
          ))}
          {filtradas.map((o) => (
            <li key={o} onClick={() => alternar(o)}>{o}</li>
          ))}
          {!filtradas.length && !valor.length && (
            <li className="ck-combo-empty">Nenhum resultado</li>
          )}
        </ul>
      )}
    </div>
  )
}
