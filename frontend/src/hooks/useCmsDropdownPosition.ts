import { useEffect, useState, type RefObject } from 'react'

export interface DropdownPos {
  top: number
  left: number
  width: number
}

// Bug real encontrado e corrigido: `position:absolute` continua sendo
// recortado por QUALQUER ancestral com overflow != visible — não só o
// ancestral posicionado mais próximo — a menos que o elemento seja movido
// pra outro ponto da árvore DOM (portal). `CalculadoraView.tsx` tem
// `overflow:hidden` no container raiz; o dropdown de Assinatura/Resource
// Group (`CmsMultiSelect`/`CmsSelect`, `.cms-dropdown`) ficava com o rodapé
// (botão "OK ✓") cortado e inacessível — o usuário marcava os checkboxes
// mas não conseguia confirmar a seleção. Calcula a posição do trigger via
// `getBoundingClientRect()` pra renderizar o dropdown com `position:fixed`
// via `createPortal(..., document.body)`, escapando de qualquer clipping
// de ancestral.
export function useCmsDropdownPosition(open: boolean, wrapRef: RefObject<HTMLElement | null>): DropdownPos | null {
  const [pos, setPos] = useState<DropdownPos | null>(null)

  useEffect(() => {
    if (!open || !wrapRef.current) {
      setPos(null)
      return
    }
    const el = wrapRef.current
    function update() {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, wrapRef])

  return pos
}
