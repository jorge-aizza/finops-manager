import { useEffect, useState } from 'react'

// Roteamento do portal por hash (portal.html#/calculadora): não exige nada do servidor e faz
// Voltar, recarregar e link direto funcionarem.
export type ServicoId = 'calculadora' | 'orfaos' | 'genie-cotas'
export type PortalRota = 'home' | ServicoId

export function parseHash(hash: string): PortalRota {
  const seg = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return seg === 'calculadora' || seg === 'orfaos' || seg === 'genie-cotas' ? seg : 'home'
}

export function hrefDe(rota: PortalRota): string {
  return rota === 'home' ? '#/' : '#/' + rota
}

export function usePortalRoute(): PortalRota {
  const [rota, setRota] = useState<PortalRota>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRota(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return rota
}
