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
  let _periodos       = [];   // [{inicio, fim, horas, horasTotal, horasLivres, label}]
  let _horasAplicadas = false; // true somente após Aplicar (HORAS) ou Incluir Período
  let _horasPeriodoValidas = false; // true quando datas/horas do período formam intervalo > 0

  // ── Horário Livre (janela sem cobrança) ──────────────────────────────────────
  let _horarioLivre = {
    ativo:     false,
    inicio:    '09:00',
    fim:       '18:00',
    dias:      [1, 2, 3, 4, 5],  // 0=Dom 1=Seg … 6=Sab; padrão Seg–Sex
    inicio_sab:'09:00',
    fim_sab:   '18:00',
    inicio_dom:'09:00',
    fim_dom:   '18:00',
  };
  let _subsSel      = [];   // subscription_ids selecionados
  let _rgsSel       = [];   // resource_group_names selecionados
  let _subAtual     = '';   // compat legada
  let _rgAtual      = '';   // compat legada
  let _dataInicio   = '';
  let _dataFim      = '';
  let _taxaBrl      = 5.70;
  let _estimativa   = null;
  let _dbTaxaMap    = new Map(); // RN-DB-001: rg_lower → { C_vm, H_vm, taxa, valida, recursos }
  let _managedRgMap = new Map(); // rg_upper → { managed_type, managed_label } — detectado via API
  let _filtroTipos  = new Set(); // tipos selecionados no chip-bar (vazio = todos)
  let _rgTotalMap   = new Map(); // rg_upper → total billing do período (todos os recursos do RG)
  let _filtroTexto    = '';
  let _reconciliacao  = null;
  let _azureRefValue  = 0;
  let _iniciado      = false;
  let _apiBase             = '/api/calculadora'; // sobrescrito por init({ apiBase }) no portal público
  let _modoPublico         = false;              // true quando iniciado pelo portal sem login
  let _defaultConfig       = null;               // config do servidor aplicada no portal público (imposto, cond, hl)
  let _picoCarregado       = false;              // lazy pico: true após _carregarPico() completar
  let _ultimaUrlRecursos   = '';                 // path da última busca (para reuso no lazy pico)

  // ── API helper ───────────────────────────────────────────────────
  async function _api(method, path, body) {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    // path pode ser relativo (/subscriptions) ou absoluto (/api/azure-costs/...)
    // Remove prefixo legado /calculadora/ se presente (compatibilidade)
    const cleanPath = path.replace(/^\/calculadora\//, '/');
    const url = cleanPath.startsWith('/api/')
      ? window.location.origin + cleanPath
      : window.location.origin + _apiBase + cleanPath;
    const r = await fetch(url, opts);
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
<div id="cpurge-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:var(--bg-card,#1a1e28);border:1px solid var(--border);border-radius:14px;padding:0;width:min(92vw,500px);box-shadow:0 24px 70px rgba(0,0,0,.6);display:flex;flex-direction:column;max-height:90vh;overflow:hidden;">
    <!-- Header -->
    <div style="padding:18px 22px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--text)">🗑 Expurgo de Dados</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Remove registros de custo do banco permanentemente</div>
      </div>
      <button onclick="Calculadora.fecharPurge()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:4px">✕</button>
    </div>
    <!-- Body scrollável -->
    <div style="padding:18px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px">
      <!-- Resumo do banco -->
      <div id="cpurge-resumo" style="background:rgba(147,51,234,.07);border:1px solid rgba(147,51,234,.2);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--text-muted)">
        <span style="color:var(--accent)">⟳</span> Carregando dados do banco...
      </div>
      <!-- Modo -->
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Escopo do expurgo</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.02)">
            <input type="radio" name="cpurge-tipo" value="periodo" checked onchange="Calculadora._purgeOnModo(this.value)" style="accent-color:var(--accent)">
            <div><div style="font-size:13px;color:var(--text);font-weight:500">Por período</div><div style="font-size:11px;color:var(--text-muted)">Remove todos os registros dentro de um intervalo de datas</div></div>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.02)">
            <input type="radio" name="cpurge-tipo" value="arquivo" onchange="Calculadora._purgeOnModo(this.value)" style="accent-color:var(--accent)">
            <div><div style="font-size:13px;color:var(--text);font-weight:500">Por arquivo importado</div><div style="font-size:11px;color:var(--text-muted)">Remove apenas registros de um CSV/Parquet específico</div></div>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,77,106,.3);background:rgba(255,77,106,.04)">
            <input type="radio" name="cpurge-tipo" value="tudo" onchange="Calculadora._purgeOnModo(this.value)" style="accent-color:#ff4d6a">
            <div><div style="font-size:13px;color:var(--danger);font-weight:500">Todos os dados</div><div style="font-size:11px;color:var(--text-muted)">Apaga toda a base de custos — requer reimportação completa</div></div>
          </label>
        </div>
      </div>
      <!-- Área período -->
      <div id="cpurge-area-periodo">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">Data início</label>
            <input type="date" id="cpurge-data-ini" class="cs" style="width:100%;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">Data fim</label>
            <input type="date" id="cpurge-data-fim" class="cs" style="width:100%;box-sizing:border-box">
          </div>
        </div>
        <button onclick="Calculadora.verificarPurge()" style="font-size:12px;padding:6px 16px;border-radius:6px;border:1px solid var(--accent);background:rgba(147,51,234,.1);color:var(--accent);cursor:pointer">
          🔍 Verificar quantos registros serão removidos
        </button>
      </div>
      <!-- Área arquivo -->
      <div id="cpurge-area-arquivo" style="display:none">
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:6px">Arquivo importado</label>
        <select id="cpurge-sel" class="cs" style="width:100%;box-sizing:border-box">
          <option value="">— selecione —</option>
        </select>
        <button onclick="Calculadora.verificarPurge()" style="margin-top:8px;font-size:12px;padding:6px 16px;border-radius:6px;border:1px solid var(--accent);background:rgba(147,51,234,.1);color:var(--accent);cursor:pointer">
          🔍 Verificar
        </button>
      </div>
      <!-- Preview contagem -->
      <div id="cpurge-preview" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600"></div>
      <!-- Resultado final -->
      <div id="cpurge-result" style="display:none;font-size:12px;padding:8px 12px;border-radius:6px;"></div>
    </div>
    <!-- Footer -->
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0">
      <button onclick="Calculadora.fecharPurge()" class="cbtn-sec">Cancelar</button>
      <button id="cpurge-confirmar" onclick="Calculadora.executarPurge()" disabled style="display:inline-flex;align-items:center;gap:6px;padding:0 18px;height:36px;border-radius:6px;border:none;background:#ff4d6a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;opacity:.45">
        🗑 Confirmar Expurgo
      </button>
    </div>
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
<div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:end;padding:13px 24px;background:var(--bg-card);border-bottom:1px solid var(--border);flex-shrink:0;">

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

  <!-- Período de filtragem — pre-preenchido com range do banco ao confirmar assinatura -->
  <div class="cfg">
    <label class="cl">Período</label>
    <div style="display:flex;align-items:center;gap:5px;">
      <input type="date" id="cfiltro-ini" style="height:34px;padding:0 8px;border-radius:6px;border:1px solid var(--border-light);background:var(--bg);color:var(--text);font-size:12px;outline:none;min-width:128px;" title="Data início do filtro">
      <span style="color:var(--text-muted);font-size:11px;flex-shrink:0;">→</span>
      <input type="date" id="cfiltro-fim" style="height:34px;padding:0 8px;border-radius:6px;border:1px solid var(--border-light);background:var(--bg);color:var(--text);font-size:12px;outline:none;min-width:128px;" title="Data fim do filtro">
    </div>
  </div>

  <div class="cfg"><button id="cbuscar-btn" class="cbtn-go" onclick="Calculadora.buscarRecursos()" style="height:34px;padding:0 14px;opacity:.4;cursor:not-allowed;" disabled title="Selecione pelo menos um Resource Group para buscar">
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
      <button id="cbtn-sel-todos" class="cbtn-sec" onclick="Calculadora.selecionarTodos()">Sel. todos</button>
      <button id="cbtn-limpar" class="cbtn-sec" onclick="Calculadora.deselecionarTodos()">Limpar</button>
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
    <!-- Chips de tipo de recurso -->
    <div id="ctipos-bar" style="display:none;padding:6px 13px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
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
            <th class="cth" title="Pricing Model no tooltip da célula">Charge Type</th>
            <th class="cth">Unit of Measure</th>
            <th class="cth" style="text-align:right;">Consumed Quantity</th>
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
          <label class="cl">E-mail</label>
          <input type="email" id="cinv-email" class="ci" placeholder="email@empresa.com">
        </div>
      </div>
      <div style="margin-bottom:12px;padding:8px 12px;border-radius:6px;background:var(--bg);border:1px solid var(--border);font-size:11px;color:var(--text-muted);display:flex;align-items:flex-start;gap:5px;line-height:1.4;">
        <span style="color:var(--orange);font-size:13px;flex-shrink:0;">⚠</span>
        <span>Válida por 5 dias. Após o prazo, abra uma nova solicitação.</span>
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

          <!-- Coluna 1 — Fonte do Preço -->
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Fonte do Preço</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:11px;flex-shrink:0;margin-top:1px;">💰</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--accent);">Custo/h</strong> ou <strong style="color:var(--text-muted);">Custo/mês*</strong> — média do billing histórico. Estimado fica <strong style="color:var(--text-muted);">cinza</strong>.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:11px;flex-shrink:0;margin-top:1px;">🔒</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--blue,#4da6ff);">Amort./h 🔒</strong> — custo amortizado da reserva (1 ou 3 anos). Estimado = amort./h × horas, permanece fixo.</span>
            </div>
          </div>

          <!-- Coluna 2 — Indicadores + Databricks + Coluna Estimado -->
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Indicadores</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;flex-shrink:0;margin-top:1px;opacity:.6;">⏱</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--accent);">H.reais</strong> — horas que o recurso ficou ligado no período (qty × fator UoM). Só aparece para recursos horários.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;flex-shrink:0;margin-top:1px;">⚠</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--orange,#ff8c42);">Uso parcial</strong> — recurso ligado menos de 55% do mês (&lt;400h). Estimativa de mês cheio pode superestimar.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;font-weight:700;flex-shrink:0;margin-top:1px;color:var(--text-muted);">/mês*</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong>/mês*</strong> — storage, bandwidth e similares: sem taxa horária fixa. Estimado = custo mensal × (horas ÷ 720).</span>
            </div>

            <div style="margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--blue,#4da6ff);margin-bottom:2px;">⚡ Databricks</div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;flex-shrink:0;margin-top:1px;">⚡</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--accent);">Cluster/h</strong> — taxa do workspace Databricks: C_total ÷ H_driver. H_driver = soma dos picos diários de horas (abordagem diária), captura múltiplas sessões do cluster.</span>
            </div>

            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-size:10px;background:rgba(77,166,255,.12);color:var(--blue,#4da6ff);border-radius:4px;padding:1px 5px;flex-shrink:0;margin-top:1px;">⚡</span>
              <span style="font-size:10px;color:var(--text-dim);line-height:1.3;"><strong style="color:var(--blue,#4da6ff);">Badge azul ⚡</strong> — estimativa proporcional: billing_VM ÷ H_driver × horas. Soma de todas as VMs do RG = taxa_cluster × horas.</span>
            </div>

            <div style="margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:2px;">Coluna Estimado</div>

            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:10px;height:10px;background:var(--text-muted);border-radius:2px;flex-shrink:0;opacity:.5;"></span>
              <span style="font-size:10px;color:var(--text-dim);"><strong style="color:var(--text-muted);">Cinza</strong> — baseado no billing histórico</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;">🔒</span>
              <span style="font-size:10px;color:var(--text-dim);"><strong style="color:var(--blue,#4da6ff);">Cinza 🔒</strong> — reserva: valor amortizado fixo pelo term do contrato</span>
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

        <!-- Card: Horário Livre — só visível no modo Período -->
        <div id="chl-card" style="display:none;background:var(--bg-hover);border:1px solid var(--border);border-radius:12px;padding:16px;flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);">⏰ Horário Livre</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button onclick="Calculadora._hlSalvarPadrao()" title="Salvar como padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:700;cursor:pointer;">★ Padrão</button>
              <button onclick="Calculadora._hlLimparPadrao()" title="Restaurar padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:600;cursor:pointer;">↺</button>
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">
                <input type="checkbox" id="chl-ativo" onchange="Calculadora._hlToggle(this.checked)"
                  style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;">
                <span style="font-size:10px;color:var(--text-muted);">Ativar</span>
              </label>
            </div>
          </div>
          <div id="chl-corpo" style="display:none;">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">Dias úteis (Seg–Sex)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
              <div>
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Início</div>
                <input type="time" id="chl-ini" class="ci" value="09:00" step="3600"
                  style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                  onchange="Calculadora._hlChange()">
              </div>
              <div>
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Fim</div>
                <input type="time" id="chl-fim" class="ci" value="18:00" step="3600"
                  style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                  onchange="Calculadora._hlChange()">
              </div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;">Dias sem cobrança</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
              ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d,i) =>
                `<label style="display:flex;align-items:center;gap:2px;cursor:pointer;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:rgba(147,51,234,.06);font-size:10px;color:var(--text-muted);">
                  <input type="checkbox" data-dia="${i}" class="chl-dia" ${[1,2,3,4,5].includes(i)?'checked':''} onchange="Calculadora._hlChange()"
                    style="width:11px;height:11px;accent-color:var(--accent);cursor:pointer;"> ${d}
                </label>`
              ).join('')}
            </div>
            <!-- Horário específico Sábado -->
            <div id="chl-sab-row" style="display:none;background:rgba(147,51,234,.05);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;">Sábado — horário específico</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Início</div>
                  <input type="time" id="chl-ini-sab" class="ci" value="09:00" step="3600"
                    style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                    onchange="Calculadora._hlChange()">
                </div>
                <div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Fim</div>
                  <input type="time" id="chl-fim-sab" class="ci" value="18:00" step="3600"
                    style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                    onchange="Calculadora._hlChange()">
                </div>
              </div>
            </div>
            <!-- Horário específico Domingo -->
            <div id="chl-dom-row" style="display:none;background:rgba(147,51,234,.05);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:8px;">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;">Domingo — horário específico</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Início</div>
                  <input type="time" id="chl-ini-dom" class="ci" value="09:00" step="3600"
                    style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                    onchange="Calculadora._hlChange()">
                </div>
                <div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Fim</div>
                  <input type="time" id="chl-fim-dom" class="ci" value="18:00" step="3600"
                    style="width:100%;height:32px;font-size:13px;padding:0 6px;"
                    onchange="Calculadora._hlChange()">
                </div>
              </div>
            </div>
            <div id="chl-res" style="font-size:11px;color:var(--text-muted);padding:6px 8px;background:var(--bg-card);border-radius:6px;border:1px solid var(--border);line-height:1.6;min-height:30px;"></div>
          </div>
          <div id="chl-hint" style="font-size:10px;color:var(--text-muted);font-style:italic;">
            Define janela diária sem cobrança. Ex: desligar ambiente das 09h–18h nos dias úteis.
          </div>
        </div>

        <!-- Card: Taxas -->
        <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:12px;padding:16px;flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);">Taxas Adicionais</div>
            <div id="ctaxas-btns" style="display:flex;gap:4px;">
              <button onclick="Calculadora._salvarTaxasPadrao()" title="Salvar como padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:700;cursor:pointer;">★ Padrão</button>
              <button onclick="Calculadora._resetarTaxas()" title="Restaurar padrão"
                style="height:20px;padding:0 8px;border-radius:4px;border:1px solid var(--accent);background:var(--accent-dim);color:var(--text-muted);font-size:9px;font-weight:600;cursor:pointer;">↺</button>
            </div>
          </div>
          <div id="ctaxas-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
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
            <div id="cgordura-col">
              <div style="font-size:11px;color:var(--text-dim);font-weight:600;margin-bottom:5px;">Gordura</div>
              <div style="display:flex;align-items:center;gap:4px;">
                <input type="number" id="cgordura" class="ci" value="0" min="0" max="200" step="0.5"
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
          <div id="cov-row-gord" style="display:none;justify-content:space-between;font-size:12px;color:var(--text-muted);">
            <span id="cov-lbl-gord">+ Gordura (0%)</span>
            <span id="cov-vl-gord" style="font-family:'IBM Plex Mono',monospace;">R$ 0,00</span>
          </div>
          <div style="border-top:1px solid var(--border-light);margin-top:2px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-dim);font-weight:700;">Total Estimado</span>
            <span id="cov-total" style="font-family:'IBM Plex Mono',monospace;font-size:1.5rem;font-weight:700;color:var(--accent);">R$ 0,00</span>
          </div>
          <div id="cov-row-fixo" style="display:none;flex-direction:column;gap:3px;border-radius:7px;background:rgba(77,166,255,.06);border:1px solid rgba(77,166,255,.25);padding:7px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:10px;color:var(--blue,#4da6ff);font-weight:700;letter-spacing:.04em;">🔒 Infra Fixa/mês</span>
              <span id="cov-vl-fixo" style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:var(--blue,#4da6ff);">R$ 0,00</span>
            </div>
            <div style="font-size:9px;color:var(--text-muted);line-height:1.4;">Custo mensal fixo — não entra no Total Estimado. Cobrado independente das horas do projeto.</div>
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
  function init(opts) {
    // opts.apiBase  → troca base da API (ex: '/api/public/calculadora' para portal público)
    // opts.publico  → desativa features que requerem auth (import, diagnóstico, etc.)
    if (opts && opts.apiBase)       { _apiBase = opts.apiBase; }
    if (opts && opts.publico)       { _modoPublico = true; }
    if (opts && opts.defaultConfig) { _defaultConfig = opts.defaultConfig; }

    const view = document.getElementById('view-calculadora');
    if (!view) { console.error('Calculadora: #view-calculadora não encontrada'); return; }

    if (!_iniciado) {
      view.innerHTML = _html();
      _iniciado = true;
      if (!_modoPublico) _setupImport();
      if (_modoPublico) {
        const _hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        _hide('cvtab-det');
        _hide('cvtab-svc');
        _hide('cgordura-col');
        _hide('ctaxas-btns');
        const _grid = document.getElementById('ctaxas-grid');
        if (_grid) _grid.style.gridTemplateColumns = '1fr 1fr';
        _aplicarRestricoesPortal();
      }
      _setupDateListeners();
      _setupClickFora();
      _carregarTaxas();
    }

    _carregarSubscriptions();
  }

  function _setupDateListeners() { /* removido — datas calculadas automaticamente em buscarRecursos() */ }

  function _aplicarRestricoesPortal() {
    const podePeriodo   = !!_defaultConfig?.permitir_selecao_periodo;
    const podeRecursos  = !!_defaultConfig?.permitir_selecao_recursos;

    // Trava campos de data se não permitido
    const _lockDate = id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !podePeriodo;
      el.style.opacity = podePeriodo ? '' : '.45';
      el.style.cursor  = podePeriodo ? '' : 'not-allowed';
    };
    _lockDate('cfiltro-ini');
    _lockDate('cfiltro-fim');

    // Desativa botões Sel.todos / Limpar e checkbox de cabeçalho se não permitido
    const _lockBtn = id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !podeRecursos;
      el.style.opacity = podeRecursos ? '' : '.35';
      el.style.cursor  = podeRecursos ? '' : 'not-allowed';
    };
    _lockBtn('cbtn-sel-todos');
    _lockBtn('cbtn-limpar');
    _lockBtn('cck-all');
  }

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
      const errosArquivos = [];

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
            const erroMsg = resultado.erro || 'erro no servidor';
            errosArquivos.push({ arquivo: file.name, erro: erroMsg });
            atualEl.textContent    = `⚠ ${file.name}: ${erroMsg}`;
            fillEl.style.background= 'var(--danger)';
          }

        } catch (err) {
          falhas++;
          errosArquivos.push({ arquivo: file.name, erro: err.message });
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
        : `${concluidos} ok${falhas ? ` · <span style="color:var(--danger)">${falhas} com erro</span>` : ''} · <strong>${totalInseridos.toLocaleString('pt-BR')}</strong> novos`
          + (errosArquivos.length
            ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.6">`
              + errosArquivos.map(e => `<div>⚠ <strong style="color:var(--danger)">${e.arquivo}</strong>: ${e.erro}</div>`).join('')
              + `</div>`
            : '');

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

  // Reordena lista de RGs: filhos (RGs gerenciados) logo abaixo do pai visível
  function _sortRgsComFilhos(lista) {
    const inList = new Set(lista.map(d => (d.value || '').toUpperCase()));
    const filhosMap = new Map(); // parent_upper → [items]
    const raizes = [];
    for (const d of lista) {
      const pUp = (d.parent_rg || '').toUpperCase();
      if (d.parent_rg && inList.has(pUp)) {
        if (!filhosMap.has(pUp)) filhosMap.set(pUp, []);
        filhosMap.get(pUp).push(d);
      } else {
        raizes.push(d);
      }
    }
    const result = [];
    for (const r of raizes) {
      result.push(r);
      const kids = filhosMap.get((r.value || '').toUpperCase()) || [];
      result.push(...kids);
    }
    return result;
  }

  function _renderOpcoes(id, filtro) {
    const state = _dds[id]; filtro = filtro || '';
    const opts  = document.getElementById(id+'-options'); if (!opts) return;
    let lista = filtro ? state.data.filter(d => d.label.toLowerCase().includes(filtro.toLowerCase())) : state.data;
    if (id === 'crg') lista = _sortRgsComFilhos(lista);
    state.filtered = lista;
    if (!lista.length) { opts.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">${state.data.length?'Nenhum resultado.':'Nenhum item.'}</div>`; return; }
    const listUpper = new Set(lista.map(d => (d.value || '').toUpperCase()));
    opts.innerHTML = lista.map(d => {
      const subColor = d.managed_type === 'databricks'
        ? 'color:var(--accent);'
        : d.managed_type === 'aks'
        ? 'color:var(--orange,#ff8c42);'
        : '';
      const pUp = (d.parent_rg || '').toUpperCase();
      const comPai = d.parent_rg && listUpper.has(pUp);
      const indentStyle = comPai ? 'padding-left:20px;border-left:2px solid var(--border-light,#3d0060);margin-left:6px;' : '';
      const prefix = comPai ? '<span style="color:var(--text-muted);margin-right:4px;font-size:10px;">↳</span>' : '';
      return `<label class="cms-option" style="${indentStyle}"><input type="checkbox" ${state.selected.has(d.value)?'checked':''} onchange="Calculadora._toggleOpcao('${id}','${_esc(d.value)}',this.checked)">${prefix}<span class="cms-option-label" title="${_esc(d.label)}">${_esc(d.label)}</span>${d.sub?`<span class="cms-option-sub" style="${subColor}">${_esc(d.sub)}</span>`:''}</label>`;
    }).join('');
  }

  function _toggleOpcao(id, value, checked) {
    if (checked) _dds[id].selected.add(value); else _dds[id].selected.delete(value);
    // RG: propaga seleção para filhos gerenciados (Databricks, AKS)
    if (id === 'crg') {
      const vUp = value.toUpperCase();
      _dds.crg.data.forEach(d => {
        if ((d.parent_rg || '').toUpperCase() === vUp) {
          if (checked) _dds.crg.selected.add(d.value);
          else         _dds.crg.selected.delete(d.value);
        }
      });
      _renderOpcoes('crg', document.getElementById('crg-search')?.value || '');
    }
    _atualizarBadge(id);
  }

  function _filtrarDropdown(id, valor) { _renderOpcoes(id, valor); }

  function _selecionarTodosDropdown(id) {
    (_dds[id].filtered.length ? _dds[id].filtered : _dds[id].data).forEach(d => _dds[id].selected.add(d.value));
    _renderOpcoes(id, document.getElementById(id+'-search')?.value||''); _atualizarBadge(id);
  }

  function _limparDropdown(id) {
    _dds[id].selected.clear();
    const srch = document.getElementById(id + '-search');
    if (srch) srch.value = '';
    _renderOpcoes(id, '');
    _atualizarBadge(id);
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
    _atualizarBotaoBuscar(); // bloqueia Buscar pois RGs foram limpos
    if (!_subsSel.length) { document.getElementById('crg-trigger').classList.add('cms-disabled'); return; }
    document.getElementById('crg-trigger').classList.remove('cms-disabled');
    // Pre-preenche campos de data com os últimos 30 dias de dados disponíveis
    const _fimDB = _subsSel.map(id => (_dds.csub.data.find(s => s.value === id)||{}).periodo_fim||'').filter(Boolean).sort().pop()||'';
    const _elIni = document.getElementById('cfiltro-ini');
    const _elFim = document.getElementById('cfiltro-fim');
    if (_fimDB) {
      const _fim30 = new Date(_fimDB + 'T12:00:00');
      const _ini30 = new Date(_fim30); _ini30.setDate(_ini30.getDate() - 30);
      const _fmt30 = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (_elIni) _elIni.value = _fmt30(_ini30);
      if (_elFim) _elFim.value = _fmt30(_fim30);
    }
    document.getElementById('crg-options').innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Carregando...</div>';
    try {
      const data = await _api('GET', `/calculadora/resource-groups?subscription_id=${_subsSel.map(encodeURIComponent).join(',')}`);
      if (!Array.isArray(data)||!data.length) { document.getElementById('crg-options').innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Nenhum RG encontrado.</div>'; return; }
      _managedRgMap.clear();
      _dds.crg.data = data.map(r => {
        const mt = r.managed_type;
        const ml = r.managed_label || '';
        if (mt) _managedRgMap.set((r.resource_group_name || '').toUpperCase(), { managed_type: mt, managed_label: ml });
        const icon = mt === 'databricks' ? '⚡' : mt === 'aks' ? '☸' : null;
        const sub  = icon ? icon + ' ' + (mt === 'databricks' ? 'Databricks — workspace: ' + ml : 'AKS — cluster: ' + ml) : '';
        return { value: r.resource_group_name, label: r.resource_group_name, labelShort: r.resource_group_name, sub, managed_type: mt, parent_rg: r.parent_rg || null };
      });
      _renderOpcoes('crg');
    } catch(err) { document.getElementById('crg-options').innerHTML=`<div style="padding:8px 12px;font-size:12px;color:#ff4d6a;">Erro: ${_esc(err.message)}</div>`; }
  }

  async function _confirmarRg() {
    _rgsSel=[..._dds.crg.selected]; _rgAtual=_rgsSel[0]||'';
    document.getElementById('crg-dropdown').style.display='none';
    document.getElementById('crg-trigger').classList.remove('cms-active');
    _atualizarBadge('crg');
    _atualizarBotaoBuscar();
  }

  async function _carregarSubscriptions() {
    const opts = document.getElementById('csub-options'); if (!opts) return;
    opts.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Carregando...</div>';
    try {
      const data = await _api('GET', '/calculadora/subscriptions');
      if (!Array.isArray(data)||!data.length) {
        opts.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Nenhuma assinatura. Importe um CSV/Parquet.</div>';
        _diagCache();
        return;
      }
      _dds.csub.data = data.map(s => { const ini=(s.periodo_inicio||'').slice(0,10),fim=(s.periodo_fim||'').slice(0,10); const nome=s.subscription_name||s.subscription_id; return { value:s.subscription_id, label:nome, labelShort:nome, sub:'', periodo_ini:ini, periodo_fim:fim }; });
      _renderOpcoes('csub');
    } catch(err) { opts.innerHTML=`<div style="padding:8px 12px;font-size:12px;color:#ff4d6a;">Erro: ${_esc(err.message)}</div>`; }
  }

  function onSubChange() {}
  function onRgChange()  {}

  async function _diagCache() {
    const opts = document.getElementById('csub-options');
    try {
      const d = await _api('GET', '/azure-costs/diag');
      const total   = parseInt(d.azure_costs?.total   || 0);
      const comSub  = parseInt(d.azure_costs?.com_sub || 0);
      const comData = parseInt(d.azure_costs?.com_data|| 0);
      const subs    = parseInt(d.subs_cache?.total    || 0);
      const ok = total > 0 && comSub > 0;

      let html = `<div style="padding:10px 12px;font-size:11px;line-height:1.7">`;
      if (total === 0) {
        html += `<div style="color:var(--danger);font-weight:600">❌ azure_costs está vazia — importe um CSV/Parquet</div>`;
      } else if (comSub === 0) {
        html += `<div style="color:var(--orange);font-weight:600">⚠ ${total.toLocaleString('pt-BR')} linhas importadas mas subscription_id é nulo em todos</div>`;
        if (d.colunas_amostra?.length) html += `<div style="color:var(--text-muted);margin-top:4px">Colunas encontradas: <span style="font-family:monospace">${d.colunas_amostra.join(', ')}</span></div>`;
        if (d.amostra_valores) html += `<div style="color:var(--text-muted)">Amostra: ${JSON.stringify(d.amostra_valores)}</div>`;
      } else {
        html += `<div style="color:var(--green)">✅ ${total.toLocaleString('pt-BR')} linhas · ${comSub.toLocaleString('pt-BR')} com subscription · ${comData.toLocaleString('pt-BR')} com data</div>`;
        html += `<div style="color:var(--text-muted)">Cache: ${subs} assinatura(s)</div>`;
      }
      html += `<button onclick="Calculadora._forcarRefreshCache()" style="margin-top:8px;font-size:11px;padding:3px 12px;background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.4);color:var(--accent);border-radius:6px;cursor:pointer">🔄 Forçar rebuild de cache</button>`;
      html += `</div>`;
      if (opts) opts.innerHTML = html;
    } catch (_) {}
  }

  async function _forcarRefreshCache() {
    const opts = document.getElementById('csub-options');
    if (opts) opts.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">Reconstruindo cache...</div>';
    try {
      const r = await _api('POST', '/azure-costs/refresh-cache');
      if (r.subs > 0) {
        _carregarSubscriptions();
      } else {
        if (opts) opts.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--danger);">Cache reconstruído mas ainda 0 assinaturas. Verifique o import.</div>`;
        _diagCache();
      }
    } catch (e) {
      if (opts) opts.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--danger);">Erro: ${_esc(e.message)}</div>`;
    }
  }

  async function buscarRecursos() {
    if (!_subsSel.length) { _toast('Selecione assinaturas e clique OK ✓.', 'error'); return; }
    _horasAplicadas = false;
    _setBuscarLoading(true);

    // Formata Date → 'YYYY-MM-DD' usando hora local (evita bug de fuso UTC)
    const _fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Portal público sem permissão de período: últimos 30 dias com dados (igual ao autenticado)
    if (_modoPublico && !_defaultConfig?.permitir_selecao_periodo) {
      const fimPub = _subsSel
        .map(id => (_dds.csub.data.find(s => s.value === id) || {}).periodo_fim || '')
        .filter(Boolean).sort().pop() || '';
      const fimBase = fimPub ? new Date(fimPub + 'T12:00:00') : new Date();
      const iniBase = new Date(fimBase); iniBase.setDate(iniBase.getDate() - 30);
      _dataFim    = _fmt(fimBase);
      _dataInicio = _fmt(iniBase);
      const _elIni = document.getElementById('cfiltro-ini');
      const _elFim = document.getElementById('cfiltro-fim');
      if (_elIni) { _elIni.value = _dataInicio; _elIni.disabled = true; }
      if (_elFim) { _elFim.value = _dataFim;    _elFim.disabled = true; }
    } else {
      // Usa datas dos inputs de filtro se preenchidas; caso contrário usa range do banco
      const _filtIni = document.getElementById('cfiltro-ini')?.value;
      const _filtFim = document.getElementById('cfiltro-fim')?.value;
      if (_filtIni && _filtFim) {
        _dataInicio = _filtIni;
        _dataFim    = _filtFim;
      } else {
        const maxFim = _subsSel
          .map(id => (_dds.csub.data.find(s => s.value === id) || {}).periodo_fim || '')
          .filter(Boolean).sort().pop() || '';
        if (maxFim) {
          const fim = new Date(maxFim + 'T12:00:00');
          const ini = new Date(fim); ini.setDate(ini.getDate() - 30);
          _dataFim    = _fmt(fim);
          _dataInicio = _fmt(ini);
        } else {
          const hoje = new Date();
          const ini  = new Date(hoje); ini.setDate(ini.getDate() - 30);
          _dataFim    = _fmt(hoje);
          _dataInicio = _fmt(ini);
        }
      }
    }

    _selecionados = {};
    _dadosDetalhe = [];
    _dadosServico = [];
    try {
      await _carregarRecursos();
      if (_modoVisao === 'detalhe') _buscarDetalhe();
      if (_modoVisao === 'servico') _buscarServico();
    } finally {
      _setBuscarLoading(false);
    }
  }

  async function onFiltroChange() {
    if (_subsSel.length) await buscarRecursos();
  }

  function _tipoRecurso(r) {
    const svc = (r.consumed_service || '').toLowerCase();
    const cat = (r.meter_category   || '').toLowerCase();
    const rg  = (r.resource_group_name || '').toLowerCase();
    const nom = (r.nome_recurso || r.resource_id || '').toLowerCase();
    // Databricks: software (consumed_service) OU VMs gerenciadas em RGs Databricks
    if (svc.includes('databricks') || cat.includes('databricks') || rg.startsWith('databricks-rg-') || rg.startsWith('managed-rg-adbx-')) return 'Databricks';
    // AKS: containerservice OU nós VMSS de AKS (nom começa com 'aks-' ou RG começa com 'mc_')
    if (svc.includes('containerservice') || cat.includes('kubernetes') || (svc.includes('compute') && (nom.startsWith('aks-') || rg.startsWith('mc_')))) return 'AKS';
    // Backup: snapshots/restore points do Azure Backup (nome começa com 'azurebackup_')
    if (nom.startsWith('azurebackup_') || cat.includes('azure backup') || cat.includes('backup vault')) return 'Backup';
    // meter_category explícito tem prioridade: Virtual Machines antes de checar nome
    if (cat.includes('virtual machine')) return 'VMs';
    // Discos: managed disk, nome contém 'disk' ou PVCs do Kubernetes (pvc-)
    if (cat.includes('managed disk') || cat.includes('disk') || (svc.includes('compute') && (nom.includes('disk') || nom.startsWith('pvc-')))) return 'Discos';
    if (svc.includes('compute')) return 'VMs';
    if (cat.includes('storage') || svc.includes('storage')) return 'Storage';
    if (cat.includes('load balancer')) return 'Load Balancer';
    if (cat.includes('bandwidth') || cat.includes('content delivery') || cat.includes('egress') || cat.includes('cdn') || svc.includes('.cdn') || cat.includes('front door') || svc.includes('frontdoor')) return 'Rede/CDN';
    if (svc.includes('network') || cat.includes('ip address') || cat.includes('virtual network') || cat.includes('dns') || cat.includes('traffic manager') || svc.includes('trafficmanager') || svc.includes('privatedns')) return 'Rede';
    if (svc.includes('sql') || cat.includes('sql')) return 'SQL';
    if (svc.includes('dbforpostgresql') || svc.includes('dbformysql') || svc.includes('dbformariadb') || svc.includes('documentdb') || cat.includes('cosmos db') || cat.includes('postgresql') || cat.includes('mysql') || cat.includes('mariadb') || cat.includes('azure database')) return 'Banco de Dados';
    if (svc.includes('cache') || cat.includes('redis') || cat.includes('cache for redis')) return 'Cache';
    if (svc.includes('eventhub') || svc.includes('servicebus') || svc.includes('eventgrid') || svc.includes('notificationhubs') || cat.includes('event hubs') || cat.includes('service bus') || cat.includes('event grid') || cat.includes('notification hubs')) return 'Mensageria';
    if (svc.includes('containerregistry') || svc.includes('containerinstance') || cat.includes('container registry') || cat.includes('container instances')) return 'Containers';
    if (svc.includes('cognitiveservices') || svc.includes('machinelearning') || svc.includes('openai') || cat.includes('cognitive') || cat.includes('machine learning') || cat.includes('openai') || cat.includes('azure ai')) return 'IA/ML';
    if (svc.includes('synapse') || svc.includes('streamanalytics') || svc.includes('hdinsight') || svc.includes('powerbidedicated') || svc.includes('datafactory') || cat.includes('synapse') || cat.includes('stream analytics') || cat.includes('hdinsight') || cat.includes('power bi') || cat.includes('data factory')) return 'Analytics';
    if (svc.includes('apimanagement') || svc.includes('logic') || svc.includes('automation') || cat.includes('api management') || cat.includes('logic apps') || cat.includes('automation') || cat.includes('integration')) return 'Integração';
    if (svc.includes('web') || cat.includes('app service') || cat.includes('functions') || cat.includes('azure functions') || cat.includes('app configuration') || svc.includes('appconfiguration')) return 'App Service';
    if (svc.includes('keyvault') || cat.includes('key vault')) return 'Key Vault';
    if (svc.includes('recoveryservices') || cat.includes('backup') || cat.includes('recovery services') || cat.includes('site recovery')) return 'Backup';
    if (svc.includes('monitor') || svc.includes('operationalinsights') || svc.includes('.insights') || cat.includes('monitor') || cat.includes('log analytics') || cat.includes('application insights')) return 'Monitoramento';
    if (r.charge_type === 'Purchase' || r.pricing_model === 'Reservation') return 'Reservas';
    return 'Outros';
  }

  function _renderTiposBar() {
    const bar = document.getElementById('ctipos-bar');
    if (!bar) return;
    if (!_recursos.length) { bar.style.display = 'none'; return; }

    const contagem = {};
    _recursos.forEach(r => {
      const t = _tipoRecurso(r);
      contagem[t] = (contagem[t] || 0) + 1;
    });

    const tipos = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
    if (tipos.length < 1) { bar.style.display = 'none'; _filtroTipos.clear(); return; }

    bar.style.display = 'flex';
    bar.innerHTML = '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">Tipo:</span>'
      + tipos.map(([tipo, cnt]) => {
          const ativo = _filtroTipos.size === 0 || _filtroTipos.has(tipo);
          const col   = tipo === 'VMs' ? 'var(--accent)' : tipo === 'Discos' || tipo === 'Storage' ? 'var(--orange,#ff8c42)' : tipo === 'Rede' || tipo === 'Rede/CDN' ? 'var(--blue,#4da6ff)' : tipo === 'Databricks' ? 'var(--accent)' : tipo === 'AKS' || tipo === 'Containers' ? 'var(--orange,#ff8c42)' : tipo === 'Backup' || tipo === 'Mensageria' ? 'var(--green,#22c55e)' : tipo === 'SQL' || tipo === 'Banco de Dados' || tipo === 'Cache' ? 'var(--blue,#4da6ff)' : tipo === 'IA/ML' || tipo === 'Analytics' ? 'var(--accent)' : 'var(--text-dim)';
          const bg    = ativo ? 'rgba(147,51,234,.15)' : 'rgba(255,255,255,.04)';
          const bord  = ativo ? 'var(--accent)' : 'var(--border)';
          const diagBtn = tipo === 'Outros'
            ? ` <button onclick="event.stopPropagation();Calculadora._diagOutros()" title="Ver detalhes dos recursos Outros" style="font-size:9px;padding:0 4px;border-radius:6px;border:1px solid var(--orange,#ff8c42);background:rgba(255,140,66,.12);color:var(--orange,#ff8c42);cursor:pointer;margin-left:2px;vertical-align:middle;">🔍</button>`
            : '';
          return `<button onclick="Calculadora._toggleTipo('${tipo.replace(/'/g,"\\'")}',this)"
            style="font-size:10px;padding:2px 9px;border-radius:10px;border:1px solid ${bord};background:${bg};color:${ativo?col:'var(--text-muted)'};cursor:pointer;white-space:nowrap;transition:all .15s;"
            title="${tipo}: ${cnt} recurso${cnt!==1?'s':''}">${tipo} <span style="opacity:.7;">${cnt}</span></button>${diagBtn}`;
        }).join('');
  }

  function _toggleTipo(tipo, btn) {
    if (_filtroTipos.has(tipo)) {
      _filtroTipos.delete(tipo);
      if (!_filtroTipos.size) _filtroTipos.clear(); // todos ativos
    } else {
      _filtroTipos.add(tipo);
    }
    _renderTiposBar();
    _renderRecursos();
  }

  function _diagOutros() {
    const outros = _recursos.filter(r => _tipoRecurso(r) === 'Outros');
    if (!outros.length) { alert('Nenhum recurso classificado como Outros.'); return; }

    // Agrupa por consumed_service + meter_category
    const grupos = new Map();
    outros.forEach(r => {
      const svc = r.consumed_service || '(vazio)';
      const cat = r.meter_category   || '(vazio)';
      const chave = svc + '\n' + cat;
      if (!grupos.has(chave)) grupos.set(chave, { svc, cat, recursos: [] });
      grupos.get(chave).recursos.push(r.nome_recurso || r.resource_id || '?');
    });

    // Ordena pelo maior grupo
    const linhas = [...grupos.values()].sort((a, b) => b.recursos.length - a.recursos.length);

    let id = 'diag-outros-modal';
    let m = document.getElementById(id);
    if (!m) {
      m = document.createElement('div');
      m.id = id;
      m.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);';
      m.onclick = e => { if (e.target === m) m.remove(); };
      document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:rgba(18,2,32,.96);border:1px solid var(--border-light);border-radius:14px;padding:20px;max-width:680px;width:94%;max-height:80vh;display:flex;flex-direction:column;gap:12px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<span style="font-size:13px;font-weight:700;color:var(--orange,#ff8c42);">🔍 Diagnóstico — Outros (' + outros.length + ' recursos)</span>'
      + '<button onclick="document.getElementById(\'diag-outros-modal\').remove()" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;">✕</button>'
      + '</div>'
      + '<div style="font-size:10px;color:var(--text-muted);">Grupos únicos de consumed_service + meter_category não mapeados:</div>'
      + '<div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px;">'
      + linhas.map(g => '<div style="border-radius:8px;background:rgba(255,255,255,.04);border:1px solid var(--border);padding:8px 10px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;">'
        + '<div style="display:flex;flex-direction:column;gap:2px;">'
        + '<span style="font-size:10px;color:var(--text-muted);">consumed_service</span>'
        + '<span style="font-size:11px;font-weight:600;color:var(--orange,#ff8c42);">' + _esc(g.svc) + '</span>'
        + '<span style="font-size:10px;color:var(--text-muted);margin-top:2px;">meter_category</span>'
        + '<span style="font-size:11px;color:var(--text-dim);">' + _esc(g.cat) + '</span>'
        + '</div>'
        + '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">' + g.recursos.length + ' recurso' + (g.recursos.length !== 1 ? 's' : '') + '</span>'
        + '</div>'
        + '<div style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _esc(g.recursos.join(', ')) + '">'
        + _esc(g.recursos.slice(0,4).join(', ') + (g.recursos.length > 4 ? ' …+' + (g.recursos.length-4) : ''))
        + '</div>'
        + '</div>').join('')
      + '</div>'
      + '</div>';
    m.style.display = 'flex';
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

      _ultimaUrlRecursos = url;
      _picoCarregado = false;

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
      // Portal público sem permissão de seleção: seleciona todos automaticamente
      if (_modoPublico && !_defaultConfig?.permitir_selecao_recursos) {
        _selecionados = {};
        const _h = parseInt(document.getElementById('chglobal')?.value) || 720;
        _recursos.forEach(r => { _selecionados[r._key || r.resource_id] = _h; });
      } else {
        _selecionados = {};
      }
      _filtroTipos.clear();
      // Pré-computa total de billing por RG (usado no cabeçalho dos cards de estimativa)
      _rgTotalMap.clear();
      _recursos.forEach(r => {
        const rg  = (r.resource_group_name || '').toUpperCase();
        const isBRL = (r.moeda || 'BRL') === 'BRL';
        const tcDB  = parseFloat(r.taxa_cambio || 0);
        const val   = parseFloat(r.total_billing || 0) * (isBRL ? 1 : (tcDB > 1 ? tcDB : _taxaBrl));
        _rgTotalMap.set(rg, (_rgTotalMap.get(rg) || 0) + val);
      });
      _dbComputeTaxas(); // RN-DB-001: computa taxas proporcionais por workspace Databricks
      _renderTiposBar();
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

  // ── RN-DB-001: Databricks cluster rate estimation ────────────────────────────
  // H_driver = soma_h_driver (SUM de MAX diário — abordagem diária, vem do SQL)
  //            fallback: MAX(horas_reais) global se soma_h_driver não disponível
  // taxa_cluster = C_total_rg / H_driver
  // estimado_recurso = (billing_recurso / H_driver) × horas_slider
  // Threshold: H_driver ≥ 24h AND ≥ 2 distinct resource_ids
  function _dbComputeTaxas() {
    const raw = new Map(); // rg_lower → { totalBrl, totalHoras, maxHoras, somaHDriver, ids: Set }
    _recursos.forEach(r => {
      const rg = (r.resource_group_name || '').toLowerCase();
      if (!rg.startsWith('databricks-rg-')) return;
      if (r.tipo_custo !== 'hora') return;
      const horasReais = parseFloat(r.horas_reais || 0);
      if (horasReais <= 0) return;
      const isBRL = (r.moeda || 'BRL') === 'BRL';
      const tcDB  = parseFloat(r.taxa_cambio || 0);
      const convR = !isBRL ? (tcDB > 1 ? tcDB : _taxaBrl) : 1;
      const billing = parseFloat(r.total_billing || 0) * convR;
      if (!raw.has(rg)) raw.set(rg, { totalBrl: 0, totalHoras: 0, maxHoras: 0, somaHDriver: 0, ids: new Set() });
      const e = raw.get(rg);
      e.totalBrl   += billing;
      e.totalHoras += horasReais;
      e.maxHoras    = Math.max(e.maxHoras, horasReais);
      // soma_h_driver: mesmo valor para todos os recursos do RG — guarda o maior (evita 0 de recurso sem campo)
      const shd = parseFloat(r.soma_h_driver || 0);
      if (shd > e.somaHDriver) e.somaHDriver = shd;
      e.ids.add(r.resource_id || r._key || rg + '_' + e.ids.size);
    });
    _dbTaxaMap = new Map();
    raw.forEach((v, rg) => {
      // Prefere abordagem diária (soma_h_driver); fallback para maxHoras global
      const hDriver = v.somaHDriver > 0 ? v.somaHDriver : v.maxHoras;
      const metodo  = v.somaHDriver > 0 ? 'diário' : 'global';
      const valida  = hDriver >= 24 && v.ids.size >= 2;
      const taxa    = valida ? v.totalBrl / hDriver : 0;
      _dbTaxaMap.set(rg, { taxa, valida, totalBrl: v.totalBrl, hDriver: Math.round(hDriver), totalHoras: Math.round(v.totalHoras), recursos: v.ids.size });
      if (valida) console.log(`[Databricks] ⚡ ${rg} → taxa_cluster R$ ${taxa.toFixed(4)}/h · C_total R$ ${v.totalBrl.toFixed(2)} ÷ H_driver ${Math.round(hDriver)}h (${metodo}) · ${v.ids.size} VMs`);
      else        console.warn(`[Databricks] ⚠ ${rg} → amostra insuficiente (H_driver ${Math.round(hDriver)}h · ${v.ids.size} VMs)`);
    });
    if (raw.size === 0) console.log('[Databricks] Nenhum workspace databricks-rg-* encontrado.');
  }

  function _dbInfoParaRecurso(r) {
    const rg = (r.resource_group_name || '').toLowerCase();
    if (!rg.startsWith('databricks-rg-')) return null;
    return _dbTaxaMap.get(rg) || null;
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

  function _atualizarBotaoBuscar() {
    const btn = document.getElementById('cbuscar-btn');
    if (!btn) return;
    const habilitado = _rgsSel.length > 0;
    btn.disabled = !habilitado;
    btn.style.opacity  = habilitado ? '1'            : '.4';
    btn.style.cursor   = habilitado ? 'pointer'      : 'not-allowed';
    btn.title          = habilitado ? ''             : 'Selecione pelo menos um Resource Group para buscar';
  }

  function _setBuscarLoading(loading) {
    const btn = document.getElementById('cbuscar-btn');
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.style.opacity = '1';
      btn.style.cursor  = 'default';
      btn.innerHTML = '<span class="cspinner" style="width:13px;height:13px;border-width:2px;flex-shrink:0;"></span> Buscando...';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Buscar';
      _atualizarBotaoBuscar(); // restaura estado correto conforme RGs selecionados
    }
  }

  function _renderLoading() {
    const t = document.getElementById('ctbody'); if (!t) return;
    const ini = _dataInicio || '?'; const fim = _dataFim || '?';
    const nSubs = _subsSel.length; const nRGs = _rgsSel.length;
    const desc = `${nSubs} assinatura${nSubs !== 1 ? 's' : ''}${nRGs ? ` · ${nRGs} RG${nRGs !== 1 ? 's' : ''}` : ''} · ${ini} → ${fim}`;
    const _sk = w => `<td style="padding:10px;"><span class="cskel" style="width:${w};"></span></td>`;
    t.innerHTML = `<tr><td colspan="12" style="padding:16px 14px 10px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="cspinner"></span>
        <span style="font-size:12px;color:var(--text-muted);">Buscando recursos — <span style="color:var(--text-dim);">${_esc(desc)}</span></span>
      </div>
    </td></tr>`
    + Array(6).fill('').map(() => `<tr>
      <td style="padding:10px 8px;"><span class="cskel" style="width:15px;height:15px;border-radius:3px;"></span></td>
      <td style="padding:10px;"><span class="cskel" style="width:75%;margin-bottom:5px;"></span><span class="cskel" style="width:50%;height:10px;"></span></td>
      ${_sk('80px')}${_sk('110px')}${_sk('70px')}${_sk('80px')}${_sk('80px')}${_sk('70px')}${_sk('70px')}${_sk('70px')}
      <td style="padding:10px;"><span class="cskel" style="width:50px;margin-left:auto;"></span></td>
    </tr>`).join('');
    const c = document.getElementById('ccnt'); if (c) c.textContent = 'Carregando…';
  }

  // Mapa de grupos expandidos (true = expandido; undefined/false = colapsado por padrão)
  const _expandidos = {};
  let _gBases = []; // índice numérico → baseId, reconstruído a cada _renderRecursos()

  // HTML de uma linha-filha — compartilhado por _renderRecursos e _toggleGrupo (lazy)
  function _htmlFilhaRow(r, gIdx, temMultiplos, rg, nome, isBRL) {
    const rid     = r._key || r.resource_id || '';
    const sel     = !!_selecionados[rid];
    const totBrl  = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0)*_taxaBrl;
    const ctColor = r.charge_type==='Usage'
      ? 'rgba(147,51,234,.1);color:var(--accent)'
      : 'rgba(77,166,255,.1);color:var(--blue,#4da6ff)';
    const pad     = temMultiplos ? 'padding-left:28px;' : '';
    const isMkt   = (r.publisher_type||'').toLowerCase() === 'marketplace';
    const mktBadge = isMkt ? `<span style="display:inline-block;margin-left:5px;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;background:rgba(255,140,66,.18);color:#ff8c42;vertical-align:middle;white-space:nowrap;">MKT</span>` : '';
    return `<tr data-gchild="${gIdx}" style="${sel?'background:rgba(147,51,234,.04);':''}${isMkt?'border-left:2px solid rgba(255,140,66,.4);':''}">
          <td style="text-align:center;padding:8px 4px;">
            <input type="checkbox" class="cck" data-rid="${_esc(rid)}" ${sel?'checked':''}
              ${(_modoPublico && !_defaultConfig?.permitir_selecao_recursos) ? 'disabled style="opacity:.4;cursor:not-allowed;"' : `onchange="Calculadora._check('${_esc(rid)}',this.checked)"`}>
          </td>
          <td style="max-width:200px;padding:8px 10px;${pad}">
            <div style="font-size:${temMultiplos?'11':'12'}px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${temMultiplos?'var(--text-dim)':'var(--text)'};"
              title="${_esc(r.resource_id||'')}${r.consumed_service?' · '+_esc(r.consumed_service):''}${r.pricing_model?' · '+_esc(r.pricing_model):''}"
            >${_esc(temMultiplos?(r.meter_categories||r.categoria||nome):nome)}${mktBadge}</div>
            <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(r.publisher_name && isMkt ? r.publisher_name : (r.consumed_service||r.produto||r.subcategoria||''))}</div>
          </td>
          <td style="max-width:140px;padding:8px 10px;">
            <div style="font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(temMultiplos?'':rg)}</div>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <span class="cbadge">${_esc(r.categoria||'—')}</span>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;" title="${_esc(r.pricing_model||'')}">
            <span style="padding:2px 7px;border-radius:8px;font-size:10px;font-weight:600;background:${ctColor};">${_esc(r.charge_type||'—')}</span>
          </td>
          <td style="padding:8px 10px;white-space:nowrap;">
            <div style="font-size:11px;color:var(--text-dim);">${_esc(r.unidade||'—')}</div>
          </td>
          <td style="text-align:right;padding:8px 10px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim);white-space:nowrap;">${parseFloat(r.total_qty||0).toLocaleString('pt-BR',{maximumFractionDigits:4})}</div>
          </td>
          <td style="text-align:right;padding:8px 10px;">${_custoHora(r,isBRL,_taxaBrl)}</td>
          <td style="text-align:right;padding:8px 14px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--accent);white-space:nowrap;">${_brl(totBrl)}</div>
          </td>
        </tr>`;
  }

  async function _carregarPico() {
    if (!_ultimaUrlRecursos || !_recursos.length) { _picoCarregado = true; return; }
    try {
      const data = await _api('GET', _ultimaUrlRecursos + '&pico=1');
      if (Array.isArray(data)) {
        const picoMap = new Map(data.map(r => [r.resource_id + '|' + (r.unidade||''), r]));
        _recursos = _recursos.map(r => {
          const p = picoMap.get(r.resource_id + '|' + (r.unidade||''));
          if (!p) return r;
          return { ...r, custo_hora_pico: p.custo_hora_pico, pico_data: p.pico_data,
            pico_custo_dia: p.pico_custo_dia, pico_horas_dia: p.pico_horas_dia,
            custo_hora_pico_cluster: p.custo_hora_pico_cluster };
        });
      }
    } catch(e) { console.warn('[Calculadora] Erro ao carregar pico:', e); }
    _picoCarregado = true;
  }

  function _renderRecursos() {
    const tbody = document.getElementById('ctbody'); if (!tbody) return;
    const _textoOk = r =>
      (r.nome_recurso||'').toLowerCase().includes(_filtroTexto) ||
      (r.categoria||'').toLowerCase().includes(_filtroTexto)    ||
      (r.produto||'').toLowerCase().includes(_filtroTexto)      ||
      (r.consumed_service||'').toLowerCase().includes(_filtroTexto) ||
      (r.charge_type||'').toLowerCase().includes(_filtroTexto)  ||
      (r.unidade||'').toLowerCase().includes(_filtroTexto)      ||
      (r.pricing_model||'').toLowerCase().includes(_filtroTexto)||
      (r.resource_group_name||'').toLowerCase().includes(_filtroTexto) ||
      (r.publisher_type||'').toLowerCase().includes(_filtroTexto) ||
      (r.publisher_name||'').toLowerCase().includes(_filtroTexto);
    const lista = _recursos.filter(r =>
      (!_filtroTexto || _textoOk(r)) &&
      (!_filtroTipos.size || _filtroTipos.has(_tipoRecurso(r)))
    );

    const c = document.getElementById('ccnt');

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">
        ${_recursos.length ? 'Nenhum recurso corresponde ao filtro.'
          : 'Nenhum recurso encontrado para os filtros selecionados.'}
      </td></tr>`;
      if (c) c.textContent = '0 recursos';
      _atualizarEstimativa();
      _atualizarCnt();
      return;
    }

    const isBRL = (lista[0]?.moeda || 'BRL') === 'BRL';

    const grupos = {};
    const ordemGrupos = [];
    lista.forEach(r => {
      const bid = r.resource_id || '';
      if (!grupos[bid]) { grupos[bid] = []; ordemGrupos.push(bid); }
      grupos[bid].push(r);
    });

    const total_recursos = ordemGrupos.length;
    if (c) c.textContent = `${total_recursos} recurso${total_recursos!==1?'s':''}${lista.length > total_recursos ? ' · '+lista.length+' linhas' : ''}`;

    _gBases = [];
    tbody.innerHTML = ''; // limpa imediatamente — feedback visual antes de construir rows
    _atualizarEstimativa();
    _atualizarCnt();

    // Constrói + insere em lotes de 200 grupos por frame — sem bloquear o browser
    let gi = 0;
    function nextChunk() {
      const rows = [];
      const end = Math.min(gi + 200, ordemGrupos.length);
      for (; gi < end; gi++) {
        const baseId = ordemGrupos[gi];
        const gIdx   = _gBases.length;
        _gBases.push(baseId);
        const filhas = grupos[baseId];
        const temMultiplos = filhas.length > 1;
        const exp    = _expandidos[baseId] === true;
        const nome   = filhas[0].nome_recurso || baseId.split('/').filter(Boolean).pop() || baseId.slice(0,60);
        const rg     = filhas[0].resource_group_name || '—';
        const totalGrupo = filhas.reduce((s,r) => s + (isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0)*_taxaBrl), 0);
        const algumSel = filhas.some(r => !!_selecionados[r._key||r.resource_id]);
        const todosSel = filhas.every(r => !!_selecionados[r._key||r.resource_id]);

        if (temMultiplos) {
          rows.push(`<tr data-ghdr="${gIdx}" style="background:var(--bg-hover);cursor:pointer;" onclick="Calculadora._toggleGrupo(${gIdx})">
          <td style="text-align:center;padding:8px 4px;" onclick="event.stopPropagation()">
            <input type="checkbox" class="cck-grupo" data-baseid="${_esc(baseId)}"
              ${todosSel?'checked':''} ${algumSel&&!todosSel?'data-indet="1"':''}
              ${(_modoPublico && !_defaultConfig?.permitir_selecao_recursos) ? 'disabled style="opacity:.4;cursor:not-allowed;"' : `onchange="Calculadora._checkGrupo('${_esc(baseId)}',this.checked);event.stopPropagation()"`}>
          </td>
          <td colspan="5" style="padding:8px 10px;">
            <div style="display:flex;align-items:center;gap:7px;">
              <span class="cgrupo-arrow" style="font-size:10px;color:var(--text-muted);display:inline-block;transform:rotate(${exp?90:0}deg);transition:transform .15s;">&#9654;</span>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--text);" title="${_esc(baseId)}">${_esc(nome)}</div>
                <div style="font-size:10px;color:var(--text-muted);">${_esc(rg)} &nbsp;·&nbsp; <span style="color:var(--accent);">${filhas.length} meters</span></div>
              </div>
            </div>
          </td>
          <td style="padding:8px 10px;"></td>
          <td style="text-align:right;padding:8px 14px;">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:var(--accent);">${_brl(totalGrupo)}</div>
            <div style="font-size:9px;color:var(--text-muted);">total grupo</div>
          </td>
        </tr>`);
          if (!exp) continue; // filhas não renderizadas — lazy via _toggleGrupo
        }

        filhas.forEach(r => { rows.push(_htmlFilhaRow(r, gIdx, temMultiplos, rg, nome, isBRL)); });
      }
      if (rows.length) tbody.insertAdjacentHTML('beforeend', rows.join(''));
      if (gi < ordemGrupos.length) {
        requestAnimationFrame(nextChunk);
      } else {
        document.querySelectorAll('.cck-grupo[data-indet="1"]').forEach(ck => { ck.indeterminate = true; });
      }
    }
    requestAnimationFrame(nextChunk);
  }

  function _toggleGrupo(gIdx) {
    const baseId = _gBases[gIdx];
    if (baseId === undefined) return;

    const nowExpanded = !(_expandidos[baseId] === true);
    _expandidos[baseId] = nowExpanded;

    const hdr = document.querySelector(`[data-ghdr="${gIdx}"]`);
    if (!hdr) return;
    const arrow = hdr.querySelector('.cgrupo-arrow');
    if (arrow) arrow.style.transform = `rotate(${nowExpanded ? 90 : 0}deg)`;

    if (nowExpanded) {
      // Lazy: insere só as filhas deste grupo sem reconstruir a tabela inteira
      const filhas = _recursos.filter(r => r.resource_id === baseId);
      const isBRL  = (filhas[0]?.moeda || 'BRL') === 'BRL';
      const rg     = filhas[0]?.resource_group_name || '—';
      const nome   = filhas[0]?.nome_recurso || baseId.split('/').filter(Boolean).pop() || baseId.slice(0,60);
      hdr.insertAdjacentHTML('afterend', filhas.map(r => _htmlFilhaRow(r, gIdx, true, rg, nome, isBRL)).join(''));
    } else {
      // Remove só as filhas deste grupo
      document.querySelectorAll(`[data-gchild="${gIdx}"]`).forEach(row => row.remove());
    }
  }

  function _checkGrupo(baseId, checked) {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    const filhasGrupo = _recursos.filter(r => r.resource_id === baseId);
    filhasGrupo.forEach(r => {
      const key = r._key || r.resource_id;
      if (checked) _selecionados[key] = h;
      else delete _selecionados[key];
    });
    // Atualiza checkboxes das filhas SE estiverem visíveis no DOM
    if (_expandidos[baseId] === true) {
      filhasGrupo.forEach(r => {
        const key = r._key || r.resource_id;
        document.querySelectorAll('input.cck').forEach(ck => {
          if (ck.dataset.rid === key) {
            ck.checked = checked;
            const row = ck.closest('tr'); if (row) row.style.background = checked ? 'rgba(147,51,234,.04)' : '';
          }
        });
      });
    }
    // Atualiza o checkbox do header do grupo
    document.querySelectorAll('input.cck-grupo').forEach(ck => {
      if (ck.dataset.baseid === baseId) { ck.checked = checked; ck.indeterminate = false; }
    });
    _atualizarCnt();
    _atualizarEstimativa();
  }


  function _check(rid, checked) {
    const h = parseInt(document.getElementById('chglobal')?.value) || 720;
    if (checked) _selecionados[rid] = h;
    else delete _selecionados[rid];
    // Atualizar apenas a linha afetada sem reconstruir o tbody inteiro
    const row = document.querySelector(`input.cck[data-rid="${rid}"]`)?.closest('tr');
    if (row) row.style.background = checked ? 'rgba(147,51,234,.04)' : '';
    _atualizarCnt();
    _atualizarEstimativa();
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
      const _rMapRod = new Map(_recursos.map(r => [r._key || r.resource_id, r]));
      let total = 0;
      for (const rid of sel) {
        const r = _rMapRod.get(rid);
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
    _atualizarCnt();
    setTimeout(() => {
      // .cck-grupo = headers de grupos multi-meter; .cck = recursos single-meter e filhos expandidos
      // filhos de grupos colapsados não estão no DOM — renderizados com estado correto ao expandir
      document.querySelectorAll('input.cck-grupo').forEach(ck => { ck.checked = true; ck.indeterminate = false; });
      document.querySelectorAll('input.cck').forEach(ck => { ck.checked = true; });
      _atualizarEstimativa();
    }, 0);
  }

  function deselecionarTodos() {
    _selecionados = {};
    _atualizarCnt();
    setTimeout(() => {
      document.querySelectorAll('input.cck-grupo').forEach(ck => { ck.checked = false; ck.indeterminate = false; });
      document.querySelectorAll('input.cck').forEach(ck => { ck.checked = false; });
      _atualizarEstimativa();
    }, 0);
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
    // Card Horário Livre só aparece no modo Período
    const cardHL  = document.getElementById('chl-card');
    if (cardHL)  cardHL.style.display  = isManual ? 'none' : '';

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

    // Horário Livre: mostra horas cobradas se ativo
    const horasLivres = _calcHorasLivres(vIni, vFim);
    const horasCob    = Math.max(1, horas - horasLivres);
    if (res) {
      res.style.color = 'var(--accent)';
      if (_horarioLivre.ativo && horasLivres > 0) {
        res.innerHTML = `${horas}h (${durLabel}) · ${fmtDt(vIni)} → ${fmtDt(vFim)}`
          + `<br><span style="color:var(--orange);font-size:10px;">−${horasLivres}h livres → </span>`
          + `<strong style="color:var(--green);font-size:10px;">${horasCob}h cobradas</strong>`;
      } else {
        res.textContent = `${horas}h (${durLabel}) · ${fmtDt(vIni)} → ${fmtDt(vFim)}`;
      }
    }
    _horasPeriodoValidas = true;
    _atualizarBtnIncluir();
    _hlAtualizarRes();
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
    const horasTotal = _calcHorasPeriodo();
    if (!horasTotal) return;
    const vIni = _getIniISO();
    const vFim = _getFimISO();
    const horasLivres   = _calcHorasLivres(vIni, vFim);
    const horasCobradas = Math.max(1, horasTotal - horasLivres);
    _periodos.push({ inicio: vIni, fim: vFim, horas: horasCobradas, horasTotal, horasLivres });
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

  // ── Horário Livre — funções de controle ──────────────────────────────────────

  // Calcula quantas horas do intervalo [vIni, vFim] caem na janela livre
  function _calcHorasLivres(vIni, vFim) {
    if (!_horarioLivre.ativo || !vIni || !vFim) return 0;
    if (!_horarioLivre.dias.length) return 0;
    const _j = (ini, f) => Math.max(0, parseInt((f||'18:00').split(':')[0]) - parseInt((ini||'09:00').split(':')[0]));
    const jUtil = _j(_horarioLivre.inicio, _horarioLivre.fim);
    const jSab  = _j(_horarioLivre.inicio_sab, _horarioLivre.fim_sab);
    const jDom  = _j(_horarioLivre.inicio_dom, _horarioLivre.fim_dom);

    let livres = 0;
    const inicio = new Date(vIni);
    const fim    = new Date(vFim);
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
    const fimD = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
    while (d <= fimD) {
      const dow = d.getDay();
      if (_horarioLivre.dias.includes(dow))
        livres += dow === 6 ? jSab : dow === 0 ? jDom : jUtil;
      d.setDate(d.getDate() + 1);
    }
    return livres;
  }

  // Atualiza _horarioLivre com os valores dos inputs
  function _hlLerConfig() {
    _horarioLivre.inicio     = document.getElementById('chl-ini')?.value     || '09:00';
    _horarioLivre.fim        = document.getElementById('chl-fim')?.value     || '18:00';
    _horarioLivre.inicio_sab = document.getElementById('chl-ini-sab')?.value || '09:00';
    _horarioLivre.fim_sab    = document.getElementById('chl-fim-sab')?.value || '18:00';
    _horarioLivre.inicio_dom = document.getElementById('chl-ini-dom')?.value || '09:00';
    _horarioLivre.fim_dom    = document.getElementById('chl-fim-dom')?.value || '18:00';
    _horarioLivre.dias       = Array.from(document.querySelectorAll('.chl-dia:checked'))
                                    .map(cb => parseInt(cb.dataset.dia));
  }

  // Mostra/esconde linhas de horário específico de Sab/Dom conforme checkboxes
  function _hlAtualizarWeekend() {
    const sabChecked = !!document.querySelector('.chl-dia[data-dia="6"]:checked');
    const domChecked = !!document.querySelector('.chl-dia[data-dia="0"]:checked');
    const rowSab = document.getElementById('chl-sab-row');
    const rowDom = document.getElementById('chl-dom-row');
    if (rowSab) rowSab.style.display = sabChecked ? '' : 'none';
    if (rowDom) rowDom.style.display = domChecked ? '' : 'none';
  }

  // Calcula e exibe o resumo (horas totais / livres / cobradas) no card
  function _hlAtualizarRes() {
    const res = document.getElementById('chl-res');
    if (!res) return;
    const vIni = _getIniISO();
    const vFim = _getFimISO();
    if (!vIni || !vFim) {
      res.textContent = 'Selecione um período para ver o resumo.';
      return;
    }
    const diff = new Date(vFim) - new Date(vIni);
    if (diff <= 0) { res.textContent = ''; return; }
    const horasTotal  = Math.round(diff / 3600000);
    const horasLivres = _calcHorasLivres(vIni, vFim);
    const horasCob    = Math.max(0, horasTotal - horasLivres);
    const pct         = horasTotal > 0 ? Math.round(horasLivres / horasTotal * 100) : 0;
    res.innerHTML = `<span style="color:var(--text-dim)">${horasTotal}h totais</span>`
      + ` → <span style="color:var(--orange)">−${horasLivres}h livres (${pct}%)</span>`
      + ` → <strong style="color:var(--green)">${horasCob}h cobradas</strong>`;
  }

  // Toggle ativar/desativar janela
  function _hlToggle(ativo) {
    _horarioLivre.ativo = ativo;
    const corpo = document.getElementById('chl-corpo');
    const hint  = document.getElementById('chl-hint');
    if (corpo) corpo.style.display = ativo ? 'block' : 'none';
    if (hint)  hint.style.display  = ativo ? 'none'  : 'block';
    _hlLerConfig();
    _hlAtualizarRes();
  }

  // Chamado quando mudam inputs de hora ou dias
  function _hlChange() {
    _hlAtualizarWeekend();
    _hlLerConfig();
    _hlAtualizarRes();
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
      const horasCob = p.horas;
      const diasCob  = Math.floor(horasCob/24), hRestCob = horasCob%24;
      const dur  = diasCob > 0 ? `${diasCob}d${hRestCob>0?' '+hRestCob+'h':''}` : `${horasCob}h`;
      const livresInfo = p.horasLivres > 0
        ? `<span style="color:var(--orange);font-size:9px;"> (−${p.horasLivres}h livres de ${p.horasTotal}h)</span>`
        : '';
      div.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fmt(p.inicio)} → ${fmt(p.fim)}</div>
          <div style="font-size:11px;font-weight:700;color:var(--accent);font-family:IBM Plex Mono,monospace;">${horasCob}h <span style="font-weight:400;color:var(--text-muted);">(${dur})</span>${livresInfo}</div>
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

    // Pré-preencher responsável e e-mail com dados da identificação do portal
    if (_modoPublico) {
      try {
        const ident = JSON.parse(sessionStorage.getItem('portal_ident') || 'null');
        const respEl  = document.getElementById('cinv-resp');
        const emailEl = document.getElementById('cinv-email');
        if (respEl  && ident?.nome  && !respEl.value)  respEl.value  = ident.nome;
        if (emailEl && ident?.email && !emailEl.value) emailEl.value = ident.email;
      } catch {}
    }

    // Carregar projetos da API
    // Modo público → /projetos relativo ao _apiBase = /api/public/calculadora/projetos
    // Modo autenticado → /api/projetos (path absoluto)
    const sel = document.getElementById('cinv-projeto');
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
      const projetosUrl = _modoPublico ? '/projetos' : '/api/projetos';
      const data = await _api('GET', projetosUrl);
      if (data && data.error) {
        console.error('[Invoice] Projetos API erro:', data.error);
        sel.innerHTML = `<option value="">Erro ao carregar projetos: ${_esc(data.error)}</option>`;
      } else if (!Array.isArray(data) || !data.length) {
        sel.innerHTML = '<option value="">Nenhum projeto ativo cadastrado</option>';
      } else {
        sel.innerHTML = '<option value="">— selecione o projeto —</option>' +
          data.map(p => `<option value="${p.id}" data-dir="${_esc(p.diretoria||'')}" data-desc="${_esc(p.descricao||'')}">${_esc(p.nome)}${p.diretoria ? ' · ' + p.diretoria : ''}</option>`).join('');
        sel.onchange = () => _atualizarInfoProjeto(data);
      }
    } catch (e) {
      console.error('[Invoice] Projetos fetch erro:', e);
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

    // ── Tabela agrupada por categoria ──
    const _catPrev = new Map();
    for (const r of itens) {
      const cat = r.categoria || 'Outros';
      if (!_catPrev.has(cat)) _catPrev.set(cat, { count: 0, horas: 0, total: 0, allPeriodo: true });
      const c = _catPrev.get(cat);
      c.count++;
      c.total += parseFloat(r.estimado_brl || 0);
      const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo');
      if (tc !== 'periodo' && tc !== 'mes') { c.allPeriodo = false; c.horas += parseFloat(r.horas || 0); }
    }
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">'
      + '<thead><tr style="border-bottom:1px solid rgba(147,51,234,.25);">'
      + '<th style="text-align:left;padding:3px 0;color:var(--text-muted);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">Tipo</th>'
      + '<th style="text-align:right;padding:3px 6px;color:var(--text-muted);font-size:10px;font-weight:600;">Qtd</th>'
      + '<th style="text-align:right;padding:3px 6px;color:var(--text-muted);font-size:10px;font-weight:600;">Horas</th>'
      + '<th style="text-align:right;padding:3px 0;color:var(--text-muted);font-size:10px;font-weight:600;">Valor</th>'
      + '</tr></thead><tbody>';
    for (const [cat, info] of _catPrev.entries()) {
      // info.horas é a soma — divide por count para mostrar horas por recurso (slider global)
      const horasCell = info.allPeriodo ? '/mês' : Math.round(info.horas / Math.max(info.count, 1)).toLocaleString('pt-BR') + ' h';
      html += '<tr style="border-bottom:1px solid rgba(147,51,234,.07);">'
        + '<td style="padding:5px 0;color:var(--text);font-weight:500;">' + _esc(cat) + '</td>'
        + '<td style="text-align:right;padding:5px 6px;color:var(--text-muted);">' + info.count + '</td>'
        + '<td style="text-align:right;padding:5px 6px;color:var(--text-dim);font-family:IBM Plex Mono,monospace;font-size:10px;">' + horasCell + '</td>'
        + '<td style="text-align:right;padding:5px 0;color:var(--accent);font-family:IBM Plex Mono,monospace;font-weight:600;">' + _brl(info.total) + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';

    // ── Horas estimadas + taxa média ──
    const _hPrev   = parseFloat(_estimativa.horas || 0);
    const _totPrev = parseFloat(_estimativa.total_brl || 0);
    const _taxPrev = _hPrev > 0 ? _totPrev / _hPrev : 0;
    html += '<div style="display:flex;justify-content:space-between;align-items:center;'
      + 'margin:6px 0 4px;padding:5px 8px;border-radius:5px;'
      + 'background:rgba(147,51,234,.07);border:1px solid rgba(147,51,234,.15);">'
      + '<span style="font-size:11px;color:var(--accent);font-weight:600;">⏱ Horas estimadas</span>'
      + '<span style="font-family:IBM Plex Mono,monospace;font-size:12px;font-weight:700;color:var(--accent);">'
      + _hPrev.toLocaleString('pt-BR') + ' h'
      + (_taxPrev > 0 ? '<span style="font-size:9px;color:var(--text-muted);margin-left:6px;">≈ ' + _brl(_taxPrev) + '/h</span>' : '')
      + '</span></div>';

    // ── Totais ──
    html += (_estimativa.pct_imposto > 0
      ? '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;">'
        + '<span style="color:var(--text-muted);">+ Imposto (' + _estimativa.pct_imposto + '%)</span>'
        + '<span style="font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.vl_imposto) + '</span></div>' : '')
      + (_estimativa.pct_cond > 0
        ? '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;">'
          + '<span style="color:var(--text-muted);">+ Condomínio (' + _estimativa.pct_cond + '%)</span>'
          + '<span style="font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.vl_cond) + '</span></div>' : '')
      + '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:8px;display:flex;justify-content:space-between;align-items:center;">'
      + '<span style="font-weight:600;color:var(--text);">Total Final (BRL)</span>'
      + '<span style="font-size:1.1rem;font-weight:700;color:var(--accent);font-family:IBM Plex Mono,monospace;">' + _brl(_estimativa.total_final || _estimativa.total_brl) + '</span>'
      + '</div>';

    body.innerHTML = html;
  }

  function fecharInvoice() {
    const m = document.getElementById('cinv-modal');
    if (m) m.style.display = 'none';
  }

  function _buildPDFHtml(p) {
    const _todosItens    = p.itens || [];
    const itensDinamicos = _todosItens.filter(r => r.tipo_custo !== 'mes');
    const itensFixos     = _todosItens.filter(r => r.tipo_custo === 'mes');
    const totalFixoMes   = p.total_fixo_mes != null
      ? parseFloat(p.total_fixo_mes)
      : itensFixos.reduce((s, r) => s + parseFloat(r.estimado_brl || r.custo_mes || 0), 0);

    // Resumo por categoria — agrupa horas e total por tipo
    const catMap = new Map();
    for (const r of itensDinamicos) {
      const cat = r.categoria || 'Outros';
      if (!catMap.has(cat)) catMap.set(cat, { count: 0, horas: 0, total: 0, allPeriodo: true });
      const c = catMap.get(cat);
      c.count++;
      c.total += parseFloat(r.estimado_brl || 0);
      const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo');
      if (tc !== 'periodo' && tc !== 'mes') { c.allPeriodo = false; c.horas += parseFloat(r.horas || 0); }
    }
    const catRows = Array.from(catMap.entries()).map(([cat, info]) => {
      const horasCell = info.allPeriodo ? '/m\xEAs' : info.horas.toLocaleString('pt-BR') + '\xA0h';
      return '<tr><td class="td-nm">' + _esc(cat) + '</td>'
        + '<td class="td-qty" style="text-align:center;">' + info.count + '</td>'
        + '<td class="td-qty">' + horasCell + '</td>'
        + '<td class="td-brl">' + _brl(info.total) + '</td>'
        + '</tr>';
    }).join('');
    const fixoRow = itensFixos.length > 0
      ? '<tr class="tr-sep-fix"><td colspan="4">🔒 Custos Fixos Mensais — cobrado independente das horas</td></tr>'
        + '<tr><td class="td-nm" style="color:#c05621;">Infra Fixa</td>'
        + '<td class="td-qty" style="text-align:center;color:#c05621;">' + itensFixos.length + '</td>'
        + '<td class="td-qty" style="color:#c05621;">Fixo/m\xEAs</td>'
        + '<td class="td-brl" style="color:#c05621;">' + _brl(totalFixoMes) + '</td>'
        + '</tr>'
      : '';

    // Linhas compactas — 3 colunas: Recurso | Horas/Tipo | Estimativa BRL
    const linhas = itensDinamicos.map(r => {
      const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo');
      let quantCell;
      if (r.databricks_valida && tc === 'hora') {
        quantCell = '⚡\xA0' + (r.horas || 0).toLocaleString('pt-BR') + ' h';
      } else if (tc === 'reserva') {
        quantCell = (r.horas || 0).toLocaleString('pt-BR') + ' h\xA0🔒';
      } else if (tc === 'periodo') {
        quantCell = '/m\xEAs';
      } else {
        quantCell = (r.horas || 0).toLocaleString('pt-BR') + ' h';
      }
      const _corEst = r.databricks_valida ? 'td-blue' : '';
      const skuTag = r.sku ? '<div style="font-size:6.5pt;color:#888;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(r.sku) + '</div>' : '';
      const uomTag = r.uom ? '<div style="font-size:6pt;color:#aaa;margin-top:1px;font-family:monospace;white-space:nowrap;">' + _esc(r.uom) + '</div>' : '';
      return '<tr>'
        + '<td class="td-nm">' + _esc(r.nome) + skuTag + uomTag + '</td>'
        + '<td class="td-qty">' + quantCell + '</td>'
        + '<td class="td-brl ' + _corEst + '">' + _brl(r.estimado_brl) + '</td>'
        + '</tr>';
    }).join('');

    // Custos fixos mensais — linha separadora dentro da mesma tabela
    const linhasFixo = itensFixos.length > 0
      ? '<tr class="tr-sep-fix"><td colspan="3">🔒 Custos Fixos Mensais — cobrado independente das horas do projeto</td></tr>'
        + itensFixos.map(r => {
          const skuF = r.sku ? '<div style="font-size:6.5pt;color:#c05621;opacity:.7;margin-top:1px;">' + _esc(r.sku) + '</div>' : '';
          const uomF = r.uom ? '<div style="font-size:6pt;color:#c05621;opacity:.5;margin-top:1px;font-family:monospace;white-space:nowrap;">' + _esc(r.uom) + '</div>' : '';
          return '<tr>'
            + '<td class="td-nm" style="color:#c05621;">' + _esc(r.nome) + skuF + uomF + '</td>'
            + '<td class="td-qty" style="color:#c05621;">Fixo/m\xEAs</td>'
            + '<td class="td-brl" style="color:#c05621;">' + _brl(r.estimado_brl || r.custo_mes || 0) + '</td>'
            + '</tr>';
        }).join('')
        + '<tr class="tr-sub-fix"><td colspan="2" style="color:#c05621;font-weight:700;">🔒 Total Infra Fixa / m\xEAs</td>'
        + '<td style="text-align:right;font-family:\'IBM Plex Mono\',monospace;font-weight:700;color:#c05621;">' + _brl(totalFixoMes) + '</td></tr>'
      : '';

    const totalFinal = p.total_final || p.total_brl || 0;

    // Períodos — compacto (só renderiza quando estimativa foi feita por datas)
    const periodosHtml = (p.periodos && p.periodos.length > 0) ? (() => {
      const fmt = v => v ? v.slice(0, 10) : '';
      const totalH = p.periodos.reduce((s, per) => s + per.horas, 0);
      const rows = p.periodos.map((per, i) =>
        '<tr><td class="p-num">P' + (i + 1) + '</td>'
        + '<td class="p-dt">' + _esc(fmt(per.inicio)) + ' → ' + _esc(fmt(per.fim)) + '</td>'
        + '<td class="p-h">' + per.horas + ' h</td></tr>'
      ).join('');
      return '<div class="per-wrap"><span class="per-lbl">Per\xEDodos de Estimativa</span>'
        + '<table class="per-tbl"><tbody>' + rows
        + '<tr class="p-total"><td></td><td style="text-align:right;font-weight:700;font-size:7pt;">Total</td>'
        + '<td class="p-h">' + totalH + ' h</td></tr>'
        + '</tbody></table></div>';
    })() : '';

    const _origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${_esc(p.titulo)}</title>
<style>
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:300 700;font-display:swap;src:url('${_origin}/fonts/ibm-plex-sans-latin-400.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400 600;font-display:swap;src:url('${_origin}/fonts/ibm-plex-mono-latin-400.woff2') format('woff2')}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;font-size:9pt;color:#1a202c;background:#0d0f14;padding:16px}
.page{background:#fff;max-width:960px;margin:0 auto;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.55)}
/* ── CABEÇALHO compacto 52px ── */
.hdr{background:linear-gradient(135deg,#0d0218 0%,#1a0035 45%,#0d0014 100%);display:flex;align-items:center;height:52px;padding:0 18px;gap:14px;position:relative;overflow:hidden}
.hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:rgba(147,51,234,.3)}
.hdr-vivo{display:flex;align-items:center;gap:4px;flex-shrink:0}
.hdr-mascote{height:30px;width:auto;object-fit:contain;filter:drop-shadow(0 0 5px rgba(147,51,234,.4));vertical-align:middle}
.hdr-divider{width:1px;height:26px;background:rgba(147,51,234,.2);flex-shrink:0}
.hdr-meta{flex:1;display:flex;flex-direction:column;justify-content:center;gap:1px}
.hdr-title{font-size:9pt;font-weight:700;color:#c084fc;letter-spacing:.01em}
.hdr-sub{font-size:6pt;color:#6b5480;letter-spacing:.14em;text-transform:uppercase}
.hdr-r{text-align:right;flex-shrink:0}
.hdr-num{font-size:8.5pt;font-weight:700;color:#9333ea;font-family:'IBM Plex Mono',monospace;letter-spacing:.05em}
.hdr-date{font-size:6pt;color:#7c5fa0;margin-top:1px}
/* ── STRIPE ── */
.stripe{height:3px;background:linear-gradient(90deg,#2d0060 0%,#660099 25%,#9333ea 50%,#660099 75%,#2d0060 100%)}
/* ── META BAR ── */
.meta-bar{display:grid;grid-template-columns:2fr 2fr 1fr 1.6fr;border-bottom:2px solid #0d0014}
.mb{padding:9px 14px;border-right:1px solid #ede9f7;background:#fff}
.mb:last-child{border-right:none;background:linear-gradient(135deg,#0d0218,#1a0035)}
.mb-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.17em;color:#9aa0be;margin-bottom:3px}
.mb-val{font-size:9pt;font-weight:600;color:#1a202c;line-height:1.2}
.mb-sub{font-size:6.5pt;color:#64748b;margin-top:2px}
.mb:last-child .mb-lbl{color:#6b5480}
.mb:last-child .mb-val{font-size:12pt;font-weight:700;color:#c084fc;font-family:'IBM Plex Mono',monospace}
/* ── SUMÁRIO POR CATEGORIA ── */
.cat-wrap{padding:9px 14px 10px;border-bottom:1px solid #ede9f7}
.cat-title{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.17em;color:#7c3aed;margin-bottom:7px}
.cat-grid{display:flex;flex-wrap:wrap;gap:5px}
.cat-card{background:#f5f0ff;border:1px solid #ede9f7;border-radius:5px;padding:5px 9px;min-width:100px;flex:1}
.cat-nm{font-size:7pt;font-weight:700;color:#5b21b6;margin-bottom:1px}
.cat-ct{font-size:6pt;color:#9aa0be}
.cat-vl{font-size:8.5pt;font-weight:700;color:#7c3aed;font-family:'IBM Plex Mono',monospace;margin-top:2px}
/* ── TABELA COMPACTA ── */
table{width:100%;border-collapse:collapse;font-size:7.5pt}
thead tr{background:#13161e}
thead th{padding:6px 8px;font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9aa0be;text-align:left;white-space:nowrap;border-bottom:2px solid #9333ea}
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
/* ── SEPARADOR FIXO ── */
.tr-sep-fix td{background:#fff7ed;color:#92400e;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:4px 8px;border-top:1px solid #fed7aa;border-bottom:1px solid #fed7aa}
.tr-sub-fix td{background:#fff7ed;border-top:1px solid #fed7aa;font-size:7.5pt;padding:5px 8px}
/* ── TOTAIS ── */
tfoot td{padding:5px 8px}
.tr-sub td{background:#f5f0ff;color:#5b21b6;border-top:1px solid #ede9f7;font-size:7.5pt}
.tr-sub td:last-child{font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:600;color:#6d28d9}
.tr-add td{background:#f5f0ff;color:#64748b;font-size:7pt;border-top:1px solid #ede9f7}
.tr-add td:last-child{font-family:'IBM Plex Mono',monospace;text-align:right}
.tr-total td{background:linear-gradient(90deg,#0d0218,#1a0035);color:#9aa0be;font-weight:700;font-size:9pt;border-top:3px solid #9333ea;padding:9px 8px}
.tr-total td:first-child{padding-left:14px;color:#e9d5ff;letter-spacing:.05em;text-transform:uppercase;font-size:7.5pt}
.tr-total td:last-child{font-family:'IBM Plex Mono',monospace;font-size:12pt;text-align:right;color:#c084fc;padding-right:14px;font-weight:700}
/* ── OBS ── */
.obs{padding:9px 14px;border-top:1px solid #ede9f7;background:#faf7ff;border-left:3px solid #9333ea}
.obs-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;margin-bottom:3px}
.obs-txt{font-size:8pt;color:#374151;line-height:1.6}
/* ── PERÍODOS compacto ── */
.per-wrap{padding:7px 14px;background:#f5f0ff;border-bottom:1px solid #ede9f7;display:flex;align-items:flex-start;gap:10px}
.per-lbl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#7c3aed;white-space:nowrap;padding-top:3px}
.per-tbl{flex:1;border-collapse:collapse;font-size:7pt}
.per-tbl td{padding:2px 5px;border-bottom:1px solid #ede9f7;color:#4a5568}
.per-tbl .p-num{color:#660099;font-weight:700;width:20px}
.per-tbl .p-dt{font-family:'IBM Plex Mono',monospace}
.per-tbl .p-h{font-family:'IBM Plex Mono',monospace;text-align:right;color:#6d28d9;font-weight:600;white-space:nowrap}
.per-tbl .p-total td{font-weight:700;color:#4a0080;background:#ede9f7}
/* ── RODAPÉ ── */
.foot{padding:7px 14px;background:linear-gradient(135deg,#0d0218 0%,#1a0035 45%,#0d0014 100%);display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(147,51,234,.2);gap:12px}
.foot-l{font-size:6pt;color:#7c5fa0;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.foot-dot{width:3px;height:3px;border-radius:50%;background:#9333ea;display:inline-block;opacity:.7}
.foot-disc{font-size:5.5pt;color:#6b5480;font-style:italic}
.foot-r{font-size:6pt;color:#6b5480;font-family:'IBM Plex Mono',monospace;letter-spacing:.04em;white-space:nowrap}
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
        var cvs=document.createElement('canvas');cvs.width=W;cvs.height=H;
        var ctx=cvs.getContext('2d');ctx.drawImage(img,0,0);
        var d=ctx.getImageData(0,0,W,H),px=d.data;
        var cs=[[0,0],[W-1,0],[0,H-1],[W-1,H-1],[Math.floor(W/2),0],[Math.floor(W/2),H-1]];
        var bgR=0,bgG=0,bgB=0;
        for(var ci=0;ci<cs.length;ci++){var p4=(cs[ci][1]*W+cs[ci][0])*4;bgR+=px[p4];bgG+=px[p4+1];bgB+=px[p4+2];}
        bgR/=cs.length;bgG/=cs.length;bgB/=cs.length;
        var HARD=80,SOFT=120;
        for(var i=0;i<px.length;i+=4){
          var r=px[i],g=px[i+1],b=px[i+2];
          var dr=r-bgR,dg=g-bgG,db=b-bgB,dSq=dr*dr+dg*dg+db*db;
          if(dSq<HARD*HARD){px[i+3]=0;}
          else if(dSq<SOFT*SOFT){var d2=Math.sqrt(dSq);px[i+3]=Math.round(255*(d2-HARD)/(SOFT-HARD));px[i]=Math.round(r*0.35+147*0.65);px[i+1]=Math.round(g*0.35+51*0.65);px[i+2]=Math.round(b*0.35+234*0.65);}
          else{px[i+3]=255;px[i]=Math.round(r*0.35+147*0.65);px[i+1]=Math.round(g*0.35+51*0.65);px[i+2]=Math.round(b*0.35+234*0.65);}
        }
        ctx.putImageData(d,0,0);img.src=cvs.toDataURL('image/png');
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
  <div class="hdr-vivo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 36" width="52" height="24"><text id="pdf-vivo-text" x="1" y="28" font-family="'Arial Black','Arial Bold',Arial" font-weight="900" font-size="28" fill="#9333ea" letter-spacing="-1">vivo</text></svg>
    <img id="pdf-mascote" class="hdr-mascote" src="${_origin}/mascote.png" height="30" alt="" onerror="this.style.display='none'">
  </div>
  <div class="hdr-divider"></div>
  <div class="hdr-meta">
    <div class="hdr-title">FinOps Manager</div>
    <div class="hdr-sub">Estimativa de Custos Azure</div>
  </div>
  <div class="hdr-r">
    <div class="hdr-num">${p.invoiceNum}</div>
    <div class="hdr-date">Emitido em ${p.dataFmt}</div>
  </div>
</div>
<div class="stripe"></div>
<div class="meta-bar">
  <div class="mb">
    <div class="mb-lbl">Projeto</div>
    <div class="mb-val">${_esc((p.nomeProjeto || '').split('\xB7')[0].trim())}</div>
    ${p.resp  ? '<div class="mb-sub">Resp: <strong>' + _esc(p.resp) + '</strong></div>' : ''}
    ${p.email ? '<div class="mb-sub" style="font-size:6pt;color:#64748b;">✉ ' + _esc(p.email) + '</div>' : ''}
  </div>
  <div class="mb">
    <div class="mb-lbl">T&iacute;tulo</div>
    <div class="mb-val" style="font-size:8pt;">${_esc(p.titulo)}</div>
    <div class="mb-sub">${itensDinamicos.length} recurso${itensDinamicos.length !== 1 ? 's' : ''}${itensFixos.length > 0 ? ' + ' + itensFixos.length + ' fixo' + (itensFixos.length !== 1 ? 's' : '') : ''}</div>
  </div>
  <div class="mb">
    <div class="mb-lbl">V&aacute;lido at&eacute;</div>
    <div class="mb-val">${p.dataValid}</div>
  </div>
  <div class="mb">
    <div class="mb-lbl">Total Estimado BRL</div>
    <div class="mb-val">${_brl(totalFinal)}</div>
    ${p.horas ? '<div class="mb-sub" style="margin-top:3px;">'
      + '<span style="color:#9aa0be;font-size:6pt;">⏱\xA0</span>'
      + '<strong style="color:#c084fc;font-family:\'IBM Plex Mono\',monospace;">' + parseFloat(p.horas).toLocaleString('pt-BR') + '\xA0h</strong>'
      + (parseFloat(p.horas) > 0 ? '<span style="color:#6b5480;font-size:5.5pt;margin-left:5px;">≈\xA0' + _brl((p.total_brl||0) / parseFloat(p.horas)) + '/h</span>' : '')
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
    <tr class="tr-sub"><td colspan="3">Subtotal Estimado</td><td>${_brl(p.total_brl || 0)}</td></tr>
    ${(p.pct_imposto || 0) > 0 ? `<tr class="tr-add"><td colspan="3">+ Imposto (` + p.pct_imposto + `%)</td><td>` + _brl(p.vl_imposto || 0) + `</td></tr>` : ``}
    ${(p.pct_cond || 0) > 0 ? `<tr class="tr-add"><td colspan="3">+ Condom\xEDnio (` + p.pct_cond + `%)</td><td>` + _brl(p.vl_cond || 0) + `</td></tr>` : ``}
    <tr class="tr-total"><td colspan="3">Total Estimado</td><td>${_brl(totalFinal)}</td></tr>
  </tfoot>
</table>` : ``}
${periodosHtml}
${p.obs ? '<div class="obs"><div class="obs-lbl">Observa&ccedil;&otilde;es</div><div class="obs-txt">' + _esc(p.obs) + '</div></div>' : ''}
${itensFixos.length > 0 ? '<div style="padding:5px 14px;background:#fff7ed;border-top:1px solid #fed7aa;font-size:6pt;color:#92400e;font-style:italic;">⚠ Os custos fixos mensais não estão incluídos no Total Estimado. São cobrados mensalmente pelo Azure independente das horas do projeto.</div>' : ''}
<div class="foot">
  <div class="foot-l">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 36" width="24" height="11" style="opacity:.7"><text x="1" y="28" font-family="'Arial Black','Arial Bold',Arial" font-weight="900" font-size="28" fill="#9333ea" letter-spacing="-1">vivo</text></svg>
    <span class="foot-dot"></span>
    <span>FinOps Manager &middot; ${p.invoiceNum} &middot; ${new Date().toLocaleString('pt-BR')}</span>
    <span class="foot-dot"></span>
    <span class="foot-disc">Estimativa sujeita a altera&ccedil;&otilde;es &mdash; n&atilde;o constitui cobran&ccedil;a ou compromisso financeiro formal.</span>
  </div>
  <div class="foot-r">V&aacute;lido at&eacute; ${p.dataValid}</div>
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
    const email   = document.getElementById('cinv-email')?.value?.trim()    || '';
    const valDias = 5;
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
    // Portal público: usa endpoint sem auth; autenticado: usa /api/estimativas absoluto
    const _estimPath = _modoPublico ? (_apiBase + '/estimativas') : '/api/estimativas';
    _api('POST', _estimPath, {
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
      invoiceNum, dataFmt, titulo, dataValid, nomeProjeto, resp, email, obs, itens,
      horas:          _estimativa.horas,
      total_brl:      _estimativa.total_brl,
      total_fixo_mes: _estimativa.total_fixo_mes,
      total_final:    _estimativa.total_final,
      pct_imposto:    _estimativa.pct_imposto,
      vl_imposto:     _estimativa.vl_imposto,
      pct_cond:       _estimativa.pct_cond,
      vl_cond:        _estimativa.vl_cond,
      periodos:       _periodos.length > 0 ? [..._periodos] : null
    });


    fecharInvoice();
    _abrirPreviewModal(html, titulo + ' · ' + invoiceNum);
    _toast('Estimativa gerada: ' + invoiceNum, 'success');
  }

  function gerarPDFSalvo(e) {
    const dataVal   = e.data_estimativa ? String(e.data_estimativa).slice(0,10) : new Date().toISOString().slice(0,10);
    const dataFmt   = new Date(dataVal + 'T12:00:00').toLocaleDateString('pt-BR');
    const valDias   = parseInt(e.validade_dias) || 5;
    const dataValid = new Date(new Date(dataVal + 'T12:00:00').getTime() + valDias * 86400000).toLocaleDateString('pt-BR');
    const _recursos = Array.isArray(e.recursos) ? e.recursos : [];
    const _fixoMes  = _recursos.filter(r => r.tipo_custo === 'mes')
                               .reduce((s, r) => s + parseFloat(r.estimado_brl || r.custo_mes || 0), 0);
    const html = _buildPDFHtml({
      invoiceNum:     e.numero || 'EST-000000',
      dataFmt, dataValid,
      nomeProjeto:    e.projeto_nome || '',
      titulo:         e.titulo || 'Estimativa de Custos Azure',
      resp:           e.responsavel || '',
      email:          e.email || '',
      obs:            e.observacoes || '',
      itens:          _recursos,
      total_brl:      parseFloat(e.total_brl || 0),
      total_fixo_mes: _fixoMes,
      total_final:    parseFloat(e.total_final || 0),
      pct_imposto:    parseFloat(e.pct_imposto || 0),
      vl_imposto:     parseFloat(e.vl_imposto || 0),
      pct_cond:       parseFloat(e.pct_cond || 0),
      vl_cond:        parseFloat(e.vl_cond || 0)
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
    if (!modal) return;

    // Reset estado
    document.getElementById('cpurge-result').style.display  = 'none';
    document.getElementById('cpurge-preview').style.display = 'none';
    const confirmar = document.getElementById('cpurge-confirmar');
    if (confirmar) { confirmar.disabled = true; confirmar.style.opacity = '.45'; }
    document.querySelectorAll('input[name="cpurge-tipo"]').forEach(r => { if (r.value === 'periodo') r.checked = true; });
    _purgeOnModo('periodo');

    // Carregar resumo do banco
    const resumoEl = document.getElementById('cpurge-resumo');
    try {
      const d = await _api('GET', '/azure-costs/resumo');
      const r = d.resumo;
      const total = Number(r.total || 0).toLocaleString('pt-BR');
      const ini   = r.data_inicio ? r.data_inicio.slice(0,10) : '—';
      const fim   = r.data_fim    ? r.data_fim.slice(0,10)    : '—';
      const custo = r.total_billing != null ? Number(r.total_billing).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—';
      const moeda = r.moeda || '';
      // Linha por mês
      const meses = (d.por_mes || []).map(m => {
        const reg = Number(m.registros).toLocaleString('pt-BR');
        const val = Number(m.total_billing || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        return `<span style="white-space:nowrap">${m.mes}: <b>${reg}</b> reg · ${moeda} ${val}</span>`;
      }).join('<br>');
      resumoEl.innerHTML = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:${meses?'10px':'0'}">
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Total de registros</div><div style="font-size:14px;font-weight:700;color:var(--accent)">${total}</div></div>
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Período coberto</div><div style="font-size:13px;font-weight:600;color:var(--text)">${ini} → ${fim}</div></div>
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Custo total</div><div style="font-size:13px;font-weight:600;color:var(--text)">${moeda} ${custo}</div></div>
        </div>
        ${meses ? `<details style="margin-top:4px"><summary style="font-size:11px;color:var(--text-muted);cursor:pointer">Ver por mês</summary><div style="margin-top:8px;font-size:11px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px">${meses}</div></details>` : ''}`;
      // Preenche datas padrão
      const ini6 = r.data_inicio ? r.data_inicio.slice(0,10) : '';
      const fim6 = r.data_fim    ? r.data_fim.slice(0,10)    : '';
      if (!document.getElementById('cpurge-data-ini').value) document.getElementById('cpurge-data-ini').value = ini6;
      if (!document.getElementById('cpurge-data-fim').value) document.getElementById('cpurge-data-fim').value = fim6;

      // Carrega lista de arquivos
      const sel = document.getElementById('cpurge-sel');
      sel.innerHTML = '<option value="">— selecione —</option>';
      const imports = await _api('GET', '/azure-costs/imports');
      if (Array.isArray(imports)) {
        imports.filter(i => i.arquivo_origem).forEach(imp => {
          const opt = document.createElement('option');
          opt.value = imp.arquivo_origem;
          const ini2 = (imp.periodo_inicio || '').slice(0,10);
          const fim2 = (imp.periodo_fim   || '').slice(0,10);
          const lin  = Number(imp.linhas || 0).toLocaleString('pt-BR');
          opt.textContent = `${imp.arquivo_origem}  (${lin} reg · ${ini2}→${fim2})`;
          sel.appendChild(opt);
        });
      }
    } catch (e) {
      resumoEl.innerHTML = `<span style="color:var(--danger)">Erro ao carregar dados: ${e.message}</span>`;
    }

    modal.style.display = 'flex';
  }

  function fecharPurge() {
    const modal = document.getElementById('cpurge-modal');
    if (modal) modal.style.display = 'none';
  }

  function _purgeOnModo(modo) {
    document.getElementById('cpurge-area-periodo').style.display = modo === 'periodo'  ? '' : 'none';
    document.getElementById('cpurge-area-arquivo').style.display = modo === 'arquivo'  ? '' : 'none';
    document.getElementById('cpurge-preview').style.display = 'none';
    const confirmar = document.getElementById('cpurge-confirmar');
    if (confirmar) {
      // Modo "tudo" habilita confirmar direto (sem verificar)
      const ok = modo === 'tudo';
      confirmar.disabled  = !ok;
      confirmar.style.opacity = ok ? '1' : '.45';
    }
  }

  async function verificarPurge() {
    const modo = document.querySelector('input[name="cpurge-tipo"]:checked')?.value || 'periodo';
    const preview = document.getElementById('cpurge-preview');
    const confirmar = document.getElementById('cpurge-confirmar');
    preview.style.display = 'block';
    preview.style.background = 'rgba(147,51,234,.08)';
    preview.style.border = '1px solid rgba(147,51,234,.2)';
    preview.style.color = 'var(--accent)';
    preview.textContent = '⟳ Verificando...';
    if (confirmar) { confirmar.disabled = true; confirmar.style.opacity = '.45'; }

    try {
      let url = '/azure-costs/purge/preview?';
      if (modo === 'periodo') {
        const ini = document.getElementById('cpurge-data-ini').value;
        const fim = document.getElementById('cpurge-data-fim').value;
        if (!ini && !fim) { preview.style.color='var(--orange)'; preview.textContent='⚠ Informe ao menos uma data.'; return; }
        if (ini) url += `data_inicio=${encodeURIComponent(ini)}&`;
        if (fim) url += `data_fim=${encodeURIComponent(fim)}&`;
      } else if (modo === 'arquivo') {
        const arq = document.getElementById('cpurge-sel').value;
        if (!arq) { preview.style.color='var(--orange)'; preview.textContent='⚠ Selecione um arquivo.'; return; }
        url += `arquivo=${encodeURIComponent(arq)}&`;
      }
      const d = await _api('GET', url.replace(/[?&]$/, ''));
      const total = Number(d.total || 0).toLocaleString('pt-BR');
      if (d.total === 0) {
        preview.style.color = 'var(--green)';
        preview.style.background = 'rgba(34,197,94,.08)';
        preview.style.border = '1px solid rgba(34,197,94,.2)';
        preview.textContent = '✓ Nenhum registro encontrado nesse critério.';
        return;
      }
      preview.style.color = 'var(--danger)';
      preview.style.background = 'rgba(255,77,106,.08)';
      preview.style.border = '1px solid rgba(255,77,106,.2)';
      preview.textContent = `⚠ ${total} registros serão removidos permanentemente.`;
      if (confirmar) { confirmar.disabled = false; confirmar.style.opacity = '1'; }
    } catch (e) {
      preview.style.color = 'var(--danger)';
      preview.textContent = 'Erro: ' + e.message;
    }
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
    const res  = document.getElementById('cpurge-result');
    const modo = document.querySelector('input[name="cpurge-tipo"]:checked')?.value || 'periodo';

    res.style.display    = 'block';
    res.style.background = 'rgba(147,51,234,.08)';
    res.style.color      = 'var(--accent)';
    res.style.border     = '1px solid rgba(147,51,234,.2)';
    res.textContent      = 'Removendo dados...';

    let url = '/azure-costs/purge';
    if (modo === 'periodo') {
      const ini = document.getElementById('cpurge-data-ini').value;
      const fim = document.getElementById('cpurge-data-fim').value;
      const p = [];
      if (ini) p.push(`data_inicio=${encodeURIComponent(ini)}`);
      if (fim) p.push(`data_fim=${encodeURIComponent(fim)}`);
      if (p.length) url += '?' + p.join('&');
    } else if (modo === 'arquivo') {
      const arq = document.getElementById('cpurge-sel').value;
      if (arq) url += `?arquivo=${encodeURIComponent(arq)}`;
    }

    try {
      const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
      const r = await fetch(window.location.origin + '/api' + url, {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      });
      const ct   = r.headers.get('content-type') || '';
      let data;
      if (ct.includes('application/json')) {
        data = await r.json();
      } else {
        const text = await r.text();
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
      _subsSel = []; _rgsSel = []; _filtroTipos.clear(); _rgTotalMap.clear(); _ovCurRg = null;
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
    let totalFixoMes = 0;
    const _recursosMes = [];

    // rMap: O(1) por recurso — evita O(N²) com find() para cada selecionado
    const _rMapEst = new Map(_recursos.map(r => [r._key||r.resource_id, r]));

    sel.forEach(rid => {
      const r = _rMapEst.get(rid);
      if (!r) return;
      const isBRL  = (r.moeda || 'BRL') === 'BRL';
      const tcDB   = parseFloat(r.taxa_cambio || 0);
      const convR  = !isBRL ? (tcDB > 1 ? tcDB : _taxaBrl) : 1;
      const cr     = isBRL ? 1 : convR;
      totalCobrado += parseFloat(r.total_billing||0) * cr;
      if (!_horasAplicadas) return;
      const horas   = _selecionados[rid] || 720;
      const uom     = (r.unidade || '').toLowerCase();
      const tipo    = r.tipo_custo || (uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo');
      const chora   = parseFloat(r.custo_hora_billing || 0) * cr;
      const dias    = parseInt(r.dias_ativos || 1) || 1;
      const mesRaw  = parseFloat(r.custo_mes_billing) || (parseFloat(r.total_billing || 0) / dias * 30);
      const mesBrl  = mesRaw * cr;
      // RN-mes: custo mensal fixo (disco, licença por unidade/mês) — não entra no Total Estimado
      if (tipo === 'mes') {
        totalFixoMes += mesBrl;
        _recursosMes.push({ nome: r.nome_recurso || rid.split('/').pop() || rid.slice(0,40), uom: r.unidade || '—', valor: mesBrl, tipo: _tipoRecurso(r), svc: r.consumed_service || '—', cat: r.meter_category || '—' });
        return;
      }
      let estimado  = 0;
      if (tipo === 'reserva') {
        estimado = chora * horas;
      } else if (tipo === 'hora' || tipo === 'dia') {
        const _dbInf = _dbInfoParaRecurso(r);
        if (_dbInf && _dbInf.valida) {
          const billRec = parseFloat(r.total_billing || 0) * cr;
          estimado = _dbInf.hDriver > 0 ? (billRec / _dbInf.hDriver) * horas : chora * horas;
        } else {
          estimado = chora * horas;
        }
      } else {
        const upqBrl   = parseFloat(r.total_upq_brl || 0) * cr;
        const fallback = upqBrl > 0 ? (upqBrl / dias * 30) : mesBrl;
        estimado = fallback / 720 * horas;
      }
      totalGeral += estimado;
    });

    // Painel lateral: resumo compacto — lista detalhada disponível no modal Configurar Estimativa
    const _nRes = sel.length;
    lista.innerHTML = '<div style="padding:10px;display:flex;flex-direction:column;gap:8px;">'
      + '<div style="text-align:center;padding:10px 8px;border-radius:8px;background:var(--accent-dim);border:1px solid var(--border-light);">'
      + '<div style="font-size:24px;font-weight:700;color:var(--accent);line-height:1;">' + _nRes + '</div>'
      + '<div style="font-size:10px;color:var(--text-muted);margin-top:3px;">recurso' + (_nRes !== 1 ? 's' : '') + ' selecionado' + (_nRes !== 1 ? 's' : '') + '</div>'
      + '</div>'
      + (_horasAplicadas
        ? '<div style="border-radius:8px;background:var(--bg-hover);border:1px solid var(--border);padding:10px;">'
          + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:3px;">Cobrado no período</div>'
          + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;color:var(--text);">' + _brl(totalCobrado) + '</div>'
          + '</div>'
          + '<div style="border-radius:8px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.25);padding:10px;">'
          + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:3px;">Total Estimado (horas)</div>'
          + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:14px;font-weight:700;color:var(--accent);">' + _brl(totalGeral) + '</div>'
          + '</div>'
          + (totalFixoMes > 0
            ? '<div style="border-radius:8px;background:rgba(77,166,255,.07);border:1px solid rgba(77,166,255,.28);padding:10px;">'
              + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--blue,#4da6ff);margin-bottom:3px;">🔒 Infra Fixa/mês</div>'
              + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;color:var(--blue,#4da6ff);">' + _brl(totalFixoMes) + '</div>'
              + '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;">não entra no Total Estimado</div>'
              + '<details style="margin-top:6px;">'
              + '<summary style="font-size:9px;color:var(--blue,#4da6ff);cursor:pointer;list-style:none;">▶ Ver ' + _recursosMes.length + ' recurso' + (_recursosMes.length !== 1 ? 's' : '') + ' classificados</summary>'
              + '<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">'
              + _recursosMes.map(m => '<div style="display:flex;flex-direction:column;gap:1px;padding:4px 0;border-top:1px solid rgba(77,166,255,.10);">'
                + '<div style="display:flex;justify-content:space-between;gap:6px;">'
                + '<span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:9px;" title="' + _esc(m.nome) + '">' + _esc(m.nome) + '</span>'
                + '<span style="font-family:\'IBM Plex Mono\',monospace;color:var(--blue,#4da6ff);white-space:nowrap;flex-shrink:0;font-size:9px;">' + _brl(m.valor) + '</span>'
                + '</div>'
                + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
                + '<span style="font-size:8px;color:' + (m.tipo === 'Outros' ? 'var(--orange,#ff8c42)' : 'var(--accent)') + ';background:' + (m.tipo === 'Outros' ? 'rgba(255,140,66,.12)' : 'rgba(147,51,234,.12)') + ';border-radius:3px;padding:0 4px;" title="consumed_service: ' + _esc(m.svc) + '&#10;meter_category: ' + _esc(m.cat) + '">' + _esc(m.tipo) + '</span>'
                + '<span style="font-size:8px;color:var(--text-muted);">' + _esc(m.uom) + '</span>'
                + (m.tipo === 'Outros' ? '<span style="font-size:8px;color:var(--text-muted);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="' + _esc(m.svc) + ' / ' + _esc(m.cat) + '">' + _esc(m.cat || m.svc) + '</span>' : '')
                + '</div>'
                + '</div>').join('')
              + '</div></details>'
              + '</div>'
            : '')
        : '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px 10px;border-radius:6px;background:var(--bg-hover);border:1px solid var(--border);">Configure as horas e clique Aplicar</div>'
      )
      + '</div>';

    const pctImposto = parseFloat(document.getElementById('cimposto')?.value) || 0;
    const pctCond    = parseFloat(document.getElementById('ccondominио')?.value) || 0;
    // Gordura embutida por tipo — multiplica cada valor individualmente para que a soma feche
    const pctGordura = _modoPublico
      ? parseFloat(_defaultConfig?.taxa_gordura || 0)
      : parseFloat(document.getElementById('cgordura')?.value) || 0;
    const gordFator  = 1 + pctGordura / 100;
    totalGeral   *= gordFator;
    totalFixoMes *= gordFator;
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
      total_cobrado:  totalCobrado,
      total_brl:      totalGeral,
      total_fixo_mes: totalFixoMes,
      recursos_mes:   _recursosMes,
      total_final:    totalFinal,
      pct_imposto:    pctImposto,
      vl_imposto:     vlImposto,
      pct_cond:       pctCond,
      vl_cond:        vlCond,
      pct_gordura:    pctGordura,
      vl_gordura:     gordFator > 1 ? Math.round((totalGeral - totalGeral / gordFator) * 100) / 100 : 0,
      horas: parseInt(document.getElementById('chglobal')?.value) || 720,
      resultados: sel.map(rid => {
        const r   = _rMapEst.get(rid);
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
        // RN-007: fallback amortizado para RI/SP coberto (custo_hora_billing=0, effective_price>0)
        const _amortRaw2 = r.usa_amortizado && choraRaw === 0 ? parseFloat(r.taxa_hora_rate || 0) : 0;
        const chora     = (choraRaw > 0 ? choraRaw : _amortRaw2) * convR2;
        const _diasP    = parseInt(r.dias_ativos || 1) || 1;
        const mesRaw    = parseFloat(r.custo_mes_billing) ||
                          (parseFloat(r.total_billing || 0) / _diasP * 30);
        const custo_mes = isBRL ? mesRaw : mesRaw * convR2;
        // mes: custo fixo mensal — estimado_brl = custo do mês (não proporcional às horas)
        if (tipo2 === 'mes') {
          return {
            resource_id:      rid,
            nome:             r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,50),
            sku:              r.meter_categories || '',
            categoria:        r.categoria || '',
            consumed_service: r.consumed_service || '',
            resource_group:   r.resource_group_name || '',
            uom:              r.unidade || '',
            tipo_custo:       'mes',
            fixo_mensal:      true,
            isHora:           false,
            horas:            0,
            custo_hora:       0,
            fonte_estimado:   'billing',
            custo_mes:        custo_mes,
            dias_ativos:      _diasP,
            total_cobrado:    bill,
            estimado_brl:     custo_mes * gordFator,
            moeda:            r.moeda || 'BRL',
          };
        }
        // Estimado: periodo → billing/mês ÷ 720 | hora → billing/h × horas
        const _diasP2    = _diasP;
        const _mesR2     = parseFloat(r.custo_mes_billing) || (parseFloat(r.total_billing || 0) / _diasP2 * 30);
        const _upqBrl2   = isBRL ? parseFloat(r.total_upq_brl || 0) : parseFloat(r.total_upq_brl || 0) * convR2;
        const custo_mes2 = isBRL ? _mesR2 : _mesR2 * convR2;
        const _fallback2 = _upqBrl2 > 0 ? (_upqBrl2 / _diasP2 * 30) : custo_mes2;
        // RN-DB-001: Databricks cluster rate — billing_recurso / H_driver
        const _dbInf2  = tipo2 === 'hora' ? _dbInfoParaRecurso(r) : null;
        const _dbValida = _dbInf2 && _dbInf2.valida;
        const billRec2  = isBRL ? parseFloat(r.total_billing||0) : parseFloat(r.total_billing||0) * convR2;
        const taxaEf2   = _dbValida && _dbInf2.hDriver > 0 ? billRec2 / _dbInf2.hDriver : 0;
        // Estimado: sempre billing — sem Price List
        const estimado = (tipo2 === 'periodo')
          ? _fallback2 / 720 * horas
          : _dbValida ? taxaEf2 * horas
          : chora * horas;
        return {
          resource_id:      rid,
          nome:             r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0,50),
          sku:              r.meter_categories || '',
          categoria:        r.categoria || '',
          consumed_service: r.consumed_service || '',
          resource_group:   r.resource_group_name || '',
          uom:              r.unidade || '',
          tipo_custo:       tipo2,
          fixo_mensal:      false,
          isHora,
          horas,
          custo_hora:       chora,
          fonte_estimado:   'billing',
          custo_mes:        custo_mes,
          dias_ativos:      parseInt(r.dias_ativos) || 0,
          total_cobrado:    bill,
          estimado_brl:     estimado * gordFator,
          moeda:            r.moeda || 'BRL',
          databricks_valida: _dbValida || false,
          databricks_taxa:   taxaEf2,
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

    const modal = document.getElementById('covmodal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const cntEl = document.getElementById('cov-cnt');
    if (cntEl) cntEl.textContent = sel.length + ' recurso' + (sel.length === 1 ? '' : 's') + ' selecionado' + (sel.length === 1 ? '' : 's');

    _hlCarregar();
    _ovAtualizarTotal();
    setTimeout(() => _ovRenderRecursos(), 0);

    // Lazy load pico em background — não bloqueia exibição dos cards
    if (!_picoCarregado && _recursos.length) {
      _carregarPico().then(() => {
        const m = document.getElementById('covmodal');
        if (m && m.style.display !== 'none') setTimeout(() => _ovRenderRecursos(), 0);
      });
    }
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

  // Estado de paginação do modal — persistido entre lotes
  let _ovSel = [], _ovRMap = null, _ovRMapSrc = null, _ovIdx = 0, _ovRgSelTotalMap = null;
  const _OV_LOTE = 100; // cards por lote

  function _ovRenderRecursos() {
    const container = document.getElementById('cov-recursos');
    if (!container) return;
    container.innerHTML = '';
    // Cache do mapa — só rebuilda quando _recursos muda de referência (ex: após _carregarPico)
    if (_ovRMapSrc !== _recursos) {
      _ovRMapSrc = _recursos;
      _ovRMap = new Map(_recursos.map(r => [r._key||r.resource_id, r]));
    }
    // Schwartzian transform: extrai RG uma vez (32k lookups) em vez de 2 por comparação (960k)
    _ovSel = Object.keys(_selecionados)
      .map(k => [k, (_ovRMap.get(k)?.resource_group_name || '').toUpperCase()])
      .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
      .map(x => x[0]);
    _ovIdx  = 0;
    _ovCurRg = null;
    // Pré-computa total selecionado por RG — evita O(N²) no loop de cards
    _ovRgSelTotalMap = new Map();
    for (const k of _ovSel) {
      const rk = _ovRMap.get(k); if (!rk) continue;
      const rgUp = (rk.resource_group_name || '').toUpperCase();
      const isBRL = (rk.moeda || 'BRL') === 'BRL';
      const tcDB  = parseFloat(rk.taxa_cambio || 0);
      const val   = parseFloat(rk.total_billing || 0) * (isBRL ? 1 : (tcDB > 1 ? tcDB : _taxaBrl));
      _ovRgSelTotalMap.set(rgUp, (_ovRgSelTotalMap.get(rgUp) || 0) + val);
    }
    if (!_ovSel.length) return;
    _ovRenderLote(container);
  }
  let _ovCurRg = null;

  function _ovCarregarMais() {
    const container = document.getElementById('cov-recursos');
    document.getElementById('cov-mais')?.remove();
    if (container) _ovRenderLote(container);
  }

  function _ovRenderLote(container) {
    const end = Math.min(_ovIdx + _OV_LOTE, _ovSel.length);
    const _pctGord = _modoPublico
      ? parseFloat(_defaultConfig?.taxa_gordura || 0)
      : parseFloat(document.getElementById('cgordura')?.value) || 0;
    const _gordFat = 1 + _pctGord / 100;
    let _html = '';
    for (let _oi = _ovIdx; _oi < end; _oi++) {
        const rid = _ovSel[_oi];
        const r   = _ovRMap.get(rid);
        if (!r) continue;

      // ── Cabeçalho de RG (emite quando muda o grupo) ──────────────────────────
      const _rgUp = (r.resource_group_name || '').toUpperCase();
      if (_rgUp !== _ovCurRg) {
        _ovCurRg = _rgUp;
        const _mi       = _managedRgMap.get(_rgUp);
        const _mt       = _mi?.managed_type;
        const _ml       = _mi?.managed_label || '';
        const _icon     = _mt === 'databricks' ? '⚡ ' : _mt === 'aks' ? '☸ ' : '';
        const _badge    = _mt
          ? `<span style="font-size:10px;padding:1px 7px;border-radius:8px;${_mt==='aks'?'background:rgba(255,140,66,.15);color:var(--orange)':'background:rgba(147,51,234,.15);color:var(--accent)'};">${_mt==='aks'?'AKS':'Databricks'} · ${_ml}</span>`
          : '';
        const _rgTotal  = _rgTotalMap.get(_rgUp) || 0;
        // Total selecionado neste RG — O(1) via mapa pré-computado em _ovRenderRecursos
        const _selTotal = _ovRgSelTotalMap ? (_ovRgSelTotalMap.get(_rgUp) || 0) : 0;
        const _pct = _rgTotal > 0 ? Math.round(_selTotal / _rgTotal * 100) : 0;
        const _pctColor = _pct >= 80 ? 'var(--green,#22c55e)' : _pct >= 40 ? 'var(--orange,#ff8c42)' : 'var(--text-muted)';
        _html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px 4px;margin-top:${_oi===_ovIdx?'0':'14px'};">
          <span style="font-size:11px;font-weight:700;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_icon}${_esc(r.resource_group_name||'—')}</span>
          ${_badge}
          <span style="flex:1;height:1px;background:var(--border);flex-shrink:1;min-width:8px;"></span>
          ${_rgTotal>0?`<span style="font-size:10px;white-space:nowrap;color:var(--text-muted);" title="Total do RG no período: ${_brl(_rgTotal)}">💰 ${_brl(_rgTotal)}/período</span>
          <span style="font-size:10px;font-weight:700;white-space:nowrap;color:${_pctColor};" title="Cobertura: itens selecionados vs total do RG">${_pct}% coberto</span>`:''}
        </div>`;
      }
      // ─────────────────────────────────────────────────────────────────────────
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
      // RN-007: RI/SP coberto — custo_in_billing=0; usa taxa_hora_rate (effective_price amortizado)
      const _taxaAmort = r.usa_amortizado && choraRaw === 0 ? parseFloat(r.taxa_hora_rate || 0) : 0;
      const chora     = (choraRaw > 0 ? choraRaw : _taxaAmort) * convR;
      // RN-006: Cost ÷ Qty — taxa por unidade nativa do UoM (para exibição em periodo/mes)
      const custo_uom_raw2 = parseFloat(r.custo_uom_billing || 0);
      const custo_uom_brl2 = isBRL ? custo_uom_raw2 : custo_uom_raw2 * convR;
      const diasAtiv  = parseInt(r.dias_ativos || 1) || 1;
      const totalBill = parseFloat(r.total_billing || 0);
      // custo_mes_billing: campo do banco ou fallback total_billing / dias * 30
      const mesRaw    = parseFloat(r.custo_mes_billing) ||
                        (totalBill / diasAtiv * 30);
      const mesBrl    = mesRaw * convR;
      const bill      = totalBill * convR;
      const qty      = parseFloat(r.total_qty || 0).toLocaleString('pt-BR', {maximumFractionDigits: 4});
      const cor      = tipo === 'reserva' ? 'var(--blue)' : (tipo === 'periodo' || tipo === 'mes') ? 'var(--orange)' : 'var(--accent)';
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
      // RN-DB-001: Databricks cluster rate — billing_recurso / H_driver
      const _dbInfOv    = tipo === 'hora' ? _dbInfoParaRecurso(r) : null;
      const _dbValidaOv = _dbInfOv && _dbInfOv.valida;
      const taxaEfOv    = _dbValidaOv && _dbInfOv.hDriver > 0 ? bill / _dbInfOv.hDriver : chora;

      // Estimado: pico do período quando disponível; senão billing
      const _upqBrl3         = parseFloat(r.total_upq_brl || 0) * convR;
      const _fallback3       = _upqBrl3 > 0 ? (_upqBrl3 / diasAtiv * 30) : mesBrl;
      const _picoRaw         = parseFloat(r.custo_hora_pico || 0);
      const _picoBrl         = _picoRaw > 0 ? _picoRaw * convR : 0;
      const _usaPico         = _picoBrl > 0 && tipo !== 'reserva' && tipo !== 'mes' && !_dbValidaOv;
      // Pico do cluster Databricks: pior dia do RG inteiro (captura autoscale)
      const _picoClusterRaw  = parseFloat(r.custo_hora_pico_cluster || 0);
      const _picoClusterBrl  = _picoClusterRaw > 0 ? _picoClusterRaw * convR : 0;
      const _usaPicoCluster  = _dbValidaOv && _picoClusterBrl > 0;
      const estimadoMes = mesBrl;
      const estimado = ((tipo === 'mes')
        ? estimadoMes
        : _usaPicoCluster
          ? _picoClusterBrl * horas                // pico cluster → taxa/h × horas
          : _usaPico
            ? _picoBrl * horas
            : (tipo === 'periodo')
              ? _fallback3 / 720 * horas
              : taxaEfOv * horas) * _gordFat;

      // Coluna 1: preço base da estimativa
      let col1Lbl, col1Val, col1Suf, col1Tip = '';
      if (tipo === 'reserva') {
        col1Lbl = 'Amort./h 🔒'; col1Val = _brl(chora); col1Suf = '/h';
      } else if (tipo === 'mes') {
        col1Lbl = '🔒 Fixo/mês'; col1Val = _brl(mesBrl); col1Suf = '/mês';
        col1Tip = ' title="Custo mensal fixo baseado no billing histórico"';
      } else if (_usaPico && (tipo === 'hora' || tipo === 'dia')) {
        const _picoData  = r.pico_data ? new Date(r.pico_data).toLocaleDateString('pt-BR') : '—';
        const _picoDia   = parseFloat(r.pico_custo_dia || 0) * convR;
        const _picoH     = parseFloat(r.pico_horas_dia || 0);
        const _picoLabel = _dbValidaOv ? '⚠ Pico Cluster/h' : '⚠ Pico/h';
        col1Lbl = _picoLabel; col1Val = _brl(_picoBrl); col1Suf = '/h';
        col1Tip = ' title="Pico: ' + _picoData + ' — custo do dia: ' + _brl(_picoDia)
                + (_picoH > 0 ? ' em ' + _picoH.toFixed(1) + 'h ligado' : '')
                + ' → ' + _brl(_picoBrl) + '/h"';
      } else if (_usaPico && tipo === 'periodo') {
        const _picoData = r.pico_data ? new Date(r.pico_data).toLocaleDateString('pt-BR') : '—';
        const _picoDia  = parseFloat(r.pico_custo_dia || 0) * convR;
        col1Lbl = '⚠ Pico/m\xEAs*'; col1Val = _brl(_picoBrl * 720); col1Suf = '/m\xEAs';
        col1Tip = ' title="Pico: ' + _picoData + ' — custo do dia: ' + _brl(_picoDia)
                + ' \xD7 30 dias = ' + _brl(_picoBrl * 720) + '/m\xEAs"';
      } else if (_usaPicoCluster) {
        const _pcData  = r.pico_cluster_data ? new Date(r.pico_cluster_data).toLocaleDateString('pt-BR') : '—';
        const _pcCusto = parseFloat(r.pico_cluster_custo_rg || 0) * convR;
        const _pcHoras = parseFloat(r.pico_cluster_horas_dia || 0);
        col1Lbl = '⚠ Pico Cluster/h'; col1Val = _brl(_picoClusterBrl); col1Suf = '/h';
        col1Tip = ' title="Pico cluster: ' + _pcData + ' — custo total RG: ' + _brl(_pcCusto)
                + (_pcHoras > 0 ? ' em ' + _pcHoras.toFixed(1) + 'h (driver)' : '')
                + ' → ' + _brl(_picoClusterBrl) + '/h"';
      } else if (_dbValidaOv) {
        // RN-DB-001: Databricks cluster rate — billing_recurso / H_driver (sem pico disponível)
        col1Lbl = '⚡ Cluster/h';
        col1Val = _brl(taxaEfOv);
        col1Suf = '/h';
        col1Tip = ' title="Custo proporcional: billing R$ ' + bill.toFixed(2) + ' \xF7 ' + _dbInfOv.hDriver + 'h (uptime cluster) = R$ ' + taxaEfOv.toFixed(4) + '/h | workspace: R$ ' + _dbInfOv.taxa.toFixed(4) + '/h (' + _dbInfOv.recursos + ' VMs)"';
      } else if (tipo === 'periodo' && (r.unidade||'').toLowerCase().includes('dbu')) {
        // Databricks DBU software — label específico; custo_uom_brl2 já tem R$/DBU
        col1Lbl = '⚡ DBU/mês*'; col1Val = _brl(mesBrl); col1Suf = '/mês';
        col1Tip = ' title="Custo mensal proporcional dos DBUs Databricks (software licensing). Taxa unitária: ' + _brl(custo_uom_brl2) + '/DBU"';
      } else if (tipo === 'periodo') {
        col1Lbl = 'Custo/mês*'; col1Val = _brl(mesBrl); col1Suf = '/mês';
        col1Tip = ' title="Estimativa proporcional ao billing histórico (Cost \xF7 Qty)"';
      } else if (tipo === 'dia') {
        col1Lbl = 'Custo/h·dia'; col1Val = _brl(chora); col1Suf = '/h';
      } else if (r.usa_amortizado && tipo === 'hora' && chora > 0) {
        // RN-007: VM coberta por RI/SP — effective_price (amortizado) como base
        col1Lbl = '⚡ Amort./h'; col1Val = _brl(chora); col1Suf = '/h';
        col1Tip = ' title="Custo amortizado: VM coberta por Reserva ou Savings Plan — effective_price \xD7 qty \xF7 horas = taxa proporcional real"';
      } else {
        col1Lbl = 'Custo/h'; col1Val = _brl(chora); col1Suf = '/h';
      }

      // Coluna 2: horas do slider — para mes mostra "Mensal" pois não depende de horas
      const col2Lbl = tipo === 'mes' ? 'Modelo' : 'Horas';
      const col2Val = tipo === 'mes' ? 'Mensal' : horas + 'h';

      _html += '<div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:10px;padding:12px 14px;transition:border-color .15s;" onmouseover="this.style.borderColor=\'var(--border-light)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'

        // Nome + subtítulo
        + '<div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px;" title="' + _esc(r.resource_id || nome) + '">' + _esc(nome) + '</div>'
        + (subtit ? '<div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;">' + _esc(subtit) + '</div>' : '<div style="margin-bottom:6px;"></div>')

        // Badges: categoria, charge_type, rg, consumed_service, uso parcial, databricks
        + '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">'
        + (cat ? '<span style="font-size:10px;background:var(--accent-dim);color:var(--text-dim);border-radius:4px;padding:2px 7px;">' + cat + '</span>' : '')
        + (ct  ? '<span style="font-size:10px;border-radius:4px;padding:2px 7px;' + ctColor + ';">' + _esc(ct) + '</span>' : '')
        + (rg ? (()=>{
            const _mi = _managedRgMap.get((r.resource_group_name||'').toUpperCase());
            const _mt = _mi?.managed_type;
            const _ml = _mi?.managed_label || '';
            const _rgStyle = _mt === 'aks'
              ? 'background:rgba(255,140,66,.12);color:var(--orange,#ff8c42);'
              : _mt === 'databricks'
              ? 'background:rgba(147,51,234,.12);color:var(--accent);'
              : 'background:rgba(77,166,255,.08);color:var(--blue);';
            const _prefix = _mt === 'aks' ? '☸ ' : _mt === 'databricks' ? '⚡ ' : '';
            const _title  = _mt === 'aks' ? 'RG gerenciado pelo AKS — cluster: ' + _ml
                          : _mt === 'databricks' ? 'RG gerenciado pelo Databricks — workspace: ' + _ml
                          : '';
            return '<span style="font-size:10px;border-radius:4px;padding:2px 7px;' + _rgStyle + '" title="' + _esc(_title||rg) + '">' + _prefix + rg + '</span>';
          })() : '')
        + (svc ? '<span style="font-size:10px;background:var(--bg-card);color:var(--text-dim);border-radius:4px;padding:2px 7px;border:1px solid var(--border);">' + svc + '</span>' : '')
        + (usoParcial ? '<span style="font-size:10px;background:rgba(255,140,66,.15);color:var(--orange,#ff8c42);border-radius:4px;padding:2px 7px;" title="Recurso ficou ligado menos de 55% do m\xEAs no per\xEDodo importado">⚠ Uso parcial</span>' : '')
        + (_dbValidaOv ? '<span style="font-size:10px;background:rgba(77,166,255,.12);color:var(--blue,#4da6ff);border-radius:4px;padding:2px 7px;" title="Custo estimado pela taxa proporcional do workspace Databricks">⚡ Databricks</span>' : '')
        + (!_dbValidaOv && (r.unidade||'').toLowerCase().includes('dbu') ? '<span style="font-size:10px;background:rgba(77,166,255,.12);color:var(--blue,#4da6ff);border-radius:4px;padding:2px 7px;" title="Databricks DBU — cobrança de software (licenciamento de runtime). Taxa: ' + _brl(custo_uom_brl2) + '/DBU">⚡ DBU</span>' : '')
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

        + '<div style="text-align:center;border-radius:6px;padding:6px 4px;'
        +   (_dbValidaOv
              ? 'background:rgba(77,166,255,.08);border:1px solid rgba(77,166,255,.30);'
              : 'background:var(--bg-card);border:1px solid transparent;')
        + '"' + col1Tip + '>'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:'
        +   (_dbValidaOv ? 'var(--blue,#4da6ff)' : tipo === 'reserva' ? 'var(--blue,#4da6ff)' : 'var(--text-muted)')
        + ';margin-bottom:2px;">' + col1Lbl + '</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;color:'
        +   (_dbValidaOv ? 'var(--blue,#4da6ff)' : cor) + ';">' + col1Val + '<span style="font-size:9px;font-weight:400;">' + col1Suf + '</span></div>'
        + (_dbValidaOv ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">billing:\xA0' + _brl(chora) + '/h</div>' : '')
        // RN-006: Cost ÷ Qty — taxa por unidade nativa (periodo/mes)
        + (custo_uom_brl2 > 0 && (tipo === 'periodo' || tipo === 'mes')
           ? '<div style="font-size:8px;color:var(--orange,#ff8c42);opacity:.85;margin-top:3px;font-family:\'IBM Plex Mono\',monospace;white-space:nowrap;border-top:1px solid rgba(255,140,66,.12);padding-top:2px;" title="Cost \xF7 Qty = taxa real por unidade de medida — auditoria FinOps">'
             + _brl(custo_uom_brl2) + '\xA0/\xA0' + _esc((r.unidade||'').replace(/^\d+\s+/,'').trim()||'un.') + '</div>'
           : '')
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">' + col2Lbl + '</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:var(--accent);">' + col2Val + '</div>'
        + '</div>'

        + '<div style="text-align:center;background:var(--bg-card);border-radius:6px;padding:6px 4px;">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:2px;">Cobrado</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:600;color:var(--text-dim);">' + (bill > 0 ? _brl(bill) : '—') + '</div>'
        + '</div>'

        + '<div style="text-align:center;border-radius:6px;padding:6px 4px;'
        +   (tipo === 'mes'
              ? 'background:rgba(77,166,255,.10);border:2px solid rgba(77,166,255,.40);'
              : _usaPicoCluster || _usaPico
                ? 'background:rgba(255,140,66,.08);border:2px solid rgba(255,140,66,.35);'
                : _dbValidaOv
                  ? 'background:rgba(77,166,255,.10);border:2px solid rgba(77,166,255,.40);'
                  : 'background:var(--bg-card);border:1px solid var(--accent-glow);')
        + '">'
        + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:'
        +   (tipo === 'mes' ? 'var(--blue,#4da6ff)' : (_usaPicoCluster || _usaPico) ? 'var(--orange,#ff8c42)' : _dbValidaOv ? 'var(--blue,#4da6ff)' : 'var(--text-muted)')
        + ';margin-bottom:2px;">'
        +   (tipo === 'mes' ? '🔒 Infra Fixa' : ((_usaPicoCluster || _usaPico) ? '⚠ ' : _dbValidaOv ? '⚡ ' : '') + 'Estimado')
        +   (!_dbValidaOv && !_usaPico && tipo === 'periodo' ? ' <span style="font-size:9px;">/mês*</span>' : '')
        +   (_usaPico && tipo === 'periodo' ? ' <span style="font-size:9px;">/mês*</span>' : '')
        + '</div>'
        + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;color:'
        +   (tipo === 'mes' ? 'var(--blue,#4da6ff)' : (_usaPicoCluster || _usaPico) ? 'var(--orange,#ff8c42)' : _dbValidaOv ? 'var(--blue,#4da6ff)' : 'var(--text-muted)')
        + ';">' + _brl(estimado) + (tipo === 'mes' ? '<span style="font-size:9px;font-weight:400;">/mês</span>' : '') + '</div>'
        + '</div>'

        + '</div>'


        + '</div>';
    } // fim do for
    if (_html) container.insertAdjacentHTML('beforeend', _html);
    _ovIdx = end;
    if (_ovIdx < _ovSel.length) {
      container.insertAdjacentHTML('beforeend', '<div id="cov-sentinel" style="height:1px;"></div>');
      new IntersectionObserver((entries, obs) => {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        document.getElementById('cov-sentinel')?.remove();
        _ovCarregarMais();
      }, { rootMargin: '200px' }).observe(document.getElementById('cov-sentinel'));
    }
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
    const rf   = document.getElementById('cov-row-fixo');
    const vf   = document.getElementById('cov-vl-fixo');
    if (sub) sub.textContent = _brl(_estimativa.total_brl);
    if (ri)  ri.style.display  = _estimativa.pct_imposto > 0 ? 'flex' : 'none';
    if (li)  li.textContent    = '+ Imposto (' + _estimativa.pct_imposto + '%)';
    if (vi)  vi.textContent    = _brl(_estimativa.vl_imposto);
    if (rc)  rc.style.display  = _estimativa.pct_cond > 0 ? 'flex' : 'none';
    if (lc)  lc.textContent    = '+ Condomínio (' + _estimativa.pct_cond + '%)';
    if (vc)  vc.textContent    = _brl(_estimativa.vl_cond);
    const rg2 = document.getElementById('cov-row-gord');
    if (rg2) rg2.style.display = 'none';
    if (tot) tot.textContent   = _brl(_estimativa.total_final);
    const fixo    = _estimativa.total_fixo_mes || 0;
    const rMes    = _estimativa.recursos_mes   || [];
    if (rf)  rf.style.display  = fixo > 0 ? 'flex' : 'none';
    if (vf)  vf.textContent    = _brl(fixo);
    if (rf && fixo > 0) {
      const detId = 'cov-fixo-det';
      if (!document.getElementById(detId)) {
        const det = document.createElement('details');
        det.id = detId;
        det.style.cssText = 'margin-top:4px;';
        rf.appendChild(det);
      }
      const det = document.getElementById(detId);
      det.innerHTML = '<summary style="font-size:9px;color:var(--blue,#4da6ff);cursor:pointer;list-style:none;">▶ Ver ' + rMes.length + ' recurso' + (rMes.length !== 1 ? 's' : '') + ' classificados</summary>'
        + '<div style="margin-top:5px;display:flex;flex-direction:column;gap:2px;">'
        + rMes.map(m => '<div style="display:flex;flex-direction:column;gap:1px;padding:4px 0;border-top:1px solid rgba(77,166,255,.10);">'
          + '<div style="display:flex;justify-content:space-between;gap:6px;">'
          + '<span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:9px;" title="' + _esc(m.nome) + '">' + _esc(m.nome) + '</span>'
          + '<span style="font-family:\'IBM Plex Mono\',monospace;color:var(--blue,#4da6ff);white-space:nowrap;flex-shrink:0;font-size:9px;">' + _brl(m.valor) + '</span>'
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + '<span style="font-size:8px;color:' + (m.tipo === 'Outros' ? 'var(--orange,#ff8c42)' : 'var(--accent)') + ';background:' + (m.tipo === 'Outros' ? 'rgba(255,140,66,.12)' : 'rgba(147,51,234,.12)') + ';border-radius:3px;padding:0 4px;" title="consumed_service: ' + _esc(m.svc) + '&#10;meter_category: ' + _esc(m.cat) + '">' + _esc(m.tipo) + '</span>'
          + '<span style="font-size:8px;color:var(--text-muted);">' + _esc(m.uom) + '</span>'
          + (m.tipo === 'Outros' ? '<span style="font-size:8px;color:var(--text-muted);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="' + _esc(m.svc) + ' / ' + _esc(m.cat) + '">' + _esc(m.cat || m.svc) + '</span>' : '')
          + '</div>'
          + '</div>').join('')
        + '</div>';
    }
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

  // ── Horário Livre: localStorage ──────────────────────────────────
  const _LS_HL = 'finops_horario_livre';

  function _hlSalvarPadrao() {
    _hlLerConfig();
    localStorage.setItem(_LS_HL, JSON.stringify(_horarioLivre));
    _toast('Horário livre salvo como padrão.', 'success');
  }

  function _hlCarregar() {
    try {
      let cfg;
      const _adminHL = _modoPublico && _defaultConfig?.horario_livre;
      if (_adminHL) {
        cfg = _defaultConfig.horario_livre;
      } else {
        const raw = localStorage.getItem(_LS_HL);
        if (!raw) return;
        cfg = JSON.parse(raw);
      }
      if (cfg && typeof cfg === 'object') {
        _horarioLivre = { ..._horarioLivre, ...cfg };
        const chk  = document.getElementById('chl-ativo');
        const ini  = document.getElementById('chl-ini');
        const fim  = document.getElementById('chl-fim');
        const iniS = document.getElementById('chl-ini-sab');
        const fimS = document.getElementById('chl-fim-sab');
        const iniD = document.getElementById('chl-ini-dom');
        const fimD = document.getElementById('chl-fim-dom');
        if (chk)  chk.checked = !!_horarioLivre.ativo;
        if (ini)  ini.value   = _horarioLivre.inicio     || '09:00';
        if (fim)  fim.value   = _horarioLivre.fim        || '18:00';
        if (iniS) iniS.value  = _horarioLivre.inicio_sab || '09:00';
        if (fimS) fimS.value  = _horarioLivre.fim_sab    || '18:00';
        if (iniD) iniD.value  = _horarioLivre.inicio_dom || '09:00';
        if (fimD) fimD.value  = _horarioLivre.fim_dom    || '18:00';
        document.querySelectorAll('.chl-dia').forEach(cb => {
          cb.checked = _horarioLivre.dias.includes(parseInt(cb.dataset.dia));
        });
        const corpo = document.getElementById('chl-corpo');
        const hint  = document.getElementById('chl-hint');
        if (corpo) corpo.style.display = _horarioLivre.ativo ? 'block' : 'none';
        if (hint)  hint.style.display  = _horarioLivre.ativo ? 'none'  : 'block';
        _hlAtualizarWeekend();

        // Portal público com config do admin: somente informativo — bloqueia tudo
        if (_adminHL) {
          const card = document.getElementById('chl-card');
          if (card) {
            // Checkboxes: verdes quando marcados, esmaecidos quando desmarcados
            card.querySelectorAll('input[type="checkbox"]').forEach(el => {
              el.disabled = true;
              el.style.cursor = 'not-allowed';
              if (el.checked) {
                el.style.accentColor = '#22c55e';
                el.style.opacity = '1';
              } else {
                el.style.opacity = '0.35';
              }
            });
            // Inputs de horário: legíveis mas não editáveis
            card.querySelectorAll('input[type="time"]').forEach(el => {
              el.disabled = true;
              el.style.cursor = 'not-allowed';
              el.style.opacity = '0.75';
            });
            card.querySelectorAll('button').forEach(el => el.style.display = 'none');
          }
          if (hint) { hint.style.display = 'block'; hint.textContent = '⚙ Configurado pelo administrador.'; hint.style.color = 'var(--text-muted)'; }
        }
      }
    } catch (_) {}
  }

  function _hlLimparPadrao() {
    localStorage.removeItem(_LS_HL);
    _horarioLivre = { ativo: false, inicio: '09:00', fim: '18:00', dias: [1,2,3,4,5],
                      inicio_sab: '09:00', fim_sab: '18:00', inicio_dom: '09:00', fim_dom: '18:00' };
    const chk  = document.getElementById('chl-ativo');
    const ini  = document.getElementById('chl-ini');
    const fim  = document.getElementById('chl-fim');
    const iniS = document.getElementById('chl-ini-sab');
    const fimS = document.getElementById('chl-fim-sab');
    const iniD = document.getElementById('chl-ini-dom');
    const fimD = document.getElementById('chl-fim-dom');
    if (chk)  chk.checked = false;
    if (ini)  ini.value   = '09:00';
    if (fim)  fim.value   = '18:00';
    if (iniS) iniS.value  = '09:00';
    if (fimS) fimS.value  = '18:00';
    if (iniD) iniD.value  = '09:00';
    if (fimD) fimD.value  = '18:00';
    document.querySelectorAll('.chl-dia').forEach(cb => {
      cb.checked = [1,2,3,4,5].includes(parseInt(cb.dataset.dia));
    });
    _hlAtualizarWeekend();
    _hlToggle(false);
    _toast('Horário livre redefinido para o padrão.', 'success');
  }

  // ── Taxas: constantes e localStorage ────────────────────────────
  const _TAXA_IMP_DEF  = 18.65;
  const _TAXA_COND_DEF = 13.00;
  const _TAXA_GORD_DEF = 0;
  const _LS_IMP        = 'finops_taxa_imposto';
  const _LS_COND       = 'finops_taxa_cond';
  const _LS_GORD       = 'finops_taxa_gordura';
  const _LS_IMP_PAD    = 'finops_taxa_imposto_padrao';
  const _LS_COND_PAD   = 'finops_taxa_cond_padrao';
  const _LS_GORD_PAD   = 'finops_taxa_gordura_padrao';

  function _carregarTaxas() {
    let vi, vc, vg;
    const _adminImp  = _modoPublico && _defaultConfig && _defaultConfig.taxa_imposto != null;
    const _adminCond = _modoPublico && _defaultConfig && _defaultConfig.taxa_cond    != null;
    if (_modoPublico && _defaultConfig) {
      vi = _adminImp  ? parseFloat(_defaultConfig.taxa_imposto) : _TAXA_IMP_DEF;
      vc = _adminCond ? parseFloat(_defaultConfig.taxa_cond)    : _TAXA_COND_DEF;
      vg = 0;
    } else {
      const si = localStorage.getItem(_LS_IMP);
      const sc = localStorage.getItem(_LS_COND);
      const sg = localStorage.getItem(_LS_GORD);
      vi = si !== null ? parseFloat(si) : _TAXA_IMP_DEF;
      vc = sc !== null ? parseFloat(sc) : _TAXA_COND_DEF;
      vg = sg !== null ? parseFloat(sg) : _TAXA_GORD_DEF;
      if (si === null) localStorage.setItem(_LS_IMP,  vi);
      if (sc === null) localStorage.setItem(_LS_COND, vc);
      if (sg === null) localStorage.setItem(_LS_GORD, vg);
      if (!localStorage.getItem(_LS_IMP_PAD))  localStorage.setItem(_LS_IMP_PAD,  vi);
      if (!localStorage.getItem(_LS_COND_PAD)) localStorage.setItem(_LS_COND_PAD, vc);
      if (!localStorage.getItem(_LS_GORD_PAD)) localStorage.setItem(_LS_GORD_PAD, vg);
    }
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    const ig = document.getElementById('cgordura');
    if (ii) ii.value = vi;
    if (ic) ic.value = vc;
    if (ig) ig.value = vg;
    // Portal público: bloqueia campos configurados pelo admin
    if (_modoPublico) {
      const _lock = (el) => {
        if (!el) return;
        el.disabled = true;
        el.style.cursor  = 'not-allowed';
        el.style.opacity = '0.75';
        el.title = 'Configurado pelo administrador';
      };
      if (_adminImp)  _lock(ii);
      if (_adminCond) _lock(ic);
      // Gordura e botões: sempre ocultos no portal público
      const gordCol  = document.getElementById('cgordura-col');
      const taxaBtns = document.getElementById('ctaxas-btns');
      if (gordCol)  gordCol.style.display  = 'none';
      if (taxaBtns) taxaBtns.style.display = 'none';
    }
    _atualizarBadgesTaxas();
  }

  function _salvarTaxasPadrao() {
    const vi = parseFloat(document.getElementById('cimposto')?.value)    || 0;
    const vc = parseFloat(document.getElementById('ccondominио')?.value) || 0;
    const vg = parseFloat(document.getElementById('cgordura')?.value)    || 0;
    localStorage.setItem(_LS_IMP,      vi);
    localStorage.setItem(_LS_COND,     vc);
    localStorage.setItem(_LS_GORD,     vg);
    localStorage.setItem(_LS_IMP_PAD,  vi);
    localStorage.setItem(_LS_COND_PAD, vc);
    localStorage.setItem(_LS_GORD_PAD, vg);
    _atualizarBadgesTaxas();
    _toast('Padrão salvo: Imposto ' + vi + '% · Condomínio ' + vc + '% · Gordura ' + vg + '%', 'success');
  }

  function _resetarTaxas() {
    const vi = parseFloat(localStorage.getItem(_LS_IMP_PAD)  ?? _TAXA_IMP_DEF);
    const vc = parseFloat(localStorage.getItem(_LS_COND_PAD) ?? _TAXA_COND_DEF);
    const vg = parseFloat(localStorage.getItem(_LS_GORD_PAD) ?? _TAXA_GORD_DEF);
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    const ig = document.getElementById('cgordura');
    if (ii) ii.value = vi;
    if (ic) ic.value = vc;
    if (ig) ig.value = vg;
    localStorage.setItem(_LS_IMP,  vi);
    localStorage.setItem(_LS_COND, vc);
    localStorage.setItem(_LS_GORD, vg);
    _atualizarBadgesTaxas();
    _onAdicionaisChange();
    _toast('Restaurado: Imposto ' + vi + '% · Condomínio ' + vc + '% · Gordura ' + vg + '%');
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
    const info = document.getElementById('ctaxas-info');
    if (info) info.style.display = 'none';
  }

  let _taxaToastTimer = null;
  function _onAdicionaisChange() {
    const ii = document.getElementById('cimposto');
    const ic = document.getElementById('ccondominио');
    const ig = document.getElementById('cgordura');
    if (ii) localStorage.setItem(_LS_IMP,  ii.value);
    if (ic) localStorage.setItem(_LS_COND, ic.value);
    if (ig) localStorage.setItem(_LS_GORD, ig.value);
    _atualizarBadgesTaxas();
    _atualizarEstimativa();
    clearTimeout(_taxaToastTimer);
    _taxaToastTimer = setTimeout(() => {
      const vi = parseFloat(ii?.value) || 0;
      const vc = parseFloat(ic?.value) || 0;
      const vg = parseFloat(ig?.value) || 0;
      const pi = parseFloat(localStorage.getItem(_LS_IMP_PAD)  ?? _TAXA_IMP_DEF);
      const pc = parseFloat(localStorage.getItem(_LS_COND_PAD) ?? _TAXA_COND_DEF);
      const pg = parseFloat(localStorage.getItem(_LS_GORD_PAD) ?? _TAXA_GORD_DEF);
      const diff = Math.abs(vi-pi) >= 0.01 || Math.abs(vc-pc) >= 0.01 || Math.abs(vg-pg) >= 0.01;
      let msg = 'Taxas atualizadas: Imposto ' + vi + '% · Condomínio ' + vc + '% · Gordura ' + vg + '%';
      if (diff) msg += ' ⚠ Diferente do padrão salvo';
      _toast(msg, diff ? 'warn' : 'success');
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
      return '<div style="' + mono + 'font-size:11px;color:var(--blue,#4da6ff);white-space:nowrap;"' + moedaTip + '>' + _brl(preco) + '</div>'
           + '<div style="font-size:9px;color:var(--blue,#4da6ff);" title="Amortizado pelo term da reserva (1 ano=8.760h / 3 anos=26.280h)">🔒 amort./h</div>'
           + qLinha;
    }

    if (tipo === 'hora') {
      // RN-001: taxa horária real; prefere horas_reais (qty × fator do SQL)
      const uomFator   = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1);
      const h          = horasR > 0 ? Math.round(horasR) : Math.round(totalQty * uomFator);
      const qLinha     = _qLinha(h, 'h consumidas');
      // RN-007: RI/SP coberto — cost_in_billing=0; usa effective_price (amortizado)
      const taxaAmortH = parseFloat(r.taxa_hora_rate || 0) * convR;
      const precoEfet  = raw > 0 ? preco : (r.usa_amortizado && taxaAmortH > 0 ? taxaAmortH : preco);
      const amortBadge = r.usa_amortizado && raw === 0 && taxaAmortH > 0
        ? '<div style="font-size:9px;color:var(--blue,#4da6ff);margin-top:1px;white-space:nowrap;" title="Custo amortizado: VM coberta por Reserva ou Savings Plan — effective_price × qty ÷ qty = taxa real proporcional">⚡\xA0amort./h</div>'
        : '';
      // Badge 📅 30d: quando o período tem < 30 dias (taxa mais estável)
      const _30dBadgeH = r.usa_30d
        ? '<div style="font-size:9px;color:var(--blue,#4da6ff);margin-top:1px;white-space:nowrap;" title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">📅\xA030d</div>'
        : '';
      // RN-DB-001: contexto de cluster na tabela de billing (VMs em databricks-rg-*)
      const _dbCtxH   = _dbInfoParaRecurso(r);
      const _dbCtxVld = _dbCtxH && _dbCtxH.valida;
      const _billBrlH = isBRL ? parseFloat(r.total_billing || 0) : parseFloat(r.total_billing || 0) * convR;
      const _taxaClH  = _dbCtxVld ? _billBrlH / _dbCtxH.hDriver : 0;
      const clusterLinha = _dbCtxVld
        ? '<div style="font-size:9px;color:var(--blue,#4da6ff);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(77,166,255,.15);padding-top:2px;" title="Taxa proporcional do workspace: billing_vm \xF7 H_driver = contribui\xE7\xE3o desta VM ao custo/h do cluster">'
          + '⚡\xA0cluster:\xA0' + _brl(_taxaClH) + '/h</div>'
        : '';
      // Label de sublinha: DBU-Hour mostra ⚡ /DBU·h; VM normal mostra /h cobrado
      const horaSubLabel = uom.includes('dbu')
        ? '<div style="font-size:9px;color:var(--blue,#4da6ff);">⚡\xA0/DBU\xB7h</div>'
        : '<div style="font-size:9px;color:var(--text-muted);">/h cobrado</div>';
      return '<div style="' + mono + 'font-size:11px;color:var(--accent);white-space:nowrap;"' + moedaTip + '>' + _brl(precoEfet) + '</div>'
           + horaSubLabel
           + amortBadge
           + _30dBadgeH
           + clusterLinha
           + qLinha;
    }

    if (tipo === 'dia') {
      // RN-003: UoM diária convertida para hora
      const qLinha     = _qLinha(totalQty, 'dias');
      const _30dBadgeD = r.usa_30d
        ? '<div style="font-size:9px;color:var(--blue,#4da6ff);margin-top:1px;white-space:nowrap;" title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">📅\xA030d</div>'
        : '';
      return '<div style="' + mono + 'font-size:11px;color:var(--accent);white-space:nowrap;"' + moedaTip + '>' + _brl(preco) + '</div>'
           + '<div style="font-size:9px;color:var(--text-muted);" title="UoM diária ÷ 24">/h (dia)</div>'
           + _30dBadgeD
           + qLinha;
    }

    // Databricks DBU software — R$/DBU como taxa principal (Cost ÷ Qty)
    // UoM "1 DBU": tipo='periodo'; R$/DBU é a taxa auditável (Cost÷Qty da RN-006)
    if (uom.includes('dbu')) {
      const custo_uom_raw = parseFloat(r.custo_uom_billing || 0);
      const custo_uom_brl = isBRL ? custo_uom_raw : custo_uom_raw * convR;
      const qLinha = _qLinha(totalQty, 'DBUs', 'var(--blue,#4da6ff)');
      return '<div style="' + mono + 'font-size:11px;color:var(--blue,#4da6ff);white-space:nowrap;"' + moedaTip + '>'
           + (custo_uom_brl > 0 ? _brl(custo_uom_brl) : '—') + '</div>'
           + '<div style="font-size:9px;color:var(--blue,#4da6ff);">⚡\xA0/DBU cobrado</div>'
           + qLinha;
    }

    // RN-004: Storage, Bandwidth, Functions — custo DIÁRIO (custo_mes ÷ 30)
    const _diasC   = parseInt(r.dias_ativos || 1) || 1;
    const mesRaw   = parseFloat(r.custo_mes_billing) ||
                     (parseFloat(r.total_billing || 0) / _diasC * 30);
    const mesBrl   = isBRL ? mesRaw : mesRaw * convR;
    const custoDia = mesBrl / 730;
    // Remove o prefixo "1 " do UoM para exibir só a unidade: "1 GB" → "GB", "1 Unit" → "Unit"
    const uomLabel = (r.unidade || '').replace(/^\d+\s+/, '').trim() || 'un.';
    const qLinha   = _qLinha(totalQty, _esc(uomLabel), 'var(--orange,#ff8c42)');
    // RN-006: Cost ÷ Qty = taxa audível por unidade nativa (regra de negócio FinOps)
    const custo_uom_raw = parseFloat(r.custo_uom_billing || 0);
    const custo_uom_brl = isBRL ? custo_uom_raw : custo_uom_raw * convR;
    const uomRateLinha  = custo_uom_brl > 0
      ? '<div style="font-size:9px;color:var(--orange,#ff8c42);margin-top:2px;white-space:nowrap;border-top:1px solid rgba(255,140,66,.15);padding-top:2px;" title="Cost \xF7 Qty: taxa real por unidade de medida — valor infalível para auditar a fatura">'
        + _brl(custo_uom_brl) + '\xA0/\xA0' + _esc(uomLabel) + '</div>'
      : '';
    const _30dBadgePer = r.usa_30d
      ? '<div style="font-size:9px;color:var(--blue,#4da6ff);margin-top:1px;white-space:nowrap;" title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">📅\xA030d</div>'
      : '';
    return '<div style="' + mono + 'font-size:11px;color:var(--orange,#ff8c42);white-space:nowrap;"' + moedaTip + '>' + _brl(custoDia) + '</div>'
         + '<div style="font-size:9px;color:var(--orange,#ff8c42);" title="Cobrado por consumo (GB, Req…) — custo di\xE1rio = custo mensal \xF7 30">/dia cobrado</div>'
         + _30dBadgePer
         + uomRateLinha
         + qLinha;
  }

  return { init, onSubChange, onRgChange, onFiltroChange, onTaxaChange, onBusca, buscarRecursos,
           selecionarTodos, deselecionarTodos, aplicarHorasGlobal, calcular,
           _check, _checkAll, _checkGrupo, _toggleGrupo, _horasChange, _setH, _onSlider, _onHorasInput,
           _toggleDropdown, _toggleOpcao, _filtrarDropdown,
           _selecionarTodosDropdown, _limparDropdown, _confirmarSub, _confirmarRg, _atualizarBotaoBuscar,
           _onAdicionaisChange, _salvarTaxasPadrao, _resetarTaxas,
           _setModoHoras, _calcHorasPeriodo, _sincDataFim, _sincHoraFim, _incluirPeriodo, _removerPeriodo,
           abrirPurge, fecharPurge, executarPurge, verificarPurge, _purgeOnModo,
           abrirReconciliacao, fecharReconciliacao, _onAzureRefInput,
           abrirDiagnostico, fecharDiagnostico, _diagFiltrar,
           _diagCache, _forcarRefreshCache,
           _hlToggle, _hlChange, _hlSalvarPadrao, _hlLimparPadrao,
           abrirInvoice, fecharInvoice, gerarInvoicePDF, gerarPDFSalvo,
           fecharPreviewModal, voltarParaConfirmacao, imprimirEstimativa,
           _abrirConfigStep, _fecharConfigStep, _ovAplicarHoras, _ovImpostoChange, _ovCondChange,
           _ovGerarEstimativa, _ovCarregarMais,
           _switchVisao, _toggleDetalhe,
           _toggleTipo, _diagOutros };
})();
