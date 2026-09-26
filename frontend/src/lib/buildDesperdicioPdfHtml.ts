import type { AzureDesperdicioItem } from '../types/azureInventario'

const CATEGORIA_LABEL: Record<string, string> = {
  disco_orfao: 'Disco não anexado',
  snapshot_antigo: 'Snapshot antigo',
  ip_solto: 'IP público sem uso',
  nic_orfa: 'NIC não anexada',
  app_service_plan_vazio: 'App Service Plan sem apps',
  lb_sem_backend: 'Load Balancer sem backend',
  appgw_sem_backend: 'App Gateway sem backend',
  vm_parada: 'VM parada (sem desalocar)',
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function brl(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}

export function buildDesperdicioPdfHtml(itens: AzureDesperdicioItem[], filtrosDescricao: string): string {
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
  const agora = new Date()
  const geradoEm = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const custoTotal = itens.reduce((a, i) => a + (i.custo_mensal_estimado || 0), 0)
  const semCusto = itens.filter((i) => i.custo_mensal_estimado === null).length

  const porTipo = new Map<string, { qtd: number; custo: number }>()
  for (const i of itens) {
    const t = porTipo.get(i.categoria) ?? { qtd: 0, custo: 0 }
    t.qtd++
    t.custo += i.custo_mensal_estimado || 0
    porTipo.set(i.categoria, t)
  }
  const tipoRows = Array.from(porTipo.entries()).sort((a, b) => b[1].custo - a[1].custo).map(([cat, v]) =>
    '<tr><td>' + esc(CATEGORIA_LABEL[cat] || cat) + '</td><td class="c">' + v.qtd + '</td>'
    + '<td class="c">' + (custoTotal > 0 ? ((v.custo / custoTotal) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%') + '</td>'
    + '<td class="r">' + brl(v.custo) + '</td></tr>',
  ).join('')

  const linhas = itens.map((i) =>
    '<tr><td>' + esc(i.nome || i.resource_id) + '</td>'
    + '<td>' + esc(CATEGORIA_LABEL[i.categoria] || i.categoria) + '</td>'
    + '<td>' + esc(i.resource_group || '—') + '</td>'
    + '<td>' + esc(i.sku || '—') + '</td>'
    + '<td class="r">' + (i.tamanho_gb ? esc(i.tamanho_gb) + ' GB' : '—') + '</td>'
    + '<td class="r">' + (i.custo_mensal_estimado === null ? '—' : brl(i.custo_mensal_estimado)) + '</td>'
    + '<td class="c">' + (i.dias_orfao !== null ? i.dias_orfao + 'd' : '—') + '</td></tr>',
  ).join('')

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Desperdício de Recursos — FinOps</title>
<style>
@page{size:A4 landscape;margin:12mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;font-size:9pt;margin:0;padding:0}
.hdr{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #7b2fbe;padding-bottom:8px;margin-bottom:10px}
.hdr img{height:38px}
.hdr .t{text-align:right}
.hdr .t h1{margin:0;font-size:15pt;color:#4a0080}
.hdr .t p{margin:2px 0 0;font-size:8pt;color:#5b2080;font-style:italic}
.kpis{display:flex;gap:10px;margin:10px 0}
.kpi{flex:1;border:1px solid #e0d4f5;border-radius:6px;padding:8px 10px;background:#f3e8ff}
.kpi .l{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;color:#5b2080}
.kpi .v{font-size:14pt;font-weight:700;color:#4a0080;margin-top:2px}
h2{background:#4a0080;color:#fff;font-size:9.5pt;margin:12px 0 0;padding:5px 8px}
table{width:100%;border-collapse:collapse}
th{background:#7b2fbe;color:#fff;font-size:8pt;padding:5px 6px;border:1px solid #4a0080;text-align:center}
td{padding:4px 6px;border:1px solid #e0d4f5;font-size:8pt;vertical-align:top;word-break:break-word}
tbody tr:nth-child(even) td{background:#f3e8ff}
tr{page-break-inside:avoid}
thead{display:table-header-group}
.r{text-align:right;white-space:nowrap}
.c{text-align:center;white-space:nowrap}
tbody tr.tot td{background:#9333ea;color:#fff;font-weight:700}
.nota{margin-top:8px;font-size:7.5pt;color:#6b7280}
</style></head><body>
<div class="hdr">
  <img src="${origin}/finops-logo.png" alt="FinOps">
  <div class="t"><h1>Desperdício de Recursos</h1><p>Gerado em ${esc(geradoEm)} &nbsp;|&nbsp; Filtros: ${esc(filtrosDescricao)}</p></div>
</div>
<div class="kpis">
  <div class="kpi"><div class="l">Recursos ociosos</div><div class="v">${itens.length}</div></div>
  <div class="kpi"><div class="l">Desperdício estimado por mês</div><div class="v">${brl(custoTotal)}</div></div>
  <div class="kpi"><div class="l">Projeção anual</div><div class="v">${brl(custoTotal * 12)}</div></div>
  <div class="kpi"><div class="l">Sem billing conhecido</div><div class="v">${semCusto}</div></div>
</div>
<h2>Desperdício por tipo de recurso</h2>
<table><thead><tr><th style="text-align:left">Tipo de recurso</th><th>Qtd</th><th>% do custo</th><th>Custo/mês</th></tr></thead>
<tbody>${tipoRows}<tr class="tot"><td>TOTAL</td><td class="c">${itens.length}</td><td class="c">100,0%</td><td class="r">${brl(custoTotal)}</td></tr></tbody></table>
<h2>Recursos ociosos</h2>
<table><thead><tr><th style="text-align:left">Recurso</th><th>Tipo</th><th>Resource Group</th><th>SKU</th><th>Tam.</th><th>Custo/mês</th><th>Dias órfão</th></tr></thead>
<tbody>${linhas}</tbody></table>
<div class="nota">Custo estimado pelo billing observado nos últimos 30 dias. Recursos sem linha de billing conhecida aparecem como “—”, nunca como R$ 0,00.</div>
</body></html>`
}
