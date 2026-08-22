// Ícones inline SVG por cloud, copiados verbatim de loadDashboard() (app.js)
// pra manter fidelidade visual com o dashboard legado. Renderizados via
// dangerouslySetInnerHTML — conteúdo estático/confiável, não vem de input
// do usuário.
export const CLOUD_ICONS: Record<string, string> = {
  AWS: `<svg viewBox="0 0 40 24" width="40" height="24" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.6 10.9c0 .4.1.7.2 1 .1.2.3.5.5.7.1.1.1.2.1.3 0 .1-.1.2-.2.3l-.7.5c-.1.1-.2.1-.3.1-.1 0-.2-.1-.3-.2-.2-.2-.3-.4-.5-.6-.1-.2-.3-.5-.4-.8-1 1.2-2.3 1.7-3.8 1.7-1.1 0-2-.3-2.6-.9-.6-.6-1-1.4-1-2.4 0-1.1.4-1.9 1.1-2.6.7-.6 1.7-.9 2.9-.9.4 0 .8 0 1.3.1.4.1.9.2 1.4.3v-1c0-1-.2-1.7-.6-2.1-.4-.4-1.1-.6-2-.6-.4 0-.9.1-1.3.2-.4.1-.9.3-1.3.5-.2.1-.3.1-.4.1-.1 0-.2-.1-.2-.3V4.3c0-.1 0-.2.1-.3.1-.1.2-.1.3-.2.4-.2.9-.4 1.5-.5.6-.1 1.2-.2 1.8-.2 1.4 0 2.4.3 3 1 .6.7.9 1.7.9 3v3.8zm-5.2 1.9c.4 0 .8-.1 1.2-.2.4-.2.8-.4 1.1-.8.2-.2.3-.5.4-.8.1-.3.1-.6.1-1V9.5c-.3-.1-.7-.1-1-.2-.4 0-.7-.1-1-.1-.7 0-1.2.1-1.6.4-.4.3-.5.7-.5 1.2 0 .5.1.9.4 1.2.3.2.6.3 1 .3h-.1zm8.6 1.2c-.1 0-.2 0-.3-.1-.1-.1-.1-.2-.2-.4L12 5.9c0-.2-.1-.3-.1-.4 0-.1.1-.2.2-.2h1.1c.1 0 .2 0 .3.1.1.1.1.2.2.3l1.8 7.1 1.7-7.1c0-.1.1-.2.2-.3.1-.1.2-.1.3-.1h.9c.1 0 .2 0 .3.1.1.1.1.2.2.3l1.7 7.2 1.8-7.2c0-.1.1-.2.2-.3.1-.1.2-.1.3-.1h1c.1 0 .2.1.2.2 0 0 0 .1-.1.4l-2.5 7.6c0 .2-.1.3-.2.4-.1.1-.2.1-.3.1h-.9c-.1 0-.2 0-.3-.1-.1-.1-.1-.2-.2-.4l-1.7-7-1.7 7c0 .2-.1.3-.2.4-.1.1-.2.1-.3.1h-.9zm13.3.3c-.6 0-1.1-.1-1.7-.2-.5-.1-1-.3-1.3-.5-.1-.1-.2-.2-.2-.3v-.6c0-.2.1-.3.2-.3.1 0 .1 0 .2.1.4.2.9.4 1.4.5.5.1 1 .2 1.5.2.8 0 1.4-.1 1.8-.4.4-.3.6-.6.6-1.1 0-.3-.1-.6-.3-.8-.2-.2-.6-.4-1.2-.6l-1.8-.5c-.9-.3-1.5-.7-2-1.2-.4-.5-.7-1.1-.7-1.8 0-.5.1-1 .4-1.4.3-.4.6-.8 1-.1.4-.3.9-.5 1.4-.6.5-.1 1.1-.2 1.7-.2h.4c.1 0 .3 0 .5.1.2 0 .3.1.5.1.1 0 .3.1.4.1.1.1.2.1.2.2v.6c0 .2-.1.3-.2.3-.1 0-.3-.1-.5-.1-.7-.1-1.4-.2-1.9-.2-.7 0-1.3.1-1.7.3-.4.2-.6.6-.6 1 0 .3.1.6.3.8.2.2.7.4 1.3.6l1.7.5c.9.3 1.5.7 1.9 1.2.4.5.6 1 .6 1.7 0 .5-.1 1-.4 1.5-.3.4-.6.8-1.1 1.1-.4.3-1 .5-1.6.6-.6.1-1.2.2-1.8.2z" fill="#FF9900"/>
    <path d="M30.5 17.3c-3.5 2.6-8.6 4-13 4-6.1 0-11.6-2.3-15.8-6 .3-.3.7.1 1.2.1 4.5 2.6 10 4.2 15.8 4.2 3.9 0 8.1-.8 12-2.4.6-.2 1.1.4.8.1z" fill="#FF9900"/>
    <path d="M32 15.2c-.4-.5-2.7-.3-3.8-.1-.3 0-.4-.2-.1-.5 1.9-1.3 4.9-1 5.3-.5.4.5-.1 3.4-1.8 4.8-.3.2-.5.1-.4-.2.4-.9 1.2-3 .8-3.5z" fill="#FF9900"/>
  </svg>`,
  Azure: `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.05 4.24L6.56 18.05l5.2.92-4.8-5.74 6.09-9z" fill="#0089D6"/>
    <path d="M14.44 5.22l3.63 10.2-9.51 2.63 9.51-2.63z" fill="#0089D6"/>
    <path d="M6.56 18.05l2.72-4.82 2.48 2.97z" fill="#005BA1"/>
    <path d="M14.44 5.22L18.07 15.42 20 19.76H8.51l5.93-14.54z" fill="#0089D6"/>
  </svg>`,
  GCP: `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2.5l7.5 4.3v8.4L12 19.5l-7.5-4.3V6.8z" fill="none"/>
    <path d="M14.8 8.3H12v1.4h2.8c-.3 1.3-1.4 2.3-2.8 2.3-1.7 0-3-1.3-3-3s1.3-3 3-3c.7 0 1.4.3 1.9.7l1-1C14 4.9 13 4.5 12 4.5c-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5c2.5 0 4.3-1.8 4.3-4.3 0-.3 0-.6-.1-.9h-1.4z" fill="#4285F4"/>
    <circle cx="6" cy="15" r="2" fill="#EA4335"/>
    <circle cx="12" cy="18" r="2" fill="#FBBC05"/>
    <circle cx="18" cy="15" r="2" fill="#34A853"/>
  </svg>`,
  Oracle: `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="7" width="22" height="10" rx="5" fill="#F80000"/>
    <rect x="1" y="7" width="22" height="10" rx="5" fill="none" stroke="#C00000" stroke-width="0.5"/>
    <text x="12" y="15" text-anchor="middle" fill="white" font-family="Arial" font-size="6" font-weight="bold">ORACLE</text>
  </svg>`,
  Multicloud: `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="12" r="5" fill="none" stroke="#89b4fa" stroke-width="1.5" opacity="0.7"/>
    <circle cx="16" cy="12" r="5" fill="none" stroke="#a6e3a1" stroke-width="1.5" opacity="0.7"/>
    <path d="M10.5 9a5 5 0 010 6" stroke="#cba6f7" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M13.5 9a5 5 0 000 6" stroke="#cba6f7" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`,
}

export function cloudIconOrFallback(cloud: string): string {
  if (CLOUD_ICONS[cloud]) return CLOUD_ICONS[cloud]
  return `<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent,#89b4fa)" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="var(--accent,#89b4fa)" font-size="8">${cloud.substring(0, 2)}</text></svg>`
}
