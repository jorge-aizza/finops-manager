// ──────────────────────────────────────────────
// FinOps Manager — Frontend App
// Connects to Express API (server.js on port 3000)
// ──────────────────────────────────────────────

// Detects server URL automatically — works from any device on the network
const API = window.location.origin + '/api';
let currentUser = null;

// ── SETUP WIZARD ──────────────────────────────
async function checkFirstRun() {
  try {
    const r = await fetch(API + '/setup/status').then(res => res.json());
    if (!r.configured) {
      document.getElementById('setup-wizard').style.display = 'flex';
      document.getElementById('login-screen').style.display  = 'none';
    }
  } catch {
    // Server unreachable — show login anyway
  }
}

function swGoStep(n) {
  [1,2,3].forEach(i => {
    document.getElementById('setup-step-' + i).style.display = i === n ? '' : 'none';
    const ind = document.getElementById('step-ind-' + i);
    ind.classList.remove('active','done');
    if (i === n)  ind.classList.add('active');
    if (i < n)    ind.classList.add('done');
  });
}

function swNextStep(n) {
  const btnNext = document.getElementById('sw-btn-proximo');
  if (n === 2 && btnNext && btnNext.disabled) {
    showToast('Teste a conexão antes de continuar', 'error');
    return;
  }
  swGoStep(n);
}

function swOnDbTipoChange() {
  const portas = { postgresql:5432, sqlserver:1433, mysql:3306, 'aws-rds-pg':5432, 'aws-rds-mysql':3306, 'aws-aurora':3306, 'azure-pg':5432, 'azure-sql':1433, 'gcp-pg':5432, 'gcp-mysql':3306, 'oracle-atp':1521 };
  const tipo = document.getElementById('sw-db-tipo').value;
  if (portas[tipo]) document.getElementById('sw-db-porta').value = portas[tipo];
  const isCloud = tipo.includes('aws') || tipo.includes('azure') || tipo.includes('gcp') || tipo.includes('oracle-a');
  document.getElementById('sw-db-ssl').checked = isCloud;
}

async function swTestarConexao() {
  const resultEl = document.getElementById('sw-db-test-result');
  const hintEl   = document.getElementById('sw-db-hint');
  const btnNext  = document.getElementById('sw-btn-proximo');

  const host     = document.getElementById('sw-db-host').value.trim();
  const porta    = parseInt(document.getElementById('sw-db-porta').value);
  const database = document.getElementById('sw-db-database').value.trim();
  const usuario  = document.getElementById('sw-db-usuario').value.trim();
  const senha    = document.getElementById('sw-db-senha').value;
  const tipo     = document.getElementById('sw-db-tipo').value;

  // Reset state
  hintEl.style.display = 'none';
  hintEl.className = 'sw-hint';
  btnNext.disabled = true;
  btnNext.style.opacity = '.4';
  btnNext.style.cursor = 'not-allowed';

  if (!host || !porta || !database || !usuario || !senha || !tipo) {
    resultEl.style.color = '#f9e2af';
    resultEl.textContent = '⚠️ Preencha todos os campos antes de testar.';
    resultEl.style.display = 'block';
    return;
  }

  resultEl.style.color = 'var(--text-muted,#6c7086)';
  resultEl.textContent = '🔄 Testando conexão...';
  resultEl.style.display = 'block';

  try {
    const r = await fetch(API + '/setup/test-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, host, porta, database, usuario, senha, ssl: document.getElementById('sw-db-ssl').checked })
    }).then(res => res.json());

    if (r.ok) {
      // SUCCESS
      resultEl.style.color = '#a6e3a1';
      resultEl.textContent = '✅ Conexão bem-sucedida! Latência: ' + (r.latency || '—') + 'ms';
      hintEl.className = 'sw-hint sw-hint-ok';
      hintEl.innerHTML = '✅ <strong>Tudo certo!</strong> O banco de dados está acessível e pronto. Clique em <strong>Próximo</strong> para continuar.';
      hintEl.style.display = 'block';
      // ENABLE next button
      btnNext.disabled = false;
      btnNext.style.opacity = '1';
      btnNext.style.cursor = 'pointer';
    } else {
      throw new Error(r.error || 'Erro desconhecido');
    }
  } catch (e) {
    const msg = e.message || '';
    resultEl.style.color = '#f38ba8';
    resultEl.textContent = '❌ Falha: ' + msg;

    // Smart hints based on error type
    hintEl.style.display = 'block';

    if (msg.includes('does not exist') || msg.includes('database')) {
      const dbName = database;
      hintEl.className = 'sw-hint sw-hint-warn';
      hintEl.innerHTML =
        '⚠️ <strong>Banco de dados não encontrado.</strong><br>' +
        'O banco <code>' + dbName + '</code> ainda não existe. Crie-o antes de continuar.<br><br>' +
        '📋 <strong>Como criar:</strong><br>' +
        '1. Abra o <strong>pgAdmin</strong> ou <strong>psql</strong><br>' +
        '2. Execute o comando abaixo e tente novamente:<br><br>' +
        '<code>CREATE DATABASE ' + dbName + ';</code>';
    } else if (msg.includes('password authentication') || msg.includes('authentication failed')) {
      hintEl.className = 'sw-hint sw-hint-warn';
      hintEl.innerHTML =
        '⚠️ <strong>Senha incorreta.</strong><br>' +
        'Verifique o usuário <code>' + usuario + '</code> e a senha informada.<br><br>' +
        '📋 Para redefinir a senha no pgAdmin:<br>' +
        'Clique com botão direito no usuário → <em>Properties</em> → <em>Definition</em> → altere a senha.';
    } else if (msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED')) {
      hintEl.className = 'sw-hint sw-hint-err';
      hintEl.innerHTML =
        '🔴 <strong>Servidor de banco inacessível.</strong><br>' +
        'Não foi possível conectar em <code>' + host + ':' + porta + '</code>.<br><br>' +
        '📋 Verifique se:<br>' +
        '• O PostgreSQL está instalado e rodando<br>' +
        '• O host e porta estão corretos<br>' +
        '• O firewall não está bloqueando a porta <code>' + porta + '</code>';
    } else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      hintEl.className = 'sw-hint sw-hint-err';
      hintEl.innerHTML =
        '🔴 <strong>Host não encontrado.</strong><br>' +
        '<code>' + host + '</code> não pôde ser resolvido.<br><br>' +
        '📋 Use <code>localhost</code> para banco local ou verifique o endpoint correto.';
    } else if (msg.includes('role') || msg.includes('user')) {
      hintEl.className = 'sw-hint sw-hint-warn';
      hintEl.innerHTML =
        '⚠️ <strong>Usuário não encontrado.</strong><br>' +
        'O usuário <code>' + usuario + '</code> não existe no banco.<br><br>' +
        '📋 Para criar via psql:<br>' +
        '<code>CREATE USER ' + usuario + ' WITH PASSWORD [sua_senha];</code><br>' +
        '<code>GRANT ALL PRIVILEGES ON DATABASE ' + database + ' TO ' + usuario + ';</code>';
    } else {
      hintEl.className = 'sw-hint sw-hint-err';
      hintEl.innerHTML = '🔴 <strong>Erro:</strong> ' + msg + '<br><br>Verifique as configurações e tente novamente.';
    }
  }
}

async function swFinish() {
  const nome   = document.getElementById('sw-admin-nome').value.trim();
  const email  = document.getElementById('sw-admin-email').value.trim();
  const senha  = document.getElementById('sw-admin-senha').value;
  const senha2 = document.getElementById('sw-admin-senha2').value;
  const errEl  = document.getElementById('sw-admin-error');
  errEl.style.display = 'none';

  if (!nome || !email || !senha) { errEl.textContent = 'Preencha todos os campos.'; errEl.style.display='block'; return; }
  if (senha.length < 8) { errEl.textContent = 'Senha deve ter no mínimo 8 caracteres.'; errEl.style.display='block'; return; }
  if (senha !== senha2) { errEl.textContent = 'As senhas não coincidem.'; errEl.style.display='block'; return; }

  const dbConfig = {
    tipo:     document.getElementById('sw-db-tipo').value,
    host:     document.getElementById('sw-db-host').value.trim(),
    porta:    parseInt(document.getElementById('sw-db-porta').value),
    database: document.getElementById('sw-db-database').value.trim(),
    schema:   document.getElementById('sw-db-schema').value.trim() || 'public',
    usuario:  document.getElementById('sw-db-usuario').value.trim(),
    senha:    document.getElementById('sw-db-senha').value,
    ssl:      document.getElementById('sw-db-ssl').checked
  };

  try {
    const r = await fetch(API + '/setup/complete', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ dbConfig, admin: { nome, email, senha } })
    }).then(res => res.json());

    if (r.error) { errEl.textContent = r.error; errEl.style.display='block'; return; }

    document.getElementById('sw-summary').innerHTML =
      '<b>Banco:</b> ' + dbConfig.tipo + ' · ' + dbConfig.host + ':' + dbConfig.porta + '/' + dbConfig.database + '<br>' +
      '<b>Admin:</b> ' + nome + ' &lt;' + email + '&gt;';

    swGoStep(3);
  } catch(e) {
    errEl.textContent = 'Erro ao configurar: ' + e.message;
    errEl.style.display = 'block';
  }
}

function swGoLogin() {
  document.getElementById('setup-wizard').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// ── AUTH ──────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const errEl = document.getElementById('login-error');
  errEl.style.background = ''; errEl.style.borderColor = ''; errEl.style.color = '';

  if (!email || !senha) {
    showLoginError('Preencha e-mail e senha.'); return;
  }
  try {
    const data = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    }).then(r => r.json());

    if (data.error) { showLoginError(data.error); return; }
    sessionStorage.setItem('finops_token', data.token);
    sessionStorage.setItem('finops_session', JSON.stringify(data.user));
    localStorage.setItem('finops_token', data.token);
    localStorage.setItem('finops_session', JSON.stringify(data.user));
    // Garante tema escuro como padrão ao logar
    localStorage.removeItem('finops-theme');
    document.documentElement.removeAttribute('data-theme');
    currentUser = data.user;
    enterApp();
  } catch (e) {
    showLoginError('Erro ao conectar com o servidor. Verifique se o servidor está rodando.');
  }
}

async function loginSSO(type) {
  const errEl = document.getElementById('login-error');
  if (type === 'entra') {
    try {
      const data = await fetch(API + '/auth/entra/url').then(r => r.json());
      if (data.url) { window.location.href = data.url; }
      else showLoginInfo('Integração Entra ID não configurada. Configure no painel ⚙️ após o login.');
    } catch { showLoginInfo('Servidor indisponível para SSO Entra ID.'); }
  } else {
    showLoginInfo('Login via Active Directory: use seu e-mail corporativo e senha de rede no formulário acima. O sistema detectará automaticamente o AD.');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.background = 'rgba(243,139,168,.12)';
  el.style.borderColor = 'rgba(243,139,168,.3)';
  el.style.color = '#f38ba8';
  el.style.display = 'block';
}

function showLoginInfo(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.background = 'rgba(137,180,250,.1)';
  el.style.borderColor = 'rgba(137,180,250,.3)';
  el.style.color = '#89b4fa';
  el.style.display = 'block';
}


// loginSSO — implementado pela função async acima (linha 231)

function updateSidebarUser() {
  if (!currentUser) return;
  const el = document.getElementById('sidebar-user-info');
  if (!el) return;
  const roleMap = { admin: 'Administrador', finops: 'Usuário FinOps', reader: 'Reader' };
  const initials = (currentUser.nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('sidebar-user-avatar').textContent = initials;
  document.getElementById('sidebar-user-name').textContent = currentUser.nome || currentUser.email || '';
  document.getElementById('sidebar-user-role').textContent = roleMap[currentUser.perfil] || currentUser.perfil || '';
  el.style.display = 'block';
}

function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  const fab = document.getElementById('refresh-fab');
  if (fab) fab.style.display = 'flex';
  updateSidebarUser();
  checkDbStatus();
  loadDashboard();
  clearInterval(_dbStatusInterval);
  _dbStatusInterval = setInterval(checkDbStatus, 30000);
  setTimeout(() => setRefreshInterval(10), 600); // auto 10 min refresh
  startInactivityTimer();
  // Notificações: carrega imediatamente e depois a cada 5 min
  loadNotificacoes();
  clearInterval(_notifInterval);
  _notifInterval = setInterval(loadNotificacoes, 5 * 60 * 1000);
  // Popup de alertas de reservas — exibe uma vez por sessão se houver vencimentos ≤ 90 dias
  setTimeout(checkRsvAlertsPopup, 1200);
  // Restaura painel de importação se sessão anterior foi encerrada durante/após import
  setTimeout(checkPendingImportStatus, 1500);
  // Fecha painel ao clicar fora
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notif-wrapper');
    if (wrapper && !wrapper.contains(e.target)) closeNotifPanel();
  });

  // Close rsv cms dropdowns on outside click
  document.addEventListener('click', (e) => {
    for (const type of ['sub', 'rg']) {
      const wrap = document.getElementById(`rsv-${type}-wrap`);
      if (wrap && !wrap.contains(e.target)) {
        const drop    = document.getElementById(`rsv-${type}-drop`);
        const trigger = document.getElementById(`rsv-${type}-trigger`);
        if (drop)    drop.style.display = 'none';
        if (trigger) trigger.classList.remove('cms-active');
      }
    }
  });
}

// ── NOTIFICAÇÕES ──────────────────────────────
async function loadNotificacoes() {
  try {
    const notifs = await api('GET', '/notificacoes');
    const badge  = document.getElementById('notif-badge');
    const list   = document.getElementById('notif-list');
    const header = document.getElementById('notif-header-count');
    if (!badge || !list) return;

    if (!notifs.length) {
      badge.style.display = 'none';
      list.innerHTML = `<div style="padding:28px 16px;text-align:center;color:var(--text-muted);font-size:13px">
        <div style="font-size:26px;margin-bottom:8px">✅</div>
        Nenhuma ação com prazo pendente
      </div>`;
      header.textContent = '';
      return;
    }

    const vencidas = notifs.filter(n => n.tipo === 'vencido');
    const urgentes = notifs.filter(n => n.tipo !== 'vencido');
    badge.style.display = 'flex';
    badge.textContent = notifs.length;
    header.textContent = `${notifs.length} pendente${notifs.length !== 1 ? 's' : ''}`;

    const iconMap = {
      vencido: { icon:'⚠',  bg:'rgba(243,139,168,0.12)', color:'#f38ba8', border:'rgba(243,139,168,0.25)' },
      hoje:    { icon:'🔴', bg:'rgba(243,139,168,0.08)', color:'#f38ba8', border:'rgba(243,139,168,0.2)'  },
      urgente: { icon:'🟡', bg:'rgba(249,226,175,0.08)', color:'#f9e2af', border:'rgba(249,226,175,0.2)'  },
      reserva: { icon:'🔖', bg:'rgba(147,51,234,0.08)',  color:'#c084fc', border:'rgba(147,51,234,0.25)'  },
    };

    list.innerHTML = notifs.map(n => {
      const s = iconMap[n.tipo] || iconMap.urgente;
      const isReserva = n._kind === 'reserva';
      const onclick = isReserva
        ? `showView('reservas');closeNotifPanel()`
        : `viewAcao(${n.id});closeNotifPanel()`;
      const dataLabel = isReserva ? formatDate(n.data_vencimento) : formatDate(n.data_conclusao);
      const sub = isReserva
        ? `${escHtml(n.id_finops)}`
        : `${escHtml(n.id_finops)} · ${escHtml(n.projeto_nome || '—')}`;
      return `<div onclick="${onclick}" style="display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;background:${s.bg}" onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter=''">
        <div style="width:34px;height:34px;border-radius:8px;border:1px solid ${s.border};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">${s.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:${s.color};margin-bottom:2px">${escHtml(n.mensagem)}</div>
          <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(n.acao)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sub}</div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);white-space:nowrap;padding-top:2px">${dataLabel}</div>
      </div>`;
    }).join('');

  } catch (e) { console.warn('Erro ao carregar notificações:', e.message); }
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}
function closeNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
}

// ── ALERTAS DE RESERVAS (popup pós-login) ─────
async function checkRsvAlertsPopup() {
  try {
    const data = await api('GET', '/reservas?status=Ativa');
    const today = new Date(); today.setHours(0,0,0,0);
    const alerts = (data || []).filter(r => {
      if (!r.data_vencimento) return false;
      const venc = new Date(r.data_vencimento);
      const diff = Math.ceil((venc - today) / 86400000);
      return diff <= 90;
    }).sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    if (alerts.length === 0) return;
    _showRsvAlertsModal(alerts);
  } catch(e) {
    console.warn('Alertas de reservas:', e);
  }
}

function _showRsvAlertsModal(alerts) {
  const today = new Date(); today.setHours(0,0,0,0);
  const expired  = alerts.filter(r => Math.ceil((new Date(r.data_vencimento) - today) / 86400000) < 0).length;
  const critical = alerts.filter(r => { const d = Math.ceil((new Date(r.data_vencimento) - today) / 86400000); return d >= 0 && d <= 30; }).length;

  const summary = document.getElementById('rsv-alerts-summary');
  if (summary) {
    const parts = [];
    if (expired)  parts.push(`<span style="color:var(--red);font-weight:600">${expired} expirada${expired>1?'s':''}</span>`);
    if (critical) parts.push(`<span style="color:var(--orange);font-weight:600">${critical} crítica${critical>1?'s':''} (≤ 30 dias)</span>`);
    const rest = alerts.length - expired - critical;
    if (rest) parts.push(`<span style="color:var(--text-dim)">${rest} com vencimento em até 90 dias</span>`);
    summary.innerHTML = parts.join(' · ');
  }

  const tbody = document.getElementById('rsv-alerts-tbody');
  if (tbody) {
    tbody.innerHTML = alerts.map(r => {
      const venc = new Date(r.data_vencimento);
      const diff = Math.ceil((venc - today) / 86400000);
      let badge, color;
      if (diff < 0)        { badge = 'Expirada';          color = 'var(--red)'; }
      else if (diff <= 30) { badge = `${diff}d – Crítico`; color = 'var(--orange)'; }
      else if (diff <= 60) { badge = `${diff}d – Atenção`; color = '#f5c518'; }
      else                 { badge = `${diff}d – Aviso`;   color = 'var(--blue)'; }
      const dateStr = venc.toLocaleDateString('pt-BR');
      const odd = alerts.indexOf(r) % 2 === 1 ? 'background:rgba(147,51,234,.04)' : '';
      return `<tr style="${odd}">
        <td style="padding:8px 12px;color:var(--text)">${escHtml(r.nome_reserva)}</td>
        <td style="padding:8px 12px;color:var(--text-dim)">${escHtml(r.cloud)}</td>
        <td style="padding:8px 12px;color:var(--text-dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.tipo_recurso||'—')}</td>
        <td style="padding:8px 12px;color:var(--text-dim);white-space:nowrap">${dateStr}</td>
        <td style="padding:8px 12px;text-align:center">
          <span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;color:${color};background:${color}22;white-space:nowrap">${badge}</span>
        </td>
      </tr>`;
    }).join('');
  }

  document.getElementById('modal-rsv-alerts').classList.add('open');
}

// ── TEMA CLARO / ESCURO ───────────────────────
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('finops-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('finops-theme', 'light');
  }
  _syncThemeIcon();
}

function _syncThemeIcon() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const sun  = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  const btn  = document.getElementById('btn-theme-toggle');
  if (sun)  sun.style.display  = isLight ? 'none'  : '';
  if (moon) moon.style.display = isLight ? ''      : 'none';
  if (btn)  btn.title = isLight ? 'Modo escuro' : 'Modo claro';
}

// Sincroniza ícone ao carregar (tema pode ter sido lido do localStorage)
document.addEventListener('DOMContentLoaded', _syncThemeIcon);

function logout() {
  if (!confirm('Deseja sair do sistema?')) return;
  sessionStorage.removeItem('finops_session');
  sessionStorage.removeItem('finops_token');
  localStorage.removeItem('finops_session');
  localStorage.removeItem('finops_token');
  currentUser = null;
  clearInterval(_refreshTimer);
  clearInterval(_countdownTimer);
  clearInterval(_dbStatusInterval);
  clearInterval(_notifInterval);
  const fab = document.getElementById('refresh-fab');
  if (fab) fab.style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-error').style.display = 'none';
}
let currentView = 'dashboard';
let allAcoes = [];

// ── VIEW ROUTING ──────────────────────────────
function showView(view) {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  const _hb = document.getElementById('btn-menu');
  if (_hb) { _hb.classList.remove('open'); _hb.setAttribute('aria-expanded','false'); _hb.setAttribute('aria-label','Abrir menu'); }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-group-header').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  const _navEl = document.querySelector(`[data-view="${view}"]`);
  if (_navEl) {
    _navEl.classList.add('active');
    const _grp = _navEl.closest('.nav-group');
    if (_grp) _grp.classList.add('open');
  }
  currentView = view;

  const titles = { dashboard: 'Dashboard', projetos: 'Projetos', acoes: 'Ações FinOps', calculadora: 'Calculadora Azure', estimativas: 'Estimativas', reservas: 'Reservas Cloud', coleta: 'Coleta Azure' };
  document.getElementById('page-title').textContent = titles[view] || view;

  const btn = document.getElementById('top-action-btn');
  const btnImport = document.getElementById('btn-import-projetos');
  btn.style.display = (['dashboard', 'calculadora', 'estimativas', 'coleta'].includes(view)) ? 'none' : 'flex';
  btnImport.style.display = (view === 'projetos') ? 'flex' : 'none';
  btn.textContent = '';
  if (!['dashboard', 'estimativas'].includes(view)) {
    const labels = { projetos: 'Novo Projeto', acoes: 'Nova Ação', reservas: 'Nova Reserva' };
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${labels[view] || 'Novo'}`;
    if (view === 'reservas') btn.setAttribute('onclick', 'openReservaModal()');
    else btn.setAttribute('onclick', 'openModal()');
  }

  if (view === 'dashboard') loadDashboard();
  if (view === 'projetos') loadProjetos();
  if (view === 'acoes') loadAcoes();
  if (view === 'calculadora' && typeof Calculadora !== 'undefined') Calculadora.init();
  if (view === 'estimativas') loadEstimativas();
  if (view === 'reservas') loadReservas();
  if (view === 'coleta') loadColeta();
}

function openModal() {
  if (currentView === 'projetos') openProjetoModal();
  else if (currentView === 'acoes') openAcaoModal();
}

// ── API HELPER ────────────────────────────────
async function api(method, path, body, timeoutMs = 30000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, {
      method, headers, signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined
    });
    clearTimeout(timer);
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Servidor não respondeu em ' + (timeoutMs / 1000) + 's — verifique se o servidor está rodando');
    throw e;
  }
}

// ── DB STATUS ─────────────────────────────────
async function checkDbStatus() {
  try {
    await api('GET', '/health');
    document.getElementById('db-dot').className = 'db-dot connected';
    document.getElementById('db-status-text').textContent = 'PostgreSQL';
  } catch {
    document.getElementById('db-dot').className = 'db-dot error';
    document.getElementById('db-status-text').textContent = 'Desconectado';
  }
}

// ── DASHBOARD ─────────────────────────────────
async function loadDashboard() {
  try {
    const [acoes, projetos, estimativas] = await Promise.all([
      api('GET', '/acoes'),
      api('GET', '/projetos'),
      api('GET', '/estimativas').catch(() => [])
    ]);

    // Always update global allAcoes so cloud filter has fresh data
    allAcoes = acoes;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Ações atrasadas: tem data_conclusao, não está Concluído/Cancelado, e data já passou
    const atrasadas = acoes.filter(a => {
      if (!a.data_conclusao) return false;
      if (a.status === 'Concluído' || a.status === 'Cancelado') return false;
      return new Date(a.data_conclusao) < hoje;
    });

    document.getElementById('stat-total').textContent = acoes.length;
    document.getElementById('stat-andamento').textContent =
      acoes.filter(a => a.status === 'Em Andamento').length;
    document.getElementById('stat-concluidas').textContent =
      acoes.filter(a => a.status === 'Concluído').length;
    document.getElementById('stat-atrasadas').textContent = atrasadas.length;

    // Retorno Ano Atual segmentado por status
    const retornoConcluido  = acoes.filter(a => a.status === 'Concluído')
      .reduce((sum, a) => sum + parseFloat(a.retorno_ano_atual || 0), 0);
    const retornoAndamento  = acoes.filter(a => a.status === 'Em Andamento')
      .reduce((sum, a) => sum + parseFloat(a.retorno_ano_atual || 0), 0);
    const retornoPlanejado  = acoes.filter(a => a.status === 'Planejado')
      .reduce((sum, a) => sum + parseFloat(a.retorno_ano_atual || 0), 0);
    const totalRetornoProx  = acoes.reduce((sum, a) => sum + parseFloat(a.retorno_proximo_ano || 0), 0);

    document.getElementById('stat-retorno').textContent           = formatCurrency(retornoConcluido);
    document.getElementById('stat-retorno-andamento').textContent = formatCurrency(retornoAndamento);
    document.getElementById('stat-retorno-planejado').textContent = formatCurrency(retornoPlanejado);
    document.getElementById('stat-retorno-prox').textContent      = formatCurrency(totalRetornoProx);

    // Recent actions — excluir atrasadas (elas aparecem apenas no painel de prazo vencido)
    const acoesRecentes = acoes.filter(a =>
      ['Em Andamento', 'Planejado', 'Concluído'].includes(a.status) && !isAtrasada(a)
    );
    const list = document.getElementById('dashboard-acoes-list');
    document.getElementById('recentes-count').textContent = acoesRecentes.length;
    if (!acoesRecentes.length) {
      list.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma ação em andamento, planejada ou concluída</td></tr>';
    } else {
      list.innerHTML = acoesRecentes.map(a => `
        <tr data-cloud="${escHtml(a.cloud || '')}">
          <td><span class="finops-id">${escHtml(a.id_finops)}</span></td>
          <td><strong>${escHtml(a.acao)}</strong></td>
          <td>${escHtml(a.responsavel || '—')}</td>
          <td>${escHtml(a.projeto_nome || '—')}</td>
          <td><span class="cloud-tag">${escHtml(a.cloud || '—')}</span></td>
          <td><span class="status-badge ${statusClass(a.status)}">${a.status}</span></td>
          <td style="color:var(--text-muted)">${a.data_conclusao ? formatDate(a.data_conclusao) : '—'}</td>
          <td>
            <button class="btn-icon" onclick="viewAcao(${a.id})" title="Ver detalhes">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </td>
        </tr>`).join('');
    }

    // ── Estimativas: Aprovadas / Não Aprovadas ──
    const estAprov    = estimativas.filter(e => e.status === 'Aprovado');
    const estNaoAprov = estimativas.filter(e => e.status === 'Nao Aprovado');
    const estPend     = estimativas.filter(e => e.status === 'Pendente');
    const somaAprov    = estAprov.reduce((s, e) => s + parseFloat(e.total_final || 0), 0);
    const somaNaoAprov = estNaoAprov.reduce((s, e) => s + parseFloat(e.total_final || 0), 0);
    const somaPend     = estPend.reduce((s, e) => s + parseFloat(e.total_final || 0), 0);

    function _estGroupProjeto(lista) {
      const m = {};
      lista.forEach(e => {
        const k = e.projeto_nome || 'Sem Projeto';
        m[k] = (m[k] || 0) + parseFloat(e.total_final || 0);
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    }
    function _renderEstProjetos(grupos) {
      if (!grupos.length) return '<span style="font-size:11px;color:var(--text-muted)">Nenhuma estimativa</span>';
      return grupos.map(([nome, val]) =>
        `<div class="est-dash-proj-row">
          <span class="est-dash-proj-nome">${escHtml(nome)}</span>
          <span class="est-dash-proj-val">${formatCurrency(val)}</span>
        </div>`
      ).join('');
    }

    const elAprovVal   = document.getElementById('est-dash-aprov-valor');
    const elAprovCnt   = document.getElementById('est-dash-aprov-count');
    const elAprovProj  = document.getElementById('est-dash-aprov-projetos');
    const elNaoVal     = document.getElementById('est-dash-nao-aprov-valor');
    const elNaoCnt     = document.getElementById('est-dash-nao-aprov-count');
    const elNaoProj    = document.getElementById('est-dash-nao-aprov-projetos');

    if (elAprovVal) {
      elAprovVal.textContent  = formatCurrency(somaAprov);
      elAprovCnt.textContent  = `${estAprov.length} estimativa${estAprov.length !== 1 ? 's' : ''}`;
      elAprovProj.innerHTML   = _renderEstProjetos(_estGroupProjeto(estAprov));
      elNaoVal.textContent    = formatCurrency(somaNaoAprov);
      elNaoCnt.textContent    = `${estNaoAprov.length} estimativa${estNaoAprov.length !== 1 ? 's' : ''}`;
      elNaoProj.innerHTML     = _renderEstProjetos(_estGroupProjeto(estNaoAprov));
    }
    const elPendVal = document.getElementById('est-dash-pend-valor');
    const elPendCnt = document.getElementById('est-dash-pend-count');
    if (elPendVal) {
      elPendVal.textContent = formatCurrency(somaPend);
      elPendCnt.textContent = `${estPend.length} estimativa${estPend.length !== 1 ? 's' : ''}`;
    }

    // Cloud breakdown
    const cloudIcons = {
      'AWS': `<svg viewBox="0 0 40 24" width="40" height="24" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.6 10.9c0 .4.1.7.2 1 .1.2.3.5.5.7.1.1.1.2.1.3 0 .1-.1.2-.2.3l-.7.5c-.1.1-.2.1-.3.1-.1 0-.2-.1-.3-.2-.2-.2-.3-.4-.5-.6-.1-.2-.3-.5-.4-.8-1 1.2-2.3 1.7-3.8 1.7-1.1 0-2-.3-2.6-.9-.6-.6-1-1.4-1-2.4 0-1.1.4-1.9 1.1-2.6.7-.6 1.7-.9 2.9-.9.4 0 .8 0 1.3.1.4.1.9.2 1.4.3v-1c0-1-.2-1.7-.6-2.1-.4-.4-1.1-.6-2-.6-.4 0-.9.1-1.3.2-.4.1-.9.3-1.3.5-.2.1-.3.1-.4.1-.1 0-.2-.1-.2-.3V4.3c0-.1 0-.2.1-.3.1-.1.2-.1.3-.2.4-.2.9-.4 1.5-.5.6-.1 1.2-.2 1.8-.2 1.4 0 2.4.3 3 1 .6.7.9 1.7.9 3v3.8zm-5.2 1.9c.4 0 .8-.1 1.2-.2.4-.2.8-.4 1.1-.8.2-.2.3-.5.4-.8.1-.3.1-.6.1-1V9.5c-.3-.1-.7-.1-1-.2-.4 0-.7-.1-1-.1-.7 0-1.2.1-1.6.4-.4.3-.5.7-.5 1.2 0 .5.1.9.4 1.2.3.2.6.3 1 .3h-.1zm8.6 1.2c-.1 0-.2 0-.3-.1-.1-.1-.1-.2-.2-.4L12 5.9c0-.2-.1-.3-.1-.4 0-.1.1-.2.2-.2h1.1c.1 0 .2 0 .3.1.1.1.1.2.2.3l1.8 7.1 1.7-7.1c0-.1.1-.2.2-.3.1-.1.2-.1.3-.1h.9c.1 0 .2 0 .3.1.1.1.1.2.2.3l1.7 7.2 1.8-7.2c0-.1.1-.2.2-.3.1-.1.2-.1.3-.1h1c.1 0 .2.1.2.2 0 0 0 .1-.1.4l-2.5 7.6c0 .2-.1.3-.2.4-.1.1-.2.1-.3.1h-.9c-.1 0-.2 0-.3-.1-.1-.1-.1-.2-.2-.4l-1.7-7-1.7 7c0 .2-.1.3-.2.4-.1.1-.2.1-.3.1h-.9zm13.3.3c-.6 0-1.1-.1-1.7-.2-.5-.1-1-.3-1.3-.5-.1-.1-.2-.2-.2-.3v-.6c0-.2.1-.3.2-.3.1 0 .1 0 .2.1.4.2.9.4 1.4.5.5.1 1 .2 1.5.2.8 0 1.4-.1 1.8-.4.4-.3.6-.6.6-1.1 0-.3-.1-.6-.3-.8-.2-.2-.6-.4-1.2-.6l-1.8-.5c-.9-.3-1.5-.7-2-1.2-.4-.5-.7-1.1-.7-1.8 0-.5.1-1 .4-1.4.3-.4.6-.8 1-.1.4-.3.9-.5 1.4-.6.5-.1 1.1-.2 1.7-.2h.4c.1 0 .3 0 .5.1.2 0 .3.1.5.1.1 0 .3.1.4.1.1.1.2.1.2.2v.6c0 .2-.1.3-.2.3-.1 0-.3-.1-.5-.1-.7-.1-1.4-.2-1.9-.2-.7 0-1.3.1-1.7.3-.4.2-.6.6-.6 1 0 .3.1.6.3.8.2.2.7.4 1.3.6l1.7.5c.9.3 1.5.7 1.9 1.2.4.5.6 1 .6 1.7 0 .5-.1 1-.4 1.5-.3.4-.6.8-1.1 1.1-.4.3-1 .5-1.6.6-.6.1-1.2.2-1.8.2z" fill="#FF9900"/>
        <path d="M30.5 17.3c-3.5 2.6-8.6 4-13 4-6.1 0-11.6-2.3-15.8-6 .3-.3.7.1 1.2.1 4.5 2.6 10 4.2 15.8 4.2 3.9 0 8.1-.8 12-2.4.6-.2 1.1.4.8.1z" fill="#FF9900"/>
        <path d="M32 15.2c-.4-.5-2.7-.3-3.8-.1-.3 0-.4-.2-.1-.5 1.9-1.3 4.9-1 5.3-.5.4.5-.1 3.4-1.8 4.8-.3.2-.5.1-.4-.2.4-.9 1.2-3 .8-3.5z" fill="#FF9900"/>
      </svg>`,
      'Azure': `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.05 4.24L6.56 18.05l5.2.92-4.8-5.74 6.09-9z" fill="#0089D6"/>
        <path d="M14.44 5.22l3.63 10.2-9.51 2.63 9.51-2.63z" fill="#0089D6"/>
        <path d="M6.56 18.05l2.72-4.82 2.48 2.97z" fill="#005BA1"/>
        <path d="M14.44 5.22L18.07 15.42 20 19.76H8.51l5.93-14.54z" fill="#0089D6"/>
      </svg>`,
      'GCP': `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.5l7.5 4.3v8.4L12 19.5l-7.5-4.3V6.8z" fill="none"/>
        <path d="M14.8 8.3H12v1.4h2.8c-.3 1.3-1.4 2.3-2.8 2.3-1.7 0-3-1.3-3-3s1.3-3 3-3c.7 0 1.4.3 1.9.7l1-1C14 4.9 13 4.5 12 4.5c-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5c2.5 0 4.3-1.8 4.3-4.3 0-.3 0-.6-.1-.9h-1.4z" fill="#4285F4"/>
        <circle cx="6" cy="15" r="2" fill="#EA4335"/>
        <circle cx="12" cy="18" r="2" fill="#FBBC05"/>
        <circle cx="18" cy="15" r="2" fill="#34A853"/>
      </svg>`,
      'Oracle': `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="7" width="22" height="10" rx="5" fill="#F80000"/>
        <rect x="1" y="7" width="22" height="10" rx="5" fill="none" stroke="#C00000" stroke-width="0.5"/>
        <text x="12" y="15" text-anchor="middle" fill="white" font-family="Arial" font-size="6" font-weight="bold">ORACLE</text>
      </svg>`,
      'Multicloud': `<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="12" r="5" fill="none" stroke="#89b4fa" stroke-width="1.5" opacity="0.7"/>
        <circle cx="16" cy="12" r="5" fill="none" stroke="#a6e3a1" stroke-width="1.5" opacity="0.7"/>
        <path d="M10.5 9a5 5 0 010 6" stroke="#cba6f7" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <path d="M13.5 9a5 5 0 000 6" stroke="#cba6f7" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>`
    };

    const clouds = {};
    acoes.forEach(a => { clouds[a.cloud] = (clouds[a.cloud] || 0) + 1; });
    const total = acoes.length || 1;

    const cloudStatsGrid = document.getElementById('cloud-stats-grid');
    if (!Object.keys(clouds).length) {
      cloudStatsGrid.innerHTML = '';
    } else {
      const sorted = Object.entries(clouds).sort((a, b) => b[1] - a[1]);
      const allCard = `<div class="cloud-stat-card all-card active" id="cloud-card-ALL" onclick="filterByCloud(null)" title="Mostrar todas as ações">
        <div style="font-size:20px">🌐</div>
        <div class="cloud-stat-info">
          <div class="cloud-stat-name">Todos</div>
          <div class="cloud-stat-count">${acoes.length}</div>
        </div>
      </div>`;
      const cards = sorted.map(([cloud, count]) => {
        const icon = cloudIcons[cloud] || `<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent,#89b4fa)" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="var(--accent,#89b4fa)" font-size="8">${cloud.substring(0,2)}</text></svg>`;
        const pct = Math.round((count / total) * 100);
        return `<div class="cloud-stat-card" id="cloud-card-${cloud}" onclick="filterByCloud('${cloud}')" title="1 clique: filtrar ações | 2 cliques: limpar filtro" data-cloud="${cloud}">
          <div class="cloud-stat-icon">${icon}</div>
          <div class="cloud-stat-info">
            <div class="cloud-stat-name">${cloud}</div>
            <div class="cloud-stat-count">${count} <span style="font-size:11px;font-weight:400;color:var(--text-muted,#6c7086)">ações</span></div>
            <div class="cloud-stat-bar"><div class="cloud-stat-bar-fill" style="width:${pct}%"></div></div>
            <div class="cloud-stat-pct">${pct}%</div>
          </div>
        </div>`;
      }).join('');
      cloudStatsGrid.innerHTML = allCard + cards;
    }

    // Ações atrasadas tabela
    document.getElementById('atrasadas-count').textContent = atrasadas.length;
    const tbody = document.getElementById('atrasadas-tbody');
    if (!atrasadas.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">✅ Nenhuma ação com prazo vencido</td></tr>';
    } else {
      // Ordena pelos mais atrasados primeiro
      atrasadas.sort((a, b) => new Date(a.data_conclusao) - new Date(b.data_conclusao));
      tbody.innerHTML = atrasadas.map(a => {
        const dias = Math.floor((hoje - new Date(a.data_conclusao)) / (1000 * 60 * 60 * 24));
        return `
        <tr data-cloud="${escHtml(a.cloud || '')}">
          <td><span class="finops-id">${escHtml(a.id_finops)}</span></td>
          <td><strong>${escHtml(a.acao)}</strong></td>
          <td>${escHtml(a.responsavel || '—')}</td>
          <td>${escHtml(a.projeto_nome || '—')}</td>
          <td><span class="cloud-tag">${escHtml(a.cloud || '—')}</span></td>
          <td>
        <span class="status-badge ${statusClass(a.status)}">${a.status}</span>
        ${isAtrasada(a) ? '<span class="status-badge status-atrasado">⚠ Atrasado</span>' : ''}
      </td>
          <td style="color:var(--danger,#f38ba8)">${formatDate(a.data_conclusao)}</td>
          <td><span class="atrasado-days">+${dias} dia${dias !== 1 ? 's' : ''} em aberto</span></td>
          <td>
            <button class="btn-icon" onclick="viewAcao(${a.id})" title="Ver detalhes">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </td>
        </tr>`;
      }).join('');
    }

    // Re-apply active cloud filter if one is selected
    if (_activeCloud) {
      setTimeout(() => filterTableByCloud('dashboard-acoes-list', _activeCloud, 4, 8), 50);
      setTimeout(() => filterTableByCloud('atrasadas-tbody', _activeCloud, 4, 9), 50);
    }

  } catch (e) {
    showToast('Erro ao carregar dashboard: ' + e.message, 'error');
  }
}

// ── PROJETOS ──────────────────────────────────
async function loadProjetos() {
  try {
    const projetos = await api('GET', '/projetos');
    document.getElementById('projetos-count').textContent = projetos.length;
    const tbody = document.getElementById('projetos-tbody');
    if (!projetos.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum projeto cadastrado</td></tr>';
      return;
    }
    tbody.innerHTML = projetos.map(p => `
      <tr>
        <td><span class="finops-id">#${p.id}</span></td>
        <td><strong>${escHtml(p.nome)}</strong></td>
        <td style="color:var(--text-muted)">${escHtml(p.diretoria || '—')}</td>
        <td style="color:var(--text-muted)">${escHtml(p.descricao || '—')}</td>
        <td style="color:var(--text-muted);font-size:12px">${formatDate(p.created_at)}</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon" onclick="editProjeto(${p.id})" title="Editar">
              <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon delete" onclick="deleteProjeto(${p.id})" title="Excluir">
              <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        </td>
      </tr>`).join('');
  } catch (e) {
    showToast('Erro ao carregar projetos: ' + e.message, 'error');
  }
}

function openProjetoModal(data = null) {
  document.getElementById('projeto-id').value = data?.id || '';
  document.getElementById('projeto-nome').value = data?.nome || '';
  document.getElementById('projeto-diretoria').value = data?.diretoria || '';
  document.getElementById('projeto-descricao').value = data?.descricao || '';
  document.getElementById('modal-projeto-title').textContent = data ? 'Editar Projeto' : 'Novo Projeto';
  document.getElementById('modal-projeto').classList.add('open');
}

async function editProjeto(id) {
  try {
    const p = await api('GET', '/projetos/' + id);
    openProjetoModal(p);
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteProjeto(id) {
  if (!confirm('Excluir este projeto? As ações vinculadas ficarão sem projeto.')) return;
  try {
    await api('DELETE', '/projetos/' + id);
    showToast('Projeto excluído', 'success');
    loadProjetos();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function submitProjeto(e) {
  e.preventDefault();
  const id = document.getElementById('projeto-id').value;
  const body = {
    nome: document.getElementById('projeto-nome').value,
    diretoria: document.getElementById('projeto-diretoria').value,
    descricao: document.getElementById('projeto-descricao').value
  };
  try {
    if (id) await api('PUT', '/projetos/' + id, body);
    else await api('POST', '/projetos', body);
    showToast('Projeto salvo com sucesso!', 'success');
    document.getElementById('modal-projeto').classList.remove('open');
    loadProjetos();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// ── AÇÕES ─────────────────────────────────────
async function loadAcoes() {
  try {
    allAcoes = await api('GET', '/acoes');
    document.getElementById('acoes-count').textContent = allAcoes.length;
    renderAcoes(allAcoes);
  } catch (e) {
    showToast('Erro ao carregar ações: ' + e.message, 'error');
  }
}

function renderAcoes(acoes) {
  const tbody = document.getElementById('acoes-tbody');
  if (!acoes.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Nenhuma ação encontrada</td></tr>';
    return;
  }
  tbody.innerHTML = acoes.map(a => `
    <tr>
      <td><span class="finops-id">${escHtml(a.id_finops)}</span></td>
      <td>${escHtml(a.projeto_nome || '—')}</td>
      <td><strong>${escHtml(a.acao)}</strong></td>
      <td><span class="cloud-tag">${escHtml(a.cloud)}</span></td>
      <td>${escHtml(a.responsavel)}</td>
      <td style="font-size:12px;color:var(--text-dim)">${escHtml(a.tipo_acao)}</td>
      <td><span class="currency">${formatCurrency(a.impacto_atual_mes)}</span></td>
      <td>
        <span class="status-badge ${statusClass(a.status)}">${a.status}</span>
        ${isAtrasada(a) ? '<span class="status-badge status-atrasado">⚠ Atrasado</span>' : ''}
      </td>
      <td><span class="currency">${formatCurrency(a.retorno_ano_atual)}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" onclick="viewAcao(${a.id})" title="Detalhes">
            <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="btn-icon" onclick="editAcao(${a.id})" title="Editar">
            <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteAcao(${a.id})" title="Excluir">
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

function filterAcoes() {
  const search = document.getElementById('filter-search').value.toLowerCase();
  const cloud = document.getElementById('filter-cloud').value;
  const status = document.getElementById('filter-status').value;
  const filtered = allAcoes.filter(a =>
    (!search || a.acao.toLowerCase().includes(search) || a.responsavel.toLowerCase().includes(search) || a.id_finops.toLowerCase().includes(search)) &&
    (!cloud || a.cloud === cloud) &&
    (!status || a.status === status)
  );
  renderAcoes(filtered);
}

async function openAcaoModal(data = null) {
  // Load projects for select
  try {
    const projetos = await api('GET', '/projetos');
    const sel = document.getElementById('acao-projeto');
    sel.innerHTML = '<option value="">Selecione...</option>' +
      projetos.map(p => `<option value="${p.id}">${escHtml(p.nome)}</option>`).join('');
  } catch {}

  // Load users for responsavel select
  try {
    const usuarios = await api('GET', '/usuarios');
    const selR = document.getElementById('acao-responsavel');
    selR.innerHTML = '<option value="">Selecione o responsável...</option>' +
      usuarios.filter(u => u.ativo).map(u => `<option value="${escHtml(u.nome)}">${escHtml(u.nome)}</option>`).join('');
    selR.value = data?.responsavel || '';
  } catch {}

  const m = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  document.getElementById('acao-id').value = data?.id || '';
  document.getElementById('acao-id-finops').value = data?.id_finops || '';
  document.getElementById('acao-projeto').value = data?.projeto_id || '';
  document.getElementById('acao-nome').value = data?.acao || '';
  document.getElementById('acao-cloud').value = data?.cloud || '';
  document.getElementById('acao-tipo').value = data?.tipo_acao || '';
  document.getElementById('acao-impacto').value = data?.impacto_atual_mes || '';
  document.getElementById('acao-status').value = data?.status || '';
  document.getElementById('acao-data-inicio').value = data?.data_inicio ? data.data_inicio.substring(0,10) : '';
  document.getElementById('acao-data-conclusao').value = data?.data_conclusao ? data.data_conclusao.substring(0,10) : '';

  m.forEach((mn, i) => {
    document.getElementById('atual_' + mn).value = data ? (data['atual_' + ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][i]] || '') : '';
    document.getElementById('prox_' + mn).value = data ? (data['proximo_' + ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][i]] || '') : '';
  });

  document.getElementById('modal-acao-title').textContent = data ? 'Editar Ação FinOps' : 'Nova Ação FinOps';
  // Limpa campos e chips de replicar
  document.getElementById('replicate-atual-value').value = '';
  document.getElementById('replicate-prox-value').value = '';
  ['atual','prox'].forEach(p => {
    document.getElementById(`chips-${p}`).classList.remove('open');
    document.querySelectorAll(`#chips-${p} .month-chip`).forEach(c => {
      c.classList.remove('checked');
    });
  });

  document.getElementById('modal-acao').classList.add('open');
}

async function editAcao(id) {
  try {
    const a = await api('GET', '/acoes/' + id);
    openAcaoModal(a);
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteAcao(id) {
  if (!confirm('Excluir esta ação FinOps?')) return;
  try {
    await api('DELETE', '/acoes/' + id);
    showToast('Ação excluída', 'success');
    loadAcoes();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function viewAcao(id) {
  try {
    const a = await api('GET', '/acoes/' + id);
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const mKeys = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

    document.getElementById('detalhe-content').innerHTML = `
      <div class="form-section-title">Informações Gerais</div>
      <div class="detalhe-grid">
        <div class="detalhe-item"><span class="detalhe-label">ID FinOps</span><span class="detalhe-value finops-id">${escHtml(a.id_finops)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Projeto</span><span class="detalhe-value">${escHtml(a.projeto_nome || '—')}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Ação</span><span class="detalhe-value">${escHtml(a.acao)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Cloud</span><span class="detalhe-value"><span class="cloud-tag">${escHtml(a.cloud)}</span></span></div>
        <div class="detalhe-item"><span class="detalhe-label">Responsável</span><span class="detalhe-value">${escHtml(a.responsavel)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Tipo</span><span class="detalhe-value">${escHtml(a.tipo_acao)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Impacto/Mês</span><span class="detalhe-value currency">${formatCurrency(a.impacto_atual_mes)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Status</span><span class="detalhe-value"><span class="status-badge ${statusClass(a.status)}">${a.status}</span></span></div>
        <div class="detalhe-item"><span class="detalhe-label">Início</span><span class="detalhe-value">${a.data_inicio ? formatDate(a.data_inicio) : '—'}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Conclusão</span><span class="detalhe-value">${a.data_conclusao ? formatDate(a.data_conclusao) : '—'}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Retorno Ano Atual</span><span class="detalhe-value currency">${formatCurrency(a.retorno_ano_atual)}</span></div>
        <div class="detalhe-item"><span class="detalhe-label">Retorno Próx. Ano</span><span class="detalhe-value currency">${formatCurrency(a.retorno_proximo_ano)}</span></div>
      </div>
      <div class="form-section-title">Retorno Mensal — Ano Atual</div>
      <div class="table-wrapper"><table class="months-table">
        <thead><tr>${meses.map(m => `<th>${m.substring(0,3)}</th>`).join('')}</tr></thead>
        <tbody><tr>${mKeys.map(k => {
          const v = parseFloat(a['atual_' + k] || 0);
          return `<td class="${v > 0 ? 'positive' : 'zero'}">${v !== 0 ? formatCurrency(v) : '—'}</td>`;
        }).join('')}</tr></tbody>
      </table></div>
      <div class="form-section-title" style="margin-top:16px">Retorno Mensal — Próximo Ano</div>
      <div class="table-wrapper"><table class="months-table">
        <thead><tr>${meses.map(m => `<th>${m.substring(0,3)}</th>`).join('')}</tr></thead>
        <tbody><tr>${mKeys.map(k => {
          const v = parseFloat(a['proximo_' + k] || 0);
          return `<td class="${v > 0 ? 'positive' : 'zero'}">${v !== 0 ? formatCurrency(v) : '—'}</td>`;
        }).join('')}</tr></tbody>
      </table></div>
    `;
    document.getElementById('modal-detalhe').classList.add('open');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function submitAcao(e) {
  e.preventDefault();
  const id = document.getElementById('acao-id').value;
  const mKeys = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const mIds  = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const body = {
    id_finops: document.getElementById('acao-id-finops').value || undefined,
    projeto_id: document.getElementById('acao-projeto').value || null,
    acao: document.getElementById('acao-nome').value,
    cloud: document.getElementById('acao-cloud').value,
    responsavel: document.getElementById('acao-responsavel').value,
    tipo_acao: document.getElementById('acao-tipo').value,
    impacto_atual_mes: parseFloat(document.getElementById('acao-impacto').value) || 0,
    status: document.getElementById('acao-status').value,
    data_inicio: document.getElementById('acao-data-inicio').value || null,
    data_conclusao: document.getElementById('acao-data-conclusao').value || null
  };
  mKeys.forEach((k, i) => {
    body['atual_' + k] = parseFloat(document.getElementById('atual_' + mIds[i]).value) || 0;
    body['proximo_' + k] = parseFloat(document.getElementById('prox_' + mIds[i]).value) || 0;
  });
  // Auto-calculate totals
  body.retorno_ano_atual = mKeys.reduce((s, k) => s + (body['atual_' + k] || 0), 0);
  body.retorno_proximo_ano = mKeys.reduce((s, k) => s + (body['proximo_' + k] || 0), 0);

  try {
    if (id) await api('PUT', '/acoes/' + id, body);
    else await api('POST', '/acoes', body);
    showToast('Ação salva com sucesso!', 'success');
    document.getElementById('modal-acao').classList.remove('open');
    loadAcoes();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// ── ESTIMATIVAS ───────────────────────────────
let allEstimativas = [];

async function loadEstimativas() {
  try {
    allEstimativas = await api('GET', '/estimativas');
    _renderEstStats(allEstimativas);
    _populateEstProjSelect(allEstimativas);
    renderEstimativas(allEstimativas);
  } catch (e) {
    showToast('Erro ao carregar estimativas: ' + e.message, 'error');
  }
}

function _populateEstProjSelect(lista) {
  const sel = document.getElementById('est-filter-projeto');
  if (!sel) return;
  const projetos = [...new Set(lista.map(e => e.projeto_nome || 'Sem Projeto'))].sort();
  sel.innerHTML = '<option value="">Todos os Projetos</option>' +
    projetos.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
}

function _renderEstStats(lista) {
  const el = document.getElementById('est-stats');
  if (!el) return;
  const byProjeto = {};
  lista.forEach(e => {
    const k = e.projeto_nome || 'Sem Projeto';
    if (!byProjeto[k]) byProjeto[k] = { count: 0, total: 0 };
    byProjeto[k].count++;
    byProjeto[k].total += parseFloat(e.total_final || 0);
  });
  el.innerHTML = Object.entries(byProjeto).map(([nome, d]) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-card);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:11px;">
      <strong style="color:var(--accent)">${escHtml(nome)}</strong>
      <span style="color:var(--text-muted)">${d.count} estimativa${d.count !== 1 ? 's' : ''}</span>
      <span style="color:var(--text-dim);font-family:IBM Plex Mono,monospace">${formatCurrency(d.total)}</span>
    </span>`
  ).join('');
}

function _estStatusBadge(status) {
  const map = { 'Aprovado': 'status-concluido', 'Nao Aprovado': 'status-cancelado', 'Pendente': 'status-planejado' };
  return `<span class="status-badge ${map[status] || 'status-planejado'}">${escHtml(status || 'Pendente')}</span>`;
}

function renderEstimativas(lista) {
  const tbody = document.getElementById('est-tbody');
  if (!tbody) return;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma estimativa encontrada</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(e => {
    const dataEst  = e.data_estimativa ? new Date(e.data_estimativa).toLocaleDateString('pt-BR') : '—';
    const validade = e.data_estimativa && e.validade_dias
      ? new Date(new Date(e.data_estimativa).getTime() + e.validade_dias * 86400000)
      : null;
    const hoje     = new Date();
    const ativa    = validade && validade >= hoje;
    const validStr = validade ? validade.toLocaleDateString('pt-BR') : '—';
    const validBadge = validade
      ? `<span class="status-badge ${ativa ? 'status-concluido' : 'status-cancelado'}" style="font-size:10px">${ativa ? 'Ativa' : 'Expirada'}</span>`
      : '—';
    const st = e.status || 'Pendente';
    return `<tr>
      <td><span class="finops-id">${escHtml(e.numero || '—')}</span></td>
      <td>${escHtml(e.projeto_nome || '—')}</td>
      <td><strong>${escHtml(e.titulo || '—')}</strong></td>
      <td style="color:var(--text-muted)">${escHtml(e.responsavel || '—')}</td>
      <td style="text-align:right"><span class="currency">${formatCurrency(e.total_final)}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${dataEst}</td>
      <td>${validBadge}<span style="font-size:11px;color:var(--text-muted);margin-left:4px">${validStr}</span></td>
      <td>
        ${_estStatusBadge(st)}
        <div class="table-actions" style="margin-top:5px">
          <button class="btn-icon" onclick="toggleEstimativaStatus(${e.id},'Aprovado')" title="Aprovar" ${st === 'Aprovado' ? 'style="opacity:0.3;cursor:default"' : ''}>
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#9333ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon" onclick="toggleEstimativaStatus(${e.id},'Nao Aprovado')" title="Não Aprovar" ${st === 'Nao Aprovado' ? 'style="opacity:0.3;cursor:default"' : ''}>
            <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" onclick="viewEstimativa(${e.id})" title="Ver detalhes">
            <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteEstimativa(${e.id})" title="Excluir">
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8h6V4H5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterEstimativas() {
  const search  = (document.getElementById('est-search')?.value || '').toLowerCase();
  const projeto = document.getElementById('est-filter-projeto')?.value || '';
  const filtered = allEstimativas.filter(e =>
    (!search || (e.numero || '').toLowerCase().includes(search) ||
                (e.projeto_nome || '').toLowerCase().includes(search) ||
                (e.titulo || '').toLowerCase().includes(search)) &&
    (!projeto || (e.projeto_nome || 'Sem Projeto') === projeto)
  );
  _renderEstStats(filtered);
  renderEstimativas(filtered);
}

let _currentEstimativaDetalhe = null;

async function viewEstimativa(id) {
  try {
    const e = await api('GET', '/estimativas/' + id);
    _currentEstimativaDetalhe = e;
    document.getElementById('modal-est-title').textContent = e.numero || 'Detalhes da Estimativa';
    const recursos = Array.isArray(e.recursos) ? e.recursos : [];
    const _MAX_ROWS = 150;
    const linhas = recursos.slice(0, _MAX_ROWS).map(r => {
      const horas = r.isHora ? (r.horas + ' h') : '—';
      const chora = r.custo_hora != null ? formatCurrency(r.custo_hora) + '/h' : '—';
      const skuLine = r.sku ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(r.sku)}</div>` : '';
      const uomLine = r.uom ? `<div style="font-size:10px;color:var(--text-muted);opacity:.7;font-family:'IBM Plex Mono',monospace">${escHtml(r.uom)}</div>` : '';
      return `<tr>
        <td>${escHtml(r.nome || '—')}${skuLine}${uomLine}</td>
        <td style="color:var(--text-muted)">${escHtml(r.categoria || '—')}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace">${horas}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace">${chora}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace;color:var(--accent)">${formatCurrency(r.estimado_brl)}</td>
      </tr>`;
    }).join('');
    const _maisLinhas = recursos.length > _MAX_ROWS
      ? `<tr><td colspan="5" style="text-align:center;padding:8px;font-size:11px;color:var(--text-muted)">
           + ${recursos.length - _MAX_ROWS} recurso(s) adicionais — ver PDF para lista completa
         </td></tr>` : '';

    const impostoRow = e.pct_imposto > 0
      ? `<tr><td colspan="4" style="text-align:right;color:var(--text-muted)">+ Imposto (${e.pct_imposto}%)</td><td style="text-align:right;font-family:IBM Plex Mono,monospace">${formatCurrency(e.vl_imposto)}</td></tr>` : '';
    const condRow = e.pct_cond > 0
      ? `<tr><td colspan="4" style="text-align:right;color:var(--text-muted)">+ Condomínio (${e.pct_cond}%)</td><td style="text-align:right;font-family:IBM Plex Mono,monospace">${formatCurrency(e.vl_cond)}</td></tr>` : '';

    const dataEst = e.data_estimativa ? new Date(e.data_estimativa).toLocaleDateString('pt-BR') : '—';
    const validade = e.data_estimativa && e.validade_dias
      ? new Date(new Date(e.data_estimativa).getTime() + e.validade_dias * 86400000).toLocaleDateString('pt-BR') : '—';
    const st = e.status || 'Pendente';

    document.getElementById('modal-est-body').innerHTML = `
      <!-- Status + Ações -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--text-muted)">Status:</span>
          ${_estStatusBadge(st)}
          <button class="btn-ghost" style="font-size:11px;padding:3px 10px" onclick="toggleEstimativaStatus(${e.id},'Aprovado',true)" ${st==='Aprovado'?'disabled style="opacity:0.4"':''}>✓ Aprovar</button>
          <button class="btn-ghost" style="font-size:11px;padding:3px 10px;color:#f87171" onclick="toggleEstimativaStatus(${e.id},'Nao Aprovado',true)" ${st==='Nao Aprovado'?'disabled style="opacity:0.4"':''}>✗ Não Aprovar</button>
          ${st !== 'Pendente' ? `<button class="btn-ghost" style="font-size:11px;padding:3px 10px" onclick="toggleEstimativaStatus(${e.id},'Pendente',true)">↺ Pendente</button>` : ''}
        </div>
        <button class="btn-primary" style="font-size:11px;padding:5px 14px" onclick="gerarPDFEstimativaSalva()">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="margin-right:5px"><path d="M4 12h8M8 3v7M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Gerar PDF
        </button>
      </div>
      <!-- Grid de Metadados -->
      <div class="detalhe-grid" style="margin-bottom:16px">
        <div class="detalhe-item"><div class="detalhe-label">Número</div><div class="detalhe-value"><span class="finops-id">${escHtml(e.numero || '—')}</span></div></div>
        <div class="detalhe-item"><div class="detalhe-label">Projeto</div><div class="detalhe-value">${escHtml(e.projeto_nome || '—')}</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Título</div><div class="detalhe-value">${escHtml(e.titulo || '—')}</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Responsável</div><div class="detalhe-value">${escHtml(e.responsavel || '—')}</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Data</div><div class="detalhe-value">${dataEst}</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Validade até</div><div class="detalhe-value">${validade}</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Horas Est.</div><div class="detalhe-value">${e.horas || '—'} h</div></div>
        <div class="detalhe-item"><div class="detalhe-label">Total Final</div><div class="detalhe-value" style="color:var(--accent);font-weight:600">${formatCurrency(e.total_final)}</div></div>
      </div>
      <!-- Tabela de Recursos -->
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Recurso</th><th>Categoria</th><th style="text-align:right">Horas</th><th style="text-align:right">Custo/h</th><th style="text-align:right">Estimativa BRL</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="5" class="empty-state">Sem recursos registrados</td></tr>'}${_maisLinhas}</tbody>
          <tfoot>
            <tr style="background:var(--bg-card)"><td colspan="4" style="text-align:right;color:var(--text-muted);font-size:11px">Subtotal</td><td style="text-align:right;font-family:IBM Plex Mono,monospace">${formatCurrency(e.total_brl)}</td></tr>
            ${impostoRow}${condRow}
            <tr style="background:var(--bg-card);font-weight:700"><td colspan="4" style="text-align:right">Total Final</td><td style="text-align:right;font-family:IBM Plex Mono,monospace;color:var(--accent)">${formatCurrency(e.total_final)}</td></tr>
          </tfoot>
        </table>
      </div>
      ${e.observacoes ? `<div style="margin-top:12px;padding:10px 14px;background:var(--bg-card);border-radius:6px;font-size:12px;color:var(--text-muted)"><strong>Observações:</strong> ${escHtml(e.observacoes)}</div>` : ''}
    `;
    document.getElementById('modal-estimativa').classList.add('open');
  } catch (err) {
    showToast('Erro ao carregar estimativa: ' + err.message, 'error');
  }
}

function gerarPDFEstimativaSalva() {
  if (!_currentEstimativaDetalhe) return;
  if (typeof Calculadora !== 'undefined' && typeof Calculadora.gerarPDFSalvo === 'function') {
    Calculadora.gerarPDFSalvo(_currentEstimativaDetalhe);
  } else {
    showToast('Calculadora não disponível. Acesse pela aba Calculadora.', 'error');
  }
}

async function deleteEstimativa(id) {
  if (!confirm('Excluir esta estimativa? Esta ação não pode ser desfeita.')) return;
  try {
    await api('DELETE', '/estimativas/' + id);
    showToast('Estimativa excluída.', 'success');
    loadEstimativas();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function toggleEstimativaStatus(id, status, refreshModal = false) {
  try {
    await api('PUT', '/estimativas/' + id + '/status', { status });
    showToast('Status atualizado: ' + status, 'success');
    loadEstimativas();
    if (refreshModal && _currentEstimativaDetalhe?.id === id) {
      viewEstimativa(id);
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ── REPLICAR MESES ────────────────────────────
const MESES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function getValorReplicar(prefixo) {
  const valor = parseFloat(document.getElementById(`replicate-${prefixo}-value`).value);
  if (isNaN(valor)) { showToast('Informe um valor para replicar', 'error'); return null; }
  return valor;
}

function replicarTodos(prefixo) {
  const valor = getValorReplicar(prefixo);
  if (valor === null) return;
  MESES_ABREV.forEach(m => { document.getElementById(`${prefixo}_${m}`).value = valor; });
  // Marca todos os chips visualmente
  selecionarTodosChips(prefixo, true);
  // Abre o painel de chips se ainda não estiver aberto
  document.getElementById(`chips-${prefixo}`).classList.add('open');
  showToast(`Valor aplicado em todos os 12 meses`, 'success');
}

function toggleMesSelect(prefixo) {
  const el = document.getElementById(`chips-${prefixo}`);
  el.classList.toggle('open');
}

function toggleChipAuto(chip) {
  chip.classList.toggle('checked');
  const isChecked = chip.classList.contains('checked');
  const mes = chip.dataset.value;

  // Descobrir o prefixo pelo container pai
  const container = chip.closest('[id^="chips-"]');
  const prefixo = container.id.replace('chips-', '');

  const valor = parseFloat(document.getElementById(`replicate-${prefixo}-value`).value);
  const input = document.getElementById(`${prefixo}_${mes}`);

  if (isChecked && !isNaN(valor)) {
    input.value = valor;
  } else if (!isChecked) {
    input.value = '';
  }
}

function selecionarTodosChips(prefixo, marcar) {
  const valor = parseFloat(document.getElementById(`replicate-${prefixo}-value`).value);
  document.querySelectorAll(`#chips-${prefixo} .month-chip`).forEach(chip => {
    chip.classList.toggle('checked', marcar);
    const mes = chip.dataset.value;
    const input = document.getElementById(`${prefixo}_${mes}`);
    if (marcar && !isNaN(valor)) {
      input.value = valor;
    } else if (!marcar) {
      input.value = '';
    }
  });
  showToast(marcar ? 'Todos os meses marcados e preenchidos' : 'Todos os meses desmarcados e limpos', 'success');
}

function replicarSelecionados(prefixo) {
  const valor = getValorReplicar(prefixo);
  if (valor === null) return;
  const selecionados = [...document.querySelectorAll(`#chips-${prefixo} .month-chip.checked`)]
    .map(c => c.dataset.value);
  if (!selecionados.length) { showToast('Selecione ao menos um mês', 'error'); return; }
  selecionados.forEach(m => { document.getElementById(`${prefixo}_${m}`).value = valor; });
  showToast(`Valor aplicado em ${selecionados.length} mês(es) selecionado(s)`, 'success');
}

// ── REFRESH CONTROL ──────────────────────────────
let _refreshTimer    = null;
let _refreshInterval = 0;
let _refreshCountdown = 0;
let _countdownTimer  = null;
let _dbStatusInterval = null;
let _notifInterval    = null;

function setRefreshInterval(minutes) {
  _refreshInterval = parseInt(minutes);
  clearInterval(_refreshTimer);
  clearInterval(_countdownTimer);
  const cdEl = document.getElementById('refresh-countdown');
  if (cdEl) cdEl.textContent = '';
  if (_refreshInterval > 0) {
    const totalSecs = _refreshInterval * 60;
    _refreshCountdown = totalSecs;
    if (cdEl) cdEl.textContent = fmtCountdown(totalSecs);
    _countdownTimer = setInterval(() => {
      if (_refreshCountdown > 0) _refreshCountdown--;
      const el = document.getElementById('refresh-countdown');
      if (el) el.textContent = _refreshCountdown > 0 ? fmtCountdown(_refreshCountdown) : '…';
    }, 1000);
    _refreshTimer = setInterval(() => {
      _refreshCountdown = totalSecs;
      manualRefresh();
    }, totalSecs * 1000);
  }
}

function fmtCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? m + ':' + String(s).padStart(2,'0') : s + 's';
}

async function manualRefresh() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('spinning');
  try {
    if      (currentView === 'dashboard')   await loadDashboard();
    else if (currentView === 'projetos')    await loadProjetos();
    else if (currentView === 'acoes')       await loadAcoes();
    else if (currentView === 'estimativas') await loadEstimativas();
    else if (currentView === 'reservas')    await loadReservas();
    else if (currentView === 'coleta')      await loadColeta();
    else if (currentView === 'custos')      await loadAzureCosts?.();
  } finally {
    setTimeout(() => { if (icon) icon.classList.remove('spinning'); }, 500);
  }
}

// ── CLOUD FILTER ──────────────────────────────
let _activeCloud = null;
let _cloudClickTimer = null;

function filterByCloud(cloud) {
  if (_cloudClickTimer && _activeCloud === cloud) {
    clearTimeout(_cloudClickTimer);
    _cloudClickTimer = null;
    cloud = null;
  } else {
    _cloudClickTimer = setTimeout(() => { _cloudClickTimer = null; }, 400);
  }
  _activeCloud = cloud;

  // Highlight selected cloud card
  document.querySelectorAll('.cloud-stat-card').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById(cloud ? ('cloud-card-' + cloud) : 'cloud-card-ALL');
  if (activeEl) activeEl.classList.add('active');

  // Update stat cards
  updateStatCardsForCloud(cloud);

  // ── Filter: Ações Recentes ──────────────────
  filterTableByCloud('dashboard-acoes-list', cloud, 4, 8);

  // ── Filter: Ações com Prazo Vencido ─────────
  filterTableByCloud('atrasadas-tbody', cloud, 4, 9);
}

function filterTableByCloud(tbodyId, cloud, cloudColIndex, colspan) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  let visible = 0;
  tbody.querySelectorAll('tr').forEach(row => {
    if (row.classList.contains('empty-row')) return;
    if (!cloud) { row.style.display = ''; visible++; return; }
    // Use data-cloud attribute (most reliable)
    const rowCloud = row.getAttribute('data-cloud');
    const match = rowCloud === cloud;
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  // Show/hide empty state row
  let emptyRow = tbody.querySelector('.empty-row');
  const allRows = tbody.querySelectorAll('tr:not(.empty-row)');
  if (visible === 0 && allRows.length > 0) {
    if (!emptyRow) {
      emptyRow = document.createElement('tr');
      emptyRow.className = 'empty-row';
      tbody.appendChild(emptyRow);
    }
    emptyRow.innerHTML = '<td colspan="' + colspan + '" class="empty-state">Nenhuma ação de "' + escHtml(cloud) + '" encontrada</td>';
    emptyRow.style.display = '';
  } else if (emptyRow) {
    emptyRow.style.display = 'none';
  }
}

function updateStatCardsForCloud(cloud) {
  const source = (allAcoes && allAcoes.length) ? allAcoes : [];
  const f = cloud ? source.filter(a => a.cloud === cloud) : source;
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  const atrasadas = f.filter(a => {
    if (!a.data_conclusao) return false;
    if (a.status === 'Concluído' || a.status === 'Cancelado') return false;
    return new Date(a.data_conclusao) < hoje;
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('stat-total',              f.length);
  set('stat-andamento',          f.filter(a => a.status === 'Em Andamento').length);
  set('stat-concluidas',         f.filter(a => a.status === 'Concluído').length);
  set('stat-atrasadas',          atrasadas.length);
  set('stat-retorno',            formatCurrency(f.filter(a => a.status === 'Concluído').reduce((s,a) => s + parseFloat(a.retorno_ano_atual||0), 0)));
  set('stat-retorno-andamento',  formatCurrency(f.filter(a => a.status === 'Em Andamento').reduce((s,a) => s + parseFloat(a.retorno_ano_atual||0), 0)));
  set('stat-retorno-planejado',  formatCurrency(f.filter(a => a.status === 'Planejado').reduce((s,a) => s + parseFloat(a.retorno_ano_atual||0), 0)));
  set('stat-retorno-prox',       formatCurrency(f.reduce((s,a) => s + parseFloat(a.retorno_proximo_ano||0), 0)));
}

// ── INACTIVITY TIMEOUT ────────────────────────
let _inactivityTimer      = null;
let _countdownInterval    = null;
let _warningShown         = false;
let _inactivitySuspended  = false;
const INACTIVITY_MS       = 15 * 60 * 1000;
const WARNING_SECS        = 60;

function suspendInactivityTimer() {
  _inactivitySuspended = true;
  clearTimeout(_inactivityTimer);
  // Se o aviso de timeout já estava aparecendo, fechar — iniciar coleta conta como atividade
  if (_warningShown) {
    _warningShown = false;
    clearInterval(_countdownInterval);
    const modal = document.getElementById('modal-timeout');
    if (modal) modal.style.display = 'none';
  }
}

function resumeInactivityTimer() {
  _inactivitySuspended = false;
  resetInactivityTimer();
}

function resetInactivityTimer() {
  if (_warningShown) return;
  if (_inactivitySuspended) return;
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(showTimeoutWarning, INACTIVITY_MS);
}

function startInactivityTimer() {
  ['mousemove','keydown','click','touchstart','scroll'].forEach(evt =>
    document.removeEventListener(evt, resetInactivityTimer)
  );
  ['mousemove','keydown','click','touchstart','scroll'].forEach(evt =>
    document.addEventListener(evt, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

function showTimeoutWarning() {
  _warningShown = true;
  let secs = WARNING_SECS;
  const modal = document.getElementById('modal-timeout');
  const display = document.getElementById('timeout-countdown-display');
  if (!modal) return;
  if (display) display.textContent = secs;
  modal.style.display = 'flex';
  _countdownInterval = setInterval(() => {
    secs--;
    if (display) display.textContent = secs;
    if (secs <= 0) { clearInterval(_countdownInterval); sessionLogout(); }
  }, 1000);
}

function extendSession() {
  clearInterval(_countdownInterval);
  const modal = document.getElementById('modal-timeout');
  if (modal) modal.style.display = 'none';
  _warningShown = false;
  resetInactivityTimer();
  showToast('Sessão renovada!', 'success');
}

function sessionLogout() {
  clearInterval(_countdownInterval);
  clearTimeout(_inactivityTimer);
  logout();
}

// ── EXPORT EXCEL — EXECUTIVO ──────────────────
// ── EXPORT EXCEL — EXECUTIVO FINOPS ──────────
async function exportarExcel() {
  try {
    showToast('Gerando relatório executivo...', 'success');
    const token = sessionStorage.getItem('finops_token');
    const response = await fetch(API + '/export/excel', {
      method: 'GET',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({error:'Erro desconhecido'}));
      showToast('Erro: ' + err.error, 'error'); return;
    }
    const blob = await response.blob();
    const date = new Date().toISOString().split('T')[0];
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'FinOps_Executivo_' + date + '.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('✅ Relatório executivo exportado!', 'success');
  } catch(e) {
    showToast('Erro ao exportar: ' + e.message, 'error');
    console.error(e);
  }
}

// ── INIT ──────────────────────────────────────
(async () => {
  const session = sessionStorage.getItem('finops_session') || localStorage.getItem('finops_session');
  const token   = sessionStorage.getItem('finops_token')   || localStorage.getItem('finops_token');
  if (session && token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) throw new Error('expired');
    } catch {
      sessionStorage.removeItem('finops_token');
      sessionStorage.removeItem('finops_session');
      localStorage.removeItem('finops_token');
      localStorage.removeItem('finops_session');
      await checkFirstRun();
      return;
    }
    if (!sessionStorage.getItem('finops_token')) {
      sessionStorage.setItem('finops_token', token);
      sessionStorage.setItem('finops_session', session);
    }
    currentUser = JSON.parse(session);
    enterApp();
  } else {
    await checkFirstRun();
  }
})();

// ── DASHBOARD TABS ────────────────────────────
function toggleNavGroup(id) {
  document.getElementById('nav-group-' + id)?.classList.toggle('open');
}

function openNavGroup(id) {
  document.getElementById('nav-group-' + id)?.classList.add('open');
  if (id === 'dashboard') showDashTab('acoes');
}

function showDashTab(tab) {
  showView('dashboard');
  switchDashTab(tab);
  document.querySelectorAll('.nav-sub').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-sub-' + tab)?.classList.add('active');
}

function switchDashTab(tab) {
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('dash-panel-' + tab)?.classList.add('active');
}

// ── HELPERS ───────────────────────────────────
function isAtrasada(a) {
  if (a.status !== 'Em Andamento' && a.status !== 'Planejado') return false;
  if (!a.data_conclusao) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return new Date(a.data_conclusao) < hoje;
}

function statusClass(status) {
  const map = { 'Planejado':'status-planejado','Em Andamento':'status-andamento','Concluído':'status-concluido','Cancelado':'status-cancelado' };
  return map[status] || '';
}

function formatCurrency(v) {
  if (!v && v !== 0) return '—';
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return 'R$ 0';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits:0, maximumFractionDigits:0 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function closeModalOnOverlay(e, id) {
  if (e.target === e.currentTarget) document.getElementById(id).classList.remove('open');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function roleName(r) {
  return { admin:'🔴 Administrador', finops:'🔵 FinOps', reader:'🟢 Reader' }[r] || r;
}

// ── CONFIGURAÇÕES / USUÁRIOS ──────────────────
async function openSettingsModal() {
  document.getElementById('modal-settings').classList.add('open');
  await renderUsersList();
  renderDbConnectionsList();
  try {
    const integrations = await api('GET', '/integrations');
    integrations.forEach(i => {
      const toggle = document.getElementById('toggle-' + i.tipo);
      if (toggle) {
        toggle.checked = i.ativo;
        if (i.ativo) { const cfg = document.getElementById('config-' + i.tipo); if(cfg) cfg.style.display='block'; }
      }
      if (i.config) {
        if (i.tipo === 'ad') {
          ['server','basedn','user','grp-admin','grp-finops','grp-reader'].forEach(k => {
            const el = document.getElementById('ad-' + k);
            if (el) el.value = i.config[k.replace('-','_')] || '';
          });
        } else if (i.tipo === 'entra') {
          ['tenant','client','redirect','grp-admin','grp-finops','grp-reader'].forEach(k => {
            const el = document.getElementById('entra-' + k);
            if (el) el.value = i.config[k.replace('-','_') === 'tenant' ? 'tenant_id' : k.replace('-','_') === 'client' ? 'client_id' : k.replace(/-/g,'_')] || '';
          });
        }
      }
    });
  } catch {}
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  const tabEl = document.querySelector('[onclick="switchSettingsTab(\'' + tab + '\')"]');
  if (tabEl) tabEl.classList.add('active');
  const panelEl = document.getElementById('stab-' + tab);
  if (panelEl) panelEl.classList.add('active');
  if (tab === 'coleta') loadColeta();
  if (tab === 'pricelist') { _loadPriceListStatus(); loadPlSchedule(); }
}

// ── Price List ─────────────────────────────────────────────────────────────────
async function _loadPriceListStatus() {
  const sub     = document.getElementById('pl-status-sub');
  const badge   = document.getElementById('pl-status-badge');
  const total   = document.getElementById('pl-total');
  const meters  = document.getElementById('pl-meters');
  const updated = document.getElementById('pl-updated');
  if (!sub) return;

  // Sempre USD/global — a API não filtra por região nem por outras moedas de forma confiável
  const currency = 'USD';
  const region   = 'global';

  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';

    // Reconectar ao import em andamento (caso o usuário tenha desconectado e voltado)
    const _stRes = await fetch('/api/price-list/import-status', { headers: { Authorization: 'Bearer ' + token } });
    if (_stRes.ok) {
      const _st = await _stRes.json();
      _plUpdateLog(_st);
      if (_st.importing && !_plImportPollTimer) {
        const prog    = document.getElementById('pl-import-progress');
        const progMsg = document.getElementById('pl-import-progress-msg');
        if (prog) prog.style.display = 'block';
        if (progMsg) progMsg.textContent = `Import em andamento: ${_st.filename || '...'}`;
        document.getElementById('pl-import-btn').disabled = true;
        _plImportPollTimer = setTimeout(_reconnectImportPoll, 1500);
      }
    }

    const res = await fetch(`/api/price-list/status?currency=${currency}&region=${region}`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    const tot = parseInt(d.total || 0);
    total.textContent  = tot.toLocaleString('pt-BR');
    meters.textContent = parseInt(d.meters || 0).toLocaleString('pt-BR');

    if (d.last_updated) {
      const dt = new Date(d.last_updated);
      updated.textContent = dt.toLocaleDateString('pt-BR') + ' '
        + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else {
      updated.textContent = 'Nunca';
    }

    // ── Circuit Breaker — exibe alerta se API estiver bloqueada ────────────────
    const syncBtn  = document.getElementById('pl-sync-btn');
    const cbRstBtn = document.getElementById('pl-cb-reset-btn');
    const cb       = d.circuit_breaker;
    if (cb && cb.state === 'OPEN') {
      sub.textContent        = `⚡ Circuit Breaker aberto — API bloqueada por falhas consecutivas. Liberação automática em ${cb.remaining_min ?? '?'} min.`;
      badge.textContent      = '⚡ CB Aberto';
      badge.style.background = 'rgba(255,77,106,.15)';
      badge.style.color      = 'var(--danger,#ff4d6a)';
      if (syncBtn)  syncBtn.disabled       = true;
      if (cbRstBtn) cbRstBtn.style.display = 'inline-flex';
      return { syncing: false, total: tot, last_result: d.last_result, cb_open: true };
    }
    // CB fechado — reabilita botão e esconde reset
    if (syncBtn  && !_plPolling) syncBtn.disabled       = false;
    if (cbRstBtn)                cbRstBtn.style.display = 'none';

    if (d.syncing) {
      // Mostra progresso em tempo real quando disponível
      const prog = d.progress;
      const progTxt = prog && prog.total > 0
        ? `${prog.total.toLocaleString('pt-BR')} registros importados (página ${prog.pages})...`
        : 'Sincronização em andamento...';
      sub.textContent        = progTxt;
      badge.textContent      = '⏳ Sincronizando';
      badge.style.background = 'rgba(255,140,66,.15)';
      badge.style.color      = 'var(--orange,#ff8c42)';

    } else if (tot > 0) {
      // Sucesso: há dados no banco
      const lr  = d.last_result;
      const cob = d.cobertura;
      const infoExtra = lr ? ` (${(lr.total||0).toLocaleString('pt-BR')} reg · ${lr.pages||0} págs)` : '';
      const cbExtra   = cb && cb.state === 'HALF_OPEN' ? ' · ⚡ CB testando' : cb && cb.failures > 0 ? ` · ⚡ CB: ${cb.failures} falha(s)` : '';
      // Cobertura: % de meter_ids do billing com preço no PL
      const cobExtra  = cob
        ? ` · Cobertura: ${cob.com_pl}/${cob.billing_meters} meters (${cob.cobertura_pct}%)`
          + (cob.sem_meter_id > 0 ? ` · ⚠ ${cob.sem_meter_id} meter_ids nulos no billing` : '')
        : '';
      const cobColor  = cob && cob.cobertura_pct === 0 ? 'var(--danger)' : cob && cob.cobertura_pct < 30 ? 'var(--orange)' : 'var(--green,#22c55e)';
      sub.innerHTML          = `<span>Cache atualizado${infoExtra}${cbExtra}</span>`
        + (cob ? `<span style="margin-left:8px;font-weight:600;color:${cobColor};">${cobExtra.trim()}</span>` : '');
      badge.textContent      = cob && cob.cobertura_pct === 0 ? '⚠ Sem cobertura' : '✅ Disponível';
      badge.style.background = cob && cob.cobertura_pct === 0 ? 'rgba(255,77,106,.12)' : 'rgba(34,197,94,.12)';
      badge.style.color      = cob && cob.cobertura_pct === 0 ? 'var(--danger)' : 'var(--green,#22c55e)';

    } else {
      // Vazio — verifica se há registro de falha
      const lr = d.last_result;
      if (lr && lr.ok === false) {
        // Sync rodou mas falhou
        const cbExtra = cb && cb.failures > 0 ? ` (CB: ${cb.failures}/${3} falhas)` : '';
        sub.textContent        = '❌ Última sync falhou: ' + (lr.error || 'erro desconhecido') + cbExtra;
        badge.textContent      = '❌ Falha';
        badge.style.background = 'rgba(255,77,106,.12)';
        badge.style.color      = 'var(--danger,#ff4d6a)';
      } else {
        // Nunca foi sincronizado
        sub.textContent        = 'Nenhum registro — execute a sincronização para importar os preços.';
        badge.textContent      = '⚠ Vazio';
        badge.style.background = 'rgba(255,140,66,.12)';
        badge.style.color      = 'var(--orange,#ff8c42)';
      }
    }

    // Retorna o estado para quem chama (usado pelo polling)
    return { syncing: d.syncing, total: tot, last_result: d.last_result, cb_open: false };

  } catch (e) {
    if (sub) sub.textContent = 'Erro ao consultar status: ' + e.message;
    return { syncing: false, total: 0, error: e.message };
  }
}

let _plPolling = null;

async function syncPriceList() {
  const btn     = document.getElementById('pl-sync-btn');
  const prog    = document.getElementById('pl-progress');
  const progMsg = document.getElementById('pl-progress-msg');
  const msgEl   = document.getElementById('pl-msg');

  if (btn) btn.disabled = true;
  if (prog) prog.style.display = 'block';
  if (progMsg) progMsg.textContent = 'Iniciando importação de preços Azure (USD · global)...';
  if (msgEl) msgEl.style.display = 'none';

  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/price-list/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({})
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.msg || 'Falha ao iniciar sync');

    if (progMsg) progMsg.textContent = 'Importando preços Azure (~100 k registros)… isso leva 5–10 minutos. Pode fechar esta janela — o status atualiza automaticamente.';

    // Poll a cada 8s — aguarda pelo menos 1 ciclo antes de avaliar conclusão
    // (evita falso-positivo se primeiro poll chegar antes do servidor atualizar _syncingPriceList)
    let _plPollCount = 0;
    if (_plPolling) clearInterval(_plPolling);
    _plPolling = setInterval(async () => {
      _plPollCount++;
      const st = await _loadPriceListStatus();
      if (!st) return;

      // Atualiza mensagem de progresso enquanto sincronizando
      if (st.syncing) {
        const badge = document.getElementById('pl-status-badge');
        if (badge && progMsg) progMsg.textContent = badge.textContent.includes('Sincronizando')
          ? document.getElementById('pl-status-sub')?.textContent || 'Importando...'
          : 'Importando...';
        return; // continua polling
      }

      // Aguarda pelo menos 2 ciclos antes de considerar finalizado
      // (garante que _syncingPriceList virou true no servidor antes de comparar)
      if (_plPollCount < 2) return;

      // Sync terminou — determina sucesso ou falha
      clearInterval(_plPolling);
      _plPolling = null;
      if (btn) btn.disabled = false;
      if (prog) prog.style.display = 'none';

      const sucesso = st.total > 0;
      if (msgEl) {
        msgEl.style.display = 'block';
        if (sucesso) {
          msgEl.innerHTML = '<div style="padding:10px 14px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.25);border-radius:8px;font-size:13px;color:var(--green,#22c55e);">'
            + '✅ Price List sincronizado! ' + st.total.toLocaleString('pt-BR') + ' registros importados. '
            + 'Abra a Calculadora para ver os descontos.</div>';
        } else {
          const errMsg = st.last_result?.error || 'Nenhum registro importado — verifique o console do servidor.';
          msgEl.innerHTML = '<div style="padding:10px 14px;background:rgba(255,77,106,.10);border:1px solid rgba(255,77,106,.2);border-radius:8px;font-size:13px;color:var(--danger,#ff4d6a);">'
            + '❌ Sync finalizado sem dados. ' + errMsg + '</div>';
        }
      }
    }, 8000);

  } catch (e) {
    if (btn) btn.disabled = false;
    if (prog) prog.style.display = 'none';
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.innerHTML = '<div style="padding:10px 14px;background:rgba(255,77,106,.10);border:1px solid rgba(255,77,106,.2);border-radius:8px;font-size:13px;color:var(--danger,#ff4d6a);">'
        + '❌ Erro: ' + e.message + '</div>';
    }
  }
}

async function _plDiag() {
  const sub = document.getElementById('pl-status-sub');
  if (sub) sub.textContent = 'Executando diagnóstico...';
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/price-list/diag', { headers: { Authorization: 'Bearer ' + token } });
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    const pl = d.price_list || {};
    const bl = d.billing    || {};
    const mt = d.match      || {};

    let modal = document.getElementById('modal-pl-diag');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-pl-diag';
      modal.className = 'modal-overlay';
      modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
      modal.innerHTML = `<div class="modal" style="max-width:720px;width:96%">
        <div class="modal-header">
          <h3 class="modal-title">🔍 Diagnóstico Price List × Billing</h3>
          <button class="modal-close" onclick="document.getElementById('modal-pl-diag').classList.remove('open')">✕</button>
        </div>
        <div class="modal-body" id="pl-diag-body" style="padding:16px 20px;font-size:12px;line-height:1.8"></div>
      </div>`;
      document.body.appendChild(modal);
    }

    const _n = v => parseInt(v||0).toLocaleString('pt-BR');
    const _ok = (v) => v > 0
      ? `<span style="color:var(--green)">✅ ${_n(v)}</span>`
      : `<span style="color:var(--danger)">❌ 0</span>`;

    const pct = mt.pct || 0;
    const pctColor = pct === 0 ? 'var(--danger)' : pct < 30 ? 'var(--orange)' : 'var(--green)';

    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-weight:700;margin-bottom:8px;color:var(--text)">📋 Price List</div>
          <div>Total registros: ${_ok(pl.total)}</div>
          <div>Meters únicos: ${_ok(pl.meters_unicos)}</div>
          <div>Consumption: ${_ok(pl.consumption)}</div>
          <div>DevTest: <span style="color:var(--text-muted)">${_n(pl.devtest)}</span></div>
          <div>reservation_term='': ${_ok(pl.sem_reserv_term)}</div>
          <div>Sem meter_id: <span style="color:${parseInt(pl.sem_meter_id||0)>0?'var(--danger)':'var(--green)'}">
            ${_n(pl.sem_meter_id)}</span></div>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-weight:700;margin-bottom:8px;color:var(--text)">💰 Billing (azure_costs)</div>
          <div>Total linhas: ${_ok(bl.total)}</div>
          <div>Com meter_id: ${_ok(bl.com_meter_id)}</div>
          <div>Meters únicos: ${_ok(bl.meters_unicos)}</div>
          <div>Sem meter_id: <span style="color:${parseInt(bl.sem_meter_id||0)>0?'var(--danger)':'var(--green)'}">
            ${_n(bl.sem_meter_id)}</span></div>
        </div>
      </div>
      <div style="background:var(--bg-card);border:2px solid ${pctColor};border-radius:8px;padding:12px;margin-bottom:16px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:${pctColor}">${pct}% de cobertura</div>
        <div style="color:var(--text-muted);font-size:11px">${_n(mt.com_match)} de ${_n(mt.billing_meters)} meters do billing têm preço no Price List</div>
        ${pct === 0 ? '<div style="color:var(--danger);margin-top:6px;font-weight:600">⚠ Nenhum meter_id bate — Price List precisa ser re-sincronizado ou re-importado</div>' : ''}
      </div>`;

    if (d.amostra_billing?.length) {
      html += `<div style="font-weight:600;color:var(--text);margin-bottom:6px">Amostra billing (top-3 por custo)</div>
        <table class="data-table" style="font-size:11px;width:100%;margin-bottom:16px"><thead><tr>
          <th>meter_id (billing)</th><th>Categoria</th><th>Custo</th>
        </tr></thead><tbody>`;
      for (const r of d.amostra_billing)
        html += `<tr><td style="font-family:monospace;font-size:10px">${r.meter_id||'—'}</td>
          <td>${r.categoria||'—'}</td>
          <td style="text-align:right">R$ ${parseFloat(r.custo_total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>`;
      html += `</tbody></table>`;
    }

    if (d.amostra_pl?.length) {
      html += `<div style="font-weight:600;color:var(--text);margin-bottom:6px">Amostra Price List (primeiros 3)</div>
        <table class="data-table" style="font-size:11px;width:100%"><thead><tr>
          <th>meter_id (PL)</th><th>Serviço</th><th>Tipo</th><th>Reserv. Term</th><th>Retail Price</th>
        </tr></thead><tbody>`;
      for (const r of d.amostra_pl)
        html += `<tr><td style="font-family:monospace;font-size:10px">${r.meter_id||'—'}</td>
          <td>${r.service_name||'—'}</td><td>${r.type||'—'}</td>
          <td>${r.reservation_term!=null?'"'+r.reservation_term+'"':'null'}</td>
          <td style="text-align:right">$${parseFloat(r.retail_price||0).toFixed(6)}</td></tr>`;
      html += `</tbody></table>`;
    }

    document.getElementById('pl-diag-body').innerHTML = html;
    modal.classList.add('open');
    if (sub) _loadPriceListStatus();
  } catch (e) {
    if (sub) sub.textContent = 'Erro no diagnóstico: ' + e.message;
  }
}

async function resetPlCb() {
  const btn = document.getElementById('pl-cb-reset-btn');
  if (btn) btn.disabled = true;
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/price-list/reset-cb', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Erro ao resetar CB');
    showToast('Circuit Breaker liberado — pode tentar sincronizar novamente.', 'success');
    await _loadPriceListStatus();
  } catch (e) {
    showToast('Erro ao resetar CB: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

// ── Price List — Import por arquivo CSV / ZIP (múltiplos) ────────────────────

let _plImportQueue   = [];  // FileList → Array de File pendentes
let _plImportResults = [];  // acumulado de resultados
let _plImportPollTimer = null;

function _onPlFileChange(input) {
  const label = document.getElementById('pl-import-label');
  const btn   = document.getElementById('pl-import-btn');
  const count = input.files ? input.files.length : 0;
  if (count > 0) {
    if (label) label.textContent = count === 1
      ? input.files[0].name
      : `${count} arquivos selecionados`;
    if (btn) btn.disabled = false;
    _scanPlRegions(input.files);
  } else {
    if (label) label.textContent = 'Clique para selecionar .csv, .parquet ou .zip (múltiplos)';
    if (btn)   btn.disabled = true;
    _hidePlRegionSelect();
  }
  document.getElementById('pl-import-msg').style.display = 'none';
}

function _hidePlRegionSelect() {
  const wrap = document.getElementById('pl-region-checklist-wrap');
  const msg  = document.getElementById('pl-region-scan-msg');
  if (wrap) wrap.style.display = 'none';
  if (msg)  msg.style.display  = 'none';
}

function _plRegionCheckAll(state) {
  const list = document.getElementById('pl-region-checklist');
  if (!list) return;
  list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = state);
}

function _plRegionUpdateCounter() {
  const wrap    = document.getElementById('pl-region-checklist-wrap');
  const counter = document.getElementById('pl-region-counter');
  if (!wrap || !counter) return;
  const total   = wrap.querySelectorAll('input[type=checkbox]').length;
  const checked = wrap.querySelectorAll('input[type=checkbox]:checked').length;
  counter.textContent = checked === 0
    ? `0 selecionadas (todas serão importadas)`
    : checked === total
      ? `${checked} selecionadas (todas)`
      : `${checked} de ${total} selecionadas`;
  counter.style.color = checked === 0 ? 'var(--text-muted)' : 'var(--accent)';
}

function _plRegionCheckAll(state) {
  const wrap = document.getElementById('pl-region-checklist-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
    if (cb.closest('label').style.display !== 'none') cb.checked = state;
  });
  _plRegionUpdateCounter();
}

function _buildPlRegionChecklist(regions, preSelected) {
  const wrap = document.getElementById('pl-region-checklist-wrap');
  const list = document.getElementById('pl-region-checklist');
  const hint = document.getElementById('pl-region-hint');
  if (!wrap || !list) return;

  // Campo de busca
  const searchId = 'pl-region-search';
  let search = document.getElementById(searchId);
  if (!search) {
    search = document.createElement('input');
    search.id          = searchId;
    search.type        = 'text';
    search.placeholder = '🔍 Buscar região...';
    search.style.cssText = 'width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border-light);border-radius:5px;color:var(--text);font-size:11px;padding:5px 8px;margin-bottom:5px;outline:none';
    search.oninput = () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('label').forEach(lbl => {
        lbl.style.display = (q && !lbl.textContent.toLowerCase().includes(q)) ? 'none' : 'flex';
      });
    };
    wrap.insertBefore(search, list);
  } else {
    search.value = '';
  }

  // Contador
  let counter = document.getElementById('pl-region-counter');
  if (!counter) {
    counter = document.createElement('div');
    counter.id = 'pl-region-counter';
    counter.style.cssText = 'font-size:11px;margin-top:4px;text-align:right';
    wrap.appendChild(counter);
  }

  list.innerHTML = '';
  regions.forEach(r => {
    const isChecked = preSelected.has(r.toLowerCase());
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:3px 4px;cursor:pointer;border-radius:4px;font-size:12px;color:var(--text)';
    row.onmouseenter = () => row.style.background = 'var(--bg-hover)';
    row.onmouseleave = () => row.style.background = '';
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.value   = r;
    cb.checked = isChecked;
    cb.style.accentColor = 'var(--accent)';
    cb.onchange = _plRegionUpdateCounter;
    row.appendChild(cb);
    row.appendChild(document.createTextNode(r));
    list.appendChild(row);
  });

  if (hint) hint.textContent = `${regions.length} regiões encontradas — marque as que deseja importar`;
  wrap.style.display = 'block';
  _plRegionUpdateCounter();
}

async function _scanPlRegions(files) {
  const msg = document.getElementById('pl-region-scan-msg');
  const arrFiles  = Array.from(files);
  const isZipOnly = arrFiles.every(f => f.name.toLowerCase().endsWith('.zip'));
  const csvFile   = arrFiles.find(f => f.name.toLowerCase().endsWith('.csv'));

  // ZIP sem CSV: mostra checklist com regiões BR padrão
  if (isZipOnly && !csvFile) {
    if (msg) msg.style.display = 'none';
    const defaults = ['BR South', 'Brazil South', 'BR Southeast', 'Brazil Southeast', 'global'];
    const preSelected = new Set(defaults.map(r => r.toLowerCase()));
    _buildPlRegionChecklist(defaults, preSelected);
    return;
  }

  if (!csvFile) { _hidePlRegionSelect(); return; }

  if (msg) msg.style.display = 'block';
  _hidePlRegionSelect();

  try {
    const chunk = csvFile.slice(0, 4 * 1024 * 1024);
    const text  = await chunk.text();
    const lines = text.split(/\r?\n/);
    if (!lines.length) { if (msg) msg.style.display = 'none'; return; }

    const header = lines[0].replace(/^﻿/, '');
    const delim  = header.includes('\t') ? '\t' : (header.includes(';') ? ';' : ',');
    const cols   = header.split(delim).map(h => h.trim().replace(/^"|"$/g, ''));

    const regionIdx = cols.findIndex(c => {
      const s = c.replace(/[_\s-]/g, '').toLowerCase();
      return s === 'armregionname' || s === 'meterregion';
    });
    if (regionIdx === -1) { if (msg) msg.style.display = 'none'; return; }

    const regions = new Set();
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = lines[i].split(delim);
      const val  = (vals[regionIdx] || '').trim().replace(/^"|"$/g, '');
      if (val) regions.add(val);
    }

    if (msg) msg.style.display = 'none';
    if (!regions.size) return;

    const sorted = [...regions].sort();
    const preSelected = new Set(sorted.filter(r => {
      const rl = r.toLowerCase();
      return rl.includes('brazil') || rl.includes('brasil') || rl === 'global';
    }).map(r => r.toLowerCase()));

    _buildPlRegionChecklist(sorted, preSelected);
  } catch (_) {
    if (msg) msg.style.display = 'none';
  }
}

async function importPriceListFile() {
  const fileInput = document.getElementById('pl-import-file');
  if (!fileInput || !fileInput.files.length) return;

  _plImportQueue   = Array.from(fileInput.files);
  _plImportResults = [];

  document.getElementById('pl-import-btn').disabled = true;
  document.getElementById('pl-import-msg').style.display = 'none';
  const _logWrapInit = document.getElementById('pl-import-log-wrap');
  const _logElInit   = document.getElementById('pl-import-log');
  if (_logWrapInit) _logWrapInit.style.display = 'none';
  if (_logElInit)   _logElInit.textContent = '';

  // Renova o token agora para garantir sessão fresca durante todo o import
  await _plRefreshTokenIfNeeded(true);

  await _processPlQueue();
}

// Renova o JWT antes de cada upload. force=true ignora a janela de 30 min (usado no início da fila).
// Evita 401 em fila de muitos arquivos com imports longos.
async function _plRefreshTokenIfNeeded(force = false) {
  const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
  if (!token) return token;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return token;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return token;
    const msLeft = payload.exp * 1000 - Date.now();
    if (!force && msLeft > 30 * 60 * 1000) return token; // mais de 30 min restantes — ok
    const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return token; // refresh falhou — usa token atual e deixa o 401 chegar
    const { token: newToken } = await res.json();
    if (sessionStorage.getItem('finops_token')) sessionStorage.setItem('finops_token', newToken);
    if (localStorage.getItem('finops_token'))   localStorage.setItem('finops_token', newToken);
    return newToken;
  } catch (_) {
    return token;
  }
}

async function _processPlQueue() {
  const prog    = document.getElementById('pl-import-progress');
  const progMsg = document.getElementById('pl-import-progress-msg');

  if (!_plImportQueue.length) {
    // Fila concluída — mostrar resumo agregado
    if (prog) prog.style.display = 'none';
    document.getElementById('pl-import-btn').disabled = false;
    document.getElementById('pl-import-file').value  = '';
    document.getElementById('pl-import-label').textContent = 'Clique para selecionar .csv, .parquet ou .zip (múltiplos)';

    const total    = _plImportResults.length;
    const erros    = _plImportResults.filter(r => r.error).length;
    const ins      = _plImportResults.reduce((s, r) => s + (r.inserted || 0), 0);
    const skip     = _plImportResults.reduce((s, r) => s + (r.skipped  || 0), 0);
    const errRows  = _plImportResults.reduce((s, r) => s + (r.errors   || 0), 0);

    const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (erros === total) {
      const _firstErr = _plImportResults[0]?.error || 'formato inválido';
      _showPlImportMsg('error', `❌ Todos os ${total} arquivo(s) falharam: ${_esc(_firstErr)}`);
    } else {
      const detalhes = _plImportResults.map(r =>
        `<div style="margin-top:4px">${r.error
          ? `<span style="color:var(--danger)">❌ ${_esc(r.filename)}: ${_esc(r.error)}</span>`
          : `✅ ${_esc(r.filename)}: ${(r.inserted||0).toLocaleString('pt-BR')} ins · ${(r.skipped||0).toLocaleString('pt-BR')} ignorados · ${(r.errors||0)} err`
        }</div>`
      ).join('');
      _showPlImportMsg('success',
        `✅ ${total} arquivo(s) · ${ins.toLocaleString('pt-BR')} inseridos · ${skip.toLocaleString('pt-BR')} ignorados · ${errRows} erros${detalhes}`
      );
      _loadPriceListStatus();
    }
    return;
  }

  const file    = _plImportQueue.shift();
  const idx     = _plImportResults.length + 1;
  const total   = idx + _plImportQueue.length;

  if (prog) prog.style.display = 'block';
  if (progMsg) progMsg.textContent = `Enviando (${idx}/${total}): ${file.name}`;

  try {
    const token = await _plRefreshTokenIfNeeded();
    const form  = new FormData();
    form.append('file', file);
    const _clearChk = document.getElementById('pl-clear-before');
    const _regSel   = document.getElementById('pl-region-select');
    const _regTxt   = document.getElementById('pl-region-text');
    form.append('clearBefore', (idx === 1 && _clearChk && _clearChk.checked) ? 'true' : 'false');
    // Coleta regiões marcadas no checklist
    const _regWrap = document.getElementById('pl-region-checklist-wrap');
    if (_regWrap && _regWrap.style.display !== 'none') {
      const allCbs    = Array.from(_regWrap.querySelectorAll('input[type=checkbox]'));
      const checkedVals = allCbs.filter(cb => cb.checked).map(cb => cb.value);
      if (checkedVals.length > 0 && checkedVals.length < allCbs.length) {
        form.append('regionFilter', checkedVals.join(','));
      }
    }
    const res  = await fetch('/api/price-list/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    if (res.status === 401) {
      _plImportQueue = [];
      document.getElementById('pl-import-btn').disabled = false;
      _showPlImportMsg('error',
        `⏱️ Sessão expirada. Faça login novamente e reimporte os arquivos restantes (${idx-1}/${total} já processados).`
      );
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Erro ao iniciar importação');

    if (progMsg) progMsg.textContent = `Importando (${idx}/${total}): ${file.name}`;
    _plImportPollTimer = setTimeout(() => _pollPlImport(file.name, idx, total), 1500);
  } catch (e) {
    _plImportResults.push({ filename: file.name, error: e.message });
    await _processPlQueue();
  }
}

// Polling de reconexão — chamado ao abrir a aba quando o import já estava rodando
async function _reconnectImportPoll() {
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res   = await fetch('/api/price-list/import-status', { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) {
      const logEl = document.getElementById('pl-import-log');
      if (logEl) logEl.textContent += '\n⚠️  Sessão expirada — faça login para continuar acompanhando.';
      return;
    }
    const d = await res.json();
    _plUpdateLog(d);
    if (!d.importing) {
      // Concluído durante a desconexão
      const prog = document.getElementById('pl-import-progress');
      if (prog) prog.style.display = 'none';
      document.getElementById('pl-import-btn').disabled = false;
      if (d.error) {
        _showPlImportMsg('error', `❌ Import falhou: ${d.error}`);
      } else {
        _showPlImportMsg('success',
          `✅ Concluído: ${(d.inserted||0).toLocaleString('pt-BR')} ins · ${d.skipped||0} ignorados · ${d.errors||0} erros`);
        _loadPriceListStatus();
      }
      return;
    }
    // Ainda importando — continua polling
    const progMsg = document.getElementById('pl-import-progress-msg');
    const pct = d.total > 0 ? ` (${((d.inserted||0)+(d.skipped||0)+(d.errors||0)).toLocaleString('pt-BR')}/${d.total.toLocaleString('pt-BR')})` : '';
    if (progMsg) progMsg.textContent = `Importando${pct}: ${d.filename || '...'}`;
    _plImportPollTimer = setTimeout(_reconnectImportPoll, 1500);
  } catch (_) {
    _plImportPollTimer = setTimeout(_reconnectImportPoll, 3000);
  }
}

// Atualiza painel de log com as linhas vindas do servidor
function _plUpdateLog(d) {
  if (!d.log || !d.log.length) return;
  const logWrap = document.getElementById('pl-import-log-wrap');
  const logEl   = document.getElementById('pl-import-log');
  if (!logWrap || !logEl) return;
  logWrap.style.display = 'block';
  logEl.textContent = d.log.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

async function _pollPlImport(filename, idx, total) {
  const progMsg = document.getElementById('pl-import-progress-msg');
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res   = await fetch('/api/price-list/import-status', { headers: { Authorization: 'Bearer ' + token } });

    // Sessão expirada — parar fila com mensagem clara
    if (res.status === 401) {
      _plImportQueue = [];
      const prog = document.getElementById('pl-import-progress');
      if (prog) prog.style.display = 'none';
      document.getElementById('pl-import-btn').disabled = false;
      _showPlImportMsg('error',
        `⏱️ Sessão expirada durante o import. Faça login novamente e reimporte os arquivos restantes (${idx}/${total} processados).`
      );
      return;
    }

    const d = await res.json();

    if (d.importing) {
      const pct = d.total > 0 ? ` (${((d.inserted||0)+(d.skipped||0)+(d.errors||0)).toLocaleString('pt-BR')}/${d.total.toLocaleString('pt-BR')})` : '';
      if (progMsg) progMsg.textContent = `Importando${pct} (${idx}/${total}): ${d.filename || filename}`;
      _plUpdateLog(d);
      _plImportPollTimer = setTimeout(() => _pollPlImport(filename, idx, total), 1500);
      return;
    }

    // Arquivo concluído — salvar resultado e processar próximo
    _plImportResults.push({
      filename,
      inserted: d.inserted || 0,
      skipped:  d.skipped  || 0,
      errors:   d.errors   || 0,
      total:    d.total    || 0,
      error:    d.error    || null,
    });
    await _processPlQueue();
  } catch (e) {
    _plImportResults.push({ filename, error: e.message });
    await _processPlQueue();
  }
}

function _showPlImportMsg(type, html) {
  const el = document.getElementById('pl-import-msg');
  if (!el) return;
  el.style.display      = 'block';
  el.style.padding      = '8px 12px';
  el.style.borderRadius = '8px';
  el.style.border       = `1px solid ${type === 'error' ? 'rgba(255,77,106,.35)' : 'rgba(34,197,94,.35)'}`;
  el.style.background   = type === 'error' ? 'rgba(255,77,106,.08)' : 'rgba(34,197,94,.08)';
  el.style.color        = type === 'error' ? 'var(--danger)' : 'var(--green)';
  el.innerHTML = html;
}

// ── Price List — Agendamento Automático ────────────────────────────────────────

async function loadPlSchedule() {
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/price-list/schedule', { headers: { Authorization: 'Bearer ' + token } });
    const d = await res.json();
    const chk  = document.getElementById('pl-sched-ativo');
    const dia  = document.getElementById('pl-sched-dia');
    const hora = document.getElementById('pl-sched-hora');
    if (chk)  chk.checked = !!d.ativo;
    if (dia)  dia.value   = String(d.dia_mes || 28);
    if (hora) hora.value  = String(d.hora != null ? d.hora : 2);
    _updatePlSchedProx(d);
  } catch (e) {
    console.warn('[PL Schedule] loadPlSchedule:', e.message);
  }
}

async function savePlSchedule() {
  const ativo   = document.getElementById('pl-sched-ativo')?.checked || false;
  const dia_mes = parseInt(document.getElementById('pl-sched-dia')?.value)  || 28;
  const hora    = parseInt(document.getElementById('pl-sched-hora')?.value) || 2;
  const msgEl   = document.getElementById('pl-sched-msg');
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/price-list/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ativo, dia_mes, hora })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Erro ao salvar agendamento');
    _updatePlSchedProx(d);
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color   = 'var(--green,#22c55e)';
      msgEl.textContent   = ativo
        ? `✅ Agendado para o dia ${dia_mes} às ${String(hora).padStart(2, '0')}:00`
        : '⏸ Agendamento desativado';
      setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 3500);
    }
  } catch (e) {
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color   = 'var(--danger,#ff4d6a)';
      msgEl.textContent   = '❌ ' + e.message;
    }
  }
}

function _updatePlSchedProx(cfg) {
  const el = document.getElementById('pl-sched-prox');
  if (!el) return;
  if (!cfg || !cfg.ativo) { el.textContent = ''; return; }
  const now  = new Date();
  const dia  = parseInt(cfg.dia_mes) || 28;
  const hora = parseInt(cfg.hora != null ? cfg.hora : 2);
  // Último dia do mês atual — garante que dia 28 funciona em fevereiro
  const ultimoDiaMesAtual = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const diaExecAtual = Math.min(dia, ultimoDiaMesAtual);
  let prox = new Date(now.getFullYear(), now.getMonth(), diaExecAtual, hora, 0, 0);
  // Se a data já passou neste mês, calcula para o próximo
  if (prox <= now) {
    const ultimoDiaMesProx = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
    const diaExecProx = Math.min(dia, ultimoDiaMesProx);
    prox = new Date(now.getFullYear(), now.getMonth() + 1, diaExecProx, hora, 0, 0);
  }
  el.textContent = '📅 Próxima execução: ' + prox.toLocaleDateString('pt-BR')
    + ' às ' + String(hora).padStart(2, '0') + ':00';
}

// ── Portal Público — Configuração ──────────────────────────────────────────────

async function loadPortalConfig() {
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res = await fetch('/api/admin/portal-config', { headers: { Authorization: 'Bearer ' + token } });
    const d   = await res.json();
    const ativo = document.getElementById('portal-cfg-ativo');
    const titulo = document.getElementById('portal-cfg-titulo');
    const desc   = document.getElementById('portal-cfg-desc');
    const subs   = document.getElementById('portal-cfg-subs');
    const rgs    = document.getElementById('portal-cfg-rgs');
    const dominios = document.getElementById('portal-cfg-dominios');
    if (ativo) {
      ativo.checked = !!d.ativo;
      const body = document.getElementById('portal-cfg-body');
      if (body) { body.style.display = d.ativo ? 'flex' : 'none'; body.style.flexDirection = 'column'; }
    }
    if (titulo)   titulo.value     = d.titulo    || 'Portal de Serviço';
    if (desc)     desc.value       = d.descricao || '';
    if (subs)     subs.value       = (d.subscription_ids  || []).join('\n');
    if (rgs)      rgs.value        = (d.resource_groups   || []).join('\n');
    if (dominios) dominios.value   = (d.dominios_aceitos  || []).join('\n');
    const imposto    = document.getElementById('portal-cfg-imposto');
    const cond       = document.getElementById('portal-cfg-cond');
    const hlAtivo    = document.getElementById('portal-cfg-hl-ativo');
    const hlIni      = document.getElementById('portal-cfg-hl-ini');
    const hlFim      = document.getElementById('portal-cfg-hl-fim');
    const solIdent   = document.getElementById('portal-cfg-solicitar-ident');
    if (imposto)  imposto.value    = d.taxa_imposto ?? 18.65;
    if (cond)     cond.value       = d.taxa_cond    ?? 13.00;
    const gordura = document.getElementById('portal-cfg-gordura');
    if (gordura)  gordura.value   = d.taxa_gordura  ?? 0;
    const permPeriodo   = document.getElementById('portal-cfg-permitir-periodo');
    const permRecursos  = document.getElementById('portal-cfg-permitir-recursos');
    if (permPeriodo)  permPeriodo.checked  = !!d.permitir_selecao_periodo;
    if (permRecursos) permRecursos.checked = !!d.permitir_selecao_recursos;
    if (solIdent) solIdent.checked = !!d.solicitar_identificacao;
    const hl = d.horario_livre || {};
    if (hlAtivo) { hlAtivo.checked = !!hl.ativo; togglePortalHL(!!hl.ativo); }
    if (hlIni)   hlIni.value = hl.inicio || '09:00';
    if (hlFim)   hlFim.value = hl.fim    || '18:00';
    const _iniSab = document.getElementById('portal-cfg-hl-ini-sab');
    const _fimSab = document.getElementById('portal-cfg-hl-fim-sab');
    const _iniDom = document.getElementById('portal-cfg-hl-ini-dom');
    const _fimDom = document.getElementById('portal-cfg-hl-fim-dom');
    if (_iniSab) _iniSab.value = hl.inicio_sab || '09:00';
    if (_fimSab) _fimSab.value = hl.fim_sab    || '18:00';
    if (_iniDom) _iniDom.value = hl.inicio_dom || '09:00';
    if (_fimDom) _fimDom.value = hl.fim_dom    || '18:00';
    const dias = hl.dias || [1,2,3,4,5];
    document.querySelectorAll('.portal-hl-dia').forEach(cb => {
      cb.checked = dias.includes(parseInt(cb.dataset.dia));
    });
    togglePortalHLWeekend();
    _updatePortalLink(d);
    await _carregarSubsPortalList(d.subscription_ids || []);
  } catch (e) { console.warn('[Portal Config] loadPortalConfig:', e.message); }
}

async function savePortalConfig() {
  const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
  const ativo  = document.getElementById('portal-cfg-ativo')?.checked || false;
  const titulo = document.getElementById('portal-cfg-titulo')?.value?.trim() || 'Portal de Serviço';
  const desc   = document.getElementById('portal-cfg-desc')?.value?.trim()   || '';
  // Lê IDs marcados nos checkboxes; fallback para o textarea hidden
  const checkboxes = document.querySelectorAll('#portal-cfg-subs-list input[type=checkbox]:checked');
  const subs = checkboxes.length
    ? Array.from(checkboxes).map(c => c.value)
    : (document.getElementById('portal-cfg-subs')?.value || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const rgs    = (document.getElementById('portal-cfg-rgs')?.value || '')
    .split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const dominios = (document.getElementById('portal-cfg-dominios')?.value || '')
    .split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const msgEl  = document.getElementById('portal-cfg-msg');
  try {
    const res = await fetch('/api/admin/portal-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        ativo, titulo, descricao: desc, subscription_ids: subs, dominios_aceitos: dominios,
        taxa_imposto:              parseFloat(document.getElementById('portal-cfg-imposto')?.value)  || 18.65,
        taxa_cond:                 parseFloat(document.getElementById('portal-cfg-cond')?.value)     || 13.00,
        taxa_gordura:              parseFloat(document.getElementById('portal-cfg-gordura')?.value)  || 0,
        permitir_selecao_periodo:  document.getElementById('portal-cfg-permitir-periodo')?.checked  || false,
        permitir_selecao_recursos: document.getElementById('portal-cfg-permitir-recursos')?.checked || false,
        solicitar_identificacao:   document.getElementById('portal-cfg-solicitar-ident')?.checked   || false,
        horario_livre: {
          ativo:      document.getElementById('portal-cfg-hl-ativo')?.checked   || false,
          inicio:     document.getElementById('portal-cfg-hl-ini')?.value       || '09:00',
          fim:        document.getElementById('portal-cfg-hl-fim')?.value       || '18:00',
          inicio_sab: document.getElementById('portal-cfg-hl-ini-sab')?.value  || '09:00',
          fim_sab:    document.getElementById('portal-cfg-hl-fim-sab')?.value  || '18:00',
          inicio_dom: document.getElementById('portal-cfg-hl-ini-dom')?.value  || '09:00',
          fim_dom:    document.getElementById('portal-cfg-hl-fim-dom')?.value  || '18:00',
          dias:       Array.from(document.querySelectorAll('.portal-hl-dia:checked')).map(c => parseInt(c.dataset.dia))
        }
      })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Erro ao salvar');
    _updatePortalLink(d);
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color   = 'var(--green,#22c55e)';
      msgEl.textContent   = ativo ? '✅ Portal ativado e salvo' : '⏸ Portal desativado';
      setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 3000);
    }
  } catch (e) {
    if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ ' + e.message; }
  }
}

async function _carregarSubsPortalList(selectedIds = []) {
  const token   = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
  const listEl  = document.getElementById('portal-cfg-subs-list');
  if (!listEl) return;
  listEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);font-style:italic;">Carregando...</span>';
  try {
    const res  = await fetch('/api/calculadora/subscriptions', { headers: { Authorization: 'Bearer ' + token } });
    const subs = await res.json();
    if (!Array.isArray(subs) || !subs.length) {
      listEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Nenhuma assinatura encontrada no banco.</span>';
      return;
    }
    listEl.innerHTML = subs.map(s => {
      const checked = selectedIds.includes(s.subscription_id) ? ' checked' : '';
      const nome    = s.subscription_name || s.subscription_id;
      return `<label style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:5px;cursor:pointer;font-size:12px;color:var(--text);">
        <input type="checkbox" value="${s.subscription_id}"${checked}
          style="width:14px;height:14px;accent-color:var(--accent);flex-shrink:0;">
        <span>${nome}</span>
      </label>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<span style="font-size:12px;color:var(--danger);">Erro ao carregar: ' + e.message + '</span>';
  }
}

function togglePortalAtivo(ativo) {
  const body = document.getElementById('portal-cfg-body');
  if (!body) return;
  body.style.display = ativo ? 'flex' : 'none';
  body.style.flexDirection = 'column';
  savePortalConfig();
}

function togglePortalHL(ativo) {
  const corpo = document.getElementById('portal-cfg-hl-corpo');
  if (!corpo) return;
  corpo.style.display = ativo ? 'flex' : 'none';
  corpo.style.flexDirection = 'column';
}

function togglePortalHLWeekend() {
  const sabChecked = !!document.querySelector('.portal-hl-dia[data-dia="6"]:checked');
  const domChecked = !!document.querySelector('.portal-hl-dia[data-dia="0"]:checked');
  const rowSab = document.getElementById('portal-cfg-sab-row');
  const rowDom = document.getElementById('portal-cfg-dom-row');
  if (rowSab) rowSab.style.display = sabChecked ? '' : 'none';
  if (rowDom) rowDom.style.display = domChecked ? '' : 'none';
}

async function recarregarSubsPortal() {
  const checked = Array.from(document.querySelectorAll('#portal-cfg-subs-list input[type=checkbox]:checked')).map(c => c.value);
  await _carregarSubsPortalList(checked);
}

async function verAcessosPortal() {
  const token  = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
  const logEl  = document.getElementById('portal-acessos-log');
  if (!logEl) return;
  logEl.style.display = 'block';
  logEl.textContent = 'Carregando...';
  try {
    const res  = await fetch('/api/admin/portal-acessos?limit=50', { headers: { Authorization: 'Bearer ' + token } });
    const rows = await res.json();
    if (!rows.length) { logEl.textContent = 'Nenhum acesso registrado.'; return; }
    logEl.innerHTML = rows.map(r => {
      const dt = new Date(r.acessado_em).toLocaleString('pt-BR');
      return `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05);">`
        + `<span style="color:var(--accent);">${dt}</span>  `
        + `<strong style="color:var(--text);">${r.nome}</strong>  `
        + `<span style="color:var(--text-muted);">&lt;${r.email}&gt;</span>  `
        + `<span style="opacity:.4;">${r.ip || ''}</span>`
        + `</div>`;
    }).join('');
  } catch (e) { logEl.textContent = 'Erro: ' + e.message; }
}

function _updatePortalLink(cfg) {
  const linkEl = document.getElementById('portal-cfg-link');
  if (!linkEl) return;
  const url = window.location.origin + '/portal.html';
  if (cfg && cfg.ativo) {
    linkEl.style.display = 'block';
    linkEl.innerHTML = `<a href="${url}" target="_blank" style="color:var(--accent);font-size:12px;">🔗 ${url}</a>`;
  } else {
    linkEl.style.display = 'none';
  }
}

function closeSettingsModal() {
  document.getElementById('modal-settings').classList.remove('open');
  if (_coletaPolling) { clearInterval(_coletaPolling); _coletaPolling = null; }
}

async function renderUsersList() {
  const el = document.getElementById('users-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-state">Carregando...</div>';
  try {
    const users = await api('GET', '/usuarios');
    if (!users || !users.length) { el.innerHTML = '<div class="loading-state">Nenhum usuário cadastrado</div>'; return; }
    el.innerHTML = users.map(u => `
      <div class="user-row" id="user-row-${u.id}" style="opacity:${u.ativo ? '1' : '0.55'}">
        <div class="user-avatar">${u.nome.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${escHtml(u.nome)}</div>
          <div class="user-email">${escHtml(u.email)} <span style="font-size:10px;color:var(--text-muted)">[${u.tipo}]</span></div>
        </div>
        <span class="role-badge role-${u.perfil}">${roleName(u.perfil)}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;background:${u.ativo ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.18)'};color:${u.ativo ? '#16a34a' : '#6b7280'}">${u.ativo ? 'Ativo' : 'Inativo'}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <label style="position:relative;display:inline-block;width:34px;height:18px;cursor:pointer" title="${u.ativo ? 'Desativar' : 'Ativar'} usuário">
            <input type="checkbox" ${u.ativo ? 'checked' : ''} onchange="toggleAtivo(${u.id},this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;border-radius:9px;background:${u.ativo ? '#6366f1' : '#d1d5db'};transition:background .2s">
              <span style="position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;top:3px;left:${u.ativo ? '19px' : '3px'};transition:left .2s"></span>
            </span>
          </label>
          <button class="btn-icon" onclick="abrirEdicaoUsuario(${u.id},'${escHtml(u.nome)}','${escHtml(u.email)}','${u.perfil}',${u.ativo})" title="Editar usuário">
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon delete" onclick="removerUsuario(${u.id})" title="Remover usuário">
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`).join('');
  } catch { el.innerHTML = '<div class="loading-state">Erro ao carregar usuários</div>'; }
}

async function adicionarUsuario() {
  const nome=document.getElementById('nu-nome').value.trim(), email=document.getElementById('nu-email').value.trim();
  const senha=document.getElementById('nu-senha').value, perfil=document.getElementById('nu-perfil').value;
  if (!nome||!email||!senha||!perfil) { showToast('Preencha todos os campos','error'); return; }
  try {
    await api('POST','/usuarios',{nome,email,senha,perfil});
    document.getElementById('nu-nome').value=''; document.getElementById('nu-email').value='';
    document.getElementById('nu-senha').value=''; document.getElementById('nu-perfil').value='';
    await renderUsersList();
    showToast('Usuário '+nome+' criado!','success');
  } catch(e) { showToast('Erro: '+e.message,'error'); }
}

async function removerUsuario(id) {
  if (!confirm('Remover este usuário?')) return;
  try { await api('DELETE','/usuarios/'+id); await renderUsersList(); showToast('Usuário removido','success'); }
  catch(e) { showToast('Erro: '+e.message,'error'); }
}

function abrirEdicaoUsuario(id, nome, email, perfil, ativo) {
  document.getElementById('eu-id').value = id;
  document.getElementById('eu-nome').value = nome;
  document.getElementById('eu-email').value = email;
  document.getElementById('eu-perfil').value = perfil;
  document.getElementById('eu-ativo').value = String(ativo);
  document.getElementById('eu-senha').value = '';
  document.getElementById('eu-senha2').value = '';
  document.getElementById('modal-editar-usuario').classList.add('open');
}

async function salvarEdicaoUsuario() {
  const id     = document.getElementById('eu-id').value;
  const nome   = document.getElementById('eu-nome').value.trim();
  const email  = document.getElementById('eu-email').value.trim();
  const perfil = document.getElementById('eu-perfil').value;
  const ativo  = document.getElementById('eu-ativo').value === 'true';
  const senha  = document.getElementById('eu-senha').value;
  const senha2 = document.getElementById('eu-senha2').value;
  if (!nome || !email || !perfil) { showToast('Preencha nome, e-mail e perfil','error'); return; }
  if (senha && senha !== senha2) { showToast('As senhas não coincidem','error'); return; }
  try {
    await api('PUT', '/usuarios/'+id, { nome, email, perfil, senha: senha || '' });
    if (document.getElementById('eu-ativo').value !== undefined) {
      await api('PATCH', '/usuarios/'+id+'/ativo', { ativo });
    }
    document.getElementById('modal-editar-usuario').classList.remove('open');
    await renderUsersList();
    showToast('Usuário atualizado com sucesso','success');
  } catch(e) { showToast('Erro: '+e.message,'error'); }
}

async function toggleAtivo(id, ativo) {
  try {
    await api('PATCH', '/usuarios/'+id+'/ativo', { ativo });
    await renderUsersList();
    showToast(ativo ? 'Usuário ativado' : 'Usuário desativado', 'success');
  } catch(e) { showToast('Erro: '+e.message,'error'); }
}

function toggleIntegration(type) {
  const checked = document.getElementById('toggle-'+type).checked;
  const cfg = document.getElementById('config-'+type);
  if (cfg) cfg.style.display = checked ? 'block' : 'none';
}

async function salvarIntegracao(tipo) {
  let config = {};
  if (tipo==='ad') {
    config = { server:document.getElementById('ad-server').value, basedn:document.getElementById('ad-basedn').value,
      bind_user:document.getElementById('ad-user').value, bind_pass:document.getElementById('ad-pass')?.value||'',
      grp_admin:document.getElementById('ad-grp-admin').value, grp_finops:document.getElementById('ad-grp-finops').value, grp_reader:document.getElementById('ad-grp-reader').value };
  } else {
    config = { tenant_id:document.getElementById('entra-tenant').value, client_id:document.getElementById('entra-client').value,
      client_secret:document.getElementById('entra-secret')?.value||'', redirect_uri:document.getElementById('entra-redirect').value,
      grp_admin:document.getElementById('entra-grp-admin').value, grp_finops:document.getElementById('entra-grp-finops').value, grp_reader:document.getElementById('entra-grp-reader').value };
  }
  const ativo = document.getElementById('toggle-'+tipo).checked;
  try { await api('POST','/integrations/'+tipo,{config,ativo}); showToast('Configuração salva!','success'); }
  catch(e) { showToast('Erro: '+e.message,'error'); }
}

async function testarConexao(type) {
  if (type==='ad') {
    const server=document.getElementById('ad-server').value, basedn=document.getElementById('ad-basedn').value;
    const bind_user=document.getElementById('ad-user').value, bind_pass=document.getElementById('ad-pass')?.value||'';
    if (!server||!bind_user) { showToast('Preencha servidor e usuário de bind','error'); return; }
    showToast('Testando conexão AD...','success');
    try { const r=await api('POST','/auth/ad/test',{server,basedn,bind_user,bind_pass}); showToast(r.message||'Conexão OK!','success'); }
    catch(e) { showToast('Falha: '+e.message,'error'); }
  } else {
    showToast('Para testar Entra ID, configure e use o botão na tela de login','success');
  }
}

// ── BANCO DE DADOS ────────────────────────────
const DB_PORTAS = { postgresql:5432,sqlserver:1433,mysql:3306,oracle:1521,'aws-rds-pg':5432,'aws-rds-mysql':3306,'aws-aurora':3306,'aws-redshift':5439,'azure-pg':5432,'azure-sql':1433,'azure-mysql':3306,'gcp-pg':5432,'gcp-mysql':3306,'gcp-spanner':9010,'oracle-atp':1521,'oracle-adw':1521 };
const DB_ICONS  = { postgresql:'🐘',sqlserver:'🟦',mysql:'🐬',oracle:'🔴','aws-rds-pg':'🟠','aws-rds-mysql':'🟠','aws-aurora':'🟠','aws-redshift':'🟠','azure-pg':'🔵','azure-sql':'🔵','azure-mysql':'🔵','gcp-pg':'🟡','gcp-mysql':'🟡','gcp-spanner':'🟡','oracle-atp':'🔴','oracle-adw':'🔴' };

function onDbTipoChange() {
  const tipo=document.getElementById('db-tipo').value;
  if (!tipo) return;
  const porta=DB_PORTAS[tipo]||'';
  document.getElementById('db-porta').value=porta;
  const isCloud=tipo.includes('aws')||tipo.includes('azure')||tipo.includes('gcp')||tipo.includes('oracle-a');
  document.getElementById('db-ssl').checked=isCloud;
  document.getElementById('db-ssl-cert-area').style.display='none';
  document.getElementById('db-fields-extra').style.display='none';
}

function getDbConnections() { return JSON.parse(localStorage.getItem('finops_db_connections')||'[]'); }
function saveDbConnections(c) { localStorage.setItem('finops_db_connections',JSON.stringify(c)); }
function encryptSimple(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch { return btoa(s); } }
function decryptSimple(s) { try { return decodeURIComponent(escape(atob(s))); } catch { return ''; } }

async function renderDbConnectionsList() {
  const el=document.getElementById('db-connections-list');
  if (!el) return;
  el.innerHTML='<div class="loading-state">Carregando...</div>';
  try {
    const conns=await api('GET','/db-connections');
    if (!conns||!conns.length) { el.innerHTML='<div class="loading-state">Nenhuma conexão cadastrada</div>'; return; }
    el.innerHTML=conns.map((c,i)=>`
      <div class="db-conn-card">
        <div class="db-conn-icon">${DB_ICONS[c.tipo]||'🗄️'}</div>
        <div class="db-conn-info">
          <div class="db-conn-name">${escHtml(c.nome)}</div>
          <div class="db-conn-meta">${escHtml(c.tipo)} · ${escHtml(c.host)}:${c.porta} · ${escHtml(c.database)}</div>
        </div>
        <div class="db-conn-badges">
          ${c.isDefault?'<span class="badge-db-default">✓ Ativa</span>':''}
          <span class="badge-db-ok">🔒 Criptografado</span>
        </div>
        <div class="table-actions">
          ${!c.isDefault?`<button class="btn-icon" onclick="aplicarConexaoDB('${c.id||i}')" title="Definir como ativa" style="color:var(--accent)"><svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`:''}
          <button class="btn-icon" onclick="editarConexaoDB(${i})" title="Editar"><svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
          <button class="btn-icon delete" onclick="removerConexaoDB('${c.id||i}',${i})" title="Remover"><svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        </div>
      </div>`).join('');
  } catch { el.innerHTML='<div class="loading-state">Erro ao carregar conexões</div>'; }
}

async function aplicarConexaoDB(id) {
  if (!confirm('Aplicar esta conexão como ativa?')) return;
  try { const r=await api('POST','/db-connections/apply',{id}); showToast(r.message||'Conexão ativada!','success'); await renderDbConnectionsList(); }
  catch(e) { showToast('Erro: '+e.message,'error'); }
}

async function editarConexaoDB(i) {
  let conns; try { conns=await api('GET','/db-connections'); } catch { conns=getDbConnections(); }
  const c=conns[i]; if(!c) return;
  document.getElementById('db-nome').value=c.nome; document.getElementById('db-nome').dataset.editIdx=i;
  document.getElementById('db-tipo').value=c.tipo; onDbTipoChange();
  document.getElementById('db-host').value=c.host; document.getElementById('db-porta').value=c.porta;
  document.getElementById('db-database').value=c.database; document.getElementById('db-schema').value=c.schema||'';
  document.getElementById('db-usuario').value=c.usuario; document.getElementById('db-senha').value='';
  document.getElementById('db-senha').placeholder='(deixe vazio para manter)';
  document.getElementById('db-ssl').checked=c.ssl||false;
  document.getElementById('db-pool-min').value=c.pool?.min||2; document.getElementById('db-pool-max').value=c.pool?.max||10;
  document.getElementById('db-pool-timeout').value=c.pool?.timeout||30000; document.getElementById('db-is-default').checked=c.isDefault||false;
  document.getElementById('db-nome').scrollIntoView({behavior:'smooth',block:'center'});
}

async function removerConexaoDB(connId,idx) {
  let conns; try { conns=await api('GET','/db-connections'); } catch { conns=getDbConnections(); }
  if (conns.length<=1) { showDbAlert('⛔ Não é possível remover a única conexão. O sistema precisa de ao menos uma conexão ativa.','err'); return; }
  const target=conns.find((c,i)=>c.id===connId||i===idx);
  if (target&&target.isDefault) { showDbAlert('⛔ Esta é a conexão ativa. Defina outra antes de remover.','warn'); return; }
  if (!confirm('Remover a conexão "'+(target?target.nome:connId)+'"?')) return;
  const filtered=conns.filter((c,i)=>c.id!==connId&&i!==idx);
  saveDbConnections(filtered);
  try { await api('POST','/db-connections',{connections:filtered}); showToast('Conexão removida','success'); }
  catch(e) { showToast('Erro: '+e.message,'error'); }
  await renderDbConnectionsList();
}

function showDbAlert(msg,type) {
  const el=document.getElementById('db-alert');
  if (!el) return;
  el.className='sw-hint sw-hint-'+type;
  el.innerHTML=msg; el.style.display='block';
  setTimeout(()=>{ el.style.display='none'; },6000);
}

async function salvarConexaoDB() {
  const nome=document.getElementById('db-nome').value.trim(), tipo=document.getElementById('db-tipo').value;
  const host=document.getElementById('db-host').value.trim(), porta=document.getElementById('db-porta').value;
  const database=document.getElementById('db-database').value.trim(), schema=document.getElementById('db-schema').value.trim();
  const usuario=document.getElementById('db-usuario').value.trim(), senha=document.getElementById('db-senha').value;
  const ssl=document.getElementById('db-ssl').checked, isDefault=document.getElementById('db-is-default').checked;
  const poolMin=parseInt(document.getElementById('db-pool-min').value)||2;
  const poolMax=parseInt(document.getElementById('db-pool-max').value)||10;
  const timeout=parseInt(document.getElementById('db-pool-timeout').value)||30000;
  const editIdx=parseInt(document.getElementById('db-nome').dataset.editIdx||'-1');
  if (!nome||!tipo||!host||!porta||!database||!usuario) { showToast('Preencha todos os campos obrigatórios','error'); return; }
  let conns; try { conns=await api('GET','/db-connections'); } catch { conns=getDbConnections(); }
  const existingConn=editIdx>=0?conns[editIdx]:null;
  if (!existingConn&&!senha) { showToast('Informe a senha para a nova conexão','error'); return; }
  const conn={ id:existingConn?(existingConn.id||'conn_'+Date.now()):'conn_'+Date.now(), nome,tipo,host,porta:parseInt(porta),database,schema:schema||'public',usuario,ssl,senha_enc:existingConn?existingConn.senha_enc:encryptSimple(senha||''),pool:{min:poolMin,max:poolMax,timeout},isDefault,criado_em:existingConn?existingConn.criado_em:new Date().toISOString(),atualizado_em:new Date().toISOString() };
  if (senha) conn.senha_plain=senha;
  if (isDefault) conns=conns.map(c=>({...c,isDefault:false}));
  if (editIdx>=0) { conns[editIdx]=conn; document.getElementById('db-nome').dataset.editIdx='-1'; } else { conns.push(conn); }
  try {
    await api('POST','/db-connections',{connections:conns});
    showToast('Conexão "'+nome+'" salva!','success');
  } catch(e) { showToast('Erro: '+e.message,'error'); return; }
  saveDbConnections(conns);
  const wasActive=existingConn&&existingConn.isDefault;
  if (isDefault||wasActive) {
    try { await api('POST','/db-connections/apply',{id:conn.id}); showToast('Pool reconectado!','success'); }
    catch(e) { showToast('Aviso: salvo mas falha ao reconectar — '+e.message,'error'); }
  }
  await renderDbConnectionsList(); limparFormDB();
  document.getElementById('db-senha').placeholder='••••••••';
}

async function testarConexaoDB() {
  const host=document.getElementById('db-host').value.trim(), porta=document.getElementById('db-porta').value;
  const database=document.getElementById('db-database').value.trim(), usuario=document.getElementById('db-usuario').value.trim();
  const senha=document.getElementById('db-senha').value, tipo=document.getElementById('db-tipo').value;
  const ssl=document.getElementById('db-ssl').checked;
  const resultEl=document.getElementById('db-test-result');
  if (!host||!porta||!database||!usuario||!senha||!tipo) { showToast('Preencha os dados antes de testar','error'); return; }
  resultEl.className=''; resultEl.innerHTML='🔄 Testando...'; resultEl.style.display='block';
  try {
    const r=await api('POST','/db-connections/test',{tipo,host,porta:parseInt(porta),database,usuario,senha,ssl});
    resultEl.className='db-test-ok'; resultEl.innerHTML='✅ '+( r.message||'Conexão OK!')+' · Latência: '+(r.latency||'—')+'ms';
  } catch(e) { resultEl.className='db-test-fail'; resultEl.innerHTML='❌ Falha: '+e.message; }
}

function limparFormDB() {
  ['db-nome','db-host','db-database','db-schema','db-usuario','db-senha','db-ssl-ca'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const tipo=document.getElementById('db-tipo'); if(tipo) tipo.value='';
  const ssl=document.getElementById('db-ssl'); if(ssl) ssl.checked=false;
  const sslArea=document.getElementById('db-ssl-cert-area'); if(sslArea) sslArea.style.display='none';
  const extra=document.getElementById('db-fields-extra'); if(extra) extra.style.display='none';
  document.getElementById('db-pool-min').value=2; document.getElementById('db-pool-max').value=10;
  document.getElementById('db-pool-timeout').value=30000; document.getElementById('db-is-default').checked=false;
  document.getElementById('db-nome').dataset.editIdx='-1';
  const res=document.getElementById('db-test-result'); if(res) res.style.display='none';
}

// ── IMPORTAR PROJETOS ────────────────────────
let importRows=[];

function openImportModal() { resetImport(); document.getElementById('modal-import').classList.add('open'); }

function resetImport() {
  importRows=[];
  const drop=document.getElementById('import-drop-area'); if(drop) drop.style.display='block';
  const prev=document.getElementById('import-preview'); if(prev) prev.style.display='none';
  const inp=document.getElementById('import-file-input'); if(inp) inp.value='';
  const da=document.getElementById('import-drop-area'); if(da) da.classList.remove('drag-over');
}

function handleFileDrop(event) {
  event.preventDefault();
  const da=document.getElementById('import-drop-area'); if(da) da.classList.remove('drag-over');
  const file=event.dataTransfer.files[0]; if(file) processImportFile(file);
}

function handleFileSelect(event) { const file=event.target.files[0]; if(file) processImportFile(file); }

function processImportFile(file) {
  const reader=new FileReader();
  const isCsv=file.name.toLowerCase().endsWith('.csv');
  reader.onload=(e)=>{
    let rows=[];
    if (isCsv) {
      const text=e.target.result;
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      const headers=lines[0].split(/[;,]/).map(h=>h.trim().toLowerCase().replace(/['"]/g,''));
      rows=lines.slice(1).map(line=>{ const vals=line.split(/[;,]/).map(v=>v.trim().replace(/^["']|["']$/g,'')); const obj={}; headers.forEach((h,i)=>obj[h]=vals[i]||''); return obj; });
    } else {
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{defval:''}).map(r=>{ const obj={}; Object.keys(r).forEach(k=>obj[k.trim().toLowerCase()]=String(r[k]).trim()); return obj; });
    }
    importRows=rows.map(r=>{ const nome=(r['nome']||r['name']||r['projeto']||'').trim(); const diretoria=(r['diretoria']||r['área']||r['area']||'').trim(); const descricao=(r['descrição']||r['descricao']||r['description']||'').trim(); return {nome,diretoria,descricao,valid:nome.length>0}; }).filter(r=>r.nome||r.diretoria);
    renderImportPreview(file.name);
  };
  if (isCsv) reader.readAsText(file,'UTF-8'); else reader.readAsArrayBuffer(file);
}

function renderImportPreview(filename) {
  const valid=importRows.filter(r=>r.valid).length, invalid=importRows.filter(r=>!r.valid).length;
  const drop=document.getElementById('import-drop-area'); if(drop) drop.style.display='none';
  const prev=document.getElementById('import-preview'); if(prev) prev.style.display='block';
  const t=document.getElementById('import-preview-title'); if(t) t.textContent='📄 '+filename+' — '+importRows.length+' linha(s)';
  const b=document.getElementById('import-preview-badges'); if(b) b.innerHTML='<span class="badge-success">'+valid+' válidas</span>'+(invalid?'<span class="badge-warn">'+invalid+' sem nome</span>':'');
  const tbody=document.getElementById('import-preview-tbody');
  if(tbody) tbody.innerHTML=importRows.map(r=>`<tr class="${r.valid?'row-ok':'row-warn'}"><td>${escHtml(r.nome)||'<em style="opacity:.5">— sem nome —</em>'}</td><td>${escHtml(r.diretoria)||'—'}</td><td>${escHtml(r.descricao)||'—'}</td><td>${r.valid?'<span style="color:#a6e3a1">✓ OK</span>':'<span style="color:#f9e2af">⚠ Ignorada</span>'}</td></tr>`).join('');
  const btn=document.getElementById('btn-confirm-import'); if(btn) btn.disabled=(valid===0);
}

async function confirmarImport() {
  const validas=importRows.filter(r=>r.valid); if(!validas.length) return;
  const btn=document.getElementById('btn-confirm-import'); if(btn){btn.disabled=true;btn.textContent='Importando...';}
  let ok=0,erros=0;
  for (const r of validas) { try { await api('POST','/projetos',{nome:r.nome,diretoria:r.diretoria,descricao:r.descricao}); ok++; } catch { erros++; } }
  document.getElementById('modal-import').classList.remove('open');
  showToast('✅ '+ok+' projeto(s) importado(s)'+(erros?' · ⚠ '+erros+' já existia(m)':''),'success');
  loadProjetos();
}

function downloadTemplate() {
  const csv='nome,diretoria,descricao\nOtimização EC2,Tecnologia,Redução de custos EC2\nGovernança Cloud,Infraestrutura,Políticas de uso';
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='template_projetos.csv'; a.click();
}

// ── RESERVAS CLOUD ────────────────────────────────────────────────────────────

const _RSV_TIPOS = {
  Azure:      ['Reserved VM Instances','Azure Savings Plan (Compute)','Azure Savings Plan (VMs)',
               'SQL Database','Cosmos DB','App Service Plan','Azure Databricks',
               'Redis Cache','PostgreSQL Flexible','MySQL Flexible'],
  AWS:        ['EC2 Reserved Instances','Savings Plan - Compute','Savings Plan - EC2 Instance',
               'Savings Plan - SageMaker','RDS Reserved Instances','ElastiCache Reserved',
               'OpenSearch Reserved','Redshift Reserved','DynamoDB Reserved Capacity'],
  GCP:        ['Committed Use - General Purpose VM','Committed Use - Memory Optimized VM',
               'Committed Use - GPU','Cloud SQL Committed Use','BigQuery Slot Commitments'],
  Oracle:     ['Compute Universal Credits','Database Cloud Service','Autonomous Database',
               'Analytics Cloud','Oracle Integration'],
  Multicloud: ['Capacidade Reservada Geral'],
};

// Configuração de escopos e campos por cloud — chaves = valor salvo no DB
// sub/rg: { label, placeholder, api:true } — api:true usa dropdown Azure; omitir = input manual
const _RSV_SCOPE_CONFIG = {
  Azure: {
    'Shared':           {},
    'Tenant':           { sub: {label:'Tenant (Azure AD)',  placeholder:'ID ou nome do Tenant'} },
    'Management Group': { sub: {label:'Management Group',   placeholder:'Nome do Management Group'} },
    'Subscription':     { sub: {label:'Subscription',       placeholder:'Selecione a Subscription',  api:true} },
    'Resource Group':   { sub: {label:'Subscription',       placeholder:'Selecione a Subscription',  api:true},
                          rg:  {label:'Resource Group',     placeholder:'Selecione o Resource Group', api:true} },
  },
  AWS: {
    'Shared':       {},
    'Organization': { sub: {label:'Organization ID',          placeholder:'Ex: o-xxxxxxxxxx'} },
    'Account':      { sub: {label:'Account ID',               placeholder:'Ex: 123456789012'} },
    'OU':           { sub: {label:'Account ID',               placeholder:'Ex: 123456789012'},
                      rg:  {label:'Organizational Unit (OU)', placeholder:'Ex: ou-xxxx-xxxxxxxx'} },
  },
  GCP: {
    'Shared':       {},
    'Organization': { sub: {label:'Organization ID', placeholder:'Ex: 1234567890'} },
    'Project':      { sub: {label:'Project ID',      placeholder:'Ex: my-project-id'} },
    'Folder':       { sub: {label:'Project ID',      placeholder:'Ex: my-project-id'},
                      rg:  {label:'Folder',          placeholder:'ID ou nome da Pasta'} },
  },
  Oracle: {
    'Shared':      {},
    'Tenancy':     { sub: {label:'Tenancy',     placeholder:'OCID do Tenancy'} },
    'Compartment': { sub: {label:'Tenancy',     placeholder:'OCID do Tenancy'},
                     rg:  {label:'Compartment', placeholder:'OCID ou nome do Compartment'} },
  },
  Multicloud: {
    'Shared': {},
  },
};

let _rsvAll = [];

async function loadReservas() {
  try {
    if (!_rsvSubsData.length) {
      _rsvSubsData = await api('GET', '/calculadora/subscriptions').catch(() => []);
    }
    _rsvAll = await api('GET', '/reservas');
    if (!Array.isArray(_rsvAll)) _rsvAll = [];
    _renderRsvTable(_rsvAll);
    _updateRsvStats(_rsvAll);
  } catch(e) {
    _rsvAll = [];
    const tbody = document.getElementById('rsv-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-muted)">Nenhuma reserva encontrada</td></tr>`;
    ['rsv-stat-total','rsv-stat-ativas','rsv-stat-vencendo','rsv-stat-custo'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '0';
    });
  }
}

function _updateRsvStats(rows) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const em90 = new Date(hoje); em90.setDate(hoje.getDate() + 90);
  const ativas    = rows.filter(r => r.status === 'Ativa');
  const vencendo  = ativas.filter(r => new Date(r.data_vencimento) <= em90);
  const custoMes  = ativas.reduce((s, r) => s + (parseFloat(r.custo_mensal) || 0), 0);
  document.getElementById('rsv-stat-total').textContent    = rows.length;
  document.getElementById('rsv-stat-ativas').textContent   = ativas.length;
  document.getElementById('rsv-stat-vencendo').textContent = vencendo.length;
  document.getElementById('rsv-stat-custo').textContent    = custoMes > 0
    ? 'R$ ' + custoMes.toLocaleString('pt-BR', {minimumFractionDigits:2}) : '—';
}

function filterReservas() {
  const q  = (document.getElementById('rsv-search')?.value || '').toLowerCase();
  const cl = document.getElementById('rsv-filter-cloud')?.value  || '';
  const st = document.getElementById('rsv-filter-status')?.value || '';
  const filtered = _rsvAll.filter(r =>
    (!cl || r.cloud === cl) &&
    (!st || r.status === st) &&
    (!q  || r.nome_reserva.toLowerCase().includes(q) || r.tipo_recurso.toLowerCase().includes(q))
  );
  _renderRsvTable(filtered);
}

const _CLOUD_COLORS = {
  Azure: '#4da6ff', AWS: '#ff8c42', GCP: '#22c55e', Oracle: '#ff4d6a', Multicloud: '#9333ea'
};

const _STATUS_COLORS = {
  Ativa: '#22c55e', Expirada: '#ff4d6a', Cancelada: '#7b6a9e'
};

function _rsvStatusBadge(s) {
  const c = _STATUS_COLORS[s] || '#7b6a9e';
  return `<span style="background:${c}22;color:${c};border:1px solid ${c}55;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${s}</span>`;
}

function _rsvVencimentoLabel(dateStr) {
  if (!dateStr) return '—';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  const diff = Math.floor((d - hoje) / 86400000);
  let badge = '';
  if (diff < 0)       badge = `<span style="color:#ff4d6a;font-size:10px;margin-left:4px">⚠ expirada</span>`;
  else if (diff <= 30) badge = `<span style="color:#ff8c42;font-size:10px;margin-left:4px">⚠ ${diff}d</span>`;
  else if (diff <= 90) badge = `<span style="color:#f9e2af;font-size:10px;margin-left:4px">~${Math.round(diff/30)}m</span>`;
  return formatDate(dateStr) + badge;
}

function _renderRsvTable(rows) {
  const tbody = document.getElementById('rsv-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-muted)">Nenhuma reserva encontrada</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const cc = _CLOUD_COLORS[r.cloud] || '#9333ea';
    const escopo = r.tipo_escopo || 'Shared';
    const rScopeCfg = (_RSV_SCOPE_CONFIG[r.cloud] || {})[escopo] || {};
    const _subDisplay = (() => {
      const found = _rsvSubsData.find(i => i.subscription_id === r.subscription_id);
      return found?.subscription_name || r.subscription_id || null;
    })();
    const subRg = rScopeCfg.rg && r.resource_group_name
      ? r.resource_group_name
      : rScopeCfg.sub && (_subDisplay || r.subscription_id)
        ? (_subDisplay || r.subscription_id)
        : '—';
    const custo = r.custo_mensal ? 'R$ ' + parseFloat(r.custo_mensal).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—';
    return `<tr>
      <td><span style="color:${cc};font-weight:600">${escHtml(r.cloud)}</span></td>
      <td style="font-weight:500">${escHtml(r.nome_reserva)}</td>
      <td>${escHtml(r.tipo_recurso)}</td>
      <td style="font-size:12px">${escHtml(escopo)}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(subRg)}">${escHtml(subRg)}</td>
      <td>${escHtml(r.prazo || '—')}</td>
      <td>${_rsvVencimentoLabel(r.data_vencimento)}</td>
      <td>${_rsvStatusBadge(r.status)}</td>
      <td style="text-align:right">${custo}</td>
      <td>
        <button class="btn-ghost" style="padding:3px 8px;font-size:12px" onclick="openReservaModal(${r.id})">Editar</button>
        <button class="btn-ghost" style="padding:3px 8px;font-size:12px;color:var(--danger)" onclick="deleteReserva(${r.id})">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

async function openReservaModal(id) {
  document.getElementById('rsv-id').value = '';
  document.getElementById('rsv-cloud').value = '';
  document.getElementById('rsv-nome').value = '';
  document.getElementById('rsv-instancia').value = '';
  document.getElementById('rsv-quantidade').value = 1;
  document.getElementById('rsv-prazo').value = '';
  document.getElementById('rsv-pagamento').value = '';
  document.getElementById('rsv-custo-total').value = '';
  document.getElementById('rsv-custo-mensal').value = '';
  document.getElementById('rsv-data-inicio').value = '';
  document.getElementById('rsv-data-vencimento').value = '';
  document.getElementById('rsv-status').value = 'Ativa';
  document.getElementById('rsv-observacoes').value = '';
  _rsvSubVal = ''; _rsvSubPend = ''; _rsvSubName = ''; _rsvSubPendName = '';
  _rsvRGVal  = ''; _rsvRGPend  = ''; _rsvRGName  = ''; _rsvRGPendName  = '';
  _updateRsvTriggerLabel('sub');
  _updateRsvTriggerLabel('rg');
  const subDrop = document.getElementById('rsv-sub-drop');
  const rgDrop  = document.getElementById('rsv-rg-drop');
  if (subDrop) subDrop.style.display = 'none';
  if (rgDrop)  rgDrop.style.display  = 'none';
  onRsvCloudChange();

  const btnExcluir = document.getElementById('rsv-btn-excluir');
  const btnSalvar  = document.getElementById('rsv-btn-salvar');

  if (id) {
    document.getElementById('modal-rsv-title').textContent = 'Editar Reserva';
    if (btnSalvar)  { btnSalvar.textContent  = 'Salvar Alterações'; }
    if (btnExcluir) { btnExcluir.style.display = ''; }
    const r = _rsvAll.find(x => x.id === id);
    if (!r) return;
    document.getElementById('rsv-id').value              = r.id;
    document.getElementById('rsv-cloud').value           = r.cloud;
    onRsvCloudChange();
    document.getElementById('rsv-escopo').value          = r.tipo_escopo || 'Shared';
    onRsvEscopoChange();
    const rScopeCfg = (_RSV_SCOPE_CONFIG[r.cloud] || {})[r.tipo_escopo || 'Shared'] || {};
    if (r.subscription_id && rScopeCfg.sub) {
      if (rScopeCfg.sub.api) {
        _rsvSubVal  = r.subscription_id;
        _rsvSubPend = r.subscription_id;
        const found = _rsvSubsData.find(i => i.subscription_id === r.subscription_id);
        _rsvSubName = _rsvSubPendName = found?.subscription_name || r.subscription_id;
        _updateRsvTriggerLabel('sub');
      } else {
        const m = document.getElementById('rsv-sub-manual');
        if (m) m.value = r.subscription_id;
      }
    }
    if (r.resource_group_name && rScopeCfg.rg) {
      if (rScopeCfg.rg.api) {
        _rsvRGVal  = r.resource_group_name;
        _rsvRGPend = r.resource_group_name;
        _rsvRGName = _rsvRGPendName = r.resource_group_name;
        _updateRsvTriggerLabel('rg');
      } else {
        const m = document.getElementById('rsv-rg-manual');
        if (m) m.value = r.resource_group_name;
      }
    }
    document.getElementById('rsv-tipo-recurso').value    = r.tipo_recurso;
    document.getElementById('rsv-nome').value            = r.nome_reserva;
    document.getElementById('rsv-instancia').value       = r.instancia || '';
    document.getElementById('rsv-quantidade').value      = r.quantidade || 1;
    document.getElementById('rsv-prazo').value           = r.prazo || '';
    document.getElementById('rsv-pagamento').value       = r.opcao_pagamento || '';
    document.getElementById('rsv-custo-total').value     = r.custo_total || '';
    document.getElementById('rsv-custo-mensal').value    = r.custo_mensal || '';
    document.getElementById('rsv-data-inicio').value     = r.data_inicio?.split('T')[0] || '';
    document.getElementById('rsv-data-vencimento').value = r.data_vencimento?.split('T')[0] || '';
    document.getElementById('rsv-status').value          = r.status || 'Ativa';
    document.getElementById('rsv-observacoes').value     = r.observacoes || '';
  } else {
    document.getElementById('modal-rsv-title').textContent = 'Nova Reserva';
    if (btnSalvar)  { btnSalvar.textContent  = 'Salvar'; }
    if (btnExcluir) { btnExcluir.style.display = 'none'; }
  }
  document.getElementById('modal-reserva').classList.add('open');
}

async function deleteReservaFromModal() {
  const id = document.getElementById('rsv-id').value;
  if (!id) return;
  if (!confirm('Excluir esta reserva?')) return;
  try {
    await api('DELETE', `/reservas/${id}`);
    document.getElementById('modal-reserva').classList.remove('open');
    showToast('Reserva excluída', 'success');
    loadReservas();
    loadNotificacoes();
  } catch { showToast('Erro ao excluir', 'error'); }
}

// Escopo padrão ao selecionar cada cloud (primeiro nível com campo visível)
const _RSV_DEFAULT_SCOPE = {
  Azure:      'Subscription',
  AWS:        'Account',
  GCP:        'Project',
  Oracle:     'Tenancy',
  Multicloud: 'Shared',
};

function onRsvCloudChange() {
  const cloud    = document.getElementById('rsv-cloud').value;
  const cloudCfg = _RSV_SCOPE_CONFIG[cloud] || { 'Shared': {} };
  const tipos    = _RSV_TIPOS[cloud] || [];
  const selEsc   = document.getElementById('rsv-escopo');
  const selTipo  = document.getElementById('rsv-tipo-recurso');
  selEsc.innerHTML  = Object.keys(cloudCfg).map(e => `<option>${e}</option>`).join('');
  selTipo.innerHTML = tipos.length
    ? tipos.map(t => `<option>${t}</option>`).join('')
    : '<option value="">Selecione a cloud primeiro</option>';
  // Seleciona o escopo padrão da cloud para já exibir o campo com label correto
  const defaultScope = _RSV_DEFAULT_SCOPE[cloud] || 'Shared';
  if (cloudCfg[defaultScope]) selEsc.value = defaultScope;
  _rsvSubVal = ''; _rsvSubPend = ''; _rsvSubName = ''; _rsvSubPendName = '';
  _rsvRGVal  = ''; _rsvRGPend  = ''; _rsvRGName  = ''; _rsvRGPendName  = '';
  _updateRsvTriggerLabel('sub');
  _updateRsvTriggerLabel('rg');
  const subManual = document.getElementById('rsv-sub-manual');
  const rgManual  = document.getElementById('rsv-rg-manual');
  if (subManual) subManual.value = '';
  if (rgManual)  rgManual.value  = '';
  onRsvEscopoChange();
  if (cloud === 'Azure') {
    _loadRsvSubscriptions();
    _loadRsvRGs();
  }
}

function onRsvEscopoChange() {
  const escopo   = document.getElementById('rsv-escopo').value;
  const cloud    = document.getElementById('rsv-cloud').value;
  const scopeCfg = (_RSV_SCOPE_CONFIG[cloud] || {})[escopo] || {};

  const showSub  = !!scopeCfg.sub;
  const showRG   = !!scopeCfg.rg;
  const useApiSub = !!(scopeCfg.sub?.api);
  const useApiRG  = !!(scopeCfg.rg?.api);

  document.getElementById('rsv-sub-group').style.display = showSub ? '' : 'none';
  document.getElementById('rsv-rg-group').style.display  = showRG  ? '' : 'none';

  // Update labels and placeholders dynamically
  const subTitle  = document.getElementById('rsv-sub-label-title');
  const rgTitle   = document.getElementById('rsv-rg-label-title');
  const subManual = document.getElementById('rsv-sub-manual');
  const rgManual  = document.getElementById('rsv-rg-manual');
  if (subTitle  && scopeCfg.sub) subTitle.textContent      = scopeCfg.sub.label;
  if (rgTitle   && scopeCfg.rg)  rgTitle.textContent       = scopeCfg.rg.label;
  if (subManual && scopeCfg.sub) subManual.placeholder     = scopeCfg.sub.placeholder || '';
  if (rgManual  && scopeCfg.rg)  rgManual.placeholder      = scopeCfg.rg.placeholder  || '';

  // Toggle cms dropdown (Azure API) vs manual text input
  const subWrap = document.getElementById('rsv-sub-wrap');
  const rgWrap  = document.getElementById('rsv-rg-wrap');
  if (subWrap)   subWrap.style.display   = useApiSub ? '' : 'none';
  if (subManual) subManual.style.display = useApiSub ? 'none' : '';
  if (rgWrap)    rgWrap.style.display    = useApiRG  ? '' : 'none';
  if (rgManual)  rgManual.style.display  = useApiRG  ? 'none' : '';
}

function onRsvPrazoChange() {
  const prazo = document.getElementById('rsv-prazo').value;
  if (!prazo) return;
  const anos = prazo.startsWith('3') ? 3 : 1;
  const inicioVal = document.getElementById('rsv-data-inicio').value;
  const base = inicioVal ? new Date(inicioVal + 'T00:00:00') : new Date();
  const venc = new Date(base);
  venc.setFullYear(venc.getFullYear() + anos);
  document.getElementById('rsv-data-vencimento').value = venc.toISOString().split('T')[0];
}

let _rsvSubsData    = [];
let _rsvRGsData     = [];
let _rsvSubVal      = '';   // committed subscription_id
let _rsvRGVal       = '';   // committed resource_group_name
let _rsvSubName     = '';   // committed display name
let _rsvRGName      = '';
let _rsvSubPend     = '';   // pending (inside open dropdown)
let _rsvRGPend      = '';
let _rsvSubPendName = '';
let _rsvRGPendName  = '';

function _buildRsvCmsOptions(type, data, q) {
  const pendVal = type === 'sub' ? _rsvSubPend : _rsvRGPend;
  const filtered = q
    ? data.filter(i => (type === 'sub'
        ? (i.subscription_name || i.subscription_id || '')
        : (i.resource_group_name || '')
      ).toLowerCase().includes(q.toLowerCase()))
    : data;
  const container = document.getElementById(type === 'sub' ? 'rsv-sub-options' : 'rsv-rg-options');
  if (!container) return;
  if (!filtered.length) {
    container.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-muted)">Nenhum resultado</div>';
    return;
  }
  container.innerHTML = filtered.slice(0, 300).map(i => {
    const lbl   = type === 'sub' ? (i.subscription_name || i.subscription_id || '') : (i.resource_group_name || '');
    const value = type === 'sub' ? (i.subscription_id || '') : (i.resource_group_name || '');
    const checked = value === pendVal ? ' checked' : '';
    return `<label class="cms-option">` +
      `<input type="radio" name="rsv-${type}-radio" value="${escHtml(value)}" data-lbl="${escHtml(lbl)}"${checked} onchange="_rsvSelectOption('${type}',this)">` +
      `<span class="cms-option-label">${escHtml(lbl)}</span>` +
      `</label>`;
  }).join('');
}

function _rsvSelectOption(type, el) {
  if (type === 'sub') { _rsvSubPend = el.value; _rsvSubPendName = el.dataset.lbl || el.value; }
  else                { _rsvRGPend  = el.value; _rsvRGPendName  = el.dataset.lbl || el.value; }
}

function _updateRsvTriggerLabel(type) {
  const label = document.getElementById(type === 'sub' ? 'rsv-sub-label' : 'rsv-rg-label');
  if (!label) return;
  const name = type === 'sub' ? _rsvSubName : _rsvRGName;
  const val  = type === 'sub' ? _rsvSubVal  : _rsvRGVal;
  if (!val) {
    label.textContent = '— selecione —';
    label.style.color = 'var(--text-muted)';
  } else {
    label.textContent = name || val;
    label.style.color = 'var(--text)';
  }
}

function rsvToggleDrop(type) {
  const drop    = document.getElementById(type === 'sub' ? 'rsv-sub-drop'     : 'rsv-rg-drop');
  const trigger = document.getElementById(type === 'sub' ? 'rsv-sub-trigger'  : 'rsv-rg-trigger');
  const otherDrop    = document.getElementById(type === 'sub' ? 'rsv-rg-drop'    : 'rsv-sub-drop');
  const otherTrigger = document.getElementById(type === 'sub' ? 'rsv-rg-trigger' : 'rsv-sub-trigger');
  if (!drop) return;
  const isOpen = drop.style.display !== 'none';
  if (otherDrop)    { otherDrop.style.display = 'none'; }
  if (otherTrigger) { otherTrigger.classList.remove('cms-active'); }
  if (isOpen) {
    drop.style.display = 'none';
    trigger.classList.remove('cms-active');
  } else {
    drop.style.display = '';
    trigger.classList.add('cms-active');
    if (type === 'sub') { _rsvSubPend = _rsvSubVal; _rsvSubPendName = _rsvSubName; }
    else                { _rsvRGPend  = _rsvRGVal;  _rsvRGPendName  = _rsvRGName; }
    const search = document.getElementById(type === 'sub' ? 'rsv-sub-search' : 'rsv-rg-search');
    if (search) search.value = '';
    _buildRsvCmsOptions(type, type === 'sub' ? _rsvSubsData : _rsvRGsData, '');
  }
}

function rsvFilterDrop(type, q) {
  _buildRsvCmsOptions(type, type === 'sub' ? _rsvSubsData : _rsvRGsData, q);
}

function rsvClearDrop(type) {
  if (type === 'sub') {
    _rsvSubPend = ''; _rsvSubPendName = ''; _rsvSubVal = ''; _rsvSubName = '';
    _rsvRGVal = ''; _rsvRGName = ''; _rsvRGPend = ''; _rsvRGPendName = '';
    _updateRsvTriggerLabel('rg');
    _loadRsvRGs();
  } else {
    _rsvRGPend = ''; _rsvRGPendName = ''; _rsvRGVal = ''; _rsvRGName = '';
  }
  _buildRsvCmsOptions(type, type === 'sub' ? _rsvSubsData : _rsvRGsData, '');
  _updateRsvTriggerLabel(type);
}

function rsvConfirmDrop(type) {
  if (type === 'sub') {
    const changed = _rsvSubVal !== _rsvSubPend;
    _rsvSubVal  = _rsvSubPend;
    _rsvSubName = _rsvSubPendName;
    _updateRsvTriggerLabel('sub');
    const drop = document.getElementById('rsv-sub-drop');
    if (drop) drop.style.display = 'none';
    document.getElementById('rsv-sub-trigger')?.classList.remove('cms-active');
    if (changed) { _rsvRGVal = ''; _rsvRGName = ''; _rsvRGPend = ''; _rsvRGPendName = ''; _updateRsvTriggerLabel('rg'); _loadRsvRGs(); }
  } else {
    _rsvRGVal  = _rsvRGPend;
    _rsvRGName = _rsvRGPendName;
    _updateRsvTriggerLabel('rg');
    const drop = document.getElementById('rsv-rg-drop');
    if (drop) drop.style.display = 'none';
    document.getElementById('rsv-rg-trigger')?.classList.remove('cms-active');
  }
}

async function _loadRsvSubscriptions() {
  try {
    _rsvSubsData = await api('GET', '/calculadora/subscriptions');
    _buildRsvCmsOptions('sub', _rsvSubsData, '');
  } catch { _rsvSubsData = []; }
}

async function _loadRsvRGs() {
  try {
    _rsvRGsData = await api('GET', '/calculadora/resource-groups' + (_rsvSubVal ? `?subscription_id=${encodeURIComponent(_rsvSubVal)}` : ''));
    _buildRsvCmsOptions('rg', _rsvRGsData, '');
  } catch { _rsvRGsData = []; }
}

async function saveReserva() {
  const id       = document.getElementById('rsv-id').value;
  const cloud    = document.getElementById('rsv-cloud').value;
  const nome     = document.getElementById('rsv-nome').value.trim();
  const venc     = document.getElementById('rsv-data-vencimento').value;
  const tipo     = document.getElementById('rsv-tipo-recurso').value;
  if (!cloud || !nome || !tipo || !venc) {
    showToast('Preencha Cloud, Nome, Tipo de Recurso e Data de Vencimento', 'error'); return;
  }
  const escopo    = document.getElementById('rsv-escopo').value;
  const scopeCfg  = (_RSV_SCOPE_CONFIG[cloud] || {})[escopo] || {};
  const subManual = document.getElementById('rsv-sub-manual');
  const rgManual  = document.getElementById('rsv-rg-manual');
  const payload = {
    cloud, nome_reserva: nome,
    tipo_escopo: escopo,
    subscription_id:     scopeCfg.sub
      ? (scopeCfg.sub.api ? (_rsvSubVal || null) : (subManual?.value.trim() || null))
      : null,
    resource_group_name: scopeCfg.rg
      ? (scopeCfg.rg.api  ? (_rsvRGVal  || null) : (rgManual?.value.trim()  || null))
      : null,
    tipo_recurso:  tipo,
    instancia:     document.getElementById('rsv-instancia').value || null,
    quantidade:    parseInt(document.getElementById('rsv-quantidade').value) || 1,
    prazo:         document.getElementById('rsv-prazo').value || null,
    opcao_pagamento: document.getElementById('rsv-pagamento').value || null,
    custo_total:   parseFloat(document.getElementById('rsv-custo-total').value) || null,
    custo_mensal:  parseFloat(document.getElementById('rsv-custo-mensal').value) || null,
    data_inicio:   document.getElementById('rsv-data-inicio').value || null,
    data_vencimento: venc,
    status:        document.getElementById('rsv-status').value,
    observacoes:   document.getElementById('rsv-observacoes').value || null,
  };
  try {
    if (id) await api('PUT',  `/reservas/${id}`, payload);
    else    await api('POST', '/reservas',        payload);
    document.getElementById('modal-reserva').classList.remove('open');
    showToast(id ? 'Reserva atualizada' : 'Reserva criada', 'success');
    loadReservas();
    loadNotificacoes();
  } catch(e) { showToast('Erro ao salvar reserva', 'error'); }
}

async function deleteReserva(id) {
  if (!confirm('Excluir esta reserva?')) return;
  try {
    await api('DELETE', `/reservas/${id}`);
    showToast('Reserva excluída', 'success');
    loadReservas();
    loadNotificacoes();
  } catch { showToast('Erro ao excluir', 'error'); }
}

// ── IMPORT STATUS — persistência entre sessões ─────────────────────────────────

function fecharPainelImport() {
  const p = document.getElementById('cimport-panel');
  if (p) p.style.display = 'none';
  localStorage.removeItem('finops_import_status');
}

// Polling de um job que já está rodando no servidor (chamado após retorno ao app)
async function _pollImportLive(job) {
  _ensureCalcIniciado();
  const panel    = document.getElementById('cimport-panel');
  const title    = document.getElementById('cimport-title');
  const fillEl   = document.getElementById('cimport-geral-fill');
  const atualEl  = document.getElementById('cimport-arquivo-atual');
  const resumo   = document.getElementById('cimport-resumo');
  const closeBtn = document.getElementById('cimport-close');
  const pctEl    = document.getElementById('cimport-geral-pct');
  if (!panel) return;

  panel.style.display    = 'block';
  resumo.style.display   = 'none';
  closeBtn.style.display = 'none';
  fillEl.style.background= 'var(--accent)';
  pctEl.textContent      = job.total > 1 ? `${job.idx} / ${job.total}` : '';
  title.style.color      = 'var(--text)';
  title.textContent      = `Importando ${job.arquivo}...`;

  const token     = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
  const baseWidth = job.total > 1 ? ((job.idx - 1) / job.total) * 100 : 0;
  const slice     = job.total > 1 ? 100 / job.total : 100;

  while (true) {
    await new Promise(r => setTimeout(r, 900));
    try {
      const r = await fetch(window.location.origin + '/api/azure-costs/import-status', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!r.ok) break;
      const { job: j } = await r.json();
      if (!j || j.id !== job.id) break;

      const processado = (j.inseridos || 0) + (j.atualizados || 0) + (j.erros || 0);
      const total      = j.linhas || 0;
      const localPct   = total > 0 ? Math.min(processado / total, 0.99) : 0;
      fillEl.style.width = Math.round(baseWidth + localPct * slice) + '%';

      const subLabel = j.subArquivo ? ` · ${j.subArquivo}` : '';
      atualEl.textContent = total > 0
        ? `${j.arquivo}${subLabel} · ${processado.toLocaleString('pt-BR')} / ${total.toLocaleString('pt-BR')}`
        : `${j.arquivo}${subLabel} · carregando...`;

      if (j.status !== 'running') {
        job = j;
        break;
      }
    } catch (_) { break; }
  }

  // Exibir resultado final
  fillEl.style.width     = '100%';
  closeBtn.style.display = '';
  pctEl.textContent      = '';
  atualEl.textContent    = '';
  resumo.style.display   = 'block';

  if (job.status === 'done') {
    title.textContent      = '✅ Importação concluída';
    title.style.color      = 'var(--green)';
    fillEl.style.background= 'var(--green)';
    resumo.innerHTML = `${job.arquivo} · <strong style="color:var(--green)">${(job.inseridos||0).toLocaleString('pt-BR')}</strong> novos · ${(job.erros||0).toLocaleString('pt-BR')} ignorados`;
  } else if (job.status === 'error') {
    title.textContent      = '⚠️ Erro na importação';
    title.style.color      = 'var(--danger)';
    fillEl.style.background= 'var(--danger)';
    resumo.innerHTML = `${job.arquivo}: ${job.erro || 'erro desconhecido'}`;
  } else {
    title.textContent      = '⚠️ Importação interrompida';
    title.style.color      = '#f9e2af';
    fillEl.style.background= '#f9e2af';
    resumo.innerHTML = `Não foi possível obter o status. Verifique os dados importados.`;
  }

  localStorage.removeItem('finops_import_status');
}

async function checkPendingImportStatus() {
  // Verificar servidor primeiro — pode haver job ainda em andamento
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const r = await fetch(window.location.origin + '/api/azure-costs/import-status', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (r.ok) {
      const { job } = await r.json();
      if (job) {
        const ttl = 2 * 60 * 60 * 1000;
        const ts  = job.concluido || job.iniciado || 0;
        if (job.status === 'running' || Date.now() - ts < ttl) {
          localStorage.removeItem('finops_import_status');
          if (job.status === 'running') {
            _pollImportLive(job);
          } else {
            // Job já concluído no servidor — mostrar resultado estático
            _ensureCalcIniciado();
            const panel    = document.getElementById('cimport-panel');
            const title    = document.getElementById('cimport-title');
            const fillEl   = document.getElementById('cimport-geral-fill');
            const atualEl  = document.getElementById('cimport-arquivo-atual');
            const resumo   = document.getElementById('cimport-resumo');
            const closeBtn = document.getElementById('cimport-close');
            const pctEl    = document.getElementById('cimport-geral-pct');
            if (!panel) return;
            pctEl.textContent      = '';
            atualEl.textContent    = '';
            fillEl.style.width     = '100%';
            closeBtn.style.display = '';
            resumo.style.display   = 'block';
            if (job.status === 'done') {
              title.textContent      = '✅ Importação concluída';
              title.style.color      = 'var(--green)';
              fillEl.style.background= 'var(--green)';
              const erros = job.erros || 0;
              const errBtn = erros > 0 && job.erros_det?.length
                ? ` <button onclick="_abrirImportErros()" style="margin-left:8px;font-size:11px;padding:2px 10px;background:rgba(255,77,106,.12);border:1px solid rgba(255,77,106,.4);color:var(--danger);border-radius:6px;cursor:pointer">Ver ${erros} erro(s)</button>`
                : '';
              resumo.innerHTML = `${job.arquivo} · <strong style="color:var(--green)">${(job.inseridos||0).toLocaleString('pt-BR')}</strong> novos · <span style="color:${erros>0?'var(--danger)':'var(--text-muted)'}">${erros.toLocaleString('pt-BR')} com erro</span>${errBtn}`;
            } else {
              title.textContent      = '⚠️ Erro na importação';
              title.style.color      = 'var(--danger)';
              fillEl.style.background= 'var(--danger)';
              resumo.innerHTML = `${job.arquivo}: ${job.erro || 'erro desconhecido'}`;
            }
            panel.style.display = 'block';
          }
          return;
        }
      }
    }
  } catch (_) { /* servidor indisponível — cair para localStorage */ }

  // Fallback: localStorage (jobs de sessões anteriores sem estado no servidor)
  const raw = localStorage.getItem('finops_import_status');
  if (!raw) return;
  try {
    const s  = JSON.parse(raw);
    const ts = s.completed || s.started || 0;
    if (Date.now() - ts > 2 * 60 * 60 * 1000) {
      localStorage.removeItem('finops_import_status');
      return;
    }
    _ensureCalcIniciado();
    const panel    = document.getElementById('cimport-panel');
    const title    = document.getElementById('cimport-title');
    const fillEl   = document.getElementById('cimport-geral-fill');
    const atualEl  = document.getElementById('cimport-arquivo-atual');
    const resumo   = document.getElementById('cimport-resumo');
    const closeBtn = document.getElementById('cimport-close');
    const pctEl    = document.getElementById('cimport-geral-pct');
    if (!panel) return;

    pctEl.textContent      = '';
    atualEl.textContent    = '';
    fillEl.style.width     = '100%';
    closeBtn.style.display = '';

    if (s.status === 'running') {
      title.textContent      = '⚠️ Importação interrompida';
      title.style.color      = '#f9e2af';
      fillEl.style.background= '#f9e2af';
      resumo.style.display   = 'block';
      resumo.innerHTML       = `Navegador fechado durante a importação de ${s.files} arquivo${s.files !== 1 ? 's' : ''}. Reimporte os arquivos.`;
    } else {
      const ok               = s.status === 'done';
      title.textContent      = ok ? '✅ Importação concluída' : `⚠️ ${s.concluidos} ok · ${s.falhas} com erro`;
      title.style.color      = ok ? 'var(--green)' : '#f9e2af';
      fillEl.style.background= ok ? 'var(--green)' : '#f9e2af';
      resumo.style.display   = 'block';
      resumo.innerHTML       = `${s.concluidos} arquivo${s.concluidos !== 1 ? 's' : ''} · <strong style="color:var(--green)">${(s.inserted||0).toLocaleString('pt-BR')}</strong> novos · ${(s.errors||0).toLocaleString('pt-BR')} ignorados`;
    }
    panel.style.display = 'block';
  } catch (_) {
    localStorage.removeItem('finops_import_status');
  }
}

// ── DADOS AZURE — wrappers para funções da Calculadora ────────────────────────

function _ensureCalcIniciado() {
  if (!document.getElementById('cpurge-modal')) Calculadora.init();
  // Modals injected inside #view-calculadora won't render when that view is display:none,
  // even with position:fixed. Reparent them to body on first use from another view.
  ['cpurge-modal', 'cdiag-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.closest('#view-calculadora')) document.body.appendChild(el);
  });
  // Import progress panel: reparent so position:fixed works outside the hidden calculadora view.
  const panel = document.getElementById('cimport-panel');
  if (panel && panel.closest('#view-calculadora')) document.body.appendChild(panel);
}

function abrirDiagnosticoAzure() {
  _ensureCalcIniciado();
  Calculadora.abrirDiagnostico();
}

// ── Modal de erros de importação ──────────────────────────────────────────────
async function _abrirImportErros() {
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token') || '';
    const res   = await fetch('/api/azure-costs/import-status', { headers: { Authorization: 'Bearer ' + token } });
    const data  = await res.json();
    const det   = data?.job?.erros_det || [];

    let modal = document.getElementById('modal-import-erros');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-import-erros';
      modal.className = 'modal-overlay';
      modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
      modal.innerHTML = `
        <div class="modal" style="max-width:820px;width:96%">
          <div class="modal-header">
            <h3 class="modal-title" style="color:var(--danger)">⚠️ Linhas com erro na importação</h3>
            <button class="modal-close" onclick="document.getElementById('modal-import-erros').classList.remove('open')">✕</button>
          </div>
          <div class="modal-body" style="padding:16px 20px">
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
              Primeiras <strong>50 amostras</strong> de linhas que falharam. Causas comuns: campo obrigatório nulo,
              data inválida, duplicata com chave inválida. Verifique o arquivo-fonte e corrija antes de reimportar.
            </p>
            <div id="import-erros-body" style="overflow-x:auto;max-height:420px;overflow-y:auto"></div>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    const body = document.getElementById('import-erros-body');
    if (!det.length) {
      body.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">Nenhum detalhe de erro disponível.</p>';
    } else {
      body.innerHTML = `<table class="data-table" style="font-size:11px;width:100%">
        <thead><tr>
          <th style="white-space:nowrap">Linha aprox.</th>
          <th>Mensagem de erro</th>
          <th>cost_date</th>
          <th>subscription_id</th>
          <th>resource_id</th>
        </tr></thead>
        <tbody>
          ${det.map(d => `<tr>
            <td style="text-align:center;color:var(--text-muted)">${d.linha ?? '—'}</td>
            <td style="color:var(--danger);word-break:break-word;max-width:260px">${d.msg || '—'}</td>
            <td style="white-space:nowrap;color:var(--text-dim)">${d.cost_date || '—'}</td>
            <td style="font-family:monospace;font-size:10px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.subscription_id||''}">${d.subscription_id || '—'}</td>
            <td style="font-family:monospace;font-size:10px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.resource_id||''}">${d.resource_id || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }
    modal.classList.add('open');
  } catch (e) {
    showToast('Erro ao carregar detalhes: ' + e.message, 'error');
  }
}

function abrirPurgeAzure() {
  _ensureCalcIniciado();
  Calculadora.abrirPurge();
}

// ── COLETA AUTOMÁTICA ─────────────────────────
let _coletaPolling = null;

async function loadColeta() {
  await loadSPList();
  await loadStorageList();
  await loadColetaStatus();
  await loadColetaHistorico(_coletaTabAtual);
  _loadColetaApiSPSelect();
  // Feedback de upload para Import Manual
  const cfileEl = document.getElementById('cfile');
  if (cfileEl && !cfileEl._monHook) {
    cfileEl._monHook = true;
    cfileEl.addEventListener('change', function() {
      const panel = document.getElementById('mon-upload-manual');
      if (!panel || !this.files || !this.files.length) return;
      const nome = this.files.length === 1 ? this.files[0].name : `${this.files.length} arquivo(s)`;
      const el = document.getElementById('mon-upload-nome');
      const st = document.getElementById('mon-upload-status');
      if (el) el.textContent = nome;
      if (st) st.textContent = 'Processando — aguarde o painel de progresso...';
      const bar = document.getElementById('mon-upload-bar');
      const pct = document.getElementById('mon-upload-pct');
      if (bar) bar.style.width = '0%';
      if (pct) pct.textContent = '0%';
      panel.style.display = '';
      // Esconde quando painel do Calculadora aparecer ou após 5s
      let pctVal = 0;
      const tick = setInterval(() => {
        pctVal = Math.min(pctVal + 15, 90);
        if (bar) bar.style.width = pctVal + '%';
        if (pct) pct.textContent = pctVal + '%';
      }, 200);
      setTimeout(() => { clearInterval(tick); panel.style.display = 'none'; }, 5000);
    });
  }
}

function switchColetaTab(tab) {
  _coletaTabAtual = tab;
  ['api', 'storage', 'manual'].forEach(t => {
    const panel = document.getElementById(`ctab-panel-${t}`);
    const btn   = document.getElementById(`ctab-btn-${t}`);
    const active = t === tab;
    if (panel) panel.style.display = active ? '' : 'none';
    if (btn) {
      btn.style.color             = active ? 'var(--accent)' : 'var(--text-muted)';
      btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    }
  });
  if (tab === 'api') _initColetaApiTab();
  loadColetaHistorico(tab);
}

function _initColetaApiTab() {
  _loadColetaApiSPSelect();
}

let _coletaApiSPCache = [];
let _spSubSet  = new Set(); // IDs selecionados no picker do modal SP
let _spSubsAll = [];        // assinaturas carregadas via listar-subs


async function _loadColetaApiSPSelect() {
  try {
    const sps = await api('GET', '/azure-coleta/sps');
    _coletaApiSPCache = sps;
    const wrap = document.getElementById('api-wizard-sp-wrap');
    if (!wrap) return;
    const ativas = sps.filter(s => s.ativo);
    if (!ativas.length) {
      wrap.innerHTML = `<div class="stat-card" style="padding:16px 20px;text-align:center;color:var(--text-muted);font-size:13px">
        Nenhuma SP ativa. <button class="btn-ghost" style="font-size:12px;padding:4px 12px;margin-left:8px" onclick="openSPModal(null)">+ Cadastrar SP</button>
      </div>`;
      return;
    }
    const _nd = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    wrap.innerHTML = `<div class="stat-card" style="padding:16px 20px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">Selecione a SP e inicie a coleta guiada</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${ativas.map(s => {
          const temSched = s.auto_coleta && s.hora_execucao != null && s.dias_semana;
          const modoLabel = s.modo_coleta === 'subscription' ? 'Subscription Direta' : (s.billing_account_id ? 'Billing Profile (MCA)' : '');
          const schedBanner = temSched ? (() => {
            const diasNomes = (s.dias_semana || '').split(',').map(d => _nd[+d]).filter(Boolean).join(', ');
            const proxLabel = _proximaLabel(s.proxima_coleta);
            return `<div style="margin-top:6px;padding:7px 10px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);border-radius:7px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div>
                <span style="font-size:11px;font-weight:700;color:var(--green)">⏰ Agendado</span>
                <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${diasNomes} · ${s.hora_execucao}:00h · Janela ${s.granularidade_dias || 7}d</span>
                <span style="font-size:11px;color:var(--text-dim);margin-left:6px">${proxLabel}</span>
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button class="btn-ghost" style="font-size:11px;padding:2px 9px;border-color:var(--accent);color:var(--accent)" onclick="abrirEditarAgend(${s.id})">✏ Editar</button>
                <button class="btn-ghost" style="font-size:11px;padding:2px 9px;border-color:var(--danger);color:var(--danger)" onclick="excluirAgendamentoSP(${s.id},'${(s.nome||'').replace(/'/g,"\\'")}')" >✕ Excluir</button>
              </div>
            </div>`;
          })() : '';
          return `
          <div style="padding:10px 12px;background:rgba(147,51,234,.06);border:1px solid var(--border);border-radius:8px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div>
                <span style="font-size:13px;font-weight:600;color:var(--text)">${s.nome}</span>
                <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${modoLabel}</span>
              </div>
              <button class="btn-primary" style="font-size:12px;padding:6px 16px;white-space:nowrap" onclick="abrirColetaAPI(${s.id})">
                ▶ Iniciar Coleta
              </button>
            </div>
            ${schedBanner}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  } catch (e) {
    const wrap = document.getElementById('api-wizard-sp-wrap');
    if (wrap) wrap.innerHTML = `<div style="color:var(--danger);font-size:12px;padding:8px">Erro ao carregar SPs: ${e.message}</div>`;
  }
}

async function excluirAgendamentoSP(spId, nome) {
  if (!confirm(`Excluir o agendamento automático de "${nome}"?`)) return;
  try {
    await api('PUT', `/azure-coleta/sps/${spId}/agendamento`, {
      auto_coleta: false, hora_execucao: null, dias_semana: null
    });
    showToast('Agendamento excluído', 'success');
    _loadColetaApiSPSelect();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

function abrirEditarAgend(spId) {
  const sp = _coletaApiSPCache.find(s => s.id === spId);
  if (!sp) { showToast('SP não encontrada', 'error'); return; }
  document.getElementById('agend-sp-id').value  = spId;
  document.getElementById('agend-sp-nome').textContent = sp.nome;
  document.getElementById('agend-hora').value   = String(sp.hora_execucao ?? 3);
  document.getElementById('agend-janela').value = String(sp.granularidade_dias || 7);
  const diasSalvos = (sp.dias_semana || '').split(',').map(d => d.trim());
  document.querySelectorAll('.agend-dia').forEach(ck => { ck.checked = diasSalvos.includes(ck.value); });
  agendProxima();
  document.getElementById('modal-editar-agend').classList.add('open');
}

function fecharEditarAgend() {
  document.getElementById('modal-editar-agend').classList.remove('open');
}

function agendProxima() {
  const hora = parseInt(document.getElementById('agend-hora').value);
  const dias = [...document.querySelectorAll('.agend-dia:checked')].map(c => parseInt(c.value));
  const p    = _computeProximaJS(hora, dias);
  const el   = document.getElementById('agend-proxima');
  if (el) el.textContent = dias.length ? _proximaLabel(p) : '';
}

async function salvarEditarAgend() {
  const spId    = parseInt(document.getElementById('agend-sp-id').value);
  const hora    = parseInt(document.getElementById('agend-hora').value);
  const janela  = parseInt(document.getElementById('agend-janela').value);
  const diasSel = [...document.querySelectorAll('.agend-dia:checked')].map(c => c.value);
  if (!diasSel.length) { showToast('Selecione ao menos um dia da semana', 'error'); return; }
  try {
    await api('PUT', `/azure-coleta/sps/${spId}/agendamento`, {
      auto_coleta: true, hora_execucao: hora, dias_semana: diasSel.join(',')
    });
    await api('PUT', `/azure-coleta/sps/${spId}`, { granularidade_dias: janela });
    showToast('Agendamento salvo', 'success');
    fecharEditarAgend();
    _loadColetaApiSPSelect();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function loadColetaStatus() {
  try {
    const s = await api('GET', '/azure-coleta/status');
    const badge     = document.getElementById('coleta-status-badge');
    const execBtn   = document.getElementById('coleta-exec-btn');
    const cancelBtn = document.getElementById('coleta-cancel-btn');
    const monitor   = document.getElementById('coleta-monitor');

    if (s.em_execucao) {
      const isCanceling = s.cancelando;
      const tipo = (s.progresso && s.progresso.tipo) || 'storage';

      // Mover monitor para dentro da aba correta e trocar de aba automaticamente
      const anchorId = `mon-anchor-${tipo}`;
      const anchor   = document.getElementById(anchorId);
      if (anchor && monitor && monitor.parentNode !== anchor) {
        anchor.appendChild(monitor);
        switchColetaTab(tipo);
      }

      // Atualizar badge de tipo
      const tipoBadge = document.getElementById('mon-tipo-badge');
      if (tipoBadge) tipoBadge.textContent = tipo === 'api' ? 'API Oficial' : 'Via Storage';

      // Atualizar Circuit Breaker (apenas para coleta API)
      const cbRow = document.getElementById('mon-cb-row');
      if (cbRow) {
        if (tipo === 'api' && s.circuit_breaker) {
          cbRow.style.display = 'flex';
          const cb = s.circuit_breaker;
          const cbBadge = document.getElementById('mon-cb-badge');
          const cbColors = { CLOSED: 'var(--green)', OPEN: 'var(--danger)', HALF_OPEN: 'var(--orange)' };
          const cbBg     = { CLOSED: 'rgba(34,197,94,.15)', OPEN: 'rgba(255,77,106,.15)', HALF_OPEN: 'rgba(255,140,66,.15)' };
          if (cbBadge) {
            cbBadge.textContent = cb.state;
            cbBadge.style.color = cbColors[cb.state] || 'var(--text)';
            cbBadge.style.background = cbBg[cb.state] || 'transparent';
          }
          const cbFail = document.getElementById('mon-cb-failures');
          if (cbFail) cbFail.textContent = cb.failures ? `${cb.failures} falha(s)` : '';
          const cbUntil = document.getElementById('mon-cb-until');
          if (cbUntil) cbUntil.textContent = cb.open_until ? `bloqueado até ${new Date(cb.open_until).toLocaleTimeString('pt-BR')}` : '';
        } else {
          cbRow.style.display = 'none';
        }
      }

      // Atualizar botão cancelar inline no monitor
      const monCancelBtn = document.getElementById('mon-cancel-btn');
      if (monCancelBtn) {
        monCancelBtn.disabled = isCanceling;
        monCancelBtn.textContent = isCanceling ? 'Cancelando...' : '✕ Cancelar';
      }

      if (badge) {
        badge.textContent = isCanceling ? 'Cancelando...' : 'Em Execução';
        badge.style.background = isCanceling ? 'rgba(255,77,106,.15)' : 'rgba(255,140,66,.15)';
        badge.style.color = isCanceling ? 'var(--danger)' : 'var(--orange)';
      }
      if (execBtn) { execBtn.disabled = true; execBtn.style.display = 'none'; }
      if (cancelBtn) {
        cancelBtn.style.display = '';
        cancelBtn.disabled = isCanceling;
        cancelBtn.textContent = isCanceling ? 'Cancelando...' : '✕ Cancelar';
      }
      if (monitor) monitor.style.display = '';
      if (!_coletaPolling) _coletaPolling = setInterval(loadColetaStatus, 3000);

      // Populate monitor
      const p = s.progresso || {};
      const fase = document.getElementById('mon-fase');
      const sub  = document.getElementById('mon-sub');
      const chunk = document.getElementById('mon-chunk');
      const pBar = document.getElementById('mon-progress-bar');
      const pTxt = document.getElementById('mon-progress-txt');
      const ins  = document.getElementById('mon-ins');
      const upd  = document.getElementById('mon-upd');
      const err  = document.getElementById('mon-err');
      const log  = document.getElementById('mon-log');

      if (fase)  fase.textContent  = p.fase || 'Iniciando...';
      if (sub)   sub.textContent   = p.sub_atual || '—';
      if (chunk) chunk.textContent = p.chunk_atual ? `Chunk: ${p.chunk_atual}` : (p.chunk_idx ? `Chunk ${p.chunk_idx}/${p.chunk_total}` : '—');
      if (ins)   ins.textContent   = (p.ins || 0).toLocaleString('pt-BR');
      if (upd)   upd.textContent   = (p.upd || 0).toLocaleString('pt-BR');
      if (err)   err.textContent   = (p.err || 0).toLocaleString('pt-BR');
      if (pTxt && pBar) {
        const total = p.sub_total || 0;
        const done  = p.sub_idx   || 0;
        pTxt.textContent = `${done} / ${total}`;
        pBar.style.width = total > 0 ? `${Math.min(100, Math.round((done / total) * 100))}%` : '0%';
      }
      if (log && p.log && p.log.length) {
        log.innerHTML = p.log.map(e =>
          `<div><span style="color:var(--accent);opacity:.6">${e.ts}</span> ${e.msg.replace(/</g,'&lt;')}</div>`
        ).join('');
        log.scrollTop = log.scrollHeight;
      }
    } else {
      if (badge) {
        badge.textContent = 'Ocioso';
        badge.style.background = 'rgba(34,197,94,.12)';
        badge.style.color = 'var(--green)';
      }
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.style.display = '';
        execBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" width="14" height="14" style="display:inline;margin-right:5px;vertical-align:-2px"><path d="M5 4l12 6-12 6V4z" fill="currentColor"/></svg> Executar Storage';
      }
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (_coletaPolling) {
        clearInterval(_coletaPolling);
        _coletaPolling = null;
        resumeInactivityTimer();
      }

      // Mantém monitor visível com estado final — usuário fecha manualmente
      if (monitor && monitor.style.display !== 'none') {
        const closeBtn = document.getElementById('mon-close-btn');
        const monCancelBtn = document.getElementById('mon-cancel-btn');
        if (closeBtn)    closeBtn.style.display    = '';
        if (monCancelBtn) monCancelBtn.style.display = 'none';

        const hist   = s.ultimo;
        const status = hist?.status || 'concluido';
        const isOk   = status === 'concluido';
        const cor    = isOk ? 'var(--green)' : (status === 'cancelado' ? 'var(--orange)' : 'var(--danger)');
        const label  = isOk ? '✓ Concluído' : (status === 'cancelado' ? '⊘ Cancelado' : '✗ Erro');

        const fase = document.getElementById('mon-fase');
        if (fase) {
          fase.textContent  = label + (hist?.mensagem ? ' — ' + hist.mensagem : '');
          fase.style.color  = cor;
          fase.style.fontWeight = '600';
        }
        const tipoBadge = document.getElementById('mon-tipo-badge');
        if (tipoBadge) {
          tipoBadge.textContent   = label;
          tipoBadge.style.color   = cor;
          tipoBadge.style.background = isOk ? 'rgba(34,197,94,.15)' : 'rgba(255,77,106,.15)';
        }
      }
    }

    const hist = s.ultimo;
    if (hist) {
      const dt = hist.iniciado_em ? new Date(hist.iniciado_em).toLocaleString('pt-BR') : '—';
      document.getElementById('coleta-ultima-exec').textContent = dt;
      document.getElementById('coleta-ultima-msg').textContent = hist.mensagem || '—';
      const linhas = (hist.linhas_inseridas ?? 0) + (hist.linhas_atualizadas ?? 0);
      document.getElementById('coleta-ultima-linhas').textContent = linhas.toLocaleString('pt-BR') + ' registros';
    }
  } catch (e) {
    const badge = document.getElementById('coleta-status-badge');
    if (badge) badge.textContent = 'Indisponível';
  }
}

function fecharMonitor() {
  const monitor = document.getElementById('coleta-monitor');
  if (monitor) monitor.style.display = 'none';
  const closeBtn = document.getElementById('mon-close-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  const fase = document.getElementById('mon-fase');
  if (fase) { fase.style.color = ''; fase.style.fontWeight = ''; }
}

async function cancelarColeta() {
  const btn = document.getElementById('coleta-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando...'; }
  try {
    await api('POST', '/azure-coleta/cancelar');
    showToast('Cancelamento solicitado — aguardando próxima verificação', 'warn');
    setTimeout(loadColetaStatus, 1500);
  } catch (e) {
    showToast('Erro ao cancelar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✕ Cancelar'; }
  }
}

// ── Service Principals CRUD ────────────────────────────────────────────────────

async function loadSPList() {
  const tbody = document.getElementById('sp-list-tbody');
  try {
    const sps = await api('GET', '/azure-coleta/sps');
    if (!sps || !sps.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma SP cadastrada. Clique em "+ Nova SP".</td></tr>'; return; }
    tbody.innerHTML = sps.map(sp => {
      const exp   = sp.expiracao_secret ? new Date(sp.expiracao_secret) : null;
      const hoje  = new Date(); hoje.setHours(0,0,0,0);
      const dias  = exp ? Math.floor((exp - hoje) / 86400000) : null;
      let expBadge = '—';
      if (exp) {
        const dt = exp.toLocaleDateString('pt-BR');
        if (dias < 0)  expBadge = `<span style="color:var(--danger);font-weight:600">${dt} (Expirado)</span>`;
        else if (dias <= 30) expBadge = `<span style="color:var(--orange);font-weight:600">${dt} (${dias}d)</span>`;
        else expBadge = `<span style="color:var(--green)">${dt}</span>`;
      }
      const tid = sp.tenant_id ? sp.tenant_id.slice(0,8)+'…' : '—';
      const cid = sp.client_id ? sp.client_id.slice(0,8)+'…' : '—';
      const nomeBadge = sp.is_padrao
        ? `${sp.nome || '—'} <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;background:rgba(147,51,234,.18);color:var(--accent);border:1px solid rgba(147,51,234,.35)">PADRÃO</span>`
        : sp.nome || '—';
      const atvStyle = sp.ativo ? '' : 'opacity:0.45;';
      const padBtn = sp.is_padrao
        ? `<button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px;border-color:var(--accent);color:var(--accent);cursor:default" disabled title="Esta SP já é a padrão">★ Padrão</button>`
        : `<button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="definirSPPadrao(${sp.id})" title="Definir como SP padrão para coletas">☆ Padrão</button>`;
      return `<tr style="${atvStyle}">
        <td style="font-size:12px;font-weight:600;color:var(--text)">${nomeBadge}</td>
        <td style="font-family:monospace;font-size:11px;color:var(--text-dim)">${tid}</td>
        <td style="font-family:monospace;font-size:11px;color:var(--text-dim)">${cid}</td>
        <td style="font-size:11px">${expBadge}</td>
        <td style="text-align:center">
          <label class="toggle-switch" style="margin:0"><input type="checkbox" ${sp.ativo?'checked':''} onchange="toggleSPAtivo(${sp.id},this.checked)"><span class="toggle-slider"></span></label>
        </td>
        <td style="white-space:nowrap;text-align:right">
          ${padBtn}
          <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="testarSP(${sp.id})">Testar</button>
          <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px;border-color:var(--accent);color:var(--accent)" onclick="abrirColetaAPI(${sp.id})">⬇ Coletar</button>
          <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="openSPModal(${sp.id})">✏</button>
          <button class="btn-ghost" style="font-size:10px;padding:3px 8px;border-color:var(--danger);color:var(--danger)" onclick="deleteSP(${sp.id},'${(sp.nome||'SP').replace(/'/g,"\\'")}')">🗑</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erro: ${e.message}</td></tr>`; }
}

function openSPModal(id) {
  const modal = document.getElementById('modal-sp');
  document.getElementById('modal-sp-titulo').textContent = id ? 'Editar Service Principal' : 'Nova Service Principal';
  document.getElementById('sp-edit-id').value         = id || '';
  document.getElementById('sp-nome').value             = '';
  document.getElementById('sp-tenant-id').value        = '';
  document.getElementById('sp-client-id').value        = '';
  document.getElementById('sp-client-secret').value    = '';
  document.getElementById('sp-expiracao').value        = '';
  document.getElementById('sp-billing-account').value  = '';
  document.getElementById('sp-billing-profile').value  = '';
  document.getElementById('sp-modo-coleta').value      = 'billing_profile';
  spToggleModo('billing_profile'); // reseta picker via _spResetPicker
  document.getElementById('sp-ativo').checked          = true;
  // Reseta destaque da seção de Billing
  const _bSec = document.getElementById('sp-billing-section');
  const _bLbl = document.getElementById('sp-billing-section-lbl');
  if (_bSec) { _bSec.style.borderColor = ''; _bSec.style.background = ''; }
  if (_bLbl) _bLbl.style.color = 'var(--accent)';
  if (id) {
    api('GET', '/azure-coleta/sps').then(sps => {
      const sp = sps.find(s => s.id === id);
      if (!sp) return;
      document.getElementById('sp-nome').value            = sp.nome || '';
      document.getElementById('sp-tenant-id').value       = sp.tenant_id || '';
      document.getElementById('sp-client-id').value       = sp.client_id || '';
      document.getElementById('sp-expiracao').value       = sp.expiracao_secret ? sp.expiracao_secret.slice(0,10) : '';
      document.getElementById('sp-billing-account').value = sp.billing_account_id || '';
      document.getElementById('sp-billing-profile').value = sp.billing_profile_id || '';
      const modo = sp.modo_coleta || 'billing_profile';
      document.getElementById('sp-modo-coleta').value = modo;
      spToggleModo(modo); // reseta picker
      if (modo === 'subscription') {
        // pré-seleciona IDs salvos e busca lista do tenant
        const savedIds = (sp.subscription_ids || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        _spSubSet = new Set(savedIds);
        spBuscarSubs();
      }
      document.getElementById('sp-ativo').checked = sp.ativo;
      if (sp.dia_execucao)       document.getElementById('sp-dia').value = sp.dia_execucao;
      if (sp.granularidade_dias) _setGran('sp', sp.granularidade_dias);
    }).catch(() => {});
  }
  modal.classList.add('open');
}

function closeSPModal() { document.getElementById('modal-sp').classList.remove('open'); }

function spToggleModo(modo) {
  const pBill = document.getElementById('sp-painel-billing');
  const pSubs = document.getElementById('sp-painel-subscription');
  if (!pBill || !pSubs) return;
  pBill.style.display = modo === 'billing_profile' ? '' : 'none';
  pSubs.style.display = modo === 'subscription'    ? '' : 'none';
  if (modo === 'subscription') _spResetPicker();
}

function _spResetPicker() {
  _spSubSet.clear();
  _spSubsAll = [];
  const ids = ['sp-subs-loading','sp-subs-list-area','sp-subs-new-note','sp-subs-error','sp-subs-manual'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const empty = document.getElementById('sp-subs-empty');
  if (empty) empty.style.display = '';
  const search = document.getElementById('sp-subs-search');
  if (search) search.value = '';
}

// ── Granularidade (4/15/30/Livre) ────────────────────────────────────────────

// Modal SP: date picker livre
function spGranToggle() {
  const sel  = document.getElementById('sp-granularidade');
  const wrap = document.getElementById('sp-gran-livre-wrap');
  if (!wrap) return;
  const isLivre = sel?.value === '0';
  wrap.style.display = isLivre ? '' : 'none';
  if (isLivre) {
    const fmt = d => d.toISOString().slice(0, 10);
    const ate = new Date(); ate.setDate(ate.getDate() - 1);
    const de  = new Date(ate); de.setDate(de.getDate() - 6);
    const deEl = document.getElementById('sp-gran-de');
    const ateEl = document.getElementById('sp-gran-ate');
    if (deEl && !deEl.value)  deEl.value  = fmt(de);
    if (ateEl && !ateEl.value) ateEl.value = fmt(ate);
    spGranCalcDias();
    setTimeout(() => deEl?.focus(), 50);
  }
}

function spGranCalcDias() {
  const de  = document.getElementById('sp-gran-de')?.value;
  const ate = document.getElementById('sp-gran-ate')?.value;
  const lbl = document.getElementById('sp-gran-dias-label');
  if (!lbl) return;
  if (!de || !ate) { lbl.textContent = ''; return; }
  const diff = Math.round((new Date(ate) - new Date(de)) / 86400000) + 1;
  if (diff < 1) {
    lbl.textContent = '⚠ Data fim deve ser após data início';
    lbl.style.color = 'var(--danger)';
  } else {
    lbl.textContent = `${diff} dia${diff !== 1 ? 's' : ''} selecionado${diff !== 1 ? 's' : ''}`;
    lbl.style.color = 'var(--accent)';
  }
}

function _getGran(prefixo) {
  const sel = document.getElementById(`${prefixo}-granularidade`);
  if (!sel) return 4;
  if (sel.value !== '0') return parseInt(sel.value) || 4;
  if (prefixo === 'sp') {
    const de  = document.getElementById('sp-gran-de')?.value;
    const ate = document.getElementById('sp-gran-ate')?.value;
    if (de && ate) return Math.max(1, Math.round((new Date(ate) - new Date(de)) / 86400000) + 1);
    return 4;
  }
  return Math.max(1, parseInt(document.getElementById(`${prefixo}-granularidade-livre`)?.value) || 4);
}

function _setGran(prefixo, valor) {
  const sel = document.getElementById(`${prefixo}-granularidade`);
  const inp = document.getElementById(`${prefixo}-granularidade-livre`);
  if (!sel) return;
  const v = String(parseInt(valor) || 7);
  if (['7','15','30'].includes(v)) {
    sel.value = v;
    if (inp) inp.style.display = 'none';
    const wrap = document.getElementById('sp-gran-livre-wrap');
    if (wrap) wrap.style.display = 'none';
  } else {
    sel.value = '0';
    if (prefixo === 'sp') {
      const wrap = document.getElementById('sp-gran-livre-wrap');
      if (wrap) wrap.style.display = '';
      const dias = parseInt(valor) || 7;
      const fmt  = d => d.toISOString().slice(0, 10);
      const ate  = new Date(); ate.setDate(ate.getDate() - 1);
      const de   = new Date(ate); de.setDate(de.getDate() - (dias - 1));
      const deEl = document.getElementById('sp-gran-de');
      const ateEl = document.getElementById('sp-gran-ate');
      if (deEl)  deEl.value  = fmt(de);
      if (ateEl) ateEl.value = fmt(ate);
      spGranCalcDias();
    } else {
      if (inp) { inp.value = valor; inp.style.display = ''; }
    }
  }
}

// ── SP Picker de Assinaturas ──────────────────────────────────────────────────

async function spBuscarSubs() {
  const id = document.getElementById('sp-edit-id').value;
  if (!id) {
    document.getElementById('sp-subs-new-note').style.display = '';
    return;
  }
  document.getElementById('sp-subs-empty').style.display     = 'none';
  document.getElementById('sp-subs-list-area').style.display = 'none';
  document.getElementById('sp-subs-loading').style.display   = '';
  document.getElementById('sp-subs-error').style.display     = 'none';
  try {
    const data = await api('POST', `/azure-coleta/sps/${id}/listar-subs`, {});
    _spSubsAll = data.subs || [];
    _spRenderSubs(data.fonte);
  } catch (e) {
    document.getElementById('sp-subs-loading').style.display = 'none';
    document.getElementById('sp-subs-empty').style.display   = '';
    const errEl = document.getElementById('sp-subs-error');
    errEl.textContent = '❌ ' + e.message;
    errEl.style.display = '';
  }
}

function _spRenderSubs(fonte) {
  document.getElementById('sp-subs-loading').style.display = 'none';
  document.getElementById('sp-subs-empty').style.display   = 'none';
  const subs = _spSubsAll;
  if (!subs.length) {
    document.getElementById('sp-subs-empty').style.display = '';
    const errEl = document.getElementById('sp-subs-error');
    errEl.textContent = 'Nenhuma assinatura encontrada. Verifique as permissões da SP.';
    errEl.style.display = '';
    return;
  }
  const fonteColor = fonte === 'cache' ? 'var(--orange)' : 'var(--green)';
  const fonteLabel = { tenant: 'do tenant Azure', billing_profile: 'do Billing Profile', cache: 'do banco local' }[fonte] || '';
  document.getElementById('sp-subs-fonte').innerHTML = `<span style="color:${fonteColor}">●</span> ${subs.length} assinatura(s) ${fonteLabel}`;
  let html = '';
  for (const s of subs) {
    const sid     = s.subscriptionId.replace(/'/g, '');
    const checked = _spSubSet.has(sid) ? 'checked' : '';
    const nome    = (s.nome || sid).replace(/</g,'&lt;');
    html += `<label data-nome="${nome.toLowerCase()}" data-id="${sid.toLowerCase()}"
      style="display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;background:var(--bg-hover);transition:background .1s"
      onmouseover="this.style.background='var(--accent-dim)'" onmouseout="this.style.background='var(--bg-hover)'">
      <input type="checkbox" ${checked} onchange="spToggleSubItem('${sid}',this.checked)" style="margin-top:2px;accent-color:var(--accent);flex-shrink:0">
      <div>
        <div style="font-size:12px;font-weight:500;color:var(--text)">${nome}</div>
        <div style="font-size:10px;color:var(--text-muted);font-family:monospace">${sid}</div>
      </div>
    </label>`;
  }
  document.getElementById('sp-subs-items').innerHTML = html;
  document.getElementById('sp-subs-counter').textContent = `${_spSubSet.size} selecionada(s)`;
  document.getElementById('sp-subs-list-area').style.display = '';
  setTimeout(() => document.getElementById('sp-subs-search')?.focus(), 100);
}

function spToggleSubItem(id, checked) {
  if (checked) _spSubSet.add(id); else _spSubSet.delete(id);
  const c = document.getElementById('sp-subs-counter');
  if (c) c.textContent = `${_spSubSet.size} selecionada(s)`;
}

function spSelTodasSubs(sel) {
  _spSubSet.clear();
  if (sel) _spSubsAll.forEach(s => _spSubSet.add(s.subscriptionId));
  document.querySelectorAll('#sp-subs-items input[type=checkbox]').forEach(cb => { cb.checked = sel; });
  const c = document.getElementById('sp-subs-counter');
  if (c) c.textContent = `${_spSubSet.size} selecionada(s)`;
}

function spFiltrarSubs() {
  const termo = (document.getElementById('sp-subs-search')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#sp-subs-items label').forEach(lbl => {
    const ok = !termo || lbl.dataset.nome.includes(termo) || lbl.dataset.id.includes(termo);
    lbl.style.display = ok ? '' : 'none';
  });
}

function spMostrarManual() {
  const m = document.getElementById('sp-subs-manual');
  if (m) { m.style.display = ''; document.getElementById('sp-subscription-ids')?.focus(); }
}

function _spGetSubscriptionIds() {
  const listArea = document.getElementById('sp-subs-list-area');
  if (listArea && listArea.style.display !== 'none') {
    return [..._spSubSet].join('\n') || null;
  }
  return (document.getElementById('sp-subscription-ids')?.value || '').trim() || null;
}

async function saveSP() {
  const id   = document.getElementById('sp-edit-id').value;
  const modo = document.getElementById('sp-modo-coleta').value;
  const body = {
    nome:               document.getElementById('sp-nome').value.trim(),
    tenant_id:          document.getElementById('sp-tenant-id').value.trim(),
    client_id:          document.getElementById('sp-client-id').value.trim(),
    client_secret:      document.getElementById('sp-client-secret').value,
    expiracao_secret:   document.getElementById('sp-expiracao').value || null,
    modo_coleta:        modo,
    billing_account_id: modo === 'billing_profile' ? (document.getElementById('sp-billing-account').value.trim() || null) : null,
    billing_profile_id: modo === 'billing_profile' ? (document.getElementById('sp-billing-profile').value.trim() || null) : null,
    subscription_ids:   modo === 'subscription'    ? _spGetSubscriptionIds() : null,
    ativo:              document.getElementById('sp-ativo').checked,
    dia_execucao:       parseInt(document.getElementById('sp-dia').value) || 5,
    granularidade_dias: _getGran('sp'),
  };
  if (!body.nome || !body.tenant_id || !body.client_id) { showToast('Preencha Nome, Tenant ID e Client ID', 'error'); return; }
  if (modo === 'billing_profile' && (!body.billing_account_id || !body.billing_profile_id)) { showToast('Preencha Billing Account ID e Billing Profile ID', 'error'); return; }
  if (modo === 'subscription' && !body.subscription_ids) { showToast('Selecione ao menos uma assinatura ou cole os IDs manualmente', 'error'); return; }
  try {
    if (id) await api('PUT', `/azure-coleta/sps/${id}`, body);
    else    await api('POST', '/azure-coleta/sps', body);
    showToast('SP salva com sucesso', 'success');
    closeSPModal();
    loadSPList();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteSP(id, nome) {
  if (!confirm(`Excluir a SP "${nome}"? Essa ação não pode ser desfeita.`)) return;
  try { await api('DELETE', `/azure-coleta/sps/${id}`); showToast('SP excluída', 'success'); loadSPList(); }
  catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function toggleSPAtivo(id, ativo) {
  try { await api('PATCH', `/azure-coleta/sps/${id}/ativo`, { ativo }); loadSPList(); }
  catch (e) { showToast('Erro: ' + e.message, 'error'); loadSPList(); }
}

async function definirSPPadrao(id) {
  try {
    await api('PATCH', `/azure-coleta/sps/${id}/padrao`);
    showToast('SP definida como padrão', 'success');
    loadSPList();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function abrirColetaAPI(spId) {
  spId = parseInt(spId);
  let sp = _coletaApiSPCache.find(s => s.id === spId);
  if (!sp) {
    try {
      const lista = await api('GET', '/azure-coleta/sps');
      _coletaApiSPCache = lista || [];
      sp = _coletaApiSPCache.find(s => s.id === spId);
    } catch (_) {}
  }
  if (!sp) { showToast('SP não encontrada', 'error'); return; }
  _wizardAbrir(spId, sp);
}

// ── Wizard de Coleta via API ──────────────────────────────────────────────────
let _wizard = null;

function _wizardAbrir(spId, sp) {
  const isBP = (sp.modo_coleta || 'billing_profile') === 'billing_profile';
  _wizard = {
    spId,
    sp,
    modo:  isBP ? 'billing_profile' : 'subscription',
    scope: isBP ? 'billing_profile' : 'subscriptions', // 'billing_profile' = tudo | 'subscriptions' = seleção
    subs: [],
    selectedSubs: new Set(),
    rgs: [],
    selectedRGs: new Set(),
    inicio: '',
    fim: '',
  };
  // Mostrar/ocultar seletor de escopo
  const scopeSel = document.getElementById('wizard-scope-selector');
  if (scopeSel) scopeSel.style.display = isBP ? '' : 'none';
  _wizardSetScope(isBP ? 'billing_profile' : 'subscriptions');
  document.getElementById('modal-wizard-coleta').classList.add('open');
  _wizardShowStep(1);
  _wizardCarregarSubs();
}

function _wizardSetScope(scope) {
  if (!_wizard) return;
  _wizard.scope = scope;
  _wizard.modo  = scope === 'billing_profile' ? 'billing_profile' : 'subscription';
  const isBP = scope === 'billing_profile';

  // Estilo dos botões
  const btnBP   = document.getElementById('wizard-scope-bp');
  const btnSubs = document.getElementById('wizard-scope-subs');
  if (btnBP) {
    btnBP.style.borderColor = isBP ? 'var(--accent)' : 'var(--border)';
    btnBP.style.background  = isBP ? 'var(--accent)' : 'transparent';
    btnBP.style.color       = isBP ? '#fff' : 'var(--text-muted)';
  }
  if (btnSubs) {
    btnSubs.style.borderColor = !isBP ? 'var(--accent)' : 'var(--border)';
    btnSubs.style.background  = !isBP ? 'rgba(147,51,234,.1)' : 'transparent';
    btnSubs.style.color       = !isBP ? 'var(--accent)' : 'var(--text-muted)';
  }

  // Lista de subscriptions: oculta no modo BP completo
  const subsWrap  = document.getElementById('wizard-subs-wrap');
  const subsLabel = document.getElementById('wizard-subs-label');
  if (subsWrap) subsWrap.style.display = isBP ? 'none' : 'flex';

  // Botão Próximo: habilitado direto para BP completo
  const btnNext = document.getElementById('wizard-btn-next-1');
  if (btnNext) {
    if (isBP) {
      btnNext.disabled = false;
    } else {
      btnNext.disabled = (_wizard.selectedSubs.size === 0);
    }
  }
}

function fecharWizardColeta() {
  _wizardResetBtn();
  document.getElementById('modal-wizard-coleta').classList.remove('open');
  _wizard = null;
}

function _wizardShowStep(step) {
  for (let i = 1; i <= 4; i++) {
    const el  = document.getElementById(`wizard-step-${i}`);
    const dot = document.getElementById(`wizard-dot-${i}`);
    const lbl = document.getElementById(`wizard-lbl-${i}`);
    const ln  = document.getElementById(`wizard-line-${i}`);
    if (el)  el.style.display  = i === step ? 'flex' : 'none';
    if (dot) {
      const done   = i < step;
      const active = i === step;
      dot.style.background = active ? 'var(--accent)' : (done ? 'var(--green)' : 'var(--border)');
      dot.style.color      = (active || done) ? '#fff' : 'var(--text-muted)';
      dot.textContent      = done ? '✓' : String(i);
    }
    if (lbl) lbl.style.color = i === step ? 'var(--accent)' : 'var(--text-muted)';
    if (ln)  ln.style.background = i < step ? 'var(--green)' : 'var(--border)';
  }
  if (_wizard) _wizard._step = step;
}

async function _wizardCarregarSubs() {
  document.getElementById('wizard-subs-list').innerHTML =
    '<div style="color:var(--text-muted);font-size:13px;padding:24px 0;text-align:center">🔍 Buscando assinaturas do tenant...</div>';
  document.getElementById('wizard-btn-next-1').disabled = true;
  try {
    const data = await api('POST', `/azure-coleta/sps/${_wizard.spId}/listar-subs`, {});
    _wizard.subs = data.subs || [];
    _wizardRenderSubs(data.fonte);
  } catch (e) {
    document.getElementById('wizard-subs-list').innerHTML =
      `<div style="color:var(--danger);font-size:13px;padding:16px 0">❌ Erro ao buscar assinaturas: ${e.message}</div>`;
  }
}

function _wizardRenderSubs(fonte) {
  const subs = _wizard.subs;
  if (!subs.length) {
    document.getElementById('wizard-subs-list').innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;padding:16px 0">Nenhuma assinatura encontrada. Verifique as permissões da SP.</div>';
    return;
  }
  _wizard.selectedSubs = new Set(subs.map(s => s.subscriptionId));
  const fonteLabel = { tenant: 'do tenant Azure', billing_profile: 'do Billing Profile', cache: 'do banco local' }[fonte] || '';
  const fonteColor = fonte === 'cache' ? 'var(--orange)' : 'var(--green)';
  let html = `
  <input type="text" id="wizard-subs-search" placeholder="🔍 Pesquisar assinatura..." oninput="_wizardFiltrar('subs')"
    style="width:100%;box-sizing:border-box;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-hover);color:var(--text);font-size:13px;margin-bottom:10px;outline:none">
  <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
    <button class="btn-ghost" style="font-size:11px;padding:2px 10px" onclick="_wizardSelTodas('subs',true)">Todas</button>
    <button class="btn-ghost" style="font-size:11px;padding:2px 10px" onclick="_wizardSelTodas('subs',false)">Limpar</button>
    <span style="color:var(--text-muted);font-size:11px;margin-left:auto">
      <span style="color:${fonteColor}">●</span> ${subs.length} assinatura(s) ${fonteLabel}
    </span>
  </div>
  <div id="wizard-subs-counter" style="font-size:11px;color:var(--accent);margin-bottom:8px;font-weight:600">${subs.length} selecionada(s)</div>
  <div id="wizard-subs-items" style="display:flex;flex-direction:column;gap:4px">`;
  for (const s of subs) {
    const id      = s.subscriptionId.replace(/'/g, '');
    const nomeLow = s.nome.toLowerCase();
    const idLow   = id.toLowerCase();
    html += `<label data-nome="${nomeLow}" data-id="${idLow}" style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;background:rgba(147,51,234,.06);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <input type="checkbox" value="${id}" checked style="margin-top:3px;flex-shrink:0;accent-color:var(--accent)" onchange="_wizardToggleItem('subs','${id}',this.checked)">
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;color:var(--text);font-weight:600">${s.nome}</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace">${id}</div>
      </div>
    </label>`;
  }
  html += '</div>';
  document.getElementById('wizard-subs-list').innerHTML = html;
  document.getElementById('wizard-btn-next-1').disabled = false;
  setTimeout(() => document.getElementById('wizard-subs-search')?.focus(), 100);
}

function _wizardToggleItem(tipo, valor, checked) {
  const set = tipo === 'subs' ? _wizard.selectedSubs : _wizard.selectedRGs;
  if (checked) set.add(valor); else set.delete(valor);
  if (tipo === 'subs') {
    document.getElementById('wizard-btn-next-1').disabled = _wizard.selectedSubs.size === 0;
    const c = document.getElementById('wizard-subs-counter');
    if (c) c.textContent = `${_wizard.selectedSubs.size} selecionada(s)`;
  } else {
    _wizardAtualizarContadores();
  }
}

function _wizardSelTodas(tipo, sel) {
  const lista  = tipo === 'subs' ? _wizard.subs : _wizard.rgs;
  const campo  = tipo === 'subs' ? 'subscriptionId' : 'name';
  const set    = tipo === 'subs' ? _wizard.selectedSubs : _wizard.selectedRGs;
  // Checkboxes podem estar em rgs-items (fora de rgs-list) — busca em ambos
  const listId = tipo === 'subs' ? 'wizard-subs-list' : 'wizard-rgs-items';
  set.clear();
  if (sel) lista.forEach(i => set.add(i[campo]));
  document.querySelectorAll(`#${listId} input[type=checkbox]`).forEach(cb => { cb.checked = sel; });
  if (tipo === 'subs') {
    document.getElementById('wizard-btn-next-1').disabled = set.size === 0;
    const c = document.getElementById('wizard-subs-counter');
    if (c) c.textContent = `${set.size} selecionada(s)`;
  } else {
    _wizardAtualizarContadores();
  }
}

function _wizardFiltrar(tipo) {
  const searchId = tipo === 'subs' ? 'wizard-subs-search' : 'wizard-rgs-search';
  const itemsId  = tipo === 'subs' ? 'wizard-subs-items'  : 'wizard-rgs-items';
  const termo = (document.getElementById(searchId)?.value || '').toLowerCase().trim();
  const labels = document.querySelectorAll(`#${itemsId} label`);
  let visiveis = 0;
  labels.forEach(lbl => {
    const nome = lbl.dataset.nome || '';
    const id   = lbl.dataset.id   || '';
    const ok   = !termo || nome.includes(termo) || id.includes(termo);
    lbl.style.display = ok ? '' : 'none';
    if (ok) visiveis++;
  });
  // Atualiza contador de visíveis ao lado do campo
  const countEl = tipo === 'subs'
    ? document.getElementById('wizard-subs-counter')
    : null;
  if (countEl && termo) {
    const sel = tipo === 'subs' ? _wizard.selectedSubs.size : _wizard.selectedRGs.size;
    countEl.textContent = `${sel} selecionada(s) · ${visiveis} visível(is)`;
  } else if (countEl) {
    countEl.textContent = `${_wizard.selectedSubs.size} selecionada(s)`;
  }
}

function _wizardAtualizarContadores() {
  const subLbl = document.getElementById('wizard-sel-subs-label');
  const rgLbl  = document.getElementById('wizard-sel-rgs-label');
  if (subLbl) subLbl.textContent = `${_wizard?.selectedSubs?.size ?? 0} assinatura(s) selecionada(s)`;
  if (rgLbl) {
    const total = _wizard?.rgs?.length ?? 0;
    const sel   = _wizard?.selectedRGs?.size ?? 0;
    rgLbl.textContent = total > 0 ? `${sel} de ${total} RG(s) selecionado(s)` : '0 RG(s)';
  }
}

async function wizardNext1() {
  if (_wizard.scope === 'billing_profile') {
    _wizard.selectedSubs = new Set();
    _wizard.selectedRGs  = new Set();
    _wizard.rgs          = [];
    _wizardAtualizarContadores();
    wizardNext2(); // pula seleção de RGs — coleta todo o Billing Profile
    return;
  }
  if (_wizard.selectedSubs.size === 0) { showToast('Selecione ao menos uma assinatura', 'error'); return; }
  _wizardShowStep(2);
  _wizardAtualizarContadores();
  await _wizardCarregarRGs();
}

async function _wizardCarregarRGs() {
  document.getElementById('wizard-rgs-list').innerHTML =
    '<div style="color:var(--text-muted);font-size:13px;padding:24px 0;text-align:center">Buscando Resource Groups...</div>';
  document.getElementById('wizard-btn-next-2').disabled = true;
  try {
    const data = await api('POST', `/azure-coleta/sps/${_wizard.spId}/listar-rgs`, {
      subscription_ids: [..._wizard.selectedSubs],
    });
    _wizard.rgs = data.rgs || [];
    _wizardRenderRGs(data.fonte);
  } catch (e) {
    document.getElementById('wizard-rgs-list').innerHTML =
      `<div style="color:var(--danger);font-size:13px;padding:16px 0">Erro: ${e.message}</div>`;
    document.getElementById('wizard-btn-next-2').disabled = false;
  }
}

function _wizardRenderRGs(fonte) {
  const rgs = _wizard.rgs;
  const ctrlEl = document.getElementById('wizard-rgs-controls');
  const listEl = document.getElementById('wizard-rgs-list');

  if (!rgs.length) {
    if (ctrlEl) ctrlEl.innerHTML = '';
    if (listEl) listEl.innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;padding:16px 0;line-height:1.6">Nenhum Resource Group encontrado.<br>Todos os RGs das assinaturas selecionadas serão coletados.</div>';
    document.getElementById('wizard-btn-next-2').disabled = false;
    _wizardAtualizarContadores();
    return;
  }

  _wizard.selectedRGs = new Set(rgs.map(r => r.name));
  const fonteLabel = fonte === 'cache' ? '(banco local)' : fonte === 'arm' ? '(API Azure)' : '';
  const fonteColor = fonte === 'cache' ? 'var(--orange)' : 'var(--green)';

  // Controles fixos — fora do scroll
  if (ctrlEl) ctrlEl.innerHTML = `
    <input type="text" id="wizard-rgs-search" placeholder="🔍 Pesquisar resource group..." oninput="_wizardFiltrar('rgs')"
      style="width:100%;box-sizing:border-box;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-hover);color:var(--text);font-size:13px;margin-bottom:8px;outline:none">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <button class="btn-ghost" style="font-size:11px;padding:2px 10px" onclick="_wizardSelTodas('rgs',true)">Todos</button>
      <button class="btn-ghost" style="font-size:11px;padding:2px 10px" onclick="_wizardSelTodas('rgs',false)">Limpar</button>
      <span style="font-size:11px;margin-left:auto"><span style="color:${fonteColor}">●</span> <span style="color:var(--text-muted)">${rgs.length} RG(s) ${fonteLabel}</span></span>
    </div>`;

  // Itens na área scrollável
  let html = '<div id="wizard-rgs-items" style="display:flex;flex-direction:column;gap:4px">';
  for (const r of rgs) {
    const nameEsc = r.name.replace(/'/g, '');
    const nameLow = r.name.toLowerCase();
    const subLow  = (r.subscriptionId || '').toLowerCase();
    html += `<label data-nome="${nameLow}" data-id="${subLow}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(147,51,234,.06);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <input type="checkbox" value="${nameEsc}" checked style="flex-shrink:0;accent-color:var(--accent)" onchange="_wizardToggleItem('rgs','${nameEsc}',this.checked)">
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</div>
        <div style="font-size:10px;color:var(--text-muted);font-family:monospace">${r.subscriptionId || ''}</div>
      </div>
    </label>`;
  }
  html += '</div>';
  if (listEl) listEl.innerHTML = html;

  document.getElementById('wizard-btn-next-2').disabled = false;
  _wizardAtualizarContadores();
  setTimeout(() => document.getElementById('wizard-rgs-search')?.focus(), 100);
}

function wizardNext2() {
  _wizardShowStep(3);
  const hoje = new Date();
  const ini  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim  = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const iniEl = document.getElementById('wizard-inicio');
  const fimEl = document.getElementById('wizard-fim');
  if (!iniEl.value) iniEl.value = ini.toISOString().slice(0, 10);
  if (!fimEl.value) fimEl.value = fim.toISOString().slice(0, 10);
}

function _wizardSetPeriodo(tipo) {
  const hoje = new Date();
  let ini, fim;
  if (tipo === 'mes_atual') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  } else if (tipo === 'mes_anterior') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  } else {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  }
  document.getElementById('wizard-inicio').value = ini.toISOString().slice(0, 10);
  document.getElementById('wizard-fim').value    = fim.toISOString().slice(0, 10);
}

function wizardNext3() {
  const inicio = document.getElementById('wizard-inicio').value;
  const fim    = document.getElementById('wizard-fim').value;
  if (!inicio || !fim) { showToast('Informe as datas de início e fim', 'error'); return; }
  if (inicio > fim)    { showToast('Data início deve ser anterior ao fim', 'error'); return; }
  _wizard.inicio = inicio;
  _wizard.fim    = fim;

  const isBPScope  = _wizard.scope === 'billing_profile';
  const totalRGs   = _wizard.selectedRGs.size;
  const todosRGs   = isBPScope || totalRGs === _wizard.rgs.length || _wizard.rgs.length === 0;
  const totalSubs  = _wizard.selectedSubs.size;

  const subsRow = isBPScope
    ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text-muted);font-size:13px">Escopo</span>
        <span style="color:var(--accent);font-size:13px;font-weight:600">Billing Profile — todas as subscriptions</span>
       </div>`
    : `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text-muted);font-size:13px">Assinaturas</span>
        <span style="color:var(--accent);font-size:13px;font-weight:600">${totalSubs} selecionada(s)</span>
       </div>
       <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text-muted);font-size:13px">Resource Groups</span>
        <span style="color:var(--accent);font-size:13px;font-weight:600">${todosRGs ? 'Todos' : `${totalRGs} selecionado(s)`}</span>
       </div>`;

  document.getElementById('wizard-summary').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text-muted);font-size:13px">Service Principal</span>
      <span style="color:var(--text);font-size:13px;font-weight:500">${_wizard.sp?.nome || _wizard.spId}</span>
    </div>
    ${subsRow}
    <div style="display:flex;justify-content:space-between;padding:4px 0">
      <span style="color:var(--text-muted);font-size:13px">Período</span>
      <span style="color:var(--text);font-size:13px;font-weight:500">${inicio} → ${fim}</span>
    </div>`;
  _wizardShowStep(4);
  _wizardPreencherAgendamento();
}

function _wizardPreencherAgendamento() {
  const sp     = _wizard?.sp;
  const banner = document.getElementById('wizard-sched-atual');
  if (!banner || !sp) return;

  const temSched = sp.auto_coleta && sp.hora_execucao != null && sp.dias_semana;
  if (!temSched) {
    banner.style.display = 'none';
    return;
  }

  // Pré-preenche o formulário com valores salvos
  const toggleEl = document.getElementById('wizard-sched-ativo');
  const body     = document.getElementById('wizard-sched-body');
  if (toggleEl) toggleEl.checked = true;
  if (body)     body.style.display = 'flex';

  const horaEl = document.getElementById('wizard-sched-hora');
  if (horaEl) horaEl.value = String(sp.hora_execucao);

  const diasSalvos = (sp.dias_semana || '').split(',').map(d => d.trim());
  document.querySelectorAll('.wiz-dia').forEach(ck => { ck.checked = diasSalvos.includes(ck.value); });

  const janelaEl = document.getElementById('wizard-sched-janela');
  if (janelaEl && sp.granularidade_dias) janelaEl.value = String(sp.granularidade_dias);

  _wizardSchedProxima();

  // Monta texto do banner
  const _nd = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const diasNomes = diasSalvos.map(d => _nd[+d]).filter(Boolean).join(', ');
  const infoEl = document.getElementById('wizard-sched-atual-info');
  if (infoEl) infoEl.textContent = `${diasNomes} · ${sp.hora_execucao}:00h · Janela ${sp.granularidade_dias || 7} dia(s)`;
  const proxEl = document.getElementById('wizard-sched-proxima-atual');
  if (proxEl) proxEl.textContent = _proximaLabel(sp.proxima_coleta);

  banner.style.display = 'flex';
}

function _wizardSchedEditar() {
  const banner = document.getElementById('wizard-sched-atual');
  if (banner) banner.style.display = 'none';
}

async function wizardExcluirAgendamento() {
  if (!_wizard?.spId) return;
  if (!confirm(`Excluir o agendamento automático de "${_wizard.sp?.nome || 'SP'}"?`)) return;
  try {
    await api('PUT', `/azure-coleta/sps/${_wizard.spId}/agendamento`, {
      auto_coleta: false, hora_execucao: null, dias_semana: null
    });
    if (_wizard.sp) _wizard.sp.auto_coleta = false;
    const banner   = document.getElementById('wizard-sched-atual');
    const toggleEl = document.getElementById('wizard-sched-ativo');
    const body     = document.getElementById('wizard-sched-body');
    if (banner)   banner.style.display = 'none';
    if (toggleEl) toggleEl.checked = false;
    if (body)     body.style.display = 'none';
    showToast('Agendamento excluído', 'success');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

function _wizardSchedToggle(el) {
  const body = document.getElementById('wizard-sched-body');
  if (body) body.style.display = el.checked ? 'flex' : 'none';
  if (el.checked) _wizardSchedProxima();
}

function _wizardSchedProxima() {
  const hora  = parseInt(document.getElementById('wizard-sched-hora')?.value || 3);
  const dias  = [...document.querySelectorAll('.wiz-dia:checked')].map(c => parseInt(c.value));
  const p     = _computeProximaJS(hora, dias);
  const el    = document.getElementById('wizard-sched-proxima');
  if (el) el.textContent = _proximaLabel(p);
}

function wizardBack(step) {
  _wizardResetBtn();
  _wizardShowStep(step);
}

function _wizardResetBtn() {
  const btn = document.getElementById('wizard-btn-start');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = '▶ Iniciar Coleta';
}

async function wizardIniciarColeta() {
  const btn = document.getElementById('wizard-btn-start');
  if (!btn || btn.disabled) return; // evita double-click
  btn.disabled = true;
  btn.textContent = 'Iniciando...';

  // Safety: restaura o botão após 30s no pior caso
  const safetyTimer = setTimeout(() => {
    _wizardResetBtn();
    showToast('Servidor não respondeu — verifique o status da coleta e tente novamente', 'error');
  }, 30_000);

  try {
    // Verificar se já há coleta em execução
    let statusAtual;
    try { statusAtual = await api('GET', '/azure-coleta/status', null, 8000); } catch (_) {}
    if (statusAtual?.em_execucao) {
      throw new Error('Já existe uma coleta em execução. Aguarde terminar ou cancele antes de iniciar outra.');
    }

    const isBP     = _wizard.modo === 'billing_profile';
    if (isBP && (!_wizard.sp.billing_account_id || !_wizard.sp.billing_profile_id)) {
      throw new Error('Esta SP está no modo Billing Profile mas não tem Billing Account ID e Billing Profile ID configurados. Edite a SP ou use o modo Subscription Direta.');
    }
    const todosRGs = _wizard.rgs.length === 0 || _wizard.selectedRGs.size === _wizard.rgs.length;
    const metricEl = document.querySelector('input[name="wizard-metric"]:checked');
    const body = {
      modo:             _wizard.modo,
      data_inicio:      _wizard.inicio,
      data_fim:         _wizard.fim,
      subscription_ids: [..._wizard.selectedSubs],
      resource_groups:  todosRGs ? [] : [..._wizard.selectedRGs],
      metric:           metricEl ? metricEl.value : 'ActualCost',
    };
    if (isBP) {
      body.billing_account_id = _wizard.sp.billing_account_id;
      body.billing_profile_id = _wizard.sp.billing_profile_id;
    }

    await api('POST', `/azure-coleta/sps/${_wizard.spId}/coletar-api`, body, 15000);

    // Salvar agendamento se configurado no wizard
    const schedAtivo = document.getElementById('wizard-sched-ativo')?.checked;
    if (schedAtivo) {
      const hora   = parseInt(document.getElementById('wizard-sched-hora')?.value || 3);
      const diasSel = [...document.querySelectorAll('.wiz-dia:checked')].map(c => c.value);
      const janela = parseInt(document.getElementById('wizard-sched-janela')?.value || 7);
      if (diasSel.length) {
        try {
          await api('PUT', `/azure-coleta/sps/${_wizard.spId}/agendamento`, {
            auto_coleta:   true,
            hora_execucao: hora,
            dias_semana:   diasSel.join(','),
          });
          await api('PUT', `/azure-coleta/sps/${_wizard.spId}`, { granularidade_dias: janela });
        } catch (_) {}
      }
    }

    clearTimeout(safetyTimer);
    fecharWizardColeta();
    showView('coleta');
    switchColetaTab('api');
    showToast('Coleta iniciada' + (schedAtivo ? ' e agendamento salvo' : '') + ' — acompanhe o monitor abaixo', 'success');
    setTimeout(() => { loadColetaStatus(); loadColetaHistorico(_coletaTabAtual); }, 600);
  } catch (e) {
    clearTimeout(safetyTimer);
    showToast('Erro: ' + e.message, 'error');
    _wizardResetBtn();
  }
}

async function testarSP(id) {
  showToast('Testando autenticação...', 'info');
  try {
    const r = await api('POST', `/azure-coleta/sps/${id}/testar`);
    const res = r.results || {};
    const mgmt = res.management;
    const stg  = res.storage;
    const linhas = [];
    if (mgmt) linhas.push(mgmt.msg);
    if (stg)  linhas.push(stg.msg);
    const tipo = mgmt?.ok ? 'success' : 'error';
    showToast(linhas.join(' | ') || '✔ Credenciais válidas', tipo);
  } catch (e) { showToast('Falha: ' + e.message, 'error'); }
}

async function executarStorageAtivo() {
  try {
    const storages = await api('GET', '/azure-coleta/storages');
    const ativo = (storages || []).find(s => s.ativo);
    if (!ativo) { showToast('Nenhum Storage ativo cadastrado', 'error'); return; }
    if (!confirm(`Iniciar coleta do Storage "${ativo.nome}" agora?`)) return;
    suspendInactivityTimer();
    await api('POST', `/azure-coleta/storages/${ativo.id}/executar`);
    showToast('Coleta Storage iniciada', 'success');
    setTimeout(loadColetaStatus, 1000);
    setTimeout(loadColetaHistorico, 2000);
  } catch (e) { resumeInactivityTimer(); showToast('Erro: ' + e.message, 'error'); }
}

// ── Storage CRUD ───────────────────────────────────────────────────────────────

async function loadStorageList() {
  const tbody = document.getElementById('storage-list-tbody');
  try {
    const storages = await api('GET', '/azure-coleta/storages');
    if (!storages || !storages.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum Storage cadastrado. Clique em "+ Novo Storage".</td></tr>'; return; }
    tbody.innerHTML = storages.map(s => `<tr>
      <td style="font-size:12px;font-weight:600;color:var(--text)">${s.nome || '—'}</td>
      <td style="font-size:12px;color:var(--text-dim)">${s.storage_account || '—'}</td>
      <td style="font-size:12px;color:var(--text-dim)">${s.storage_container || '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${s.storage_prefix || '—'}</td>
      <td style="text-align:center">
        <label class="toggle-switch" style="margin:0"><input type="checkbox" ${s.ativo?'checked':''} onchange="toggleStorageAtivo(${s.id},this.checked)"><span class="toggle-slider"></span></label>
      </td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="testarStorageDireto(${s.id})">Testar</button>
        <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px;border-color:var(--green);color:var(--green)" onclick="executarStorage(${s.id})">▶</button>
        <button class="btn-ghost" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="openStorageModal(${s.id})">✏</button>
        <button class="btn-ghost" style="font-size:10px;padding:3px 8px;border-color:var(--danger);color:var(--danger)" onclick="deleteStorage(${s.id},'${(s.nome||'Storage').replace(/'/g,"\\'")}')">🗑</button>
      </td>
    </tr>`).join('');
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erro: ${e.message}</td></tr>`; }
}

let _storageCache = [];
// ── helpers de agendamento ────────────────────────────────────────────────────
function _computeProximaJS(hora, diasArr) {
  if (hora == null || !diasArr.length) return null;
  const now = new Date();
  for (let offset = 0; offset <= 7; offset++) {
    const c = new Date(now);
    c.setDate(now.getDate() + offset);
    c.setHours(hora, 0, 0, 0);
    if (diasArr.includes(c.getDay()) && c > now) return c;
  }
  return null;
}

function _proximaLabel(proxima) {
  if (!proxima) return '';
  const d = new Date(proxima);
  const hoje = new Date();
  const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
  const label = d.toDateString() === hoje.toDateString() ? 'Hoje'
              : d.toDateString() === amanha.toDateString() ? 'Amanhã'
              : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `Próxima: ${label} às ${String(d.getHours()).padStart(2,'0')}:00`;
}

function _getDiasChecked(cls) {
  return [...document.querySelectorAll(`.${cls}:checked`)].map(el => parseInt(el.value));
}

function _setDiasChecked(cls, diasStr) {
  const dias = diasStr ? diasStr.split(',').map(Number) : [];
  document.querySelectorAll(`.${cls}`).forEach(el => {
    el.checked = !diasStr || dias.includes(parseInt(el.value));
  });
}

function _onStorageAutoToggle(el) {
  document.getElementById('storage-sched-body').style.display = el.checked ? '' : 'none';
  if (el.checked) _updateStorageProxima();
}

function _updateStorageProxima() {
  const hora  = parseInt(document.getElementById('storage-hora-exec').value);
  const dias  = _getDiasChecked('storage-dia');
  const p     = _computeProximaJS(hora, dias);
  document.getElementById('storage-proxima-wrap').textContent = _proximaLabel(p);
}

// ── storage modal ─────────────────────────────────────────────────────────────
function openStorageModal(id) {
  document.getElementById('modal-storage-titulo').textContent = id ? 'Editar Storage' : 'Novo Storage Account';
  document.getElementById('storage-edit-id').value   = id || '';
  document.getElementById('storage-nome').value      = '';
  document.getElementById('storage-account').value   = '';
  document.getElementById('storage-container').value = '';
  document.getElementById('storage-prefix').value    = '';
  document.getElementById('storage-pl-prefix').value = '';
  document.getElementById('storage-ativo').checked   = true;
  document.getElementById('storage-auto-ativo').checked = false;
  document.getElementById('storage-sched-body').style.display = 'none';
  document.getElementById('storage-hora-exec').value = '3';
  document.getElementById('storage-proxima-wrap').textContent = '';
  _setDiasChecked('storage-dia', null);
  document.getElementById('storage-test-result').style.display = 'none';

  // Popular dropdown de SPs
  api('GET', '/azure-coleta/sps').then(sps => {
    const sel = document.getElementById('storage-sp-id');
    sel.innerHTML = '<option value="">— Usar primeira SP ativa (padrão) —</option>';
    (sps || []).forEach(sp => {
      const opt = document.createElement('option');
      opt.value = sp.id;
      opt.textContent = `${sp.nome} (${sp.client_id || '—'})`;
      sel.appendChild(opt);
    });
    if (id) {
      api('GET', '/azure-coleta/storages').then(storages => {
        const s = storages.find(x => x.id === id);
        if (!s) return;
        document.getElementById('storage-nome').value      = s.nome || '';
        document.getElementById('storage-account').value   = s.storage_account || '';
        document.getElementById('storage-container').value = s.storage_container || '';
        document.getElementById('storage-prefix').value    = s.storage_prefix || '';
        document.getElementById('storage-pl-prefix').value = s.price_list_prefix || '';
        document.getElementById('storage-ativo').checked   = s.ativo;
        sel.value = s.sp_id || '';
        const temSched = s.hora_execucao != null && s.dias_semana;
        document.getElementById('storage-auto-ativo').checked = temSched;
        document.getElementById('storage-sched-body').style.display = temSched ? '' : 'none';
        if (temSched) {
          document.getElementById('storage-hora-exec').value = s.hora_execucao;
          _setDiasChecked('storage-dia', s.dias_semana);
          document.getElementById('storage-proxima-wrap').textContent = _proximaLabel(s.proxima_coleta);
        }
      }).catch(() => {});
    }
  }).catch(() => {});

  document.getElementById('modal-storage').classList.add('open');
}

function closeStorageModal() { document.getElementById('modal-storage').classList.remove('open'); }

async function saveStorage() {
  const id    = document.getElementById('storage-edit-id').value;
  const spVal = document.getElementById('storage-sp-id').value;
  const body  = {
    nome:              document.getElementById('storage-nome').value.trim(),
    storage_account:   document.getElementById('storage-account').value.trim(),
    storage_container: document.getElementById('storage-container').value.trim(),
    storage_prefix:      document.getElementById('storage-prefix').value.trim(),
    price_list_prefix:   document.getElementById('storage-pl-prefix').value.trim() || null,
    ativo:               document.getElementById('storage-ativo').checked,
    sp_id:             spVal ? parseInt(spVal) : null,
  };
  if (!body.storage_account || !body.storage_container) { showToast('Preencha Storage Account e Container', 'error'); return; }

  const autoAtivo = document.getElementById('storage-auto-ativo').checked;
  const schedBody = autoAtivo ? {
    hora_execucao: parseInt(document.getElementById('storage-hora-exec').value),
    dias_semana:   _getDiasChecked('storage-dia').join(',') || null
  } : { hora_execucao: null, dias_semana: null };

  if (autoAtivo && !schedBody.dias_semana) { showToast('Selecione ao menos um dia da semana', 'error'); return; }

  const _diasNm = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const confirmMsg = autoAtivo
    ? `Confirma o agendamento para "${body.nome || 'Storage'}"?\n\nHorário: ${schedBody.hora_execucao}h\nDias: ${schedBody.dias_semana.split(',').map(d => _diasNm[+d]).join(', ')}`
    : `Confirma a remoção do agendamento automático de "${body.nome || 'Storage'}"?`;
  if (!confirm(confirmMsg)) return;

  try {
    let storageId = id ? parseInt(id) : null;
    if (id) {
      await api('PUT', `/azure-coleta/storages/${id}`, body);
    } else {
      const r = await api('POST', '/azure-coleta/storages', body);
      storageId = r && r.id;
    }
    if (storageId) {
      await api('PUT', `/azure-coleta/storages/${storageId}/agendamento`, schedBody);
    }
    showToast('Storage salvo', 'success');
    closeStorageModal();
    loadStorageList();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteStorage(id, nome) {
  if (!confirm(`Excluir o Storage "${nome}"?`)) return;
  try { await api('DELETE', `/azure-coleta/storages/${id}`); showToast('Storage excluído', 'success'); loadStorageList(); }
  catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function toggleStorageAtivo(id, ativo) {
  try { await api('PUT', `/azure-coleta/storages/${id}`, { ativo }); loadStorageList(); }
  catch (e) { showToast('Erro: ' + e.message, 'error'); loadStorageList(); }
}

async function testarStorageDireto(id) {
  showToast('Testando conexão com Storage...', 'info');
  try {
    const r = await api('POST', `/azure-coleta/storages/${id}/testar`);
    showToast(`✔ ${r.total} arquivo(s) · ${r.totalSizeMB} MB`, 'success');
  } catch (e) { showToast('Falha: ' + e.message, 'error'); }
}

async function testarStorageModal() {
  const res = document.getElementById('storage-test-result');
  res.style.display = '';
  res.style.color = 'var(--text-dim)';
  res.textContent = 'Testando...';
  const id = document.getElementById('storage-edit-id').value;
  if (!id) { res.style.color = 'var(--text-muted)'; res.textContent = 'Salve primeiro para testar.'; return; }
  try {
    const r = await api('POST', `/azure-coleta/storages/${id}/testar`);
    res.style.color = 'var(--green)';
    res.textContent = `✔ OK · ${r.total} arquivo(s) CSV/Parquet · ${r.totalSizeMB} MB`;
  } catch (e) { res.style.color = 'var(--danger)'; res.textContent = 'Falha: ' + e.message; }
}

async function executarStorage(id) {
  if (!confirm('Iniciar coleta Storage agora?')) return;
  try {
    suspendInactivityTimer();
    await api('POST', `/azure-coleta/storages/${id}/executar`);
    showToast('Coleta Storage iniciada', 'success');
    setTimeout(loadColetaStatus, 1000);
    setTimeout(loadColetaHistorico, 2000);
  } catch (e) { resumeInactivityTimer(); showToast('Erro: ' + e.message, 'error'); }
}

async function limparHistoricoColeta() {
  if (!confirm('Limpar todo o histórico de execuções? Essa ação não pode ser desfeita.')) return;
  try {
    await api('DELETE', '/azure-coleta/historico');
    showToast('Histórico limpo', 'success');
    loadColetaHistorico(_coletaTabAtual);
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

let _historicoCache = [];
let _coletaTabAtual = 'api';

async function loadColetaHistorico(tipo) {
  const tab   = tipo || _coletaTabAtual || 'api';
  const tbody = document.getElementById('coleta-hist-tbody');
  const thead = document.getElementById('coleta-hist-thead');

  // Limpar só faz sentido para API/Storage (azure_coleta_historico)
  // Na aba manual os dados vêm de azure_costs — não há histórico separado para apagar
  const btnLimpar = document.getElementById('btn-limpar-historico');
  if (btnLimpar) btnLimpar.style.display = tab === 'manual' ? 'none' : '';

  if (tab === 'manual') {
    // Histórico de imports manuais (fonte: azure_costs por arquivo)
    if (thead) thead.innerHTML = '<tr><th>Importado em</th><th>Arquivo</th><th style="text-align:right">Linhas</th><th>Período</th><th style="text-align:right">Total Cobrado</th><th>Moeda</th></tr>';
    try {
      const rows = await api('GET', '/azure-costs/imports');
      _historicoCache = [];
      if (!rows || !rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum import manual registrado</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(r => {
        const imp  = r.importado_em ? new Date(r.importado_em).toLocaleString('pt-BR') : '—';
        const arq  = (r.arquivo_origem || '—').split('/').pop().split('\\').pop();
        const lin  = Number(r.linhas || 0).toLocaleString('pt-BR');
        const pIni = r.periodo_inicio ? new Date(r.periodo_inicio).toLocaleDateString('pt-BR') : '—';
        const pFim = r.periodo_fim    ? new Date(r.periodo_fim).toLocaleDateString('pt-BR')    : '—';
        const tot  = r.total_billing  != null ? Number(r.total_billing).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
        return `<tr>
          <td style="font-size:11px;white-space:nowrap">${imp}</td>
          <td style="font-size:11px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${arq}">${arq}</td>
          <td style="text-align:right;font-size:12px;color:var(--green)">${lin}</td>
          <td style="font-size:11px;color:var(--text-dim)">${pIni} → ${pFim}</td>
          <td style="text-align:right;font-size:12px;color:var(--accent)">${tot}</td>
          <td style="font-size:11px;color:var(--text-muted)">${r.moeda || '—'}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erro ao carregar histórico</td></tr>`;
    }
    return;
  }

  // API ou Storage
  if (thead) thead.innerHTML = '<tr><th>Início</th><th>SP</th><th>Status</th><th style="text-align:right">Inseridos</th><th style="text-align:right">Atualizados</th><th style="text-align:right">Erros</th><th>Duração</th><th>Mensagem</th><th style="text-align:center">Log</th></tr>';
  try {
    const rows = await api('GET', `/azure-coleta/historico?tipo=${tab}`);
    _historicoCache = rows || [];
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma execução registrada</td></tr>';
      return;
    }
    const statusColors = {
      concluido:  { bg: 'rgba(34,197,94,.12)',   color: 'var(--green)',  label: 'Concluído' },
      cancelado:  { bg: 'rgba(255,140,66,.12)',   color: 'var(--orange)', label: 'Cancelado' },
      executando: { bg: 'rgba(255,140,66,.12)',   color: 'var(--orange)', label: 'Executando' },
      erro:       { bg: 'rgba(255,77,106,.12)',   color: 'var(--danger)', label: 'Erro' }
    };
    tbody.innerHTML = rows.map((r, idx) => {
      const sc = statusColors[r.status] || { bg: 'rgba(147,51,234,.12)', color: 'var(--accent)', label: r.status };
      const inicio = r.iniciado_em ? new Date(r.iniciado_em).toLocaleString('pt-BR') : '—';
      let dur = '—';
      if (r.iniciado_em && r.concluido_em) {
        const ms = new Date(r.concluido_em) - new Date(r.iniciado_em);
        const s = Math.round(ms / 1000);
        dur = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
      }
      const ins  = (r.linhas_inseridas    ?? 0).toLocaleString('pt-BR');
      const upd  = (r.linhas_atualizadas  ?? 0).toLocaleString('pt-BR');
      const err  = (r.linhas_erro         ?? 0).toLocaleString('pt-BR');
      const msg  = r.mensagem || '—';
      const spNomeHist = r.sp_nome || '—';
      const temLog = r.detalhes && (typeof r.detalhes === 'object' ? r.detalhes.log : false);
      const logBtn = temLog
        ? `<button class="btn-ghost" style="font-size:10px;padding:2px 8px;border-color:var(--accent);color:var(--accent)" onclick="verDetalhesColeta(${idx})" title="Ver log passo a passo">📋 Log</button>`
        : `<span style="font-size:10px;color:var(--text-muted)">—</span>`;
      return `<tr>
        <td style="font-size:11px;white-space:nowrap">${inicio}</td>
        <td style="font-size:11px;color:var(--accent);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${spNomeHist}">${spNomeHist}</td>
        <td><span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
        <td style="text-align:right;font-size:12px;color:var(--green)">${ins}</td>
        <td style="text-align:right;font-size:12px;color:var(--accent)">${upd}</td>
        <td style="text-align:right;font-size:12px;color:${r.linhas_erro > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${err}</td>
        <td style="font-size:11px">${dur}</td>
        <td style="font-size:10px;color:var(--text-dim);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${msg.replace(/"/g,'&quot;')}">${msg}</td>
        <td style="text-align:center">${logBtn}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Erro ao carregar histórico</td></tr>`;
  }
}

function verDetalhesColeta(idx) {
  const r = _historicoCache[idx];
  if (!r) return;
  const det = typeof r.detalhes === 'object' ? r.detalhes : (typeof r.detalhes === 'string' ? JSON.parse(r.detalhes) : {});
  const log = det.log || [];
  const modal = document.getElementById('modal-coleta-det');
  const sc = { concluido: { color: 'var(--green)', label: 'Concluído' }, erro: { color: 'var(--danger)', label: 'Erro' }, cancelado: { color: 'var(--orange)', label: 'Cancelado' }, executando: { color: 'var(--orange)', label: 'Executando' } };
  const st = sc[r.status] || { color: 'var(--accent)', label: r.status };
  const inicio = r.iniciado_em ? new Date(r.iniciado_em).toLocaleString('pt-BR') : '—';
  let dur = '—';
  if (r.iniciado_em && r.concluido_em) {
    const ms = new Date(r.concluido_em) - new Date(r.iniciado_em);
    const s = Math.round(ms / 1000);
    dur = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  }
  const tipo = det.tipo === 'api' ? 'API Oficial' : det.tipo === 'storage' ? 'Via Storage' : '—';
  document.getElementById('coleta-det-meta').innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:rgba(147,51,234,.08);border-radius:10px;border:1px solid var(--border)">
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Início</div><div style="font-size:12px">${inicio}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Duração</div><div style="font-size:12px">${dur}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Status</div><div style="font-size:12px;font-weight:600;color:${st.color}">${st.label}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Tipo</div><div style="font-size:12px">${tipo}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Inseridos</div><div style="font-size:12px;color:var(--green);font-weight:600">${(r.linhas_inseridas??0).toLocaleString('pt-BR')}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Atualizados</div><div style="font-size:12px;color:var(--accent);font-weight:600">${(r.linhas_atualizadas??0).toLocaleString('pt-BR')}</div></div>
      ${r.linhas_erro > 0 ? `<div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Erros</div><div style="font-size:12px;color:var(--danger);font-weight:600">${r.linhas_erro.toLocaleString('pt-BR')}</div></div>` : ''}
    </div>
    ${r.mensagem ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;border:1px solid var(--border)">${r.mensagem}</div>` : ''}`;
  if (!log.length) {
    document.getElementById('coleta-det-log').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">Nenhum log disponível para esta execução.<br><span style="font-size:10px">Logs são salvos a partir desta versão.</span></div>';
  } else {
    const _stepIcon = msg => {
      if (msg.startsWith('ERRO') || msg.startsWith('Erro') || msg.includes('falhou')) return { icon: '✗', color: 'var(--danger)' };
      if (msg.startsWith('Concluí') || msg.includes('inserido') || msg.includes('✅') || msg.startsWith('OK')) return { icon: '✓', color: 'var(--green)' };
      if (msg.includes('Baixando') || msg.includes('Lendo') || msg.includes('Processando') || msg.includes('Aguard')) return { icon: '⟳', color: 'var(--accent)' };
      if (msg.includes('⚠') || msg.includes('cancelad')) return { icon: '!', color: 'var(--orange)' };
      return { icon: '›', color: 'var(--text-muted)' };
    };
    document.getElementById('coleta-det-log').innerHTML = `
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase">${log.length} entradas de log</div>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:360px;overflow-y:auto;padding-right:4px">
        ${log.map(l => {
          const si = _stepIcon(l.msg);
          return `<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.025);font-size:11px">
            <span style="color:var(--text-muted);font-family:monospace;white-space:nowrap;padding-top:1px;min-width:52px">${l.ts}</span>
            <span style="color:${si.color};font-weight:700;min-width:10px;padding-top:1px">${si.icon}</span>
            <span style="color:var(--text);line-height:1.4;word-break:break-word">${l.msg.replace(/</g,'&lt;')}</span>
          </div>`;
        }).join('')}
      </div>`;
  }
  modal.classList.add('open');
}

function fecharDetalhesColeta() { document.getElementById('modal-coleta-det').classList.remove('open'); }

