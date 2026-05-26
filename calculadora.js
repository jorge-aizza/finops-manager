// ═══════════════════════════════════════════════════════════════════
// calculadora.js — Calculadora de Custo/Hora Azure  v2
// Injeta conteúdo dentro de #view-calculadora (já presente no index)
// ═══════════════════════════════════════════════════════════════════
const Calculadora = (() => {

  let _recursos     = [];
  let _dadosDetalhe = [];   // linhas brutas para a visão "Por Data"
  let _dadosServico = [];   // linhas brutas para a visão "Por Serviço"
  let _modoVisao    = 'recursos'; // 'recursos' | 'detalhe' | 'servico'
  let _selecionados = {};
  let _periodos       = [];   // [{inicio, fim, horas, label}]
  let _horasAplicadas = false; // true somente após Aplicar (HORAS) ou Incluir Período
  let _horasPeriodoValidas = false; // true quando datas/horas do período formam intervalo > 0
  let _subsSel      = [];   // subscription_ids selecionados
  let _rgsSel       = [];   // resource_group_names selecionados
  let _subAtual     = '';   // compat legada
  let _rgAtual      = '';   // compat legada
  let _dataInicio   = '';
  let _dataFim      = '';
  let _taxaBrl      = 5.70;
  let _estimativa   = null;
  let _filtroTexto    = '';
  let _reconciliacao  = null;
  let _azureRefValue  = 0;
  let _iniciado     = false;

  // ── API helper ───────────────────────────────────────────────────
  async function _api(method, path, body) {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(window.location.origin + '/api' + path, opts);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Servidor retornou HTTP ${r.status} — reinicie o servidor e tente novamente.`);
    }
    return r.json();
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
<div style="padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
  <div style="font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted);margin-bottom:3px;">Azure Cost Management</div>
  <h2 style="font-size:1.2rem;font-weight:700;margin:0;">Calculadora de Custo / Hora</h2>
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

<!-- PAINEL DE IMPORTAÇÃO — notificação flutuante -->
<div id="cimport-panel" style="display:none;position:fixed;bottom:60px;right:16px;z-index:9998;width:300px;background:var(--bg-card,#1a1e28);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.55);padding:14px 16px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;">
    <span id="cimport-title" style="font-size:12px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Importando...</span>
    <span id="cimport-geral-pct" style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--text-muted);flex-shrink:0;"></span>
    <button id="cimport-close" onclick="fecharPainelImport()" style="display:none;background:none;border:1px solid var(--border);border-radius:5px;color:var(--text-muted);width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1;padding:0;flex-shrink:0;">✕</button>
  </div>
  <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:8px;">
    <div id="cimport-geral-fill" style="height:100%;width:0%;background:var(--accent);transition:width .4s;border-radius:2px;"></div>
  </div>
  <div id="cimport-arquivo-atual" style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:13px;"></div>
  <div id="cimport-resumo" style="display:none;font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.6;border-top:1px solid var(--border);padding-top:6px;"></div>
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
      <!-- toggle visão -->
      <div style="display:flex;gap:2px;background:rgba(255,255,255,.06);border-radius:7px;padding:2px;flex-shrink:0;">
        <button id="cvtab-rec" onclick="Calculadora._switchVisao('recursos')"
          style="padding:4px 13px;font-size:11px;font-weight:600;border-radius:5px;border:none;cursor:pointer;background:var(--accent);color:#fff;transition:all .15s;">
          Recursos
        </button>
        <button id="cvtab-det" onclick="Calculadora._switchVisao('detalhe')"
          style="padding:4px 13px;font-size:11px;font-weight:600;border-radius:5px;border:none;cursor:pointer;background:transparent;color:var(--text-muted);transition:all .15s;">
          Por Data
        </button>
        <button id="cvtab-svc" onclick="Calculadora._switchVisao('servico')"
          style="padding:4px 13px;font-size:11px;font-weight:600;border-radius:5px;border:none;cursor:pointer;background:transparent;color:var(--text-muted);transition:all .15s;">
          Por Serviço
        </button>
      </div>
      <button id="cbtn-estimar" onclick="Calculadora._abrirConfigStep()" disabled
        style="display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:32px;border-radius:6px;border:none;background:var(--border);color:var(--text-muted);font-size:12px;font-weight:700;cursor:not-allowed;opacity:.5;transition:all .2s;white-space:nowrap;flex-shrink:0;">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Estimar
      </button>
    </div>
    <!-- Visão: Recursos (padrão) -->
    <div id="crecursos-wrap" style="flex:1;overflow-y:auto;">
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
            <th class="cth" style="text-align:right;" title="Hora → taxa real (effective_price)&#10;Reserva → amortizado pelo term&#10;Período → custo mensal estimado">Custo/h · /mês</th>
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

    <!-- Visão: Por Data (portal-style expandable) -->
    <div id="cdetalhe-wrap" style="display:none;flex:1;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;" id="cdetalhe-table">
        <thead style="position:sticky;top:0;z-index:2;background:var(--bg-card);">
          <tr>
            <th class="cth" style="width:28px;"></th>
            <th class="cth">Data</th>
            <th class="cth">Recurso</th>
            <th class="cth">Tipo</th>
            <th class="cth">Localização</th>
            <th class="cth">Resource Group</th>
            <th class="cth">Assinatura</th>
            <th class="cth" style="text-align:right;">Custo (BRL)</th>
          </tr>
        </thead>
        <tbody id="cdetalhe-tbody">
          <tr><td colspan="8" style="text-align:center;padding:50px 20px;color:var(--text-muted);font-size:13px;">
            Selecione filtros e clique em <strong style="color:var(--accent);">Buscar</strong>.
          </td></tr>
        </tbody>
      </table>
    </div>

    <!-- Visão: Por Serviço -->
    <div id="csvc-wrap" style="display:none;flex:1;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;" id="csvc-table">
        <thead style="position:sticky;top:0;z-index:2;background:var(--bg-card);">
          <tr>
            <th class="cth" style="width:36px;text-align:center;">#</th>
            <th class="cth">Serviço (consumed_service)</th>
            <th class="cth" style="text-align:right;">Recursos</th>
            <th class="cth" style="text-align:right;">Resource Groups</th>
            <th class="cth" style="text-align:right;">Total (BRL)</th>
            <th class="cth" style="text-align:right;">% do Total</th>
          </tr>
        </thead>
        <tbody id="csvc-tbody">
          <tr><td colspan="6" style="text-align:center;padding:50px 20px;color:var(--text-muted);font-size:13px;">
            Selecione filtros e clique em <strong style="color:var(--accent);">Buscar</strong>.
          </td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Rodapé: custo total -->
  <div id="crodape-total" style="flex-shrink:0;border-top:1px solid var(--border);background:var(--bg-card);padding:7px 16px;display:none;align-items:center;gap:10px;">
    <button onclick="Calculadora.abrirReconciliacao()" title="Reconciliar com Azure Cost Management"
      style="display:flex;align-items:center;gap:5px;padding:0 10px;height:26px;border-radius:5px;border:1px solid var(--border-light);background:transparent;color:var(--text-muted);font-size:10px;font-weight:600;cursor:pointer;letter-spacing:.04em;white-space:nowrap;transition:all .15s;"
      onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
      onmouseout="this.style.borderColor='var(--border-light)';this.style.color='var(--text-muted)'">
      <svg viewBox="0 0 14 14" fill="none" width="11" height="11"><path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Reconciliar
    </button>
    <span id="crodape-nota" style="font-size:10px;color:var(--text-muted);"></span>
    <div style="flex:1;"></div>
    <span id="crodape-label" style="font-size:11px;color:var(--text-muted);"></span>
    <span id="crodape-valor" style="font-size:15px;font-weight:700;color:var(--accent);font-family:'IBM Plex Mono',monospace;letter-spacing:.02em;"></span>
  </div>

<!-- ═══ MODAL RECONCILIAÇÃO ═══════════════════════════════════════════ -->
<div id="crecon-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;width:min(96vw,560px);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.6);">
    <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);">Azure Cost Management</div>
        <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:2px;">Reconciliação de Valores</div>
      </div>
      <button onclick="Calculadora.fecharReconciliacao()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);width:28px;height:28px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <div style="padding:18px 20px;overflow-y:auto;flex:1;">
      <div id="crecon-body">
        <div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">Carregando...</div>
      </div>
    </div>
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
          <input type="number" id="cinv-validade" class="ci" value="30" min="1" readonly
                 style="opacity:.55;cursor:not-allowed;background:var(--bg);" title="Validade padrão: 30 dias">
          <div style="margin-top:5px;font-size:11px;color:var(--text-muted);display:flex;align-items:flex-start;gap:5px;line-height:1.4;">
            <span style="color:var(--orange);font-size:13px;flex-shrink:0;">⚠</span>
            <span>Após 30 dias esta estimativa expira. Caso o ambiente ainda esteja necessário, uma nova solicitação deverá ser aberta.</span>
          </div>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label class="cl">Motivo da Solicitação <span style="color:var(--danger);font-size:13px">*</span></label>
        <textarea id="cinv-obs" class="ci" rows="2" style="height:60px;padding:8px 10px;resize:none;"
                  placeholder="Informe o motivo da solicitação do ambiente ligado..."></textarea>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);">
            Recursos Selecionados &nbsp;<span id="cselcnt" style="color:var(--accent);font-weight:600;font-size:11px;text-transform:none;letter-spacing:0;"></span>
          </div>
          <button onclick="(function(){var l=document.getElementById('cov-legenda');l.style.display=l.style.display==='none'?'grid':'none';})()"
            style="font-size:10px;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer;flex-shrink:0;"
            title="Mostrar/ocultar legenda">
            📖 Legenda
          </button>
        </div>

        <!-- Legenda colapsável -->
        <div id="cov-legenda" style="display:none;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;padding:12px;background:rgba(147,51,234,.05);border:1px solid var(--border);border-radius:10px;">

          <!-- Coluna 1 -->
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Fonte do Preço</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:11px;flex-shrink:0;margin-top:1px;">📋</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--green,#22c55e);">PL/h</strong> ou <strong style="color:var(--green,#22c55e);">PL/mês</strong> — preço on-demand do Azure Price List. Estimativa mais precisa.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:11px;flex-shrink:0;margin-top:1px;">💰</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--accent);">Custo/h</strong> ou <strong style="color:var(--orange,#ff8c42);">Custo/dia</strong> — média do billing histórico. Usado quando PL não disponível.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:11px;flex-shrink:0;margin-top:1px;">🔒</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--blue,#4da6ff);">Amort./h</strong> — custo amortizado da reserva (1 ou 3 anos). Estimado permanece fixo.</span>
            </div>

            <div style="margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Descontos</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;color:var(--green,#22c55e);font-weight:700;flex-shrink:0;margin-top:1px;">▼%</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;">Barra <strong style="color:var(--green,#22c55e);">verde</strong> — desconto negociado vs on-demand + economia no período.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;color:var(--blue,#4da6ff);font-weight:700;flex-shrink:0;margin-top:1px;">▼%</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;">Barra <strong style="color:var(--blue,#4da6ff);">azul</strong> — desconto da reserva vs on-demand. Indica retorno do compromisso.</span>
            </div>
          </div>

          <!-- Coluna 2 -->
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Indicadores</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;flex-shrink:0;margin-top:1px;">⚡</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--accent);">H.reais</strong> — horas que o recurso ficou ligado no período importado (qty × fator UoM). Só aparece para recursos com cobrança horária.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;flex-shrink:0;margin-top:1px;">⚠</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--orange,#ff8c42);">Uso parcial</strong> — recurso ficou ligado menos de 55% do mês (&lt;400h). Estimativa de mês cheio pode superestimar.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;font-weight:700;flex-shrink:0;margin-top:1px;color:var(--text-muted);">*</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong>/mês*</strong> — estimativa proporcional ao billing. Recursos de consumo variável (storage, bandwidth) não têm taxa horária fixa.</span>
            </div>

            <div style="margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Coluna Estimado</div>

            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:10px;height:10px;background:var(--green,#22c55e);border-radius:2px;flex-shrink:0;opacity:.8;"></span>
              <span style="font-size:10px;color:var(--text-dim);">Verde — estimado com base no Price List</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:10px;height:10px;background:var(--text-muted);border-radius:2px;flex-shrink:0;opacity:.5;"></span>
              <span style="font-size:10px;color:var(--text-dim);">Cinza — estimado com base no billing histórico</span>
            </div>
          </div>

        </div><!-- /legenda -->

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
      <button id="cov-btn-gerar" onclick="Calculadora._ovGerarEstimativa()" class="cbtn-go" style="gap:6px;">
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
  // Importação multi-arquivo — upload → job background → polling de progresso
  // ══════════════════════════════════════════════════════════════════════════

  // Polling até o job concluir — atualiza barra de progresso com dados do servidor
  async function _aguardarImport(jobId, nomeArquivo, idxAtual, totalArquivos, fillEl, atualEl) {
    const token      = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const baseWidth  = ((idxAtual - 1) / totalArquivos) * 100;
    const sliceWidth = 100 / totalArquivos;

    while (true) {
      await new Promise(r => setTimeout(r, 900));
      try {
        const r = await fetch(window.location.origin + '/api/azure-costs/import-status', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!r.ok) continue;
        const { job } = await r.json();

        // Job substituído ou sumiu — assume concluído sem dados
        if (!job || job.id !== jobId) return { status: 'done', inseridos: 0, atualizados: 0, erros: 0, linhas: 0 };

        // Progresso visual
        const processado = (job.inseridos || 0) + (job.atualizados || 0) + (job.erros || 0);
        const total      = job.linhas || 0;
        const localPct   = total > 0 ? Math.min(processado / total, 0.99) : 0;
        fillEl.style.width = Math.round(baseWidth + localPct * sliceWidth) + '%';

        const subLabel = job.subArquivo ? ` · ${job.subArquivo}` : '';
        if (total > 0) {
          atualEl.textContent = `${nomeArquivo}${subLabel} · ${processado.toLocaleString('pt-BR')} / ${total.toLocaleString('pt-BR')}`;
        } else {
          atualEl.textContent = `${nomeArquivo}${subLabel} · carregando...`;
        }

        if (job.status !== 'running') return job;
      } catch (_) { /* rede instável — continua polling */ }
    }
  }

  function _setupImport() {
    const inp = document.getElementById('cfile');
    if (!inp) return;

    inp.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      inp.value = '';
      if (!files.length) return;

      const invalid = files.filter(f => {
        const n = f.name.toLowerCase();
        return !n.endsWith('.csv') && !n.endsWith('.parquet') && !n.endsWith('.zip');
      });
      if (invalid.length) _toast(`${invalid.length} arquivo(s) ignorado(s): apenas .csv, .parquet e .zip são aceitos.`, 'error');

      const validos = files.filter(f => {
        const n = f.name.toLowerCase();
        return n.endsWith('.csv') || n.endsWith('.parquet') || n.endsWith('.zip');
      });
      if (!validos.length) return;

      if (typeof suspendInactivityTimer === 'function') suspendInactivityTimer();

      const panel    = document.getElementById('cimport-panel');
      const title    = document.getElementById('cimport-title');
      const pctEl    = document.getElementById('cimport-geral-pct');
      const fillEl   = document.getElementById('cimport-geral-fill');
      const atualEl  = document.getElementById('cimport-arquivo-atual');
      const resumo   = document.getElementById('cimport-resumo');
      const closeBtn = document.getElementById('cimport-close');

      panel.style.display    = 'block';
      resumo.style.display   = 'none';
      closeBtn.style.display = 'none';
      fillEl.style.width     = '0%';
      fillEl.style.background= 'var(--accent)';
      title.style.color      = 'var(--text)';
      title.textContent      = `Importando ${validos.length} arquivo${validos.length > 1 ? 's' : ''}...`;
      pctEl.textContent      = `0 / ${validos.length}`;
      atualEl.textContent    = '';

      localStorage.setItem('finops_import_status', JSON.stringify(
        { status: 'running', files: validos.length, started: Date.now() }
      ));

      let totalInseridos = 0, totalErros = 0, concluidos = 0, falhas = 0;

      for (let i = 0; i < validos.length; i++) {
        const file  = validos[i];
        pctEl.textContent   = `${i + 1} / ${validos.length}`;
        atualEl.textContent = file.name;
        fillEl.style.width  = Math.round((i / validos.length) * 100) + '%';

        try {
          const fd    = new FormData();
          fd.append('arquivo', file);
          fd.append('idx',   String(i + 1));
          fd.append('total', String(validos.length));
          const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';

          const r = await fetch(window.location.origin + '/api/azure-costs/import', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd,
          });

          if (r.status === 401) {
            sessionStorage.removeItem('finops_token'); sessionStorage.removeItem('finops_session');
            localStorage.removeItem('finops_token');  localStorage.removeItem('finops_session');
            title.textContent      = '⚠️ Sessão expirada';
            title.style.color      = '#ffaa00';
            atualEl.textContent    = 'Redirecionando para o login...';
            closeBtn.style.display = '';
            if (typeof resumeInactivityTimer === 'function') resumeInactivityTimer();
            setTimeout(() => window.location.reload(), 2000);
            return;
          }

          // 409 = outra importação em andamento — aguardar e tentar de novo
          if (r.status === 409) {
            atualEl.textContent = `Aguardando importação anterior concluir...`;
            await new Promise(resolve => setTimeout(resolve, 4000));
            i--;
            continue;
          }

          if (!r.ok) {
            const data = await r.json().catch(() => ({ error: 'erro desconhecido' }));
            throw new Error(data.error || `HTTP ${r.status}`);
          }

          // 202 Accepted — servidor iniciou o job em background
          const { jobId } = await r.json();

          // Polling até concluir
          const resultado = await _aguardarImport(jobId, file.name, i + 1, validos.length, fillEl, atualEl);

          if (resultado.status === 'done') {
            totalInseridos += resultado.inseridos   || 0;
            totalErros     += resultado.erros       || 0;
            concluidos++;
          } else {
            falhas++;
            atualEl.textContent    = `⚠ ${file.name}: ${resultado.erro || 'erro no servidor'}`;
            fillEl.style.background= 'var(--danger)';
          }

        } catch (err) {
          falhas++;
          atualEl.textContent    = `⚠ ${file.name}: ${err.message}`;
          fillEl.style.background= 'var(--danger)';
        }
      }

      if (typeof resumeInactivityTimer === 'function') resumeInactivityTimer();

      // ── Conclusão ────────────────────────────────────────────────
      const tudoOk = falhas === 0;
      title.textContent      = tudoOk ? '✅ Importação concluída' : `⚠️ ${concluidos} ok · ${falhas} com erro`;
      title.style.color      = tudoOk ? 'var(--green)' : '#f9e2af';
      fillEl.style.background= tudoOk ? 'var(--green)' : '#f9e2af';
      fillEl.style.width     = '100%';
      atualEl.textContent    = '';
      closeBtn.style.display = '';
      pctEl.textContent      = '';

      resumo.style.display = 'block';
      resumo.innerHTML = tudoOk
        ? `${concluidos} arquivo${concluidos !== 1 ? 's' : ''} · <strong style="color:var(--green)">${totalInseridos.toLocaleString('pt-BR')}</strong> novos · ${totalErros.toLocaleString('pt-BR')} ignorados`
        : `${concluidos} ok${falhas ? ` · <span style="color:var(--danger)">${falhas} com erro</span>` : ''} · <strong>${totalInseridos.toLocaleString('pt-BR')}</strong> novos`;

      localStorage.setItem('finops_import_status', JSON.stringify({
        status: tudoOk ? 'done' : 'partial',
        files: validos.length, concluidos, falhas,
        inserted: totalInseridos, errors: totalErros,
        completed: Date.now()
      }));

      if (concluidos > 0) _carregarSubscriptions();
      _toast(tudoOk
        ? `✅ ${concluidos} arquivo(s) — ${totalInseridos.toLocaleString('pt-BR')} registros inseridos.`
        : `⚠️ ${concluidos} ok · ${falhas} com erro.`,
        tudoOk ? 'success' : 'error');
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
    _horasAplicadas = false;

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
    _dadosDetalhe = [];
    _dadosServico = [];
    await _carregarRecursos();
    if (_modoVisao === 'detalhe') _buscarDetalhe();
    if (_modoVisao === 'servico') _buscarServico();
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
      // _key: identificador único por linha — inclui meter_name para evitar colisão entre
      // meters que compartilham o mesmo UoM (ex: "Data Stored" vs "Standard Data Stored")
      _recursos = data.map(r => ({
        ...r,
        _key: (r.resource_id||'') + '||' + (r.categoria||'') + '||' + (r.meter_categories||'') + '||' + (r.unidade||'')
      }));
      _selecionados = {};
      _renderRecursos();
      // Reconciliação em background (não bloqueia o render)
      _reconciliacao = null;
      _carregarReconciliacao(url.replace('/calculadora/recursos', '/calculadora/reconciliacao'));
    } catch (err) {
      console.error('[Calculadora] Erro:', err);
      const t = document.getElementById('ctbody');
      if (t) t.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:#ff4d6a;font-size:12px;">⚠ Erro: ${_esc(err.message)}<br><span style="color:var(--text-muted);font-size:10px;">Verifique o console (F12)</span></td></tr>`;
    }
  }

  async function _carregarReconciliacao(url) {
    try {
      const data = await _api('GET', url.replace('/api', ''));
      if (data && !data.error) {
        _reconciliacao = data;
        _atualizarNotaRodape();
      }
    } catch (_) { /* silencioso */ }
  }

  function _atualizarNotaRodape() {
    const nota = document.getElementById('crodape-nota');
    if (!nota || !_reconciliacao) return;

    const tiposOcultos = ['Purchase', 'UnusedReservation', 'UnusedSavingsPlan', 'Tax', 'Refund'];
    const ocultos = (_reconciliacao.por_tipo || []).filter(t =>
      tiposOcultos.some(k => (t.charge_type || '').startsWith(k)) && t.total > 0.01
    );
    const totalOculto = ocultos.reduce((s, t) => s + t.total, 0);

    const moedas = (_reconciliacao.por_moeda || []).filter(m => m.moeda !== 'BRL' && m.total > 0);

    const partes = [];
    if (totalOculto > 0.01) {
      const nomes = [...new Set(ocultos.map(t => t.charge_type.replace('UnusedReservation','Reserva não usada').replace('UnusedSavingsPlan','Savings Plan não usado').replace('Purchase','Compra')))].join(', ');
      partes.push(`⚠ ${_brl(totalOculto)} oculto (${nomes})`);
    }
    if (moedas.length) partes.push(`moeda: ${moedas.map(m => m.moeda).join(', ')}`);

    nota.textContent  = partes.join(' · ');
    nota.style.color  = totalOculto > 0.01 ? 'var(--orange)' : 'var(--text-muted)';
    nota.title        = totalOculto > 0.01
      ? 'Estes valores constam no banco mas não aparecem na visão de Recursos por não terem resource_id. Abra Reconciliar para ver o detalhamento.'
      : '';
    nota.style.cursor = totalOculto > 0.01 ? 'help' : '';
  }

  // ── Visão Por Data / Por Serviço ──────────────────────────────────
  function _switchVisao(modo) {
    _modoVisao = modo;
    const recWrap = document.getElementById('crecursos-wrap');
    const detWrap = document.getElementById('cdetalhe-wrap');
    const svcWrap = document.getElementById('csvc-wrap');
    const tabRec  = document.getElementById('cvtab-rec');
    const tabDet  = document.getElementById('cvtab-det');
    const tabSvc  = document.getElementById('cvtab-svc');
    if (!recWrap || !detWrap || !svcWrap) return;
    recWrap.style.display = modo === 'recursos' ? '' : 'none';
    detWrap.style.display = modo === 'detalhe'  ? '' : 'none';
    svcWrap.style.display = modo === 'servico'  ? '' : 'none';
    const _tab = (el, active) => {
      if (!el) return;
      el.style.background = active ? 'var(--accent)' : 'transparent';
      el.style.color       = active ? '#fff' : 'var(--text-muted)';
    };
    _tab(tabRec, modo === 'recursos');
    _tab(tabDet, modo === 'detalhe');
    _tab(tabSvc, modo === 'servico');
    const btnEst = document.getElementById('cbtn-estimar');
    if (btnEst) btnEst.style.display = modo === 'recursos' ? '' : 'none';
    _atualizarTotalRodape();
    if (modo === 'detalhe' && !_dadosDetalhe.length && _subsSel.length) _buscarDetalhe();
    if (modo === 'servico' && !_dadosServico.length && _subsSel.length) _buscarServico();
  }

  async function _buscarDetalhe() {
    const tbody = document.getElementById('cdetalhe-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">
      <span class="cskel" style="width:60%;display:inline-block;"></span></td></tr>`;
    try {
      const subs = _subsSel.length ? _subsSel : (_subAtual ? [_subAtual] : []);
      const rgs  = _rgsSel.length  ? _rgsSel  : (_rgAtual  ? [_rgAtual]  : []);
      let url = `/calculadora/detalhe-diario?subscription_id=${subs.map(encodeURIComponent).join(',')}`;
      if (rgs.length) url += `&resource_group=${rgs.map(encodeURIComponent).join(',')}`;
      if (_dataInicio) url += `&data_inicio=${_dataInicio}`;
      if (_dataFim)    url += `&data_fim=${_dataFim}`;
      const data = await _api('GET', url);
      if (!Array.isArray(data)) throw new Error(data?.error || 'Resposta inválida');
      _dadosDetalhe = data;
      _renderDetalhe();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#ff4d6a;font-size:12px;">⚠ ${_esc(err.message)}</td></tr>`;
    }
  }

  function _renderDetalhe() {
    const tbody = document.getElementById('cdetalhe-tbody');
    if (!tbody) return;
    if (!_dadosDetalhe.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Nenhum dado encontrado para o período.</td></tr>`;
      return;
    }

    // Agrupa por (data, resource_id) → sub-linhas por (service_name, meter)
    const grupos = {};
    const ordem  = [];
    for (const row of _dadosDetalhe) {
      const k = row.cost_date + '||' + (row.resource_id || '');
      if (!grupos[k]) {
        grupos[k] = {
          cost_date:          row.cost_date,
          resource_id:        row.resource_id || '',
          nome_recurso:       row.nome_recurso || row.resource_id || '—',
          resource_type:      row.resource_type || '—',
          location:           row.location || '—',
          resource_group_name:row.resource_group_name || '—',
          subscription_name:  row.subscription_name || '—',
          total: 0,
          subs: []
        };
        ordem.push(k);
      }
      const g = grupos[k];
      const custo = parseFloat(row.cost) || 0;
      g.total += custo;
      g.subs.push({ service_name: row.service_name || '—', meter: row.meter || '—', cost: custo });
    }

    const brl = v => v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Renderiza via DOM (evita qualquer problema de escaping em onclick strings)
    tbody.innerHTML = '';
    let idx = 0;
    for (const k of ordem) {
      const g  = grupos[k];
      const i  = idx++;
      const dt = g.cost_date ? g.cost_date.slice(0,10) : '—';
      const nomeShort = g.nome_recurso.length > 60 ? '…' + g.nome_recurso.slice(-50) : g.nome_recurso;

      // ── linha principal ──
      const trMain = document.createElement('tr');
      trMain.style.cssText = 'cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s;';
      trMain.innerHTML = `
        <td style="padding:8px 6px;text-align:center;color:var(--text-muted);">
          <svg class="cdet-chev" viewBox="0 0 12 12" fill="none" width="11" height="11" style="transition:transform .2s;vertical-align:middle;">
            <path d="M3 4l3 3.5L9 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </td>
        <td style="padding:8px 10px;font-size:12px;color:var(--text);white-space:nowrap;">${esc(dt)}</td>
        <td style="padding:8px 10px;font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <span title="${esc(g.resource_id)}" style="color:var(--accent);font-size:11px;">${esc(nomeShort)}</span>
        </td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-dim);">${esc(g.resource_type)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-dim);">${esc(g.location)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-dim);">${esc(g.resource_group_name)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-dim);">${esc(g.subscription_name)}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:700;color:var(--accent);text-align:right;white-space:nowrap;">${brl(g.total)}</td>`;

      // ── linha de sub-detalhes (oculta por padrão) ──
      const trSub = document.createElement('tr');
      trSub.style.display = 'none';
      trSub.innerHTML = `
        <td colspan="8" style="padding:0 0 4px 32px;background:rgba(147,51,234,.05);border-bottom:2px solid var(--border);">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);">
                <th style="padding:5px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:left;">Nome do Serviço</th>
                <th style="padding:5px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:left;">Meter</th>
                <th style="padding:5px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right;">Custo (BRL)</th>
              </tr>
            </thead>
            <tbody>
              ${g.subs.map(s => `
                <tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                  <td style="padding:5px 10px;font-size:11px;color:var(--text);">${esc(s.service_name)}</td>
                  <td style="padding:5px 10px;font-size:11px;color:var(--text-dim);">${esc(s.meter)}</td>
                  <td style="padding:5px 10px;font-size:11px;font-weight:600;color:var(--accent);text-align:right;">${brl(s.cost)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </td>`;

      // toggle via addEventListener — sem strings no onclick
      trMain.addEventListener('click', () => {
        const open = trSub.style.display === 'none';
        trSub.style.display = open ? 'table-row' : 'none';
        const chev = trMain.querySelector('.cdet-chev');
        if (chev) chev.style.transform = open ? 'rotate(-180deg)' : '';
        trMain.style.background = open ? 'rgba(147,51,234,.08)' : '';
      });
      trMain.addEventListener('mouseenter', () => { if (trSub.style.display==='none') trMain.style.background='var(--bg-hover)'; });
      trMain.addEventListener('mouseleave', () => { if (trSub.style.display==='none') trMain.style.background=''; });

      tbody.appendChild(trMain);
      tbody.appendChild(trSub);
    }
    _atualizarTotalRodape();
  }

  function _toggleDetalhe() { /* não usado — toggle feito por addEventListener */ }

  // ── Visão Por Serviço ─────────────────────────────────────────────
  async function _buscarServico() {
    const tbody = document.getElementById('csvc-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">
      <span class="cskel" style="width:60%;display:inline-block;"></span></td></tr>`;
    try {
      const subs = _subsSel.length ? _subsSel : (_subAtual ? [_subAtual] : []);
      const rgs  = _rgsSel.length  ? _rgsSel  : (_rgAtual  ? [_rgAtual]  : []);
      let url = `/calculadora/por-servico?subscription_id=${subs.map(encodeURIComponent).join(',')}`;
      if (rgs.length)  url += `&resource_group=${rgs.map(encodeURIComponent).join(',')}`;
      if (_dataInicio) url += `&data_inicio=${_dataInicio}`;
      if (_dataFim)    url += `&data_fim=${_dataFim}`;
      const data = await _api('GET', url);
      if (!Array.isArray(data)) throw new Error(data?.error || 'Resposta inválida');
      _dadosServico = data;
      _renderServico();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:#ff4d6a;font-size:12px;">⚠ ${_esc(err.message)}</td></tr>`;
    }
  }

  function _renderServico() {
    const tbody = document.getElementById('csvc-tbody');
    if (!tbody) return;
    if (!_dadosServico.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Nenhum dado encontrado para o período.</td></tr>`;
      return;
    }
    const brl   = v => Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    const grand = _dadosServico.reduce((s, r) => s + Number(r.total_brl || 0), 0);
    tbody.innerHTML = '';
    _dadosServico.forEach((row, i) => {
      const pct   = grand > 0 ? (Number(row.total_brl) / grand * 100) : 0;
      const tr    = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--border);transition:background .12s;';
      tr.innerHTML = `
        <td style="padding:9px 10px;text-align:center;font-size:11px;color:var(--text-muted);">${i+1}</td>
        <td style="padding:9px 10px;font-size:12px;color:var(--text);">${_esc(row.service_name)}</td>
        <td style="padding:9px 10px;font-size:12px;color:var(--text-dim);text-align:right;">${Number(row.qtd_recursos||0).toLocaleString('pt-BR')}</td>
        <td style="padding:9px 10px;font-size:12px;color:var(--text-dim);text-align:right;">${Number(row.qtd_rgs||0).toLocaleString('pt-BR')}</td>
        <td style="padding:9px 10px;font-size:12px;font-weight:700;color:var(--accent);text-align:right;white-space:nowrap;">${brl(row.total_brl)}</td>
        <td style="padding:9px 10px;text-align:right;">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
            <div style="width:60px;height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;">
              <div style="height:100%;width:${Math.min(pct,100).toFixed(1)}%;background:var(--accent);border-radius:3px;"></div>
            </div>
            <span style="font-size:11px;color:var(--text-dim);white-space:nowrap;">${pct.toFixed(1)}%</span>
          </div>
        </td>`;
      tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--bg-hover)'; });
      tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
      tbody.appendChild(tr);
    });
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
      (r.resource_group_name||'').toLowerCase().includes(_filtroTexto) ||
      (r.publisher_type||'').toLowerCase().includes(_filtroTexto) ||
      (r.publisher_name||'').toLowerCase().includes(_filtroTexto)
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
        const isMkt = (r.publisher_type||'').toLowerCase() === 'marketplace';
        const mktBadge = isMkt ? `<span style="display:inline-block;margin-left:5px;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;background:rgba(255,140,66,.18);color:#ff8c42;vertical-align:middle;white-space:nowrap;">MKT</span>` : '';

        rows.push(`<tr style="${sel?'background:rgba(147,51,234,.04);':''}${isMkt?'border-left:2px solid rgba(255,140,66,.4);':''}">
          <td style="text-align:center;padding:8px 4px;">
            <input type="checkbox" class="cck" data-rid="${_esc(rid)}" ${sel?'checked':''}
              onchange="Calculadora._check('${_esc(rid)}',this.checked)">
          </td>
          <td style="max-width:200px;padding:8px 10px;${pad}">
            <div style="font-size:${temMultiplos?'11':'12'}px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${temMultiplos?'var(--text-dim)':'var(--text)'};" title="${_esc(r.resource_id||'')}">${_esc(temMultiplos?(r.meter_categories||r.categoria||nome):nome)}${mktBadge}</div>
            <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(r.publisher_name && isMkt ? r.publisher_name : (r.produto||r.subcategoria||r.regiao||''))}</div>
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
    // Usa tipo_custo quando disponível (dado novo do servidor)
    if (r?.tipo_custo) return r.tipo_custo === 'periodo' || r.tipo_custo === 'dia';
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
    _atualizarTotalRodape();
  }

  function _atualizarTotalRodape() {
    const bar    = document.getElementById('crodape-total');
    const labelEl= document.getElementById('crodape-label');
    const valorEl= document.getElementById('crodape-valor');
    if (!bar || !labelEl || !valorEl) return;

    if (_modoVisao === 'recursos') {
      const sel = Object.keys(_selecionados);
      if (!sel.length || !_recursos.length) { bar.style.display = 'none'; return; }
      let total = 0;
      for (const rid of sel) {
        const r = _recursos.find(x => (x._key || x.resource_id) === rid);
        if (!r) continue;
        const isBRL = (r.moeda || 'BRL') === 'BRL';
        total += parseFloat(r.total_billing || 0) * (isBRL ? 1 : _taxaBrl);
      }
      labelEl.textContent = `${sel.length} selecionado${sel.length !== 1 ? 's' : ''} · Total cobrado`;
      valorEl.textContent = _brl(total);
      bar.style.display   = 'flex';
    } else {
      if (!_dadosDetalhe.length) { bar.style.display = 'none'; return; }
      const total = _dadosDetalhe.reduce((acc, r) => acc + (parseFloat(r.cost) || 0), 0);
      labelEl.textContent = 'Total do período';
      valorEl.textContent = _brl(total);
      bar.style.display   = 'flex';
    }
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
    _horasAplicadas = true;
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
      // Trocou para HORAS → limpa períodos e reseta flag para exigir novo Aplicar
      _periodos = [];
      _horasPeriodoValidas = false;
      _horasAplicadas = false;
      _renderPeriodos();
      _atualizarBtnIncluir();
      const h = Math.max(1, parseInt(document.getElementById('chglobal')?.value) || 720);
      Object.keys(_selecionados).forEach(rid => { _selecionados[rid] = h; });
      _atualizarEstimativa();
    } else {
      // Trocou para PERÍODO
      const covModal = document.getElementById('covmodal');
      const overlayOpen = covModal && covModal.style.display !== 'none';
      _periodos = [];
      _horasAplicadas = false;
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
      // Campos já preenchidos — preserva datas existentes, só preenche fim se vazio
      if (fimData && !fimData.value) fimData.value = iniData.value;
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
    if (fimData && !fimData.value) fimData.value = fmtDate(now);
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
    const dias  = Math.floor(horas / 24);
    const hRest = horas % 24;
    const durLabel = dias > 0
      ? (hRest > 0 ? `${dias}d ${hRest}h` : `${dias}d`)
      : `${horas}h`;
    const fmtDt = iso => {
      const [d, t] = iso.split('T');
      const [y, m, dd] = d.split('-');
      return `${dd}/${m} ${t ? t.slice(0,5) : ''}`;
    };
    if (res) { res.style.color = 'var(--accent)'; res.textContent = `${horas}h (${durLabel}) · ${fmtDt(vIni)} → ${fmtDt(vFim)}`; }
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
    _horasAplicadas = true;
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
      + '<span style="color:var(--text-muted);">⚡ Hora / Dia (taxa real)</span>'
      + '<span>' + itens.filter(r => r.isHora).length + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
      + '<span style="color:var(--blue,#4da6ff);">🔒 Reservas (amortizado)</span>'
      + '<span>' + itens.filter(r => r.tipo_custo === 'reserva').length + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'
      + '<span style="color:var(--orange,#ff8c42);">📦 Storage/Consumo (est.)</span>'
      + '<span>' + itens.filter(r => r.tipo_custo === 'periodo').length + '</span></div>'
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
      const _plRef = parseFloat(r.retail_price_hora || 0);
      const _temPL = _plRef > 0;
      const precoCell = r.custo_hora != null
        ? (() => {
            const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo');
            if (tc === 'reserva') {
              // Amortizado + referência on-demand do PL quando disponível
              const base = _brl(r.custo_hora) + '/h\xA0🔒';
              const od   = _temPL ? '\xA0<span style="opacity:.55;font-size:9px;" title="On-demand Price List">📋\xA0' + _brl(_plRef) + '/h</span>' : '';
              return '<span class="mono" title="Amortizado pelo term da reserva">' + base + od + '</span>';
            }
            if (tc === 'periodo') {
              // Usa PL/mês quando disponível — sem * pois é preço de catálogo real
              if (_temPL)
                return '<span class="mono" style="color:var(--green,#22c55e)" title="Preço on-demand mensal (Azure Price List)">📋\xA0' + _brl(_plRef) + '/mês</span>';
              // Fallback billing com * indicando estimativa
              return '<span class="mono" title="Custo mensal estimado do billing (÷30÷24)">' + _brl(r.custo_mes || r.custo_hora * 720) + '/mês*</span>';
            }
            // hora / dia — usa PL/h quando disponível
            if (_temPL)
              return '<span class="mono" style="color:var(--green,#22c55e)" title="Preço on-demand por hora (Azure Price List)">📋\xA0' + _brl(_plRef) + '/h</span>';
            return '<span class="mono">' + _brl(r.custo_hora) + '/h</span>';
          })()
        : '<span class="na">&mdash;</span>';
      // Cor da coluna Estimado: verde quando PL disponível (qualquer tipo), cinza quando só billing
      const _corEst = (r.fonte_estimado === 'price_list' || (_temPL && r.tipo_custo !== 'reserva')) ? 'td-green' : 'td-gray';
      return '<tr>'
        + '<td class="td-nm">' + _esc(r.nome) + '</td>'
        + '<td class="td-sm">' + _esc(r.categoria) + '</td>'
        + '<td class="td-sm td-right td-mono">' + quantCell + '</td>'
        + '<td class="td-sm td-right">' + precoCell + '</td>'
        + '<td class="td-brl ' + _corEst + '">' + _brl(r.estimado_brl) + '</td>'
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
    const valDias = 30; // Validade fixa em 30 dias
    const obs     = document.getElementById('cinv-obs')?.value?.trim()      || '';

    if (!sel?.value) { _toast('Selecione um projeto.', 'error'); return; }
    if (!obs) {
      _toast('Informe o motivo da solicitação do ambiente ligado.', 'error');
      document.getElementById('cinv-obs')?.focus();
      return;
    }

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

  // ── Reconciliação de valores ─────────────────────────────────────────────────
  function abrirReconciliacao() {
    const modal = document.getElementById('crecon-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    _renderReconciliacao();
  }

  function fecharReconciliacao() {
    const modal = document.getElementById('crecon-modal');
    if (modal) modal.style.display = 'none';
  }

  function _onAzureRefInput(val) {
    const clean = (val || '').replace(/[^\d,]/g, '').replace(',', '.');
    _azureRefValue = parseFloat(clean) || 0;
    const dbTotal = _reconciliacao ? _reconciliacao.total_bruto : 0;
    const dif = _azureRefValue > 0 ? _azureRefValue - dbTotal : null;
    const difEl  = document.getElementById('crecon-dif-val');
    const pctEl  = document.getElementById('crecon-dif-pct');
    const noteEl = document.getElementById('crecon-gap-note');
    if (difEl) difEl.textContent  = dif !== null ? _brl(Math.abs(dif)) : '—';
    if (pctEl) pctEl.textContent  = (dif !== null && _azureRefValue > 0)
      ? '(' + (Math.abs(dif) / _azureRefValue * 100).toFixed(1) + '%)'
      : '';
    if (noteEl) noteEl.style.display = (dif !== null && Math.abs(dif) > 1) ? '' : 'none';
  }

  function _renderReconciliacao() {
    const body = document.getElementById('crecon-body');
    if (!body) return;

    if (!_reconciliacao) {
      body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">
        ${_recursos.length ? 'Carregando reconciliação...' : 'Execute uma busca primeiro.'}
      </div>`;
      return;
    }

    const r      = _reconciliacao;
    const brl    = v => _brl(v);
    const pct    = (v, t) => t > 0 ? (v / t * 100).toFixed(1) + '%' : '—';
    const dbTotal = r.total_bruto;
    const dif     = _azureRefValue > 0 ? _azureRefValue - dbTotal : null;
    const difPct  = (dif !== null && _azureRefValue > 0)
      ? '(' + (Math.abs(dif) / _azureRefValue * 100).toFixed(1) + '%)'
      : '';

    const rowsCT = (r.por_tipo || []).map(t => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:7px 10px;font-size:11px;color:var(--text);">${_esc(t.charge_type)}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-muted);text-align:right;">${parseInt(t.linhas).toLocaleString('pt-BR')}</td>
        <td style="padding:7px 10px;font-size:12px;font-weight:600;color:var(--text);text-align:right;font-family:'IBM Plex Mono',monospace;">${brl(t.total)}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-muted);text-align:right;">${pct(t.total, dbTotal)}</td>
      </tr>`).join('');

    const moedas = (r.por_moeda || []);
    const multiMoeda = moedas.length > 1 || (moedas.length === 1 && moedas[0].moeda !== 'BRL');
    const moedasHtml = multiMoeda ? `
      <div style="margin-top:16px;padding:10px 12px;border-radius:8px;background:rgba(77,166,255,.08);border:1px solid rgba(77,166,255,.2);">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:8px;">Moedas no banco</div>
        ${moedas.map(m => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;">
          <span style="color:var(--text-dim);">${_esc(m.moeda)}</span>
          <span style="font-family:'IBM Plex Mono',monospace;color:var(--blue);">${brl(m.total)}</span>
        </div>`).join('')}
        <div style="margin-top:6px;font-size:10px;color:var(--text-muted);">Taxa de câmbio manual aplicada: ${_taxaBrl.toFixed(2)}</div>
      </div>` : '';

    body.innerHTML = `
      <!-- Cards: Banco | Azure Ref | Diferença -->
      <div style="display:flex;gap:10px;margin-bottom:16px;">
        <div style="flex:1;padding:12px;border-radius:8px;background:rgba(147,51,234,.1);border:1px solid rgba(147,51,234,.25);">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Total no Banco</div>
          <div style="font-size:16px;font-weight:700;color:var(--accent);font-family:'IBM Plex Mono',monospace;">${brl(dbTotal)}</div>
        </div>
        <div style="flex:1;padding:12px;border-radius:8px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Azure Portal (referência)</div>
          <input id="crecon-azure-ref" type="text"
            value="${_azureRefValue > 0 ? brl(_azureRefValue) : ''}"
            placeholder="ex: 49.745,18"
            oninput="Calculadora._onAzureRefInput(this.value)"
            style="width:100%;background:transparent;border:none;border-bottom:1px solid rgba(34,197,94,.4);outline:none;font-size:15px;font-weight:700;color:var(--green);font-family:'IBM Plex Mono',monospace;padding:0;margin-top:2px;"/>
        </div>
        <div style="flex:1;padding:12px;border-radius:8px;background:rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.2);">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">Diferença</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <div id="crecon-dif-val" style="font-size:16px;font-weight:700;color:var(--red);font-family:'IBM Plex Mono',monospace;">${dif !== null ? brl(Math.abs(dif)) : '—'}</div>
            <div id="crecon-dif-pct" style="font-size:11px;color:var(--text-muted);">${difPct}</div>
          </div>
        </div>
      </div>

      <!-- Nota gap -->
      <div id="crecon-gap-note" style="${(dif === null || Math.abs(dif) <= 1) ? 'display:none;' : ''}margin-bottom:14px;padding:10px 14px;border-radius:8px;background:rgba(255,140,66,.08);border:1px solid rgba(255,140,66,.25);font-size:11px;color:var(--text-muted);line-height:1.7;">
        <strong style="color:#ff8c42;">Por que há diferença?</strong> O CSV de detalhe de uso do Azure <strong style="color:var(--text);">não exporta impostos fiscais brasileiros</strong>
        (ISS ~5% + PIS/COFINS ~3,65% ≈ 8–11%). Esses tributos aparecem apenas no portal e na fatura, mas
        <em>não como linhas separadas no arquivo exportado</em>. Para reconciliar completamente,
        solicite o <strong style="color:var(--text);">relatório de fatura detalhado</strong> (Invoice Details) em vez do Cost Details.
      </div>

      <!-- Por Charge Type -->
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;">Por Charge Type</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:rgba(255,255,255,.04);">
            <th style="padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:left;">Charge Type</th>
            <th style="padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right;">Linhas</th>
            <th style="padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right;">Total (BRL)</th>
            <th style="padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right;">%</th>
          </tr></thead>
          <tbody>${rowsCT}</tbody>
        </table>
      </div>
      ${moedasHtml}`;
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
    if (rodape) rodape.style.display = _horasAplicadas ? 'flex' : 'none';

    let totalGeral   = 0;
    let totalCobrado = 0;

    lista.innerHTML = sel.map(rid => {
      const r   = _recursos.find(x => (x._key||x.resource_id) === rid);
      if (!r) return '';
      const nome = r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,40);
      const isBRL = (r.moeda || 'BRL') === 'BRL';
      // RN-005: taxa de câmbio — usa taxa real do export quando disponível (>1 = conversão real)
      const tcDB  = parseFloat(r.taxa_cambio || 0);
      const convR = !isBRL ? (tcDB > 1 ? tcDB : _taxaBrl) : 1;
      const bill  = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0) * convR;
      totalCobrado += bill;
      const uom  = (r.unidade || '').toLowerCase();
      const tipo = r.tipo_custo || (uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo');
      const horas = _selecionados[rid] || 720;
      let estimado = 0, desc, cor;

      if (_horasAplicadas) {
        const choraRaw = parseFloat(r.custo_hora_billing || 0);
        const chora    = isBRL ? choraRaw : choraRaw * convR;

        // Price List: normaliza retail/h com fator UoM
        const _uomFpl  = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
        const _retailU = parseFloat(r.retail_price_unit || 0);
        const _retailH = (tipo === 'hora' || tipo === 'dia') && _retailU > 0
          ? (_retailU / _uomFpl) * convR : 0;
        const _choraEst = _retailH > 0 ? _retailH : chora;
        const _temPL    = _retailH > 0;

        if (tipo === 'reserva') {
          estimado = chora * horas;
          desc = '🔒 ' + _brl(chora) + '/h amort. × ' + horas + 'h';
          cor  = 'var(--blue,#4da6ff)';

        } else if (tipo === 'hora' || tipo === 'dia') {
          // Usa PL/h quando disponível; senão billing/h
          estimado = _choraEst * horas;
          desc = (_temPL ? '📋\xA0' : '') + _brl(_choraEst) + '/h \xD7 ' + horas + 'h';
          cor  = _temPL ? 'var(--green,#22c55e)' : 'var(--accent)';

        } else {
          // RN-004: Storage, Bandwidth, Functions — referência mensal
          // Fallback: quando custo_mes_billing é null (servidor não reiniciado ou dado ausente)
          //           recalcula a partir de total_billing / dias * 30
          const _dias  = parseInt(r.dias_ativos || 1) || 1;
          const mesRaw = parseFloat(r.custo_mes_billing) ||
                         (parseFloat(r.total_billing || 0) / _dias * 30);
          const mesBrl   = isBRL ? mesRaw : mesRaw * convR;
          const custoDia = mesBrl / 30;
          const dias     = Math.round(horas / 24) || 1;
          estimado = mesBrl * (horas / 720); // proporcional ao slider global
          desc = _brl(custoDia) + '/dia \xD7 ' + dias + 'd';
          cor  = 'var(--orange,#ff8c42)';
        }
        totalGeral += estimado;
      } else {
        desc = 'Defina as horas ou período e clique Aplicar';
        cor  = 'var(--text-muted)';
      }

      return '<div style="padding:8px 10px;border-radius:6px;background:var(--bg-hover);border:1px solid var(--border);">'
        + '<div style="font-size:11px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;" title="' + _esc(nome) + '">' + _esc(nome) + '</div>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">'
        + '<span style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(desc) + '</span>'
        + (_horasAplicadas
            ? '<span style="font-family:IBM Plex Mono,monospace;font-size:11px;font-weight:600;color:' + cor + ';white-space:nowrap;">' + _brl(estimado) + '</span>'
            : '<span style="font-family:IBM Plex Mono,monospace;font-size:11px;color:var(--text-muted);white-space:nowrap;">—</span>')
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
        // RN-005: taxa real do export quando disponível, senão _taxaBrl do usuário
        const tcDB2  = parseFloat(r.taxa_cambio || 0);
        const convR2 = !isBRL ? (tcDB2 > 1 ? tcDB2 : _taxaBrl) : 1;
        const bill   = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0) * convR2;
        const uom2   = (r.unidade || '').toLowerCase();
        const tipo2  = r.tipo_custo || (uom2.includes('hour') || uom2.includes('hora') ? 'hora' : 'periodo');
        const isHora = tipo2 === 'hora' || tipo2 === 'dia';
        const horas  = _selecionados[rid] || 720;
        const choraRaw  = parseFloat(r.custo_hora_billing || 0);
        const chora     = isBRL ? choraRaw : choraRaw * convR2;
        const _diasP    = parseInt(r.dias_ativos || 1) || 1;
        const mesRaw    = parseFloat(r.custo_mes_billing) ||
                          (parseFloat(r.total_billing || 0) / _diasP * 30);
        const custo_mes = isBRL ? mesRaw : mesRaw * convR2;
        // Price List: retail/h (hora) ou retail/mês (periodo)
        const _uomFr     = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
        const _retailUr  = parseFloat(r.retail_price_unit || 0);
        const retailHr   = isHora && _retailUr > 0 ? (_retailUr / _uomFr) * convR2 : 0;
        const retailMesR = !isHora && tipo2 === 'periodo' && _retailUr > 0
          ? (_retailUr / _uomFr) * convR2 : 0;
        const choraEstR  = isHora && retailHr > 0 ? retailHr : chora;
        // Estimado: PL quando disponível; periodo usa PL/mês proporcional se tiver
        const estimado   = (tipo2 === 'periodo')
          ? (retailMesR > 0 ? retailMesR * (horas / 720) : custo_mes * (horas / 720))
          : choraEstR * horas;
        const temPLR = retailHr > 0 || retailMesR > 0;
        return {
          resource_id:      rid,
          nome:             r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,50),
          categoria:        r.categoria || '',
          consumed_service: r.consumed_service || '',
          resource_group:   r.resource_group_name || '',
          uom:              r.unidade || '',
          tipo_custo:       tipo2,
          isHora,
          horas,
          custo_hora:       chora,
          retail_price_hora: retailHr || retailMesR,
          fonte_estimado:   temPLR ? 'price_list' : 'billing',
          custo_mes:        custo_mes,
          dias_ativos:      parseInt(r.dias_ativos) || 0,
          total_cobrado:    bill,
          estimado_brl:     estimado,
          moeda:            r.moeda || 'BRL',
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

  async function _ovGerarEstimativa() {
    if (!_estimativa || !_estimativa.resultados || !_estimativa.resultados.length) {
      _toast('Selecione pelo menos um recurso para estimar.', 'error');
      return;
    }
    _fecharConfigStep();
    await abrirInvoice();
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
      // RN-001..004: usa tipo_custo do banco; fallback por UoM
      const tipo     = r.tipo_custo || (uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo');
      const isHora   = tipo === 'hora' || tipo === 'dia';
      // RN-005: taxa real do export quando >1, senão _taxaBrl
      const tcDB     = parseFloat(r.taxa_cambio || 0);
      const convR    = !isBRL ? (tcDB > 1 ? tcDB : _taxaBrl) : 1;
      const horas    = _selecionados[rid] || 720;
      const choraRaw  = parseFloat(r.custo_hora_billing || 0);
      const chora     = choraRaw * convR;
      const diasAtiv  = parseInt(r.dias_ativos || 1) || 1;
      const totalBill = parseFloat(r.total_billing || 0);
      // custo_mes_billing: campo do banco ou fallback total_billing / dias * 30
      const mesRaw    = parseFloat(r.custo_mes_billing) ||
                        (totalBill / diasAtiv * 30);
      const mesBrl    = mesRaw * convR;
      const bill      = totalBill * convR;
      const qty      = parseFloat(r.total_qty || 0).toLocaleString('pt-BR', {maximumFractionDigits: 4});
      const cor      = tipo === 'reserva' ? 'var(--blue)' : tipo === 'periodo' ? 'var(--orange)' : 'var(--accent)';
      const cat      = _esc(r.categoria || '');
      const svc      = _esc(r.consumed_service || '');
      const rg       = _esc(r.resource_group_name || '');
      const ct       = r.charge_type || '';
      const ctColor  = ct === 'Usage'
        ? 'background:rgba(147,51,234,.1);color:var(--accent)'
        : 'background:rgba(77,166,255,.1);color:var(--blue)';
      const pm       = _esc(r.pricing_model || '');

      // Horas reais do export (só para UoM horária)
      const horasReais = parseFloat(r.horas_reais || 0);
      // Uso parcial: recurso ficou ligado menos de 55% do mês (~400h de 720h)
      const usoParcial = isHora && horasReais > 0 && horasReais < 400;
      // Price List: normaliza retail_price_unit para /h (hora) ou /mês (periodo)
      const uomF       = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
      const retailUnit = parseFloat(r.retail_price_unit || 0);
      // Para hora/dia: converte para /h usando fator UoM
      const retailHora = isHora && retailUnit > 0 ? (retailUnit / uomF) * convR : 0;
      // Para periodo (disco, storage…): retail_price_unit já está em BRL na UoM do price list (/mês)
      const retailMes  = !isHora && tipo === 'periodo' && retailUnit > 0 ? (retailUnit / uomF) * convR : 0;
      // Desconto: SQL calcula só para hora/dia; para periodo calculamos aqui
      const dPctSQL  = parseFloat(r.desconto_pct || 0);
      const dPctMes  = !isHora && retailMes > 0 && mesBrl > 0
        ? Math.max(0, parseFloat(((1 - mesBrl / retailMes) * 100).toFixed(1)))
        : 0;
      const dPct = dPctSQL > 0 ? dPctSQL : dPctMes;
      // Economia total no período selecionado
      const economiaPeriodo = isHora && retailHora > 0
        ? (retailHora - chora) * horas
        : (!isHora && retailMes > 0 ? (retailMes - mesBrl) * (horas / 720) : 0);
      // Custo/h para estimativa hora: usa Price List quando disponível, senão billing
      const choraEst = isHora && retailHora > 0 ? retailHora : chora;
      const temPL    = (isHora && retailHora > 0) || (!isHora && retailMes > 0);
      // Para reserva: on-demand do PL como referência informacional (estimado permanece amortizado)
      const retailHoraRsv = tipo === 'reserva' && retailUnit > 0 ? (retailUnit / uomF) * convR : 0;
      const dPctRsv = tipo === 'reserva' && retailHoraRsv > 0 && chora > 0
        ? Math.max(0, parseFloat(((1 - chora / retailHoraRsv) * 100).toFixed(1))) : 0;
      // Estimado: hora → choraEst × horas | periodo → retailMes proporcional (ou billing) | reserva → amortizado
      const estimado = (tipo === 'periodo')
        ? (retailMes > 0 ? retailMes * (horas / 720) : mesBrl * (horas / 720))
        : choraEst * horas;

      // Coluna 1: preço base da estimativa (PL quando disponível, senão billing)
      let col1Lbl, col1Val, col1Suf, col1Tip = '';
      if (tipo === 'reserva') {
        col1Lbl = 'Amort./h 🔒'; col1Val = _brl(chora); col1Suf = '/h';
      } else if (tipo === 'periodo' && temPL) {
        // Price List disponível para disco/storage: mostra PL/mês como base
        col1Lbl = '📋 PL/mês'; col1Val = _brl(retailMes); col1Suf = '/mês';
        col1Tip = ' title="Preço on-demand mensal do Azure Price List — base da estimativa"';
      } else if (tipo === 'periodo') {
        const custoDia = mesBrl / 30;
        col1Lbl = 'Custo/dia'; col1Val = _brl(custoDia); col1Suf = '/dia';
      } else if (temPL) {
        // Price List disponível para hora/dia: mostra PL/h como base da estimativa
        col1Lbl = '📋 PL/h'; col1Val = _brl(retailHora); col1Suf = '/h';
        col1Tip = ' title="Preço on-demand do Azure Price List — base da estimativa"';
      } else if (tipo === 'dia') {
        col1Lbl = 'Custo/h·dia'; col1Val = _brl(chora); col1Suf = '/h';
      } else {
        col1Lbl = 'Custo/h'; col1Val = _brl(chora); col1Suf = '/h';
      }

      // Coluna 2: horas do slider (todos os tipos usam o mesmo slider global)
      const col2Lbl = 'Horas';
      const col2Val = horas + 'h';

      return '<div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:10px;padding:12px 14px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'var(--border-light)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'

        // Nome + subtítulo
        + '<div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px;" title="' + _esc(r.resource_id || nome) + '">' + _esc(nome) + '</div>'
        + (subtit ? '<div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;">' + _esc(subtit) + '</div>' : '<div style="margin-bottom:6px;"></div>')

        // Badges: categoria, charge_type, rg, consumed_service, uso parcial
        + '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">'
        + (cat ? '<span style="font-size:10px;background:var(--accent-dim);color:var(--text-dim);border-radius:4px;padding:2px 7px;">' + cat + '</span>' : '')
        + (ct  ? '<span style="font-size:10px;border-radius:4px;padding:2px 7px;' + ctColor + ';">' + _esc(ct) + '</span>' : '')
        + (rg  ? '<span style="font-size:10px;background:rgba(77,166,255,.08);color:var(--blue);border-radius:4px;padding:2px 7px;">' + rg + '</span>' : '')
        + (svc ? '<span style="font-size:10px;background:var(--bg-card);color:var(--text-dim);border-radius:4px;padding:2px 7px;border:1px solid var(--border);">' + svc + '</span>' : '')
        + (usoParcial ? '<span style="font-size:10px;background:rgba(255,140,66,.15);color:var(--orange,#ff8c42);border-radius:4px;padding:2px 7px;" title="Recurso ficou ligado menos de 55% do m\xEAs no per\xEDodo importado">⚠ Uso parcial</span>' : '')
        + '</div>'

        // Linha de metadados (unidade · qty · horas_reais · pricing_model)
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:10px;color:var(--text-muted);">'
        + (r.unidade ? '<span><span style="opacity:.6;">UoM</span> ' + _esc(r.unidade) + '</span>' : '')
        + (qty !== '0' ? '<span><span style="opacity:.6;">Qtd</span> ' + qty + '</span>' : '')
        + (isHora && horasReais > 0 ? '<span title="Horas reais consumidas no per\xEDodo (qty \xD7 fator UoM)"><span style="opacity:.6;">H.reais</span> <strong style="color:' + (usoParcial ? 'var(--orange,#ff8c42)' : 'var(--text)') + ';">' + Math.round(horasReais).toLocaleString('pt-BR') + 'h</strong></span>' : '')
        + (pm ? '<span><span style="opacity:.6;">Modelo</span> ' + pm + '</span>' : '')
        + '</div>'

        // Grid de valores: tipo-aware (custo · período · cobrado · estimado)
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;"' + col1Tip + '>'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:' + (temPL ? 'var(--green,#22c55e)' : 'var(--text-muted)') + ';margin-bottom:2px;">' + col1Lbl + '</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:' + cor + ';">' + col1Val + '<span style="font-size:9px;">' + col1Suf + '</span></div>'
        + (temPL && isHora  ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">cobrado:\xA0' + _brl(chora) + '/h</div>' : '')
        + (temPL && !isHora ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">cobrado:\xA0' + _brl(mesBrl) + '/mês</div>' : '')
        + (tipo === 'reserva' && retailHoraRsv > 0 ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;" title="Preço on-demand do Price List (sem reserva)">on-dem:\xA0📋\xA0' + _brl(retailHoraRsv) + '/h</div>' : '')
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">' + col2Lbl + '</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:var(--accent);">' + col2Val + '</div>'
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

        // ── Linha de economia vs on-demand (hora/dia/periodo com Price List) ────
        + (dPct > 0
          ? '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:5px 8px;'
            + 'background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:6px;">'
            + '<span style="font-size:10px;color:var(--green,#22c55e);font-weight:600;">▼\xA0' + dPct.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '% desc.</span>'
            + '<span style="font-size:10px;color:var(--text-muted);flex:1;">vs on-demand'
            + (isHora && retailHora > 0 ? ' (' + _brl(retailHora) + '/h)' : '')
            + (!isHora && retailMes > 0 ? ' (' + _brl(retailMes) + '/mês)' : '') + '</span>'
            + (economiaPeriodo > 0
              ? '<span style="font-size:10px;color:var(--green,#22c55e);font-family:\'IBM Plex Mono\',monospace;font-weight:700;">'
                + _brl(economiaPeriodo) + ' ec.</span>'
              : '')
            + '</div>'
          : '')
        // ── Barra de desconto da reserva vs on-demand ────────────────────────
        + (tipo === 'reserva' && dPctRsv > 0
          ? '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:5px 8px;'
            + 'background:rgba(77,166,255,.08);border:1px solid rgba(77,166,255,.2);border-radius:6px;">'
            + '<span style="font-size:10px;color:var(--blue,#4da6ff);font-weight:600;">▼\xA0' + dPctRsv.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '% reserva</span>'
            + '<span style="font-size:10px;color:var(--text-muted);flex:1;">vs on-demand (' + _brl(retailHoraRsv) + '/h)</span>'
            + '<span style="font-size:10px;color:var(--blue,#4da6ff);font-family:\'IBM Plex Mono\',monospace;font-weight:700;">'
              + _brl((retailHoraRsv - chora) * horas) + ' ec.</span>'
            + '</div>'
          : '')

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

  let _taxaToastTimer = null;
  function _onAdicionaisChange() {
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    if (ii) localStorage.setItem(_LS_IMP,  ii.value);
    if (ic) localStorage.setItem(_LS_COND, ic.value);
    _atualizarBadgesTaxas();
    _atualizarEstimativa();
    clearTimeout(_taxaToastTimer);
    _taxaToastTimer = setTimeout(() => {
      const vi = parseFloat(ii?.value) || 0;
      const vc = parseFloat(ic?.value) || 0;
      const pi = parseFloat(localStorage.getItem(_LS_IMP_PAD)  ?? _TAXA_IMP_DEF);
      const pc = parseFloat(localStorage.getItem(_LS_COND_PAD) ?? _TAXA_COND_DEF);
      const diffI = Math.abs(vi - pi) >= 0.01;
      const diffC = Math.abs(vc - pc) >= 0.01;
      let msg = 'Taxas atualizadas: Imposto ' + vi + '% · Condomínio ' + vc + '%';
      if (diffI || diffC) msg += ' ⚠ Diferente do padrão salvo';
      _toast(msg, diffI || diffC ? 'warn' : 'success');
    }, 700);
  }

  function _custoHora(r, isBRL, taxaBrl) {
    const mono = "font-family:'IBM Plex Mono',monospace;";
    // tipo_custo vem do servidor; fallback para UoM quando dado antigo em cache
    const uom  = (r.unidade || '').toLowerCase();
    const tipo = r.tipo_custo || (
      uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo'
    );
    // RN-005 — Taxa de conversão para BRL
    const tcDB  = parseFloat(r.taxa_cambio || 0);
    const convR = !isBRL ? (tcDB > 1 ? tcDB : taxaBrl) : 1;
    const raw   = parseFloat(r.custo_hora_billing || 0);
    const preco = isBRL ? raw : raw * convR;
    // Tooltip de moeda
    const moedaTip = !isBRL
      ? ` title="${r.moeda||'USD'} × ${(tcDB > 1 ? tcDB : taxaBrl).toFixed(2)} = BRL${tcDB > 1 ? ' (taxa Azure)' : ' (taxa manual)'}"`
      : '';

    // ── Quantidade cobrada ──────────────────────────────────────────────────────
    const totalQty = parseFloat(r.total_qty || 0);
    const horasR   = parseFloat(r.horas_reais || 0);
    // Helper: gera a linha de quantidade abaixo da taxa (vazia quando qty = 0)
    const _qLinha = (n, sufixo, cor) => n > 0
      ? '<div style="font-size:9px;color:' + (cor || 'var(--text-muted)') + ';margin-top:1px;white-space:nowrap;">'
        + n.toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '\xA0' + sufixo
        + '</div>'
      : '';

    if (tipo === 'reserva') {
      // RN-002: custo amortizado pelo prazo da reserva (1 ou 3 anos)
      const qLinha     = _qLinha(totalQty, _esc(r.unidade || 'un.'));
      const _rvUomF    = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
      const _rvRetail  = parseFloat(r.retail_price_unit || 0);
      const _rvOnDem   = _rvRetail > 0 ? (_rvRetail / _rvUomF) * convR : 0;
      // Desconto da reserva vs on-demand (quanto você economiza por ter comprado a reserva)
      const _rvDPct    = _rvOnDem > 0 && preco > 0
        ? Math.max(0, parseFloat(((1 - preco / _rvOnDem) * 100).toFixed(1))) : 0;
      const dBadgeRsv  = _rvDPct > 0
        ? '<div style="font-size:9px;color:var(--green,#22c55e);margin-top:1px;white-space:nowrap;" title="Desconto da reserva vs on-demand retail Azure">▼\xA0' + _rvDPct.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%\xA0rsv</div>'
        : '';
      const plLinhaRsv = _rvOnDem > 0
        ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(255,255,255,.06);padding-top:2px;" title="Preço on-demand (Price List Azure)">📋\xA0' + _brl(_rvOnDem) + '/h od</div>'
        : '';
      return '<div style="' + mono + 'font-size:11px;color:var(--blue,#4da6ff);white-space:nowrap;"' + moedaTip + '>' + _brl(preco) + '</div>'
           + '<div style="font-size:9px;color:var(--blue,#4da6ff);" title="Amortizado pelo term da reserva (1 ano=8.760h / 3 anos=26.280h)">🔒 amort./h</div>'
           + dBadgeRsv
           + plLinhaRsv
           + qLinha;
    }

    if (tipo === 'hora') {
      // RN-001: taxa horária real; prefere horas_reais (qty × fator do SQL)
      const uomFator   = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
      const h          = horasR > 0 ? Math.round(horasR) : Math.round(totalQty * uomFator);
      const qLinha     = _qLinha(h, 'h consumidas');
      // Price List: preço retail/h normalizado pelo fator UoM
      const retailUnit = parseFloat(r.retail_price_unit || 0);
      const retailHora = retailUnit > 0 ? (retailUnit / uomFator) * convR : 0;
      const dPct       = parseFloat(r.desconto_pct || 0);
      // Linha de desconto (quando há dados do Price List)
      const dBadge     = dPct > 0
        ? '<div style="font-size:9px;color:var(--green,#22c55e);margin-top:1px;white-space:nowrap;" title="Desconto vs on-demand retail Azure">▼\xA0' + dPct.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%</div>'
        : '';
      // Linha do preço retail do Price List
      const plLinha    = retailHora > 0
        ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(255,255,255,.06);padding-top:2px;" title="Preço on-demand (Price List Azure)">📋\xA0' + _brl(retailHora) + '/h</div>'
        : '';
      return '<div style="' + mono + 'font-size:11px;color:var(--accent);white-space:nowrap;"' + moedaTip + '>' + _brl(preco) + '</div>'
           + '<div style="font-size:9px;color:var(--text-muted);">/h cobrado</div>'
           + dBadge
           + plLinha
           + qLinha;
    }

    if (tipo === 'dia') {
      // RN-003: UoM diária convertida para hora
      const uomFatorD  = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
      const qLinha     = _qLinha(totalQty, 'dias');
      const retailUnit = parseFloat(r.retail_price_unit || 0);
      const retailHora = retailUnit > 0 ? (retailUnit / uomFatorD) * convR : 0;
      const dPct       = parseFloat(r.desconto_pct || 0);
      const dBadge     = dPct > 0
        ? '<div style="font-size:9px;color:var(--green,#22c55e);margin-top:1px;white-space:nowrap;" title="Desconto vs on-demand retail Azure">▼\xA0' + dPct.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%</div>'
        : '';
      const plLinha    = retailHora > 0
        ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(255,255,255,.06);padding-top:2px;" title="Preço on-demand (Price List Azure)">📋\xA0' + _brl(retailHora) + '/h</div>'
        : '';
      return '<div style="' + mono + 'font-size:11px;color:var(--accent);white-space:nowrap;"' + moedaTip + '>' + _brl(preco) + '</div>'
           + '<div style="font-size:9px;color:var(--text-muted);" title="UoM diária ÷ 24">/h (dia)</div>'
           + dBadge
           + plLinha
           + qLinha;
    }

    // RN-004: Storage, Bandwidth, Functions — custo DIÁRIO (custo_mes ÷ 30)
    const _diasC   = parseInt(r.dias_ativos || 1) || 1;
    const mesRaw   = parseFloat(r.custo_mes_billing) ||
                     (parseFloat(r.total_billing || 0) / _diasC * 30);
    const mesBrl   = isBRL ? mesRaw : mesRaw * convR;
    const custoDia = mesBrl / 30;
    // Remove o prefixo "1 " do UoM para exibir só a unidade: "1 GB" → "GB", "1 Unit" → "Unit"
    const uomLabel = (r.unidade || '').replace(/^\d+\s+/, '').trim() || 'un.';
    const qLinha   = _qLinha(totalQty, _esc(uomLabel), 'var(--orange,#ff8c42)');
    // Price List para periodo (disco, storage…): retail_price_unit já em BRL
    const _plUomF   = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
    const _plRetail = parseFloat(r.retail_price_unit || 0);
    const _plMes    = _plRetail > 0 ? (_plRetail / _plUomF) * convR : 0;
    const _plMesDia = _plMes / 30;
    const _dPctPer  = _plMes > 0 && mesBrl > 0
      ? Math.max(0, parseFloat(((1 - mesBrl / _plMes) * 100).toFixed(1)))
      : 0;
    const dBadgePer = _dPctPer > 0
      ? '<div style="font-size:9px;color:var(--green,#22c55e);margin-top:1px;white-space:nowrap;" title="Desconto vs on-demand retail Azure">▼\xA0' + _dPctPer.toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%</div>'
      : '';
    const plMesLinha = _plMes > 0
      ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(255,255,255,.06);padding-top:2px;" title="Preço on-demand mensal (Price List Azure)">📋\xA0' + _brl(_plMesDia) + '/dia</div>'
      : '';
    return '<div style="' + mono + 'font-size:11px;color:var(--orange,#ff8c42);white-space:nowrap;"' + moedaTip + '>' + _brl(custoDia) + '</div>'
         + '<div style="font-size:9px;color:var(--orange,#ff8c42);" title="Cobrado por consumo (GB, Req…) — custo di\xE1rio = custo mensal \xF7 30">/dia cobrado</div>'
         + dBadgePer
         + plMesLinha
         + qLinha;
  }

  return { init, onSubChange, onRgChange, onFiltroChange, onTaxaChange, onBusca, buscarRecursos,
           selecionarTodos, deselecionarTodos, aplicarHorasGlobal, calcular,
           _check, _checkAll, _checkGrupo, _toggleGrupo, _horasChange, _setH, _onSlider, _onHorasInput,
           _toggleDropdown, _toggleOpcao, _filtrarDropdown,
           _selecionarTodosDropdown, _limparDropdown, _confirmarSub, _confirmarRg,
           _onAdicionaisChange, _salvarTaxasPadrao, _resetarTaxas,
           _setModoHoras, _calcHorasPeriodo, _sincDataFim, _sincHoraFim, _incluirPeriodo, _removerPeriodo,
           abrirPurge, fecharPurge, executarPurge,
           abrirReconciliacao, fecharReconciliacao, _onAzureRefInput,
           abrirDiagnostico, fecharDiagnostico, _diagFiltrar,
           abrirInvoice, fecharInvoice, gerarInvoicePDF, gerarPDFSalvo,
           fecharPreviewModal, voltarParaConfirmacao, imprimirEstimativa,
           _abrirConfigStep, _fecharConfigStep, _ovAplicarHoras, _ovImpostoChange, _ovCondChange,
           _ovGerarEstimativa,
           _switchVisao, _toggleDetalhe };
})();
