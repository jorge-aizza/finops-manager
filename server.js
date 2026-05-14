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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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
  pool = new Pool({ ...cfg, connectionTimeoutMillis: 10000 });
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

    // 5) Índice único funcional para deduplicação — COALESCE trata NULLs
    //    (NULL ≠ NULL em constraints normais — sem COALESCE o ON CONFLICT nunca dispara)
    try {
      await c.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_azure_costs_dedup
        ON azure_costs(
          subscription_id,
          resource_id,
          cost_date,
          COALESCE(meter_id, ''),
          COALESCE(charge_type, ''),
          COALESCE(quantity, 0)
        )
      `);
      console.log('[Azure] Índice de deduplicação criado/verificado ✅');
    } catch (errIdx) {
      // Falha se ainda houver duplicatas no banco — usuário precisa rodar o script de limpeza
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
      // DD/MM/YYYY — formato padrão do Azure Cost Management Brasil/Europa
      // Deve ser testado ANTES de new Date() porque JS interpreta como MM/DD (US)
      const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        const iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
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
    cost_date:                       _toDate(row.date || row.Date),
    service_family:                  _toStr(row.serviceFamily),
    product_order_id:                _toStr(row.productOrderId),
    product_order_name:              _toStr(row.productOrderName),
    consumed_service:                _toStr(row.consumedService),
    meter_id:                        _toStr(row.meterId),
    meter_name:                      _toStr(row.meterName),
    meter_category:                  _toStr(row.meterCategory),
    meter_sub_category:              _toStr(row.meterSubCategory),
    meter_region:                    _toStr(row.meterRegion),
    product_id:                      _toStr(row.ProductId),
    product_name:                    _toStr(row.ProductName),
    subscription_id:                 _toStr(row.SubscriptionId),
    subscription_name:               _toStr(row.subscriptionName),
    publisher_type:                  _toStr(row.publisherType),
    publisher_id:                    _toStr(row.publisherId),
    publisher_name:                  _toStr(row.publisherName),
    resource_group_name:             _toStr(row.resourceGroupName),
    resource_id:                     row.ResourceId ? String(row.ResourceId).slice(0,2000) : null,
    resource_location:               _toStr(row.resourceLocation),
    location:                        _toStr(row.location),
    effective_price:                 _toNum(row.effectivePrice),
    quantity:                        _toNum(row.quantity),
    unit_of_measure:                 _toStr(row.unitOfMeasure),
    charge_type:                     _toStr(row.chargeType),
    billing_currency:                _toStr(row.billingCurrency),
    pricing_currency:                _toStr(row.pricingCurrency),
    cost_in_billing_currency:        _toNum(row.costInBillingCurrency),
    cost_in_pricing_currency:        _toNum(row.costInPricingCurrency),
    cost_in_usd:                     _toNum(row.costInUsd),
    payg_cost_in_billing_currency:   _toNum(row.paygCostInBillingCurrency),
    payg_cost_in_usd:                _toNum(row.paygCostInUsd),
    exchange_rate_pricing_to_billing:_toNum(row.exchangeRatePricingToBilling),
    exchange_rate_date:              _toDate(row.exchangeRateDate),
    is_azure_credit_eligible:        _toBool(row.isAzureCreditEligible),
    service_info1:                   _toStr(row.serviceInfo1),
    service_info2:                   _toStr(row.serviceInfo2),
    additional_info:                 _toJson(row.additionalInfo),
    tags:                            _toJson(row.tags),
    payg_price:                      _toNum(row.PayGPrice),
    frequency:                       _toStr(row.frequency),
    term:                            _toStr(row.term),
    reservation_id:                  _toStr(row.reservationId),
    reservation_name:                _toStr(row.reservationName),
    pricing_model:                   _toStr(row.pricingModel),
    unit_price:                      _toNum(row.unitPrice),
    cost_allocation_rule_name:       _toStr(row.costAllocationRuleName),
    benefit_id:                      _toStr(row.benefitId),
    benefit_name:                    _toStr(row.benefitName),
    provider:                        _toStr(row.provider),
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
  // CSV do Azure usa cabeçalhos camelCase idênticos ao parquet
  // mas entrega tudo como string — sem problemas de Buffer/INT96
  return {
    invoice_id:                      row.invoiceId              || null,
    previous_invoice_id:             row.previousInvoiceId      || null,
    billing_account_id:              row.billingAccountId       || null,
    billing_account_name:            row.billingAccountName     || null,
    billing_profile_id:              row.billingProfileId       || null,
    billing_profile_name:            row.billingProfileName     || null,
    invoice_section_id:              row.invoiceSectionId       || null,
    invoice_section_name:            row.invoiceSectionName     || null,
    reseller_name:                   row.resellerName           || null,
    reseller_mpn_id:                 row.resellerMpnId          || null,
    cost_center:                     row.costCenter             || null,
    billing_period_end_date:         _toDate(row.billingPeriodEndDate),
    billing_period_start_date:       _toDate(row.billingPeriodStartDate),
    service_period_end_date:         _toDate(row.servicePeriodEndDate),
    service_period_start_date:       _toDate(row.servicePeriodStartDate),
    cost_date:                       _toDate(row.date || row.Date),
    service_family:                  row.serviceFamily          || null,
    product_order_id:                row.productOrderId         || null,
    product_order_name:              row.productOrderName       || null,
    consumed_service:                row.consumedService        || null,
    meter_id:                        row.meterId                || null,
    meter_name:                      row.meterName              || null,
    meter_category:                  row.meterCategory          || null,
    meter_sub_category:              row.meterSubCategory       || null,
    meter_region:                    row.meterRegion            || null,
    product_id:                      row.ProductId              || null,
    product_name:                    row.ProductName            || null,
    subscription_id:                 row.SubscriptionId         || null,
    subscription_name:               row.subscriptionName       || null,
    publisher_type:                  row.publisherType          || null,
    publisher_id:                    row.publisherId            || null,
    publisher_name:                  row.publisherName          || null,
    resource_group_name:             row.resourceGroupName      || null,
    resource_id:                     row.ResourceId             || null,
    resource_location:               row.resourceLocation       || null,
    location:                        row.location               || null,
    effective_price:                 _toNum(row.effectivePrice),
    quantity:                        _toNum(row.quantity),
    unit_of_measure:                 row.unitOfMeasure          || null,
    charge_type:                     row.chargeType             || null,
    billing_currency:                row.billingCurrency        || null,
    pricing_currency:                row.pricingCurrency        || null,
    cost_in_billing_currency:        _toNum(row.costInBillingCurrency),
    cost_in_pricing_currency:        _toNum(row.costInPricingCurrency),
    cost_in_usd:                     _toNum(row.costInUsd),
    payg_cost_in_billing_currency:   _toNum(row.paygCostInBillingCurrency),
    payg_cost_in_usd:                _toNum(row.paygCostInUsd),
    exchange_rate_pricing_to_billing:_toNum(row.exchangeRatePricingToBilling),
    exchange_rate_date:              _toDate(row.exchangeRateDate),
    is_azure_credit_eligible:        _toBool(row.isAzureCreditEligible),
    service_info1:                   row.serviceInfo1           || null,
    service_info2:                   row.serviceInfo2           || null,
    additional_info:                 row.additionalInfo         || null,
    tags:                            row.tags                   || null,
    payg_price:                      _toNum(row.PayGPrice),
    frequency:                       row.frequency              || null,
    term:                            row.term                   || null,
    reservation_id:                  row.reservationId          || null,
    reservation_name:                row.reservationName        || null,
    pricing_model:                   row.pricingModel           || null,
    unit_price:                      _toNum(row.unitPrice),
    cost_allocation_rule_name:       row.costAllocationRuleName || null,
    benefit_id:                      row.benefitId              || null,
    benefit_name:                    row.benefitName            || null,
    provider:                        row.provider               || null,
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

  app.post('/api/azure-costs/import', authMiddleware, dbMiddleware, (req, res, next) => {
    // Desabilitar o timeout padrão para arquivos grandes
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
  }, async (req, res) => {
    const tmpPath    = req.file?.path;
    let   csvGerado  = null;
    const tmpZipFiles = []; // arquivos extraídos do ZIP para limpar depois
    try {
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

      const nomeOriginal = req.file.originalname.toLowerCase();
      const isCSV        = nomeOriginal.endsWith('.csv');
      const isParquet    = nomeOriginal.endsWith('.parquet');
      const isZIP        = nomeOriginal.endsWith('.zip');

      if (!isCSV && !isParquet && !isZIP) {
        return res.status(400).json({ error: 'Formato não suportado. Envie um arquivo .csv, .parquet ou .zip do Azure Cost Management.' });
      }

      // ── ZIP: extrair arquivos CSV/Parquet e processar cada um ──────
      if (isZIP) {
        const AdmZip = require('adm-zip');
        const fs     = require('fs');
        const path   = require('path');
        const tmpDir = path.dirname(tmpPath);

        let zip;
        try { zip = new AdmZip(tmpPath); }
        catch (e) { return res.status(400).json({ error: `ZIP inválido ou corrompido: ${e.message}` }); }

        const entradas = zip.getEntries().filter(e => {
          const n = e.entryName.toLowerCase();
          // Proteção contra zip-slip: rejeitar caminhos com ..
          if (n.includes('..')) return false;
          return n.endsWith('.csv') || n.endsWith('.parquet');
        });

        if (!entradas.length) {
          return res.status(400).json({ error: 'O ZIP não contém arquivos .csv ou .parquet válidos.' });
        }

        console.log(`[Azure Import] ZIP com ${entradas.length} arquivo(s):`, entradas.map(e => e.entryName).join(', '));

        let totalInseridos = 0, totalAtualizados = 0, totalErros = 0, totalLinhas = 0;
        const todosErrosMsgs = [];

        // Verificar índice de deduplicação uma única vez
        let temConstraint = false;
        try {
          const ck = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup' LIMIT 1`);
          temConstraint = ck.rowCount > 0;
        } catch (_) {}

        const COLS = Object.keys(_mapRowCSV({}, ''));
        const ph   = COLS.map((_, i) => `$${i + 1}`).join(', ');
        const updateCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
        const sqlUpsert = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
          ON CONFLICT (subscription_id, resource_id, cost_date, COALESCE(meter_id,''), COALESCE(charge_type,''), COALESCE(quantity,0))
          DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`;
        const sqlInsert = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
        const sql = temConstraint ? sqlUpsert : sqlInsert;

        for (const entrada of entradas) {
          const nomeArq  = path.basename(entrada.entryName);
          const destPath = path.join(tmpDir, `zip_${Date.now()}_${nomeArq}`);
          tmpZipFiles.push(destPath);

          try {
            zip.extractEntryTo(entrada, tmpDir, false, true, false, `zip_${Date.now()}_${nomeArq}`);
          } catch (e) {
            console.warn(`[Azure Import] Falha ao extrair ${nomeArq}:`, e.message);
            continue;
          }

          // Encontrar o arquivo extraído (adm-zip pode criar com nome ligeiramente diferente)
          let arquivoExtraido = destPath;
          if (!fs.existsSync(arquivoExtraido)) {
            // Tentar pelo nome original dentro do tmpDir
            const alt = path.join(tmpDir, nomeArq);
            if (fs.existsSync(alt)) arquivoExtraido = alt;
            else { console.warn(`[Azure Import] Arquivo extraído não encontrado: ${nomeArq}`); continue; }
          }

          let rows = [], mapFn = _mapRowCSV;
          if (nomeArq.endsWith('.csv')) {
            rows  = await _lerCSV(arquivoExtraido);
          } else {
            let tmpCsv = null;
            try {
              tmpCsv = await _parquetParaCSV(arquivoExtraido);
              if (tmpCsv && fs.existsSync(tmpCsv)) { rows = await _lerCSV(tmpCsv); }
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

          console.log(`[Azure Import] ${nomeArq}: ${rows.length} linhas`);
          totalLinhas += rows.length;

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
                  if (r.rowCount > 0) totalInseridos++; else totalAtualizados++;
                } catch (e) {
                  await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                  await client.query(`RELEASE SAVEPOINT ${sp}`);
                  totalErros++;
                  if (todosErrosMsgs.length < 5) todosErrosMsgs.push(e.message);
                }
              }
            }
            await client.query('COMMIT');
          } catch (e) { await client.query('ROLLBACK'); throw e; }
          finally { client.release(); }
        }

        _refreshAzureCache().catch(e => console.warn('[Azure] Falha ao atualizar cache pós-import:', e.message));
        return res.json({
          message:    `ZIP processado (${entradas.length} arquivo${entradas.length > 1 ? 's' : ''}): ${totalInseridos} novos, ${totalAtualizados} atualizados, ${totalErros} ignorados.`,
          total:      totalLinhas,
          inseridos:  totalInseridos,
          atualizados: totalAtualizados,
          erros:      totalErros,
          erros_detalhe: todosErrosMsgs,
        });
      }

      let rows = [];
      let mapFn = _mapRowCSV;

      if (isCSV) {
        // ── CSV: leitura streaming, suporta arquivos de qualquer tamanho
        console.log('[Azure Import] Lendo CSV:', req.file.originalname);
        rows = await _lerCSV(tmpPath);
        mapFn = _mapRowCSV;

      } else {
        // ── Parquet: tentar converter para CSV via Python/pyarrow primeiro
        console.log('[Azure Import] Lendo Parquet:', req.file.originalname);
        const fs = require('fs');

        try {
          csvGerado = await _parquetParaCSV(tmpPath);
          if (csvGerado && fs.existsSync(csvGerado)) {
            console.log('[Azure Import] Parquet convertido para CSV via pyarrow ✅');
            rows  = await _lerCSV(csvGerado);
            mapFn = _mapRowCSV;
          }
        } catch (pyErr) {
          console.warn('[Azure Import] pyarrow falhou, tentando parquetjs:', pyErr.message);
          csvGerado = null;
        }

        // Fallback: parquetjs (com limitações para INT96/Decimal)
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
            mapFn = _mapRow; // usa mapeamento com suporte a Buffer/INT96
            console.warn('[Azure Import] Usando parquetjs (datas e decimais podem ter limitações)');
          } else {
            return res.status(500).json({
              error: 'Não foi possível ler o arquivo Parquet.\n' +
                     'Exporte os dados como CSV no Azure Cost Management ou instale: npm install @dsnp/parquetjs'
            });
          }
        }
      }

      if (!rows.length) return res.status(400).json({ error: 'Arquivo vazio ou sem dados válidos.' });

      console.log(`[Azure Import] ${rows.length} linhas lidas. Amostra da 1ª linha:`);
      const s0 = rows[0];
      console.log('  date:', s0.date || s0.Date, '| costInBillingCurrency:', s0.costInBillingCurrency, '| resourceGroupName:', s0.resourceGroupName);

      const COLS = Object.keys(_mapRowCSV({}, ''));
      const ph   = COLS.map((_, i) => `$${i + 1}`).join(', ');

      // UPSERT com índice funcional — COALESCE resolve NULLs na chave de conflito
      const updateCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
      const sqlUpsert = `
        INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
        ON CONFLICT (subscription_id, resource_id, cost_date,
                     COALESCE(meter_id,''), COALESCE(charge_type,''), COALESCE(quantity,0))
        DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}
      `;
      // Fallback: se o índice único ainda não existir (ex: duplicatas impedem criação)
      const sqlInsert = `
        INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
        ON CONFLICT DO NOTHING
      `;

      // Verificar se o índice de deduplicação existe
      let temConstraint = false;
      try {
        const ck = await pool.query(`
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'azure_costs'
            AND indexname  = 'idx_azure_costs_dedup'
          LIMIT 1
        `);
        temConstraint = ck.rowCount > 0;
      } catch (_) { temConstraint = false; }

      const sql = temConstraint ? sqlUpsert : sqlInsert;

      let inseridos = 0, atualizados = 0, erros = 0;
      const errosMsgs = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let spCount = 0;
        for (let i = 0; i < rows.length; i += 200) {
          for (const rawRow of rows.slice(i, i + 200)) {
            const sp = `sp_${spCount++}`;
            try {
              await client.query(`SAVEPOINT ${sp}`);
              const m      = mapFn(rawRow, req.file.originalname);
              const values = COLS.map(col => m[col] ?? null);
              const r      = await client.query(sql, values);
              await client.query(`RELEASE SAVEPOINT ${sp}`);
              if (r.rowCount > 0) inseridos++;
              else atualizados++;
            } catch (e) {
              await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
              await client.query(`RELEASE SAVEPOINT ${sp}`);
              erros++;
              if (errosMsgs.length < 5) errosMsgs.push(e.message);
              if (erros <= 3) console.warn('[Azure Import] Linha ignorada:', e.message);
            }
          }
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }

      console.log(`[Azure Import] Concluído: ${inseridos} inseridos, ${atualizados} atualizados, ${erros} erros / ${rows.length} linhas`);
      if (errosMsgs.length) console.log('[Azure Import] Primeiros erros:', errosMsgs);
      _refreshAzureCache().catch(e => console.warn('[Azure] Falha ao atualizar cache pós-import:', e.message));

      res.json({
        message:     `Importação concluída: ${inseridos} novos, ${atualizados} atualizados, ${erros} ignorados.`,
        total:       rows.length,
        inseridos,
        atualizados,
        erros,
        erros_detalhe: errosMsgs,
      });
    } catch (err) {
      console.error('Erro na importação Azure:', err);
      res.status(500).json({ error: err.message });
    } finally {
      const fs = require('fs');
      if (tmpPath)   try { fs.unlinkSync(tmpPath);   } catch (_) {}
      if (csvGerado) try { fs.unlinkSync(csvGerado); } catch (_) {}
      for (const f of tmpZipFiles) try { fs.unlinkSync(f); } catch (_) {}
    }
  });
}

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

// ── GET /api/calculadora/recursos ────────────────────────────────────────────
// Aceita subscription_id e resource_group como valores separados por vírgula
app.get('/api/calculadora/recursos', authMiddleware, dbMiddleware, async (req, res) => {
  try {
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
    cond.push(`charge_type NOT IN ('Tax','Refund','RoundingAdjustment')`);

    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    console.log('[Recursos] WHERE:', where);
    console.log('[Recursos] params:', params);
    const _t0 = Date.now();

    const r = await pool.query(`
      SELECT
        resource_id,
        MAX(UPPER(resource_group_name))                                     AS resource_group_name,
        MAX(COALESCE(
          NULLIF(SPLIT_PART(resource_id, '/', 9), ''),
          product_name, meter_name, resource_id
        ))                                                                   AS nome_recurso,
        MAX(meter_category)                                                  AS categoria,
        MAX(meter_sub_category)                                              AS subcategoria,
        MAX(product_name)                                                    AS produto,
        MAX(consumed_service)                                                AS consumed_service,
        MAX(charge_type)                                                     AS charge_type,
        MAX(pricing_model)                                                   AS pricing_model,
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
        -- effective_price tem prioridade sobre unit_price (cobre reservas e descontos)
        SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity, 0)
            * COALESCE(exchange_rate_pricing_to_billing, 1))                 AS total_upq_brl,
        SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity, 0)) AS total_upq_usd,
        MAX(unit_of_measure)                                                 AS unidade,
        MAX(unit_of_measure)                                                 AS unit_of_measure,
        -- Valor/hora universal: Hour → preço×qty/qty; não-Hour → billing/dias_ativos/24
        CASE
          WHEN MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%'
            THEN ROUND(
              COALESCE(
                NULLIF(SUM(COALESCE(NULLIF(effective_price,0),unit_price,0)*COALESCE(quantity,0)*COALESCE(exchange_rate_pricing_to_billing,1))
                       / NULLIF(SUM(COALESCE(quantity,0)),0), 0),
                SUM(COALESCE(cost_in_billing_currency,0)) / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24,0)
              )::numeric, 8)
          ELSE ROUND(SUM(COALESCE(cost_in_billing_currency,0))::numeric
                     / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24, 0), 8)
        END AS custo_hora_billing,
        CASE
          WHEN MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%'
            THEN ROUND(
              COALESCE(
                NULLIF(SUM(COALESCE(NULLIF(effective_price,0),unit_price,0)*COALESCE(quantity,0))
                       / NULLIF(SUM(COALESCE(quantity,0)),0), 0),
                SUM(COALESCE(cost_in_usd,0)) / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24,0)
              )::numeric, 8)
          ELSE ROUND(SUM(COALESCE(cost_in_usd,0))::numeric
                     / NULLIF((MAX(cost_date)-MIN(cost_date)+1)*24, 0), 8)
        END AS custo_hora_usd,
        NULL::numeric AS custo_dia_billing,
        NULL::numeric AS custo_dia_usd,
        NULL::numeric AS custo_uom_billing,
        NULL::numeric AS custo_uom_usd
      FROM azure_costs
      ${where}
      GROUP BY resource_id
      ORDER BY MAX(UPPER(resource_group_name)), SUM(COALESCE(cost_in_billing_currency,0)) DESC
    `, params);

    console.log(`[Recursos] ${r.rows.length} recursos — ${Date.now()-_t0}ms`);
    res.json(r.rows);
  } catch (err) {
    console.error('Erro /api/calculadora/recursos:', err);
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
      SELECT resource_id, COUNT(DISTINCT cost_date) AS dias_ativos,
             SUM(cost_in_billing_currency) AS total_billing,
             SUM(cost_in_usd) AS total_usd,
             MAX(billing_currency) AS moeda,
             MAX(exchange_rate_pricing_to_billing) AS taxa_cambio,
             MAX(unit_of_measure) AS unidade,
             SUM(quantity) AS total_qty,
             SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity,0)) AS total_upq,
             SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0) * COALESCE(quantity,0)
                 * COALESCE(exchange_rate_pricing_to_billing,1)) AS total_upq_brl
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
      const diasAtivos  = parseInt(dados.dias_ativos) || 1;
      const totalBilling = parseFloat(dados.total_billing) || 0;
      const totalUsd     = parseFloat(dados.total_usd) || 0;
      const totalQty     = parseFloat(dados.total_qty) || 0;
      const uom          = (dados.unidade || '').toLowerCase();
      const isHora       = uom.includes('hour') || uom.includes('hora');

      // Custo/hora via effective_price (ou unit_price) × quantity
      const totalUpq    = parseFloat(dados.total_upq)     || 0;
      const totalUpqBrl = parseFloat(dados.total_upq_brl) || 0;

      const moeda = dados.moeda || 'USD';
      const horas = parseFloat(item.horas) || 0;
      const dias_estimados = horas / 24;

      let custo_hora_billing, custo_hora_usd, custo_hora_brl;
      let estimativa_billing, estimativa_usd, estimativa_brl;

      const horasReais = diasAtivos * 24 || 720;
      if (isHora) {
        // UoM = Hour: preço efetivo × qty / qty (média ponderada)
        // fallback para billing/horas_reais quando effective_price e unit_price = 0
        custo_hora_billing = totalQty > 0 && totalUpqBrl > 0
          ? totalUpqBrl / totalQty
          : totalBilling / horasReais;
        custo_hora_usd = totalQty > 0 && totalUpq > 0
          ? totalUpq / totalQty
          : totalUsd / horasReais;
      } else {
        // UoM ≠ Hour: usa dias_ativos reais do arquivo, não 30 fixo
        custo_hora_billing = totalBilling / horasReais;
        custo_hora_usd     = totalUsd     / horasReais;
      }
      custo_hora_brl     = moeda === 'BRL' ? custo_hora_billing : custo_hora_billing * parseFloat(taxa_brl);
      estimativa_billing = custo_hora_billing * horas;
      estimativa_usd     = custo_hora_usd     * horas;
      estimativa_brl     = custo_hora_brl     * horas;

      return {
        resource_id:        item.resource_id,
        horas_estimadas:    horas,
        dias_estimados:     parseFloat(dias_estimados.toFixed(2)),
        isHora,
        custo_hora_billing: parseFloat((custo_hora_billing || 0).toFixed(8)),
        custo_hora_usd:     parseFloat((custo_hora_usd     || 0).toFixed(8)),
        custo_hora_brl:     parseFloat((custo_hora_brl     || 0).toFixed(4)),
        estimativa_billing: parseFloat((estimativa_billing || 0).toFixed(4)),
        estimativa_usd:     parseFloat((estimativa_usd     || 0).toFixed(4)),
        estimativa_brl:     parseFloat((estimativa_brl     || 0).toFixed(2)),
        moeda,
        taxa_brl_usada:     parseFloat(taxa_brl),
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

const _COLETA_API_VER = '2023-11-01';
let _coletaEmExecucao = false;
let _coletaScheduler  = null;

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
    ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS granularidade_dias INTEGER DEFAULT 7;
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

async function _azureGetToken(tenantId, clientId, clientSecret) {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId,
      client_secret: clientSecret, scope: 'https://management.azure.com/.default'
    }).toString()
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Autenticação Azure falhou (${resp.status}): ${e}`); }
  return (await resp.json()).access_token;
}

async function _azureListSubs(token) {
  const subs = [];
  let url = 'https://management.azure.com/subscriptions?api-version=2022-12-01';
  while (url) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Erro ao listar subscriptions (${resp.status})`);
    const data = await resp.json();
    subs.push(...(data.value || []).filter(s => s.state === 'Enabled'));
    url = data.nextLink || null;
  }
  return subs;
}

async function _azureGerarRelatorio(token, subId, startDate, endDate) {
  const url = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=${_COLETA_API_VER}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metric: 'ActualCost', timePeriod: { start: startDate, end: endDate } })
  });
  if (resp.status === 202) return { location: resp.headers.get('Location') };
  if (resp.status === 200) return { data: await resp.json() };
  const e = await resp.text(); throw new Error(`Erro ao gerar relatório (${resp.status}): ${e}`);
}

async function _azurePollRelatorio(token, locationUrl) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const resp = await fetch(locationUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 200) return await resp.json();
    if (resp.status === 202) continue;
    const e = await resp.text(); throw new Error(`Erro ao aguardar relatório (${resp.status}): ${e}`);
  }
  throw new Error('Timeout aguardando relatório Azure (20 min)');
}

function _splitPeriodo(startDate, endDate, diasChunk) {
  const chunks = [];
  let cur = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + diasChunk - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ start: cur.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

async function _azureDownloadCSV(downloadUrl) {
  const path   = require('path');
  const fs     = require('fs');
  const crypto = require('crypto');
  const os     = require('os');
  const dest   = path.join(os.tmpdir(), `az_coleta_${crypto.randomBytes(6).toString('hex')}.csv`);
  const resp   = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Erro ao baixar CSV (${resp.status})`);
  fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
  return dest;
}

async function _executarColeta(modo = 'auto') {
  if (_coletaEmExecucao) throw new Error('Coleta já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _coletaEmExecucao = true;

  let histId, totalSubs = 0, subsOk = 0, subsErro = 0;
  let totalIns = 0, totalUpd = 0, totalErr = 0;
  const detalhes = [];

  try {
    const r = await pool.query(`INSERT INTO azure_coleta_historico (status) VALUES ('executando') RETURNING id`);
    histId = r.rows[0].id;

    const cfgRow = await pool.query(`SELECT * FROM azure_coleta_config LIMIT 1`);
    if (!cfgRow.rows.length) throw new Error('Coleta automática não configurada');
    const cfg = cfgRow.rows[0];
    if (!cfg.ativo && modo === 'auto') throw new Error('Coleta automática está desativada');

    const secret = _decryptSecret(cfg.client_secret);
    console.log('[Coleta] Autenticando no Azure...');
    const token = await _azureGetToken(cfg.tenant_id, cfg.client_id, secret);

    console.log('[Coleta] Listando subscriptions do tenant...');
    const subs = await _azureListSubs(token);
    totalSubs = subs.length;
    console.log(`[Coleta] ${totalSubs} subscription(s) ativa(s)`);

    // Período: mês anterior completo
    const hoje   = new Date();
    const inicio = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1, 1));
    const fim    = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 0));
    const startDate = inicio.toISOString().slice(0, 10);
    const endDate   = fim.toISOString().slice(0, 10);
    const granularidade = cfg.granularidade_dias || 7;
    const chunks = _splitPeriodo(startDate, endDate, granularidade);
    console.log(`[Coleta] Período: ${startDate} → ${endDate} (${chunks.length} chunk(s) de ${granularidade} dias)`);

    const COLS    = Object.keys(_mapRowCSV({}, ''));
    const ph      = COLS.map((_, i) => `$${i + 1}`).join(', ');
    const updCols = COLS.filter(c => !['subscription_id','resource_id','cost_date','meter_id','charge_type','quantity'].includes(c));
    let temIdx = false;
    try {
      const ck = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup' LIMIT 1`);
      temIdx = ck.rowCount > 0;
    } catch (_) {}
    const sqlU = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph})
      ON CONFLICT (subscription_id,resource_id,cost_date,COALESCE(meter_id,''),COALESCE(charge_type,''),COALESCE(quantity,0))
      DO UPDATE SET ${updCols.map(c => `${c}=EXCLUDED.${c}`).join(',')}`;
    const sqlI = `INSERT INTO azure_costs (${COLS.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
    const sql  = temIdx ? sqlU : sqlI;

    for (const sub of subs) {
      const subId   = sub.subscriptionId;
      const subName = sub.displayName;
      const csvFiles = [];
      let subIns = 0, subUpd = 0, subErr = 0, subBlobs = 0, subSemDados = 0;
      let subFailed = false;
      try {
        console.log(`[Coleta] → ${subName} (${chunks.length} chunk(s))`);
        for (const chunk of chunks) {
          try {
            const result  = await _azureGerarRelatorio(token, subId, chunk.start, chunk.end);
            const repData = result.location ? await _azurePollRelatorio(token, result.location) : result.data;
            const blobs   = repData?.manifest?.blobs ||
                            (repData?.downloadUrl ? [{ blobLink: repData.downloadUrl }] : []);

            if (!blobs.length) { subSemDados++; continue; }

            for (const blob of blobs) {
              const dlUrl = blob.blobLink || blob.downloadUrl;
              if (!dlUrl) continue;
              const csv = await _azureDownloadCSV(dlUrl);
              csvFiles.push(csv);
              const rows = await _lerCSV(csv);
              console.log(`[Coleta]   ${chunk.start}→${chunk.end}: ${rows.length} linhas`);
              subBlobs++;

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
                      const m  = _mapRowCSV(raw, `${subName}_${chunk.start}`);
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
              subIns += ins; subUpd += upd; subErr += err;
            }
          } catch (chunkErr) {
            console.error(`[Coleta]   Erro no chunk ${chunk.start}→${chunk.end}:`, chunkErr.message);
            subErr++;
            subFailed = true;
            detalhes.push({ sub: subName, subId, chunk: `${chunk.start}→${chunk.end}`, status: 'erro', erro: chunkErr.message });
          }
        }
        totalIns += subIns; totalUpd += subUpd; totalErr += subErr;
        if (subFailed) {
          subsErro++;
        } else {
          detalhes.push({ sub: subName, subId, status: subBlobs ? 'ok' : 'sem_dados', blobs: subBlobs, chunks: chunks.length });
          subsOk++;
        }
      } catch (subErr) {
        console.error(`[Coleta] Erro em ${subName}:`, subErr.message);
        detalhes.push({ sub: subName, subId, status: 'erro', erro: subErr.message });
        subsErro++;
      } finally {
        const fs = require('fs');
        for (const f of csvFiles) try { fs.unlinkSync(f); } catch (_) {}
      }
    }

    _refreshAzureCache().catch(() => {});
    const msg = `${subsOk}/${totalSubs} subs OK · ${totalIns} inseridos · ${totalUpd} atualizados · ${totalErr} erros`;
    console.log(`[Coleta] Concluída: ${msg}`);
    await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='concluido',subs_total=$1,subs_ok=$2,subs_erro=$3,linhas_inseridas=$4,linhas_atualizadas=$5,linhas_erro=$6,mensagem=$7,detalhes=$8 WHERE id=$9`,
      [totalSubs, subsOk, subsErro, totalIns, totalUpd, totalErr, msg, JSON.stringify({ modo, subs: detalhes }), histId]);
    return { ok: true, msg, detalhes };

  } catch (err) {
    console.error('[Coleta] Erro geral:', err.message);
    if (histId) await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='erro',subs_total=$1,subs_ok=$2,subs_erro=$3,linhas_inseridas=$4,linhas_atualizadas=$5,linhas_erro=$6,mensagem=$7,detalhes=$8 WHERE id=$9`,
      [totalSubs, subsOk, subsErro, totalIns, totalUpd, totalErr, err.message, JSON.stringify(detalhes), histId]).catch(() => {});
    throw err;
  } finally {
    _coletaEmExecucao = false;
  }
}

function _iniciarSchedulerColeta() {
  if (_coletaScheduler) clearInterval(_coletaScheduler);
  _coletaScheduler = setInterval(async () => {
    if (!pool || _coletaEmExecucao) return;
    try {
      const cfg = await pool.query(`SELECT ativo, dia_execucao FROM azure_coleta_config LIMIT 1`).catch(() => ({ rows: [] }));
      if (!cfg.rows.length || !cfg.rows[0].ativo) return;
      if (new Date().getDate() !== (cfg.rows[0].dia_execucao || 5)) return;
      const jaFez = await pool.query(`SELECT 1 FROM azure_coleta_historico WHERE DATE(iniciado_em)=CURRENT_DATE AND status IN ('concluido','executando') LIMIT 1`);
      if (jaFez.rowCount > 0) return;
      console.log('[Coleta] Iniciando coleta automática agendada...');
      _executarColeta('auto').catch(e => console.error('[Coleta] Erro automático:', e.message));
    } catch (e) { console.warn('[Coleta] Scheduler erro:', e.message); }
  }, 60 * 60 * 1000); // verifica a cada hora
}

// ── Endpoints Coleta Automática ───────────────────────────────────────────────

app.get('/api/azure-coleta/config', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT id,tenant_id,client_id,ativo,dia_execucao,granularidade_dias,atualizado_em FROM azure_coleta_config LIMIT 1`);
    res.json(r.rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/config', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { tenant_id, client_id, client_secret, ativo, dia_execucao, granularidade_dias } = req.body;
    await ensureAzureColetaTable();
    const ex = await pool.query(`SELECT id, client_secret FROM azure_coleta_config LIMIT 1`);
    let secretEnc = ex.rows[0]?.client_secret || '';
    if (client_secret?.trim()) secretEnc = _encryptSecret(client_secret.trim());
    const gran = Math.min(28, Math.max(1, parseInt(granularidade_dias) || 7));
    if (ex.rows.length) {
      await pool.query(`UPDATE azure_coleta_config SET tenant_id=$1,client_id=$2,client_secret=$3,ativo=$4,dia_execucao=$5,granularidade_dias=$6,atualizado_em=NOW() WHERE id=$7`,
        [tenant_id, client_id, secretEnc, ativo ?? false, dia_execucao ?? 5, gran, ex.rows[0].id]);
    } else {
      await pool.query(`INSERT INTO azure_coleta_config(tenant_id,client_id,client_secret,ativo,dia_execucao,granularidade_dias) VALUES($1,$2,$3,$4,$5,$6)`,
        [tenant_id, client_id, secretEnc, ativo ?? false, dia_execucao ?? 5, gran]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/testar', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM azure_coleta_config LIMIT 1`);
    if (!r.rows.length) return res.status(400).json({ error: 'Coleta não configurada' });
    const cfg    = r.rows[0];
    const secret = _decryptSecret(cfg.client_secret);
    const token  = await _azureGetToken(cfg.tenant_id, cfg.client_id, secret);
    const subs   = await _azureListSubs(token);
    res.json({ ok: true, subscriptions: subs.length, preview: subs.slice(0, 5).map(s => s.displayName) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/azure-coleta/executar', authMiddleware, dbMiddleware, (req, res) => {
  if (_coletaEmExecucao) return res.status(409).json({ error: 'Coleta já em execução' });
  res.json({ ok: true, message: 'Coleta iniciada em background' });
  _executarColeta('manual').catch(e => console.error('[Coleta] Erro manual:', e.message));
});

app.get('/api/azure-coleta/status', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id,iniciado_em,concluido_em,status,subs_total,subs_ok,subs_erro,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem FROM azure_coleta_historico ORDER BY iniciado_em DESC LIMIT 1`);
    res.json({ em_execucao: _coletaEmExecucao, ultimo: r.rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/azure-coleta/historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id,iniciado_em,concluido_em,status,subs_total,subs_ok,subs_erro,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem,detalhes FROM azure_coleta_historico ORDER BY iniciado_em DESC LIMIT 50`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      try { await ensureAzureColetaTable(); _iniciarSchedulerColeta(); } catch (e) { console.warn('[Coleta] Scheduler não iniciado:', e.message); }
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
    if (_coletaScheduler) clearInterval(_coletaScheduler);
    if (pool) {
      try { await pool.end(); console.log('  Pool PostgreSQL encerrado.'); }
      catch (e) { console.error('  Erro ao fechar pool:', e.message); }
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('  Exceção não tratada:', err.message);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('  Promise rejeitada sem tratamento:', reason);
  });

})();
