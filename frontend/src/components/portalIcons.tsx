// Ícones SVG inline do portal (menu do cabeçalho e cards da página inicial), sem dependências.
interface IconProps { size?: number }

export function IconCalculadora({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width={size} height={size} aria-hidden="true">
      <rect x={4} y={2} width={12} height={16} rx={2} stroke="currentColor" strokeWidth={1.5} />
      <rect x={6.5} y={4.5} width={7} height={3} rx={0.5} stroke="currentColor" strokeWidth={1.2} />
      <path d="M7 11h.01M10 11h.01M13 11h.01M7 14h.01M10 14h.01M13 14h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function IconOrfaos({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width={size} height={size} aria-hidden="true">
      <path d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="2.4 2" />
      <path d="M10 8v3.5M10 14h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function IconCotaGenie({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width={size} height={size} aria-hidden="true">
      <path d="M4 15.5a6 6 0 1112 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M10 11.5l2.6-3.4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={10} cy={11.5} r={1} fill="currentColor" />
    </svg>
  )
}

export function IconSimulador({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width={size} height={size} aria-hidden="true">
      <path d="M11 3H4.5A1.5 1.5 0 003 4.5V11l7.5 7.5a1.5 1.5 0 002.12 0l4.88-4.88a1.5 1.5 0 000-2.12L11 3z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={7.5} cy={7.5} r={1.1} fill="currentColor" />
    </svg>
  )
}

export function IconInicio({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width={size} height={size} aria-hidden="true">
      <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1h-3.5v-5h-5v5H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
