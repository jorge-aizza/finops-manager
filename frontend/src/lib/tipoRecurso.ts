import type { RecursoBilling } from '../types/calculadora'

// Porta fiel de _tipoRecurso (calculadora.js:1612-1646) — cascata de
// classificação em ordem fixa de prioridade. NÃO reordenar: um recurso pode
// bater em mais de um heurístico, e a ordem decide qual tipo "ganha".
//
// Bug latente preservado de propósito: o legado lê `r.meter_category`
// (singular), mas a API só retorna `categoria`/`meter_categories` — esse
// campo nunca existe na resposta, então `cat` é sempre string vazia e todo
// `cat.includes(...)` abaixo é sempre falso na prática. Classificação real
// hoje depende só de `svc`/`rg`/`nom`. Corrigir isso mudaria a classificação
// de recursos que hoje só caem nos fallbacks de svc/rg — não "consertar"
// aqui, o objetivo é bater com o comportamento atual em produção.
export function tipoRecurso(r: RecursoBilling): string {
  const svc = (r.consumed_service || '').toLowerCase()
  const cat = '' // ver nota acima — r.meter_category nunca existe na resposta da API
  const rg = (r.resource_group_name || '').toLowerCase()
  const nom = (r.nome_recurso || r.resource_id || '').toLowerCase()

  // Bug real corrigido a pedido do usuário (não é o bug latente acima — este era só
  // rg.startsWith('databricks-rg-')/'managed-rg-adbx-', igualzinho ao legado
  // (calculadora.js:1385), então nunca foi introduzido pela migração): RGs no padrão
  // genérico MANAGED-RG-* (ex: MANAGED-RG-DBW-*, que a Vivo usa em produção) já eram
  // reconhecidos como Databricks por _detectManagedRg() (server.js, usado pro badge de
  // RG) mas caíam fora do chip "Databricks" aqui — iam parar em VMs/Outros. Ampliado pra
  // 'managed-rg-' (cobre também o -adbx- mais específico) pra bater com _detectManagedRg().
  if (svc.includes('databricks') || cat.includes('databricks') || rg.startsWith('databricks-rg-') || rg.startsWith('managed-rg-')) return 'Databricks'
  if (svc.includes('containerservice') || cat.includes('kubernetes') || (svc.includes('compute') && (nom.startsWith('aks-') || rg.startsWith('mc_')))) return 'AKS'
  if (nom.startsWith('azurebackup_') || cat.includes('azure backup') || cat.includes('backup vault')) return 'Backup'
  if (cat.includes('virtual machine')) return 'VMs'
  if (cat.includes('managed disk') || cat.includes('disk') || (svc.includes('compute') && (nom.includes('disk') || nom.startsWith('pvc-')))) return 'Discos'
  if (svc.includes('compute')) return 'VMs'
  if (cat.includes('storage') || svc.includes('storage')) return 'Storage'
  if (cat.includes('load balancer')) return 'Load Balancer'
  if (cat.includes('bandwidth') || cat.includes('content delivery') || cat.includes('egress') || cat.includes('cdn') || svc.includes('.cdn') || cat.includes('front door') || svc.includes('frontdoor')) return 'Rede/CDN'
  if (svc.includes('network') || cat.includes('ip address') || cat.includes('virtual network') || cat.includes('dns') || cat.includes('traffic manager') || svc.includes('trafficmanager') || svc.includes('privatedns')) return 'Rede'
  if (svc.includes('sql') || cat.includes('sql')) return 'SQL'
  if (svc.includes('dbforpostgresql') || svc.includes('dbformysql') || svc.includes('dbformariadb') || svc.includes('documentdb') || cat.includes('cosmos db') || cat.includes('postgresql') || cat.includes('mysql') || cat.includes('mariadb') || cat.includes('azure database')) return 'Banco de Dados'
  if (svc.includes('cache') || cat.includes('redis') || cat.includes('cache for redis')) return 'Cache'
  if (svc.includes('eventhub') || svc.includes('servicebus') || svc.includes('eventgrid') || svc.includes('notificationhubs') || cat.includes('event hubs') || cat.includes('service bus') || cat.includes('event grid') || cat.includes('notification hubs')) return 'Mensageria'
  if (svc.includes('containerregistry') || svc.includes('containerinstance') || cat.includes('container registry') || cat.includes('container instances')) return 'Containers'
  if (svc.includes('cognitiveservices') || svc.includes('machinelearning') || svc.includes('openai') || cat.includes('cognitive') || cat.includes('machine learning') || cat.includes('openai') || cat.includes('azure ai')) return 'IA/ML'
  if (svc.includes('synapse') || svc.includes('streamanalytics') || svc.includes('hdinsight') || svc.includes('powerbidedicated') || svc.includes('datafactory') || cat.includes('synapse') || cat.includes('stream analytics') || cat.includes('hdinsight') || cat.includes('power bi') || cat.includes('data factory')) return 'Analytics'
  if (svc.includes('apimanagement') || svc.includes('logic') || svc.includes('automation') || cat.includes('api management') || cat.includes('logic apps') || cat.includes('automation') || cat.includes('integration')) return 'Integração'
  if (svc.includes('web') || cat.includes('app service') || cat.includes('functions') || cat.includes('azure functions') || cat.includes('app configuration') || svc.includes('appconfiguration')) return 'App Service'
  if (svc.includes('keyvault') || cat.includes('key vault')) return 'Key Vault'
  if (svc.includes('recoveryservices') || cat.includes('backup') || cat.includes('recovery services') || cat.includes('site recovery')) return 'Backup'
  if (svc.includes('monitor') || svc.includes('operationalinsights') || svc.includes('.insights') || cat.includes('monitor') || cat.includes('log analytics') || cat.includes('application insights')) return 'Monitoramento'
  if (r.charge_type === 'Purchase' || r.pricing_model === 'Reservation') return 'Reservas'
  return 'Outros'
}

export const TIPO_COLOR: Record<string, string> = {
  VMs: 'var(--accent)',
  Discos: 'var(--orange,#ff8c42)',
  Storage: 'var(--orange,#ff8c42)',
  Rede: 'var(--blue,#4da6ff)',
  'Rede/CDN': 'var(--blue,#4da6ff)',
  Databricks: 'var(--accent)',
  AKS: 'var(--orange,#ff8c42)',
  Containers: 'var(--orange,#ff8c42)',
  Backup: 'var(--green,#22c55e)',
  Mensageria: 'var(--green,#22c55e)',
  SQL: 'var(--blue,#4da6ff)',
  'Banco de Dados': 'var(--blue,#4da6ff)',
  Cache: 'var(--blue,#4da6ff)',
  'IA/ML': 'var(--accent)',
  Analytics: 'var(--accent)',
}

export function tipoColor(tipo: string): string {
  return TIPO_COLOR[tipo] || 'var(--text-dim)'
}
