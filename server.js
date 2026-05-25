'use strict';

// ─── AUTO-LOAD .env or .env.enc ──────────────────────────────────────────────
(function loadEnv() {
  const fs = require('fs'), crypto = require('crypto'), path = require('path');
  const ENC  = path.join(__dirname, '.env.enc');
  const KEY  = path.join(__dirname, '.env.key');
  const PLAIN= path.join(__dirname, '.env');

  function parse(text) {
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx < 0) return;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    });
  }

  if (fs.existsSync(ENC) && fs.existsSync(KEY)) {
    try {
      const key = Buffer.from(fs.readFileSync(KEY, 'utf8').trim(), 'hex');
      const raw = Buffer.from(fs.readFileSync(ENC, 'utf8').trim(), 'base64');
      const iv  = raw.slice(0, 16), tag = raw.slice(16, 32), enc = raw.slice(32);
      const dc  = crypto.createDecipheriv('aes-256-gcm', key, iv);
      dc.setAuthTag(tag);
      parse(Buffer.concat([dc.update(enc), dc.final()]).toString('utf8'));
      console.log('  🔐 Variáveis carregadas de .env.enc (AES-256-GCM)');
    } catch(e) { console.warn('  ⚠  Falha ao ler .env.enc:', e.message); }
  } else if (fs.existsSync(PLAIN)) {
    parse(fs.readFileSync(PLAIN, 'utf8'));
    console.log('  📄 Variáveis carregadas de .env');
  }
})();

// ─── DATABASE_URL SUPPORT (Railway, Render, Fly.io) ──────────────────────────
if (process.env.DATABASE_URL && !process.env.DB_HOST) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    process.env.DB_HOST     = u.hostname;
    process.env.DB_PORT     = u.port || '5432';
    process.env.DB_NAME     = u.pathname.slice(1);
    process.env.DB_USER     = u.username;
    process.env.DB_PASSWORD = decodeURIComponent(u.password);
    console.log('  🔗 DB configurado via DATABASE_URL');
  } catch (e) { console.warn('  ⚠  DATABASE_URL inválida:', e.message); }
}

const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const fs       = require('fs');

const JWT_SECRET  = process.env.JWT_SECRET  || 'finops-secret-2024';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const PORT        = process.env.PORT        || 3000;
const SETUP_FILE  = path.join(__dirname, '.finops_setup');
const MASTER_KEY  = process.env.MASTER_KEY || 'finops-master-key-change-in-prod-32c';

if (!process.env.JWT_SECRET)  console.warn('  AVISO: JWT_SECRET nao definido — usando valor padrao inseguro. Defina em producao!');
if (!process.env.MASTER_KEY)  console.warn('  AVISO: MASTER_KEY nao definida — usando valor padrao inseguro. Defina em producao!');

function encrypt(text) {
  const iv  = crypto.randomBytes(16);
  const key = crypto.scryptSync(MASTER_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(data) {
  if (!data || data === '***') return '';
  // Try AES-256-CBC first (server-encrypted)
  try {
    const parts = data.split(':');
    if (parts.length === 2 && parts[0].length === 32) {
      const iv  = Buffer.from(parts[0], 'hex');
      const key = crypto.scryptSync(MASTER_KEY, 'salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const dec = Buffer.concat([decipher.update(Buffer.from(parts[1], 'hex')), decipher.final()]);
      return dec.toString('utf8');
    }
  } catch {}
  // Fallback: base64 (btoa — frontend simple obfuscation)
  try {
    return Buffer.from(data, 'base64').toString('utf8');
  } catch {}
  return '';
}

function isConfigured() {
  return fs.existsSync(SETUP_FILE);
}

function readSetup() {
  try {
    const raw = fs.readFileSync(SETUP_FILE, 'utf8');
    return JSON.parse(decrypt(raw));
  } catch { return null; }
}

function writeSetup(config) {
  fs.writeFileSync(SETUP_FILE, encrypt(JSON.stringify(config)), 'utf8');
}

function buildConnectionEntry(dbConfig, nome) {
  return {
    id:        'conn_' + Date.now(),
    nome:      nome || dbConfig.nome || (dbConfig.tipo + ' — ' + dbConfig.host + '/' + dbConfig.database),
    tipo:      dbConfig.tipo,
    host:      dbConfig.host,
    porta:     dbConfig.porta || 5432,
    database:  dbConfig.database,
    schema:    dbConfig.schema || 'public',
    usuario:   dbConfig.usuario,
    senha_enc: encrypt(dbConfig.senha || ''),
    ssl:       dbConfig.ssl || false,
    pool:      { min: 2, max: 10, timeout: 30000 },
    isDefault: true,
    criado_em: new Date().toISOString()
  };
}

const app = express();

// ─── SECURITY HEADERS ────────────────────────────────────────────────────────
try {
  const helmet = require('helmet');
  // CSP desabilitado: o SPA usa inline scripts/styles e CDNs externos (fonts, xlsx).
  // Segurança de arquivos sensíveis é feita pelo middleware de bloqueio abaixo.
  app.use(helmet({ contentSecurityPolicy: false }));
} catch { console.warn('  helmet nao instalado — execute: npm install helmet'); }

// ─── RATE LIMITING ───────────────────────────────────────────────────────────
try {
  const rateLimit = require('express-rate-limit');
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' } }));
  app.use('/api/auth/ad',    rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' } }));
} catch { console.warn('  express-rate-limit nao instalado — execute: npm install express-rate-limit'); }

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use(cors({
  origin: ALLOWED_ORIGIN || true,  // Em produção, defina ALLOWED_ORIGIN=https://seu-dominio.com
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));           // 50 MB era excessivo para JSON; uploads usam multer
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── STATIC FILES ────────────────────────────────────────────────────────────
// Bloqueia acesso direto a arquivos sensíveis antes de servir estáticos
const _SENSITIVE = /^\/?(server\.js|encrypt-env\.js|package(-lock)?\.json|\.env(\.\w+)?|\.finops_setup|CLAUDE\.md|README\.md|.*\.sql$|.*\.key$|.*\.enc$)/i;
app.use((req, res, next) => {
  if (_SENSITIVE.test(req.path) || req.path.includes('node_modules')) {
    return res.status(403).end();
  }
  next();
});
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// ─── DB ──────────────────────────────────────────────────────────────────────
let pool = null; // Created lazily after setup

function getDbConfig() {
  // Priority: env vars > setup file > defaults
  if (process.env.DB_HOST) {
    return {
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'finops_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    };
  }
  if (isConfigured()) {
    const setup = readSetup();
    if (setup && setup.dbConfig) {
      const c = setup.dbConfig;
      return {
        host:     c.host,
        port:     c.porta || 5432,
        database: c.database,
        user:     c.usuario,
        password: c.senha_enc ? decrypt(c.senha_enc) : c.senha,
        ssl:      c.ssl ? { rejectUnauthorized: false } : false,
      };
    }
  }
  return null;
}

function createPool(cfg) {
  if (pool) { try { pool.end(); } catch {} }
  pool = new Pool({
    ...cfg,
    max:                    10,     // máximo de conexões simultâneas
    min:                    2,      // mínimo mantido aquecido
    connectionTimeoutMillis: 10000, // timeout ao adquirir conexão
    idleTimeoutMillis:      30000,  // fecha conexões ociosas após 30s
    allowExitOnIdle:        false,  // pool não impede shutdown manual
  });
  pool.on('error', (err) => {
    console.error('[Pool] Erro inesperado em cliente ocioso:', err.message);
  });
  return pool;
}

// ─── INIT DB ─────────────────────────────────────────────────────────────────
async function initDB() {
  const c = await pool.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS perfis (
        id        SERIAL PRIMARY KEY,
        nome      VARCHAR(50) NOT NULL UNIQUE,
        descricao TEXT,
        criado_em TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO perfis (nome, descricao) VALUES
        ('admin',  'Acesso total ao sistema'),
        ('finops', 'Criar e editar projetos e acoes'),
        ('reader', 'Somente leitura')
      ON CONFLICT (nome) DO NOTHING;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS permissoes (
        id           SERIAL PRIMARY KEY,
        perfil_id    INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
        recurso      VARCHAR(100) NOT NULL,
        pode_ler     BOOLEAN DEFAULT true,
        pode_criar   BOOLEAN DEFAULT false,
        pode_editar  BOOLEAN DEFAULT false,
        pode_excluir BOOLEAN DEFAULT false,
        UNIQUE (perfil_id, recurso)
      );
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'projetos',true,true,true,true   FROM perfis WHERE nome='admin' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'acoes',true,true,true,true       FROM perfis WHERE nome='admin' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'usuarios',true,true,true,true    FROM perfis WHERE nome='admin' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'projetos',true,true,true,false   FROM perfis WHERE nome='finops' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'acoes',true,true,true,false      FROM perfis WHERE nome='finops' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'usuarios',false,false,false,false FROM perfis WHERE nome='finops' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'projetos',true,false,false,false FROM perfis WHERE nome='reader' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'acoes',true,false,false,false    FROM perfis WHERE nome='reader' ON CONFLICT DO NOTHING;
      INSERT INTO permissoes (perfil_id, recurso, pode_ler, pode_criar, pode_editar, pode_excluir)
      SELECT id,'usuarios',false,false,false,false FROM perfis WHERE nome='reader' ON CONFLICT DO NOTHING;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id            SERIAL PRIMARY KEY,
        nome          VARCHAR(200) NOT NULL,
        email         VARCHAR(200) NOT NULL UNIQUE,
        senha_hash    VARCHAR(200),
        perfil        VARCHAR(50)  NOT NULL DEFAULT 'reader',
        tipo          VARCHAR(20)  NOT NULL DEFAULT 'local',
        ativo         BOOLEAN DEFAULT true,
        criado_em     TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_id     INTEGER REFERENCES perfis(id) ON DELETE SET NULL;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login  TIMESTAMP;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash    VARCHAR(200);
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo         BOOLEAN DEFAULT true;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS sessoes (
        id         SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        ip         VARCHAR(50),
        tipo_login VARCHAR(20) DEFAULT 'local',
        criado_em  TIMESTAMP DEFAULT NOW()
      );
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS integracoes (
        id            SERIAL PRIMARY KEY,
        tipo          VARCHAR(20) NOT NULL UNIQUE,
        ativo         BOOLEAN DEFAULT false,
        config        JSONB DEFAULT '{}',
        atualizado_em TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO integracoes (tipo) VALUES ('ad')    ON CONFLICT (tipo) DO NOTHING;
      INSERT INTO integracoes (tipo) VALUES ('entra') ON CONFLICT (tipo) DO NOTHING;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS projetos (
        id            SERIAL PRIMARY KEY,
        nome          VARCHAR(200) NOT NULL UNIQUE,
        diretoria     VARCHAR(200),
        descricao     TEXT,
        criado_em     TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE projetos ADD COLUMN IF NOT EXISTS diretoria     VARCHAR(200);
      ALTER TABLE projetos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acoes_finops (
        id                  SERIAL PRIMARY KEY,
        id_finops           VARCHAR(50)  UNIQUE NOT NULL,
        projeto_id          INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
        acao                VARCHAR(300) NOT NULL,
        cloud               VARCHAR(100),
        responsavel         VARCHAR(200),
        tipo_acao           VARCHAR(100),
        impacto_atual_mes   NUMERIC(15,2) DEFAULT 0,
        status              VARCHAR(50)   DEFAULT 'Pendente',
        data_inicio         DATE,
        data_conclusao      DATE,
        retorno_ano_atual   NUMERIC(15,2) DEFAULT 0,
        retorno_proximo_ano NUMERIC(15,2) DEFAULT 0,
        atual_janeiro    NUMERIC(15,2) DEFAULT 0, atual_fevereiro  NUMERIC(15,2) DEFAULT 0,
        atual_marco      NUMERIC(15,2) DEFAULT 0, atual_abril      NUMERIC(15,2) DEFAULT 0,
        atual_maio       NUMERIC(15,2) DEFAULT 0, atual_junho      NUMERIC(15,2) DEFAULT 0,
        atual_julho      NUMERIC(15,2) DEFAULT 0, atual_agosto     NUMERIC(15,2) DEFAULT 0,
        atual_setembro   NUMERIC(15,2) DEFAULT 0, atual_outubro    NUMERIC(15,2) DEFAULT 0,
        atual_novembro   NUMERIC(15,2) DEFAULT 0, atual_dezembro   NUMERIC(15,2) DEFAULT 0,
        proximo_janeiro  NUMERIC(15,2) DEFAULT 0, proximo_fevereiro NUMERIC(15,2) DEFAULT 0,
        proximo_marco    NUMERIC(15,2) DEFAULT 0, proximo_abril    NUMERIC(15,2) DEFAULT 0,
        proximo_maio     NUMERIC(15,2) DEFAULT 0, proximo_junho    NUMERIC(15,2) DEFAULT 0,
        proximo_julho    NUMERIC(15,2) DEFAULT 0, proximo_agosto   NUMERIC(15,2) DEFAULT 0,
        proximo_setembro NUMERIC(15,2) DEFAULT 0, proximo_outubro  NUMERIC(15,2) DEFAULT 0,
        proximo_novembro NUMERIC(15,2) DEFAULT 0, proximo_dezembro NUMERIC(15,2) DEFAULT 0,
        criado_em         TIMESTAMP DEFAULT NOW(),
        atualizado_em     TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE acoes_finops ADD COLUMN IF NOT EXISTS criado_em     TIMESTAMP DEFAULT NOW();
      ALTER TABLE acoes_finops ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS estimativas (
        id              SERIAL PRIMARY KEY,
        projeto_id      INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
        projeto_nome    VARCHAR(200),
        numero          VARCHAR(50),
        titulo          VARCHAR(200),
        responsavel     VARCHAR(200),
        validade_dias   INTEGER DEFAULT 30,
        data_estimativa DATE,
        horas           INTEGER,
        pct_imposto     NUMERIC(5,2) DEFAULT 0,
        pct_cond        NUMERIC(5,2) DEFAULT 0,
        vl_imposto      NUMERIC(15,2) DEFAULT 0,
        vl_cond         NUMERIC(15,2) DEFAULT 0,
        total_brl       NUMERIC(15,2),
        total_final     NUMERIC(15,2),
        observacoes     TEXT,
        recursos        JSONB,
        status          VARCHAR(20) DEFAULT 'Pendente',
        criado_em       TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE estimativas ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pendente';
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS reservas_cloud (
        id                  SERIAL PRIMARY KEY,
        cloud               VARCHAR(50)  NOT NULL,
        nome_reserva        VARCHAR(255) NOT NULL,
        tipo_escopo         VARCHAR(50)  NOT NULL DEFAULT 'Shared',
        subscription_id     VARCHAR(255),
        resource_group_name VARCHAR(255),
        tipo_recurso        VARCHAR(100) NOT NULL,
        instancia           VARCHAR(255),
        quantidade          INTEGER      DEFAULT 1,
        prazo               VARCHAR(20),
        opcao_pagamento     VARCHAR(50),
        custo_total         NUMERIC(15,2),
        custo_mensal        NUMERIC(15,2),
        data_inicio         DATE,
        data_vencimento     DATE         NOT NULL,
        status              VARCHAR(20)  DEFAULT 'Ativa',
        observacoes         TEXT,
        criado_por          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        criado_em           TIMESTAMPTZ  DEFAULT NOW(),
        atualizado_em       TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    console.log('Banco de dados inicializado com sucesso.');
  } finally {
    c.release();
  }
}

// ─── SEED ADMIN ──────────────────────────────────────────────────────────────
// seedAdmin removed — admin is created exclusively via Setup Wizard

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token nao fornecido' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

// Block API calls that need DB when pool is not ready
function dbMiddleware(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Banco nao configurado. Complete o Setup Wizard.' });
  next();
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', dbMiddleware, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha obrigatorios' });
  try {
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1 AND tipo = 'local' AND ativo = true",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha invalidos.' });
    }
    const user = result.rows[0];
    if (!user.senha_hash) return res.status(401).json({ error: 'Usuario sem senha. Contate o administrador.' });
    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Email ou senha invalidos.' });
    await pool.query('INSERT INTO sessoes (usuario_id, ip, tipo_login) VALUES ($1, $2, $3)', [user.id, req.ip, 'local']);
    await pool.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign(
      { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );
    res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

app.post('/api/auth/ad', dbMiddleware, async (req, res) => {
  const { email, senha } = req.body;
  try {
    const cfg = await pool.query("SELECT config FROM integracoes WHERE tipo = 'ad' AND ativo = true");
    if (!cfg.rows.length) return res.status(400).json({ error: 'Integracao AD nao configurada' });
    const c = cfg.rows[0].config;
    const ldap = require('ldapjs');
    const client = ldap.createClient({ url: c.server, connectTimeout: 8000 });
    const username = email.includes('@') ? email : (email + '@' + (c.domain || 'empresa.local'));
    client.bind(username, senha, async (err) => {
      if (err) { client.destroy(); return res.status(401).json({ error: 'Credenciais AD invalidas' }); }
      let perfil = 'reader';
      const safeEmail = email.replace(/[\\*()\x00]/g, '');
      const opts = { filter: '(mail=' + safeEmail + ')', scope: 'sub', attributes: ['memberOf', 'displayName'] };
      client.search(c.basedn, opts, (err2, searchRes) => {
        let displayName = email;
        searchRes.on('searchEntry', (entry) => {
          displayName = entry.object.displayName || email;
          const groups = [].concat(entry.object.memberOf || []);
          if (groups.some(g => g.includes(c.grp_admin)))       perfil = 'admin';
          else if (groups.some(g => g.includes(c.grp_finops))) perfil = 'finops';
        });
        searchRes.on('end', async () => {
          client.destroy();
          await pool.query(
            "INSERT INTO usuarios (nome, email, perfil, tipo) VALUES ($1,$2,$3,'ad') ON CONFLICT (email) DO UPDATE SET nome=$1, perfil=$3, ativo=true, atualizado_em=NOW()",
            [displayName, email, perfil]
          );
          const r = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
          await pool.query('INSERT INTO sessoes (usuario_id, ip, tipo_login) VALUES ($1,$2,$3)', [r.rows[0].id, req.ip, 'ad']);
          const token = jwt.sign({ nome: displayName, email, perfil }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
          res.json({ token, user: { nome: displayName, email, perfil } });
        });
      });
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/entra/url', async (req, res) => {
  try {
    const cfg = await pool.query("SELECT config FROM integracoes WHERE tipo = 'entra' AND ativo = true");
    if (!cfg.rows.length) return res.status(400).json({ error: 'Entra ID nao configurado' });
    const c = cfg.rows[0].config;
    const url = 'https://login.microsoftonline.com/' + c.tenant_id + '/oauth2/v2.0/authorize?' +
      'client_id=' + c.client_id + '&response_type=code' +
      '&redirect_uri=' + encodeURIComponent(c.redirect_uri) + '&scope=openid+profile+email';
    res.json({ url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/ad/test', authMiddleware, async (req, res) => {
  const { server, bind_user, bind_pass } = req.body;
  try {
    const ldap = require('ldapjs');
    const client = ldap.createClient({ url: server, connectTimeout: 6000 });
    client.bind(bind_user, bind_pass, (err) => {
      client.destroy();
      if (err) return res.status(400).json({ ok: false, error: err.message });
      res.json({ ok: true, message: 'Conexao com Active Directory bem-sucedida!' });
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ─── USUARIOS ────────────────────────────────────────────────────────────────
app.get('/api/usuarios', authMiddleware, async (req, res) => {
  try {
    res.json((await pool.query('SELECT id, nome, email, perfil, tipo, ativo, ultimo_login, criado_em FROM usuarios ORDER BY nome')).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', authMiddleware, async (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  if (!nome || !email || !senha || !perfil) return res.status(400).json({ error: 'Campos obrigatorios faltando' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const r = await pool.query(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, tipo) VALUES ($1,$2,$3,$4,'local') RETURNING id,nome,email,perfil",
      [nome, email, hash, perfil]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ja cadastrado' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', authMiddleware, async (req, res) => {
  const { nome, email, perfil, senha } = req.body;
  if (!nome || !email || !perfil) return res.status(400).json({ error: 'Campos obrigatorios faltando' });
  try {
    if (senha && senha.trim() !== '') {
      if (senha.length < 8) return res.status(400).json({ error: 'Senha deve ter no minimo 8 caracteres' });
      const hash = await bcrypt.hash(senha, 10);
      await pool.query(
        'UPDATE usuarios SET nome=$1, email=$2, perfil=$3, senha_hash=$4, atualizado_em=NOW() WHERE id=$5',
        [nome, email, perfil, hash, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE usuarios SET nome=$1, email=$2, perfil=$3, atualizado_em=NOW() WHERE id=$4',
        [nome, email, perfil, req.params.id]
      );
    }
    const r = await pool.query('SELECT id, nome, email, perfil, tipo, ativo FROM usuarios WHERE id=$1', [req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ja cadastrado' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/usuarios/:id/ativo', authMiddleware, async (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'Campo ativo deve ser booleano' });
  try {
    await pool.query('UPDATE usuarios SET ativo=$1, atualizado_em=NOW() WHERE id=$2', [ativo, req.params.id]);
    res.json({ id: req.params.id, ativo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/usuarios/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usuario removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/permissoes', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, pf.nome AS perfil, p.recurso, p.pode_ler, p.pode_criar, p.pode_editar, p.pode_excluir
      FROM permissoes p JOIN perfis pf ON pf.id = p.perfil_id ORDER BY pf.nome, p.recurso
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── INTEGRACOES ─────────────────────────────────────────────────────────────
app.get('/api/integrations', authMiddleware, async (req, res) => {
  try {
    res.json((await pool.query('SELECT tipo, config, ativo FROM integracoes')).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/integrations/:tipo', authMiddleware, async (req, res) => {
  const { config, ativo } = req.body;
  try {
    await pool.query(
      'UPDATE integracoes SET config=$1, ativo=$2, atualizado_em=NOW() WHERE tipo=$3',
      [JSON.stringify(config), ativo, req.params.tipo]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DB CONNECTIONS ──────────────────────────────────────────────────────────
app.post('/api/db-connections/test', authMiddleware, async (req, res) => {
  const { tipo, host, porta, database, usuario, senha, ssl } = req.body;
  const start = Date.now();
  try {
    let testPool;
    const base = { host, port: porta, database, user: usuario, password: senha,
                   connectionTimeoutMillis: 8000, ssl: ssl ? { rejectUnauthorized: false } : false };

    if (tipo === 'postgresql' || tipo.includes('aws-rds-pg') || tipo.includes('azure-pg') || tipo.includes('gcp-pg')) {
      const { Pool: TestPool } = require('pg');
      testPool = new TestPool(base);
      const client = await testPool.connect();
      await client.query('SELECT 1');
      client.release();
      await testPool.end();
    } else if (tipo === 'mysql' || tipo.includes('mysql') || tipo.includes('aurora')) {
      // MySQL — requer 'mysql2' instalado
      try {
        const mysql = require('mysql2/promise');
        const conn = await mysql.createConnection({ host, port: porta, database, user: usuario, password: senha });
        await conn.query('SELECT 1');
        await conn.end();
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') throw new Error('Instale o driver: npm install mysql2');
        throw e;
      }
    } else if (tipo === 'sqlserver' || tipo.includes('azure-sql')) {
      try {
        const mssql = require('mssql');
        await mssql.connect({ server: host, port: porta, database, user: usuario, password: senha,
                              options: { encrypt: ssl, trustServerCertificate: !ssl } });
        await mssql.query('SELECT 1');
        mssql.close();
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') throw new Error('Instale o driver: npm install mssql');
        throw e;
      }
    } else {
      return res.json({ message: 'Teste de conectividade básica: host ' + host + ':' + porta, latency: Date.now() - start });
    }

    res.json({ ok: true, message: 'Conexão bem-sucedida com ' + tipo, latency: Date.now() - start });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all saved connections
app.get('/api/db-connections', authMiddleware, async (req, res) => {
  try {
    const setup = readSetup();
    const conns = (setup && setup.connections) || [];
    // Never return plaintext passwords — mask them
    const safe = conns.map(c => ({ ...c, senha_enc: '***' }));
    res.json(safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save connections list (with encrypted passwords)
app.post('/api/db-connections', authMiddleware, async (req, res) => {
  try {
    const { connections } = req.body;

    // Guard: must keep at least one connection
    if (!connections || connections.length === 0) {
      return res.status(400).json({ error: 'O sistema precisa de ao menos uma conexão configurada.' });
    }

    // Guard: must have exactly one default/active
    const defaults = connections.filter(c => c.isDefault);
    if (defaults.length === 0) {
      connections[0].isDefault = true; // auto-promote first as default
    }

    const setup = readSetup() || {};
    // Re-encrypt: upgrade btoa → AES, and encrypt any new plain passwords
    const encrypted = connections.map(c => {
      if (c.senha_plain) {
        // New password provided explicitly
        return { ...c, senha_enc: encrypt(c.senha_plain), senha_plain: undefined };
      }
      if (c.senha_enc && c.senha_enc !== '***' && !c.senha_enc.includes(':')) {
        // Old btoa format — migrate to AES silently
        try {
          const plain = Buffer.from(c.senha_enc, 'base64').toString('utf8');
          return { ...c, senha_enc: encrypt(plain) };
        } catch {}
      }
      return c;
    });

    // Update dbConfig to match the active connection
    const active = encrypted.find(c => c.isDefault) || encrypted[0];
    setup.dbConfig = {
      tipo:     active.tipo,
      host:     active.host,
      porta:    active.porta,
      database: active.database,
      schema:   active.schema || 'public',
      usuario:  active.usuario,
      senha_enc: active.senha_enc,
      ssl:      active.ssl || false
    };

    setup.connections = encrypted;
    writeSetup(setup);
    res.json({ ok: true, total: encrypted.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Apply a connection as active (reconnects pool + updates setup)
app.post('/api/db-connections/apply', authMiddleware, async (req, res) => {
  const { id } = req.body;
  try {
    const setup = readSetup();
    if (!setup || !setup.connections || !setup.connections.length) {
      return res.status(404).json({ error: 'Nenhuma conexão salva' });
    }

    // Find by id or fallback to first
    const chosen = setup.connections.find(c => c.id === id) || setup.connections[0];
    if (!chosen) return res.status(404).json({ error: 'Conexão não encontrada' });

    // If password was updated (senha_plain present), re-encrypt
    if (chosen.senha_plain) {
      chosen.senha_enc = encrypt(chosen.senha_plain);
      delete chosen.senha_plain;
    }

    // Mark only chosen as default
    setup.connections = setup.connections.map(c => ({ ...c, isDefault: c.id === chosen.id }));

    // Decrypt password for pool (resilient — handles both AES and btoa formats)
    const senha = decrypt(chosen.senha_enc);
    if (!senha) {
      return res.status(400).json({ error: 'Senha não encontrada. Edite a conexão e informe a senha novamente.' });
    }
    // Re-encrypt with AES if it was stored as btoa (migration)
    if (!chosen.senha_enc.includes(':')) {
      chosen.senha_enc = encrypt(senha);
      console.log('Senha migrada para AES-256:', chosen.nome);
    }

    // Update dbConfig to match active connection
    setup.dbConfig = {
      tipo:      chosen.tipo,
      host:      chosen.host,
      porta:     chosen.porta,
      database:  chosen.database,
      schema:    chosen.schema || 'public',
      usuario:   chosen.usuario,
      senha_enc: chosen.senha_enc,
      ssl:       chosen.ssl || false
    };
    writeSetup(setup);

    // Reconnect pool with new config
    createPool({
      host:     chosen.host,
      port:     chosen.porta,
      database: chosen.database,
      user:     chosen.usuario,
      password: senha,
      ssl:      chosen.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });

    // Verify connectivity
    await pool.query('SELECT 1');
    console.log('Pool reconectado:', chosen.host + ':' + chosen.porta + '/' + chosen.database);
    res.json({ ok: true, message: 'Conexao "' + chosen.nome + '" ativada com sucesso!' });
  } catch (err) {
    // Don't leave pool in broken state
    pool = null;
    res.status(500).json({ error: 'Falha ao reconectar: ' + err.message });
  }
});

// ─── SETUP ROUTES ────────────────────────────────────────────────────────────

// Check if system is configured
app.get('/api/setup/status', (_req, res) => {
  res.json({ configured: isConfigured() });
});

// Test DB connection during setup (no auth required — pre-setup)
app.post('/api/setup/test-db', async (req, res) => {
  const { tipo, host, porta, database, usuario, senha, ssl } = req.body;
  const start = Date.now();
  try {
    if (tipo === 'postgresql' || tipo.includes('pg') || tipo.includes('aurora') || tipo.includes('atp') || tipo.includes('adw')) {
      const { Pool: TestPool } = require('pg');
      const tp = new TestPool({
        host, port: porta, database, user: usuario, password: senha,
        connectionTimeoutMillis: 8000,
        ssl: ssl ? { rejectUnauthorized: false } : false
      });
      const client = await tp.connect();
      await client.query('SELECT 1');
      client.release();
      await tp.end();
    } else if (tipo === 'mysql' || tipo.includes('mysql')) {
      const mysql = require('mysql2/promise');
      const conn  = await mysql.createConnection({ host, port: porta, database, user: usuario, password: senha });
      await conn.query('SELECT 1');
      await conn.end();
    } else if (tipo === 'sqlserver' || tipo.includes('azure-sql')) {
      const mssql = require('mssql');
      await mssql.connect({ server: host, port: porta, database, user: usuario, password: senha, options: { encrypt: ssl, trustServerCertificate: !ssl } });
      await mssql.query('SELECT 1');
      mssql.close();
    }
    res.json({ ok: true, message: 'Conexao bem-sucedida com ' + tipo, latency: Date.now() - start });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Complete setup: save encrypted config + create admin
app.post('/api/setup/complete', async (req, res) => {
  if (isConfigured()) return res.status(400).json({ error: 'Sistema ja configurado' });
  const { dbConfig, admin } = req.body;
  if (!dbConfig || !admin) return res.status(400).json({ error: 'Dados incompletos' });

  try {
    // 1. Encrypt and save DB config + register as default connection
    const connEntry = buildConnectionEntry(dbConfig, dbConfig.nome || 'Conexão Principal');
    const setupData = {
      dbConfig:     { ...dbConfig, senha_enc: encrypt(dbConfig.senha), senha: undefined },
      connections:  [connEntry],
      configuredAt: new Date().toISOString()
    };
    writeSetup(setupData);

    // 2. Create pool with new config and init tables
    createPool({
      host:     dbConfig.host,
      port:     dbConfig.porta || 5432,
      database: dbConfig.database,
      user:     dbConfig.usuario,
      password: dbConfig.senha,
      ssl:      dbConfig.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });
    await initDB();

    // 3. Clear all existing users and create ONLY the setup admin
    await pool.query('DELETE FROM usuarios');
    const hash = await bcrypt.hash(admin.senha, 12);
    await pool.query(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, tipo, ativo) VALUES ($1,$2,$3,'admin','local',true)",
      [admin.nome, admin.email, hash]
    );

    console.log('Setup concluido. Admin:', admin.email);
    res.json({ ok: true, message: 'Sistema configurado com sucesso!' });
  } catch (err) {
    // Rollback setup file if error
    try { fs.unlinkSync(SETUP_FILE); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ─── TOKEN REFRESH ───────────────────────────────────────────────────────────
app.post('/api/auth/refresh', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    // Busca perfil atualizado do banco (garante que revogação de acesso seja refletida)
    const r = await pool.query('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = $1', [req.user.id]);
    if (!r.rows.length || !r.rows[0].ativo) return res.status(401).json({ error: 'Sessao encerrada' });
    const u = r.rows[0];
    const token = jwt.sign(
      { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
    res.json({ token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EXPORT EXCEL ────────────────────────────────────────────────────────────
app.get('/api/export/excel', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');

    const result = await pool.query(`
      SELECT a.*, p.nome AS projeto_nome
      FROM acoes_finops a
      LEFT JOIN projetos p ON a.projeto_id = p.id
      ORDER BY a.id_finops
    `);
    const acoes = result.rows;

    // ── BRAND COLORS (Vivo purple) ─────────────────────────────────────────
    const GREEN_DARK  = '4A0080';
    const GREEN_MAIN  = '7B2FBE';
    const GREEN_LIGHT = 'F3E8FF';
    const GREEN_TOTAL = '9333EA';
    const WHITE       = 'FFFFFFFF';
    const NAVY        = 'FF1B2A4A';
    const AMBER       = 'FFFFC000';
    const GRAY_BDR    = 'FFE0D4F5';

    const BRL_FMT = '"R$\u00a0"#,##0.00';
    const PCT_FMT = '0.0%';

    const hoje     = new Date();
    const hojeStr  = hoje.toLocaleDateString('pt-BR') + ' às ' + hoje.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const periodo  = String(hoje.getFullYear());

    function brl(v) { return isNaN(parseFloat(v)) ? 0 : Math.round(parseFloat(v) * 100) / 100; }

    function hFill(hex) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } }; }
    function hFont(bold, color, size, italic) {
      return { bold: !!bold, color: { argb: color || NAVY }, size: size || 9, italic: !!italic, name: 'Arial' };
    }
    function hAlign(h, v, wrap) {
      return { horizontal: h || 'left', vertical: v || 'middle', wrapText: !!wrap };
    }
    function hBorder(color) {
      const s = { style: 'thin', color: { argb: color || GRAY_BDR } };
      return { left: s, right: s, top: s, bottom: s };
    }

    function styleCell(cell, { fill, font, alignment, border, numFmt } = {}) {
      if (fill)      cell.fill      = fill;
      if (font)      cell.font      = font;
      if (alignment) cell.alignment = alignment;
      if (border)    cell.border    = border;
      if (numFmt)    cell.numFmt    = numFmt;
    }

    function headerRow(ws, rowNum, headers, bg, fg) {
      bg = bg || GREEN_MAIN; fg = fg || 'FFFFFFFF';
      const row = ws.getRow(rowNum);
      row.height = 18;
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        cell.value = h;
        styleCell(cell, {
          fill: hFill(bg), font: hFont(true, fg, 9),
          alignment: hAlign('center'), border: hBorder('FF' + GREEN_DARK)
        });
      });
    }

    function dataStyle(ws, rowNum, ncols, shade) {
      const row = ws.getRow(rowNum);
      row.height = 16;
      for (let i = 1; i <= ncols; i++) {
        styleCell(row.getCell(i), {
          fill: hFill(shade ? GREEN_LIGHT : 'FFFFFF'),
          font: hFont(false, NAVY, 9),
          alignment: hAlign('left'),
          border: hBorder()
        });
      }
    }

    function writeHeaderBlock(ws, title, subtitle, ncols) {
      // Row 1-2: dark banner
      ws.mergeCells(1, 1, 2, ncols);
      const c1 = ws.getCell(1, 1);
      c1.value = '  FinOps Manager   |   ' + title;
      styleCell(c1, { fill: hFill(GREEN_DARK), font: hFont(true, 'FFFFFFFF', 13), alignment: hAlign('left', 'middle') });
      ws.getRow(1).height = 28;
      ws.getRow(2).height = 6;
      // Row 3: green line
      ws.mergeCells(3, 1, 3, ncols);
      ws.getCell(3, 1).fill = hFill(GREEN_MAIN);
      ws.getRow(3).height = 4;
      // Row 4: subtitle
      ws.mergeCells(4, 1, 4, ncols);
      const c4 = ws.getCell(4, 1);
      c4.value = '  ' + subtitle;
      styleCell(c4, { fill: hFill('FFFFFF'), font: hFont(false, 'FF5B2080', 9, true), alignment: hAlign('left', 'middle') });
      ws.getRow(4).height = 16;
      // Row 5: spacer
      ws.mergeCells(5, 1, 5, ncols);
      ws.getRow(5).height = 6;
      return 6;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FinOps Manager';
    wb.created = hoje;

    // ── ABA 1: SUMÁRIO EXECUTIVO ──────────────────────────────────────────
    const ws1 = wb.addWorksheet('Sumário Executivo');
    ws1.views = [{ showGridLines: false }];
    const NCOLS1 = 5;

    const conc = acoes.filter(a => a.status === 'Concluído');
    const andm = acoes.filter(a => a.status === 'Em Andamento');
    const plan = acoes.filter(a => a.status === 'Planejado');
    const canc = acoes.filter(a => a.status === 'Cancelado');
    const tot  = Math.max(acoes.length, 1);
    const hojeD = hoje.toISOString().split('T')[0];
    const atr  = acoes.filter(a => a.data_conclusao &&
      !['Concluído','Cancelado'].includes(a.status) &&
      String(a.data_conclusao).slice(0,10) < hojeD);

    const sumS = (lst, k) => lst.reduce((acc, a) => acc + brl(a[k]), 0);

    let r = writeHeaderBlock(ws1, `Relatório Executivo — ${periodo}`,
      `Gerado em: ${hojeStr}   |   Total de Ações: ${acoes.length}`, NCOLS1);

    // Visão Geral título
    ws1.mergeCells(r, 1, r, NCOLS1);
    const cgTitle = ws1.getCell(r, 1);
    cgTitle.value = 'VISÃO GERAL DE AÇÕES';
    styleCell(cgTitle, { fill: hFill(GREEN_DARK), font: hFont(true, 'FFFFFFFF', 10), alignment: hAlign('left', 'middle') });
    ws1.getRow(r).height = 20;
    r++;

    headerRow(ws1, r, ['Status','Qtd','% Total','Retorno Ano Atual (R$)','Retorno Próx. Ano (R$)']);
    r++;

    const statusRows = [
      ['Concluídas',   conc.length, conc.length/tot, sumS(conc,'retorno_ano_atual'), sumS(conc,'retorno_proximo_ano')],
      ['Em Andamento', andm.length, andm.length/tot, sumS(andm,'retorno_ano_atual'), sumS(andm,'retorno_proximo_ano')],
      ['Planejadas',   plan.length, plan.length/tot, sumS(plan,'retorno_ano_atual'), sumS(plan,'retorno_proximo_ano')],
      ['Canceladas',   canc.length, canc.length/tot, sumS(canc,'retorno_ano_atual'), 0],
    ];
    statusRows.forEach(([st, qt, pct, ra, rp], idx) => {
      dataStyle(ws1, r, NCOLS1, idx % 2 === 1);
      const row = ws1.getRow(r);
      row.getCell(1).value = st;
      row.getCell(2).value = qt;  styleCell(row.getCell(2), { alignment: hAlign('center') });
      row.getCell(3).value = pct; styleCell(row.getCell(3), { alignment: hAlign('center'), numFmt: PCT_FMT });
      row.getCell(4).value = ra;  styleCell(row.getCell(4), { alignment: hAlign('right'),  numFmt: BRL_FMT });
      row.getCell(5).value = rp;  styleCell(row.getCell(5), { alignment: hAlign('right'),  numFmt: BRL_FMT });
      r++;
    });

    // Total row
    ws1.getRow(r).height = 18;
    for (let i = 1; i <= NCOLS1; i++) {
      styleCell(ws1.getRow(r).getCell(i), {
        fill: hFill(GREEN_TOTAL), font: hFont(true, 'FFFFFFFF', 9),
        alignment: hAlign('center'), border: hBorder('FF' + GREEN_DARK)
      });
    }
    ws1.getRow(r).getCell(1).value = 'TOTAL';
    ws1.getRow(r).getCell(1).alignment = hAlign('left', 'middle');
    ws1.getRow(r).getCell(2).value = acoes.length;
    ws1.getRow(r).getCell(3).value = 1.0; styleCell(ws1.getRow(r).getCell(3), { numFmt: PCT_FMT });
    ws1.getRow(r).getCell(4).value = sumS(acoes,'retorno_ano_atual');  styleCell(ws1.getRow(r).getCell(4), { numFmt: BRL_FMT });
    ws1.getRow(r).getCell(5).value = sumS(acoes,'retorno_proximo_ano'); styleCell(ws1.getRow(r).getCell(5), { numFmt: BRL_FMT });
    r += 2;

    if (atr.length) {
      ws1.mergeCells(r, 1, r, NCOLS1);
      const cAtr = ws1.getCell(r, 1);
      cAtr.value = `⚠  Ações com Prazo Vencido: ${atr.length}`;
      styleCell(cAtr, { fill: { type:'pattern', pattern:'solid', fgColor:{ argb: AMBER } }, font: hFont(true, NAVY, 10), alignment: hAlign('left','middle') });
      ws1.getRow(r).height = 20;
      r += 2;
    }

    // Por Cloud
    ws1.mergeCells(r, 1, r, NCOLS1);
    const cCloud = ws1.getCell(r, 1);
    cCloud.value = 'RETORNO POR CLOUD';
    styleCell(cCloud, { fill: hFill(GREEN_DARK), font: hFont(true, 'FFFFFFFF', 10), alignment: hAlign('left','middle') });
    ws1.getRow(r).height = 20;
    r++;

    headerRow(ws1, r, ['Cloud','Total','Concluídas','Em Andamento','Retorno Concluídas (R$)'], GREEN_TOTAL);
    r++;

    const cm = {};
    acoes.forEach(a => {
      const cl = a.cloud || 'N/A';
      if (!cm[cl]) cm[cl] = { tot:0, conc:0, and:0, ret:0 };
      cm[cl].tot++;
      if (a.status === 'Concluído')    { cm[cl].conc++; cm[cl].ret += brl(a.retorno_ano_atual); }
      if (a.status === 'Em Andamento') { cm[cl].and++; }
    });
    Object.entries(cm).sort((a,b) => b[1].ret - a[1].ret).forEach(([cl, v], idx) => {
      dataStyle(ws1, r, NCOLS1, idx % 2 === 1);
      const row = ws1.getRow(r);
      row.getCell(1).value = cl;
      row.getCell(2).value = v.tot;  styleCell(row.getCell(2), { alignment: hAlign('center') });
      row.getCell(3).value = v.conc; styleCell(row.getCell(3), { alignment: hAlign('center') });
      row.getCell(4).value = v.and;  styleCell(row.getCell(4), { alignment: hAlign('center') });
      row.getCell(5).value = v.ret;  styleCell(row.getCell(5), { alignment: hAlign('right'), numFmt: BRL_FMT });
      r++;
    });

    [32, 12, 12, 16, 26].forEach((w, i) => { ws1.getColumn(i+1).width = w; });

    // ── ABA 2: AÇÕES DETALHADAS ───────────────────────────────────────────
    const ws2 = wb.addWorksheet('Ações Detalhadas');
    ws2.views = [{ showGridLines: false }];
    const hdrs2 = ['ID FinOps','Projeto','Ação / Iniciativa','Cloud','Responsável',
                   'Tipo de Ação','Status','Data Início','Data Conclusão',
                   'Impacto Mensal (R$)','Retorno Ano Atual (R$)','Retorno Próx. Ano (R$)'];
    const NCOLS2 = hdrs2.length;

    let r2 = writeHeaderBlock(ws2, `Ações Detalhadas — ${periodo}`, `Gerado em: ${hojeStr}`, NCOLS2);
    headerRow(ws2, r2, hdrs2);
    r2++;

    const STATUS_COLORS = {
      'Concluído':   'F3E8FF', 'Em Andamento': 'E8F4FD',
      'Planejado':   'FFF9E6', 'Cancelado':    'FFE4E4',
    };

    acoes.forEach((a, idx) => {
      dataStyle(ws2, r2, NCOLS2, idx % 2 === 1);
      const row = ws2.getRow(r2);
      const vals = [
        a.id_finops || '',
        a.projeto_nome || '—',
        a.acao || '',
        a.cloud || '—',
        a.responsavel || '—',
        a.tipo_acao || '—',
        a.status || '',
        a.data_inicio   ? String(a.data_inicio).slice(0,10)   : '',
        a.data_conclusao? String(a.data_conclusao).slice(0,10): '',
        brl(a.impacto_atual_mes),
        brl(a.retorno_ano_atual),
        brl(a.retorno_proximo_ano),
      ];
      vals.forEach((v, i) => { row.getCell(i+1).value = v; });
      [10,11,12].forEach(ci => styleCell(row.getCell(ci), { alignment: hAlign('right'), numFmt: BRL_FMT }));
      const stColor = STATUS_COLORS[a.status] || 'FFFFFF';
      row.getCell(7).fill = hFill(stColor);
      row.getCell(3).alignment = hAlign('left', 'middle', true);
      row.height = 18;
      r2++;
    });

    ws2.autoFilter = { from: { row: 6, column: 1 }, to: { row: r2-1, column: NCOLS2 } };
    ws2.views = [{ showGridLines: false, state: 'frozen', ySplit: 6, xSplit: 0, activeCell: 'A7' }];
    [14,22,42,12,22,22,14,13,13,20,22,22].forEach((w,i) => { ws2.getColumn(i+1).width = w; });

    // ── ABA 3: RETORNO MENSAL ─────────────────────────────────────────────
    const ws3 = wb.addWorksheet('Retorno Mensal');
    ws3.views = [{ showGridLines: false }];
    const MESES_K = ['janeiro','fevereiro','marco','abril','maio','junho',
                     'julho','agosto','setembro','outubro','novembro','dezembro'];
    const MESES_N = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const hdrs3 = ['ID FinOps','Projeto','Ação','Cloud','Responsável','Status',
                   ...MESES_N.map(m => `${m} Atual (R$)`), 'Total Ano Atual (R$)',
                   ...MESES_N.map(m => `${m} Próx (R$)`), 'Total Próx. Ano (R$)'];
    const NCOLS3 = hdrs3.length;

    let r3 = writeHeaderBlock(ws3, `Retorno Mensal — ${periodo}`, `Gerado em: ${hojeStr}`, NCOLS3);
    headerRow(ws3, r3, hdrs3, GREEN_TOTAL);
    r3++;

    acoes.forEach((a, idx) => {
      dataStyle(ws3, r3, NCOLS3, idx % 2 === 1);
      const row = ws3.getRow(r3);
      const rowVals = [
        a.id_finops || '', a.projeto_nome || '—', a.acao || '',
        a.cloud || '—', a.responsavel || '—', a.status || '',
        ...MESES_K.map(m => brl(a[`atual_${m}`])),
        brl(a.retorno_ano_atual),
        ...MESES_K.map(m => brl(a[`proximo_${m}`])),
        brl(a.retorno_proximo_ano),
      ];
      rowVals.forEach((v, i) => {
        row.getCell(i+1).value = v;
        if (i >= 6) styleCell(row.getCell(i+1), { alignment: hAlign('right'), numFmt: BRL_FMT });
      });
      row.height = 16;
      r3++;
    });

    ws3.autoFilter = { from: { row: 6, column: 1 }, to: { row: r3-1, column: 6 } };
    ws3.views = [{ showGridLines: false, state: 'frozen', ySplit: 6, xSplit: 6, activeCell: 'G7' }];
    [14,20,30,12,22,14,...Array(26).fill(13)].forEach((w,i) => { ws3.getColumn(i+1).width = w; });

    // ── STREAM RESPOSTA ───────────────────────────────────────────────────
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="FinOps_Executivo_${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[Excel] erro:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar Excel: ' + err.message });
  }
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  if (!pool) return res.json({ status: 'setup', db: 'not_configured' });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) { res.status(500).json({ status: 'error', db: 'disconnected', message: err.message }); }
});

// Diagnóstico — apenas para admins autenticados
app.get('/api/diag', authMiddleware, async (req, res) => {
  if (req.user.perfil !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  try {
    const tables  = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const users   = await pool.query("SELECT id, email, perfil, tipo, ativo FROM usuarios");
    res.json({ tables: tables.rows.map(r=>r.table_name), usuarios: users.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PROJETOS ────────────────────────────────────────────────────────────────
app.get('/api/projetos', authMiddleware, dbMiddleware, async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM projetos ORDER BY nome')).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projetos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM projetos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Projeto nao encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projetos', authMiddleware, dbMiddleware, async (req, res) => {
  const { nome, diretoria, descricao } = req.body;
  if (!nome || typeof nome !== 'string' || nome.trim().length === 0)
    return res.status(400).json({ error: 'Nome e obrigatorio' });
  try {
    const r = await pool.query(
      'INSERT INTO projetos (nome, diretoria, descricao) VALUES ($1,$2,$3) RETURNING *',
      [nome.trim(), diretoria || null, descricao || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Projeto com este nome ja existe' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projetos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  const { nome, diretoria, descricao } = req.body;
  if (!nome || typeof nome !== 'string' || nome.trim().length === 0)
    return res.status(400).json({ error: 'Nome e obrigatorio' });
  try {
    const r = await pool.query(
      'UPDATE projetos SET nome=$1, diretoria=$2, descricao=$3, atualizado_em=NOW() WHERE id=$4 RETURNING *',
      [nome.trim(), diretoria || null, descricao || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Projeto nao encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projetos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM projetos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Projeto removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ACOES ───────────────────────────────────────────────────────────────────
const MESES_ATUAL   = ['atual_janeiro','atual_fevereiro','atual_marco','atual_abril','atual_maio','atual_junho','atual_julho','atual_agosto','atual_setembro','atual_outubro','atual_novembro','atual_dezembro'];
const MESES_PROXIMO = ['proximo_janeiro','proximo_fevereiro','proximo_marco','proximo_abril','proximo_maio','proximo_junho','proximo_julho','proximo_agosto','proximo_setembro','proximo_outubro','proximo_novembro','proximo_dezembro'];

function buildAcaoFields(body) {
  return {
    id_finops: body.id_finops || null, projeto_id: body.projeto_id || null,
    acao: body.acao, cloud: body.cloud || null, responsavel: body.responsavel || null,
    tipo_acao: body.tipo_acao || null, impacto_atual_mes: body.impacto_atual_mes || 0,
    status: body.status || 'Pendente', data_inicio: body.data_inicio || null,
    data_conclusao: body.data_conclusao || null, retorno_ano_atual: body.retorno_ano_atual || 0,
    retorno_proximo_ano: body.retorno_proximo_ano || 0,
    ...Object.fromEntries([...MESES_ATUAL, ...MESES_PROXIMO].map(m => [m, body[m] || 0]))
  };
}

async function generateIdFinops() {
  const r = await pool.query("SELECT id_finops FROM acoes_finops WHERE id_finops LIKE 'FINOPS-%' ORDER BY id_finops DESC");
  let max = 0;
  for (const row of r.rows) {
    const m = row.id_finops.match(/^FINOPS-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'FINOPS-' + String(max + 1).padStart(3, '0');
}

// ── NOTIFICAÇÕES ──────────────────────────────
app.get('/api/notificacoes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome } = req.user;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const em5dias  = new Date(hoje); em5dias.setDate(hoje.getDate() + 5);
    const em90dias = new Date(hoje); em90dias.setDate(hoje.getDate() + 90);

    // Ações com prazo vencendo em até 5 dias
    const rAcoes = await pool.query(
      `SELECT a.id, a.id_finops, a.acao, a.responsavel, a.status, a.data_conclusao,
              p.nome AS projeto_nome
       FROM acoes_finops a
       LEFT JOIN projetos p ON a.projeto_id = p.id
       WHERE a.responsavel ILIKE $1
         AND a.status NOT IN ('Concluído','Cancelado')
         AND a.data_conclusao IS NOT NULL
         AND a.data_conclusao <= $2
       ORDER BY a.data_conclusao ASC`,
      [nome, em5dias.toISOString().split('T')[0]]
    );

    // Reservas ativas vencendo em até 90 dias (3 meses)
    const rReservas = await pool.query(
      `SELECT id, nome_reserva, cloud, tipo_recurso, data_vencimento
       FROM reservas_cloud
       WHERE status = 'Ativa'
         AND data_vencimento <= $1
       ORDER BY data_vencimento ASC`,
      [em90dias.toISOString().split('T')[0]]
    );

    const notifs = [];

    rAcoes.rows.forEach(a => {
      const prazo = new Date(a.data_conclusao);
      prazo.setHours(0,0,0,0);
      const diffDias = Math.floor((prazo - hoje) / (1000*60*60*24));
      let tipo, mensagem;
      if (diffDias < 0)      { tipo = 'vencido'; mensagem = `Prazo vencido há ${Math.abs(diffDias)} dia${Math.abs(diffDias) !== 1 ? 's' : ''}`; }
      else if (diffDias === 0) { tipo = 'hoje';    mensagem = 'Prazo vence hoje!'; }
      else                     { tipo = 'urgente'; mensagem = `Vence em ${diffDias} dia${diffDias !== 1 ? 's' : ''}`; }
      notifs.push({ ...a, tipo, mensagem, diffDias, _kind: 'acao' });
    });

    rReservas.rows.forEach(r => {
      const venc = new Date(r.data_vencimento);
      venc.setHours(0,0,0,0);
      const diffDias = Math.floor((venc - hoje) / (1000*60*60*24));
      let tipo, mensagem;
      if (diffDias < 0)       { tipo = 'vencido'; mensagem = `Reserva expirada há ${Math.abs(diffDias)} dia${Math.abs(diffDias) !== 1 ? 's' : ''}`; }
      else if (diffDias === 0) { tipo = 'hoje';    mensagem = 'Reserva vence hoje!'; }
      else if (diffDias <= 30) { tipo = 'urgente'; mensagem = `Reserva vence em ${diffDias} dia${diffDias !== 1 ? 's' : ''}`; }
      else {
        const meses = Math.round(diffDias / 30);
        tipo = 'reserva';
        mensagem = `Reserva vence em ~${meses} mês${meses !== 1 ? 'es' : ''}`;
      }
      notifs.push({
        ...r, tipo, mensagem, diffDias, _kind: 'reserva',
        acao: r.nome_reserva,
        id_finops: r.cloud + ' · ' + r.tipo_recurso,
        projeto_nome: null
      });
    });

    notifs.sort((a, b) => a.diffDias - b.diffDias);
    res.json(notifs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/acoes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { projeto_id, status, cloud } = req.query;
    let q = 'SELECT a.*, p.nome AS projeto_nome FROM acoes_finops a LEFT JOIN projetos p ON a.projeto_id = p.id WHERE 1=1';
    const params = [];
    if (projeto_id) { params.push(parseInt(projeto_id)); q += ' AND a.projeto_id = $' + params.length; }
    if (status)     { params.push(status);     q += ' AND a.status = $'     + params.length; }
    if (cloud)      { params.push(cloud);      q += ' AND a.cloud ILIKE $'  + params.length; }
    q += ' ORDER BY a.id_finops';
    res.json((await pool.query(q, params)).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/acoes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT a.*, p.nome AS projeto_nome FROM acoes_finops a LEFT JOIN projetos p ON a.projeto_id = p.id WHERE a.id = $1',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Acao nao encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/acoes', authMiddleware, dbMiddleware, async (req, res) => {
  const f = buildAcaoFields(req.body);
  if (!f.acao || typeof f.acao !== 'string' || f.acao.trim().length === 0)
    return res.status(400).json({ error: 'Acao e obrigatoria' });
  if (!f.id_finops) f.id_finops = await generateIdFinops();
  const cols = Object.keys(f);
  const vals = Object.values(f);
  const ph   = vals.map((_, i) => '$' + (i + 1)).join(', ');
  try {
    const r = await pool.query('INSERT INTO acoes_finops (' + cols.join(', ') + ') VALUES (' + ph + ') RETURNING *', vals);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ID FinOps ja cadastrado' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/acoes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  const f    = buildAcaoFields(req.body);
  const cols = Object.keys(f);
  const vals = Object.values(f);
  const sets = cols.map((col, i) => col + ' = $' + (i + 1)).join(', ');
  try {
    const r = await pool.query(
      'UPDATE acoes_finops SET ' + sets + ', atualizado_em=NOW() WHERE id=$' + (vals.length + 1) + ' RETURNING *',
      [...vals, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Acao nao encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/acoes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM acoes_finops WHERE id = $1', [req.params.id]);
    res.json({ message: 'Acao removida' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ESTIMATIVAS ─────────────────────────────────────────────────────────────
app.get('/api/estimativas', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT e.*, p.nome AS projeto_nome_atual
      FROM estimativas e
      LEFT JOIN projetos p ON p.id = e.projeto_id
      ORDER BY e.criado_em DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/estimativas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM estimativas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/estimativas', authMiddleware, dbMiddleware, async (req, res) => {
  const {
    projeto_id, projeto_nome, numero, titulo, responsavel, validade_dias,
    data_estimativa, horas, pct_imposto, pct_cond, vl_imposto, vl_cond,
    total_brl, total_final, observacoes, recursos
  } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO estimativas
        (projeto_id, projeto_nome, numero, titulo, responsavel, validade_dias,
         data_estimativa, horas, pct_imposto, pct_cond, vl_imposto, vl_cond,
         total_brl, total_final, observacoes, recursos)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      projeto_id || null, projeto_nome, numero, titulo, responsavel,
      validade_dias || 30, data_estimativa || null, horas || null,
      pct_imposto || 0, pct_cond || 0, vl_imposto || 0, vl_cond || 0,
      total_brl, total_final, observacoes || null,
      recursos ? JSON.stringify(recursos) : null
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/estimativas/:id/status', authMiddleware, dbMiddleware, async (req, res) => {
  const { status } = req.body;
  const allowed = ['Pendente', 'Aprovado', 'Nao Aprovado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const r = await pool.query(
      'UPDATE estimativas SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/estimativas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM estimativas WHERE id = $1', [req.params.id]);
    res.json({ message: 'Estimativa removida' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', dbMiddleware, async (_req, res) => {
  try {
    const [total, proj, porStatus, porCloud, totais] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM acoes_finops'),
      pool.query('SELECT COUNT(*) FROM projetos'),
      pool.query('SELECT status, COUNT(*) AS total FROM acoes_finops GROUP BY status'),
      pool.query('SELECT cloud, COUNT(*) AS total FROM acoes_finops WHERE cloud IS NOT NULL GROUP BY cloud'),
      pool.query('SELECT SUM(retorno_ano_atual) AS atual, SUM(retorno_proximo_ano) AS proximo FROM acoes_finops'),
    ]);
    res.json({
      total_acoes: parseInt(total.rows[0].count), total_projetos: parseInt(proj.rows[0].count),
      por_status: porStatus.rows, por_cloud: porCloud.rows, totais: totais.rows[0],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ═══════════════════════════════════════════════════════════════════════
// ROTAS AZURE COST MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CALCULADORA AZURE — Rotas de backend
// Adicionar ao final do server.js, antes do bloco // ─── START ───
// ═══════════════════════════════════════════════════════════════════════════

// ── Garantir tabela azure_costs (idempotente) ────────────────────────────────
// ── Flag: tabela Azure já inicializada nesta sessão do servidor ──────────────
let _azureTableReady = false;

async function ensureAzureCostsTable() {
  // Executar apenas uma vez por processo — evita ALTER TABLE/CREATE INDEX
  // em cada request, que causa lentidão séria com muitos dados
  if (_azureTableReady) return;

  const c = await pool.connect();
  try {
    // 1) Criar tabela se não existir (sempre com VARCHAR — nunca UUID)
    await c.query(`
      CREATE TABLE IF NOT EXISTS azure_costs (
        id                               BIGSERIAL PRIMARY KEY,
        invoice_id                       VARCHAR(200),
        previous_invoice_id              VARCHAR(200),
        billing_account_id               VARCHAR(200),
        billing_account_name             VARCHAR(500),
        billing_profile_id               VARCHAR(200),
        billing_profile_name             VARCHAR(500),
        invoice_section_id               VARCHAR(200),
        invoice_section_name             VARCHAR(500),
        reseller_name                    VARCHAR(500),
        reseller_mpn_id                  VARCHAR(200),
        cost_center                      VARCHAR(200),
        billing_period_end_date          DATE,
        billing_period_start_date        DATE,
        service_period_end_date          DATE,
        service_period_start_date        DATE,
        cost_date                        DATE,
        service_family                   VARCHAR(200),
        product_order_id                 VARCHAR(200),
        product_order_name               VARCHAR(500),
        consumed_service                 VARCHAR(500),
        meter_id                         VARCHAR(200),
        meter_name                       VARCHAR(500),
        meter_category                   VARCHAR(200),
        meter_sub_category               VARCHAR(200),
        meter_region                     VARCHAR(200),
        product_id                       VARCHAR(200),
        product_name                     VARCHAR(500),
        subscription_id                  VARCHAR(200),
        subscription_name                VARCHAR(500),
        publisher_type                   VARCHAR(100),
        publisher_id                     VARCHAR(200),
        publisher_name                   VARCHAR(500),
        resource_group_name              VARCHAR(500),
        resource_id                      TEXT,
        resource_location                VARCHAR(200),
        location                         VARCHAR(200),
        effective_price                  NUMERIC(20,10),
        quantity                         NUMERIC(20,10),
        unit_of_measure                  VARCHAR(100),
        charge_type                      VARCHAR(100),
        billing_currency                 VARCHAR(20),
        pricing_currency                 VARCHAR(20),
        cost_in_billing_currency         NUMERIC(20,10),
        cost_in_pricing_currency         NUMERIC(20,10),
        cost_in_usd                      NUMERIC(20,10),
        payg_cost_in_billing_currency    NUMERIC(20,10),
        payg_cost_in_usd                 NUMERIC(20,10),
        exchange_rate_pricing_to_billing NUMERIC(20,10),
        exchange_rate_date               DATE,
        is_azure_credit_eligible         BOOLEAN,
        service_info1                    TEXT,
        service_info2                    TEXT,
        additional_info                  TEXT,
        tags                             TEXT,
        payg_price                       NUMERIC(20,10),
        frequency                        VARCHAR(100),
        term                             VARCHAR(100),
        reservation_id                   VARCHAR(200),
        reservation_name                 VARCHAR(500),
        pricing_model                    VARCHAR(100),
        unit_price                       NUMERIC(20,10),
        cost_allocation_rule_name        VARCHAR(500),
        benefit_id                       VARCHAR(200),
        benefit_name                     VARCHAR(500),
        provider                         VARCHAR(200),
        resource_name                    VARCHAR(500),
        resource_type                    VARCHAR(200),
        importado_em                     TIMESTAMP DEFAULT NOW(),
        arquivo_origem                   VARCHAR(500)
      );
    `);

    // 2) Migração: converter colunas UUID → VARCHAR (executada uma única vez)
    for (const col of ['meter_id', 'subscription_id']) {
      const chk = await c.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name='azure_costs' AND column_name=$1`, [col]
      );
      if (chk.rows[0]?.data_type === 'uuid') {
        console.log(`[Migration] Convertendo coluna ${col}: UUID → VARCHAR(200)`);
        await c.query(`ALTER TABLE azure_costs ALTER COLUMN ${col} TYPE VARCHAR(200) USING ${col}::text`);
      }
    }

    // 3a) Adicionar colunas resource_name e resource_type se não existirem
    for (const [col, def] of [['resource_name','VARCHAR(500)'],['resource_type','VARCHAR(200)']]) {
      const chkCol = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='azure_costs' AND column_name=$1`, [col]
      );
      if (chkCol.rowCount === 0) {
        await c.query(`ALTER TABLE azure_costs ADD COLUMN ${col} ${def}`);
        console.log(`[Migration] Coluna ${col} adicionada à azure_costs`);
      }
    }

    // 3) Expandir VARCHAR pequenos (idempotente mas rápido)
    for (const sql of [
      "ALTER TABLE azure_costs ALTER COLUMN billing_currency TYPE VARCHAR(20)",
      "ALTER TABLE azure_costs ALTER COLUMN pricing_currency TYPE VARCHAR(20)",
    ]) {
      try { await c.query(sql); } catch (_) {}
    }

    // 4) Criar índices de performance (IF NOT EXISTS — rápido se já existem)
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_azure_costs_date         ON azure_costs(cost_date);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_sub          ON azure_costs(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_rg           ON azure_costs(resource_group_name);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_service      ON azure_costs(consumed_service);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_meter_cat    ON azure_costs(meter_category);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_resource_id  ON azure_costs(resource_id);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_importado    ON azure_costs(importado_em);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_rg       ON azure_costs(subscription_id, resource_group_name);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_date     ON azure_costs(subscription_id, cost_date);
      CREATE INDEX IF NOT EXISTS idx_azure_costs_rg_upper     ON azure_costs(UPPER(resource_group_name));
      CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_rg_upper ON azure_costs(subscription_id, UPPER(resource_group_name));
    `);

    // 5) Índice único funcional para deduplicação — COALESCE em TODAS as colunas nullable
    //    Inclui subscription_id e resource_id (antes sem COALESCE — linhas NULL se duplicavam)
    try {
      // Migração: recriar índice se definição antiga não cobria subscription_id/resource_id
      const oldIdx = await c.query(`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'azure_costs' AND indexname = 'idx_azure_costs_dedup'
      `);
      const precisaRecriar = oldIdx.rowCount > 0 &&
        !oldIdx.rows[0].indexdef.includes('COALESCE(subscription_id');
      if (precisaRecriar) {
        console.log('[Azure] Migrando índice de deduplicação para COALESCE completo...');
        // Remover duplicatas com a nova chave antes de criar o índice
        await c.query(`
          DELETE FROM azure_costs a
          USING azure_costs b
          WHERE a.id > b.id
            AND COALESCE(a.subscription_id,'') = COALESCE(b.subscription_id,'')
            AND COALESCE(a.resource_id,'')     = COALESCE(b.resource_id,'')
            AND a.cost_date                    = b.cost_date
            AND COALESCE(a.meter_id,'')        = COALESCE(b.meter_id,'')
            AND COALESCE(a.charge_type,'')     = COALESCE(b.charge_type,'')
            AND COALESCE(a.quantity,0)         = COALESCE(b.quantity,0)
        `);
        await c.query(`DROP INDEX IF EXISTS idx_azure_costs_dedup`);
      }
      await c.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_azure_costs_dedup
        ON azure_costs(
          COALESCE(subscription_id, ''),
          COALESCE(resource_id, ''),
          cost_date,
          COALESCE(meter_id, ''),
          COALESCE(charge_type, ''),
          COALESCE(quantity, 0)
        )
      `);
      console.log('[Azure] Índice de deduplicação criado/verificado ✅');
    } catch (errIdx) {
      console.warn('[Azure] ⚠ Índice de deduplicação não criado (provável duplicata existente):', errIdx.message);
      console.warn('[Azure] Execute a query de limpeza de duplicatas e reinicie o servidor.');
    }

    _azureTableReady = true;
    console.log('[Azure] Tabela azure_costs pronta ✅');
  } catch (err) {
    console.error('[Azure] Erro ao inicializar tabela:', err.message);
    // Não marcar como ready para tentar novamente
  } finally {
    c.release();
  }
}

// ── Cache de dropdowns (subscriptions + resource groups) ─────────────────────
// Tabelas pequenas pré-calculadas — atualizadas após cada import.
// Evita GROUP BY em toda a azure_costs a cada abertura da calculadora.
let _cacheRefreshing = false;
async function _refreshAzureCache() {
  if (!pool || _cacheRefreshing) return;
  _cacheRefreshing = true;
  const c = await pool.connect();
  try {
    const t0 = Date.now();
    await c.query(`
      CREATE TABLE IF NOT EXISTS azure_subs_cache (
        subscription_id   VARCHAR(200) PRIMARY KEY,
        subscription_name VARCHAR(500),
        periodo_inicio    DATE,
        periodo_fim       DATE,
        moeda             VARCHAR(20)
      );
      CREATE TABLE IF NOT EXISTS azure_rg_cache (
        subscription_id           VARCHAR(200),
        resource_group_name_upper VARCHAR(500),
        moeda                     VARCHAR(20),
        PRIMARY KEY (subscription_id, resource_group_name_upper)
      );
    `);
    await c.query('BEGIN');
    await c.query('DELETE FROM azure_subs_cache');
    await c.query(`
      INSERT INTO azure_subs_cache
        SELECT subscription_id,
               MAX(subscription_name) AS subscription_name,
               MIN(cost_date)         AS periodo_inicio,
               MAX(cost_date)         AS periodo_fim,
               MIN(billing_currency)  AS moeda
        FROM azure_costs
        WHERE subscription_id IS NOT NULL AND subscription_id <> ''
        GROUP BY subscription_id
    `);
    await c.query('DELETE FROM azure_rg_cache');
    await c.query(`
      INSERT INTO azure_rg_cache
        SELECT subscription_id,
               UPPER(resource_group_name) AS resource_group_name_upper,
               MIN(billing_currency)      AS moeda
        FROM azure_costs
        WHERE subscription_id IS NOT NULL AND subscription_id <> ''
          AND resource_group_name IS NOT NULL AND resource_group_name <> ''
        GROUP BY subscription_id, UPPER(resource_group_name)
    `);
    await c.query('COMMIT');
    console.log(`[Azure] Cache de dropdowns atualizado em ${Date.now()-t0}ms ✅`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[Azure] Erro ao atualizar cache de dropdowns:', err.message);
  } finally {
    c.release();
    _cacheRefreshing = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AZURE RETAIL PRICE LIST — cache local da API pública de preços
// https://prices.azure.com/api/retail/prices
// ═══════════════════════════════════════════════════════════════════════════════
let _priceListReady = false;

async function ensurePriceListTable() {
  if (_priceListReady) return;
  const c = await pool.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS azure_price_list (
        meter_id         VARCHAR(200)  NOT NULL,
        currency_code    VARCHAR(10)   NOT NULL DEFAULT 'BRL',
        arm_region_name  VARCHAR(100)  NOT NULL DEFAULT 'brazilsouth',
        retail_price     NUMERIC(20,10),
        unit_price       NUMERIC(20,10),
        unit_of_measure  VARCHAR(100),
        product_name     VARCHAR(500),
        sku_name         VARCHAR(500),
        service_name     VARCHAR(200),
        service_family   VARCHAR(200),
        type             VARCHAR(50),
        reservation_term VARCHAR(20) NOT NULL DEFAULT '',
        effective_start  DATE,
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (meter_id, currency_code, arm_region_name, type, reservation_term)
      );
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter        ON azure_price_list (meter_id);
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter_lower  ON azure_price_list (LOWER(meter_id));
      CREATE INDEX IF NOT EXISTS idx_pricelist_service      ON azure_price_list (service_name);
      CREATE INDEX IF NOT EXISTS idx_pricelist_region       ON azure_price_list (arm_region_name);
      CREATE INDEX IF NOT EXISTS idx_pricelist_type         ON azure_price_list (type);
      CREATE TABLE IF NOT EXISTS azure_price_list_meta (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Migração: garante índices funcionais em instâncias já existentes
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter_lower ON azure_price_list (LOWER(meter_id));
      CREATE INDEX IF NOT EXISTS idx_pricelist_type        ON azure_price_list (type);
    `).catch(() => {}); // silencia se já existir ou se a tabela ainda não tiver dados
    _priceListReady = true;
    console.log('[PriceList] Tabela pronta ✅');
  } catch (err) {
    console.warn('[PriceList] Erro ao criar tabela:', err.message);
  } finally {
    c.release();
  }
}

// Busca uma URL e retorna JSON — usado para paginar a Retail Prices API
function _fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON inválido na Retail Prices API: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout na Retail Prices API')); });
  });
}

let _syncingPriceList = false;
// Progresso em memória — exposto pelo /api/price-list/status em tempo real
let _syncProgress = { pages: 0, total: 0, started: null, error: null, finished: null };

// Grava resultado da sync no meta (usa conexão própria, fora de qualquer transação)
async function _gravaMeta(key, value) {
  try {
    await pool.query(`
      INSERT INTO azure_price_list_meta (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [key, typeof value === 'string' ? value : JSON.stringify(value)]);
  } catch (e) {
    console.warn('[PriceList] Aviso: não foi possível gravar meta:', e.message);
  }
}

// Busca uma página da Retail Prices API e retorna { items, nextLink, currency_used }
// Fallback automático: se a moeda solicitada retorna 0 itens, tenta USD
async function _fetchPriceListPage(urlOrFilter) {
  const data = await _fetchJson(urlOrFilter);
  return { items: data.Items || [], nextLink: data.NextPageLink || null };
}

function _buildPriceListUrl(currency) {
  // Nota: armRegionName NÃO é filtrado aqui — a Azure Retail Prices API retorna
  // 0 itens para 'brazilsouth' quando esse filtro é aplicado.
  // Os preços são globais (em USD); o meter_id é único mundialmente, portanto
  // o JOIN com azure_costs funciona sem filtrar por região na price list.
  const f = encodeURIComponent(`currencyCode eq '${currency}'`);
  return `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=${f}`;
}

async function _syncPriceList(requestedCurrency = 'USD') {
  if (_syncingPriceList) return { ok: false, msg: 'Sincronização já em andamento' };
  _syncingPriceList = true;
  _syncProgress = { pages: 0, total: 0, started: new Date().toISOString(), error: null, finished: null };

  let total = 0, pages = 0;
  // arm_region_name armazenado como 'global' pois não filtramos por região —
  // a Azure Retail Prices API retorna 0 itens para qualquer armRegionName específico.
  const ARM_REGION = 'global';
  // Chave de meta fora do try para ficar acessível no catch
  const resultKey = `last_result_${requestedCurrency}_${ARM_REGION}`;

  try {
    await ensurePriceListTable();

    // A Retail Prices API só funciona de forma confiável com USD.
    // BRL retorna Items vazio — usamos USD diretamente e convertemos via taxa_cambio no SQL.
    const currency = 'USD';
    console.log(`[PriceList] Iniciando sync — currency: ${currency}, sem filtro de região`);

    const probe = await _fetchPriceListPage(_buildPriceListUrl(currency));
    console.log(`[PriceList] Primeira página → ${probe.items.length} item(s)`);

    if (probe.items.length === 0) {
      throw new Error('Nenhum dado retornado pela Azure Retail Prices API. Verifique conectividade com prices.azure.com');
    }

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Limpa registros anteriores para essa moeda
      await c.query(`DELETE FROM azure_price_list WHERE currency_code = $1`, [currency]);

      let currentItems = probe.items;
      let nextLink     = probe.nextLink;

      while (true) {
        pages++;

        for (const item of currentItems) {
          if (!item.meterId) continue;
          await c.query(`
            INSERT INTO azure_price_list
              (meter_id, currency_code, arm_region_name, retail_price, unit_price,
               unit_of_measure, product_name, sku_name, service_name, service_family,
               type, reservation_term, effective_start, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
            ON CONFLICT (meter_id, currency_code, arm_region_name, type, reservation_term)
            DO UPDATE SET
              retail_price    = EXCLUDED.retail_price,
              unit_price      = EXCLUDED.unit_price,
              product_name    = EXCLUDED.product_name,
              sku_name        = EXCLUDED.sku_name,
              effective_start = EXCLUDED.effective_start,
              updated_at      = NOW()
          `, [
            item.meterId,
            currency, ARM_REGION,
            item.retailPrice   ?? 0,
            item.unitPrice     ?? 0,
            item.unitOfMeasure ?? null,
            item.productName   ?? null,
            item.skuName       ?? null,
            item.serviceName   ?? null,
            item.serviceFamily ?? null,
            item.type          ?? 'Consumption',
            item.reservationTerm ?? '',
            item.effectiveStartDate ? item.effectiveStartDate.slice(0, 10) : null
          ]);
          total++;
        }

        _syncProgress.pages = pages;
        _syncProgress.total = total;
        if (pages % 50 === 0)
          console.log(`[PriceList] Página ${pages} — ${total} registros...`);

        if (!nextLink) break;
        const next = await _fetchPriceListPage(nextLink);
        currentItems = next.items;
        nextLink     = next.nextLink;
      }

      await c.query('COMMIT');
      _syncProgress.finished = new Date().toISOString();
      console.log(`[PriceList] ✅ Sync concluído: ${total} registros em ${pages} páginas`);

      await _gravaMeta(resultKey, { ok: true, total, pages, currency, region: ARM_REGION, ts: _syncProgress.finished });
      return { ok: true, total, pages, currency, region: ARM_REGION };

    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  } catch (err) {
    _syncProgress.error    = err.message;
    _syncProgress.finished = new Date().toISOString();
    console.error(`[PriceList] ❌ Sync falhou: ${err.message}`);
    await _gravaMeta(resultKey, { ok: false, error: err.message, total, pages, ts: _syncProgress.finished });
    throw err;
  } finally {
    _syncingPriceList = false;
  }
}

// ── Helpers de importação ────────────────────────────────────────────────────
const _uploadDir = require('path').join(__dirname, 'uploads_tmp');
if (!require('fs').existsSync(_uploadDir)) require('fs').mkdirSync(_uploadDir, { recursive: true });

let _multer;
try { _multer = require('multer'); } catch (_) {}

// ─── Helpers de conversão (suporte a INT96, Decimal, Buffer) ─────────────────

// Converte qualquer valor para string segura
function _toStr(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) {
    // Buffer pode ser Decimal128 ou string bytes
    const s = v.toString('utf8');
    if (/^[\x20-\x7E]+$/.test(s)) return s.slice(0, 500);
    return null;
  }
  return String(v).slice(0, 500) || null;
}

// Converte INT96 (12 bytes: 8 nanos LE + 4 julian day LE) para data ISO
// ou qualquer outro formato de data que o parquetjs retorne
function _toDate(v) {
  if (v === null || v === undefined || v === '') return null;

  // 1) Buffer INT96 (12 bytes) — formato Spark/Azure parquet
  if (Buffer.isBuffer(v) && v.length === 12) {
    try {
      const julianDay = v.readUInt32LE(8);
      // Dias desde epoch Unix: Julian Day - 2440588
      const daysSinceEpoch = julianDay - 2440588;
      const ms = daysSinceEpoch * 86400000;
      // Nanossegundos da meia-noite (ignorar para datas)
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch (_) {}
  }

  // 2) Buffer INT96 (8 bytes) — nanos desde epoch
  if (Buffer.isBuffer(v) && v.length === 8) {
    try {
      // Ler como BigInt64 (nanosegundos desde 1970-01-01)
      const nanos = v.readBigInt64LE(0);
      const ms = Number(nanos / 1000000n);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch (_) {}
  }

  // 3) Buffer genérico — tentar como string
  if (Buffer.isBuffer(v)) {
    try {
      const s = v.toString('utf8').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    } catch (_) {}
    return null;
  }

  // 4) Date nativo JS
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }

  // 5) Número: dias desde epoch (INT32 DATE)
  if (typeof v === 'number' && Number.isInteger(v) && v > 10000 && v < 30000) {
    const ms = v * 86400000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  // 6) String com data
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    try {
      // M/D/YYYY ou MM/DD/YYYY (Azure portal — US) ou DD/MM/YYYY (europeu)
      // Auto-detect: se o 2º segmento > 12 ele é o dia → MM/DD/YYYY (Azure padrão)
      //              se o 1º segmento > 12 ele é o dia → DD/MM/YYYY (europeu)
      //              ambos ≤ 12 (ambíguo) → padrão Azure MM/DD/YYYY
      const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slash) {
        const a = parseInt(slash[1]), b = parseInt(slash[2]);
        let month, day;
        if (b > 12) { month = slash[1]; day = slash[2]; }       // MM/DD
        else if (a > 12) { day = slash[1]; month = slash[2]; }  // DD/MM
        else { month = slash[1]; day = slash[2]; }               // ambíguo → MM/DD (Azure)
        const iso = `${slash[3]}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : iso;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    } catch (_) { return null; }
  }

  // 7) Objeto com campo value (parquetjs-lite wraps)
  if (typeof v === 'object' && v !== null && 'value' in v) return _toDate(v.value);

  return null;
}

// Converte Decimal/Buffer/string/number para float
function _toNum(v) {
  if (v === null || v === undefined || v === '') return null;

  // 1) Buffer — Decimal armazenado como bytes big-endian com sinal
  if (Buffer.isBuffer(v)) {
    try {
      // Tentar como string UTF-8 primeiro (alguns parquet gravam decimal como string)
      const s = v.toString('utf8').trim();
      if (s && /^-?\d+\.?\d*$/.test(s)) {
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
      }
      // Big-endian signed integer (DECIMAL stored as unscaled int)
      // Tentar 8 bytes como BigInt
      if (v.length === 8) {
        const big = v.readBigInt64BE(0);
        // Escala típica do Azure Cost Management: 20 casas decimais
        return Number(big) / 1e10;
      }
      if (v.length === 16) {
        // 16 bytes: aproximação
        const hi = v.readBigInt64BE(0);
        return Number(hi) / 1e10;
      }
      // Fallback: ler como float64 LE
      if (v.length >= 8) {
        const n = v.readDoubleBE(0);
        if (isFinite(n) && !isNaN(n)) return n;
      }
    } catch (_) {}
    return null;
  }

  // 2) Bigint
  if (typeof v === 'bigint') return Number(v) / 1e10;

  // 3) Objeto com value
  if (typeof v === 'object' && v !== null && 'value' in v) return _toNum(v.value);

  // 4) Número ou string
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function _toBool(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  return String(v).toLowerCase() === 'true' || v === '1';
}

// Converte objeto/Buffer em JSON string
function _toJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v || null;
  if (Buffer.isBuffer(v)) {
    try { return v.toString('utf8') || null; } catch (_) { return null; }
  }
  try { return JSON.stringify(v); } catch (_) { return null; }
}

function _mapRow(row, nomeArquivo) {
  return {
    invoice_id:                      _toStr(row.invoiceId),
    previous_invoice_id:             _toStr(row.previousInvoiceId),
    billing_account_id:              _toStr(row.billingAccountId),
    billing_account_name:            _toStr(row.billingAccountName),
    billing_profile_id:              _toStr(row.billingProfileId),
    billing_profile_name:            _toStr(row.billingProfileName),
    invoice_section_id:              _toStr(row.invoiceSectionId),
    invoice_section_name:            _toStr(row.invoiceSectionName),
    reseller_name:                   _toStr(row.resellerName),
    reseller_mpn_id:                 _toStr(row.resellerMpnId),
    cost_center:                     _toStr(row.costCenter),
    billing_period_end_date:         _toDate(row.billingPeriodEndDate),
    billing_period_start_date:       _toDate(row.billingPeriodStartDate),
    service_period_end_date:         _toDate(row.servicePeriodEndDate),
    service_period_start_date:       _toDate(row.servicePeriodStartDate),
    cost_date:                       _toDate(row.date || row.Date || row.usageDate || row.UsageDate || row.serviceDate || row.ServiceDate),
    service_family:                  _toStr(row.serviceFamily      || row.ServiceFamily),
    product_order_id:                _toStr(row.productOrderId     || row.ProductOrderId),
    product_order_name:              _toStr(row.productOrderName   || row.ProductOrderName),
    consumed_service:                _toStr(row.consumedService    || row.ConsumedService),
    meter_id:                        _toStr(row.meterId            || row.MeterId),
    meter_name:                      _toStr(row.meterName          || row.MeterName),
    meter_category:                  _toStr(row.meterCategory      || row.MeterCategory),
    meter_sub_category:              _toStr(row.meterSubCategory   || row.MeterSubCategory),
    meter_region:                    _toStr(row.meterRegion        || row.MeterRegion),
    product_id:                      _toStr(row.productId          || row.ProductId),
    product_name:                    _toStr(row.productName        || row.ProductName),
    subscription_id:                 _toStr(row.subscriptionId     || row.SubscriptionId),
    subscription_name:               _toStr(row.subscriptionName   || row.SubscriptionName),
    publisher_type:                  _toStr(row.publisherType      || row.PublisherType),
    publisher_id:                    _toStr(row.publisherId        || row.PublisherId),
    publisher_name:                  _toStr(row.publisherName      || row.PublisherName),
    resource_group_name:             _toStr(row.resourceGroupName  || row.ResourceGroupName || row.resourceGroup || row.ResourceGroup),
    resource_id:                     (() => { const v = row.resourceId || row.ResourceId || row.instanceId || row.InstanceId; return v ? String(v).slice(0,2000) : null; })(),
    resource_name:                   _toStr(row.resourceName       || row.ResourceName),
    resource_type:                   _toStr(row.resourceType       || row.ResourceType),
    resource_location:               _toStr(row.resourceLocation   || row.ResourceLocation),
    location:                        _toStr(row.location           || row.Location),
    effective_price:                 _toNum(row.effectivePrice      ?? row.EffectivePrice),
    quantity:                        _toNum(row.quantity            ?? row.Quantity),
    unit_of_measure:                 _toStr(row.unitOfMeasure      || row.UnitOfMeasure),
    charge_type:                     _toStr(row.chargeType         || row.ChargeType),
    billing_currency:                _toStr(row.billingCurrency    || row.BillingCurrency || row.currency || row.Currency),
    pricing_currency:                _toStr(row.pricingCurrency    || row.PricingCurrency),
    cost_in_billing_currency:        _toNum(row.costInBillingCurrency ?? row.CostInBillingCurrency ?? row.extendedCost ?? row.ExtendedCost ?? row.preTaxCost ?? row.PreTaxCost ?? row.cost ?? row.Cost),
    cost_in_pricing_currency:        _toNum(row.costInPricingCurrency ?? row.CostInPricingCurrency),
    cost_in_usd:                     _toNum(row.costInUsd          ?? row.CostInUsd),
    payg_cost_in_billing_currency:   _toNum(row.paygCostInBillingCurrency ?? row.PaygCostInBillingCurrency),
    payg_cost_in_usd:                _toNum(row.paygCostInUsd      ?? row.PaygCostInUsd),
    exchange_rate_pricing_to_billing:_toNum(row.exchangeRatePricingToBilling ?? row.ExchangeRatePricingToBilling),
    exchange_rate_date:              _toDate(row.exchangeRateDate),
    is_azure_credit_eligible:        _toBool(row.isAzureCreditEligible),
    service_info1:                   _toStr(row.serviceInfo1),
    service_info2:                   _toStr(row.serviceInfo2),
    additional_info:                 _toJson(row.additionalInfo),
    tags:                            _toJson(row.tags),
    unit_price:                      _toNum(row.unitPrice           ?? row.UnitPrice),
    payg_price:                      _toNum(row.PayGPrice           ?? row.paygPrice          ?? row.payGPrice),
    frequency:                       _toStr(row.frequency          || row.Frequency),
    term:                            _toStr(row.term               || row.Term),
    reservation_id:                  _toStr(row.reservationId      || row.ReservationId),
    reservation_name:                _toStr(row.reservationName    || row.ReservationName),
    pricing_model:                   _toStr(row.pricingModel       || row.PricingModel),
    cost_allocation_rule_name:       _toStr(row.costAllocationRuleName || row.CostAllocationRuleName),
    benefit_id:                      _toStr(row.benefitId          || row.BenefitId),
    benefit_name:                    _toStr(row.benefitName        || row.BenefitName),
    provider:                        _toStr(row.provider           || row.Provider),
    arquivo_origem:                  nomeArquivo,
  };
}

// ── POST /api/azure-costs/import ─────────────────────────────────────────────
// ── Leitura de CSV do Azure Cost Management ──────────────────────────────────
// O CSV exportado pelo Azure tem cabeçalho em camelCase igual ao parquet.
// Suporta BOM (UTF-8 with BOM) e delimitador vírgula.
// ── Leitura de CSV — streaming linha a linha (suporta arquivos de qualquer tamanho) ──
// Retorna Promise<Array<Object>> para compatibilidade com arquivos grandes (>500MB)
function _lerCSV(filePath) {
  const fs       = require('fs');
  const readline = require('readline');

  return new Promise((resolve, reject) => {
    // Detectar BOM e delimitador lendo só os primeiros 4KB
    const buf       = Buffer.allocUnsafe(4096);
    const fd        = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const preview = buf.slice(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    const delim   = preview.includes(';') ? ';' : ',';

    // Parser CSV respeitando aspas
    function parseLine(line) {
      const fields = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === delim && !inQ) {
          fields.push(cur); cur = '';
        } else cur += ch;
      }
      fields.push(cur);
      return fields;
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let headers   = null;
    let firstLine = true;
    const rows    = [];

    rl.on('line', (rawLine) => {
      // Remover BOM do primeiro byte se presente
      const line = firstLine ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      firstLine = false;

      if (!line.trim()) return;

      if (!headers) {
        headers = parseLine(line).map(h => h.trim());
        return;
      }

      const vals = parseLine(line);
      if (!vals.some(v => v.trim())) return;

      const obj = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      rows.push(obj);
    });

    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

// ── Mapear linha CSV (camelCase Azure) → objeto DB ───────────────────────────
function _mapRowCSV(row, nomeArquivo) {
  // Suporta camelCase, PascalCase, "Title case" (MCA) e EA legacy
  // Lookup helper: percorre até 6 nomes, retorna o primeiro não-nulo/vazio
  const _p = (...keys) => { for (const k of keys) { const v = row[k]; if (v != null && v !== '') return v; } return null; };
  const p = (a, b, c) => _p(a, b, c);
  const n = (a, b, c) => _toNum(row[a] ?? row[b] ?? (c ? row[c] : undefined));
  const d = (a, b, c) => _toDate(row[a] || row[b] || (c ? row[c] : null));
  return {
    invoice_id:                      p('invoiceId',                    'InvoiceId',                    'Invoice ID'),
    previous_invoice_id:             p('previousInvoiceId',            'PreviousInvoiceId',            'Previous Invoice ID'),
    billing_account_id:              p('billingAccountId',             'BillingAccountId',             'Billing Account ID'),
    billing_account_name:            p('billingAccountName',           'BillingAccountName',           'Billing Account Name'),
    billing_profile_id:              p('billingProfileId',             'BillingProfileId',             'Billing Profile ID'),
    billing_profile_name:            p('billingProfileName',           'BillingProfileName',           'Billing Profile Name'),
    invoice_section_id:              p('invoiceSectionId',             'InvoiceSectionId',             'Invoice Section ID'),
    invoice_section_name:            p('invoiceSectionName',           'InvoiceSectionName',           'Invoice Section Name'),
    reseller_name:                   p('resellerName',                 'ResellerName',                 'Reseller Name'),
    reseller_mpn_id:                 p('resellerMpnId',                'ResellerMpnId',                'Reseller MPN ID'),
    cost_center:                     p('costCenter',                   'CostCenter',                   'Cost Center'),
    billing_period_end_date:         d('billingPeriodEndDate',         'BillingPeriodEndDate',         'Billing Period End Date'),
    billing_period_start_date:       d('billingPeriodStartDate',       'BillingPeriodStartDate',       'Billing Period Start Date'),
    service_period_end_date:         d('servicePeriodEndDate',         'ServicePeriodEndDate',         'Service Period End Date'),
    service_period_start_date:       d('servicePeriodStartDate',       'ServicePeriodStartDate',       'Service Period Start Date'),
    cost_date:                       _toDate(_p('date','Date','usageDate','UsageDate','Usage Date','serviceDate','ServiceDate','Service Date')),
    service_family:                  p('serviceFamily',                'ServiceFamily',                'Service Family'),
    product_order_id:                p('productOrderId',               'ProductOrderId',               'Product Order ID'),
    product_order_name:              p('productOrderName',             'ProductOrderName',             'Product Order Name'),
    consumed_service:                _p('consumedService','ConsumedService','Consumed Service','consumed service'),
    meter_id:                        p('meterId',                      'MeterId',                      'Meter ID'),
    meter_name:                      _p('meterName','MeterName','Meter Name','meter name','ServiceName','serviceName','Service Name'),
    meter_category:                  _p('meterCategory','MeterCategory','Meter Category','meter category','MeterCategories','ServiceCategory','serviceCategory','Service Category'),
    meter_sub_category:              p('meterSubCategory',             'MeterSubCategory',             'Meter Sub Category') || p('meterSubcategory', 'MeterSubcategory'),
    meter_region:                    p('meterRegion',                  'MeterRegion',                  'Meter Region'),
    product_id:                      p('productId',                    'ProductId',                    'Product ID'),
    product_name:                    p('productName',                  'ProductName',                  'Product Name'),
    subscription_id:                 p('subscriptionId',               'SubscriptionId',               'Subscription ID'),
    subscription_name:               p('subscriptionName',             'SubscriptionName',             'Subscription Name'),
    publisher_type:                  p('publisherType',                'PublisherType',                'Publisher Type'),
    publisher_id:                    p('publisherId',                  'PublisherId',                  'Publisher ID'),
    publisher_name:                  p('publisherName',                'PublisherName',                'Publisher Name'),
    resource_group_name:             _p('resourceGroupName','ResourceGroupName','Resource Group Name','resource group name','ResourceGroup','resourceGroup','Resource Group'),
    resource_id:                     _p('resourceId','ResourceId','Resource ID','resource id','instanceId','InstanceId','Instance ID','resourceGuid','ResourceGuid'),
    resource_name:                   p('resourceName',                 'ResourceName',                 'Resource Name'),
    resource_type:                   p('resourceType',                 'ResourceType',                 'Resource Type'),
    resource_location:               p('resourceLocation',             'ResourceLocation',             'Resource Location'),
    location:                        p('location',                     'Location'),
    effective_price:                 n('effectivePrice',               'EffectivePrice',               'Effective Price'),
    quantity:                        n('quantity',                     'Quantity'),
    unit_of_measure:                 _p('unitOfMeasure','UnitOfMeasure','Unit Of Measure','Unit of Measure','unit of measure','UoM','unitPrice_UoM'),
    charge_type:                     p('chargeType',                   'ChargeType',                   'Charge type') || row['Charge Type'] || null,
    billing_currency:                p('billingCurrency',              'BillingCurrency',              'Billing Currency') || p('currency', 'Currency'),
    pricing_currency:                p('pricingCurrency',              'PricingCurrency',              'Pricing Currency'),
    cost_in_billing_currency:        _toNum(_p('costInBillingCurrency','CostInBillingCurrency','Cost in billing currency','Cost In Billing Currency','ExtendedCost','extendedCost','PreTaxCost','preTaxCost','Cost','cost')),
    cost_in_pricing_currency:        n('costInPricingCurrency',        'CostInPricingCurrency',        'Cost in pricing currency'),
    cost_in_usd:                     n('costInUsd',                    'CostInUsd',                    'Cost in USD'),
    payg_cost_in_billing_currency:   n('paygCostInBillingCurrency',    'PaygCostInBillingCurrency',    'PayG Cost in billing currency'),
    payg_cost_in_usd:                n('paygCostInUsd',                'PaygCostInUsd',                'PayG Cost in USD'),
    exchange_rate_pricing_to_billing:n('exchangeRatePricingToBilling', 'ExchangeRatePricingToBilling', 'Exchange Rate Pricing To Billing'),
    exchange_rate_date:              d('exchangeRateDate',             'ExchangeRateDate',             'Exchange Rate Date'),
    is_azure_credit_eligible:        _toBool(row.isAzureCreditEligible || row.IsAzureCreditEligible || row['Is Azure Credit Eligible']),
    service_info1:                   p('serviceInfo1',                 'ServiceInfo1',                 'Service Info1'),
    service_info2:                   p('serviceInfo2',                 'ServiceInfo2',                 'Service Info2'),
    additional_info:                 row.additionalInfo || row.AdditionalInfo || row['Additional Info'] || null,
    tags:                            row.tags           || row.Tags           || null,
    payg_price:                      n('payGPrice',                    'PayGPrice') || _toNum(row.paygPrice) || _toNum(row['PayG Price']),
    frequency:                       p('frequency',                    'Frequency'),
    term:                            p('term',                         'Term'),
    reservation_id:                  p('reservationId',                'ReservationId',                'Reservation ID'),
    reservation_name:                p('reservationName',              'ReservationName',              'Reservation Name'),
    pricing_model:                   p('pricingModel',                 'PricingModel',                 'Pricing Model'),
    unit_price:                      n('unitPrice',                    'UnitPrice',                    'Unit Price'),
    cost_allocation_rule_name:       p('costAllocationRuleName',       'CostAllocationRuleName',       'Cost Allocation Rule Name'),
    benefit_id:                      p('benefitId',                    'BenefitId',                    'Benefit ID'),
    benefit_name:                    p('benefitName',                  'BenefitName',                  'Benefit Name'),
    provider:                        p('provider',                     'Provider'),
    arquivo_origem:                  nomeArquivo,
  };
}

// ── Converter Parquet → CSV via Python (fallback robusto) ────────────────────
async function _parquetParaCSV(parquetPath) {
  const { execFile } = require('child_process');
  const csvPath = parquetPath + '.csv';
  const script  = `
import sys, csv, json
try:
    import pyarrow.parquet as pq
    import pandas as pd
    df = pq.read_table(sys.argv[1]).to_pandas()
    # Converter datas e decimais para string
    for col in df.columns:
        if hasattr(df[col], 'dt'):
            df[col] = df[col].dt.strftime('%Y-%m-%d').where(df[col].notna(), '')
        else:
            df[col] = df[col].astype(str).replace('NaT','').replace('nan','').replace('<NA>','')
    df.to_csv(sys.argv[2], index=False)
    print('OK:' + str(len(df)))
except ImportError:
    print('NO_PYARROW')
except Exception as e:
    print('ERR:' + str(e))
`;
  return new Promise((resolve, reject) => {
    execFile('python3', ['-c', script, parquetPath, csvPath], { timeout: 60000 }, (err, stdout) => {
      const out = (stdout || '').trim();
      if (out.startsWith('NO_PYARROW')) return resolve(null); // pyarrow não disponível
      if (out.startsWith('ERR:'))       return reject(new Error(out.slice(4)));
      if (err)                          return reject(err);
      resolve(csvPath);
    });
  });
}

// ── Background import job state ──────────────────────────────────────────────
let _importJob = null;
// { id, arquivo, idx, total, status:'running'|'done'|'error',
//   linhas, inseridos, atualizados, erros, subArquivo, erro, iniciado, concluido }

async function _processarImport(tmpPath, originalname, jobId) {
  const fs   = require('fs');
  const path = require('path');
  let csvGerado    = null;
  const tmpZipFiles = [];
  let totalLinhas = 0, totalIns = 0, totalUpd = 0, totalErr = 0;

  function upd(fields) {
    if (_importJob && _importJob.id === jobId) Object.assign(_importJob, fields);
  }

  // Insert a batch of rows and update job progress counters
  async function _inserirLinhas(rows, mapFn, nomeArq, sql, COLS) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let spCount = 0;
      for (let i = 0; i < rows.length; i += 200) {
        for (const rawRow of rows.slice(i, i + 200)) {
          const sp = `sp_${spCount++}`;
          try {
            await client.query(`SAVEPOINT ${sp}`);
            const m      = mapFn(rawRow, nomeArq);
            const values = COLS.map(col => m[col] ?? null);
            const r      = await client.query(sql, values);
            await client.query(`RELEASE SAVEPOINT ${sp}`);
            if (r.rowCount > 0) totalIns++; else totalUpd++;
          } catch (e) {
            await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
            await client.query(`RELEASE SAVEPOINT ${sp}`);
            totalErr++;
          }
        }
        upd({ inseridos: totalIns, atualizados: totalUpd, erros: totalErr });
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  try {
    const nomeOriginal = originalname.toLowerCase();
    const isCSV     = nomeOriginal.endsWith('.csv');
    const isParquet = nomeOriginal.endsWith('.parquet');
    const isZIP     = nomeOriginal.endsWith('.zip');

    if (!isCSV && !isParquet && !isZIP) {
      upd({ status: 'error', erro: 'Formato não suportado', concluido: Date.now() });
      return;
    }

    const COLS = Object.keys(_mapRowCSV({}, ''));
    const ph   = COLS.map((_, i) => `$${i + 1}`).join(', ');
    const updateCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
    const sqlUpsert = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
      ON CONFLICT (COALESCE(subscription_id,''), COALESCE(resource_id,''), cost_date,
                   COALESCE(meter_id,''), COALESCE(charge_type,''), COALESCE(quantity,0))
      DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`;
    const sqlInsert = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;

    let temConstraint = false;
    try {
      const ck = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup' LIMIT 1`);
      temConstraint = ck.rowCount > 0;
    } catch (_) {}
    const sql = temConstraint ? sqlUpsert : sqlInsert;

    if (isZIP) {
      const AdmZip = require('adm-zip');
      const tmpDir = path.dirname(tmpPath);
      let zip;
      try { zip = new AdmZip(tmpPath); }
      catch (e) { upd({ status: 'error', erro: `ZIP inválido: ${e.message}`, concluido: Date.now() }); return; }

      const entradas = zip.getEntries().filter(e => {
        const n = e.entryName.toLowerCase();
        if (n.includes('..')) return false;
        return n.endsWith('.csv') || n.endsWith('.parquet');
      });

      if (!entradas.length) {
        upd({ status: 'error', erro: 'O ZIP não contém arquivos .csv ou .parquet válidos.', concluido: Date.now() });
        return;
      }

      console.log(`[Azure Import] ZIP com ${entradas.length} arquivo(s):`, entradas.map(e => e.entryName).join(', '));

      for (const entrada of entradas) {
        const nomeArq  = path.basename(entrada.entryName);
        const destPath = path.join(tmpDir, `zip_${Date.now()}_${nomeArq}`);
        tmpZipFiles.push(destPath);
        upd({ subArquivo: nomeArq });

        try { zip.extractEntryTo(entrada, tmpDir, false, true, false, `zip_${Date.now()}_${nomeArq}`); }
        catch (e) { console.warn(`[Azure Import] Falha ao extrair ${nomeArq}:`, e.message); continue; }

        let arquivoExtraido = destPath;
        if (!fs.existsSync(arquivoExtraido)) {
          const alt = path.join(tmpDir, nomeArq);
          if (fs.existsSync(alt)) arquivoExtraido = alt;
          else { console.warn(`[Azure Import] Arquivo extraído não encontrado: ${nomeArq}`); continue; }
        }

        let rows = [], mapFn = _mapRowCSV;
        if (nomeArq.endsWith('.csv')) {
          rows = await _lerCSV(arquivoExtraido);
        } else {
          let tmpCsv = null;
          try {
            tmpCsv = await _parquetParaCSV(arquivoExtraido);
            if (tmpCsv && fs.existsSync(tmpCsv)) rows = await _lerCSV(tmpCsv);
          } catch (_) { tmpCsv = null; }
          if (!rows.length) {
            let parquet;
            try { parquet = require('@dsnp/parquetjs'); } catch (_) {}
            if (!parquet) { try { parquet = require('parquetjs-lite'); } catch (_) {} }
            if (parquet) {
              const reader = await parquet.ParquetReader.openFile(arquivoExtraido);
              const cursor = reader.getCursor();
              let record;
              while ((record = await cursor.next()) !== null) rows.push(record);
              await reader.close();
              mapFn = _mapRow;
            }
          }
          if (tmpCsv) try { fs.unlinkSync(tmpCsv); } catch (_) {}
        }

        if (!rows.length) { console.warn(`[Azure Import] ${nomeArq} sem dados válidos, ignorado.`); continue; }
        totalLinhas += rows.length;
        upd({ linhas: totalLinhas });
        await _inserirLinhas(rows, mapFn, nomeArq, sql, COLS);
      }

    } else {
      let rows = [], mapFn = _mapRowCSV;

      if (isCSV) {
        console.log('[Azure Import] Lendo CSV:', originalname);
        rows  = await _lerCSV(tmpPath);
      } else {
        console.log('[Azure Import] Lendo Parquet:', originalname);
        try {
          csvGerado = await _parquetParaCSV(tmpPath);
          if (csvGerado && fs.existsSync(csvGerado)) {
            console.log('[Azure Import] Parquet convertido via pyarrow ✅');
            rows = await _lerCSV(csvGerado);
          }
        } catch (pyErr) {
          console.warn('[Azure Import] pyarrow falhou, tentando parquetjs:', pyErr.message);
          csvGerado = null;
        }
        if (!rows.length) {
          let parquet;
          try { parquet = require('@dsnp/parquetjs'); } catch (_) {}
          if (!parquet) { try { parquet = require('parquetjs-lite'); } catch (_) {} }
          if (parquet) {
            const reader = await parquet.ParquetReader.openFile(tmpPath);
            const cursor = reader.getCursor();
            let record;
            while ((record = await cursor.next()) !== null) rows.push(record);
            await reader.close();
            mapFn = _mapRow;
            console.warn('[Azure Import] Usando parquetjs (limitações possíveis)');
          } else {
            upd({ status: 'error', erro: 'Não foi possível ler o arquivo Parquet. Exporte como CSV ou instale @dsnp/parquetjs', concluido: Date.now() });
            return;
          }
        }
      }

      if (!rows.length) {
        upd({ status: 'error', erro: 'Arquivo vazio ou sem dados válidos.', concluido: Date.now() });
        return;
      }

      console.log(`[Azure Import] ${rows.length} linhas lidas.`);
      totalLinhas = rows.length;
      upd({ linhas: totalLinhas });
      await _inserirLinhas(rows, mapFn, originalname, sql, COLS);
    }

    // Log charge_type breakdown para diagnóstico
    try {
      const rCT = await pool.query(`
        SELECT COALESCE(charge_type,'(sem tipo)') AS ct, COUNT(*) AS n
        FROM azure_costs GROUP BY charge_type ORDER BY n DESC LIMIT 20`);
      const breakdown = rCT.rows.map(r => `${r.ct}:${r.n}`).join(', ');
      console.log(`[Azure Import] Charge types no banco: ${breakdown}`);
      upd({ charge_types: rCT.rows.map(r => ({ tipo: r.ct, linhas: parseInt(r.n) })) });
    } catch (_) {}

    console.log(`[Azure Import] Concluído: ${totalIns} inseridos, ${totalUpd} atualizados, ${totalErr} erros / ${totalLinhas} linhas`);
    _refreshAzureCache().catch(e => console.warn('[Azure] Falha ao atualizar cache pós-import:', e.message));
    upd({ status: 'done', inseridos: totalIns, atualizados: totalUpd, erros: totalErr, linhas: totalLinhas, concluido: Date.now() });

  } catch (err) {
    console.error('[Azure Import] Erro no processamento em background:', err);
    upd({ status: 'error', erro: err.message, concluido: Date.now() });
  } finally {
    if (tmpPath)   try { fs.unlinkSync(tmpPath);   } catch (_) {}
    if (csvGerado) try { fs.unlinkSync(csvGerado); } catch (_) {}
    for (const f of tmpZipFiles) try { fs.unlinkSync(f); } catch (_) {}
  }
}

if (_multer) {
  const _storage = _multer.diskStorage({
    destination: (_, __, cb) => cb(null, _uploadDir),
    filename: (_, file, cb) => cb(null, Date.now() + '_' + file.originalname),
  });

  // Limite de 2 GB — arquivos do Azure Cost Management podem ser grandes
  const FILE_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GB

  const _upload = _multer({
    storage: _storage,
    limits: {
      fileSize:   FILE_SIZE_LIMIT,
      fieldSize:  FILE_SIZE_LIMIT,
      files:      1,
    },
  });

  // Status do job de importação em andamento ou último concluído
  app.get('/api/azure-costs/import-status', authMiddleware, (req, res) => {
    res.json({ job: _importJob });
  });

  app.post('/api/azure-costs/import', authMiddleware, dbMiddleware, (req, res, next) => {
    req.setTimeout(0);
    res.setTimeout(0);
    _upload.single('arquivo')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: `Arquivo muito grande (limite: 2 GB). Divida em partes menores ou exporte um período menor no Azure Cost Management.`
          });
        }
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
      }
      next();
    });
  }, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // Rejeitar se já há uma importação em andamento
    if (_importJob && _importJob.status === 'running') {
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(409).json({ error: 'Uma importação já está em andamento. Aguarde a conclusão.' });
    }

    const jobId = Date.now().toString();
    const idx   = parseInt(req.body?.idx   || '1', 10);
    const total = parseInt(req.body?.total || '1', 10);

    _importJob = {
      id: jobId,
      arquivo: req.file.originalname,
      idx, total,
      status: 'running',
      linhas: 0, inseridos: 0, atualizados: 0, erros: 0,
      subArquivo: null, erro: null,
      iniciado: Date.now(), concluido: null,
    };

    // Processar em background — não aguarda a resposta HTTP
    _processarImport(req.file.path, req.file.originalname, jobId).catch(() => {});

    res.status(202).json({ jobId, arquivo: req.file.originalname });
  });
}

// ── GET /api/price-list/status ───────────────────────────────────────────────
app.get('/api/price-list/status', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    // A price list é sempre armazenada em USD/global (sem filtro de região)
    const currency = 'USD';
    const region   = 'global';

    // Garante tabela existe antes de consultar
    await ensurePriceListTable();

    const [meta, cnt] = await Promise.all([
      pool.query(
        `SELECT key, value, updated_at FROM azure_price_list_meta
         WHERE key = $1 ORDER BY key`,
        [`last_result_USD_global`]
      ),
      pool.query(`
        SELECT COUNT(*)                  AS total,
               COUNT(DISTINCT meter_id) AS meters,
               MAX(updated_at)          AS last_updated
        FROM azure_price_list
        WHERE currency_code = $1
      `, [currency])
    ]);

    // Lê último resultado gravado no meta
    let last_result = null;
    if (meta.rows[0]) {
      try { last_result = JSON.parse(meta.rows[0].value); } catch (_) {}
    }

    res.json({
      total:        parseInt(cnt.rows[0]?.total        || 0),
      meters:       parseInt(cnt.rows[0]?.meters       || 0),
      last_updated: cnt.rows[0]?.last_updated          || null,
      syncing:      _syncingPriceList,
      progress:     _syncingPriceList ? _syncProgress  : null,
      last_result
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/price-list/sync ─────────────────────────────────────────────────
// Dispara importação da Retail Prices API (fire-and-forget)
// Sempre sincroniza em USD sem filtro de região — a API não filtra por armRegionName
app.post('/api/price-list/sync', authMiddleware, dbMiddleware, async (req, res) => {
  if (_syncingPriceList)
    return res.status(409).json({ ok: false, msg: 'Sincronização já em andamento' });
  res.json({ ok: true, msg: 'Sincronização iniciada', currency: 'USD', region: 'global' });
  _syncPriceList()
    .catch(e => console.error('[PriceList] Erro na sincronização:', e.message));
});

// ── GET /api/calculadora/subscriptions ───────────────────────────────────────
app.get('/api/calculadora/subscriptions', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const _t0 = Date.now();
    let rows = [];
    try {
      const rc = await pool.query(`SELECT subscription_id, subscription_name, periodo_inicio, periodo_fim, moeda FROM azure_subs_cache ORDER BY subscription_name LIMIT 500`);
      rows = rc.rows;
    } catch (_) {}
    // Fallback: cache vazio ou tabela ainda não existe — lê direto
    if (!rows.length) {
      await _refreshAzureCache().catch(() => {});
      const rf = await pool.query(`SELECT subscription_id, subscription_name, periodo_inicio, periodo_fim, moeda FROM azure_subs_cache ORDER BY subscription_name LIMIT 500`).catch(() => ({ rows: [] }));
      rows = rf.rows;
    }
    // Último recurso: query direta na azure_costs
    if (!rows.length) {
      const rd = await pool.query(`
        SELECT subscription_id, MAX(subscription_name) AS subscription_name,
               MIN(cost_date) AS periodo_inicio, MAX(cost_date) AS periodo_fim,
               MIN(billing_currency) AS moeda
        FROM azure_costs
        WHERE subscription_id IS NOT NULL AND subscription_id <> ''
        GROUP BY subscription_id ORDER BY MAX(subscription_name) LIMIT 500
      `);
      rows = rd.rows;
    }
    console.log(`[Subscriptions] ${rows.length} subs — ${Date.now()-_t0}ms`);
    res.json(rows);
  } catch (err) {
    console.error('[Subscriptions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/resource-groups ─────────────────────────────────────
app.get('/api/calculadora/resource-groups', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const _t0 = Date.now();
    const { subscription_id } = req.query;
    const params = []; const cond = [];
    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) {
        cond.push(`subscription_id = $${params.length + 1}`); params.push(ids[0]);
      } else if (ids.length > 1) {
        cond.push(`subscription_id = ANY($${params.length + 1})`); params.push(ids);
      }
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    let rows = [];
    try {
      const rc = await pool.query(`SELECT resource_group_name_upper AS resource_group_name, moeda FROM azure_rg_cache ${where} ORDER BY resource_group_name_upper LIMIT 1000`, params);
      rows = rc.rows;
    } catch (_) {}
    // Fallback: cache vazio — lê direto
    if (!rows.length) {
      const fallbackCond = [...cond].map(c => c.replace('subscription_id', 'subscription_id'));
      const fd = await pool.query(`
        SELECT UPPER(resource_group_name) AS resource_group_name, MIN(billing_currency) AS moeda
        FROM azure_costs
        ${fallbackCond.length ? 'WHERE ' + fallbackCond.join(' AND ') + ' AND resource_group_name IS NOT NULL AND resource_group_name <> \'\'' : 'WHERE resource_group_name IS NOT NULL AND resource_group_name <> \'\''}
        GROUP BY UPPER(resource_group_name)
        ORDER BY UPPER(resource_group_name)
        LIMIT 1000
      `, params).catch(() => ({ rows: [] }));
      rows = fd.rows;
    }
    console.log(`[ResourceGroups] ${rows.length} grupos — ${Date.now()-_t0}ms`);
    res.json(rows);
  } catch (err) {
    console.error('[ResourceGroups]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/reconciliacao ───────────────────────────────────────
// Retorna breakdown por charge_type e moeda SEM filtro de exclusão —
// usado para reconciliar o total do sistema com o Azure Cost Management.
app.get('/api/calculadora/reconciliacao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, resource_group, data_inicio, data_fim } = req.query;
    const params = []; const cond = [];
    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) { cond.push(`subscription_id = $${params.length+1}`); params.push(ids[0]); }
      else if (ids.length > 1) { cond.push(`subscription_id = ANY($${params.length+1})`); params.push(ids); }
    }
    if (resource_group) {
      const rgs = resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rgs.length === 1) { cond.push(`UPPER(resource_group_name) = $${params.length+1}`); params.push(rgs[0]); }
      else if (rgs.length > 1) { cond.push(`UPPER(resource_group_name) = ANY($${params.length+1})`); params.push(rgs); }
    }
    if (data_inicio) { cond.push(`cost_date >= $${params.length+1}`); params.push(data_inicio); }
    if (data_fim)    { cond.push(`cost_date <= $${params.length+1}`); params.push(data_fim); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    const [rTipo, rMoeda] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(charge_type, '(sem tipo)') AS charge_type,
          COUNT(*)                             AS linhas,
          SUM(COALESCE(cost_in_billing_currency, 0)) AS total
        FROM azure_costs ${where}
        GROUP BY charge_type
        ORDER BY SUM(COALESCE(cost_in_billing_currency, 0)) DESC
      `, params),
      pool.query(`
        SELECT
          COALESCE(billing_currency, 'USD') AS moeda,
          SUM(COALESCE(cost_in_billing_currency, 0)) AS total
        FROM azure_costs ${where}
        GROUP BY billing_currency
        ORDER BY total DESC
      `, params),
    ]);

    const excluidos = ['Tax', 'Refund', 'RoundingAdjustment'];
    const porTipo = rTipo.rows.map(r => ({
      charge_type: r.charge_type,
      linhas:      parseInt(r.linhas, 10),
      total:       parseFloat(r.total) || 0,
      excluido:    excluidos.includes(r.charge_type),
    }));

    const totalBruto    = porTipo.reduce((s, r) => s + r.total, 0);
    const totalExcluido = porTipo.filter(r => r.excluido).reduce((s, r) => s + r.total, 0);
    const totalSistema  = totalBruto - totalExcluido;

    res.json({
      por_tipo:        porTipo,
      por_moeda:       rMoeda.rows.map(r => ({ moeda: r.moeda, total: parseFloat(r.total) || 0 })),
      total_bruto:     totalBruto,
      total_excluido:  totalExcluido,
      total_sistema:   totalSistema,
    });
  } catch (err) {
    console.error('[Reconciliacao]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/recursos ────────────────────────────────────────────
// Aceita subscription_id e resource_group como valores separados por vírgula
app.get('/api/calculadora/recursos', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    // Garante que a tabela azure_price_list existe antes do LEFT JOIN
    await ensurePriceListTable();

    const { subscription_id, resource_group, data_inicio, data_fim } = req.query;
    const params = []; const cond = [];

    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) {
        cond.push(`subscription_id = $${params.length + 1}`); params.push(ids[0]);
      } else if (ids.length > 1) {
        cond.push(`subscription_id = ANY($${params.length + 1})`); params.push(ids);
      }
    }
    if (resource_group) {
      // Sempre normaliza para UPPER para deduplicar variações de case
      const rgs = resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rgs.length === 1) {
        cond.push(`UPPER(resource_group_name) = $${params.length + 1}`);
        params.push(rgs[0]);
      } else if (rgs.length > 1) {
        cond.push(`UPPER(resource_group_name) = ANY($${params.length + 1})`);
        params.push(rgs);
      }
    }
    if (data_inicio) { cond.push(`cost_date >= $${params.length + 1}`); params.push(data_inicio); }
    if (data_fim)    { cond.push(`cost_date <= $${params.length + 1}`); params.push(data_fim); }

    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    const _t0 = Date.now();

    const r = await pool.query(`
      -- ── CTE base: agrega azure_costs por recurso ─────────────────────────────
      WITH base AS (
        SELECT
          resource_id,
          MAX(UPPER(resource_group_name))                                     AS resource_group_name,
          MAX(COALESCE(
            NULLIF(SPLIT_PART(resource_id, '/', 9), ''),
            product_name, meter_name, resource_id
          ))                                                                   AS nome_recurso,
          COALESCE(MAX(meter_category), MAX(consumed_service), MAX(product_name), 'Outros') AS categoria,
          COALESCE(MAX(meter_name), MAX(product_name), MAX(meter_sub_category), '')     AS meter_categories,
          MAX(meter_sub_category)                                              AS subcategoria,
          MAX(product_name)                                                    AS produto,
          MAX(consumed_service)                                                AS consumed_service,
          MAX(COALESCE(charge_type, 'Usage'))                                  AS charge_type,
          MAX(COALESCE(pricing_model, 'OnDemand'))                             AS pricing_model,
          MAX(publisher_type)                                                  AS publisher_type,
          MAX(publisher_name)                                                  AS publisher_name,
          MAX(resource_location)                                               AS regiao,
          MAX(location)                                                        AS location,
          MAX(billing_currency)                                                AS moeda,
          MAX(exchange_rate_pricing_to_billing)                                AS taxa_cambio,
          MIN(cost_date)                                                       AS data_inicio,
          MAX(cost_date)                                                       AS data_fim,
          (MAX(cost_date) - MIN(cost_date) + 1)                               AS dias_ativos,
          SUM(COALESCE(cost_in_billing_currency, 0))                          AS total_billing,
          SUM(COALESCE(cost_in_usd, 0))                                       AS total_usd,
          SUM(COALESCE(quantity, 0))                                           AS total_qty,
          SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity, 0)
              * COALESCE(exchange_rate_pricing_to_billing, 1))                 AS total_upq_brl,
          SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity, 0)) AS total_upq_usd,
          COALESCE(MAX(unit_of_measure), '')                                    AS unidade,
          COALESCE(MAX(unit_of_measure), '')                                    AS unit_of_measure,
          -- ── HORAS REAIS DO PERÍODO (qty × fator UoM, só para UoM horária) ──
          CASE
            WHEN (MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%')
                 AND SUM(COALESCE(quantity,0)) > 0
            THEN ROUND(
              SUM(COALESCE(quantity,0))::numeric
              * GREATEST(COALESCE(
                  NULLIF(REGEXP_REPLACE(MAX(unit_of_measure),'[^0-9]','','g'),'')::numeric,
                  1.0
                ), 1.0)
            , 2)
            ELSE NULL
          END AS horas_reais,
          -- ── TIPO DE CUSTO (RN-001 a RN-004) ──────────────────────────────────
          CASE
            WHEN MAX(COALESCE(charge_type,'')) IN ('Purchase','RoundTrustBill')
                 AND MAX(COALESCE(pricing_model,'')) = 'Reservation'
            THEN 'reserva'
            WHEN MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%'
            THEN 'hora'
            WHEN MAX(unit_of_measure) ILIKE '%day%'
            THEN 'dia'
            ELSE 'periodo'
          END AS tipo_custo,
          -- ── TAXA HORÁRIA via effective_price ─────────────────────────────────
          CASE
            WHEN (MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%')
                 AND SUM(COALESCE(quantity,0)) > 0
            THEN ROUND(
              SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0)
                  * COALESCE(quantity,0)
                  * COALESCE(exchange_rate_pricing_to_billing,1))::numeric
              / NULLIF(
                  SUM(COALESCE(quantity,0))
                  * GREATEST(COALESCE(
                      NULLIF(REGEXP_REPLACE(MAX(unit_of_measure),'[^0-9]','','g'),'')::numeric,
                      1.0), 1.0)
                , 0)
            , 8)
            ELSE NULL
          END AS taxa_hora_rate,
          -- ── CUSTO/HORA BILLING (4 RNs) ───────────────────────────────────────
          COALESCE(
            CASE
              WHEN MAX(COALESCE(charge_type,'')) IN ('Purchase','RoundTrustBill')
                   AND MAX(COALESCE(pricing_model,'')) = 'Reservation'
              THEN ROUND(
                SUM(COALESCE(cost_in_billing_currency,0))::numeric
                / NULLIF(CASE WHEN MAX(term) ILIKE '3%' THEN 26280.0 ELSE 8760.0 END, 0)
              , 8)
            END,
            CASE
              WHEN (MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%')
                   AND SUM(COALESCE(quantity,0)) > 0
              THEN ROUND(
                SUM(COALESCE(cost_in_billing_currency,0))::numeric
                / NULLIF(
                    SUM(COALESCE(quantity,0))
                    * GREATEST(COALESCE(
                        NULLIF(REGEXP_REPLACE(MAX(unit_of_measure),'[^0-9]','','g'),'')::numeric,
                        1.0), 1.0)
                  , 0)
              , 8)
            END,
            CASE
              WHEN MAX(unit_of_measure) ILIKE '%day%'
                   AND SUM(COALESCE(quantity,0)) > 0
              THEN ROUND(
                SUM(COALESCE(cost_in_billing_currency,0))::numeric
                / NULLIF(SUM(COALESCE(quantity,0)) * 24.0, 0)
              , 8)
            END,
            ROUND(
              SUM(COALESCE(cost_in_billing_currency,0))::numeric
              / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24.0, 0)
            , 8)
          ) AS custo_hora_billing,
          -- ── CUSTO/HORA USD ────────────────────────────────────────────────────
          COALESCE(
            CASE
              WHEN MAX(COALESCE(charge_type,'')) IN ('Purchase','RoundTrustBill')
                   AND MAX(COALESCE(pricing_model,'')) = 'Reservation'
              THEN ROUND(
                SUM(COALESCE(cost_in_usd,0))::numeric
                / NULLIF(CASE WHEN MAX(term) ILIKE '3%' THEN 26280.0 ELSE 8760.0 END, 0)
              , 8)
            END,
            CASE
              WHEN (MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%')
                   AND SUM(COALESCE(quantity,0)) > 0
              THEN ROUND(
                SUM(COALESCE(cost_in_usd,0))::numeric
                / NULLIF(
                    SUM(COALESCE(quantity,0))
                    * GREATEST(COALESCE(
                        NULLIF(REGEXP_REPLACE(MAX(unit_of_measure),'[^0-9]','','g'),'')::numeric,
                        1.0), 1.0)
                  , 0)
              , 8)
            END,
            CASE
              WHEN MAX(unit_of_measure) ILIKE '%day%' AND SUM(COALESCE(quantity,0)) > 0
              THEN ROUND(
                SUM(COALESCE(cost_in_usd,0))::numeric
                / NULLIF(SUM(COALESCE(quantity,0)) * 24.0, 0)
              , 8)
            END,
            ROUND(
              SUM(COALESCE(cost_in_usd,0))::numeric
              / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24.0, 0)
            , 8)
          ) AS custo_hora_usd,
          -- ── CUSTO MENSAL (Storage/Bandwidth) ─────────────────────────────────
          ROUND(
            SUM(COALESCE(cost_in_billing_currency,0))::numeric
            / GREATEST(MAX(cost_date)-MIN(cost_date)+1, 1) * 30.0
          , 4) AS custo_mes_billing,
          NULL::numeric AS custo_dia_billing,
          NULL::numeric AS custo_dia_usd,
          NULL::numeric AS custo_uom_billing,
          NULL::numeric AS custo_uom_usd,
          -- Chaves para o JOIN com price list
          MAX(meter_id)                          AS _meter_id,
          MAX(COALESCE(billing_currency, 'BRL')) AS _currency
        FROM azure_costs
        ${where}
        GROUP BY resource_id,
                 COALESCE(meter_category,''),
                 COALESCE(meter_name,''),
                 COALESCE(unit_of_measure,'')
      )
      -- ── Outer: enriquece com preço retail e desconto ──────────────────────────
      SELECT
        base.resource_id,
        base.resource_group_name,
        base.nome_recurso,
        base.categoria,
        base.meter_categories,
        base.subcategoria,
        base.produto,
        base.consumed_service,
        base.charge_type,
        base.pricing_model,
        base.publisher_type,
        base.publisher_name,
        base.regiao,
        base.location,
        base.moeda,
        base.taxa_cambio,
        base.data_inicio,
        base.data_fim,
        base.dias_ativos,
        base.total_billing,
        base.total_usd,
        base.total_qty,
        base.total_upq_brl,
        base.total_upq_usd,
        base.unidade,
        base.unit_of_measure,
        base.horas_reais,
        base.tipo_custo,
        base.taxa_hora_rate,
        base.custo_hora_billing,
        base.custo_hora_usd,
        base.custo_mes_billing,
        base.custo_dia_billing,
        base.custo_dia_usd,
        base.custo_uom_billing,
        base.custo_uom_usd,
        -- ── Price List: preço retail on-demand normalizado e desconto ──────────
        -- retail_price_unit: preço de catálogo na UoM original do azure_costs.
        -- Quando a Price List está em USD e o billing é BRL, converte via taxa_cambio
        -- (exchange_rate_pricing_to_billing). Fallback: taxa 1 (sem conversão).
        COALESCE(
          pl.retail_price * CASE
            WHEN pl.currency_code = base.moeda THEN 1.0           -- mesma moeda
            WHEN pl.currency_code = 'USD'                          -- USD → billing
            THEN COALESCE(NULLIF(base.taxa_cambio::numeric, 0), 1.0)
            ELSE 1.0
          END,
          0
        )::numeric AS retail_price_unit,
        -- desconto_pct: % de desconto vs on-demand (só para hora/dia)
        CASE
          WHEN COALESCE(pl.retail_price, 0) > 0
               AND COALESCE(base.custo_hora_billing, 0) > 0
               AND base.tipo_custo IN ('hora', 'dia')
          THEN ROUND(
            (1 - base.custo_hora_billing::numeric
                 / NULLIF(
                     -- retail convertido para billing_currency / fator UoM
                     pl.retail_price::numeric
                     * CASE
                         WHEN pl.currency_code = base.moeda THEN 1.0
                         WHEN pl.currency_code = 'USD'
                         THEN COALESCE(NULLIF(base.taxa_cambio::numeric, 0), 1.0)
                         ELSE 1.0
                       END
                     / GREATEST(
                         COALESCE(
                           NULLIF(REGEXP_REPLACE(base.unidade,'[^0-9]','','g'),'')::numeric,
                           1.0
                         ), 1.0
                       )
                   , 0)
            ) * 100, 1)
          ELSE NULL
        END AS desconto_pct
      FROM base
      LEFT JOIN azure_price_list pl
             ON LOWER(pl.meter_id) = LOWER(base._meter_id)   -- case-insensitive: billing pode ter casing diferente
            AND pl.type IN ('Consumption', 'DevTestConsumption')  -- inclui Dev/Test
            AND pl.reservation_term = ''      -- NOT NULL DEFAULT '' — não usar IS NULL
            -- Aceita tanto a moeda do billing quanto USD (com conversão acima)
            AND pl.currency_code IN (base._currency, 'USD')
      ORDER BY base.resource_group_name, base.total_billing DESC
    `, params);

    console.log(`[Recursos] ${r.rows.length} recursos — ${Date.now()-_t0}ms`);
    res.json(r.rows);
  } catch (err) {
    console.error('Erro /api/calculadora/recursos:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/debug-recurso ───────────────────────────────────────
app.get('/api/calculadora/debug-recurso', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, resource_group } = req.query;
    if (!subscription_id) return res.status(400).json({ error: 'subscription_id obrigatório' });
    const cond = [`subscription_id = $1`];
    const params = [subscription_id];
    if (resource_group) { cond.push(`UPPER(resource_group_name) = $2`); params.push(resource_group.toUpperCase()); }
    const r = await pool.query(`
      SELECT
        resource_id,
        meter_category, meter_name, unit_of_measure,
        consumed_service, charge_type, pricing_model,
        cost_in_billing_currency, cost_in_usd,
        exchange_rate_pricing_to_billing, billing_currency,
        COUNT(*) AS linhas,
        SUM(cost_in_billing_currency) AS soma_billing,
        SUM(cost_in_usd) AS soma_usd
      FROM azure_costs WHERE ${cond.join(' AND ')}
      GROUP BY resource_id, meter_category, meter_name, unit_of_measure,
               consumed_service, charge_type, pricing_model,
               cost_in_billing_currency, cost_in_usd,
               exchange_rate_pricing_to_billing, billing_currency
      ORDER BY resource_id LIMIT 50`, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/calculadora/detalhe-diario ──────────────────────────────────────
// Retorna custos por data × recurso × serviço/meter (para a visão "Por Data")
app.get('/api/calculadora/detalhe-diario', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, resource_group, data_inicio, data_fim } = req.query;
    const params = []; const cond = [];
    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) { cond.push(`subscription_id = $${params.length+1}`); params.push(ids[0]); }
      else if (ids.length > 1) { cond.push(`subscription_id = ANY($${params.length+1})`); params.push(ids); }
    }
    if (resource_group) {
      const rgs = resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rgs.length === 1) { cond.push(`UPPER(resource_group_name) = $${params.length+1}`); params.push(rgs[0]); }
      else if (rgs.length > 1) { cond.push(`UPPER(resource_group_name) = ANY($${params.length+1})`); params.push(rgs); }
    }
    if (data_inicio) { cond.push(`cost_date >= $${params.length+1}`); params.push(data_inicio); }
    if (data_fim)    { cond.push(`cost_date <= $${params.length+1}`); params.push(data_fim); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const r = await pool.query(`
      SELECT
        cost_date::text                                                                  AS cost_date,
        subscription_id,
        MAX(subscription_name)                                                           AS subscription_name,
        resource_id,
        COALESCE(
          NULLIF(SPLIT_PART(resource_id, '/', 9), ''),
          MAX(product_name), MAX(meter_name), resource_id
        )                                                                                AS nome_recurso,
        MAX(COALESCE(meter_category, consumed_service))                                  AS resource_type,
        MAX(COALESCE(resource_location, location))                                       AS location,
        MAX(resource_group_name)                                                         AS resource_group_name,
        COALESCE(MAX(consumed_service), '')                                              AS service_name,
        COALESCE(MAX(meter_name), '')                                                    AS meter,
        SUM(COALESCE(cost_in_billing_currency, 0))                                       AS cost
      FROM azure_costs
      ${where}
      GROUP BY cost_date, subscription_id, resource_id, consumed_service, meter_name
      ORDER BY cost_date DESC, SUM(COALESCE(cost_in_billing_currency,0)) DESC
      LIMIT 15000
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('Erro /api/calculadora/detalhe-diario:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/por-servico ─────────────────────────────────────────
// Retorna custos agrupados por serviço (consumed_service / meter_category)
app.get('/api/calculadora/por-servico', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, resource_group, data_inicio, data_fim } = req.query;
    const params = []; const cond = [];
    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) { cond.push(`subscription_id = $${params.length+1}`); params.push(ids[0]); }
      else if (ids.length > 1) { cond.push(`subscription_id = ANY($${params.length+1})`); params.push(ids); }
    }
    if (resource_group) {
      const rgs = resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rgs.length === 1) { cond.push(`UPPER(resource_group_name) = $${params.length+1}`); params.push(rgs[0]); }
      else if (rgs.length > 1) { cond.push(`UPPER(resource_group_name) = ANY($${params.length+1})`); params.push(rgs); }
    }
    if (data_inicio) { cond.push(`cost_date >= $${params.length+1}`); params.push(data_inicio); }
    if (data_fim)    { cond.push(`cost_date <= $${params.length+1}`); params.push(data_fim); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const r = await pool.query(`
      SELECT
        COALESCE(NULLIF(consumed_service,''), meter_category, 'Desconhecido') AS service_name,
        COUNT(DISTINCT resource_id)                                            AS qtd_recursos,
        COUNT(DISTINCT resource_group_name)                                    AS qtd_rgs,
        SUM(COALESCE(cost_in_billing_currency, 0))                             AS total_brl
      FROM azure_costs
      ${where}
      GROUP BY COALESCE(NULLIF(consumed_service,''), meter_category, 'Desconhecido')
      ORDER BY total_brl DESC
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('Erro /api/calculadora/por-servico:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/calculadora/diagnostico ─────────────────────────────────────────
// Retorna padrões de meter_category, consumed_service, charge_type, etc.
// para a tela de diagnóstico do calculadora.js
app.get('/api/calculadora/diagnostico', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, resource_group } = req.query;
    const params = []; const cond = [];

    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 1) { cond.push(`subscription_id = $${params.length+1}`); params.push(ids[0]); }
      else if (ids.length > 1) { cond.push(`subscription_id = ANY($${params.length+1})`); params.push(ids); }
    }
    if (resource_group) {
      const rgs = resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rgs.length === 1) { cond.push(`UPPER(resource_group_name) = $${params.length+1}`); params.push(rgs[0]); }
      else if (rgs.length > 1) { cond.push(`UPPER(resource_group_name) = ANY($${params.length+1})`); params.push(rgs); }
    }
    cond.push(`meter_category IS NOT NULL`);

    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const r = await pool.query(`
      SELECT
        meter_category,
        MAX(meter_sub_category) AS meter_sub_category,
        MAX(consumed_service)   AS consumed_service,
        MAX(charge_type)        AS charge_type,
        MAX(unit_of_measure)    AS unit_of_measure,
        MAX(pricing_model)      AS pricing_model,
        MAX(publisher_type)     AS publisher_type,
        COUNT(DISTINCT resource_id) AS recursos,
        COUNT(*)                    AS linhas,
        SUM(COALESCE(cost_in_billing_currency, 0)) AS total_billing,
        MIN(billing_currency)   AS moeda
      FROM azure_costs
      ${where}
      GROUP BY meter_category
      ORDER BY total_billing DESC
      LIMIT 500
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[Diagnostico]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/calculadora/estimar ────────────────────────────────────────────
// Body: { recursos: [{resource_id, horas}], taxa_brl }
app.post('/api/calculadora/estimar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { recursos, taxa_brl = 1, data_inicio, data_fim, subscription_id, resource_group } = req.body;
    if (!recursos || !recursos.length) return res.status(400).json({ error: 'Nenhum recurso selecionado.' });

    const ids = recursos.map(r => r.resource_id);
    const params = [ids]; const cond = [`resource_id = ANY($1)`, `cost_in_billing_currency > 0`];
    if (subscription_id) { cond.push(`subscription_id = $${params.length+1}`); params.push(subscription_id); }
    if (data_inicio)     { cond.push(`cost_date >= $${params.length+1}`); params.push(data_inicio); }
    if (data_fim)        { cond.push(`cost_date <= $${params.length+1}`); params.push(data_fim); }

    const r = await pool.query(`
      SELECT resource_id,
             COUNT(DISTINCT cost_date)                                        AS dias_ativos,
             SUM(cost_in_billing_currency)                                    AS total_billing,
             SUM(cost_in_usd)                                                 AS total_usd,
             MAX(billing_currency)                                            AS moeda,
             MAX(exchange_rate_pricing_to_billing)                            AS taxa_cambio,
             MAX(unit_of_measure)                                             AS unidade,
             MAX(charge_type)                                                 AS charge_type,
             MAX(pricing_model)                                               AS pricing_model,
             MAX(term)                                                        AS term,
             SUM(quantity)                                                    AS total_qty,
             SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity,0))
                                                                              AS total_upq,
             SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity,0)
                 * COALESCE(exchange_rate_pricing_to_billing,1))              AS total_upq_brl
      FROM azure_costs
      WHERE ${cond.join(' AND ')}
      GROUP BY resource_id
    `, params);

    // Período em dias da consulta (usado para recursos não-horários)
    let periodoDias = 30;
    if (data_inicio && data_fim) {
      const d1 = new Date(data_inicio + 'T12:00:00');
      const d2 = new Date(data_fim   + 'T12:00:00');
      const diff = Math.round((d2 - d1) / 86400000) + 1;
      if (diff > 0) periodoDias = diff;
    }

    const mapa = {};
    r.rows.forEach(row => { mapa[row.resource_id] = row; });

    const resultados = recursos.map(item => {
      const dados = mapa[item.resource_id];
      if (!dados) return { resource_id: item.resource_id, erro: 'Sem dados no período', horas: item.horas };
      const diasAtivos   = parseInt(dados.dias_ativos) || 1;
      const totalBilling = parseFloat(dados.total_billing) || 0;
      const totalUsd     = parseFloat(dados.total_usd)     || 0;
      const totalQty     = parseFloat(dados.total_qty)     || 0;
      const uom          = (dados.unidade || '').toLowerCase();
      const chargeType   = (dados.charge_type   || '').trim();
      const pricingModel = (dados.pricing_model || '').trim();
      const term         = (dados.term          || '');

      // ── Classificação do tipo de custo (mesma lógica do SELECT /recursos) ──
      const isReserva = ['Purchase','RoundTrustBill'].includes(chargeType) && pricingModel === 'Reservation';
      const isHora    = !isReserva && (uom.includes('hour') || uom.includes('hora'));
      const isDia     = !isReserva && !isHora && uom.includes('day');
      const tipoCusto = isReserva ? 'reserva' : isHora ? 'hora' : isDia ? 'dia' : 'periodo';

      // ── Fator UoM: "10 Hours" → 10, "1 Hour" → 1 ─────────────────────────
      const fatorUom  = Math.max(parseInt((uom.match(/\d+/) || ['1'])[0]) || 1, 1);

      // ── effective_price × qty (custo real com descontos aplicados) ──────────
      const totalUpq    = parseFloat(dados.total_upq)     || 0;
      const totalUpqBrl = parseFloat(dados.total_upq_brl) || 0;

      const moeda          = dados.moeda || 'USD';
      const horas          = parseFloat(item.horas) || 0;
      const dias_estimados = horas / 24;
      const horasReais     = diasAtivos * 24 || 720;

      let custo_hora_billing, custo_hora_usd;

      if (isReserva) {
        // RN-002: amortiza pelo term (1y = 8760 h, 3y = 26280 h)
        const horasTerm = /3\s*(year|ano)/i.test(term) ? 26280.0 : 8760.0;
        custo_hora_billing = totalBilling / horasTerm;
        custo_hora_usd     = totalUsd     / horasTerm;

      } else if (isHora) {
        // RN-001: UoM horária com fator (billing ÷ (qty × fator))
        //
        // PRIORIDADE 1: cost_in_billing_currency / (qty × fator)
        //   → já está na moeda correta (BRL ou USD conforme o contrato)
        //   → não depende de exchange_rate_pricing_to_billing (que pode ser NULL)
        //
        // PRIORIDADE 2: effective_price × exchange_rate / fator
        //   → usa apenas quando billing = 0 (recurso gratuito / crédito)
        //   → RISCO: se exchange_rate for NULL → COALESCE usa 1 → resultado em USD
        //     mesmo em contrato BRL → sub-avalia por ~5,7×
        //
        if (totalQty > 0 && totalBilling > 0) {
          custo_hora_billing = totalBilling / (totalQty * fatorUom);
          // cost_in_usd: nem sempre presente no export (pode ser NULL/0)
          custo_hora_usd = totalUsd > 0
            ? totalUsd / (totalQty * fatorUom)
            : custo_hora_billing; // proxy: billing como USD quando USD ausente
        } else if (totalQty > 0 && totalUpqBrl > 0) {
          // Fallback: effective_price × exchange_rate (cuidado com NULL exchange_rate)
          custo_hora_billing = totalUpqBrl / (totalQty * fatorUom);
          custo_hora_usd     = totalUpq    / (totalQty * fatorUom);
        } else {
          // Último recurso: divide pelo período real
          custo_hora_billing = totalBilling / horasReais;
          custo_hora_usd     = totalUsd     / horasReais;
        }

      } else if (isDia) {
        // RN-003: UoM diária → billing ÷ (qty × 24)
        custo_hora_billing = totalQty > 0
          ? totalBilling / (totalQty * 24.0)
          : totalBilling / horasReais;
        custo_hora_usd = totalQty > 0
          ? totalUsd / (totalQty * 24.0)
          : totalUsd / horasReais;

      } else {
        // RN-004: Storage, Bandwidth, Functions — custo médio do período
        custo_hora_billing = totalBilling / horasReais;
        custo_hora_usd     = totalUsd     / horasReais;
      }

      // RN-005 — Conversão para BRL
      // Hierarquia da taxa de câmbio:
      //  1) BRL billing  → custo_hora_billing já é BRL, sem conversão
      //  2) taxa_cambio do export (exchange_rate_pricing_to_billing > 1)
      //     → indica conversão real USD→BRL registrada pelo Azure
      //  3) taxa_brl do usuário (parâmetro do body) → fallback configurável
      const taxaCambioExport = parseFloat(dados.taxa_cambio || 0);
      const taxaEfetiva = moeda !== 'BRL' && taxaCambioExport > 1
        ? taxaCambioExport       // taxa real do Azure Export — mais precisa
        : parseFloat(taxa_brl);  // taxa configurada pelo usuário (fallback)
      const custo_hora_brl    = moeda === 'BRL'
        ? custo_hora_billing
        : custo_hora_billing * taxaEfetiva;
      const custo_mes_billing = totalBilling / diasAtivos * 30;
      const estimativa_billing = custo_hora_billing * horas;
      const estimativa_usd     = custo_hora_usd     * horas;
      const estimativa_brl     = custo_hora_brl     * horas;

      return {
        resource_id:        item.resource_id,
        horas_estimadas:    horas,
        dias_estimados:     parseFloat(dias_estimados.toFixed(2)),
        tipo_custo:         tipoCusto,
        isHora:             isHora || isDia,
        custo_hora_billing: parseFloat((custo_hora_billing || 0).toFixed(8)),
        custo_hora_usd:     parseFloat((custo_hora_usd     || 0).toFixed(8)),
        custo_hora_brl:     parseFloat((custo_hora_brl     || 0).toFixed(4)),
        custo_mes_billing:  parseFloat((custo_mes_billing  || 0).toFixed(4)),
        estimativa_billing: parseFloat((estimativa_billing || 0).toFixed(4)),
        estimativa_usd:     parseFloat((estimativa_usd     || 0).toFixed(4)),
        estimativa_brl:     parseFloat((estimativa_brl     || 0).toFixed(2)),
        moeda,
        taxa_brl_usada:     parseFloat(taxaEfetiva.toFixed(4)),
        taxa_origem:        moeda !== 'BRL' ? (taxaCambioExport > 1 ? 'export' : 'usuario') : 'n/a',
        dias_ativos:        diasAtivos,
        total_billing:      parseFloat(totalBilling.toFixed(4)),
      };
    });

    const totalBrl = resultados.reduce((s, r) => s + (r.estimativa_brl || 0), 0);
    res.json({ resultados, total_brl: parseFloat(totalBrl.toFixed(2)) });
  } catch (err) {
    console.error('Erro /api/calculadora/estimar:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/azure-costs/purge — Apaga todos os dados para re-importação limpa
app.delete('/api/azure-costs/purge', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { arquivo } = req.query;
    let result;
    if (arquivo) {
      // Apaga só registros de um arquivo específico
      result = await pool.query('DELETE FROM azure_costs WHERE arquivo_origem = $1', [arquivo]);
      console.log(`[Azure Purge] Removidos ${result.rowCount} registros do arquivo: ${arquivo}`);
      res.json({ message: `${result.rowCount} registros do arquivo "${arquivo}" removidos. Reimporte o arquivo.`, removidos: result.rowCount });
    } else {
      // Apaga tudo
      result = await pool.query('DELETE FROM azure_costs');
      console.log(`[Azure Purge] Removidos TODOS os registros: ${result.rowCount}`);
      res.json({ message: `Todos os ${result.rowCount} registros foram removidos. Reimporte os arquivos.`, removidos: result.rowCount });
    }
  } catch (err) {
    console.error('Erro no purge:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/azure-costs/imports ─────────────────────────────────────────────
app.get('/api/azure-costs/imports', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT arquivo_origem, COUNT(*) AS linhas,
             MIN(cost_date) AS periodo_inicio, MAX(cost_date) AS periodo_fim,
             SUM(cost_in_usd) AS total_usd, SUM(cost_in_billing_currency) AS total_billing,
             MIN(billing_currency) AS moeda, MAX(importado_em) AS importado_em
      FROM azure_costs GROUP BY arquivo_origem ORDER BY importado_em DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RESERVAS CLOUD ────────────────────────────────────────────────────────────
app.get('/api/reservas', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { cloud, status } = req.query;
    let q = `SELECT r.*, u.nome AS criado_por_nome FROM reservas_cloud r LEFT JOIN usuarios u ON r.criado_por = u.id WHERE 1=1`;
    const params = [];
    if (cloud)  { params.push(cloud);  q += ` AND r.cloud = $${params.length}`; }
    if (status) { params.push(status); q += ` AND r.status = $${params.length}`; }
    q += ` ORDER BY r.data_vencimento ASC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reservas', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { cloud, nome_reserva, tipo_escopo, subscription_id, resource_group_name,
            tipo_recurso, instancia, quantidade, prazo, opcao_pagamento,
            custo_total, custo_mensal, data_inicio, data_vencimento, status, observacoes } = req.body;
    if (!cloud || !nome_reserva || !tipo_recurso || !data_vencimento)
      return res.status(400).json({ error: 'cloud, nome_reserva, tipo_recurso e data_vencimento são obrigatórios' });
    const r = await pool.query(
      `INSERT INTO reservas_cloud
         (cloud, nome_reserva, tipo_escopo, subscription_id, resource_group_name, tipo_recurso,
          instancia, quantidade, prazo, opcao_pagamento, custo_total, custo_mensal,
          data_inicio, data_vencimento, status, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [cloud, nome_reserva, tipo_escopo||'Shared', subscription_id||null, resource_group_name||null,
       tipo_recurso, instancia||null, quantidade||1, prazo||null, opcao_pagamento||null,
       custo_total||null, custo_mensal||null, data_inicio||null, data_vencimento,
       status||'Ativa', observacoes||null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/reservas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { cloud, nome_reserva, tipo_escopo, subscription_id, resource_group_name,
            tipo_recurso, instancia, quantidade, prazo, opcao_pagamento,
            custo_total, custo_mensal, data_inicio, data_vencimento, status, observacoes } = req.body;
    const r = await pool.query(
      `UPDATE reservas_cloud SET
         cloud=$1, nome_reserva=$2, tipo_escopo=$3, subscription_id=$4, resource_group_name=$5,
         tipo_recurso=$6, instancia=$7, quantidade=$8, prazo=$9, opcao_pagamento=$10,
         custo_total=$11, custo_mensal=$12, data_inicio=$13, data_vencimento=$14,
         status=$15, observacoes=$16, atualizado_em=NOW()
       WHERE id=$17 RETURNING *`,
      [cloud, nome_reserva, tipo_escopo||'Shared', subscription_id||null, resource_group_name||null,
       tipo_recurso, instancia||null, quantidade||1, prazo||null, opcao_pagamento||null,
       custo_total||null, custo_mensal||null, data_inicio||null, data_vencimento,
       status||'Ativa', observacoes||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Reserva não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/reservas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM reservas_cloud WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLETA AUTOMÁTICA — Azure Cost Management API (MCA)
// ══════════════════════════════════════════════════════════════════════════════

let _coletaEmExecucao = false;
let _coletaCancelada  = false;
let _coletaProgresso  = { fase: '', sub_atual: '', sub_idx: 0, sub_total: 0, chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
let _coletaIniciadaEm = null;

// ── Circuit Breaker — Azure Cost Management API ────────────────────────────────
const _CB_STATES       = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });
const _CB_MAX_FAILURES = 3;
const _CB_OPEN_MS      = 5 * 60 * 1000; // 5 min
let _cbAPI = { state: _CB_STATES.CLOSED, failures: 0, openUntil: null, lastOpened: null };

function _cbCanAttempt() {
  if (_cbAPI.state === _CB_STATES.CLOSED)    return true;
  if (_cbAPI.state === _CB_STATES.HALF_OPEN) return true;
  // OPEN — verificar se janela expirou
  if (_cbAPI.openUntil && Date.now() >= _cbAPI.openUntil.getTime()) {
    _cbAPI.state = _CB_STATES.HALF_OPEN;
    _logColeta('[CB] Estado → HALF_OPEN (janela expirou, testando)');
    return true;
  }
  return false;
}

function _cbRecordSuccess() {
  if (_cbAPI.state === _CB_STATES.HALF_OPEN) {
    _cbAPI.state    = _CB_STATES.CLOSED;
    _cbAPI.failures = 0;
    _cbAPI.openUntil = null;
    _logColeta('[CB] Estado → CLOSED (HALF_OPEN bem-sucedido)');
  } else if (_cbAPI.state === _CB_STATES.CLOSED) {
    _cbAPI.failures = 0;
  }
}

function _cbRecordFailure() {
  if (_cbAPI.state === _CB_STATES.HALF_OPEN) {
    // Falhou na sondagem — reabrir imediatamente
    _cbAPI.state      = _CB_STATES.OPEN;
    _cbAPI.openUntil  = new Date(Date.now() + _CB_OPEN_MS);
    _cbAPI.lastOpened = new Date();
    _logColeta(`[CB] Estado → OPEN (HALF_OPEN falhou, bloqueando até ${_cbAPI.openUntil.toISOString()})`);
    return;
  }
  _cbAPI.failures++;
  if (_cbAPI.failures >= _CB_MAX_FAILURES) {
    _cbAPI.state      = _CB_STATES.OPEN;
    _cbAPI.openUntil  = new Date(Date.now() + _CB_OPEN_MS);
    _cbAPI.lastOpened = new Date();
    _logColeta(`[CB] Estado → OPEN (${_cbAPI.failures} falhas consecutivas, bloqueando até ${_cbAPI.openUntil.toISOString()})`);
  }
}

// _cbFetch — fetch com AbortController, retry 429 e integração ao Circuit Breaker
// SAS URLs (blobs) devem usar countCbFailure:false para não abrir CB por problemas de download
async function _cbFetch(url, options = {}, { timeoutMs = 30000, maxRetries = 3, countCbFailure = true } = {}) {
  if (!_cbCanAttempt()) {
    const until = _cbAPI.openUntil ? _cbAPI.openUntil.toISOString() : '?';
    throw new Error(`Circuit Breaker OPEN — Azure API bloqueada até ${until}`);
  }

  let attempt = 0;
  while (true) {
    const ctrl    = new AbortController();
    const timer   = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);

      if (resp.status === 429) {
        if (attempt >= maxRetries) {
          if (countCbFailure) _cbRecordFailure();
          throw new Error(`HTTP 429 esgotado após ${maxRetries} tentativas`);
        }
        const retryAfter = parseInt(resp.headers.get('Retry-After') || '60', 10);
        _logColeta(`[CB] HTTP 429 — aguardando ${retryAfter}s antes de retentar (tentativa ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        attempt++;
        continue;
      }

      if (resp.status >= 500 && countCbFailure) _cbRecordFailure();
      else if (resp.status < 400)               _cbRecordSuccess();
      return resp;

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (countCbFailure) _cbRecordFailure();
        throw new Error(`Timeout (${timeoutMs / 1000}s) na chamada Azure: ${url.split('?')[0]}`);
      }
      // Erro de rede
      if (countCbFailure) _cbRecordFailure();
      throw err;
    }
  }
}

async function ensureAzureColetaTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_coleta_config (
      id                  SERIAL PRIMARY KEY,
      tenant_id           VARCHAR(200),
      client_id           VARCHAR(200),
      client_secret       TEXT,
      ativo               BOOLEAN DEFAULT false,
      dia_execucao        INTEGER DEFAULT 5,
      granularidade_dias  INTEGER DEFAULT 7,
      criado_em           TIMESTAMP DEFAULT NOW(),
      atualizado_em       TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS granularidade_dias  INTEGER DEFAULT 7;
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS nome                VARCHAR(200) DEFAULT 'SP Principal';
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS expiracao_secret    DATE;
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_account     VARCHAR(200);
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_container   VARCHAR(200);
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_prefix      VARCHAR(500);
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS billing_account_id  TEXT;
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS billing_profile_id  TEXT;
    ALTER TABLE azure_coleta_config ALTER COLUMN billing_account_id TYPE TEXT;
    ALTER TABLE azure_coleta_config ALTER COLUMN billing_profile_id TYPE TEXT;
    CREATE TABLE IF NOT EXISTS azure_storage_config (
      id                SERIAL PRIMARY KEY,
      nome              VARCHAR(200) NOT NULL DEFAULT 'Storage 1',
      storage_account   VARCHAR(200) NOT NULL,
      storage_container VARCHAR(200) NOT NULL,
      storage_prefix    VARCHAR(500),
      ativo             BOOLEAN DEFAULT true,
      criado_em         TIMESTAMP DEFAULT NOW(),
      atualizado_em     TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS auto_coleta_horas INTEGER;
    ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS proxima_coleta    TIMESTAMP;
    ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS hora_execucao     INTEGER;
    ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS dias_semana       TEXT;
    ALTER TABLE azure_coleta_config  ADD COLUMN IF NOT EXISTS hora_execucao     INTEGER;
    ALTER TABLE azure_coleta_config  ADD COLUMN IF NOT EXISTS dias_semana       TEXT;
    ALTER TABLE azure_coleta_config  ADD COLUMN IF NOT EXISTS auto_coleta       BOOLEAN DEFAULT false;
    ALTER TABLE azure_coleta_config  ADD COLUMN IF NOT EXISTS proxima_coleta    TIMESTAMP;
    ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS sp_id             INTEGER REFERENCES azure_coleta_config(id) ON DELETE SET NULL;
    ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS tipo             VARCHAR(20);
    ALTER TABLE azure_coleta_config    ADD COLUMN IF NOT EXISTS is_padrao        BOOLEAN DEFAULT false;
    CREATE TABLE IF NOT EXISTS azure_coleta_historico (
      id                  BIGSERIAL PRIMARY KEY,
      iniciado_em         TIMESTAMP DEFAULT NOW(),
      concluido_em        TIMESTAMP,
      status              VARCHAR(20) DEFAULT 'executando',
      subs_total          INTEGER DEFAULT 0,
      subs_ok             INTEGER DEFAULT 0,
      subs_erro           INTEGER DEFAULT 0,
      linhas_inseridas    INTEGER DEFAULT 0,
      linhas_atualizadas  INTEGER DEFAULT 0,
      linhas_erro         INTEGER DEFAULT 0,
      mensagem            TEXT,
      detalhes            JSONB
    );
  `);
}

function _encryptSecret(plain) {
  const crypto = require('crypto');
  const mk  = (process.env.MASTER_KEY || 'finops-master-key-2024').padEnd(32, '0').slice(0, 32);
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', Buffer.from(mk), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}:${c.getAuthTag().toString('hex')}`;
}

function _decryptSecret(enc) {
  const crypto = require('crypto');
  const mk  = (process.env.MASTER_KEY || 'finops-master-key-2024').padEnd(32, '0').slice(0, 32);
  const [ivH, dataH, tagH] = enc.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(mk), Buffer.from(ivH, 'hex'));
  d.setAuthTag(Buffer.from(tagH, 'hex'));
  return d.update(Buffer.from(dataH, 'hex'), undefined, 'utf8') + d.final('utf8');
}

// Handles both encrypted (iv:data:tag) and legacy plain-text values
function _safeDecrypt(val) {
  if (!val) return val;
  if (!val.includes(':')) return val; // plain text (pre-encryption migration)
  try { return _decryptSecret(val); } catch (_) { return val; }
}

function _logColeta(msg) {
  _coletaProgresso.log.push({ ts: new Date().toISOString().slice(11, 19), msg });
  if (_coletaProgresso.log.length > 200) _coletaProgresso.log.shift();
  console.log('[Coleta] ' + msg);
}

// ── Agendador automático de coleta ────────────────────────────────────────────
let _agendadorTimer = null;

// Calcula o próximo timestamp de execução a partir de hora+dias da semana
function _computeProximaColeta(horaExecucao, diasSemanaStr) {
  if (horaExecucao == null || !diasSemanaStr) return null;
  const dias = diasSemanaStr.split(',').map(Number).filter(d => d >= 0 && d <= 6);
  if (!dias.length) return null;
  const now = new Date();
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(horaExecucao, 0, 0, 0);
    if (dias.includes(candidate.getDay()) && candidate > now) return candidate;
  }
  return null;
}

function _iniciarAgendador() {
  if (_agendadorTimer) return;
  // Verifica a cada 5 minutos se alguma coleta está agendada para o momento atual
  _agendadorTimer = setInterval(async () => {
    // Safety valve: resetar coleta travada há mais de 30 min
    if (_coletaEmExecucao && _coletaIniciadaEm) {
      const elapsedMs = Date.now() - _coletaIniciadaEm.getTime();
      if (elapsedMs > 30 * 60 * 1000) {
        console.warn('[Agendador] SAFETY VALVE: coleta travada >30min — resetando');
        _logColeta('[CB] Safety valve: coleta travada ' + Math.round(elapsedMs / 60000) + 'min — resetando flags');
        _coletaEmExecucao = false;
        _coletaIniciadaEm = null;
        _cbAPI.state      = _CB_STATES.CLOSED;
        _cbAPI.failures   = 0;
        _cbAPI.openUntil  = null;
      }
    }
    if (_coletaEmExecucao || !pool) return;
    try {
      // Storage: suporta agendamento por hora+dia ou por intervalo (legado)
      const rStg = await pool.query(`
        SELECT id, nome, hora_execucao, dias_semana, auto_coleta_horas
        FROM azure_storage_config
        WHERE ativo = true
          AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
          AND (
            (hora_execucao IS NOT NULL AND dias_semana IS NOT NULL)
            OR (auto_coleta_horas IS NOT NULL AND auto_coleta_horas > 0)
          )
        ORDER BY proxima_coleta ASC NULLS FIRST
        LIMIT 1
      `);
      if (rStg.rows.length) {
        const stg = rStg.rows[0];
        console.log(`[Agendador] Disparando coleta Storage #${stg.id} (${stg.nome})`);
        // Calcula próxima execução antes de disparar para evitar duplo disparo
        let proxima;
        if (stg.hora_execucao != null && stg.dias_semana) {
          proxima = _computeProximaColeta(stg.hora_execucao, stg.dias_semana);
        } else {
          proxima = new Date(Date.now() + stg.auto_coleta_horas * 3600 * 1000);
        }
        await pool.query(
          `UPDATE azure_storage_config SET proxima_coleta=$1 WHERE id=$2`,
          [proxima, stg.id]
        );
        _executarColetaStorage('auto', stg.id).catch(e =>
          console.error(`[Agendador] Erro coleta Storage #${stg.id}:`, e.message)
        );
        return; // só uma coleta por ciclo
      }

      // API: agendamento por hora+dia
      const rApi = await pool.query(`
        SELECT id, nome, billing_account_id, billing_profile_id, granularidade_dias, hora_execucao, dias_semana
        FROM azure_coleta_config
        WHERE ativo = true
          AND auto_coleta = true
          AND hora_execucao IS NOT NULL
          AND dias_semana IS NOT NULL
          AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
        ORDER BY proxima_coleta ASC NULLS FIRST
        LIMIT 1
      `);
      if (rApi.rows.length) {
        const sp = rApi.rows[0];
        if (!sp.billing_account_id || !sp.billing_profile_id) return;
        console.log(`[Agendador] Disparando coleta API SP #${sp.id} (${sp.nome})`);
        const proxima = _computeProximaColeta(sp.hora_execucao, sp.dias_semana);
        await pool.query(
          `UPDATE azure_coleta_config SET proxima_coleta=$1 WHERE id=$2`,
          [proxima, sp.id]
        );
        const granDias = sp.granularidade_dias || 7;
        const fim    = new Date(); fim.setDate(fim.getDate() - 1);
        const inicio = new Date(fim); inicio.setDate(inicio.getDate() - (granDias - 1));
        const fmt = d => d.toISOString().slice(0, 10);
        _executarColetaAPI(
          sp.id,
          _decryptSecret(sp.billing_account_id),
          _decryptSecret(sp.billing_profile_id),
          fmt(inicio), fmt(fim)
        ).catch(e => console.error(`[Agendador] Erro coleta API #${sp.id}:`, e.message));
      }
    } catch (e) {
      console.warn('[Agendador] Erro ao verificar schedule:', e.message);
    }
  }, 5 * 60 * 1000); // 5 min
}

// ── Endpoints coleta ──────────────────────────────────────────────────────────

app.post('/api/azure-coleta/cancelar', authMiddleware, (_req, res) => {
  if (!_coletaEmExecucao) return res.status(409).json({ error: 'Nenhuma coleta em execução' });
  _coletaCancelada = true;
  _logColeta('Cancelamento solicitado pelo usuário via API');
  res.json({ ok: true, message: 'Cancelamento solicitado' });
});

app.get('/api/azure-coleta/status', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id,iniciado_em,concluido_em,status,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem FROM azure_coleta_historico ORDER BY iniciado_em DESC LIMIT 1`);
    res.json({
      em_execucao:     _coletaEmExecucao,
      cancelando:      _coletaCancelada,
      progresso:       _coletaProgresso,
      ultimo:          r.rows[0] || null,
      circuit_breaker: {
        state:      _cbAPI.state,
        failures:   _cbAPI.failures,
        open_until: _cbAPI.openUntil ? _cbAPI.openUntil.toISOString() : null,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/azure-coleta/historico', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const tipo = req.query.tipo;
    const { rows } = tipo
      ? await pool.query(`SELECT id,tipo,iniciado_em,concluido_em,status,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem,detalhes FROM azure_coleta_historico WHERE tipo=$1 ORDER BY iniciado_em DESC LIMIT 50`, [tipo])
      : await pool.query(`SELECT id,tipo,iniciado_em,concluido_em,status,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem,detalhes FROM azure_coleta_historico ORDER BY iniciado_em DESC LIMIT 50`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/azure-coleta/historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await pool.query(`TRUNCATE TABLE azure_coleta_historico RESTART IDENTITY`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE PRINCIPALS — CRUD (credenciais de autenticação para Storage)
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/azure-coleta/sps', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT id,nome,tenant_id,client_id,ativo,is_padrao,expiracao_secret,billing_account_id,billing_profile_id,granularidade_dias,dia_execucao,hora_execucao,dias_semana,auto_coleta,proxima_coleta,atualizado_em FROM azure_coleta_config ORDER BY is_padrao DESC, id ASC`);
    res.json(r.rows.map(row => ({
      ...row,
      tenant_id:          _safeDecrypt(row.tenant_id),
      client_id:          _safeDecrypt(row.client_id),
      billing_account_id: row.billing_account_id ? _safeDecrypt(row.billing_account_id) : '',
      billing_profile_id: row.billing_profile_id ? _safeDecrypt(row.billing_profile_id) : '',
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/sps', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, tenant_id, client_id, client_secret, ativo, expiracao_secret, billing_account_id, billing_profile_id, dia_execucao, granularidade_dias } = req.body;
    await ensureAzureColetaTable();
    const tE   = tenant_id?.trim()         ? _encryptSecret(tenant_id.trim())         : '';
    const cE   = client_id?.trim()          ? _encryptSecret(client_id.trim())          : '';
    const sE   = client_secret?.trim()      ? _encryptSecret(client_secret.trim())      : '';
    const baE  = billing_account_id?.trim() ? _encryptSecret(billing_account_id.trim()) : null;
    const bpE  = billing_profile_id?.trim() ? _encryptSecret(billing_profile_id.trim()) : null;
    const diaE = dia_execucao       != null ? Math.max(1, Math.min(28, parseInt(dia_execucao) || 5))  : 5;
    const granE= granularidade_dias != null ? Math.max(1, parseInt(granularidade_dias) || 7)           : 7;
    await pool.query(
      `INSERT INTO azure_coleta_config(nome,tenant_id,client_id,client_secret,ativo,expiracao_secret,billing_account_id,billing_profile_id,dia_execucao,granularidade_dias) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [nome || 'Nova SP', tE, cE, sE, ativo ?? true, expiracao_secret || null, baE, bpE, diaE, granE]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/azure-coleta/sps/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, tenant_id, client_id, client_secret, ativo, expiracao_secret, billing_account_id, billing_profile_id, dia_execucao, granularidade_dias } = req.body;
    const ex = await pool.query(`SELECT client_secret FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    if (!ex.rows.length) return res.status(404).json({ error: 'SP não encontrada' });
    let sE = ex.rows[0].client_secret || '';
    if (client_secret?.trim()) sE = _encryptSecret(client_secret.trim());
    const tE  = tenant_id?.trim()         ? _encryptSecret(tenant_id.trim())         : '';
    const cE  = client_id?.trim()          ? _encryptSecret(client_id.trim())          : '';
    const baE = billing_account_id?.trim() ? _encryptSecret(billing_account_id.trim()) : null;
    const bpE = billing_profile_id?.trim() ? _encryptSecret(billing_profile_id.trim()) : null;
    const diaE  = dia_execucao        != null ? Math.max(1, Math.min(28, parseInt(dia_execucao) || 5))   : 5;
    const granE = granularidade_dias  != null ? Math.max(1, parseInt(granularidade_dias) || 7)            : 7;
    await pool.query(
      `UPDATE azure_coleta_config SET nome=$1,tenant_id=$2,client_id=$3,client_secret=$4,ativo=$5,expiracao_secret=$6,billing_account_id=$7,billing_profile_id=$8,dia_execucao=$9,granularidade_dias=$10,atualizado_em=NOW() WHERE id=$11`,
      [nome || 'SP', tE, cE, sE, ativo ?? true, expiracao_secret || null, baE, bpE, diaE, granE, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/sps/:id/coletar-api', authMiddleware, dbMiddleware, async (req, res) => {
  if (_coletaEmExecucao) return res.status(409).json({ error: 'Coleta já em execução' });
  const { billing_account_id, billing_profile_id, data_inicio, data_fim, modo, subscription_ids, resource_groups, metric } = req.body;
  if (!data_inicio || !data_fim) return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  const modoEfetivo   = modo || 'billing_profile';
  const metricEfetivo = ['ActualCost','AmortizedCost'].includes(metric) ? metric : 'ActualCost';
  if (modoEfetivo === 'billing_profile') {
    if (!billing_account_id || !billing_profile_id) return res.status(400).json({ error: 'billing_account_id e billing_profile_id são obrigatórios para o modo Billing Profile' });
  } else {
    if (!subscription_ids || !subscription_ids.length) return res.status(400).json({ error: 'subscription_ids é obrigatório para o modo Subscription Direta' });
  }
  res.json({ ok: true, message: `Coleta via API iniciada (${metricEfetivo})` });
  _executarColetaAPI(parseInt(req.params.id), billing_account_id || '', billing_profile_id || '', data_inicio, data_fim, modoEfetivo, subscription_ids || [], resource_groups || [], metricEfetivo)
    .catch(e => console.error('[ColetaAPI] Erro:', e.message));
});

// Ativa/desativa SP sem tocar nos outros campos
app.patch('/api/azure-coleta/sps/:id/ativo', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { ativo } = req.body;
    await pool.query(`UPDATE azure_coleta_config SET ativo=$1,atualizado_em=NOW() WHERE id=$2`, [!!ativo, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Define esta SP como padrão (única por vez) — limpa is_padrao das outras
app.patch('/api/azure-coleta/sps/:id/padrao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`UPDATE azure_coleta_config SET is_padrao=false`);
    await pool.query(`UPDATE azure_coleta_config SET is_padrao=true,atualizado_em=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/azure-coleta/sps/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/sps/:id/testar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'SP não encontrada' });
    const cfg      = r.rows[0];
    const tenantId = _safeDecrypt(cfg.tenant_id);
    const clientId = _safeDecrypt(cfg.client_id);
    const secret   = _safeDecrypt(cfg.client_secret);

    const results = {};

    // Testa escopo Management API (Cost Management / Billing)
    try {
      await _managementGetToken(tenantId, clientId, secret);
      results.management = { ok: true, msg: 'Azure Management API ✅' };
    } catch (e) {
      results.management = { ok: false, msg: `Azure Management API ❌ — ${e.message}` };
    }

    // Testa escopo Storage (opcional — só necessário para coleta via Blob Storage)
    try {
      await _storageGetToken(tenantId, clientId, secret);
      results.storage = { ok: true, msg: 'Azure Storage ✅' };
    } catch (e) {
      results.storage = { ok: false, msg: `Azure Storage ❌ — ${e.message}` };
    }

    const algumOk = results.management.ok || results.storage.ok;
    const msgs    = [results.management.msg, results.storage.msg].join('\n');
    if (algumOk) res.json({ ok: true, message: msgs, results });
    else         res.status(400).json({ error: msgs, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista subscriptions de uma SP (para wizard de coleta)
app.post('/api/azure-coleta/sps/:id/listar-subs', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'SP não encontrada' });
    const cfg = r.rows[0];
    const token = await _managementGetToken(
      _safeDecrypt(cfg.tenant_id), _safeDecrypt(cfg.client_id), _safeDecrypt(cfg.client_secret)
    );

    // 1ª tentativa: ARM /subscriptions — lista TODAS as subs do tenant acessíveis pela SP
    try {
      const resp = await _cbFetch(
        'https://management.azure.com/subscriptions?api-version=2022-12-01',
        { headers: { Authorization: `Bearer ${token}` } },
        { timeoutMs: 30_000 }
      );
      if (resp.ok) {
        const data = await _safeRespJson(resp);
        const subs = (data.value || [])
          .filter(s => s.state === 'Enabled')
          .map(s => ({ subscriptionId: s.subscriptionId, nome: s.displayName || s.subscriptionId }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        if (subs.length) return res.json({ subs, fonte: 'tenant' });
      }
    } catch (_) {}

    // 2ª tentativa: Billing Profile (se configurado)
    const baId = _safeDecrypt(cfg.billing_account_id || '');
    const bpId = _safeDecrypt(cfg.billing_profile_id || '');
    if (baId && bpId) {
      try {
        const subs = await _listarSubsBillingProfile(token, baId, bpId);
        if (subs.length) return res.json({ subs, fonte: 'billing_profile' });
      } catch (_) {}
    }

    // 3ª tentativa: cache local do banco
    const cached = await pool.query(
      `SELECT subscription_id, subscription_name FROM azure_subs_cache ORDER BY subscription_name`
    );
    const subs = cached.rows.map(row => ({
      subscriptionId: row.subscription_id,
      nome: row.subscription_name || row.subscription_id,
    }));
    res.json({ subs, fonte: 'cache' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista Resource Groups de subscriptions selecionadas (para wizard de coleta)
app.post('/api/azure-coleta/sps/:id/listar-rgs', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_ids } = req.body;
    if (!subscription_ids?.length) return res.status(400).json({ error: 'subscription_ids obrigatório' });

    // Tenta ARM API primeiro (lista completa e atualizada)
    try {
      const r = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'SP não encontrada' });
      const cfg = r.rows[0];
      const token = await _managementGetToken(
        _safeDecrypt(cfg.tenant_id), _safeDecrypt(cfg.client_id), _safeDecrypt(cfg.client_secret)
      );
      const rgs = [];
      for (const subId of subscription_ids) {
        try {
          let url = `https://management.azure.com/subscriptions/${subId}/resourcegroups?api-version=2021-04-01&$top=1000`;
          while (url) {
            const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
            if (!resp.ok) break;
            const data = await _safeRespJson(resp);
            for (const rg of (data.value || [])) rgs.push({ subscriptionId: subId, name: rg.name });
            url = data.nextLink || null;
          }
        } catch (_) {}
      }
      if (rgs.length > 0) return res.json({ rgs, fonte: 'arm' });
    } catch (_) {}

    // Fallback: cache local (normaliza para lowercase para evitar mismatch de case)
    const lowerIds = subscription_ids.map(id => (id || '').toLowerCase().trim());
    const ph = lowerIds.map((_, i) => `$${i + 1}`).join(',');
    const cached = await pool.query(
      `SELECT subscription_id, resource_group_name_upper AS name FROM azure_rg_cache WHERE LOWER(subscription_id) IN (${ph}) ORDER BY subscription_id, name`,
      lowerIds
    );
    res.json({ rgs: cached.rows.map(r => ({ subscriptionId: r.subscription_id, name: r.name })), fonte: cached.rowCount > 0 ? 'cache' : 'empty' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLETA VIA AZURE BLOB STORAGE
// ══════════════════════════════════════════════════════════════════════════════

async function _storageGetToken(tenantId, clientId, clientSecret) {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId,
      client_secret: clientSecret, scope: 'https://storage.azure.com/.default'
    }).toString()
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Storage falhou (${resp.status}): ${e}`); }
  const tkStg = await _safeRespJson(resp);
  if (!tkStg.access_token) throw new Error(`Token Storage: resposta sem access_token`);
  return tkStg.access_token;
}

async function _managementGetToken(tenantId, clientId, clientSecret) {
  const resp = await _cbFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, scope: 'https://management.azure.com/.default'
      }).toString(),
    },
    { timeoutMs: 30_000, countCbFailure: false } // 4xx de credencial não abre CB
  );
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Management falhou (${resp.status}): ${e}`); }
  const tkData = await _safeRespJson(resp);
  if (!tkData.access_token) throw new Error(`Token Management: resposta sem access_token`);
  return tkData.access_token;
}

// Lê JSON de uma Response sem quebrar em corpo vazio (Azure retorna 200/202 vazios)
async function _safeRespJson(resp) {
  const txt = await resp.text();
  if (!txt || !txt.trim()) return {};
  try { return JSON.parse(txt); } catch (_) { return {}; }
}

// ── Helpers de Coleta via API ─────────────────────────────────────────────────

async function _listarSubsBillingProfile(token, billingAccountId, billingProfileId) {
  const url  = `https://management.azure.com/providers/Microsoft.Billing/billingAccounts/${encodeURIComponent(billingAccountId)}/billingProfiles/${encodeURIComponent(billingProfileId)}/billingSubscriptions?api-version=2020-05-01`;
  const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Listar subscriptions (${resp.status}): ${e}`); }
  const data = await _safeRespJson(resp);
  return (data.value || []).map(s => ({
    subscriptionId: s.properties?.subscriptionId || s.subscriptionId || '',
    nome: s.properties?.displayName || s.displayName || s.properties?.subscriptionId || '?',
  })).filter(s => s.subscriptionId);
}

// Gera relatório, faz polling com limite de 60 tentativas (~6 min), baixa blobs e retorna caminhos locais
// metric: 'ActualCost' (padrão) ou 'AmortizedCost' (reservas distribuídas mensalmente como no portal)
async function _gerarRelatorioAPI(token, scopeUrl, startDate, endDate, label, metric = 'ActualCost') {
  const fs     = require('fs');
  const os     = require('os');
  const path   = require('path');
  const crypto = require('crypto');

  const MAX_POLL_ATTEMPTS = 60; // 60 × 6s = 360s máximo por subscription

  const genUrl  = `https://management.azure.com${scopeUrl}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2023-08-01`;
  _logColeta(`→ Solicitando relatório: ${label}`);

  const genResp = await _cbFetch(
    genUrl,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, timePeriod: { start: startDate, end: endDate } }),
    },
    { timeoutMs: 60_000 }
  );

  if (genResp.status === 404) { _logColeta(`  Sem dados: ${label}`); return []; }
  if (genResp.status >= 500) {
    _cbRecordFailure();
    const e = await genResp.text();
    throw new Error(`generateCostDetailsReport (${genResp.status}): ${e}`);
  }
  if (!genResp.ok) { const e = await genResp.text(); throw new Error(`generateCostDetailsReport (${genResp.status}): ${e}`); }

  let manifest;
  let pollUrl = genResp.headers.get('Location') || genResp.headers.get('location');

  if (!pollUrl && genResp.status === 200) {
    const d = await _safeRespJson(genResp);
    if (d.status === 'Completed' || d.manifest) manifest = d.manifest || d;
    else if (d.status === 'NoDataFound') { _logColeta(`  Sem dados: ${label}`); return []; }
  }
  if (genResp.status === 204) { _logColeta(`  Sem dados (204): ${label}`); return []; }

  // Polling com limite máximo de tentativas
  let tentativas = 0;
  while (pollUrl && !manifest) {
    if (_coletaCancelada) throw new Error('Cancelado pelo usuário');
    if (tentativas >= MAX_POLL_ATTEMPTS) {
      throw new Error(`Timeout de polling: Azure não entregou o relatório de '${label}' em ${MAX_POLL_ATTEMPTS * 6}s`);
    }
    await new Promise(r => setTimeout(r, 6000));
    tentativas++;

    const pr = await _cbFetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
    if (pr.status >= 500) {
      _cbRecordFailure();
      const e = await pr.text();
      throw new Error(`Poll (${pr.status}): ${e}`);
    }
    if (!pr.ok) { const e = await pr.text(); throw new Error(`Poll (${pr.status}): ${e}`); }
    if (pr.status === 204) { _logColeta(`  Sem dados (204): ${label}`); return []; }
    const pd = await _safeRespJson(pr);

    if (tentativas % 5 === 0) _logColeta(`  ${label}: aguardando Azure... ${tentativas * 6}s`);
    _coletaProgresso.fase = `${label} — gerando relatório (${tentativas * 6}s)`;

    if (pd.status === 'Completed')   { manifest = pd.manifest || pd; break; }
    if (pd.status === 'Failed')      {
      _cbRecordFailure();
      throw new Error(`Relatório falhou no Azure: ${JSON.stringify(pd.error || {})}`);
    }
    if (pd.status === 'NoDataFound') { _logColeta(`  Sem dados: ${label}`); return []; }
  }
  if (!manifest) throw new Error(`Sem manifest após polling: ${label}`);

  // Download de blobs via SAS URL — sem CB (são URLs pré-assinadas, não passam pela API)
  const tmpFiles = [];
  for (const blob of (manifest.blobs || [])) {
    const blobUrl = blob.blobLink || blob.blobSasUri || blob.downloadUrl || blob;
    const dest    = path.join(os.tmpdir(), `az_api_${crypto.randomBytes(6).toString('hex')}.csv`);

    const blobCtrl  = new AbortController();
    const blobTimer = setTimeout(() => blobCtrl.abort(), 120_000);
    try {
      const dlResp = await fetch(typeof blobUrl === 'string' ? blobUrl : String(blobUrl), { signal: blobCtrl.signal });
      clearTimeout(blobTimer);
      if (!dlResp.ok) throw new Error(`Download blob (${dlResp.status})`);
      fs.writeFileSync(dest, Buffer.from(await dlResp.arrayBuffer()));
    } catch (err) {
      clearTimeout(blobTimer);
      if (err.name === 'AbortError') throw new Error(`Timeout (120s) ao baixar blob de '${label}'`);
      throw err;
    }
    tmpFiles.push(dest);
  }
  _logColeta(`  ${label}: ${tmpFiles.length} blob(s) baixado(s)`);
  return tmpFiles;
}

async function _importarArquivosAPI(tmpFiles, label, sql, COLS, rgFilter = null) {
  const fs = require('fs');
  let ins = 0, upd = 0, err = 0, linhas = 0;
  for (const dest of tmpFiles) {
    try {
      const rows = await _lerCSV(dest);
      linhas += rows.length;
      _logColeta(`  ${label}: importando ${rows.length} linhas${rgFilter ? ` (filtro: ${rgFilter.size} RGs)` : ''}`);
      const client = await pool.connect();
      let spCount = 0;
      try {
        await client.query('BEGIN');
        for (let i = 0; i < rows.length; i += 200) {
          for (const raw of rows.slice(i, i + 200)) {
            const m = _mapRowCSV(raw, `api-${label}`);
            if (rgFilter && !rgFilter.has((m.resource_group_name || '').toUpperCase())) continue;
            const sp = `sp_${spCount++}`;
            try {
              await client.query(`SAVEPOINT ${sp}`);
              const r = await client.query(sql, COLS.map(c => m[c] ?? null));
              await client.query(`RELEASE SAVEPOINT ${sp}`);
              if (r.rowCount > 0) ins++; else upd++;
            } catch (e) {
              await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
              await client.query(`RELEASE SAVEPOINT ${sp}`);
              err++;
            }
          }
          _coletaProgresso.ins += ins; _coletaProgresso.upd += upd; _coletaProgresso.err += err;
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    } finally {
      try { fs.unlinkSync(dest); } catch (_) {}
    }
  }
  return { ins, upd, err, linhas };
}

// ── Coleta via Azure Cost Management API ─────────────────────────────────────
// modo: 'billing_profile' (padrão) ou 'subscription' (direto por subscription IDs)
async function _executarColetaAPI(spId, billingAccountId, billingProfileId, startDate, endDate, modo = 'billing_profile', subscriptionIds = [], resourceGroups = [], metric = 'ActualCost') {
  if (_coletaEmExecucao) throw new Error('Coleta já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _coletaEmExecucao = true;
  _coletaIniciadaEm = new Date();
  _coletaCancelada  = false;
  _coletaProgresso  = { tipo: 'api', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0,
                        chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
  const rgFilter = resourceGroups.length ? new Set(resourceGroups.map(r => r.toUpperCase())) : null;
  _logColeta(`Coleta API [${modo}] — ${startDate} → ${endDate}${rgFilter ? ` | ${rgFilter.size} RG(s) filtrado(s)` : ''}`);
  let histId, totalIns = 0, totalUpd = 0, totalErr = 0, totalLinhas = 0;
  let subCount = 0;

  try {
    const r = await pool.query(`INSERT INTO azure_coleta_historico (status,tipo) VALUES ('executando','api') RETURNING id`);
    histId = r.rows[0].id;

    // 1) Credenciais e token
    const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [spId]);
    if (!spRow.rows.length) throw new Error('SP não encontrada');
    const spCfg   = spRow.rows[0];
    const token   = await _managementGetToken(
      _safeDecrypt(spCfg.tenant_id), _safeDecrypt(spCfg.client_id), _safeDecrypt(spCfg.client_secret)
    );

    // 2) SQL de upsert
    await ensureAzureCostsTable();
    const COLS    = Object.keys(_mapRowCSV({}, ''));
    const ph      = COLS.map((_, i) => `$${i + 1}`).join(', ');
    const updCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
    let temIdx = false;
    try {
      const ck = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup' LIMIT 1`);
      temIdx = ck.rowCount > 0;
    } catch (_) {}
    const sql = temIdx
      ? `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT (COALESCE(subscription_id,''),COALESCE(resource_id,''),cost_date,COALESCE(meter_id,''),COALESCE(charge_type,''),COALESCE(quantity,0)) DO UPDATE SET ${updCols.map(c => `${c}=EXCLUDED.${c}`).join(',')}`
      : `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;

    if (modo === 'subscription') {
      // ── Modo: Subscription Direta ──────────────────────────────────────────
      _coletaProgresso.fase      = 'Preparando coleta por subscriptions...';
      _coletaProgresso.sub_total = subscriptionIds.length;
      subCount = subscriptionIds.length;
      for (let i = 0; i < subscriptionIds.length; i++) {
        if (_coletaCancelada) { _logColeta('Cancelado'); break; }
        const subId = subscriptionIds[i].trim();
        if (!subId) continue;
        _coletaProgresso.sub_idx   = i + 1;
        _coletaProgresso.sub_atual = subId;
        _coletaProgresso.fase      = `[${i + 1}/${subscriptionIds.length}] ${subId}`;
        try {
          const subScope = `/subscriptions/${subId}`;
          const arquivos = await _gerarRelatorioAPI(token, subScope, startDate, endDate, subId, metric);
          const res      = await _importarArquivosAPI(arquivos, subId, sql, COLS, rgFilter);
          totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
        } catch (e) {
          _logColeta(`Erro subscription ${subId}: ${e.message}`);
          totalErr++;
        }
      }

    } else {
      // ── Modo: Billing Profile (MCA) ────────────────────────────────────────
      _coletaProgresso.fase = 'Listando subscriptions do Billing Profile...';
      let subs = [];
      try {
        subs = await _listarSubsBillingProfile(token, billingAccountId, billingProfileId);
        _logColeta(`${subs.length} subscription(s) encontrada(s)`);
      } catch (e) {
        _logColeta(`Aviso: não foi possível listar subscriptions (${e.message})`);
      }

      // Filtrar subs selecionadas pelo wizard (se lista não vazia)
      if (subscriptionIds.length > 0) {
        const subFilterSet = new Set(subscriptionIds.map(s => s.toLowerCase()));
        subs = subs.filter(s => subFilterSet.has(s.subscriptionId.toLowerCase()));
        _logColeta(`Filtro wizard: ${subs.length} subscription(s) selecionada(s)`);
      }

      const bpScope = `/providers/Microsoft.Billing/billingAccounts/${encodeURIComponent(billingAccountId)}/billingProfiles/${encodeURIComponent(billingProfileId)}`;
      subCount = subs.length;

      if (subs.length > 0) {
        _coletaProgresso.sub_total = subs.length + 1; // +1 para passagem de Tax
        for (let i = 0; i < subs.length; i++) {
          if (_coletaCancelada) { _logColeta('Cancelado'); break; }
          const sub = subs[i];
          _coletaProgresso.sub_idx   = i + 1;
          _coletaProgresso.sub_atual = sub.nome;
          _coletaProgresso.fase      = `[${i + 1}/${subs.length}] ${sub.nome}`;
          try {
            const subScope = `/subscriptions/${sub.subscriptionId}`;
            const arquivos = await _gerarRelatorioAPI(token, subScope, startDate, endDate, sub.nome, metric);
            const res      = await _importarArquivosAPI(arquivos, sub.nome, sql, COLS, rgFilter);
            totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
          } catch (e) {
            _logColeta(`Erro subscription ${sub.nome}: ${e.message}`);
            totalErr++;
          }
        }

        // Passagem no Billing Profile para capturar Tax/Purchase/Refund
        if (!_coletaCancelada) {
          _coletaProgresso.sub_idx   = subs.length + 1;
          _coletaProgresso.sub_atual = 'Billing Profile (Tax/Fiscal)';
          _coletaProgresso.fase      = 'Coletando impostos fiscais (Tax) do Billing Profile...';
          _logColeta('Passagem Billing Profile — Tax/Purchase/Refund...');
          try {
            const arquivos = await _gerarRelatorioAPI(token, bpScope, startDate, endDate, 'Billing Profile', metric);
            const res      = await _importarArquivosAPI(arquivos, 'Billing Profile', sql, COLS, rgFilter);
            totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
          } catch (e) {
            _logColeta(`Aviso: passagem Billing Profile falhou — ${e.message}`);
          }
        }
      } else {
        // Fallback: coleta direto no Billing Profile scope
        _coletaProgresso.sub_total = 1;
        _coletaProgresso.sub_idx   = 1;
        _coletaProgresso.sub_atual = 'Billing Profile';
        const arquivos = await _gerarRelatorioAPI(token, bpScope, startDate, endDate, 'Billing Profile', metric);
        const res      = await _importarArquivosAPI(arquivos, 'Billing Profile', sql, COLS, rgFilter);
        totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
      }
    }

    // Resumo final
    try {
      const rCT = await pool.query(`SELECT COALESCE(charge_type,'(sem tipo)') AS ct, COUNT(*) AS n FROM azure_costs GROUP BY charge_type ORDER BY n DESC LIMIT 20`);
      _logColeta('Charge types: ' + rCT.rows.map(r => `${r.ct}:${r.n}`).join(', '));
    } catch (_) {}

    _logColeta(`Concluído: ${totalIns} ins, ${totalUpd} upd, ${totalErr} err / ${totalLinhas} linhas`);
    _refreshAzureCache().catch(() => {});
    const msgFinal = modo === 'subscription'
      ? `API Subscription — ${subCount} sub(s) | ${startDate}→${endDate}`
      : `API Billing Profile — ${subCount} sub(s) + Tax | ${startDate}→${endDate}`;
    const detFinal = JSON.stringify({ tipo: 'api', modo, log: [..._coletaProgresso.log] });
    await pool.query(
      `UPDATE azure_coleta_historico SET status='concluido',concluido_em=NOW(),linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, msgFinal, detFinal, histId]
    );
    _coletaProgresso.fase = 'Concluído';

  } catch (err) {
    _logColeta(`ERRO: ${err.message}`);
    const detErr = JSON.stringify({ tipo: 'api', modo, log: [..._coletaProgresso.log] });
    if (histId) await pool.query(
      `UPDATE azure_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1,detalhes=$2 WHERE id=$3`,
      [err.message, detErr, histId]
    ).catch(() => {});
  } finally {
    _coletaEmExecucao = false;
    _coletaIniciadaEm = null;
  }
}

async function _storageListBlobs(token, storageAccount, container, prefix = '') {
  const blobs = [];
  let marker = '';
  do {
    const qs = new URLSearchParams({ restype: 'container', comp: 'list' });
    if (prefix)  qs.set('prefix', prefix);
    if (marker)  qs.set('marker', marker);
    const url  = `https://${storageAccount}.blob.core.windows.net/${container}?${qs}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-ms-version': '2020-04-08' } });
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Erro ao listar blobs (${resp.status}): ${e}`); }
    const xml  = await resp.text();
    const bRe  = /<Blob>([\s\S]*?)<\/Blob>/g;
    let m;
    while ((m = bRe.exec(xml)) !== null) {
      const c    = m[1];
      const name = c.match(/<Name>([\s\S]*?)<\/Name>/)?.[1]?.trim() || '';
      const lm   = c.match(/<Last-Modified>([\s\S]*?)<\/Last-Modified>/)?.[1] || '';
      const sz   = parseInt(c.match(/<Content-Length>(\d+)<\/Content-Length>/)?.[1] || '0');
      if (name) blobs.push({ name, lastModified: new Date(lm), size: sz });
    }
    marker = xml.match(/<NextMarker>([\s\S]*?)<\/NextMarker>/)?.[1]?.trim() || '';
  } while (marker);
  return blobs;
}

async function _storageDownloadBlob(token, storageAccount, container, blobName) {
  const path   = require('path');
  const fs     = require('fs');
  const crypto = require('crypto');
  const os     = require('os');
  const ext    = blobName.toLowerCase().endsWith('.parquet') ? '.parquet' : '.csv';
  const dest   = path.join(os.tmpdir(), `az_stg_${crypto.randomBytes(6).toString('hex')}${ext}`);
  const url    = `https://${storageAccount}.blob.core.windows.net/${container}/${blobName}`;
  const resp   = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-ms-version': '2020-04-08' } });
  if (!resp.ok) throw new Error(`Erro ao baixar blob ${blobName} (${resp.status})`);
  fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
  return dest;
}

async function _executarColetaStorage(modo = 'manual', storageId = null) {
  if (_coletaEmExecucao) throw new Error('Coleta já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _coletaEmExecucao = true;
  _coletaCancelada  = false;
  _coletaProgresso  = { tipo: 'storage', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0, chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
  _logColeta(`Coleta Storage iniciada (${modo}${storageId ? ' STG#'+storageId : ''})`);

  let histId, totalIns = 0, totalUpd = 0, totalErr = 0;

  try {
    const r = await pool.query(`INSERT INTO azure_coleta_historico (status,tipo) VALUES ('executando','storage') RETURNING id`);
    histId = r.rows[0].id;

    // Storage config
    const stgRow = storageId
      ? await pool.query(`SELECT * FROM azure_storage_config WHERE id=$1`, [storageId])
      : await pool.query(`SELECT * FROM azure_storage_config WHERE ativo=true ORDER BY id LIMIT 1`);
    if (!stgRow.rows.length) throw new Error(storageId ? `Storage #${storageId} não encontrado` : 'Nenhum Storage ativo configurado');
    const stg = stgRow.rows[0];
    const storageAccount = stg.storage_account?.trim();
    const container      = stg.storage_container?.trim();
    const prefix         = stg.storage_prefix?.trim() || '';
    if (!storageAccount || !container) throw new Error('Storage Account e Container não configurados');

    // SP para autenticar — usa sp_id vinculado ao storage, ou cai para a primeira SP ativa
    const spQuery = stg.sp_id
      ? await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [stg.sp_id])
      : await pool.query(`SELECT * FROM azure_coleta_config WHERE ativo=true ORDER BY is_padrao DESC, id ASC LIMIT 1`);
    if (!spQuery.rows.length) throw new Error(stg.sp_id ? `SP #${stg.sp_id} não encontrada` : 'Nenhuma SP ativa configurada');
    const sp = spQuery.rows[0];
    const tenantId = _safeDecrypt(sp.tenant_id);
    const clientId = _safeDecrypt(sp.client_id);
    const secret   = _safeDecrypt(sp.client_secret);

    _coletaProgresso.fase = 'Autenticando no Azure Storage...';
    _logColeta('Obtendo token de Storage...');
    const token = await _storageGetToken(tenantId, clientId, secret);

    _coletaProgresso.fase = 'Listando arquivos no container...';
    _logColeta(`Listando em ${storageAccount}/${container}/${prefix || '*'}`);
    let blobs = await _storageListBlobs(token, storageAccount, container, prefix);
    blobs = blobs.filter(b => /\.(csv|parquet)$/i.test(b.name));
    _logColeta(`${blobs.length} arquivo(s) CSV/Parquet encontrado(s)`);
    if (!blobs.length) throw new Error('Nenhum arquivo CSV/Parquet encontrado no caminho configurado');
    _coletaProgresso.sub_total = blobs.length;

    await ensureAzureCostsTable();
    const COLS    = Object.keys(_mapRowCSV({}, ''));
    const ph      = COLS.map((_, i) => `$${i + 1}`).join(', ');
    const updCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
    let temIdx = false;
    try {
      const ck = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup' LIMIT 1`);
      temIdx = ck.rowCount > 0;
    } catch (_) {}
    const sqlU = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
      ON CONFLICT (COALESCE(subscription_id,''),COALESCE(resource_id,''),cost_date,COALESCE(meter_id,''),COALESCE(charge_type,''),COALESCE(quantity,0))
      DO UPDATE SET ${updCols.map(c => `${c}=EXCLUDED.${c}`).join(',')}`;
    const sqlI = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
    const sql  = temIdx ? sqlU : sqlI;

    for (let bi = 0; bi < blobs.length; bi++) {
      if (_coletaCancelada) { _logColeta('Cancelado'); break; }
      const blob = blobs[bi];
      _coletaProgresso.sub_idx   = bi + 1;
      _coletaProgresso.sub_atual = blob.name.split('/').pop();
      _coletaProgresso.fase      = `Importando: ${blob.name.split('/').pop()}`;
      _logColeta(`→ ${blob.name} (${(blob.size / 1048576).toFixed(1)} MB)`);

      let tmpFile;
      try {
        tmpFile = await _storageDownloadBlob(token, storageAccount, container, blob.name);
        const rows = await _lerCSV(tmpFile);
        _logColeta(`  ${rows.length} linhas`);

        const client = await pool.connect();
        let ins = 0, upd = 0, err = 0;
        try {
          await client.query('BEGIN');
          let sp = 0;
          for (let i = 0; i < rows.length; i += 200) {
            for (const raw of rows.slice(i, i + 200)) {
              const spn = `sp_${sp++}`;
              try {
                await client.query(`SAVEPOINT ${spn}`);
                const m = _mapRowCSV(raw, blob.name);
                const r2 = await client.query(sql, COLS.map(col => m[col] ?? null));
                await client.query(`RELEASE SAVEPOINT ${spn}`);
                if (r2.rowCount > 0) ins++; else upd++;
              } catch (e) {
                await client.query(`ROLLBACK TO SAVEPOINT ${spn}`);
                await client.query(`RELEASE SAVEPOINT ${spn}`);
                err++;
              }
            }
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        totalIns += ins; totalUpd += upd; totalErr += err;
        _logColeta(`  ins:${ins} upd:${upd} err:${err}`);
        _coletaProgresso.ins = totalIns;
        _coletaProgresso.upd = totalUpd;
        _coletaProgresso.err = totalErr;
      } catch (blobErr) {
        _logColeta(`ERRO ${blob.name.split('/').pop()}: ${blobErr.message.slice(0, 60)}`);
        totalErr++;
        _coletaProgresso.err = totalErr;
      } finally {
        const fs = require('fs');
        if (tmpFile) try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    }

    _refreshAzureCache().catch(() => {});
    const msg = `Storage · ${blobs.length} arquivo(s) · ${totalIns} inseridos · ${totalUpd} atualizados · ${totalErr} erros`;
    _coletaProgresso.fase = 'Concluída';
    _logColeta('Concluída: ' + msg);
    await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='concluido',linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, msg, JSON.stringify({ tipo: 'storage', modo, log: [..._coletaProgresso.log] }), histId]);
    return { ok: true, msg };
  } catch (err) {
    _coletaProgresso.fase = 'Erro: ' + err.message.slice(0, 80);
    _logColeta('Erro: ' + err.message.slice(0, 80));
    const detStgErr = JSON.stringify({ tipo: 'storage', modo, log: [..._coletaProgresso.log] });
    if (histId) await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='erro',linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, err.message, detStgErr, histId]).catch(() => {});
    throw err;
  } finally {
    _coletaEmExecucao = false;
    _coletaCancelada  = false;
  }
}

// ── Storage CRUD ──────────────────────────────────────────────────────────────

app.get('/api/azure-coleta/storages', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT * FROM azure_storage_config ORDER BY id`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/storages', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, storage_account, storage_container, storage_prefix, ativo, sp_id } = req.body;
    await ensureAzureColetaTable();
    if (!storage_account?.trim() || !storage_container?.trim()) return res.status(400).json({ error: 'Storage Account e Container são obrigatórios' });
    const r = await pool.query(
      `INSERT INTO azure_storage_config(nome,storage_account,storage_container,storage_prefix,ativo,sp_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nome || 'Storage 1', storage_account.trim(), storage_container.trim(), storage_prefix?.trim() || null, ativo ?? true, sp_id || null]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/azure-coleta/storages/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, storage_account, storage_container, storage_prefix, ativo, sp_id } = req.body;
    await pool.query(
      `UPDATE azure_storage_config SET nome=$1,storage_account=$2,storage_container=$3,storage_prefix=$4,ativo=$5,sp_id=$6,atualizado_em=NOW() WHERE id=$7`,
      [nome, storage_account?.trim(), storage_container?.trim(), storage_prefix?.trim() || null, ativo ?? true, sp_id || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/azure-coleta/storages/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM azure_storage_config WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/storages/:id/testar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const stgRow = await pool.query(`SELECT * FROM azure_storage_config WHERE id=$1`, [req.params.id]);
    if (!stgRow.rows.length) return res.status(404).json({ error: 'Storage não encontrado' });
    const stg = stgRow.rows[0];
    const spQuery = stg.sp_id
      ? await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [stg.sp_id])
      : await pool.query(`SELECT * FROM azure_coleta_config WHERE ativo=true ORDER BY is_padrao DESC, id ASC LIMIT 1`);
    if (!spQuery.rows.length) return res.status(400).json({ error: 'Nenhuma SP configurada para autenticar' });
    const sp  = spQuery.rows[0];
    const tok = await _storageGetToken(_safeDecrypt(sp.tenant_id), _safeDecrypt(sp.client_id), _safeDecrypt(sp.client_secret));
    let blobs = await _storageListBlobs(tok, stg.storage_account, stg.storage_container, stg.storage_prefix || '');
    blobs = blobs.filter(b => /\.(csv|parquet)$/i.test(b.name));
    const totalSize = blobs.reduce((s, b) => s + b.size, 0);
    res.json({ ok: true, total: blobs.length, totalSizeMB: (totalSize/1048576).toFixed(1),
      preview: blobs.slice(0,10).map(b => ({ name: b.name, sizeMB: (b.size/1048576).toFixed(2), lastModified: b.lastModified })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/storages/:id/executar', authMiddleware, dbMiddleware, (req, res) => {
  if (_coletaEmExecucao) return res.status(409).json({ error: 'Coleta já em execução' });
  res.json({ ok: true, message: 'Coleta Storage iniciada' });
  _executarColetaStorage('manual', parseInt(req.params.id)).catch(e => console.error('[ColetaStorage] Erro:', e.message));
});

app.put('/api/azure-coleta/storages/:id/agendamento', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { hora_execucao, dias_semana } = req.body;
    const hora   = hora_execucao != null ? Math.max(0, Math.min(23, parseInt(hora_execucao))) : null;
    const dias   = dias_semana || null;
    const proxima = _computeProximaColeta(hora, dias);
    await pool.query(
      `UPDATE azure_storage_config
       SET hora_execucao=$1, dias_semana=$2, auto_coleta_horas=NULL,
           proxima_coleta=$3, atualizado_em=NOW()
       WHERE id=$4`,
      [hora, dias, proxima, req.params.id]
    );
    const r = await pool.query(
      `SELECT id, nome, hora_execucao, dias_semana, proxima_coleta FROM azure_storage_config WHERE id=$1`,
      [req.params.id]
    );
    res.json({ ok: true, storage: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/azure-coleta/sps/:id/agendamento', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { hora_execucao, dias_semana, auto_coleta } = req.body;
    const hora    = hora_execucao != null ? Math.max(0, Math.min(23, parseInt(hora_execucao))) : null;
    const dias    = dias_semana || null;
    const ativo   = auto_coleta ? true : false;
    const proxima = ativo ? _computeProximaColeta(hora, dias) : null;
    await pool.query(
      `UPDATE azure_coleta_config
       SET hora_execucao=$1, dias_semana=$2, auto_coleta=$3, proxima_coleta=$4, atualizado_em=NOW()
       WHERE id=$5`,
      [hora, dias, ativo, proxima, req.params.id]
    );
    const r = await pool.query(
      `SELECT id, nome, hora_execucao, dias_semana, auto_coleta, proxima_coleta FROM azure_coleta_config WHERE id=$1`,
      [req.params.id]
    );
    res.json({ ok: true, sp: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/azure-coleta/agendamentos', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const [rStg, rApi] = await Promise.all([
      pool.query(`
        SELECT id, nome, hora_execucao, dias_semana, proxima_coleta, 'storage' AS tipo
        FROM azure_storage_config
        WHERE ativo = true AND hora_execucao IS NOT NULL AND dias_semana IS NOT NULL
        ORDER BY proxima_coleta ASC NULLS LAST
      `),
      pool.query(`
        SELECT id, nome, hora_execucao, dias_semana, proxima_coleta, granularidade_dias, 'api' AS tipo
        FROM azure_coleta_config
        WHERE ativo = true AND auto_coleta = true AND hora_execucao IS NOT NULL
        ORDER BY proxima_coleta ASC NULLS LAST
      `)
    ]);
    res.json([...rStg.rows, ...rApi.rows]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── HEALTH CHECK (sem autenticação — para load balancers, PM2, Railway, etc.) ─
app.get('/health', (_req, res) => {
  const dbOk = !!pool;
  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? 'ok' : 'degraded',
    db:        dbOk ? 'connected' : 'unavailable',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
(async () => {
  // Start HTTP server first — wizard needs it
  app.listen(PORT, () => {
    console.log('');
    console.log('  FinOps Manager rodando em http://localhost:' + PORT);
    console.log('');
  });

  // Try to connect with existing config
  const cfg = getDbConfig();
  if (cfg) {
    try {
      createPool(cfg);
      await initDB();
      // Inicializar tabela Azure na startup — uma vez só, não em cada request
      try { await ensureAzureCostsTable(); } catch (e) { console.warn('[Azure] Tabela será criada na primeira importação:', e.message); }
      try { await ensureAzureColetaTable(); } catch (e) { console.warn('[Coleta] Tabela de histórico não iniciada:', e.message); }
      try { await ensurePriceListTable(); } catch (e) { console.warn('[PriceList] Tabela será criada no primeiro sync:', e.message); }
      _iniciarAgendador();
      _refreshAzureCache().catch(e => console.warn('[Azure] Cache de dropdowns não pôde ser construído:', e.message));
      console.log('  Banco conectado e inicializado.');
    } catch (err) {
      console.warn('  Aviso: falha ao conectar ao banco configurado:', err.message);
      console.warn('  Verifique as credenciais em Configuracoes > Banco de Dados.');
      pool = null;
    }
  } else {
    console.log('  Primeira execucao detectada.');
    console.log('  Acesse http://localhost:' + PORT + ' para configurar o sistema.');
  }

  // Keep-alive: ping DB every 4 minutes to prevent idle disconnection
  const _keepAliveTimer = setInterval(async () => {
    if (!pool) return;
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.warn('  Keep-alive falhou, reconectando...', err.message);
      try {
        const cfg = getDbConfig();
        if (cfg) {
          createPool(cfg);
          await pool.query('SELECT 1');
          console.log('  Banco reconectado com sucesso.');
        }
      } catch (e2) {
        console.error('  Falha ao reconectar:', e2.message);
        pool = null;
      }
    }
  }, 4 * 60 * 1000);

  // Graceful shutdown
  async function gracefulShutdown(signal) {
    console.log(`\n  ${signal} recebido — encerrando servidor...`);
    clearInterval(_keepAliveTimer);

    if (pool) {
      try { await pool.end(); console.log('  Pool PostgreSQL encerrado.'); }
      catch (e) { console.error('  Erro ao fechar pool:', e.message); }
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('  Exceção não tratada (processo será encerrado):', err.message, err.stack);
    // Encerra com código 1 para que PM2 / systemd / Docker reinicie o processo
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('  Promise rejeitada sem tratamento:', reason);
    // Não encerra — rejeições assíncronas isoladas não necessariamente corrompem o estado
  });

})();
