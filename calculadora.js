// ═══════════════════════════════════════════════════════════════════
// calculadora.js — Calculadora de Custo/Hora Azure  v2
// Injeta conteúdo dentro de #view-calculadora (já presente no index)
// ═══════════════════════════════════════════════════════════════════
const Calculadora = (() => {

  let _recursos     = [];
  let _selecionados = {};
  let _periodos     = [];   // [{inicio, fim, horas, label}]
  let _horasPeriodoValidas = false; // true quando datas/horas do período formam intervalo > 0
  let _subsSel      = [];   // subscription_ids selecionados
  let _rgsSel       = [];   // resource_group_names selecionados
  let _subAtual     = '';   // compat legada
  let _rgAtual      = '';   // compat legada
  let _dataInicio   = '';
  let _dataFim      = '';
  let _taxaBrl      = 5.70;
  let _estimativa   = null;
  let _filtroTexto  = '';
  let _iniciado     = false;

  // ── API helper ───────────────────────────────────────────────────
  function _api(method, path, body) {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(window.location.origin + '/api' + path, opts).then(r => r.json());
  }

  function _toast(msg, tipo) {
    if (typeof showToast === 'function') showToast(msg, tipo || 'success');
  }

  function _brl(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ═══════════════════════════════════════════════════════════════
  // HTML injetado DENTRO de #view-calculadora
  // ═══════════════════════════════════════════════════════════════
  function _html() {
    return `
<style>
  #view-calculadora.active { padding:0 !important; display:flex; flex-direction:column; height:100%; overflow:hidden; }
  #view-calculadora:not(.active) { display:none !important; }
  .ci,.cs { height:34px; padding:0 10px; border-radius:6px; border:1px solid var(--border-light,#2d3347); background:var(--bg,#0d0f14); color:var(--text,#e8eaf0); font-size:13px; font-family:inherit; width:100%; outline:none; transition:border-color .15s; }
  .ci:focus,.cs:focus { border-color:var(--accent,#9333ea); }
  .cs:disabled { opacity:.4; cursor:not-allowed; }
  .cl { font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--text-muted,#6b7494); margin-bottom:5px; display:block; }
  .cfg { display:flex; flex-direction:column; }
  .cbtn-imp { display:inline-flex; align-items:center; gap:7px; padding:0 16px; height:36px; border-radius:7px; border:1px solid var(--accent,#9333ea); background:rgba(147,51,234,.08); color:var(--accent,#9333ea); font-size:13px; font-weight:500; cursor:pointer; transition:background .15s; }
  .cbtn-imp:hover { background:rgba(147,51,234,.18); }
  .cbtn-sec { display:inline-flex; align-items:center; gap:5px; padding:0 11px; height:32px; border-radius:6px; border:1px solid var(--border-light,#2d3347); background:transparent; color:var(--text-dim,#9aa0be); font-size:12px; cursor:pointer; transition:all .15s; white-space:nowrap; font-family:inherit; }
  .cbtn-sec:hover { border-color:var(--accent); color:var(--accent); }
  .cbtn-go { display:inline-flex; align-items:center; gap:6px; padding:0 16px; height:34px; border-radius:6px; border:none; background:var(--accent,#9333ea); color:#ffffff; font-size:13px; font-weight:700; cursor:pointer; transition:opacity .15s; white-space:nowrap; }
  .cbtn-go:hover { opacity:.85; }
  .cchip { padding:3px 9px; border-radius:12px; border:1px solid var(--border,#222632); background:transparent; color:var(--text-muted,#6b7494); font-size:10px; cursor:pointer; transition:all .15s; font-family:inherit; }
  .cchip:hover { border-color:var(--accent); color:var(--accent); }
  .cth { padding:9px 10px; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted,#6b7494); border-bottom:1px solid var(--border,#222632); text-align:left; white-space:nowrap; }
  #ctbody tr { border-bottom:1px solid var(--border,#222632); }
  #ctbody tr:hover { background:var(--bg-hover,#1a1e28); }
  #ctbody td { padding:8px 10px; vertical-align:middle; font-size:12px; }
  .cck, .cck-grupo {
    appearance:none; -webkit-appearance:none;
    width:15px; height:15px; border-radius:4px; cursor:pointer;
    border:1.5px solid var(--border-light,#2d3347);
    background:transparent;
    transition:background .15s, border-color .15s;
    position:relative; flex-shrink:0;
    vertical-align:middle;
  }
  .cck:hover, .cck-grupo:hover { border-color:var(--accent,#9333ea); }
  .cck:checked, .cck-grupo:checked {
    background:var(--accent,#9333ea);
    border-color:var(--accent,#9333ea);
  }
  .cck:checked::after, .cck-grupo:checked::after {
    content:'';
    position:absolute; left:4px; top:1px;
    width:5px; height:9px;
    border:2px solid #fff; border-top:none; border-left:none;
    transform:rotate(45deg);
  }
  .cck:indeterminate, .cck-grupo:indeterminate {
    background:var(--accent,#9333ea);
    border-color:var(--accent,#9333ea);
  }
  .cck:indeterminate::after, .cck-grupo:indeterminate::after {
    content:'';
    position:absolute; left:2px; top:5.5px;
    width:9px; height:2px;
    background:#fff; border-radius:1px;
  }
  .choras { width:68px; height:27px; padding:0 6px; border-radius:5px; border:1px solid var(--border,#222632); background:var(--bg,#0d0f14); color:var(--text,#e8eaf0); font-size:12px; text-align:right; font-family:'IBM Plex Mono',monospace; transition:border-color .15s; }
  .choras:focus { border-color:var(--accent); outline:none; }
  .choras:disabled { opacity:.3; }
  .cbadge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:500; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:rgba(147,51,234,.08); color:var(--accent); border:1px solid rgba(147,51,234,.2); }
  #cck-all {
    appearance:none; -webkit-appearance:none;
    width:15px; height:15px; border-radius:4px; cursor:pointer;
    border:1.5px solid var(--border-light,#2d3347);
    background:transparent;
    transition:background .15s, border-color .15s;
    position:relative; vertical-align:middle;
  }
  #cck-all:hover { border-color:var(--accent,#9333ea); }
  #cck-all:checked { background:var(--accent,#9333ea); border-color:var(--accent,#9333ea); }
  #cck-all:checked::after { content:''; position:absolute; left:4px; top:1px; width:5px; height:9px; border:2px solid #fff; border-top:none; border-left:none; transform:rotate(45deg); }
  #cck-all:indeterminate { background:var(--accent,#9333ea); border-color:var(--accent,#9333ea); }
  #cck-all:indeterminate::after { content:''; position:absolute; left:2px; top:5.5px; width:9px; height:2px; background:#fff; border-radius:1px; }
  .crcard { background:var(--bg,#0d0f14); border:1px solid var(--border,#222632); border-radius:8px; padding:11px 13px; margin-bottom:8px; }
  .crcard:hover { border-color:var(--border-light); }
  .crnome { font-size:11px; font-weight:600; color:var(--text-dim,#9aa0be); margin-bottom:7px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .crrow { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; }
  .crlabel { color:var(--text-muted,#6b7494); }
  .crval { font-family:'IBM Plex Mono',monospace; color:var(--text); }
  .crbrl { font-size:1.05rem; font-weight:700; color:var(--accent); font-family:'IBM Plex Mono',monospace; }
  @keyframes _cspin { to { transform:rotate(360deg); } }
  .cspinner { width:18px; height:18px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:_cspin .7s linear infinite; display:inline-block; vertical-align:middle; }
  @keyframes _cshim { from { background-position:-600px 0; } to { background-position:600px 0; } }
  .cskel { background:linear-gradient(90deg,var(--bg-card,#13161e) 25%,var(--bg-hover,#1a1e28) 50%,var(--bg-card,#13161e) 75%); background-size:1200px 100%; animation:_cshim 1.4s infinite; border-radius:4px; height:13px; display:block; }
</style>

<!-- HEADER -->
<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
  <div>
    <div style="font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted);margin-bottom:3px;">Azure Cost Management</div>
    <h2 style="font-size:1.2rem;font-weight:700;margin:0;">Calculadora de Custo / Hora</h2>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <button onclick="Calculadora.abrirDiagnostico()" style="display:inline-flex;align-items:center;gap:6px;padding:0 13px;height:36px;border-radius:7px;border:1px solid #4da6ff44;background:rgba(77,166,255,.07);color:#4da6ff;font-size:12px;font-weight:500;cursor:pointer;transition:background .15s;" title="Inspecionar padrões dos dados importados">
      <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Diagnóstico
    </button>
    <button onclick="Calculadora.abrirPurge()" style="display:inline-flex;align-items:center;gap:6px;padding:0 13px;height:36px;border-radius:7px;border:1px solid #ff4d6a44;background:rgba(255,77,106,.07);color:#ff4d6a;font-size:12px;font-weight:500;cursor:pointer;transition:background .15s;" title="Limpar dados e re-importar">
      <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Limpar Dados
    </button>
    <label class="cbtn-imp" title="Selecione um ou vários arquivos .csv / .parquet">
      <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 2v8M5 7l3 3 3-3M2 12v2h12v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Importar Arquivos
      <input type="file" id="cfile" accept=".csv,.parquet,.zip" multiple style="display:none">
    </label>
  </div>
</div>

<!-- MODAL PURGE -->
<div id="cpurge-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:var(--bg-card,#1a1e28);border:1px solid var(--border);border-radius:12px;padding:24px;width:min(90vw,420px);box-shadow:0 20px 60px rgba(0,0,0,.5);">
    <div style="font-size:1rem;font-weight:700;margin-bottom:8px;color:var(--text);">⚠️ Limpar dados importados</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.6;">
      Isso removerá os registros do banco para permitir uma re-importação com os dados corretos.<br>
      Selecione o escopo da limpeza:
    </p>
    <div id="cpurge-arquivo-area" style="margin-bottom:16px;">
      <label class="cl">Limpar apenas o arquivo:</label>
      <select id="cpurge-sel" class="cs" style="margin-bottom:8px;">
        <option value="">— Todos os dados —</option>
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button onclick="Calculadora.fecharPurge()" class="cbtn-sec">Cancelar</button>
      <button onclick="Calculadora.executarPurge()" style="display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:34px;border-radius:6px;border:none;background:#ff4d6a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">
        🗑 Confirmar Limpeza
      </button>
    </div>
    <div id="cpurge-result" style="display:none;margin-top:12px;font-size:12px;padding:8px 12px;border-radius:6px;"></div>
  </div>
</div>

<!-- MODAL DIAGNÓSTICO -->
<div id="cdiag-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:var(--bg-card,#1a1e28);border:1px solid var(--border);border-radius:14px;width:min(96vw,900px);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.6);">
    <div style="padding:16px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--text);">🔍 Diagnóstico dos Dados</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Padrões de meter_category · consumed_service · charge_type · unit_of_measure</div>
      </div>
      <button onclick="Calculadora.fecharDiagnostico()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);width:30px;height:30px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <!-- Filtros -->
    <div style="padding:10px 22px;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-shrink:0;">
      <input id="cdiag-busca" type="text" placeholder="Filtrar por qualquer coluna..." class="ci" style="flex:1;height:32px;"
        oninput="Calculadora._diagFiltrar(this.value)">
      <select id="cdiag-charge" class="cs" style="width:180px;height:32px;" onchange="Calculadora._diagFiltrar()">
        <option value="">Todos charge_type</option>
      </select>
      <select id="cdiag-uom" class="cs" style="width:180px;height:32px;" onchange="Calculadora._diagFiltrar()">
        <option value="">Todos unit_of_measure</option>
      </select>
      <span id="cdiag-cnt" style="font-size:11px;color:var(--text-muted);align-self:center;white-space:nowrap;"></span>
    </div>
    <!-- Tabela -->
    <div style="flex:1;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead style="position:sticky;top:0;z-index:2;background:var(--bg-hover);">
          <tr>
            <th class="cth" style="min-width:140px;">meter_category</th>
            <th class="cth" style="min-width:140px;">meter_sub_category</th>
            <th class="cth" style="min-width:160px;">consumed_service</th>
            <th class="cth" style="min-width:100px;">charge_type</th>
            <th class="cth" style="min-width:110px;">unit_of_measure</th>
            <th class="cth" style="min-width:90px;">pricing_model</th>
            <th class="cth" style="min-width:90px;">publisher_type</th>
            <th class="cth" style="text-align:right;min-width:60px;">recursos</th>
            <th class="cth" style="text-align:right;min-width:80px;">linhas</th>
            <th class="cth" style="text-align:right;min-width:110px;">total billing</th>
          </tr>
        </thead>
        <tbody id="cdiag-tbody">
          <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);">Carregando...</td></tr>
        </tbody>
      </table>
    </div>
    <div style="padding:10px 22px;border-top:1px solid var(--border);font-size:10px;color:var(--text-muted);flex-shrink:0;">
      💡 Use estes padrões para identificar quais <strong>meter_category</strong>, <strong>consumed_service</strong> ou <strong>charge_type</strong> representam SaaS nos seus dados.
    </div>
  </div>
</div>

<!-- PAINEL DE IMPORTAÇÃO MULTI-ARQUIVO -->
<div id="cimport-panel" style="display:none;padding:12px 24px;background:var(--bg-card);border-bottom:1px solid var(--border);flex-shrink:0;">

  <!-- Barra geral -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
    <span id="cimport-title" style="font-size:12px;font-weight:600;color:var(--text);">Importando...</span>
    <span id="cimport-geral-pct" style="font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--accent);">0 / 0</span>
  </div>
  <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:10px;">
    <div id="cimport-geral-fill" style="height:100%;width:0%;background:var(--accent);transition:width .3s;border-radius:2px;"></div>
  </div>

  <!-- Lista de arquivos -->
  <div id="cimport-list" style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;scrollbar-width:thin;"></div>

  <!-- Resumo final -->
  <div id="cimport-resumo" style="display:none;margin-top:10px;padding:8px 12px;border-radius:7px;background:rgba(147,51,234,.07);border:1px solid rgba(147,51,234,.2);font-size:12px;color:var(--text-dim);line-height:1.7;"></div>
</div>

<!-- mantido por compatibilidade com código legado -->
<div id="cibar" style="display:none"></div>
<div id="cires" style="display:none"></div>

<!-- FILTROS -->
<div style="display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:10px;align-items:end;padding:13px 24px;background:var(--bg-card);border-bottom:1px solid var(--border);flex-shrink:0;">

  <!-- Multiselect Assinaturas -->
  <div class="cfg">
    <label class="cl">Assinatura <span id="csub-badge" style="display:none;background:var(--accent);color:#0d0f14;border-radius:8px;padding:0 5px;font-size:9px;font-weight:700;margin-left:4px;"></span></label>
    <div class="cms-wrap" id="csub-wrap">
      <div class="cms-trigger" id="csub-trigger" onclick="Calculadora._toggleDropdown('csub')">
        <span id="csub-label" style="color:var(--text-muted);font-size:13px;">— selecione —</span>
        <svg viewBox="0 0 10 6" fill="none" width="10" style="flex-shrink:0;margin-left:auto;"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>
      <div class="cms-dropdown" id="csub-dropdown" style="display:none;">
        <div class="cms-search-wrap"><input class="cms-search" id="csub-search" placeholder="Buscar..." oninput="Calculadora._filtrarDropdown('csub',this.value)"></div>
        <div class="cms-options" id="csub-options"><div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Carregando...</div></div>
        <div class="cms-footer">
          <button class="cms-btn" onclick="Calculadora._selecionarTodosDropdown('csub')">Todos</button>
          <button class="cms-btn" onclick="Calculadora._limparDropdown('csub')">Limpar</button>
          <button class="cms-btn cms-btn-ok" onclick="Calculadora._confirmarSub()">OK ✓</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Multiselect Resource Groups -->
  <div class="cfg">
    <label class="cl">Resource Group <span id="crg-badge" style="display:none;background:var(--accent);color:#0d0f14;border-radius:8px;padding:0 5px;font-size:9px;font-weight:700;margin-left:4px;"></span></label>
    <div class="cms-wrap" id="crg-wrap">
      <div class="cms-trigger cms-disabled" id="crg-trigger" onclick="Calculadora._toggleDropdown('crg')">
        <span id="crg-label" style="color:var(--text-muted);font-size:13px;">— selecione a assinatura —</span>
        <svg viewBox="0 0 10 6" fill="none" width="10" style="flex-shrink:0;margin-left:auto;"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>
      <div class="cms-dropdown" id="crg-dropdown" style="display:none;">
        <div class="cms-search-wrap"><input class="cms-search" id="crg-search" placeholder="Buscar..." oninput="Calculadora._filtrarDropdown('crg',this.value)"></div>
        <div class="cms-options" id="crg-options"></div>
        <div class="cms-footer">
          <button class="cms-btn" onclick="Calculadora._selecionarTodosDropdown('crg')">Todos</button>
          <button class="cms-btn" onclick="Calculadora._limparDropdown('crg')">Limpar</button>
          <button class="cms-btn cms-btn-ok" onclick="Calculadora._confirmarRg()">OK ✓</button>
        </div>
      </div>
    </div>
  </div>

  <div class="cfg"><button class="cbtn-go" onclick="Calculadora.buscarRecursos()" style="height:34px;padding:0 14px;">
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    Buscar
  </button></div>
</div>

<!-- CSS MULTISELECT -->
<style>
  .cms-wrap { position:relative; }
  .cms-trigger {
    display:flex; align-items:center; gap:6px;
    height:34px; padding:0 10px; border-radius:6px;
    border:1px solid var(--border-light,#2d3347);
    background:var(--bg,#0d0f14); cursor:pointer;
    transition:border-color .15s; user-select:none;
  }
  .cms-trigger:not(.cms-disabled):hover { border-color:var(--accent,#9333ea); }
  .cms-trigger.cms-disabled { opacity:.45; cursor:not-allowed; pointer-events:none; }
  .cms-trigger.cms-active { border-color:var(--accent,#9333ea); }
  .cms-dropdown {
    position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:500;
    background:var(--bg-card,#1a1e28); border:1px solid var(--border-light,#2d3347);
    border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,.5);
    min-width:260px; max-width:420px;
  }
  .cms-search-wrap { padding:8px 8px 4px; }
  .cms-search {
    width:100%; height:28px; padding:0 8px; border-radius:5px;
    border:1px solid var(--border,#222632); background:var(--bg,#0d0f14);
    color:var(--text,#e8eaf0); font-size:12px; outline:none;
    transition:border-color .15s;
  }
  .cms-search:focus { border-color:var(--accent); }
  .cms-options { max-height:180px; overflow-y:auto; padding:4px 0; }
  .cms-option {
    display:flex; align-items:center; gap:8px;
    padding:6px 12px; cursor:pointer; font-size:12px;
    transition:background .1s;
  }
  .cms-option:hover { background:var(--bg-hover,#1a1e28); }
  .cms-option input[type=checkbox] { accent-color:var(--accent); width:14px; height:14px; flex-shrink:0; cursor:pointer; }
  .cms-option-label { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cms-option-sub { font-size:10px; color:var(--text-muted); }
  .cms-footer {
    display:flex; gap:4px; padding:6px 8px;
    border-top:1px solid var(--border,#222632);
  }
  .cms-btn {
    flex:1; height:26px; border-radius:5px;
    border:1px solid var(--border,#222632);
    background:transparent; color:var(--text-muted,#6b7494);
    font-size:11px; cursor:pointer; font-family:inherit;
    transition:all .15s;
  }
  .cms-btn:hover { border-color:var(--border-light); color:var(--text); }
  .cms-btn-ok {
    background:var(--accent,#9333ea); color:#ffffff;
    border-color:var(--accent); font-weight:700;
  }
  .cms-btn-ok:hover { opacity:.85; }
  .cms-options::-webkit-scrollbar { width:4px; }
  .cms-options::-webkit-scrollbar-track { background:transparent; }
  .cms-options::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
</style>

<!-- CORPO -->
<div style="display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;">

  <!-- Tabela -->
  <div style="display:flex;flex-direction:column;overflow:hidden;flex:1;">
    <div style="padding:9px 13px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0;">
      <div style="position:relative;flex:1;max-width:340px;">
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none;"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input id="cbusca" type="text" class="ci" placeholder="Filtrar recursos..." style="padding-left:28px;" oninput="Calculadora.onBusca(this.value)">
      </div>
      <span id="ccnt" style="font-size:11px;color:var(--text-muted);white-space:nowrap;">0 recursos</span>
      <button class="cbtn-sec" onclick="Calculadora.selecionarTodos()">Sel. todos</button>
      <button class="cbtn-sec" onclick="Calculadora.deselecionarTodos()">Limpar</button>
      <div style="flex:1;"></div>
      <button id="cbtn-estimar" onclick="Calculadora._abrirConfigStep()" disabled
        style="display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:32px;border-radius:6px;border:none;background:var(--border);color:var(--text-muted);font-size:12px;font-weight:700;cursor:not-allowed;opacity:.5;transition:all .2s;white-space:nowrap;flex-shrink:0;">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Estimar
      </button>
    </div>
    <div style="flex:1;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead style="position:sticky;top:0;z-index:2;background:var(--bg-card);">
          <tr>
            <th style="width:32px;padding:9px 6px;border-bottom:1px solid var(--border);">
              <input type="checkbox" id="cck-all" title="Selecionar todos" onchange="Calculadora._checkAll(this.checked)">
            </th>
            <th class="cth">Recurso / Produto</th>
            <th class="cth">Resource Group</th>
            <th class="cth">Meter Category</th>
            <th class="cth">Consumed Service</th>
            <th class="cth">Charge Type</th>
            <th class="cth">Unit of Measure</th>
            <th class="cth">Pricing Model</th>
            <th class="cth" style="text-align:right;">Consumed Quantity</th>
            <th class="cth">Unit of Measure</th>
            <th class="cth" style="text-align:right;">Custo/Hora</th>
            <th class="cth" style="text-align:right;">Total Cobrado (BRL)</th>
          </tr>
        </thead>
        <tbody id="ctbody">
        <tr><td colspan="12" style="text-align:center;padding:50px 20px;color:var(--text-muted);font-size:13px;">
            Selecione uma <strong style="color:var(--text);">Assinatura</strong>, confirme com <strong style="color:var(--accent);">OK ✓</strong> e clique em <strong style="color:var(--accent);">Buscar</strong>.
          </td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- painel direito removido — conteúdo movido para covmodal -->

<!-- ═══ MODAL INVOICE ════════════════════════════════════════════ -->
<div id="cinv-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9998;align-items:center;justify-content:center;">
  <div style="background:var(--bg-card,#1a1e28);border:1px solid var(--border);border-radius:14px;width:min(96vw,680px);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.6);">

    <!-- Header modal -->
    <div style="padding:18px 22px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);">Azure Cost Management</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-top:2px;">Gerar Estimativa</div>
      </div>
      <button onclick="Calculadora.fecharInvoice()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);width:30px;height:30px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>

    <!-- Corpo modal -->
    <div style="padding:18px 22px;overflow-y:auto;flex:1;">

      <!-- Seleção do projeto -->
      <div style="margin-bottom:16px;">
        <label class="cl">Projeto *</label>
        <select id="cinv-projeto" class="cs" style="background:var(--bg);">
          <option value="">Carregando projetos...</option>
        </select>
        <div id="cinv-projeto-info" style="margin-top:6px;padding:8px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--border);font-size:11px;color:var(--text-muted);display:none;"></div>
      </div>

      <!-- Campos da invoice -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label class="cl">Título da Estimativa</label>
          <input type="text" id="cinv-titulo" class="ci" placeholder="Ex: Estimativa Abril 2026">
        </div>
        <div>
          <label class="cl">Data da Estimativa</label>
          <input type="date" id="cinv-data" class="ci">
        </div>
        <div>
          <label class="cl">Responsável</label>
          <input type="text" id="cinv-resp" class="ci" placeholder="Nome do responsável">
        </div>
        <div>
          <label class="cl">Validade (dias)</label>
          <input type="number" id="cinv-validade" class="ci" value="30" min="1">
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label class="cl">Observações</label>
        <textarea id="cinv-obs" class="ci" rows="2" style="height:60px;padding:8px 10px;resize:none;" placeholder="Observações opcionais..."></textarea>
      </div>

      <!-- Preview resumo -->
      <div id="cinv-preview" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">
        <div style="font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Prévia da Estimativa</div>
        <div id="cinv-preview-body" style="font-size:12px;color:var(--text-dim);"></div>
      </div>
    </div>

    <!-- Footer modal -->
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">
      <button onclick="Calculadora.fecharInvoice()" class="cbtn-sec">Cancelar</button>
      <button onclick="Calculadora.gerarInvoicePDF()" class="cbtn-go" style="gap:6px;">
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 1h10v14H3V1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5h4M6 7.5h4M6 10h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="11.5" cy="11.5" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 11.5h2M11.5 10.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Visualizar Estimativa
      </button>
    </div>
  </div>
</div>

<!-- Preview — document viewer screen -->
<div id="cinv-preview-modal" style="display:none;position:fixed;inset:0;z-index:9999;flex-direction:column;background:radial-gradient(ellipse at 30% 40%,rgba(80,0,140,.45) 0%,transparent 60%),linear-gradient(160deg,#1a0030 0%,#0c0014 55%,#04000c 100%);">

  <!-- Toolbar -->
  <div style="display:flex;align-items:center;gap:10px;padding:11px 20px;background:rgba(14,2,26,.88);border-bottom:1px solid rgba(147,51,234,.22);flex-shrink:0;backdrop-filter:blur(16px);">
    <button onclick="Calculadora.voltarParaConfirmacao()" class="cbtn-sec" style="gap:6px;flex-shrink:0;">
      <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Editar Dados
    </button>
    <div style="flex:1;min-width:0;text-align:center;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#7b6a9e;margin-bottom:1px;">Prévia da Estimativa</div>
      <div id="cinv-preview-title" style="font-size:13px;font-weight:600;color:#c084fc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
    </div>
    <button onclick="Calculadora.imprimirEstimativa()" class="cbtn-go" style="gap:6px;flex-shrink:0;">
      <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M4 6V2h8v4M4 11H2V6h12v5h-2M4 11v3h8v-3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      Imprimir / Salvar PDF
    </button>
    <button onclick="Calculadora.fecharPreviewModal()" title="Fechar" style="background:rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.25);color:#ff4d6a;cursor:pointer;padding:5px 9px;font-size:15px;line-height:1;border-radius:7px;transition:background .15s;" onmouseover="this.style.background='rgba(255,77,106,.18)'" onmouseout="this.style.background='rgba(255,77,106,.08)'">&#10005;</button>
  </div>

  <!-- Document area — scrollable, centered -->
  <div style="flex:1;overflow-y:auto;padding:32px 20px 48px;display:flex;flex-direction:column;align-items:center;">
    <!-- Glow halo behind the document -->
    <div style="position:relative;width:100%;max-width:900px;">
      <div style="position:absolute;inset:-18px;background:radial-gradient(ellipse,rgba(147,51,234,.18) 0%,transparent 70%);border-radius:24px;pointer-events:none;"></div>
      <iframe id="cinv-preview-frame"
        style="position:relative;width:100%;min-height:80vh;border:none;border-radius:12px;box-shadow:0 8px 48px rgba(0,0,0,.7),0 0 0 1px rgba(147,51,234,.2);background:#fff;display:block;">
      </iframe>
    </div>
    <!-- Bottom hint -->
    <div style="margin-top:18px;font-size:11px;color:#4a3a6a;text-align:center;letter-spacing:.05em;">
      Use <strong style="color:#7b6a9e;">Imprimir / Salvar PDF</strong> para exportar &nbsp;·&nbsp; Pressione <strong style="color:#7b6a9e;">Ctrl+P</strong> para imprimir direto
    </div>
  </div>

</div>

<!-- ═══ CONFIG STEP — modal centralizado de estimativa ════════════ -->
<div id="covmodal" style="display:none;position:fixed;inset:0;z-index:9990;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);">

  <!-- Modal card -->
  <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.55);width:min(1080px,96vw);height:min(720px,90vh);display:flex;flex-direction:column;overflow:hidden;">

    <!-- Header -->
    <div style="display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <svg viewBox="0 0 16 16" fill="none" width="16" height="16" style="color:var(--accent);flex-shrink:0;"><path d="M3 1h10v14H3V1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5h4M6 7.5h4M6 10h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.2;">Configurar Estimativa</div>
          <div id="cov-cnt" style="font-size:11px;color:var(--text-muted);margin-top:1px;"></div>
        </div>
      </div>
      <button onclick="Calculadora._fecharConfigStep()"
        style="width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s;"
        onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">✕</button>
    </div>

    <!-- Body: two-column with independent scroll -->
    <div style="flex:1;display:grid;grid-template-columns:1fr 340px;min-height:0;overflow:hidden;">

      <!-- LEFT: resource cards + hidden compat IDs -->
      <div style="overflow-y:auto;padding:20px;border-right:1px solid var(--border);">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">
          Recursos Selecionados &nbsp;<span id="cselcnt" style="color:var(--accent);font-weight:600;font-size:11px;text-transform:none;letter-spacing:0;"></span>
        </div>
        <div id="cov-recursos" style="display:flex;flex-direction:column;gap:10px;"></div>
        <!-- hidden compat: _atualizarEstimativa escreve aqui (não precisa ser visível) -->
        <div style="display:none;" aria-hidden="true">
          <div id="cresarea"><div id="cresumo-vazio"></div><div id="cresumo-lista"></div></div>
          <div id="crodape">
            <span id="ctotal-sub"></span>
            <div id="ctotal-imposto-row"><span id="ctotal-imposto-label"></span><span id="ctotal-imposto-val"></span></div>
            <div id="ctotal-cond-row"><span id="ctotal-cond-label"></span><span id="ctotal-cond-val"></span></div>
            <span id="ctotal"></span>
          </div>
          <span id="ctotal-cobrado"></span>
          <span id="ctaxas-info"></span>
          <span id="cimposto-padrao-badge"></span>
          <span id="ccond-padrao-badge"></span>
        </div>
      </div>

      <!-- RIGHT: configuração (scroll independente) -->
      <div style="overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;">

        <!-- Card: Horas / Período -->
        <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:12px;padding:16px;flex-shrink:0;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:10px;">Período de Estimativa</div>

          <!-- Abas -->
          <div style="display:flex;gap:4px;margin-bottom:12px;">
            <button id="ctab-horas" onclick="Calculadora._setModoHoras('manual')"
              style="flex:1;height:28px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.04em;">
              HORAS
            </button>
            <button id="ctab-periodo" onclick="Calculadora._setModoHoras('periodo')"
              style="flex:1;height:28px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.04em;">
              PERÍODO
            </button>
          </div>

          <!-- Painel horas manual -->
          <div id="cpainel-horas">
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="number" id="chglobal" class="ci" value="720" min="1" max="99999" step="1"
                style="flex:1;height:38px;font-size:20px;font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:700;"
                oninput="Calculadora._onHorasInput(this.value)">
              <span style="font-size:13px;color:var(--text-muted);flex-shrink:0;">horas</span>
              <button class="cbtn-sec" onclick="Calculadora.aplicarHorasGlobal()" style="height:38px;padding:0 12px;flex-shrink:0;">Aplicar</button>
            </div>
          </div>

          <!-- Painel período de datas -->
          <div id="cpainel-periodo" style="display:none;">
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px;">
              <div style="display:grid;grid-template-columns:38px 1fr 90px;gap:3px;align-items:center;">
                <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Início</span>
                <input type="date" id="cperiodo-ini-data" class="ci" style="height:30px;font-size:12px;padding:0 5px;min-width:0;" onchange="Calculadora._sincDataFim()">
                <input type="time" id="cperiodo-ini-hora" class="ci" step="3600" style="height:30px;font-size:12px;padding:0 4px;min-width:0;" onchange="Calculadora._calcHorasPeriodo()">
              </div>
              <div style="display:grid;grid-template-columns:38px 1fr 90px;gap:3px;align-items:center;">
                <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Fim</span>
                <input type="date" id="cperiodo-fim-data" class="ci" style="height:30px;font-size:12px;padding:0 5px;min-width:0;" onchange="Calculadora._calcHorasPeriodo()">
                <input type="time" id="cperiodo-fim-hora" class="ci" step="3600" style="height:30px;font-size:12px;padding:0 4px;min-width:0;" onchange="Calculadora._calcHorasPeriodo()">
              </div>
            </div>
            <div id="cperiodo-res" style="font-size:11px;color:var(--accent);text-align:right;min-height:14px;font-family:IBM Plex Mono,monospace;margin-bottom:6px;"></div>
            <button id="cbtn-incluir" onclick="Calculadora._incluirPeriodo()" disabled
              style="width:100%;height:30px;border-radius:6px;border:1px solid var(--border);background:rgba(100,100,100,.08);color:var(--text-muted);font-size:11px;font-weight:700;cursor:not-allowed;letter-spacing:.04em;opacity:.5;transition:all .2s;">
              + Incluir na Estimativa
            </button>
            <div id="cperiodo-lista" style="margin-top:8px;display:flex;flex-direction:column;gap:3px;"></div>
            <div id="cperiodo-total" style="display:none;margin-top:6px;padding:5px 8px;border-radius:6px;background:var(--accent-dim);border:1px solid var(--border-light);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Total períodos</span>
                <span id="cperiodo-total-val" style="font-size:13px;font-weight:700;color:var(--accent);font-family:IBM Plex Mono,monospace;"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Card: Taxas -->
        <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:12px;padding:16px;flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);">Taxas Adicionais</div>
            <div style="display:flex;gap:4px;">
              <button onclick="Calculadora._salvarTaxasPadrao()" title="Salvar como padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:700;cursor:pointer;">★ Padrão</button>
              <button onclick="Calculadora._resetarTaxas()" title="Restaurar padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:600;cursor:pointer;">↺</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <div style="font-size:11px;color:var(--text-dim);font-weight:600;margin-bottom:5px;">Imposto</div>
              <div style="display:flex;align-items:center;gap:4px;">
                <input type="number" id="cimposto" class="ci" value="0" min="0" max="100" step="0.01"
                  style="width:100%;height:36px;font-size:16px;font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:600;"
                  oninput="Calculadora._onAdicionaisChange()">
                <span style="font-size:13px;color:var(--text-muted);flex-shrink:0;">%</span>
              </div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);font-weight:600;margin-bottom:5px;">Condomínio</div>
              <div style="display:flex;align-items:center;gap:4px;">
                <input type="number" id="ccondominио" class="ci" value="0" min="0" max="100" step="0.01"
                  style="width:100%;height:36px;font-size:16px;font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:600;"
                  oninput="Calculadora._onAdicionaisChange()">
                <span style="font-size:13px;color:var(--text-muted);flex-shrink:0;">%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Card: Totais (cov-*: atualizados por _ovAtualizarTotal) -->
        <div style="background:var(--bg-hover);border:1px solid var(--border-light);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:7px;flex-shrink:0;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);">
            <span>Subtotal</span>
            <span id="cov-sub" style="font-family:'IBM Plex Mono',monospace;">R$ 0,00</span>
          </div>
          <div id="cov-row-imp" style="display:none;justify-content:space-between;font-size:12px;color:var(--text-muted);">
            <span id="cov-lbl-imp">+ Imposto (0%)</span>
            <span id="cov-vl-imp" style="font-family:'IBM Plex Mono',monospace;">R$ 0,00</span>
          </div>
          <div id="cov-row-cond" style="display:none;justify-content:space-between;font-size:12px;color:var(--text-muted);">
            <span id="cov-lbl-cond">+ Condomínio (0%)</span>
            <span id="cov-vl-cond" style="font-family:'IBM Plex Mono',monospace;">R$ 0,00</span>
          </div>
          <div style="border-top:1px solid var(--border-light);margin-top:2px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-dim);font-weight:700;">Total Estimado</span>
            <span id="cov-total" style="font-family:'IBM Plex Mono',monospace;font-size:1.5rem;font-weight:700;color:var(--accent);">R$ 0,00</span>
          </div>
        </div>

      </div><!-- /RIGHT -->
    </div><!-- /body grid -->

    <!-- Footer -->
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--border);flex-shrink:0;">
      <button onclick="Calculadora._fecharConfigStep()" class="cbtn-sec">Fechar</button>
      <button onclick="Calculadora.abrirInvoice()" class="cbtn-go" style="gap:6px;">
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 1h10v14H3V1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5h4M6 7.5h4M6 10h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="11.5" cy="11.5" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 11.5h2M11.5 10.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Visualizar Estimativa
      </button>
    </div>

  </div><!-- /modal card -->
</div><!-- /covmodal -->

</div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // init — chamado pelo showView('calculadora')
  // ═══════════════════════════════════════════════════════════════
  function init() {
    const view = document.getElementById('view-calculadora');
    if (!view) { console.error('Calculadora: #view-calculadora não encontrada'); return; }

    if (!_iniciado) {
      view.innerHTML = _html();
      _iniciado = true;
      _setupImport();
      _setupDateListeners();
      _setupClickFora();  // fecha dropdowns ao clicar fora
      _carregarTaxas();   // carrega taxas salvas (padrão: 18,65% e 13%)
    }

    _carregarSubscriptions();
  }

  function _setupDateListeners() { /* removido — datas calculadas automaticamente em buscarRecursos() */ }

  // ── Importação ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  // Importação multi-arquivo — fila sequencial com painel de progresso
  // ══════════════════════════════════════════════════════════════════
  function _setupImport() {
    const inp = document.getElementById('cfile');
    if (!inp) return;

    inp.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      inp.value = ''; // permite re-selecionar os mesmos arquivos
      if (!files.length) return;

      // Validar extensões
      const invalid = files.filter(f => {
        const n = f.name.toLowerCase();
        return !n.endsWith('.csv') && !n.endsWith('.parquet') && !n.endsWith('.zip');
      });
      if (invalid.length) {
        _toast(`${invalid.length} arquivo(s) ignorado(s): apenas .csv, .parquet e .zip são aceitos.`, 'error');
      }
      const validos = files.filter(f => {
        const n = f.name.toLowerCase();
        return n.endsWith('.csv') || n.endsWith('.parquet') || n.endsWith('.zip');
      });
      if (!validos.length) return;

      // ── Exibir painel de importação ──────────────────────────────
      const panel    = document.getElementById('cimport-panel');
      const title    = document.getElementById('cimport-title');
      const geralPct = document.getElementById('cimport-geral-pct');
      const geralFill= document.getElementById('cimport-geral-fill');
      const list     = document.getElementById('cimport-list');
      const resumo   = document.getElementById('cimport-resumo');

      panel.style.display   = 'block';
      resumo.style.display  = 'none';
      list.innerHTML        = '';
      geralFill.style.width = '0%';
      geralPct.textContent  = `0 / ${validos.length}`;
      title.style.color     = 'var(--text)';
      title.textContent     = `Importando ${validos.length} arquivo${validos.length > 1 ? 's' : ''}...`;

      // ── Criar card para cada arquivo ─────────────────────────────
      const cards = validos.map((f, i) => {
        const id  = 'cfile_item_' + i;
        const mb  = (f.size / 1024 / 1024).toFixed(1);
        const div = document.createElement('div');
        div.id    = id;
        div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--bg-hover);border:1px solid var(--border);transition:border-color .2s,background .2s;';
        div.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${_esc(f.name)}">${_esc(f.name)}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:1px;">${mb} MB</div>
          </div>
          <div style="width:120px;flex-shrink:0;">
            <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;">
              <div id="${id}-fill" style="height:100%;width:0%;background:var(--accent);transition:width .3s;border-radius:2px;"></div>
            </div>
          </div>
          <div id="${id}-status" style="font-size:11px;font-family:'IBM Plex Mono',monospace;color:var(--text-muted);width:70px;text-align:right;flex-shrink:0;">aguardando</div>
        `;
        list.appendChild(div);
        return { file: f, id };
      });

      // Scroll automático para o painel
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // ── Fila sequencial ──────────────────────────────────────────
      let totalLinhas    = 0;
      let totalInseridos = 0;
      let totalErros     = 0;
      let concluidos     = 0;
      let falhas         = 0;

      for (let i = 0; i < cards.length; i++) {
        const { file, id } = cards[i];
        const fill   = document.getElementById(id + '-fill');
        const status = document.getElementById(id + '-status');
        const card   = document.getElementById(id);

        // Marca como "enviando"
        status.textContent    = 'enviando…';
        status.style.color    = 'var(--accent)';
        card.style.borderColor= 'rgba(147,51,234,.4)';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Animação de progresso simulada enquanto o servidor processa
        let pct = 0;
        const tick = setInterval(() => {
          if (pct < 88) {
            pct += Math.random() * 3 + 0.5;
            fill.style.width = Math.min(pct, 88) + '%';
          }
        }, 400);

        try {
          const fd    = new FormData();
          fd.append('arquivo', file);
          const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';

          const r = await fetch(window.location.origin + '/api/azure-costs/import', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd,
          });

          clearInterval(tick);
          fill.style.width = '100%';

          if (r.status === 401) {
            clearInterval(tick);
            sessionStorage.removeItem('finops_token');
            sessionStorage.removeItem('finops_session');
            localStorage.removeItem('finops_token');
            localStorage.removeItem('finops_session');
            status.textContent = 'sessão expirada';
            status.style.color = '#ffaa00';
            const expMsg = document.createElement('div');
            expMsg.style.cssText = 'font-size:10px;color:#ffaa00;padding:2px 10px 5px;';
            expMsg.textContent = '↳ Sessão expirada. Redirecionando para o login…';
            card.parentNode.insertBefore(expMsg, card.nextSibling);
            setTimeout(() => window.location.reload(), 2000);
            return;
          }

          const data = await r.json();

          if (!r.ok) {
            status.textContent    = 'erro ✗';
            status.style.color    = '#ff4d6a';
            card.style.borderColor= 'rgba(255,77,106,.4)';
            card.style.background = 'rgba(255,77,106,.04)';
            fill.style.background = '#ff4d6a';
            // Linha de detalhe do erro abaixo do card
            const errMsg = document.createElement('div');
            errMsg.style.cssText = 'font-size:10px;color:#ff4d6a;padding:2px 10px 5px;';
            errMsg.textContent   = '↳ ' + (data.error || 'Erro desconhecido');
            card.parentNode.insertBefore(errMsg, card.nextSibling);
            falhas++;
          } else {
            totalLinhas    += data.total     || 0;
            totalInseridos += data.inseridos || 0;
            totalErros     += data.erros     || 0;
            status.textContent    = `✓ ${(data.inseridos||0).toLocaleString('pt-BR')}`;
            status.style.color    = 'var(--accent)';
            card.style.borderColor= 'rgba(147,51,234,.25)';
            card.style.background = 'rgba(147,51,234,.04)';
            concluidos++;
          }
        } catch (err) {
          clearInterval(tick);
          fill.style.width  = '100%';
          fill.style.background = '#ff4d6a';
          status.textContent    = 'erro ✗';
          status.style.color    = '#ff4d6a';
          card.style.borderColor= 'rgba(255,77,106,.4)';
          card.style.background = 'rgba(255,77,106,.04)';
          const errMsg = document.createElement('div');
          errMsg.style.cssText = 'font-size:10px;color:#ff4d6a;padding:2px 10px 5px;';
          errMsg.textContent   = '↳ ' + err.message;
          card.parentNode.insertBefore(errMsg, card.nextSibling);
          falhas++;
        }

        // Atualiza barra geral
        const feitos = i + 1;
        geralFill.style.width = Math.round((feitos / cards.length) * 100) + '%';
        geralPct.textContent  = `${feitos} / ${cards.length}`;
      }

      // ── Resumo final ─────────────────────────────────────────────
      const tudoOk = falhas === 0;
      title.textContent = tudoOk
        ? `✅ Importação concluída — ${cards.length} arquivo${cards.length > 1 ? 's' : ''} processado${cards.length > 1 ? 's' : ''}`
        : `⚠️ ${concluidos} arquivo${concluidos !== 1 ? 's' : ''} ok, ${falhas} com erro`;
      title.style.color = tudoOk ? 'var(--accent)' : '#f9e2af';

      resumo.style.display = 'block';
      resumo.innerHTML = `
        <strong style="color:var(--text);">Resumo da carga</strong><br>
        📁 Arquivos: <strong>${concluidos}</strong> importados${falhas ? ` · <span style="color:#ff4d6a">${falhas} com erro</span>` : ''}<br>
        📊 Linhas lidas: <strong>${totalLinhas.toLocaleString('pt-BR')}</strong><br>
        ✅ Registros novos: <strong style="color:var(--accent)">${totalInseridos.toLocaleString('pt-BR')}</strong><br>
        ⚠️ Ignorados / duplicados: <strong>${totalErros.toLocaleString('pt-BR')}</strong>
      `;

      if (concluidos > 0) {
        _carregarSubscriptions();
        if (tudoOk) {
          _toast(`✅ ${concluidos} arquivo(s) — ${totalInseridos.toLocaleString('pt-BR')} registros inseridos.`, 'success');
        } else {
          _toast(`⚠️ ${concluidos} ok · ${falhas} com erro. Verifique o painel.`, 'error');
        }
      }
    });
  }

  // ── Subscriptions ────────────────────────────────────────────────
  // ── Multiselect state ────────────────────────────────────────────
  const _dds = {
    csub: { data: [], selected: new Set(), filtered: [] },
    crg:  { data: [], selected: new Set(), filtered: [] },
  };

  function _toggleDropdown(id) {
    const dd = document.getElementById(id+'-dropdown');
    const tr = document.getElementById(id+'-trigger');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    ['csub','crg'].forEach(k => {
      const d = document.getElementById(k+'-dropdown');
      const t = document.getElementById(k+'-trigger');
      if (d) d.style.display = 'none';
      if (t) t.classList.remove('cms-active');
    });
    if (!isOpen) { dd.style.display = 'block'; tr.classList.add('cms-active'); document.getElementById(id+'-search')?.focus(); }
  }

  function _setupClickFora() {
    document.addEventListener('click', e => {
      ['csub','crg'].forEach(id => {
        const wrap = document.getElementById(id+'-wrap');
        const dd   = document.getElementById(id+'-dropdown');
        if (dd && dd.style.display !== 'none' && !wrap?.contains(e.target)) {
          dd.style.display = 'none';
          document.getElementById(id+'-trigger')?.classList.remove('cms-active');
        }
      });
    }, true);
  }

  function _renderOpcoes(id, filtro) {
    const state = _dds[id]; filtro = filtro || '';
    const opts  = document.getElementById(id+'-options'); if (!opts) return;
    const lista = filtro ? state.data.filter(d => d.label.toLowerCase().includes(filtro.toLowerCase())) : state.data;
    state.filtered = lista;
    if (!lista.length) { opts.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">${state.data.length?'Nenhum resultado.':'Nenhum item.'}</div>`; return; }
    opts.innerHTML = lista.map(d => `<label class="cms-option"><input type="checkbox" ${state.selected.has(d.value)?'checked':''} onchange="Calculadora._toggleOpcao('${id}','${_esc(d.value)}',this.checked)"><span class="cms-option-label" title="${_esc(d.label)}">${_esc(d.label)}</span>${d.sub?`<span class="cms-option-sub">${_esc(d.sub)}</span>`:''}</label>`).join('');
  }

  function _toggleOpcao(id, value, checked) {
    if (checked) _dds[id].selected.add(value); else _dds[id].selected.delete(value);
    _atualizarBadge(id);
  }

  function _filtrarDropdown(id, valor) { _renderOpcoes(id, valor); }

  function _selecionarTodosDropdown(id) {
    (_dds[id].filtered.length ? _dds[id].filtered : _dds[id].data).forEach(d => _dds[id].selected.add(d.value));
    _renderOpcoes(id, document.getElementById(id+'-search')?.value||''); _atualizarBadge(id);
  }

  function _limparDropdown(id) {
    _dds[id].selected.clear();
    _renderOpcoes(id, document.getElementById(id+'-search')?.value||''); _atualizarBadge(id);
  }

  function _atualizarBadge(id) {
    const n = _dds[id].selected.size;
    const badge = document.getElementById(id+'-badge');
    const label = document.getElementById(id+'-label');
    if (badge) { badge.style.display = n ? 'inline' : 'none'; badge.textContent = n; }
    if (label) {
      if (!n) { label.style.color='var(--text-muted)'; label.textContent='— selecione —'; }
      else if (n===1) { const d=_dds[id].data.find(x=>x.value===([..._dds[id].selected][0])); label.style.color='var(--text)'; label.textContent=d?d.labelShort||d.label:[..._dds[id].selected][0]; }
      else { label.style.color='var(--text)'; label.textContent=n+' selecionados'; }
    }
  }

  async function _confirmarSub() {
    _subsSel  = [..._dds.csub.selected]; _subAtual = _subsSel[0]||'';
    document.getElementById('csub-dropdown').style.display='none';
    document.getElementById('csub-trigger').classList.remove('cms-active');
    _dds.crg.data=[]; _dds.crg.selected.clear(); _dds.crg.filtered=[];
    _rgsSel=[]; _rgAtual=''; _atualizarBadge('crg');
    document.getElementById('crg-label').textContent='— selecione —';
    document.getElementById('crg-label').style.color='var(--text-muted)';
    _recursos=[]; _selecionados={}; _renderRecursos(); _resetRes();
    if (!_subsSel.length) { document.getElementById('crg-trigger').classList.add('cms-disabled'); return; }
    document.getElementById('crg-trigger').classList.remove('cms-disabled');
    document.getElementById('crg-options').innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Carregando...</div>';
    try {
      const data = await _api('GET', `/calculadora/resource-groups?subscription_id=${_subsSel.map(encodeURIComponent).join(',')}`);
      if (!Array.isArray(data)||!data.length) { document.getElementById('crg-options').innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Nenhum RG encontrado.</div>'; return; }
      _dds.crg.data = data.map(r => ({ value:r.resource_group_name, label:r.resource_group_name, labelShort:r.resource_group_name, sub:'' }));
      _renderOpcoes('crg');
    } catch(err) { document.getElementById('crg-options').innerHTML=`<div style="padding:8px 12px;font-size:12px;color:#ff4d6a;">Erro: ${_esc(err.message)}</div>`; }
  }

  async function _confirmarRg() {
    _rgsSel=[..._dds.crg.selected]; _rgAtual=_rgsSel[0]||'';
    document.getElementById('crg-dropdown').style.display='none';
    document.getElementById('crg-trigger').classList.remove('cms-active');
    _atualizarBadge('crg');
  }

  async function _carregarSubscriptions() {
    const opts = document.getElementById('csub-options'); if (!opts) return;
    opts.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Carregando...</div>';
    try {
      const data = await _api('GET', '/calculadora/subscriptions');
      if (!Array.isArray(data)||!data.length) { opts.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Nenhuma assinatura. Importe um CSV/Parquet.</div>'; return; }
      _dds.csub.data = data.map(s => { const ini=(s.periodo_inicio||'').slice(0,10),fim=(s.periodo_fim||'').slice(0,10); return { value:s.subscription_id, label:`${s.subscription_name||s.subscription_id}${ini?' ('+ini+' → '+fim+')':''}`, labelShort:s.subscription_name||s.subscription_id, sub:ini?`${ini} → ${fim}`:'', periodo_fim:fim }; });
      _renderOpcoes('csub');
    } catch(err) { opts.innerHTML=`<div style="padding:8px 12px;font-size:12px;color:#ff4d6a;">Erro: ${_esc(err.message)}</div>`; }
  }

  function onSubChange() {}
  function onRgChange()  {}

  async function buscarRecursos() {
    if (!_subsSel.length) { _toast('Selecione assinaturas e clique OK ✓.', 'error'); return; }

    // Formata Date → 'YYYY-MM-DD' usando hora local (evita bug de fuso UTC)
    const _fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Usa a data mais recente do banco para as assinaturas selecionadas como âncora
    // da janela. Garante que "últimos 30 dias" aponte para dados reais, não para hoje.
    const maxFim = _subsSel
      .map(id => (_dds.csub.data.find(s => s.value === id) || {}).periodo_fim || '')
      .filter(Boolean).sort().pop() || '';

    if (maxFim) {
      const fim = new Date(maxFim + 'T12:00:00'); // T12 neutraliza deslocamento de fuso
      const ini = new Date(fim); ini.setDate(ini.getDate() - 30);
      _dataFim    = _fmt(fim);
      _dataInicio = _fmt(ini);
    } else {
      // Fallback: 30 dias corridos a partir de hoje (horário local)
      const hoje = new Date();
      const ini  = new Date(hoje); ini.setDate(ini.getDate() - 30);
      _dataFim    = _fmt(hoje);
      _dataInicio = _fmt(ini);
    }

    _selecionados = {};
    await _carregarRecursos();
  }

  async function onFiltroChange() {
    if (_subsSel.length) await buscarRecursos();
  }

  function onTaxaChange() {
    _taxaBrl = parseFloat(document.getElementById('ctaxa').value) || 5.70;
    _renderRecursos();
    if (_estimativa) _renderResultados(_estimativa);
  }

  function onBusca(v) { _filtroTexto = v.toLowerCase(); _renderRecursos(); }

  async function _carregarRecursos() {
    _renderLoading();
    try {
      // Garantir que os arrays têm valores antes de montar a URL
      const subs = _subsSel.length ? _subsSel : (_subAtual ? [_subAtual] : []);
      const rgs  = _rgsSel.length  ? _rgsSel  : (_rgAtual  ? [_rgAtual]  : []);

      if (!subs.length) {
        const t = document.getElementById('ctbody');
        if (t) t.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Selecione uma assinatura primeiro.</td></tr>`;
        return;
      }

      const subsParam = subs.map(encodeURIComponent).join(',');
      const rgsParam  = rgs.map(encodeURIComponent).join(',');

      let url = `/calculadora/recursos?subscription_id=${subsParam}`;
      if (rgsParam) url += `&resource_group=${rgsParam}`;
      if (_dataInicio) url += `&data_inicio=${_dataInicio}`;
      if (_dataFim)    url += `&data_fim=${_dataFim}`;

      console.log('[Calculadora] Buscando recursos:', url);
      console.log('[Calculadora] Subs:', subs, '| RGs:', rgs);

      const data = await _api('GET', url);
      console.log('[Calculadora] Resposta:', Array.isArray(data) ? `${data.length} itens` : data);

      if (data && data.error) throw new Error(data.error);
      if (!Array.isArray(data)) throw new Error('Resposta inválida: ' + JSON.stringify(data).slice(0,100));
      // _key: identificador único por linha (resource pode ter múltiplas linhas com UoM diferente)
      _recursos = data.map(r => ({
        ...r,
        _key: (r.resource_id||'') + '||' + (r.meter_category||r.categoria||'') + '||' + (r.unit_of_measure||r.unidade||'')
      }));
      _selecionados = {};
      _renderRecursos();
    } catch (err) {
      console.error('[Calculadora] Erro:', err);
      const t = document.getElementById('ctbody');
      if (t) t.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:#ff4d6a;font-size:12px;">⚠ Erro: ${_esc(err.message)}<br><span style="color:var(--text-muted);font-size:10px;">Verifique o console (F12)</span></td></tr>`;
    }
  }

  function _renderLoading() {
    const t = document.getElementById('ctbody'); if (!t) return;
    const _sk = w => `<td style="padding:10px;"><span class="cskel" style="width:${w};"></span></td>`;
    t.innerHTML = Array(5).fill('').map(() => `<tr>
      <td style="padding:10px 8px;"><span class="cskel" style="width:15px;height:15px;border-radius:3px;"></span></td>
      <td style="padding:10px;"><span class="cskel" style="width:75%;margin-bottom:5px;"></span><span class="cskel" style="width:50%;height:10px;"></span></td>
      ${_sk('80px')}${_sk('110px')}${_sk('70px')}${_sk('80px')}${_sk('80px')}${_sk('70px')}${_sk('70px')}${_sk('70px')}
      <td style="padding:10px;"><span class="cskel" style="width:50px;margin-left:auto;"></span></td>
    </tr>`).join('');
    const c = document.getElementById('ccnt'); if (c) c.textContent = 'Carregando…';
  }

  // Mapa de grupos expandidos (true = expandido)
  const _expandidos = {};

  function _renderRecursos() {
    const tbody = document.getElementById('ctbody'); if (!tbody) return;
    const lista = _filtroTexto ? _recursos.filter(r =>
      (r.nome_recurso||'').toLowerCase().includes(_filtroTexto) ||
      (r.categoria||'').toLowerCase().includes(_filtroTexto)    ||
      (r.produto||'').toLowerCase().includes(_filtroTexto)      ||
      (r.consumed_service||'').toLowerCase().includes(_filtroTexto) ||
      (r.charge_type||'').toLowerCase().includes(_filtroTexto)  ||
      (r.unidade||'').toLowerCase().includes(_filtroTexto)      ||
      (r.pricing_model||'').toLowerCase().includes(_filtroTexto)||
      (r.resource_group_name||'').toLowerCase().includes(_filtroTexto)
    ) : _recursos;

    const c = document.getElementById('ccnt');

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">
        ${_recursos.length ? 'Nenhum recurso corresponde ao filtro.'
          : 'Nenhum recurso encontrado para os filtros selecionados.'}
      </td></tr>`;
      if (c) c.textContent = '0 recursos';
      _atualizarEstimativa();
      _atualizarCnt();
      return;
    }

    const isBRL = (lista[0]?.moeda || 'BRL') === 'BRL';

    // Agrupar por resource_id
    const grupos = {};
    const ordemGrupos = [];
    lista.forEach(r => {
      const bid = r.resource_id || '';
      if (!grupos[bid]) { grupos[bid] = []; ordemGrupos.push(bid); }
      grupos[bid].push(r);
    });

    const total_recursos = ordemGrupos.length;
    if (c) c.textContent = `${total_recursos} recurso${total_recursos!==1?'s':''}${lista.length > total_recursos ? ' · '+lista.length+' linhas' : ''}`;

    const rows = [];

    ordemGrupos.forEach(baseId => {
      const filhas = grupos[baseId];
      const temMultiplos = filhas.length > 1;
      // expandido por padrão
      const exp  = _expandidos[baseId] !== false;
      const nome = filhas[0].nome_recurso || baseId.split('/').filter(Boolean).pop() || baseId.slice(0,60);
      const rg   = filhas[0].resource_group_name || '—';
      const totalGrupo = filhas.reduce((s,r) => s + (isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0)*_taxaBrl), 0);
      const algumSel = filhas.some(r => !!_selecionados[r._key||r.resource_id]);
      const todosSel = filhas.every(r => !!_selecionados[r._key||r.resource_id]);

      if (temMultiplos) {
        rows.push(`<tr style="background:var(--bg-hover);cursor:pointer;" onclick="Calculadora._toggleGrupo('${_esc(baseId)}')">
          <td style="text-align:center;padding:8px 4px;" onclick="event.stopPropagation()">
            <input type="checkbox" class="cck-grupo" data-baseid="${_esc(baseId)}"
              ${todosSel?'checked':''} ${algumSel&&!todosSel?'data-indet="1"':''}
              onchange="Calculadora._checkGrupo('${_esc(baseId)}',this.checked);event.stopPropagation()">
          </td>
          <td colspan="7" style="padding:8px 10px;">
            <div style="display:flex;align-items:center;gap:7px;">
              <span style="font-size:10px;color:var(--text-muted);display:inline-block;transform:rotate(${exp?90:0}deg);transition:transform .15s;">&#9654;</span>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--text);" title="${_esc(baseId)}">${_esc(nome)}</div>
                <div style="font-size:10px;color:var(--text-muted);">${_esc(rg)} &nbsp;·&nbsp; <span style="color:var(--accent);">${filhas.length} meters</span></div>
              </div>
            </div>
          </td>
          <td colspan="2" style="padding:8px 10px;"></td>
          <td style="text-align:right;padding:8px 14px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:var(--accent);">${_brl(totalGrupo)}</div>
            <div style="font-size:9px;color:var(--text-muted);">total grupo</div>
          </td>
        </tr>`);
        if (!exp) return;
      }

      filhas.forEach(r => {
        const rid    = r._key || r.resource_id || '';
        const sel    = !!_selecionados[rid];
        const totBrl = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0)*_taxaBrl;
        const ctColor = r.charge_type==='Usage'
          ? 'rgba(147,51,234,.1);color:var(--accent)'
          : 'rgba(77,166,255,.1);color:var(--blue,#4da6ff)';
        const pad = temMultiplos ? 'padding-left:28px;' : '';

        rows.push(`<tr style="${sel?'background:rgba(147,51,234,.04);':''}">
          <td style="text-align:center;padding:8px 4px;">
            <input type="checkbox" class="cck" data-rid="${_esc(rid)}" ${sel?'checked':''}
              onchange="Calculadora._check('${_esc(rid)}',this.checked)">
          </td>
          <td style="max-width:200px;padding:8px 10px;${pad}">
            <div style="font-size:${temMultiplos?'11':'12'}px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${temMultiplos?'var(--text-dim)':'var(--text)'};" title="${_esc(r.resource_id||'')}">${_esc(temMultiplos?(r.meter_categories||r.categoria||nome):nome)}</div>
            <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(r.produto||r.subcategoria||r.regiao||'')}</div>
          </td>
          <td style="max-width:140px;padding:8px 10px;">
            <div style="font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(temMultiplos?'':rg)}</div>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <span class="cbadge">${_esc(r.categoria||'—')}</span>
          </td>
          <td style="max-width:150px;padding:8px 10px;">
            <div style="font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(r.consumed_service||'—')}</div>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <span style="padding:2px 7px;border-radius:8px;font-size:10px;font-weight:600;background:${ctColor};">${_esc(r.charge_type||'—')}</span>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <div style="font-size:11px;color:var(--text-dim);">${_esc(r.unidade||'—')}</div>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <div style="font-size:11px;color:var(--text-dim);">${_esc(r.pricing_model||'—')}</div>
          </td>
          <td style="text-align:right;padding:8px 10px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim);white-space:nowrap;">${parseFloat(r.total_qty||0).toLocaleString('pt-BR',{maximumFractionDigits:4})}</div>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <div style="font-size:11px;color:var(--text-dim);">${_esc(r.unidade||'—')}</div>
          </td>
          <td style="text-align:right;padding:8px 10px;">${_custoHora(r,isBRL,_taxaBrl)}</td>
          <td style="text-align:right;padding:8px 14px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--accent);white-space:nowrap;">${_brl(totBrl)}</div>
          </td>
        </tr>`);
      });
    });

    tbody.innerHTML = rows.join('');
    document.querySelectorAll('.cck-grupo[data-indet="1"]').forEach(ck => { ck.indeterminate = true; });
    _atualizarEstimativa();
    _atualizarCnt();
  }

  function _toggleGrupo(baseId) {
    _expandidos[baseId] = (_expandidos[baseId] === false) ? true : false;
    _renderRecursos();
  }

  function _checkGrupo(baseId, checked) {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    _recursos.filter(r => r.resource_id === baseId).forEach(r => {
      const key = r._key || r.resource_id;
      if (checked) _selecionados[key] = h;
      else delete _selecionados[key];
    });
    _renderRecursos();
  }


  function _check(rid, checked) {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    if (checked) _selecionados[rid] = h;
    else delete _selecionados[rid];
    // Atualizar apenas a linha afetada sem reconstruir o tbody inteiro
    const row = document.querySelector(`input.cck[data-rid="${rid}"]`)?.closest('tr');
    if (row) row.style.background = checked ? 'rgba(147,51,234,.04)' : '';
    _atualizarEstimativa();
    _atualizarCnt();
  }

  function _checkAll(checked) {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    if (checked) _recursos.forEach(r => { const k = r._key||r.resource_id; _selecionados[k] = h; });
    else _selecionados = {};
    // Atualizar todos os checkboxes visíveis sem reconstruir
    document.querySelectorAll('input.cck').forEach(ck => {
      const rid = ck.dataset.rid;
      ck.checked = !!_selecionados[rid];
      const row = ck.closest('tr');
      if (row) row.style.background = ck.checked ? 'rgba(147,51,234,.04)' : '';
    });
    _atualizarEstimativa();
    _atualizarCnt();
  }

  function _isConsumo(r) {
    const uom = (r?.unidade || '').toLowerCase();
    return !uom.includes('hour') && !uom.includes('hora');
  }

  function _horasChange(rid, val) { if (_selecionados[rid]!==undefined) _selecionados[rid] = parseFloat(val)||720; }

  function _atualizarCnt() {
    const n  = Object.keys(_selecionados).length;
    const el = document.getElementById('cselcnt');
    if (el) el.textContent = `${n} recurso${n!==1?'s':''} selecionado${n!==1?'s':''}`;
    const allCk = document.getElementById('cck-all');
    if (allCk) {
      allCk.checked       = n > 0 && n >= _recursos.length;
      allCk.indeterminate = n > 0 && n < _recursos.length;
    }
    ['cbtn-gerar', 'cbtn-estimar'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled              = n === 0;
      btn.style.background      = n > 0 ? 'var(--accent)' : 'var(--border)';
      btn.style.color           = n > 0 ? '#ffffff'        : 'var(--text-muted)';
      btn.style.cursor          = n > 0 ? 'pointer'        : 'not-allowed';
      btn.style.opacity         = n > 0 ? '1'              : '0.5';
    });
    _atualizarBtnIncluir();
  }

  function selecionarTodos() {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    _recursos.forEach(r => { _selecionados[r._key||r.resource_id] = h; });
    document.querySelectorAll('input.cck').forEach(ck => {
      ck.checked = true;
      const row = ck.closest('tr'); if (row) row.style.background = 'rgba(147,51,234,.04)';
    });
    _atualizarEstimativa();
    _atualizarCnt();
  }

  function deselecionarTodos() {
    _selecionados = {};
    document.querySelectorAll('input.cck').forEach(ck => {
      ck.checked = false;
      const row = ck.closest('tr'); if (row) row.style.background = '';
    });
    _atualizarEstimativa();
    _atualizarCnt();
  }

  function aplicarHorasGlobal() {
    const h = Math.max(1, parseInt(document.getElementById('chglobal')?.value) || 720);
    Object.keys(_selecionados).forEach(rid => { _selecionados[rid] = h; });
    _atualizarEstimativa();
    // atualiza cards do overlay se estiver aberto
    const modal = document.getElementById('covmodal');
    if (modal && modal.style.display !== 'none') _ovRenderRecursos();
  }

  function _setModoHoras(modo) {
    const tabH  = document.getElementById('ctab-horas');
    const tabP  = document.getElementById('ctab-periodo');
    const painH = document.getElementById('cpainel-horas');
    const painP = document.getElementById('cpainel-periodo');
    if (!tabH) return;
    const isManual = modo === 'manual';

    // Estilo das abas
    tabH.style.background  = isManual ? 'var(--accent)' : 'transparent';
    tabH.style.color       = isManual ? '#fff'          : 'var(--text-muted)';
    tabH.style.borderColor = isManual ? 'var(--accent)' : 'var(--border)';
    tabP.style.background  = isManual ? 'transparent'   : 'var(--accent)';
    tabP.style.color       = isManual ? 'var(--text-muted)' : '#fff';
    tabP.style.borderColor = isManual ? 'var(--border)' : 'var(--accent)';
    painH.style.display    = isManual ? '' : 'none';
    painP.style.display    = isManual ? 'none' : '';

    if (isManual) {
      // Trocou para HORAS → limpa todos os períodos acumulados e reaaplica horas globais
      _periodos = [];
      _horasPeriodoValidas = false;
      _renderPeriodos();
      _atualizarBtnIncluir();
      aplicarHorasGlobal();          // reaplica o valor atual do input de horas
    } else {
      // Trocou para PERÍODO
      const covModal = document.getElementById('covmodal');
      const overlayOpen = covModal && covModal.style.display !== 'none';
      _periodos = [];
      _renderPeriodos();
      // Só limpa recursos se estiver na tabela principal (não no overlay)
      if (!overlayOpen) {
        _selecionados = {};
        document.querySelectorAll('input.cck').forEach(ck => { ck.checked = false; if (ck.closest('tr')) ck.closest('tr').style.background = ''; });
        const allCk = document.getElementById('cck-all');
        if (allCk) { allCk.checked = false; allCk.indeterminate = false; }
        _atualizarEstimativa();
        _atualizarCnt();
      } else {
        _ovRenderRecursos();
      }
      _initPeriodoDefaults();
    }
  }

  function _initPeriodoDefaults() {
    const iniData = document.getElementById('cperiodo-ini-data');
    if (!iniData) return;
    const fimData = document.getElementById('cperiodo-fim-data');

    if (iniData.value) {
      // Campos já preenchidos — apenas garante que fim data acompanha início
      if (fimData) fimData.value = iniData.value;
      _calcHorasPeriodo();
      return;
    }

    // Primeira abertura — preenche com data/hora atual
    const pad     = n => String(n).padStart(2, '0');
    const now     = new Date();
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const fmtTime = d => `${pad(d.getHours())}:00`;
    iniData.value = fmtDate(now);
    document.getElementById('cperiodo-ini-hora').value = fmtTime(now);
    if (fimData) fimData.value = fmtDate(now);
    document.getElementById('cperiodo-fim-hora').value = `${pad(now.getHours() + 1 < 24 ? now.getHours() + 1 : 23)}:00`;
    _calcHorasPeriodo();
  }

  function _getIniISO() {
    const d = document.getElementById('cperiodo-ini-data')?.value;
    const h = document.getElementById('cperiodo-ini-hora')?.value || '00:00';
    return d ? `${d}T${h}` : '';
  }
  function _getFimISO() {
    const d = document.getElementById('cperiodo-fim-data')?.value;
    const h = document.getElementById('cperiodo-fim-hora')?.value || '00:00';
    return d ? `${d}T${h}` : '';
  }

  // Ao mudar a data início → preenche Data Fim apenas se estiver vazia
  function _sincDataFim() {
    const dataIni = document.getElementById('cperiodo-ini-data')?.value || '';
    const dataFim = document.getElementById('cperiodo-fim-data');
    if (dataFim && !dataFim.value) dataFim.value = dataIni;
    _calcHorasPeriodo();
  }

  // Mantido no API público por compatibilidade (agora delega para _sincDataFim)
  function _sincHoraFim() { _calcHorasPeriodo(); }

  function _atualizarBtnIncluir() {
    // Modo PERÍODO: precisa de datas/horas válidas + recursos carregados (Buscar executado)
    // Não exige pré-seleção: _aplicarTotalPeriodos seleciona todos automaticamente
    const ok  = _horasPeriodoValidas && _recursos.length > 0;
    const btn = document.getElementById('cbtn-incluir');
    if (!btn) return;
    btn.disabled         = !ok;
    btn.style.border     = ok ? '1px solid var(--accent)' : '1px solid var(--border)';
    btn.style.background = ok ? 'rgba(147,51,234,.12)'    : 'rgba(100,100,100,.08)';
    btn.style.color      = ok ? 'var(--accent)'           : 'var(--text-muted)';
    btn.style.cursor     = ok ? 'pointer'                 : 'not-allowed';
    btn.style.opacity    = ok ? '1'                       : '0.5';
  }

  function _calcHorasPeriodo() {
    const vIni = _getIniISO();
    const vFim = _getFimISO();
    const res  = document.getElementById('cperiodo-res');

    if (!vIni || !vFim) {
      if (res) res.textContent = '';
      _horasPeriodoValidas = false;
      _atualizarBtnIncluir();
      return 0;
    }
    const diff = new Date(vFim) - new Date(vIni);
    if (diff <= 0) {
      if (res) { res.style.color = 'var(--danger)'; res.textContent = '⚠ Hora fim deve ser posterior à hora início'; }
      _horasPeriodoValidas = false;
      _atualizarBtnIncluir();
      return 0;
    }
    const horas = Math.round(diff / 3600000);
    const horaIni = vIni.slice(11, 16);
    const horaFim = vFim.slice(11, 16);
    if (res) { res.style.color = 'var(--accent)'; res.textContent = `= ${horas}h (${horaIni} → ${horaFim})`; }
    _horasPeriodoValidas = true;
    _atualizarBtnIncluir();
    return horas;
  }

  function _periodoLabel(vIni, vFim, horas) {
    const fmtDate = v => v.slice(0, 10);
    const fmtHora = v => v.length >= 16 ? v.slice(11, 16) : v;
    const dias = Math.floor(horas / 24);
    const hRest = horas % 24;
    const dur = dias > 0 ? `${dias}d${hRest > 0 ? ' ' + hRest + 'h' : ''}` : `${horas}h`;
    return `${fmtDate(vIni)} ${fmtHora(vIni)} → ${fmtDate(vFim)} ${fmtHora(vFim)} · ${dur}`;
  }

  function _incluirPeriodo() {
    const horas = _calcHorasPeriodo();
    if (!horas) return;
    const vIni = _getIniISO();
    const vFim = _getFimISO();
    _periodos.push({ inicio: vIni, fim: vFim, horas });
    _renderPeriodos();
    _aplicarTotalPeriodos();
    // Mantém data início/fim iguais — limpa só a mensagem de resultado
    const res = document.getElementById('cperiodo-res');
    if (res) res.textContent = '';
    _horasPeriodoValidas = false;
    _atualizarBtnIncluir();
  }

  function _removerPeriodo(idx) {
    _periodos.splice(idx, 1);
    _renderPeriodos();
    _aplicarTotalPeriodos();
  }

  function _renderPeriodos() {
    const lista = document.getElementById('cperiodo-lista');
    const bloco = document.getElementById('cperiodo-total');
    if (!lista) return;
    lista.innerHTML = '';
    _periodos.forEach((p, i) => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:5px;background:rgba(147,51,234,.08);border:1px solid rgba(147,51,234,.18);';
      const fmt = v => v.replace('T',' ').slice(0,16);
      const dias = Math.floor(p.horas/24), hRest = p.horas%24;
      const dur  = dias > 0 ? `${dias}d${hRest>0?' '+hRest+'h':''}` : `${p.horas}h`;
      div.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fmt(p.inicio)} → ${fmt(p.fim)}</div>
          <div style="font-size:11px;font-weight:700;color:var(--accent);font-family:IBM Plex Mono,monospace;">${p.horas}h <span style="font-weight:400;color:var(--text-muted);">(${dur})</span></div>
        </div>
        <button onclick="Calculadora._removerPeriodo(${i})" title="Remover"
          style="flex-shrink:0;width:20px;height:20px;border-radius:4px;border:1px solid rgba(255,77,106,.3);background:rgba(255,77,106,.08);color:var(--danger);font-size:12px;cursor:pointer;line-height:1;">✕</button>`;
      lista.appendChild(div);
    });
    if (bloco) bloco.style.display = _periodos.length > 1 ? 'block' : 'none';
  }

  function _aplicarTotalPeriodos() {
    if (!_periodos.length) return;
    const total = _periodos.reduce((s, p) => s + p.horas, 0);
    const tv  = document.getElementById('cperiodo-total-val');
    const dias = Math.floor(total / 24), hRest = total % 24;
    const dur  = dias > 0 ? `${dias}d${hRest > 0 ? ' ' + hRest + 'h' : ''}` : `${total}h`;
    if (tv) tv.textContent = `${total}h (${dur})`;

    // Atualiza chglobal e aplica em TODOS os recursos carregados
    const el = document.getElementById('chglobal');
    if (el) el.value = total;
    _recursos.forEach(r => {
      const key = r._key || r.resource_id;
      if (key) _selecionados[key] = total;
    });
    // Marca todos os checkboxes como selecionados
    document.querySelectorAll('input.cck').forEach(ck => { ck.checked = true; });
    const allCk = document.getElementById('cck-all');
    if (allCk) { allCk.checked = true; allCk.indeterminate = false; }
    _atualizarEstimativa();
    _atualizarCnt();
    const _covM = document.getElementById('covmodal');
    if (_covM && _covM.style.display !== 'none') _ovRenderRecursos();
  }

  // Mapa de equivalência em texto
  function _horasLabel(h) {
    h = parseInt(h);
    if (h === 1)    return '1 hora';
    if (h < 24)     return `${h} horas`;
    if (h === 24)   return '1 dia';
    if (h === 48)   return '2 dias';
    if (h === 72)   return '3 dias';
    if (h < 168)    return `${(h/24).toFixed(0)} dias`;
    if (h === 168)  return '1 semana';
    if (h === 336)  return '2 semanas';
    if (h < 720)    return `${(h/168).toFixed(1)} semanas`;
    if (h === 720)  return '1 mês';
    if (h === 1440) return '2 meses';
    if (h === 2160) return '3 meses';
    if (h === 4380) return '6 meses';
    if (h === 8760) return '1 ano';
    if (h < 720)    return `${(h/24).toFixed(0)} dias`;
    return `${(h/720).toFixed(1)} meses`;
  }

  // Sincronizar slider, input e chips para um valor de horas
  function _syncHorasUI(h) {
    h = Math.max(1, parseInt(h) || 1);
    const slider  = document.getElementById('chslider');
    const input   = document.getElementById('chglobal');
    const display = document.getElementById('chval-display');
    const equiv   = document.getElementById('chval-equiv');

    if (slider)  { slider.value = Math.min(h, 8760); _updateSliderGradient(slider); }
    if (input)   input.value   = h;
    if (display) display.textContent = h.toLocaleString('pt-BR');
    if (equiv)   equiv.textContent   = '≈ ' + _horasLabel(h);

    // Destacar chip ativo (se existir)
    document.querySelectorAll('.cchip[data-h]').forEach(btn => {
      const bh = parseInt(btn.dataset.h);
      btn.classList.toggle('cchip-active', bh === h);
    });
  }

  // Atualizar gradiente do slider dinamicamente
  function _updateSliderGradient(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--accent,#9333ea) 0%, var(--accent,#9333ea) ${pct}%, var(--border,#2d3347) ${pct}%)`;
  }

  // Chamado pelo oninput do slider
  function _onSlider(val) {
    _syncHorasUI(val);
  }

  // Chamado pelo oninput do número
  function _onHorasInput(val) { /* valor lido diretamente no input */ }

  function _setH(h) {
    _syncHorasUI(h);
    aplicarHorasGlobal();
  }

  // ── Calcular ─────────────────────────────────────────────────────
  async function calcular() {
    const ids = Object.keys(_selecionados);
    if (!ids.length) { _toast('Selecione pelo menos um recurso.', 'error'); return; }

    const area = document.getElementById('cresarea');
    const rod = null;
    if (area) area.innerHTML = `<div style="text-align:center;padding:40px;"><span class="cspinner"></span><div style="margin-top:12px;font-size:12px;color:var(--text-muted);">Calculando...</div></div>`;
    if (rod) rod.style.display = 'none';

    try {
      const data = await _api('POST', '/calculadora/estimar', {
        recursos: ids.map(rid => ({ resource_id: rid, horas: _selecionados[rid] || 720 })),
        taxa_brl: _taxaBrl, subscription_id: _subAtual, resource_group: _rgAtual,
        data_inicio: _dataInicio||undefined, data_fim: _dataFim||undefined,
      });
      if (data && data.error) throw new Error(data.error);
      _estimativa = data; _renderResultados(data);
    } catch (err) {
      if (area) area.innerHTML = `<div style="padding:14px;border-radius:8px;background:rgba(255,77,106,.08);color:#ff4d6a;border-left:3px solid #ff4d6a;font-size:12px;">⚠ ${_esc(err.message)}</div>`;
    }
  }

  function _renderResultados(data) {
    const area = document.getElementById('cresarea'); const rod = null; const tot = null;
    if (!area || !data || !data.resultados) return;

    const mapN = {};
    _recursos.forEach(r => { mapN[r.resource_id] = r.nome_recurso || r.resource_id.split('/').pop(); });

    area.innerHTML = data.resultados.map(r => {
      if (r.erro) return `<div class="crcard" style="border-left:2px solid #ff4d6a;">
        <div class="crnome">${_esc(mapN[r.resource_id]||r.resource_id.split('/').pop())}</div>
        <div style="font-size:11px;color:#ff4d6a;">⚠ ${_esc(r.erro)}</div></div>`;
      return `<div class="crcard">
        <div class="crnome" title="${_esc(r.resource_id)}">${_esc(mapN[r.resource_id]||r.resource_id.split('/').pop()||r.resource_id.slice(0,50))}</div>
        <div class="crrow"><span class="crlabel">Custo/hora (BRL)</span><span class="crval">${_brl(r.custo_hora_brl)}</span></div>
        <div class="crrow"><span class="crlabel">Dias ativos (base)</span><span class="crval">${r.dias_ativos} dias</span></div>
        <div class="crrow"><span class="crlabel">Horas estimadas</span><span class="crval">${(r.horas_estimadas||0).toLocaleString('pt-BR')} h</span></div>
        <div class="crrow"><span class="crlabel" style="font-size:10px;opacity:.7;">${r.moeda==='BRL'?'Faturado em BRL':r.moeda+' × '+r.taxa_brl_usada}</span></div>
        <div style="border-top:1px solid var(--border);margin:7px 0 5px;"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="crlabel">Estimativa</span><span class="crbrl">${_brl(r.estimativa_brl)}</span>
        </div></div>`;
    }).join('');

    if (rod) rod.style.display = 'block';
    if (tot) tot.textContent = _brl(data.total_brl);
  }

  function _resetRes() {
    // Não sobrescreve o painel de estimativa — apenas limpa visualmente
    _estimativa = null;
    _atualizarEstimativa(); // mostra estado vazio corretamente
  }

  // ── Export CSV ───────────────────────────────────────────────────
  // ── Invoice / Estimativa ─────────────────────────────────────────
  async function abrirInvoice() {
    if (!_estimativa || !_estimativa.resultados) { _toast('Calcule a estimativa primeiro.', 'error'); return; }

    const modal = document.getElementById('cinv-modal');
    if (!modal) return;

    // Preencher data padrão
    const hoje = new Date().toISOString().slice(0, 10);
    const inp  = document.getElementById('cinv-data');
    if (inp && !inp.value) inp.value = hoje;

    // Carregar projetos da API
    const sel = document.getElementById('cinv-projeto');
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
      const data = await _api('GET', '/projetos');
      if (!Array.isArray(data) || !data.length) {
        sel.innerHTML = '<option value="">Nenhum projeto cadastrado</option>';
      } else {
        sel.innerHTML = '<option value="">— selecione o projeto —</option>' +
          data.map(p => `<option value="${p.id}" data-dir="${_esc(p.diretoria||'')}" data-desc="${_esc(p.descricao||'')}">${_esc(p.nome)}${p.diretoria ? ' · ' + p.diretoria : ''}</option>`).join('');
        sel.onchange = () => _atualizarInfoProjeto(data);
      }
    } catch (e) {
      sel.innerHTML = `<option value="">Erro: ${_esc(e.message)}</option>`;
    }

    _atualizarPreviewInvoice();
    modal.style.display = 'flex';
  }

  function _atualizarInfoProjeto(projetos) {
    const sel  = document.getElementById('cinv-projeto');
    const info = document.getElementById('cinv-projeto-info');
    if (!sel || !info) return;
    const p = projetos.find(x => String(x.id) === sel.value);
    if (p) {
      info.style.display = 'block';
      info.innerHTML = `<strong style="color:var(--text);">${_esc(p.nome)}</strong>${p.diretoria ? ' &nbsp;·&nbsp; <span>'+_esc(p.diretoria)+'</span>' : ''}${p.descricao ? '<br><span style="color:var(--text-muted);margin-top:3px;display:block;">'+_esc(p.descricao)+'</span>' : ''}`;
    } else {
      info.style.display = 'none';
    }
  }

  function _atualizarPreviewInvoice() {
    const body = document.getElementById('cinv-preview-body');
    if (!body || !_estimativa) { if(body) body.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Nenhum recurso selecionado.</span>'; return; }
    const itens = _estimativa.resultados;
    let html = '';

    // ── Bloco de períodos (visível apenas quando modo período foi usado) ──
    if (_periodos.length > 0) {
      const fmt = v => v ? v.replace('T', ' ').slice(0, 16) : '';
      const totalH = _periodos.reduce((s, p) => s + p.horas, 0);
      html += '<div style="margin-bottom:12px;padding:10px 12px;border-radius:8px;background:rgba(147,51,234,.08);border:1px solid rgba(147,51,234,.22);">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);margin-bottom:7px;">Períodos Selecionados</div>';
      _periodos.forEach((p, i) => {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:3px 0;border-bottom:1px solid rgba(147,51,234,.1);">'
          + '<span style="color:var(--text-dim);">' + (i + 1) + '.&nbsp;&nbsp;' + _esc(fmt(p.inicio)) + ' &rarr; ' + _esc(fmt(p.fim)) + '</span>'
          + '<span style="font-family:IBM Plex Mono,monospace;color:var(--accent);margin-left:10px;flex-shrink:0;">' + p.horas + 'h</span>'
          + '</div>';
      });
      html += '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;padding-top:6px;">'
        + '<span style="color:var(--text);">Total de Horas</span>'
        + '<span style="font-family:IBM Plex Mono,monospace;color:var(--accent);">' + totalH + 'h</span>'
        + '</div></div>';
    }

    // ── Resumo de totais ──
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
      + '<span style="color:var(--text-muted);">Recursos selecionados</span><span>' + itens.length + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
      + '<span style="color:var(--text-muted);">UoM = Hour (unit_price)</span>'
      + '<span>' + itens.filter(r => r.isHora).length + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
      + '<span style="color:var(--text-muted);">UoM ≠ Hour (÷30÷24)</span>'
      + '<span>' + itens.filter(r => !r.isHora).length + '</span></div>'
      + (_estimativa.pct_imposto > 0
        ? '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
          + '<span style="color:var(--text-muted);">+ Imposto (' + _estimativa.pct_imposto + '%)</span>'
          + '<span style="font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.vl_imposto) + '</span></div>' : '')
      + (_estimativa.pct_cond > 0
        ? '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
          + '<span style="color:var(--text-muted);">+ Condomínio (' + _estimativa.pct_cond + '%)</span>'
          + '<span style="font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.vl_cond) + '</span></div>' : '')
      + '<div style="border-top:1px solid var(--border);margin:8px 0;padding-top:8px;display:flex;justify-content:space-between;align-items:center;">'
      + '<span style="font-weight:600;color:var(--text);">Total Final (BRL)</span>'
      + '<span style="font-size:1.1rem;font-weight:700;color:var(--accent);font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.total_final || _estimativa.total_brl) + '</span>'
      + '</div>';

    // ── Lista de recursos ──
    if (itens.length > 0) {
      html += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:6px;">Detalhamento por Recurso</div>'
        + '<div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;">';
      itens.forEach(r => {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;background:rgba(147,51,234,.05);border:1px solid rgba(147,51,234,.1);">'
          + '<span style="font-size:10px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-right:6px;" title="' + _esc(r.nome) + '">' + _esc(r.nome) + '</span>'
          + '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;margin-right:8px;">' + r.horas + 'h</span>'
          + '<span style="font-size:11px;font-family:IBM Plex Mono,monospace;color:var(--accent);white-space:nowrap;font-weight:600;">' + _brl(r.estimado_brl) + '</span>'
          + '</div>';
      });
      html += '</div></div>';
    }

    body.innerHTML = html;
  }

  function fecharInvoice() {
    const m = document.getElementById('cinv-modal');
    if (m) m.style.display = 'none';
  }

  function _buildPDFHtml(p) {
    const linhas = (p.itens || []).map(r => {
      const quantCell = (r.horas || 0).toLocaleString('pt-BR') + ' h';
      const precoCell = r.custo_hora != null
        ? '<span class="mono">' + _brl(r.custo_hora) + '/h' + (r.isHora ? '' : '*') + '</span>'
        : '<span class="na">&mdash;</span>';
      return '<tr>'
        + '<td class="td-nm">' + _esc(r.nome) + '</td>'
        + '<td class="td-sm">' + _esc(r.categoria) + '</td>'
        + '<td class="td-sm td-right td-mono">' + quantCell + '</td>'
        + '<td class="td-sm td-right">' + precoCell + '</td>'
        + '<td class="td-brl ' + (r.isHora ? 'td-green' : 'td-gray') + '">' + _brl(r.estimado_brl) + '</td>'
        + '</tr>';
    }).join('');
    const totalFinal = p.total_final || p.total_brl || 0;

    // Seção de períodos (só renderiza quando estimativa foi feita por datas)
    const periodosHtml = (p.periodos && p.periodos.length > 0) ? (() => {
      const fmt = v => v ? v.replace('T', ' ').slice(0, 16) : '';
      const rows = p.periodos.map((per, i) =>
        '<tr>'
        + '<td class="p-num">Per&#237;odo ' + (i + 1) + '</td>'
        + '<td class="p-dt">' + _esc(fmt(per.inicio)) + '</td>'
        + '<td class="p-arr">&rarr;</td>'
        + '<td class="p-dt">' + _esc(fmt(per.fim)) + '</td>'
        + '<td class="p-h">' + per.horas + ' h</td>'
        + '</tr>'
      ).join('');
      const totalH = p.periodos.reduce((s, per) => s + per.horas, 0);
      return '<div class="per-wrap">'
        + '<div class="per-lbl">Per&#237;odos de Estimativa</div>'
        + '<table class="per-tbl"><tbody>' + rows
        + '<tr class="p-total"><td colspan="4" style="padding:6px 10px;">Total de Horas</td>'
        + '<td class="p-h" style="padding:6px 10px;">' + totalH + ' h</td></tr>'
        + '</tbody></table></div>';
    })() : '';

    const _origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${_esc(p.titulo)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans','Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:10pt;color:#1a202c;background:#0d0f14;padding:24px}
.page{background:#fff;max-width:960px;margin:0 auto;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.55)}
/* ── CABEÇALHO ── */
.hdr{background:linear-gradient(135deg,#0d0218 0%,#1a0035 45%,#0d0014 100%);display:flex;align-items:stretch;min-height:96px;position:relative;overflow:hidden}
.hdr::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(147,51,234,.18) 0%,transparent 60%),radial-gradient(ellipse at 80% 50%,rgba(100,0,180,.12) 0%,transparent 55%)}
.hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:rgba(147,51,234,.25)}
.hdr-logo{padding:14px 22px;display:flex;align-items:center;justify-content:center;border-right:1px solid rgba(147,51,234,.15);flex-shrink:0;position:relative;z-index:1}
.hdr-brand-wrap{display:flex;flex-direction:column;align-items:center;gap:5px}
.hdr-brand-top{display:flex;align-items:center;gap:4px}
.hdr-mascote{height:44px;width:auto;object-fit:contain;filter:drop-shadow(0 0 7px rgba(147,51,234,.4))}
.hdr-vivo-svg{display:block;flex-shrink:0;filter:drop-shadow(0 0 6px rgba(147,51,234,.5))}
.hdr-brand-bottom{text-align:center}
.hdr-name{font-size:11pt;font-weight:700;color:#c084fc;letter-spacing:.02em;line-height:1.2}
.hdr-sub{font-size:6pt;color:#7c5fa0;letter-spacing:.16em;text-transform:uppercase;margin-top:2px}
.hdr-mid{flex:1;position:relative;z-index:1;display:flex;align-items:center;justify-content:center}
.hdr-watermark{font-size:52pt;font-weight:900;color:rgba(147,51,234,.04);letter-spacing:-.02em;user-select:none;font-family:'Arial Black',Arial,sans-serif;line-height:1}
.hdr-r{padding:16px 26px;text-align:right;display:flex;flex-direction:column;justify-content:center;gap:5px;border-left:1px solid rgba(147,51,234,.15);flex-shrink:0;position:relative;z-index:1}
.hdr-tag{font-size:6pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#6b5480}
.hdr-num{font-size:11.5pt;font-weight:700;color:#9333ea;font-family:'IBM Plex Mono','Courier New',monospace;letter-spacing:.06em}
.hdr-date{font-size:7.5pt;color:#7c5fa0;margin-top:2px}
/* ── STRIPE ── */
.stripe{height:4px;background:linear-gradient(90deg,#2d0060 0%,#660099 25%,#9333ea 50%,#660099 75%,#2d0060 100%)}
/* ── TÍTULO ── */
.title-wrap{padding:22px 28px 18px;border-bottom:1px solid #ede9f7;display:flex;align-items:flex-end;justify-content:space-between;background:linear-gradient(180deg,#faf7ff 0%,#fff 100%)}
.title-l{flex:1}
.title-cap{font-size:6.5pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#7c3aed;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.title-cap-dot{width:6px;height:6px;border-radius:50%;background:#9333ea;display:inline-block;flex-shrink:0}
.title-main{font-size:18pt;font-weight:700;color:#0d0f14;line-height:1.2}
.title-r{text-align:right;flex-shrink:0;padding-left:20px}
.status-badge{display:inline-block;padding:5px 14px;border-radius:20px;font-size:7.5pt;font-weight:700;background:linear-gradient(135deg,rgba(147,51,234,.12),rgba(100,0,180,.08));color:#7c3aed;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(147,51,234,.3)}
/* ── CARDS ── */
.meta{display:grid;grid-template-columns:2fr 1.5fr 2fr;border-bottom:3px solid #0d0014}
.mc{padding:16px 22px;border-right:1px solid #ede9f7;position:relative;background:#fff}
.mc::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;background:transparent;border-radius:0 2px 2px 0}
.mc:first-child::before{background:#9333ea}
.mc:last-child{border-right:none}
.mc-lbl{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#9aa0be;margin-bottom:7px}
.mc-val{font-size:11pt;font-weight:600;color:#1a202c}
.mc-sub{font-size:8.5pt;color:#64748b;margin-top:3px}
.mc-total{background:linear-gradient(135deg,#0d0218 0%,#1a0035 100%)}
.mc-total .mc-lbl{color:#6b5480}
.mc-total .mc-val{font-size:16pt;font-weight:700;color:#c084fc;font-family:'IBM Plex Mono','Courier New',monospace;letter-spacing:.01em}
.mc-total .mc-sub{color:#7c5fa0}
.mc-total::before{background:#9333ea}
/* ── SEÇÃO ── */
.sec-hdr{padding:9px 22px;background:linear-gradient(90deg,#3d006b 0%,#660099 50%,#4a0080 100%);display:flex;align-items:center;gap:8px}
.sec-hdr span{font-size:7pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e9d5ff}
.sec-hdr svg{flex-shrink:0}
/* ── TABELA ── */
table{width:100%;border-collapse:collapse;font-size:9pt}
thead tr{background:#13161e}
thead th{padding:9px 10px;font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9aa0be;text-align:left;white-space:nowrap;border-bottom:2px solid #9333ea}
tbody tr{border-bottom:1px solid #f0eef8}
tbody tr:nth-child(odd){background:#fff}
tbody tr:nth-child(even){background:#faf7ff}
tbody tr:hover{background:#f3eeff}
td{padding:8px 10px;vertical-align:middle}
.td-nm{font-weight:600;color:#0f172a;max-width:190px;word-break:break-word;font-size:9pt}
.td-sm{font-size:8.5pt;color:#4a5568}
.td-right{text-align:right}
.td-mono{font-family:'IBM Plex Mono','Courier New',monospace;font-size:8.5pt}
.td-brl{text-align:right;font-family:'IBM Plex Mono','Courier New',monospace;font-weight:700;font-size:10pt}
.td-green{color:#6d28d9}
.td-gray{color:#9aa0be;font-weight:400;font-size:9pt}
.na{color:#cbd5e1}
.mono{font-family:'IBM Plex Mono','Courier New',monospace}
/* ── TOTAIS ── */
tfoot td{padding:9px 10px}
.tr-sub td{background:#f5f0ff;color:#5b21b6;border-top:1px solid #ede9f7;font-size:9pt}
.tr-sub td:last-child{font-family:'IBM Plex Mono','Courier New',monospace;text-align:right;font-weight:600;color:#6d28d9}
.tr-add td{background:#f5f0ff;color:#64748b;font-size:8.5pt;border-top:1px solid #ede9f7}
.tr-add td:last-child{font-family:'IBM Plex Mono','Courier New',monospace;text-align:right}
.tr-total td{background:linear-gradient(90deg,#0d0218,#1a0035);color:#9aa0be;font-weight:700;font-size:11pt;letter-spacing:.03em;border-top:3px solid #9333ea;padding:13px 10px}
.tr-total td:first-child{padding-left:24px;color:#e9d5ff;letter-spacing:.05em;text-transform:uppercase;font-size:9.5pt}
.tr-total td:last-child{font-family:'IBM Plex Mono','Courier New',monospace;font-size:15pt;text-align:right;color:#c084fc;padding-right:24px;font-weight:700}
/* ── OBS / LEGAL / RODAPÉ ── */
.obs{padding:14px 22px;border-top:1px solid #ede9f7;background:#faf7ff;border-left:3px solid #9333ea}
.obs-lbl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;margin-bottom:5px}
.obs-txt{font-size:9.5pt;color:#374151;line-height:1.7}
.disc{padding:12px 22px 14px;border-top:1px solid #ede9f7;display:flex;gap:12px;align-items:flex-start}
.disc-bar{width:3px;flex-shrink:0;background:#9333ea;border-radius:2px;align-self:stretch;min-height:44px;opacity:.4}
.disc-txt{font-size:7.5pt;color:#64748b;line-height:1.9}
.disc-txt strong{color:#374151}
.foot{padding:11px 24px;background:linear-gradient(135deg,#0d0218 0%,#1a0035 45%,#0d0014 100%);display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(147,51,234,.2)}
.foot-l{font-size:8pt;color:#7c5fa0;display:flex;align-items:center;gap:8px}
.foot-dot{width:4px;height:4px;border-radius:50%;background:#9333ea;display:inline-block;opacity:.7}
.foot-r{font-size:7.5pt;color:#6b5480;font-family:'IBM Plex Mono','Courier New',monospace;letter-spacing:.04em}
/* ── PERÍODOS ── */
.per-wrap{padding:12px 22px 14px;background:#faf7ff;border-bottom:1px solid #ede9f7}
.per-lbl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;margin-bottom:8px}
.per-tbl{width:100%;border-collapse:collapse;font-size:9pt}
.per-tbl td{padding:5px 10px;border-bottom:1px solid #ede9f7;color:#4a5568}
.per-tbl .p-num{color:#660099;font-weight:700;white-space:nowrap;width:80px}
.per-tbl .p-dt{white-space:nowrap;font-family:'IBM Plex Mono','Courier New',monospace;font-size:8.5pt}
.per-tbl .p-arr{color:#9aa0be;text-align:center;width:20px}
.per-tbl .p-h{font-family:'IBM Plex Mono','Courier New',monospace;text-align:right;color:#6d28d9;font-weight:600;white-space:nowrap}
.per-tbl .p-total td{background:#ede9f7;font-weight:700;color:#4a0080;border-top:2px solid #9333ea}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;max-width:100%}tbody tr:hover{background:inherit}@page{size:A4 portrait;margin:8mm 10mm}}
</style>
<script>
var inIframe=window!==window.parent;
window.onload=function(){
  var img=document.getElementById('pdf-mascote');
  function applyColor(cb){
    try{
      var W=img.naturalWidth,H=img.naturalHeight;
      if(W&&H){
        var cvs=document.createElement('canvas');
        cvs.width=W;cvs.height=H;
        var ctx=cvs.getContext('2d');
        ctx.drawImage(img,0,0);
        var d=ctx.getImageData(0,0,W,H),px=d.data;
        var cs=[[0,0],[W-1,0],[0,H-1],[W-1,H-1],[Math.floor(W/2),0],[Math.floor(W/2),H-1]];
        var bgR=0,bgG=0,bgB=0;
        for(var ci=0;ci<cs.length;ci++){var p4=(cs[ci][1]*W+cs[ci][0])*4;bgR+=px[p4];bgG+=px[p4+1];bgB+=px[p4+2];}
        bgR/=cs.length;bgG/=cs.length;bgB/=cs.length;
        var rS=0,gS=0,bS=0,n=0;
        for(var i=0;i<px.length;i+=4){
          var r=px[i],g=px[i+1],b=px[i+2];
          var dr=r-bgR,dg=g-bgG,db=b-bgB,dSq=dr*dr+dg*dg+db*db;
          if(dSq>80*80){var mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn>30){rS+=r;gS+=g;bS+=b;n++;}}
        }
        if(n>0){
          var hx=function(v){return('0'+Math.round(v).toString(16)).slice(-2);};
          var col='#'+hx(rS/n)+hx(gS/n)+hx(bS/n);
          var t=document.getElementById('pdf-vivo-text');
          if(t){t.setAttribute('fill',col);t.style.filter='drop-shadow(0 0 5px '+col+'88)';}
        }
      }
    }catch(e){}
    if(cb)cb();
  }
  function doPrint(){window.print();window.onfocus=function(){setTimeout(function(){window.close();},400);};}
  function run(){applyColor(inIframe?null:doPrint);}
  if(!img){if(!inIframe)doPrint();return;}
  if(img.complete&&img.naturalWidth){run();}
  else{img.onload=run;img.onerror=function(){if(!inIframe)doPrint();};}
};
<\/script>
</head><body>
<div class="page">
<div class="hdr">
  <div class="hdr-logo">
    <div class="hdr-brand-wrap">
      <div class="hdr-brand-top">
        <svg class="hdr-vivo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 36" width="68" height="32">
          <text id="pdf-vivo-text" x="1" y="30" font-family="'Arial Black','Arial Bold',Arial" font-weight="900" font-size="32" fill="#9333ea" letter-spacing="-1">vivo</text>
        </svg>
        <img id="pdf-mascote" class="hdr-mascote" src="${_origin}/mascote.png" height="44" alt="" onerror="this.style.display='none'">
      </div>
      <div class="hdr-brand-bottom">
        <div class="hdr-name">FinOps Manager</div>
        <div class="hdr-sub">Azure Cost Management</div>
      </div>
    </div>
  </div>
  <div class="hdr-mid"><div class="hdr-watermark">finops</div></div>
  <div class="hdr-r">
    <div class="hdr-tag">N&uacute;mero do Documento</div>
    <div class="hdr-num">${p.invoiceNum}</div>
    <div class="hdr-date">Emitido em ${p.dataFmt}</div>
  </div>
</div>
<div class="stripe"></div>
<div class="title-wrap">
  <div class="title-l">
    <div class="title-cap"><span class="title-cap-dot"></span>Estimativa de Custos Azure</div>
    <div class="title-main">${_esc(p.titulo)}</div>
  </div>
  <div class="title-r"><span class="status-badge">Estimativa</span></div>
</div>
<div class="meta">
  <div class="mc">
    <div class="mc-lbl">Projeto</div>
    <div class="mc-val">${_esc((p.nomeProjeto || '').split('·')[0].trim())}</div>
    ${p.resp ? '<div class="mc-sub">Respons&aacute;vel: <strong>' + _esc(p.resp) + '</strong></div>' : ''}
  </div>
  <div class="mc">
    <div class="mc-lbl">Validade do Documento</div>
    <div class="mc-val">${p.dataFmt}</div>
    <div class="mc-sub">V&aacute;lido at&eacute; ${p.dataValid}</div>
  </div>
  <div class="mc mc-total">
    <div class="mc-lbl">Total Estimado (BRL)</div>
    <div class="mc-val">${_brl(totalFinal)}</div>
    <div class="mc-sub">${(p.itens || []).length} recurso${(p.itens || []).length !== 1 ? 's' : ''} analisado${(p.itens || []).length !== 1 ? 's' : ''}</div>
  </div>
</div>
${periodosHtml}
<div class="sec-hdr">
  <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><rect x="1" y="1" width="6" height="6" rx="1" fill="#0d0f14"/><rect x="9" y="1" width="6" height="6" rx="1" fill="#0d0f14" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1" fill="#0d0f14" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="#0d0f14" opacity=".4"/></svg>
  <span>Detalhamento por Recurso</span>
</div>
<table>
  <thead>
    <tr>
      <th>Recurso</th>
      <th>Categoria</th>
      <th style="text-align:right">Horas Estimadas</th>
      <th style="text-align:right">Custo / Hora</th>
      <th style="text-align:right">Estimativa BRL</th>
    </tr>
  </thead>
  <tbody>${linhas}</tbody>
  <tfoot>
    <tr class="tr-sub"><td colspan="4">Subtotal Estimado</td><td>${_brl(p.total_brl || 0)}</td></tr>
    ${(p.pct_imposto || 0) > 0 ? '<tr class="tr-add"><td colspan="4">+ Imposto (' + p.pct_imposto + '%)</td><td>' + _brl(p.vl_imposto || 0) + '</td></tr>' : ''}
    ${(p.pct_cond || 0) > 0 ? '<tr class="tr-add"><td colspan="4">+ Condom&iacute;nio (' + p.pct_cond + '%)</td><td>' + _brl(p.vl_cond || 0) + '</td></tr>' : ''}
    <tr class="tr-total"><td colspan="4">Total Estimado</td><td>${_brl(totalFinal)}</td></tr>
  </tfoot>
</table>
${p.obs ? '<div class="obs"><div class="obs-lbl">Observa&ccedil;&otilde;es</div><div class="obs-txt">' + _esc(p.obs) + '</div></div>' : ''}
<div class="disc">
  <div class="disc-bar"></div>
  <div class="disc-txt">
    <strong>Documento de Estimativa &mdash; N&atilde;o constitui cobran&ccedil;a.</strong>
    Este documento &eacute; uma estimativa de custos gerada com base nos dados hist&oacute;ricos do Azure Cost Management.
    Os valores apresentados s&atilde;o aproximados e podem sofrer altera&ccedil;&otilde;es em fun&ccedil;&atilde;o de varia&ccedil;&otilde;es no consumo,
    ajustes de pre&ccedil;os da Microsoft, oscila&ccedil;&otilde;es cambiais, tributa&ccedil;&otilde;es aplic&aacute;veis e demais fatores operacionais.
    Esta estimativa n&atilde;o representa uma fatura, contrato ou compromisso financeiro formal.
  </div>
</div>
<div class="foot">
  <div class="foot-l">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 36" width="36" height="16" style="opacity:.7">
      <text x="1" y="28" font-family="'Arial Black','Arial Bold',Arial" font-weight="900" font-size="28" fill="#9333ea" letter-spacing="-1">vivo</text>
    </svg>
    <span class="foot-dot"></span>
    <span>FinOps Manager</span>
    <span class="foot-dot"></span>
    <span>Estimativa sujeita a altera&ccedil;&otilde;es</span>
  </div>
  <div class="foot-r">${p.invoiceNum} &middot; ${new Date().toLocaleString('pt-BR')}</div>
</div>
</div></body></html>`;
  }

  function gerarInvoicePDF() {
    if (!_estimativa || !_estimativa.resultados.length) {
      _toast('Selecione recursos e gere a estimativa primeiro.', 'error'); return;
    }
    const sel     = document.getElementById('cinv-projeto');
    const titulo  = document.getElementById('cinv-titulo')?.value?.trim()   || 'Estimativa de Custos Azure';
    const dataVal = document.getElementById('cinv-data')?.value             || new Date().toISOString().slice(0,10);
    const resp    = document.getElementById('cinv-resp')?.value?.trim()     || '';
    const valDias = parseInt(document.getElementById('cinv-validade')?.value) || 30;
    const obs     = document.getElementById('cinv-obs')?.value?.trim()      || '';

    if (!sel?.value) { _toast('Selecione um projeto.', 'error'); return; }

    const projetoId   = sel.value;
    const nomeProjeto = sel.selectedOptions[0]?.text || '';
    const dataFmt     = new Date(dataVal + 'T12:00:00').toLocaleDateString('pt-BR');
    const dataValid   = new Date(new Date(dataVal + 'T12:00:00').getTime() + valDias * 86400000).toLocaleDateString('pt-BR');
    const invoiceNum  = 'EST-' + Date.now().toString().slice(-6);
    const itens       = _estimativa.resultados;

    // Salvar estimativa no banco (fire-and-forget)
    _api('POST', '/estimativas', {
      projeto_id:      projetoId || null,
      projeto_nome:    nomeProjeto,
      numero:          invoiceNum,
      titulo,
      responsavel:     resp,
      validade_dias:   valDias,
      data_estimativa: dataVal,
      horas:           _estimativa.horas,
      pct_imposto:     _estimativa.pct_imposto,
      pct_cond:        _estimativa.pct_cond,
      vl_imposto:      _estimativa.vl_imposto,
      vl_cond:         _estimativa.vl_cond,
      total_brl:       _estimativa.total_brl,
      total_final:     _estimativa.total_final,
      observacoes:     obs,
      recursos:        _estimativa.resultados
    }).catch(() => {});

    const html = _buildPDFHtml({
      invoiceNum, dataFmt, titulo, dataValid, nomeProjeto, resp, obs, itens,
      total_brl:   _estimativa.total_brl,
      total_final: _estimativa.total_final,
      pct_imposto: _estimativa.pct_imposto,
      vl_imposto:  _estimativa.vl_imposto,
      pct_cond:    _estimativa.pct_cond,
      vl_cond:     _estimativa.vl_cond,
      periodos:    _periodos.length > 0 ? [..._periodos] : null
    });


    fecharInvoice();
    _abrirPreviewModal(html, titulo + ' · ' + invoiceNum);
    _toast('Estimativa gerada: ' + invoiceNum, 'success');
  }

  function gerarPDFSalvo(e) {
    const dataVal   = e.data_estimativa ? String(e.data_estimativa).slice(0,10) : new Date().toISOString().slice(0,10);
    const dataFmt   = new Date(dataVal + 'T12:00:00').toLocaleDateString('pt-BR');
    const valDias   = parseInt(e.validade_dias) || 30;
    const dataValid = new Date(new Date(dataVal + 'T12:00:00').getTime() + valDias * 86400000).toLocaleDateString('pt-BR');
    const html = _buildPDFHtml({
      invoiceNum:  e.numero || 'EST-000000',
      dataFmt, dataValid,
      nomeProjeto: e.projeto_nome || '',
      titulo:      e.titulo || 'Estimativa de Custos Azure',
      resp:        e.responsavel || '',
      obs:         e.observacoes || '',
      itens:       Array.isArray(e.recursos) ? e.recursos : [],
      total_brl:   parseFloat(e.total_brl || 0),
      total_final: parseFloat(e.total_final || 0),
      pct_imposto: parseFloat(e.pct_imposto || 0),
      vl_imposto:  parseFloat(e.vl_imposto || 0),
      pct_cond:    parseFloat(e.pct_cond || 0),
      vl_cond:     parseFloat(e.vl_cond || 0)
    });
    _abrirPreviewModal(html, (e.titulo || 'Estimativa') + ' · ' + (e.numero || ''));
  }

  // ── Preview modal ─────────────────────────────────────────────────
  function _abrirPreviewModal(html, title) {
    const modal = document.getElementById('cinv-preview-modal');
    const frame = document.getElementById('cinv-preview-frame');
    const titleEl = document.getElementById('cinv-preview-title');
    if (!modal || !frame) return;
    if (titleEl) titleEl.textContent = title || '';
    frame.style.minHeight = '80vh';
    frame.srcdoc = html;
    // after content loads, expand iframe to full document height (no inner scrollbar)
    frame.onload = function() {
      try {
        const h = frame.contentDocument.documentElement.scrollHeight;
        if (h > 200) frame.style.minHeight = h + 'px';
      } catch(e) {}
    };
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function fecharPreviewModal() {
    const modal = document.getElementById('cinv-preview-modal');
    const frame = document.getElementById('cinv-preview-frame');
    if (modal) modal.style.display = 'none';
    if (frame) frame.srcdoc = '';
    document.body.style.overflow = '';
  }

  function voltarParaConfirmacao() {
    fecharPreviewModal();
    const m = document.getElementById('cinv-modal');
    if (m) m.style.display = 'flex';
  }

  function imprimirEstimativa() {
    const frame = document.getElementById('cinv-preview-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.print();
    }
  }

  // ── Purge / Limpeza de dados ─────────────────────────────────────
  async function abrirPurge() {
    const modal = document.getElementById('cpurge-modal');
    const sel   = document.getElementById('cpurge-sel');
    const res   = document.getElementById('cpurge-result');
    if (!modal) return;

    res.style.display = 'none';
    sel.innerHTML = '<option value="">— Todos os dados —</option>';

    // Carregar lista de arquivos importados
    try {
      const data = await _api('GET', '/azure-costs/imports');
      if (Array.isArray(data) && data.length) {
        data.forEach(imp => {
          const opt = document.createElement('option');
          opt.value = imp.arquivo_origem;
          const ini = (imp.periodo_inicio || '').slice(0, 10);
          const fim = (imp.periodo_fim   || '').slice(0, 10);
          opt.textContent = `${imp.arquivo_origem}  (${imp.linhas} linhas · ${ini} → ${fim})`;
          sel.appendChild(opt);
        });
      }
    } catch (_) {}

    modal.style.display = 'flex';
  }

  function fecharPurge() {
    const modal = document.getElementById('cpurge-modal');
    if (modal) modal.style.display = 'none';
  }

  async function executarPurge() {
    const sel     = document.getElementById('cpurge-sel');
    const res     = document.getElementById('cpurge-result');
    const arquivo = sel ? sel.value.trim() : '';

    res.style.display  = 'block';
    res.style.background = 'rgba(147,51,234,.08)';
    res.style.color    = 'var(--accent)';
    res.style.border   = '1px solid rgba(147,51,234,.2)';
    res.textContent    = 'Limpando dados...';

    try {
      const url   = arquivo
        ? `/azure-costs/purge?arquivo=${encodeURIComponent(arquivo)}`
        : '/azure-costs/purge';
      const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';

      const r = await fetch(window.location.origin + '/api' + url, {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      });

      // Leitura segura: verifica Content-Type antes de parsear JSON
      const ct   = r.headers.get('content-type') || '';
      let data;
      if (ct.includes('application/json')) {
        data = await r.json();
      } else {
        const text = await r.text();
        // Se retornou HTML (rota não encontrada), abortar com mensagem clara
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          throw new Error('Rota não encontrada no servidor. Verifique se o server.js foi atualizado e reiniciado.');
        }
        try { data = JSON.parse(text); } catch (_) { throw new Error(`Resposta inesperada: ${text.slice(0,120)}`); }
      }

      if (!r.ok) throw new Error(data?.error || `Erro HTTP ${r.status}`);

      res.style.background = 'rgba(147,51,234,.08)';
      res.style.color      = 'var(--accent)';
      res.style.border     = '1px solid rgba(147,51,234,.3)';
      res.textContent      = `✅ ${data.message}`;

      // Limpar estado local
      _recursos = []; _selecionados = {}; _subAtual = ''; _rgAtual = '';
      _subsSel = []; _rgsSel = [];
      _dds.csub.selected.clear(); _dds.crg.selected.clear();
      _atualizarBadge('csub'); _atualizarBadge('crg');

      setTimeout(() => {
        fecharPurge();
        _renderRecursos();
        _resetRes();
        _carregarSubscriptions();
        _toast('Dados removidos! Reimporte o arquivo .parquet.', 'success');
      }, 2200);

    } catch (err) {
      res.style.background = 'rgba(255,77,106,.1)';
      res.style.color      = '#ff4d6a';
      res.style.border     = '1px solid rgba(255,77,106,.3)';
      res.textContent      = `❌ ${err.message}`;
    }
  }

  // ── Diagnóstico ────────────────────────────────────────────────────────────
  let _diagDados = [];

  async function abrirDiagnostico() {
    const modal = document.getElementById('cdiag-modal');
    modal.style.display = 'flex';
    const tbody = document.getElementById('cdiag-tbody');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);">Carregando dados...</td></tr>';

    try {
      _diagDados = await _api('GET', '/calculadora/diagnostico');

      // Preencher selects de filtro
      const charges = [...new Set(_diagDados.map(r => r.charge_type).filter(Boolean))].sort();
      const uoms    = [...new Set(_diagDados.map(r => r.unit_of_measure).filter(Boolean))].sort();

      const selCharge = document.getElementById('cdiag-charge');
      const selUom    = document.getElementById('cdiag-uom');
      selCharge.innerHTML = '<option value="">Todos charge_type</option>' +
        charges.map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
      selUom.innerHTML = '<option value="">Todos unit_of_measure</option>' +
        uoms.map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');

      _diagRenderizar(_diagDados);
    } catch(err) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:#ff4d6a;">Erro: ${_esc(err.message)}</td></tr>`;
    }
  }

  function fecharDiagnostico() {
    document.getElementById('cdiag-modal').style.display = 'none';
  }

  function _diagFiltrar() {
    const busca  = (document.getElementById('cdiag-busca')?.value  || '').toLowerCase();
    const charge = (document.getElementById('cdiag-charge')?.value || '');
    const uom    = (document.getElementById('cdiag-uom')?.value    || '');

    const filtrado = _diagDados.filter(r => {
      if (charge && r.charge_type    !== charge) return false;
      if (uom    && r.unit_of_measure !== uom)   return false;
      if (busca) {
        const txt = [r.meter_category, r.meter_sub_category, r.consumed_service,
                     r.charge_type, r.unit_of_measure, r.pricing_model, r.publisher_type]
                    .join(' ').toLowerCase();
        if (!txt.includes(busca)) return false;
      }
      return true;
    });
    _diagRenderizar(filtrado);
  }

  function _diagRenderizar(lista) {
    const tbody = document.getElementById('cdiag-tbody');
    const cnt   = document.getElementById('cdiag-cnt');
    if (cnt) cnt.textContent = `${lista.length} combinações`;

    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted);">Nenhum resultado.</td></tr>';
      return;
    }

    const _c = v => `<td style="padding:7px 10px;border-bottom:1px solid var(--border);color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;" title="${_esc(v||'')}">${_esc(v||'—')}</td>`;
    const _n = v => `<td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-family:'IBM Plex Mono',monospace;color:var(--text-dim);">${_esc(String(v||'0'))}</td>`;
    const _m = v => `<td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-family:'IBM Plex Mono',monospace;color:var(--accent);">${_brl(parseFloat(v)||0)}</td>`;

    tbody.innerHTML = lista.map(r => `<tr>
      ${_c(r.meter_category)}
      ${_c(r.meter_sub_category)}
      ${_c(r.consumed_service)}
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);">
        <span style="padding:2px 7px;border-radius:8px;font-size:10px;font-weight:600;
          background:${r.charge_type==='Usage'?'rgba(147,51,234,.1)':r.charge_type==='Purchase'?'rgba(255,140,66,.1)':'rgba(77,166,255,.1)'};
          color:${r.charge_type==='Usage'?'var(--accent)':r.charge_type==='Purchase'?'var(--orange,#ff8c42)':'var(--blue,#4da6ff)'};">
          ${_esc(r.charge_type||'—')}
        </span>
      </td>
      ${_c(r.unit_of_measure)}
      ${_c(r.pricing_model)}
      ${_c(r.publisher_type)}
      ${_n(r.recursos)}
      ${_n(Number(r.linhas).toLocaleString('pt-BR'))}
      ${_m(r.total_billing)}
    </tr>`).join('');
  }

  // ── Atualiza painel de estimativa direito ───────────────────────
  function _atualizarEstimativa() {
    const sel    = Object.keys(_selecionados);
    const lista  = document.getElementById('cresumo-lista');
    const vazio  = document.getElementById('cresumo-vazio');
    const rodape = document.getElementById('crodape');
    const ctotal = document.getElementById('ctotal');
    if (!lista) return;

    if (!sel.length) {
      lista.innerHTML = '';
      if (vazio)  vazio.style.display  = 'block';
      if (rodape) rodape.style.display = 'none';
      return;
    }

    if (vazio) vazio.style.display = 'none';
    if (rodape) rodape.style.display = 'flex';

    let totalGeral   = 0;
    let totalCobrado = 0;

    lista.innerHTML = sel.map(rid => {
      const r   = _recursos.find(x => (x._key||x.resource_id) === rid);
      if (!r) return '';
      const nome = r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,40);
      const isBRL = (r.moeda || 'BRL') === 'BRL';
      const bill  = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0) * _taxaBrl;
      totalCobrado += bill;
      const uom   = (r.unidade || '').toLowerCase();
      const isHora = uom.includes('hour') || uom.includes('hora');
      const horas  = _selecionados[rid] || 720;
      let estimado, desc, cor;

      const chora = parseFloat(r.custo_hora_billing || 0);
      const choraRel = isBRL ? chora : chora * _taxaBrl;
      estimado = choraRel * horas;
      desc = _brl(choraRel) + '/h × ' + horas + 'h';
      cor = isHora ? 'var(--accent)' : 'var(--blue)';

      totalGeral += estimado;

      return '<div style="padding:8px 10px;border-radius:6px;background:var(--bg-hover);border:1px solid var(--border);">'
        + '<div style="font-size:11px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;" title="' + _esc(nome) + '">' + _esc(nome) + '</div>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">'
        + '<span style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(desc) + '</span>'
        + '<span style="font-family:IBM Plex Mono,monospace;font-size:11px;font-weight:600;color:' + cor + ';white-space:nowrap;">' + _brl(estimado) + '</span>'
        + '</div>'
        + '</div>';
    }).join('');

    const pctImposto = parseFloat(document.getElementById('cimposto')?.value) || 0;
    const pctCond    = parseFloat(document.getElementById('ccondominио')?.value) || 0;
    const vlImposto  = totalGeral * pctImposto / 100;
    const vlCond     = totalGeral * pctCond    / 100;
    const totalFinal = totalGeral + vlImposto + vlCond;

    // Atualizar subtotais no rodapé
    const elCobrado = document.getElementById('ctotal-cobrado');
    if (elCobrado) elCobrado.textContent = _brl(totalCobrado);

    const elSub  = document.getElementById('ctotal-sub');
    if (elSub) elSub.textContent = _brl(totalGeral);

    const rowImp = document.getElementById('ctotal-imposto-row');
    const lblImp = document.getElementById('ctotal-imposto-label');
    const valImp = document.getElementById('ctotal-imposto-val');
    if (rowImp) rowImp.style.display = pctImposto > 0 ? 'flex' : 'none';
    if (lblImp) lblImp.textContent = '+ Imposto (' + pctImposto + '%)';
    if (valImp) valImp.textContent = _brl(vlImposto);

    const rowCond = document.getElementById('ctotal-cond-row');
    const lblCond = document.getElementById('ctotal-cond-label');
    const valCond = document.getElementById('ctotal-cond-val');
    if (rowCond) rowCond.style.display = pctCond > 0 ? 'flex' : 'none';
    if (lblCond) lblCond.textContent = '+ Condomínio (' + pctCond + '%)';
    if (valCond) valCond.textContent = _brl(vlCond);

    if (ctotal) ctotal.textContent = _brl(totalFinal);

    // Salvar para uso no invoice
    _estimativa = {
      total_cobrado: totalCobrado,
      total_brl: totalGeral,
      total_final: totalFinal,
      pct_imposto: pctImposto,
      vl_imposto: vlImposto,
      pct_cond: pctCond,
      vl_cond: vlCond,
      horas: parseInt(document.getElementById('chglobal')?.value) || 720,
      resultados: sel.map(rid => {
        const r   = _recursos.find(x => (x._key||x.resource_id) === rid);
        if (!r) return null;
        const isBRL  = (r.moeda || 'BRL') === 'BRL';
        const bill   = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0) * _taxaBrl;
        const isHora = !_isConsumo(r);
        const horas  = _selecionados[rid] || 720;
        const choraRaw = parseFloat(r.custo_hora_billing || 0);
        const chora    = isBRL ? choraRaw : choraRaw * _taxaBrl;
        const estimado = chora * horas;
        return {
          resource_id: rid,
          nome: r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,50),
          categoria: r.categoria || '',
          consumed_service: r.consumed_service || '',
          resource_group: r.resource_group_name || '',
          uom: r.unidade || '',
          isHora,
          horas,
          custo_hora: chora,
          dias_ativos: parseInt(r.dias_ativos) || 0,
          total_cobrado: bill,
          estimado_brl: estimado,
          moeda: r.moeda || 'BRL',
        };
      }).filter(Boolean)
    };

    // atualiza overlay se estiver visível
    _ovAtualizarTotal();
  }

  // ── Config step overlay ──────────────────────────────────────────
  function _abrirConfigStep() {
    const sel = Object.keys(_selecionados);
    if (!sel.length) { _toast('Selecione pelo menos um recurso para estimar.', 'error'); return; }

    // mostra o modal PRIMEIRO para que _ovAtualizarTotal possa encontrá-lo
    const modal = document.getElementById('covmodal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // atualiza contagem no toolbar do overlay
    const cntEl = document.getElementById('cov-cnt');
    if (cntEl) cntEl.textContent = sel.length + ' recurso' + (sel.length === 1 ? '' : 's') + ' selecionado' + (sel.length === 1 ? '' : 's');

    // renderiza cards e totais (modal já visível)
    _ovRenderRecursos();
    _ovAtualizarTotal();
  }

  function _fecharConfigStep() {
    const modal = document.getElementById('covmodal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function _ovRenderRecursos() {
    const container = document.getElementById('cov-recursos');
    if (!container) return;
    const sel = Object.keys(_selecionados);
    container.innerHTML = sel.map(rid => {
      const r = _recursos.find(x => (x._key || x.resource_id) === rid);
      if (!r) return '';
      const nome     = r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0, 60);
      const subtit   = r.produto || r.subcategoria || r.regiao || '';
      const isBRL    = (r.moeda || 'BRL') === 'BRL';
      const uom      = (r.unidade || '').toLowerCase();
      const isHora   = uom.includes('hour') || uom.includes('hora');
      const horas    = _selecionados[rid] || 720;
      const choraRaw = parseFloat(r.custo_hora_billing || 0);
      const chora    = isBRL ? choraRaw : choraRaw * _taxaBrl;
      const estimado = chora * horas;
      const bill     = isBRL ? parseFloat(r.total_billing || 0) : parseFloat(r.total_billing || 0) * _taxaBrl;
      const qty      = parseFloat(r.total_qty || 0).toLocaleString('pt-BR', {maximumFractionDigits: 4});
      const cor      = isHora ? 'var(--accent)' : 'var(--blue)';
      const uomLabel = isHora ? '/h' : '/h*';
      const cat      = _esc(r.categoria || '');
      const svc      = _esc(r.consumed_service || '');
      const rg       = _esc(r.resource_group_name || '');
      const ct       = r.charge_type || '';
      const ctColor  = ct === 'Usage'
        ? 'background:rgba(147,51,234,.1);color:var(--accent)'
        : 'background:rgba(77,166,255,.1);color:var(--blue)';
      const pm       = _esc(r.pricing_model || '');

      return '<div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:10px;padding:12px 14px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'var(--border-light)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'

        // Nome + subtítulo
        + '<div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px;" title="' + _esc(r.resource_id || nome) + '">' + _esc(nome) + '</div>'
        + (subtit ? '<div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;">' + _esc(subtit) + '</div>' : '<div style="margin-bottom:6px;"></div>')

        // Badges: categoria, charge_type, rg, consumed_service
        + '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">'
        + (cat ? '<span style="font-size:10px;background:var(--accent-dim);color:var(--text-dim);border-radius:4px;padding:2px 7px;">' + cat + '</span>' : '')
        + (ct  ? '<span style="font-size:10px;border-radius:4px;padding:2px 7px;' + ctColor + ';">' + _esc(ct) + '</span>' : '')
        + (rg  ? '<span style="font-size:10px;background:rgba(77,166,255,.08);color:var(--blue);border-radius:4px;padding:2px 7px;">' + rg + '</span>' : '')
        + (svc ? '<span style="font-size:10px;background:var(--bg-card);color:var(--text-dim);border-radius:4px;padding:2px 7px;border:1px solid var(--border);">' + svc + '</span>' : '')
        + '</div>'

        // Linha de metadados (unidade · qty · pricing_model)
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:10px;color:var(--text-muted);">'
        + (r.unidade ? '<span><span style="opacity:.6;">UoM</span> ' + _esc(r.unidade) + '</span>' : '')
        + (qty !== '0' ? '<span><span style="opacity:.6;">Qtd</span> ' + qty + '</span>' : '')
        + (pm ? '<span><span style="opacity:.6;">Modelo</span> ' + pm + '</span>' : '')
        + '</div>'

        // Grid de valores: custo/h · horas · cobrado · estimado
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">Custo/h</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:' + cor + ';">' + _brl(chora) + uomLabel + '</div>'
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">Horas</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:var(--accent);">' + horas + 'h</div>'
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">Cobrado</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:600;color:var(--text-dim);">' + (bill > 0 ? _brl(bill) : '—') + '</div>'
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;border:1px solid var(--accent-glow);">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">Estimado</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:var(--green);">' + _brl(estimado) + '</div>'
        + '</div>'

        + '</div>'
        + '</div>';
    }).join('');
  }

  function _ovAtualizarTotal() {
    const modal = document.getElementById('covmodal');
    if (!modal || modal.style.display === 'none') return;
    if (!_estimativa) return;
    const sub  = document.getElementById('cov-sub');
    const ri   = document.getElementById('cov-row-imp');
    const li   = document.getElementById('cov-lbl-imp');
    const vi   = document.getElementById('cov-vl-imp');
    const rc   = document.getElementById('cov-row-cond');
    const lc   = document.getElementById('cov-lbl-cond');
    const vc   = document.getElementById('cov-vl-cond');
    const tot  = document.getElementById('cov-total');
    if (sub) sub.textContent = _brl(_estimativa.total_brl);
    if (ri)  ri.style.display  = _estimativa.pct_imposto > 0 ? 'flex' : 'none';
    if (li)  li.textContent    = '+ Imposto (' + _estimativa.pct_imposto + '%)';
    if (vi)  vi.textContent    = _brl(_estimativa.vl_imposto);
    if (rc)  rc.style.display  = _estimativa.pct_cond > 0 ? 'flex' : 'none';
    if (lc)  lc.textContent    = '+ Condomínio (' + _estimativa.pct_cond + '%)';
    if (vc)  vc.textContent    = _brl(_estimativa.vl_cond);
    if (tot) tot.textContent   = _brl(_estimativa.total_final);
  }

  function _ovAplicarHoras() {
    const v = document.getElementById('cov-horas')?.value;
    const el = document.getElementById('chglobal');
    if (el) el.value = v;
    aplicarHorasGlobal();
    _ovRenderRecursos();
  }

  function _ovImpostoChange(val) {
    const el = document.getElementById('cimposto');
    if (el) el.value = val;
    _atualizarEstimativa();
  }

  function _ovCondChange(val) {
    const el = document.getElementById('ccondominио');
    if (el) el.value = val;
    _atualizarEstimativa();
  }

  // ── Taxas: constantes e localStorage ────────────────────────────
  const _TAXA_IMP_DEF  = 18.65;
  const _TAXA_COND_DEF = 13.00;
  const _LS_IMP        = 'finops_taxa_imposto';
  const _LS_COND       = 'finops_taxa_cond';
  const _LS_IMP_PAD    = 'finops_taxa_imposto_padrao';
  const _LS_COND_PAD   = 'finops_taxa_cond_padrao';

  function _carregarTaxas() {
    const si = localStorage.getItem(_LS_IMP);
    const sc = localStorage.getItem(_LS_COND);
    const vi = si !== null ? parseFloat(si) : _TAXA_IMP_DEF;
    const vc = sc !== null ? parseFloat(sc) : _TAXA_COND_DEF;
    if (si === null) localStorage.setItem(_LS_IMP,  vi);
    if (sc === null) localStorage.setItem(_LS_COND, vc);
    if (!localStorage.getItem(_LS_IMP_PAD))  localStorage.setItem(_LS_IMP_PAD,  vi);
    if (!localStorage.getItem(_LS_COND_PAD)) localStorage.setItem(_LS_COND_PAD, vc);
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    if (ii) ii.value = vi;
    if (ic) ic.value = vc;
    _atualizarBadgesTaxas();
  }

  function _salvarTaxasPadrao() {
    const vi = parseFloat(document.getElementById('cimposto')?.value)    || 0;
    const vc = parseFloat(document.getElementById('ccondominио')?.value) || 0;
    localStorage.setItem(_LS_IMP,     vi);
    localStorage.setItem(_LS_COND,    vc);
    localStorage.setItem(_LS_IMP_PAD, vi);
    localStorage.setItem(_LS_COND_PAD,vc);
    _atualizarBadgesTaxas();
    _toast('Padrão salvo: Imposto ' + vi + '% · Condomínio ' + vc + '%', 'success');
  }

  function _resetarTaxas() {
    const vi = parseFloat(localStorage.getItem(_LS_IMP_PAD)  ?? _TAXA_IMP_DEF);
    const vc = parseFloat(localStorage.getItem(_LS_COND_PAD) ?? _TAXA_COND_DEF);
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    if (ii) ii.value = vi;
    if (ic) ic.value = vc;
    localStorage.setItem(_LS_IMP,  vi);
    localStorage.setItem(_LS_COND, vc);
    _atualizarBadgesTaxas();
    _onAdicionaisChange();
    _toast('Restaurado: Imposto ' + vi + '% · Condomínio ' + vc + '%');
  }

  // Atualiza badges — SEM mostrar linha de resumo
  function _atualizarBadgesTaxas() {
    const vi = parseFloat(document.getElementById('cimposto')?.value)    || 0;
    const vc = parseFloat(document.getElementById('ccondominио')?.value) || 0;
    const pi = parseFloat(localStorage.getItem(_LS_IMP_PAD)  ?? _TAXA_IMP_DEF);
    const pc = parseFloat(localStorage.getItem(_LS_COND_PAD) ?? _TAXA_COND_DEF);
    const bi = document.getElementById('cimposto-padrao-badge');
    const bc = document.getElementById('ccond-padrao-badge');
    if (bi) bi.style.display = Math.abs(vi - pi) < 0.001 ? 'inline' : 'none';
    if (bc) bc.style.display = Math.abs(vc - pc) < 0.001 ? 'inline' : 'none';
    // ctaxas-info mantido oculto — linha de resumo removida
    const info = document.getElementById('ctaxas-info');
    if (info) info.style.display = 'none';
  }

  function _onAdicionaisChange() {
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    if (ii) localStorage.setItem(_LS_IMP,  ii.value);
    if (ic) localStorage.setItem(_LS_COND, ic.value);
    _atualizarBadgesTaxas();
    _atualizarEstimativa();
  }

  function _custoHora(r, isBRL, taxaBrl) {
    const mono  = "font-family:'IBM Plex Mono',monospace;";
    const preco = isBRL ? parseFloat(r.custo_hora_billing || 0) : parseFloat(r.custo_hora_billing || 0) * taxaBrl;
    const uom   = (r.unidade || '').toLowerCase();
    const isH   = uom.includes('hour') || uom.includes('hora');
    const label = isH ? '/h' : '/h*';
    return '<div style="' + mono + 'font-size:11px;color:var(--accent);white-space:nowrap;">' + _brl(preco) + '</div>'
         + '<div style="font-size:9px;color:var(--text-muted);">' + label + '</div>';
  }

  return { init, onSubChange, onRgChange, onFiltroChange, onTaxaChange, onBusca, buscarRecursos,
           selecionarTodos, deselecionarTodos, aplicarHorasGlobal, calcular,
           _check, _checkAll, _checkGrupo, _toggleGrupo, _horasChange, _setH, _onSlider, _onHorasInput,
           _toggleDropdown, _toggleOpcao, _filtrarDropdown,
           _selecionarTodosDropdown, _limparDropdown, _confirmarSub, _confirmarRg,
           _onAdicionaisChange, _salvarTaxasPadrao, _resetarTaxas,
           _setModoHoras, _calcHorasPeriodo, _sincDataFim, _sincHoraFim, _incluirPeriodo, _removerPeriodo,
           abrirPurge, fecharPurge, executarPurge,
           abrirDiagnostico, fecharDiagnostico, _diagFiltrar,
           abrirInvoice, fecharInvoice, gerarInvoicePDF, gerarPDFSalvo,
           fecharPreviewModal, voltarParaConfirmacao, imprimirEstimativa,
           _abrirConfigStep, _fecharConfigStep, _ovAplicarHoras, _ovImpostoChange, _ovCondChange };
})();
