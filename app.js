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

  const titles = { dashboard: 'Dashboard', projetos: 'Projetos', acoes: 'Ações FinOps', calculadora: 'Calculadora Azure', estimativas: 'Estimativas', reservas: 'Reservas Cloud', coleta: 'Coleta Automática' };
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
async function api(method, path, body) {
  try {
    const token = sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  } catch (e) {
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
    const linhas = recursos.map(r => {
      const horas = r.isHora ? (r.horas + ' h') : '—';
      const chora = r.custo_hora != null ? formatCurrency(r.custo_hora) + '/h' : '—';
      return `<tr>
        <td>${escHtml(r.nome || '—')}</td>
        <td style="color:var(--text-muted)">${escHtml(r.categoria || '—')}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace">${horas}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace">${chora}</td>
        <td style="text-align:right;font-family:IBM Plex Mono,monospace;color:var(--accent)">${formatCurrency(r.estimado_brl)}</td>
      </tr>`;
    }).join('');

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
          <tbody>${linhas || '<tr><td colspan="5" class="empty-state">Sem recursos registrados</td></tr>'}</tbody>
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
let _inactivityTimer   = null;
let _countdownInterval = null;
let _warningShown      = false;
const INACTIVITY_MS    = 15 * 60 * 1000;
const WARNING_SECS     = 60;

function resetInactivityTimer() {
  if (_warningShown) return;
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

// ── COLETA AUTOMÁTICA ─────────────────────────
let _coletaPolling = null;

async function loadColeta() {
  try {
    const cfg = await api('GET', '/azure-coleta/config');
    if (cfg) {
      document.getElementById('coleta-tenant-id').value = cfg.tenant_id || '';
      document.getElementById('coleta-client-id').value = cfg.client_id || '';
      document.getElementById('coleta-dia').value = cfg.dia_execucao ?? 5;
      document.getElementById('coleta-ativo').checked = !!cfg.ativo;
      const gran = document.getElementById('coleta-granularidade');
      gran.value = String(cfg.granularidade_dias ?? 7);
      if (!gran.value) gran.value = '7';
    }
  } catch (e) { /* sem config ainda — formulário vazio */ }
  await loadColetaStatus();
  await loadColetaHistorico();
}

async function loadColetaStatus() {
  try {
    const s = await api('GET', '/azure-coleta/status');
    const badge = document.getElementById('coleta-status-badge');
    const execBtn = document.getElementById('coleta-exec-btn');

    if (s.em_execucao) {
      badge.textContent = 'Em Execução';
      badge.style.background = 'rgba(255,140,66,.15)';
      badge.style.color = 'var(--orange)';
      execBtn.disabled = true;
      execBtn.textContent = 'Executando...';
      if (!_coletaPolling) _coletaPolling = setInterval(loadColetaStatus, 8000);
    } else {
      badge.textContent = 'Ocioso';
      badge.style.background = 'rgba(34,197,94,.12)';
      badge.style.color = 'var(--green)';
      execBtn.disabled = false;
      execBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" width="14" height="14" style="display:inline;margin-right:5px;vertical-align:-2px"><path d="M5 4l12 6-12 6V4z" fill="currentColor"/></svg> Executar Agora';
      if (_coletaPolling) { clearInterval(_coletaPolling); _coletaPolling = null; }
    }

    const hist = s.ultimo;
    if (hist) {
      const dt = hist.iniciado_em ? new Date(hist.iniciado_em).toLocaleString('pt-BR') : '—';
      document.getElementById('coleta-ultima-exec').textContent = dt;
      document.getElementById('coleta-ultima-msg').textContent = hist.mensagem || '—';
      const ins = (hist.linhas_inseridas ?? 0) + (hist.linhas_atualizadas ?? 0);
      document.getElementById('coleta-ultima-linhas').textContent = ins.toLocaleString('pt-BR') + ' registros';
    }
  } catch (e) {
    document.getElementById('coleta-status-badge').textContent = 'Indisponível';
  }
}

async function saveColetaConfig() {
  const tenant_id = document.getElementById('coleta-tenant-id').value.trim();
  const client_id = document.getElementById('coleta-client-id').value.trim();
  const client_secret = document.getElementById('coleta-client-secret').value;
  const ativo = document.getElementById('coleta-ativo').checked;
  const dia_execucao = parseInt(document.getElementById('coleta-dia').value) || 5;
  const granularidade_dias = parseInt(document.getElementById('coleta-granularidade').value) || 7;
  if (!tenant_id || !client_id) { showToast('Preencha Tenant ID e Client ID', 'error'); return; }
  try {
    await api('POST', '/azure-coleta/config', { tenant_id, client_id, client_secret, ativo, dia_execucao, granularidade_dias });
    document.getElementById('coleta-client-secret').value = '';
    showToast('Configuração salva', 'success');
  } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error'); }
}

async function testColetaConexao() {
  const res = document.getElementById('coleta-test-result');
  res.style.display = 'block';
  res.style.background = 'rgba(147,51,234,.1)';
  res.style.color = 'var(--text-dim)';
  res.textContent = 'Testando conexão com Azure...';
  try {
    const r = await api('POST', '/azure-coleta/testar');
    res.style.background = 'rgba(34,197,94,.1)';
    res.style.color = 'var(--green)';
    const preview = (r.preview || []).join(', ');
    res.textContent = `Conexão OK · ${r.subscriptions} subscription(s) encontrada(s)${preview ? ': ' + preview : ''}`;
  } catch (e) {
    res.style.background = 'rgba(255,77,106,.1)';
    res.style.color = 'var(--danger)';
    res.textContent = 'Falha: ' + e.message;
  }
}

async function executarColetaAgora() {
  if (!confirm('Iniciar coleta agora? Isso irá coletar os custos do mês anterior de todas as subscriptions do tenant.')) return;
  try {
    await api('POST', '/azure-coleta/executar');
    showToast('Coleta iniciada em background', 'success');
    setTimeout(loadColetaStatus, 1500);
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function loadColetaHistorico() {
  const tbody = document.getElementById('coleta-hist-tbody');
  try {
    const rows = await api('GET', '/azure-coleta/historico');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma execução registrada</td></tr>';
      return;
    }
    const statusColors = {
      concluido: { bg: 'rgba(34,197,94,.12)', color: 'var(--green)', label: 'Concluído' },
      executando: { bg: 'rgba(255,140,66,.12)', color: 'var(--orange)', label: 'Executando' },
      erro: { bg: 'rgba(255,77,106,.12)', color: 'var(--danger)', label: 'Erro' }
    };
    tbody.innerHTML = rows.map(r => {
      const sc = statusColors[r.status] || { bg: 'rgba(147,51,234,.12)', color: 'var(--accent)', label: r.status };
      const inicio = r.iniciado_em ? new Date(r.iniciado_em).toLocaleString('pt-BR') : '—';
      let dur = '—';
      if (r.iniciado_em && r.concluido_em) {
        const ms = new Date(r.concluido_em) - new Date(r.iniciado_em);
        const s = Math.round(ms / 1000);
        dur = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
      }
      const tipo = (r.detalhes && r.detalhes.modo) ? (r.detalhes.modo === 'manual' ? 'Manual' : 'Automático') : 'Automático';
      const ins = (r.linhas_inseridas ?? 0).toLocaleString('pt-BR');
      const upd = (r.linhas_atualizadas ?? 0).toLocaleString('pt-BR');
      const err = (r.linhas_erro ?? 0).toLocaleString('pt-BR');
      const subs = `${r.subs_ok ?? 0}/${r.subs_total ?? 0}`;
      const msg = r.mensagem || '—';
      return `<tr>
        <td style="font-size:11px;white-space:nowrap">${inicio}</td>
        <td style="font-size:11px">${tipo}</td>
        <td><span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
        <td style="text-align:right;font-size:12px">${subs}</td>
        <td style="text-align:right;font-size:12px;color:var(--green)">${ins}</td>
        <td style="text-align:right;font-size:12px;color:var(--accent)">${upd}</td>
        <td style="text-align:right;font-size:12px;color:${r.linhas_erro > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${err}</td>
        <td style="font-size:11px">${dur}</td>
        <td style="font-size:10px;color:var(--text-dim);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${msg.replace(/"/g,'&quot;')}">${msg}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Erro ao carregar histórico</td></tr>`;
  }
}
