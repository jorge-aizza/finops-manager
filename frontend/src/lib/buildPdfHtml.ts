import type { PdfInvoiceInput } from '../types/invoice'

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function brl(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}

// Nome sugerido pelo navegador ao "Salvar como PDF" (Ctrl+P dentro do iframe) vem do <title>
// do documento gerado aqui — não do título mostrado no modal de prévia. Por isso o número da
// estimativa entra no <title>, não só no cabeçalho visual do PDF. Caracteres proibidos em nome
// de arquivo no Windows (\ / : * ? " < > |) viram espaço; espaços duplicados colapsam.
function nomeArquivo(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Porta verbatim de _buildPDFHtml(p) (calculadora.js, ~350 linhas) — função
// pura (só lê p.*, sem DOM em tempo de build). O <script> embutido no HTML
// gerado roda depois, dentro do <iframe srcdoc>, independente do React —
// portado como string literal, sem alterações. Documento financeiro real
// (impresso/enviado a clientes) — qualquer divergência de formatação aqui é
// visível externamente, não só um detalhe de UI interna.
export function buildPdfHtml(p: PdfInvoiceInput): string {
  const todosItens = p.itens || []
  const itensDinamicos = todosItens.filter((r) => r.tipo_custo !== 'mes')
  const itensFixos = todosItens.filter((r) => r.tipo_custo === 'mes')
  const totalFixoMes = p.total_fixo_mes != null
    ? Number(p.total_fixo_mes)
    : itensFixos.reduce((s, r) => s + (Number(r.estimado_brl) || Number(r.custo_mes) || 0), 0)

  interface CatInfo { count: number; horas: number; total: number; allPeriodo: boolean }
  const catMap = new Map<string, CatInfo>()
  for (const r of itensDinamicos) {
    const cat = r.categoria || 'Outros'
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, horas: 0, total: 0, allPeriodo: true })
    const c = catMap.get(cat)!
    c.count++
    c.total += Number(r.estimado_brl) || 0
    const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo')
    if (tc !== 'periodo' && tc !== 'mes') { c.allPeriodo = false; c.horas += Number(r.horas) || 0 }
  }
  const catRows = Array.from(catMap.entries()).map(([cat, info]) => {
    const horasCell = info.allPeriodo ? '/m\xEAs' : info.horas.toLocaleString('pt-BR') + '\xA0h'
    return '<tr><td class="td-nm">' + esc(cat) + '</td>'
      + '<td class="td-qty" style="text-align:center;">' + info.count + '</td>'
      + '<td class="td-qty">' + horasCell + '</td>'
      + '<td class="td-brl">' + brl(info.total) + '</td>'
      + '</tr>'
  }).join('')
  const fixoRow = itensFixos.length > 0
    ? '<tr class="tr-sep-fix"><td colspan="4">🔒 Custos Fixos Mensais — cobrado independente das horas</td></tr>'
      + '<tr><td class="td-nm" style="color:#c05621;">Infra Fixa</td>'
      + '<td class="td-qty" style="text-align:center;color:#c05621;">' + itensFixos.length + '</td>'
      + '<td class="td-qty" style="color:#c05621;">Fixo/m\xEAs</td>'
      + '<td class="td-brl" style="color:#c05621;">' + brl(totalFixoMes) + '</td>'
      + '</tr>'
    : ''

  // Nota: o legado também monta variáveis `linhas`/`linhasFixo` (breakdown
  // por recurso individual) que nunca são inseridas no template final — só
  // a tabela agrupada por categoria (catRows/fixoRow) é renderizada. Código
  // morto no próprio original; omitido aqui (zero diferença de output).

  const totalFinal = p.total_final || p.total_brl || 0

  const periodosHtml = (p.periodos && p.periodos.length > 0) ? (() => {
    const fmt = (v: string) => (v ? v.slice(0, 10) : '')
    const totalH = p.periodos!.reduce((s, per) => s + per.horas, 0)
    const rows = p.periodos!.map((per, i) =>
      '<tr><td class="p-num">P' + (i + 1) + '</td>'
      + '<td class="p-dt">' + esc(fmt(per.inicio)) + ' → ' + esc(fmt(per.fim)) + '</td>'
      + '<td class="p-h">' + per.horas + ' h</td></tr>',
    ).join('')
    return '<div class="per-wrap"><span class="per-lbl">Per\xEDodos de Estimativa</span>'
      + '<table class="per-tbl"><tbody>' + rows
      + '<tr class="p-total"><td></td><td style="text-align:right;font-weight:700;font-size:7pt;">Total</td>'
      + '<td class="p-h">' + totalH + ' h</td></tr>'
      + '</tbody></table></div>'
  })() : ''

  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
  const origemLabel = p.origem === 'portal' ? 'Portal de Serviço' : 'FinOps Manager'
  const nomeDocumento = nomeArquivo(`${origemLabel} — ${p.invoiceNum} — ${p.titulo}`)
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${esc(nomeDocumento)}</title>
<style>
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:300 700;font-display:swap;src:url('${origin}/fonts/ibm-plex-sans-latin-400.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400 600;font-display:swap;src:url('${origin}/fonts/ibm-plex-mono-latin-400.woff2') format('woff2')}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
body{font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:9pt;color:#1a202c;background:#f0f2f5;padding:16px}
.page{background:#fff;max-width:960px;margin:0 auto;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
.hdr{background:linear-gradient(135deg,#faf7ff 0%,#f0e6ff 100%);display:flex;align-items:center;height:52px;padding:0 18px;gap:14px;position:relative;overflow:hidden}
.hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:rgba(147,51,234,.25)}
.hdr-logo{display:flex;align-items:center;flex-shrink:0}
.hdr-logo img{height:28px;width:auto;display:block}
.hdr-divider{width:1px;height:26px;background:rgba(147,51,234,.2);flex-shrink:0}
.hdr-meta{flex:1;display:flex;flex-direction:column;justify-content:center;gap:1px}
.hdr-title{font-size:9pt;font-weight:700;color:#5b21b6;letter-spacing:.01em}
.hdr-sub{font-size:6pt;color:#7c5fa0;letter-spacing:.14em;text-transform:uppercase}
.hdr-r{text-align:right;flex-shrink:0}
.hdr-num{font-size:8.5pt;font-weight:700;color:#7c3aed;font-family:'IBM Plex Mono',monospace;letter-spacing:.05em}
.hdr-date{font-size:6pt;color:#7c5fa0;margin-top:1px}
.stripe{height:3px;background:linear-gradient(90deg,#2d0060 0%,#660099 25%,#9333ea 50%,#660099 75%,#2d0060 100%)}
.meta-bar{display:grid;grid-template-columns:2fr 2fr 1fr 1.6fr;border-bottom:2px solid #ede9f7}
.mb{padding:9px 14px;border-right:1px solid #ede9f7;background:#fff}
.mb:last-child{border-right:none;background:linear-gradient(135deg,#f5f0ff,#ede4ff)}
.mb-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.17em;color:#9aa0be;margin-bottom:3px}
.mb-val{font-size:9pt;font-weight:600;color:#1a202c;line-height:1.2}
.mb-sub{font-size:6.5pt;color:#64748b;margin-top:2px}
.mb:last-child .mb-lbl{color:#6b5480}
.mb:last-child .mb-val{font-size:12pt;font-weight:700;color:#7c3aed;font-family:'IBM Plex Mono',monospace}
.cat-wrap{padding:9px 14px 10px;border-bottom:1px solid #ede9f7}
.cat-title{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.17em;color:#7c3aed;margin-bottom:7px}
.cat-grid{display:flex;flex-wrap:wrap;gap:5px}
.cat-card{background:#f5f0ff;border:1px solid #ede9f7;border-radius:5px;padding:5px 9px;min-width:100px;flex:1}
.cat-nm{font-size:7pt;font-weight:700;color:#5b21b6;margin-bottom:1px}
.cat-ct{font-size:6pt;color:#9aa0be}
.cat-vl{font-size:8.5pt;font-weight:700;color:#7c3aed;font-family:'IBM Plex Mono',monospace;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:7.5pt}
thead tr{background:#f5f0ff}
thead th{padding:6px 8px;font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5b21b6;text-align:left;white-space:nowrap;border-bottom:2px solid #9333ea}
thead th:last-child{text-align:right}
tbody tr{border-bottom:1px solid #f0eef8}
tbody tr:nth-child(odd){background:#fff}
tbody tr:nth-child(even){background:#faf7ff}
td{padding:4px 8px;vertical-align:middle}
.td-nm{font-weight:600;color:#0f172a;word-break:break-word}
.td-qty{color:#4a5568;white-space:nowrap;font-family:'IBM Plex Mono',monospace;font-size:7pt;width:90px}
.td-brl{text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;color:#1a202c;width:110px}
.td-green{color:#6d28d9}
.td-blue{color:#3b82f6}
.tr-sep-fix td{background:#fff7ed;color:#92400e;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:4px 8px;border-top:1px solid #fed7aa;border-bottom:1px solid #fed7aa}
.tr-sub-fix td{background:#fff7ed;border-top:1px solid #fed7aa;font-size:7.5pt;padding:5px 8px}
tfoot td{padding:5px 8px}
.tr-sub td{background:#f5f0ff;color:#5b21b6;border-top:1px solid #ede9f7;font-size:7.5pt}
.tr-sub td:last-child{font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:600;color:#6d28d9}
.tr-add td{background:#f5f0ff;color:#64748b;font-size:7pt;border-top:1px solid #ede9f7}
.tr-add td:last-child{font-family:'IBM Plex Mono',monospace;text-align:right}
.tr-total td{background:linear-gradient(90deg,#f5f0ff,#ede4ff);color:#5b21b6;font-weight:700;font-size:9pt;border-top:3px solid #9333ea;padding:9px 8px}
.tr-total td:first-child{padding-left:14px;color:#5b21b6;letter-spacing:.05em;text-transform:uppercase;font-size:7.5pt}
.tr-total td:last-child{font-family:'IBM Plex Mono',monospace;font-size:12pt;text-align:right;color:#7c3aed;padding-right:14px;font-weight:700}
.obs{padding:9px 14px;border-top:1px solid #ede9f7;background:#faf7ff;border-left:3px solid #9333ea}
.obs-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;margin-bottom:3px}
.obs-txt{font-size:8pt;color:#374151;line-height:1.6}
.per-wrap{padding:7px 14px;background:#f5f0ff;border-bottom:1px solid #ede9f7;display:flex;align-items:flex-start;gap:10px}
.per-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;white-space:nowrap;padding-top:3px}
.per-tbl{flex:1;border-collapse:collapse;font-size:7pt}
.per-tbl td{padding:2px 5px;border-bottom:1px solid #ede9f7;color:#4a5568}
.per-tbl .p-num{color:#660099;font-weight:700;width:20px}
.per-tbl .p-dt{font-family:'IBM Plex Mono',monospace}
.per-tbl .p-h{font-family:'IBM Plex Mono',monospace;text-align:right;color:#6d28d9;font-weight:600;white-space:nowrap}
.per-tbl .p-total td{font-weight:700;color:#4a0080;background:#ede9f7}
.foot{padding:7px 14px;background:linear-gradient(135deg,#faf7ff 0%,#f0e6ff 100%);display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(147,51,234,.2);gap:12px}
.foot-l{font-size:6pt;color:#7c5fa0;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.foot-dot{width:3px;height:3px;border-radius:50%;background:#9333ea;display:inline-block;opacity:.7}
.foot-disc{font-size:5.5pt;color:#6b5480;font-style:italic}
.foot-r{font-size:6pt;color:#6b5480;font-family:'IBM Plex Mono',monospace;letter-spacing:.04em;white-space:nowrap}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;max-width:100%}tbody tr:hover{background:inherit}@page{size:A4 portrait;margin:8mm 10mm}}
</style>
<script>
var inIframe=window!==window.parent;
window.onload=function(){
  var img=document.getElementById('pdf-logo');
  function doPrint(){window.print();window.onfocus=function(){setTimeout(function(){window.close();},400);};}
  function run(){if(!inIframe)doPrint();}
  if(!img){run();return;}
  if(img.complete&&img.naturalWidth){run();}
  else{img.onload=run;img.onerror=run;}
};
<\/script>
</head><body>
<div class="page">
<div class="hdr">
  <div class="hdr-logo">
    <img id="pdf-logo" src="${origin}/finops-logo.png" alt="FinOps">
  </div>
  <div class="hdr-divider"></div>
  <div class="hdr-meta">
    <div class="hdr-title">FinOps Manager</div>
    <div class="hdr-sub">Estimativa de Custos Azure</div>
  </div>
  <div class="hdr-r">
    <div class="hdr-num">${esc(p.invoiceNum)}</div>
    <div class="hdr-date">Emitido em ${p.dataFmt}</div>
  </div>
</div>
<div class="stripe"></div>
<div class="meta-bar">
  <div class="mb">
    <div class="mb-lbl">Projeto</div>
    <div class="mb-val">${esc((p.nomeProjeto || '').split('\xB7')[0].trim())}</div>
    ${p.resp ? '<div class="mb-sub">Resp: <strong>' + esc(p.resp) + '</strong></div>' : ''}
    ${p.email ? '<div class="mb-sub" style="font-size:6pt;color:#64748b;">✉ ' + esc(p.email) + '</div>' : ''}
  </div>
  <div class="mb">
    <div class="mb-lbl">T&iacute;tulo</div>
    <div class="mb-val" style="font-size:8pt;">${esc(p.titulo)}</div>
    <div class="mb-sub">${itensDinamicos.length} recurso${itensDinamicos.length !== 1 ? 's' : ''}${itensFixos.length > 0 ? ' + ' + itensFixos.length + ' fixo' + (itensFixos.length !== 1 ? 's' : '') : ''}</div>
  </div>
  <div class="mb">
    <div class="mb-lbl">V&aacute;lido at&eacute;</div>
    <div class="mb-val">${p.dataValid}</div>
  </div>
  <div class="mb">
    <div class="mb-lbl">Total Estimado BRL</div>
    <div class="mb-val">${brl(totalFinal)}</div>
    ${p.horas ? '<div class="mb-sub" style="margin-top:3px;">'
      + '<span style="color:#6b5480;font-size:6pt;">⏱\xA0</span>'
      + '<strong style="color:#7c3aed;font-family:\'IBM Plex Mono\',monospace;">' + Number(p.horas).toLocaleString('pt-BR') + '\xA0h</strong>'
      + (Number(p.horas) > 0 ? '<span style="color:#6b5480;font-size:5.5pt;margin-left:5px;">≈\xA0' + brl((p.total_brl || 0) / Number(p.horas)) + '/h</span>' : '')
      + '</div>' : ''}
  </div>
</div>
${catRows ? `<table>
  <thead><tr>
    <th style="width:45%">Tipo de Recurso</th>
    <th style="width:8%;text-align:center">Qtd</th>
    <th style="width:20%">Horas / Tipo</th>
    <th style="width:27%;text-align:right">Estimativa BRL</th>
  </tr></thead>
  <tbody>${catRows}${fixoRow}</tbody>
  <tfoot>
    <tr class="tr-sub"><td colspan="3">Subtotal Estimado</td><td>${brl(p.total_brl || 0)}</td></tr>
    ${(p.pct_imposto || 0) > 0 ? `<tr class="tr-add"><td colspan="3">Imposto (` + p.pct_imposto + `%)</td><td>` + brl(p.vl_imposto || 0) + `</td></tr>` : ``}
    ${(p.pct_cond || 0) > 0 ? `<tr class="tr-add"><td colspan="3">+ Condom\xEDnio (` + p.pct_cond + `%)</td><td>` + brl(p.vl_cond || 0) + `</td></tr>` : ``}
    <tr class="tr-total"><td colspan="3">Total Estimado</td><td>${brl(totalFinal)}</td></tr>
  </tfoot>
</table>` : ``}
${periodosHtml}
${p.obs ? '<div class="obs"><div class="obs-lbl">Observa&ccedil;&otilde;es</div><div class="obs-txt">' + esc(p.obs) + '</div></div>' : ''}
${itensFixos.length > 0 ? '<div style="padding:5px 14px;background:#fff7ed;border-top:1px solid #fed7aa;font-size:6pt;color:#92400e;font-style:italic;">⚠ Os custos fixos mensais não estão incluídos no Total Estimado. São cobrados mensalmente pelo Azure independente das horas do projeto.</div>' : ''}
<div class="foot">
  <div class="foot-l">
    <img src="${origin}/finops-logo.png" alt="FinOps" style="height:11px;width:auto;opacity:.7;display:block">
    <span class="foot-dot"></span>
    <span>FinOps Manager &middot; ${esc(p.invoiceNum)} &middot; ${new Date().toLocaleString('pt-BR')}</span>
    <span class="foot-dot"></span>
    <span class="foot-disc">Estimativa sujeita a altera&ccedil;&otilde;es &mdash; n&atilde;o constitui cobran&ccedil;a ou compromisso financeiro formal.</span>
  </div>
  <div class="foot-r">V&aacute;lido at&eacute; ${p.dataValid}</div>
</div>
</div></body></html>`
}
