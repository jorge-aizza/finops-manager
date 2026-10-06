process.env.TZ = process.env.TZ || 'America/Sao_Paulo'; // deve vir antes de qualquer require

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
const jwksRsa  = require('jwks-rsa');
const nodemailer = require('nodemailer');

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
// frontend/ (fonte + config do bundle React em migração) fica bloqueado por
// padrão — só frontend/dist (o bundle já compilado) é servido, via a rota
// dedicada /react-app abaixo. Sem isso, package.json/tsconfig.json etc. do
// frontend ficariam publicamente acessíveis (não batem com o regex acima,
// que só cobre nomes de arquivo na raiz do projeto).
const _FRONTEND_SRC = /^\/frontend\/(?!dist\/)/i;
app.use((req, res, next) => {
  if (_SENSITIVE.test(req.path) || req.path.includes('node_modules') || _FRONTEND_SRC.test(req.path)) {
    return res.status(403).end();
  }
  next();
});

// HTML: sempre revalida no servidor (evita quebra após deploy)
// JS/CSS/imagens: ETag padrão do Express (só baixa se mudou)
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
// Bundle React — migração incremental tela por tela (ver plano em
// C:\Users\jorge\.claude\plans\magical-gliding-gem.md). Nomes de arquivo
// fixos (react-app.js/.css), sem hash — configurado em frontend/vite.config.ts.
app.use('/react-app', express.static(path.join(__dirname, 'frontend', 'dist')));
app.use(express.static(path.join(__dirname), { index: 'index.html', etag: true, lastModified: true }));

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
    max:                    20,     // máximo de conexões simultâneas (aumentado para suportar startup paralelo)
    min:                    2,      // mínimo mantido aquecido
    connectionTimeoutMillis: 60000, // timeout ao adquirir conexão (60s — startup tem várias ops concorrentes)
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

    // Dedup de alertas por e-mail — sem isso, uma checagem periódica (orçamento
    // estourado, reserva/ação vencendo) reenviaria o mesmo alerta a cada ciclo
    // pra sempre. `chave` carrega a identidade do alerta (ex: 'reserva:42',
    // 'orcamento:3:2026-08' — mês incluso pra reavisar todo mês se continuar
    // estourado). Ver _sendEmail/_checkReservasVencendo etc. mais abaixo.
    await c.query(`
      CREATE TABLE IF NOT EXISTS email_alertas_enviados (
        id         SERIAL PRIMARY KEY,
        tipo       VARCHAR(50) NOT NULL,
        chave      VARCHAR(200) NOT NULL,
        enviado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE (tipo, chave)
      );
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
      ALTER TABLE projetos ADD COLUMN IF NOT EXISTS status        VARCHAR(20) DEFAULT 'Ativo';
      UPDATE projetos SET status = 'Ativo' WHERE status IS NULL;
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
        validade_dias   INTEGER DEFAULT 5,
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
        criado_em       TIMESTAMP DEFAULT NOW(),
        atualizado_em   TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE estimativas ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pendente';
      ALTER TABLE estimativas ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();
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

    // Sincronização com a Azure: 'manual' = cadastro pela tela, 'azure' = importada via SP.
    // azure_id (resource id em minúsculas) é a chave do upsert — reservas manuais ficam NULL.
    await c.query(`
      ALTER TABLE reservas_cloud ADD COLUMN IF NOT EXISTS origem          VARCHAR(20) DEFAULT 'manual';
      ALTER TABLE reservas_cloud ADD COLUMN IF NOT EXISTS azure_id        TEXT;
      ALTER TABLE reservas_cloud ADD COLUMN IF NOT EXISTS sp_id           INTEGER;
      ALTER TABLE reservas_cloud ADD COLUMN IF NOT EXISTS sincronizado_em TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_azure_id ON reservas_cloud (azure_id) WHERE azure_id IS NOT NULL;
    `);

    // ── PERFORMANCE INDEXES v2.0 — tabelas core ──────────────────────────────
    // Reversão: ver rollback_performance_indexes.sql
    await c.query(`
      -- acoes_finops: filtros de lista, dashboard e notificações
      CREATE INDEX IF NOT EXISTS idx_acoes_status        ON acoes_finops (status);
      CREATE INDEX IF NOT EXISTS idx_acoes_projeto        ON acoes_finops (projeto_id);
      CREATE INDEX IF NOT EXISTS idx_acoes_conclusao      ON acoes_finops (data_conclusao);
      CREATE INDEX IF NOT EXISTS idx_acoes_cloud          ON acoes_finops (cloud);

      -- sessoes: lookup por usuário (FK sem index automático no PG)
      CREATE INDEX IF NOT EXISTS idx_sessoes_usuario      ON sessoes (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_sessoes_criado        ON sessoes (criado_em);

      -- estimativas: listagem ordenada e filtro por projeto
      CREATE INDEX IF NOT EXISTS idx_estimativas_projeto  ON estimativas (projeto_id);
      CREATE INDEX IF NOT EXISTS idx_estimativas_criado   ON estimativas (criado_em DESC);

      -- reservas_cloud: query de alertas de vencimento
      CREATE INDEX IF NOT EXISTS idx_reservas_status_venc ON reservas_cloud (status, data_vencimento);
    `);

    // Portal público — configuração de acesso sem login
    await c.query(`
      CREATE TABLE IF NOT EXISTS portal_config (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS portal_acessos (
        id          SERIAL PRIMARY KEY,
        nome        TEXT NOT NULL,
        email       TEXT NOT NULL,
        ip          TEXT,
        user_agent  TEXT,
        acessado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Limpeza de sessões antigas (> 90 dias) — evita crescimento ilimitado da tabela
    try {
      const del = await c.query(`DELETE FROM sessoes WHERE criado_em < NOW() - INTERVAL '90 days'`);
      if (del.rowCount > 0) console.log(`[DB] ${del.rowCount} sessão(ões) antigas removidas.`);
    } catch (_) {}

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

// Substitui `res.status(500).json({ error: err.message })` nos ~90 catches genéricos do
// arquivo — err.message costuma ser um erro cru do Postgres (nome de tabela/coluna/
// constraint), útil pra depurar mas não pra devolver pro cliente (inclusive em rotas
// públicas sem autenticação). Loga o erro completo no servidor, devolve mensagem genérica.
// NÃO usar nos poucos catches que já tratam um código de erro específico (ex: 23505 —
// "Email ja cadastrado") com uma mensagem amigável própria; usar só no fallback deles.
function _dbErr(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: 'Erro interno do servidor.' });
}

// Restringe a admins autenticados — usar após authMiddleware
function adminMiddleware(req, res, next) {
  if (req.user?.perfil !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
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
  } catch (err) { _dbErr(res, err); }
});

// ─── ENTRA ID (OAuth 2.0 authorization-code flow) ────────────────────────────
// _entraStates: state (CSRF) → { criadoEm } — gerado em /entra/url, validado uma
// vez em /auth/callback e removido (ou expira em 10 min sem uso).
// _entraHandoffs: código de handoff de uso único → { token, user, criadoEm } —
// evita colocar o JWT na URL do redirect final (query string fica em histórico
// do navegador, logs de proxy, Referer). O SPA troca esse código por
// { token, user } via GET /api/auth/entra/consume, um fetch comum, não a
// navegação de página inteira que o callback do OAuth exige.
const _entraStates   = new Map();
const _entraHandoffs = new Map();
const _ENTRA_STATE_TTL_MS   = 10 * 60 * 1000;
const _ENTRA_HANDOFF_TTL_MS = 60 * 1000;
function _entraCleanup() {
  const now = Date.now();
  for (const [k, v] of _entraStates)   if (now - v.criadoEm > _ENTRA_STATE_TTL_MS)   _entraStates.delete(k);
  for (const [k, v] of _entraHandoffs) if (now - v.criadoEm > _ENTRA_HANDOFF_TTL_MS) _entraHandoffs.delete(k);
}

// `origem` decide, no /auth/callback, se este login é do app interno (grava em
// usuarios/sessoes, perfil admin/finops/reader) ou do portal público (login PARALELO —
// nunca vira um usuário do sistema, só confirma "quem é você" pra filtrar dados pessoais,
// ver GET /api/public/auth/entra/url). O redirect_uri no Entra ID continua único (evita
// reconfigurar o app registration); é o state, não a URL de volta, que carrega a origem.
async function _iniciarLoginEntra(origem) {
  const cfg = await pool.query("SELECT config FROM integracoes WHERE tipo = 'entra' AND ativo = true");
  if (!cfg.rows.length) return null;
  const c = cfg.rows[0].config;
  _entraCleanup();
  const state = crypto.randomBytes(24).toString('hex');
  _entraStates.set(state, { criadoEm: Date.now(), origem });
  return 'https://login.microsoftonline.com/' + c.tenant_id + '/oauth2/v2.0/authorize?' +
    'client_id=' + encodeURIComponent(c.client_id) + '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(c.redirect_uri) + '&scope=openid+profile+email' +
    '&state=' + state;
}

app.get('/api/auth/entra/url', async (req, res) => {
  try {
    const url = await _iniciarLoginEntra('app');
    if (!url) return res.status(400).json({ error: 'Entra ID nao configurado' });
    res.json({ url });
  } catch (err) { _dbErr(res, err); }
});

// GET /api/public/auth/entra/url — mesmo fluxo OAuth do app interno, mas pro portal
// público: origem='portal' no state decide em /auth/callback que este login NUNCA grava em
// usuarios/sessoes nem ganha perfil — só confirma o e-mail pra filtrar a visão pessoal
// (GET /api/public/genie-cotas). Sem autenticação própria: é a PORTA de entrada.
app.get('/api/public/auth/entra/url', async (req, res) => {
  try {
    const url = await _iniciarLoginEntra('portal');
    if (!url) return res.status(400).json({ error: 'Entra ID nao configurado' });
    res.json({ url });
  } catch (err) { _dbErr(res, err); }
});

// GET /auth/callback — redirect_uri configurado no app registration do Entra ID
// (fora do prefixo /api/: é alvo de navegação de página inteira feita pelo
// browser após o login no Microsoft, nunca um fetch/XHR do SPA). Troca o
// authorization code por tokens, valida a assinatura do id_token contra o JWKS
// do tenant, mapeia grupos pra perfil (mesmo padrão de POST /api/auth/ad) e
// entrega { token, user } pro SPA via código de handoff de uso único.
app.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const fail = (msg) => res.redirect('/?entra_error=' + encodeURIComponent(msg));
  if (error) return fail(error_description || error);
  if (!code || !state) return fail('Resposta inválida do Microsoft Entra ID.');

  _entraCleanup();
  if (!_entraStates.has(state)) return fail('Sessão de login expirada ou inválida. Tente novamente.');
  const { origem } = _entraStates.get(state);
  _entraStates.delete(state); // uso único — nunca revalida o mesmo state duas vezes
  // Portal público: login PARALELO, nunca grava em usuarios/sessoes nem tem perfil — só
  // confirma o e-mail. O redirect final é pro portal.html, não pra raiz do app interno.
  const falhaPortal = (msg) => res.redirect('/portal.html?entra_error=' + encodeURIComponent(msg));
  const failOrigem = origem === 'portal' ? falhaPortal : fail;

  try {
    const cfg = await pool.query("SELECT config FROM integracoes WHERE tipo = 'entra' AND ativo = true");
    if (!cfg.rows.length) return failOrigem('Entra ID não configurado.');
    const c = cfg.rows[0].config;

    const tokenRes = await fetch(`https://login.microsoftonline.com/${c.tenant_id}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.client_id, client_secret: c.client_secret, code,
        redirect_uri: c.redirect_uri, grant_type: 'authorization_code',
        scope: 'openid profile email',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.error('[Entra] Falha na troca de token:', tokenData.error_description || tokenData.error);
      return failOrigem('Falha ao autenticar com o Microsoft Entra ID.');
    }

    // Valida a assinatura do id_token contra as chaves públicas do tenant (JWKS) —
    // nunca confiar num id_token sem verificar assinatura/issuer/audience.
    const jwksClient = jwksRsa({
      jwksUri: `https://login.microsoftonline.com/${c.tenant_id}/discovery/v2.0/keys`,
      cache: true, cacheMaxAge: 24 * 3600 * 1000, rateLimit: true,
    });
    const decoded = jwt.decode(tokenData.id_token, { complete: true });
    if (!decoded?.header?.kid) return failOrigem('Token inválido recebido do Entra ID.');
    let claims;
    try {
      const signingKey = (await jwksClient.getSigningKey(decoded.header.kid)).getPublicKey();
      claims = jwt.verify(tokenData.id_token, signingKey, {
        algorithms: ['RS256'],
        audience: c.client_id,
        issuer: [`https://login.microsoftonline.com/${c.tenant_id}/v2.0`, `https://sts.windows.net/${c.tenant_id}/`],
      });
    } catch (verErr) {
      console.error('[Entra] id_token com assinatura/claims inválidos:', verErr.message);
      return failOrigem('Token do Entra ID não pôde ser validado.');
    }

    const email = (claims.email || claims.preferred_username || '').toLowerCase();
    const displayName = claims.name || email;
    if (!email) return failOrigem('Conta Microsoft sem e-mail associado.');

    // Portal público: NUNCA grava em usuarios/sessoes nem calcula perfil — o login aqui só
    // confirma "quem é você" pra filtrar a visão pessoal (GET /api/public/genie-cotas).
    // Token de vida curta (8h, uma sessão de trabalho), com claim `portal:true` — o único
    // sinal que o middleware do portal aceita (nunca um token do app interno, e vice-versa).
    if (origem === 'portal') {
      const portalToken = jwt.sign({ email, nome: displayName, portal: true }, JWT_SECRET, { expiresIn: '8h' });
      const handoffPortal = crypto.randomBytes(24).toString('hex');
      _entraHandoffs.set(handoffPortal, { portal: true, token: portalToken, user: { email, nome: displayName }, criadoEm: Date.now() });
      return res.redirect('/portal.html?portal_handoff=' + handoffPortal);
    }

    // Mapeia grupos (Object ID) pra perfil — mesmo padrão de /api/auth/ad. O claim
    // "groups" só vem no id_token se o app registration no Entra tiver "Add groups
    // claim" habilitado; contas em muitos grupos disparam "overage" (Microsoft omite
    // "groups" e devolve "_claim_names"/"hasgroups" em vez disso, exigindo uma chamada
    // extra ao Microsoft Graph com escopo adicional — não implementado). Em ambos os
    // casos sem "groups" utilizável, cai no fallback mais seguro: 'reader'.
    const groups = Array.isArray(claims.groups) ? claims.groups : [];
    let perfil = 'reader';
    if (c.grp_admin && groups.includes(c.grp_admin)) perfil = 'admin';
    else if (c.grp_finops && groups.includes(c.grp_finops)) perfil = 'finops';

    await pool.query(
      "INSERT INTO usuarios (nome, email, perfil, tipo) VALUES ($1,$2,$3,'entra') ON CONFLICT (email) DO UPDATE SET nome=$1, perfil=$3, ativo=true, atualizado_em=NOW()",
      [displayName, email, perfil]
    );
    const u = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    await pool.query('INSERT INTO sessoes (usuario_id, ip, tipo_login) VALUES ($1,$2,$3)', [u.rows[0].id, req.ip, 'entra']);

    const token = jwt.sign({ id: u.rows[0].id, nome: displayName, email, perfil }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const user  = { id: u.rows[0].id, nome: displayName, email, perfil };

    const handoff = crypto.randomBytes(24).toString('hex');
    _entraHandoffs.set(handoff, { token, user, criadoEm: Date.now() });
    res.redirect('/?entra_handoff=' + handoff);
  } catch (err) {
    console.error('[Entra] Erro no callback:', err);
    failOrigem('Erro interno ao autenticar com o Entra ID.');
  }
});

// GET /api/auth/entra/consume — troca o código de handoff de uso único (gerado por
// /auth/callback) pelo { token, user } real. O SPA chama isso uma vez ao detectar
// ?entra_handoff= na query string após o redirect do Microsoft.
app.get('/api/auth/entra/consume', (req, res) => {
  const { code } = req.query;
  _entraCleanup();
  const entry = code && _entraHandoffs.get(code);
  // `entry.portal` nunca deve ser consumido aqui — isolamento nos dois sentidos entre o
  // handoff do app interno e o do portal público (ver /api/public/auth/entra/consume).
  if (!entry || entry.portal) return res.status(400).json({ error: 'Código inválido ou expirado.' });
  _entraHandoffs.delete(code); // uso único
  res.json({ token: entry.token, user: entry.user });
});

// GET /api/public/auth/entra/consume — mesmo padrão de /api/auth/entra/consume, mas só
// aceita handoffs do login PARALELO do portal (entry.portal === true) — nunca um handoff do
// app interno, mesmo que alguém adivinhe o código (uso único de qualquer forma).
app.get('/api/public/auth/entra/consume', (req, res) => {
  const { code } = req.query;
  _entraCleanup();
  const entry = code && _entraHandoffs.get(code);
  if (!entry || !entry.portal) return res.status(400).json({ error: 'Código inválido ou expirado.' });
  _entraHandoffs.delete(code); // uso único
  res.json({ token: entry.token, user: entry.user });
});

app.post('/api/auth/ad/test', authMiddleware, adminMiddleware, async (req, res) => {
  const { server, bind_user, bind_pass } = req.body;
  try {
    const ldap = require('ldapjs');
    const client = ldap.createClient({ url: server, connectTimeout: 6000 });
    client.bind(bind_user, bind_pass, (err) => {
      client.destroy();
      if (err) return res.status(400).json({ ok: false, error: err.message });
      res.json({ ok: true, message: 'Conexao com Active Directory bem-sucedida!' });
    });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Erro interno do servidor.' }); }
});

// ─── USUARIOS ────────────────────────────────────────────────────────────────
app.get('/api/usuarios', authMiddleware, async (req, res) => {
  try {
    res.json((await pool.query('SELECT id, nome, email, perfil, tipo, ativo, ultimo_login, criado_em FROM usuarios ORDER BY nome')).rows);
  } catch (err) { _dbErr(res, err); }
});

app.post('/api/usuarios', authMiddleware, adminMiddleware, async (req, res) => {
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
    _dbErr(res, err);
  }
});

app.put('/api/usuarios/:id', authMiddleware, adminMiddleware, async (req, res) => {
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
    _dbErr(res, err);
  }
});

app.patch('/api/usuarios/:id/ativo', authMiddleware, adminMiddleware, async (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'Campo ativo deve ser booleano' });
  try {
    await pool.query('UPDATE usuarios SET ativo=$1, atualizado_em=NOW() WHERE id=$2', [ativo, req.params.id]);
    res.json({ id: req.params.id, ativo });
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/usuarios/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usuario removido' });
  } catch (err) { _dbErr(res, err); }
});

app.get('/api/permissoes', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, pf.nome AS perfil, p.recurso, p.pode_ler, p.pode_criar, p.pode_editar, p.pode_excluir
      FROM permissoes p JOIN perfis pf ON pf.id = p.perfil_id ORDER BY pf.nome, p.recurso
    `);
    res.json(r.rows);
  } catch (err) { _dbErr(res, err); }
});

// ─── INTEGRACOES ─────────────────────────────────────────────────────────────
// adminMiddleware (2026-08-24): config inclui client_secret (Entra) e credenciais de bind
// (AD) — antes só exigia authMiddleware, então qualquer usuário autenticado podia ler
// esses segredos em texto puro via GET, ou reescrever a configuração via POST.
app.get('/api/integrations', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rows = (await pool.query('SELECT tipo, config, ativo FROM integracoes')).rows;
    // smtp.senha vai cifrada no banco (ao contrário de ad/bind_pass e entra/client_secret,
    // que já ficam em texto puro no JSONB — gap pré-existente, não repetido aqui) — nunca
    // devolve nem o texto puro nem o blob cifrado pro cliente, mesmo padrão de
    // "client_secret nunca volta do GET" já usado em /api/databricks-coleta/config.
    for (const r of rows) if (r.tipo === 'smtp' && r.config?.senha) r.config = { ...r.config, senha: undefined };
    res.json(rows);
  } catch (err) { _dbErr(res, err); }
});

// Bug real corrigido (2026-08-26): era só UPDATE...WHERE tipo=$3 — se a linha não existisse
// ainda em `integracoes` (só ad/entra vinham semeadas no CREATE TABLE), o UPDATE não fazia
// nada e a rota respondia {ok:true} mesmo assim, um no-op silencioso. Corrigido com
// INSERT...ON CONFLICT — funciona pra qualquer tipo novo (ex: smtp) sem precisar semear linha.
app.post('/api/integrations/:tipo', authMiddleware, adminMiddleware, async (req, res) => {
  const { config, ativo } = req.body;
  try {
    // smtp.senha: cifra se veio um valor novo do form; se veio vazio (usuário não trocou a
    // senha ao editar), mantém a que já está salva — mesmo padrão de "client_secret opcional,
    // mantém o atual se vazio" já usado em PUT /api/databricks-coleta/config/:id.
    if (req.params.tipo === 'smtp') {
      if (config.senha) {
        config.senha = _encryptSecret(config.senha);
      } else {
        const atual = await pool.query(`SELECT config FROM integracoes WHERE tipo='smtp'`);
        config.senha = atual.rows[0]?.config?.senha || null;
      }
    }
    await pool.query(
      `INSERT INTO integracoes (tipo, config, ativo) VALUES ($1,$2,$3)
       ON CONFLICT (tipo) DO UPDATE SET config=EXCLUDED.config, ativo=EXCLUDED.ativo, atualizado_em=NOW()`,
      [req.params.tipo, JSON.stringify(config), ativo]
    );
    res.json({ ok: true });
  } catch (err) { _dbErr(res, err); }
});

// Testa credenciais SMTP ainda não salvas (mesmo padrão de POST /api/azure-coleta/sps/:id/testar
// — o erro cru É o propósito da rota) — envia um e-mail de teste pro próprio remetente.
// Timeouts explícitos de 10s por fase (2026-09-02) — mesmo motivo de `_sendEmail`: sem isso, um
// host inalcançável/bloqueado por firewall demora até 2min (default do nodemailer) pra falhar,
// e o frontend já aborta em 30s (`api()`, app.js) — o cliente via só "não respondeu", nunca o
// erro real (ECONNREFUSED/ETIMEDOUT/EAUTH). Também loga a tentativa no mesmo ring buffer que
// `_sendEmail` usa — `GET /integrations/smtp/log` mostra teste e envio real juntos.
app.post('/api/integrations/smtp/testar', authMiddleware, adminMiddleware, async (req, res) => {
  const { host, port, secure, usuario, senha, remetente_email, remetente_nome } = req.body;
  try {
    if (!host || !usuario || !senha || !remetente_email) {
      return res.status(400).json({ error: 'Preencha host, usuário, senha e e-mail do remetente antes de testar.' });
    }
    const transporter = nodemailer.createTransport({
      host, port: parseInt(port, 10) || 587, secure: !!secure,
      auth: { user: usuario, pass: senha },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    await transporter.sendMail({
      from: `"${remetente_nome || 'FinOps Manager'}" <${remetente_email}>`,
      to: remetente_email,
      subject: '✅ Teste de conexão SMTP — FinOps Manager',
      html: _emailTemplate('Teste de conexão', '<p>Se você está lendo isso, a configuração de SMTP está funcionando corretamente.</p>'),
    });
    _logEmailAttempt({ tipo: 'teste', destinatarios: remetente_email, assunto: 'Teste de conexão SMTP', ok: true });
    res.json({ ok: true, message: `E-mail de teste enviado para ${remetente_email}.` });
  } catch (e) {
    _logEmailAttempt({ tipo: 'teste', destinatarios: remetente_email, assunto: 'Teste de conexão SMTP', ok: false, erro: e.message });
    res.status(400).json({ error: e.message });
  }
});

// Log das últimas tentativas de e-mail (teste manual + envios reais) — ring buffer em memória,
// ver `_logEmailAttempt` acima. Serve a UI de Integrações (card SMTP) pra diagnosticar sem
// precisar de acesso a `pm2 logs`.
app.get('/api/integrations/smtp/log', authMiddleware, adminMiddleware, async (_req, res) => {
  res.json(_emailLog);
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
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
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
  const { tipo = 'postgresql', host, porta, database, usuario, senha, ssl } = req.body;
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
    _dbErr(res, err);
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
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
});

// ─── PROJETOS ────────────────────────────────────────────────────────────────
app.get('/api/projetos', authMiddleware, dbMiddleware, async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM projetos ORDER BY nome')).rows); }
  catch (err) { _dbErr(res, err); }
});

app.get('/api/projetos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM projetos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Projeto nao encontrado' });
    res.json(r.rows[0]);
  } catch (err) { _dbErr(res, err); }
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
    _dbErr(res, err);
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
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/projetos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM projetos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Projeto removido' });
  } catch (err) { _dbErr(res, err); }
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

    // Notificações de coletas recentes (48h)
    try {
      const rSis = await pool.query(
        `SELECT id, tipo, titulo, mensagem, destino, destino_params, criado_em FROM notificacoes_sistema WHERE expira_em > NOW() ORDER BY criado_em DESC LIMIT 20`
      );
      rSis.rows.forEach(n => {
        notifs.push({
          _kind:       'sistema',
          _id:         n.id,
          tipo:        n.tipo,
          acao:        n.titulo,
          mensagem:    n.mensagem || '',
          destino:     n.destino || null,
          destino_params: n.destino_params || null,
          id_finops:   '',
          projeto_nome: null,
          diffDias:    -9999,
          criado_em:   n.criado_em,
        });
      });
    } catch (_) {}

    notifs.sort((a, b) => {
      if (a._kind === 'sistema' && b._kind !== 'sistema') return 1;
      if (b._kind === 'sistema' && a._kind !== 'sistema') return -1;
      return a.diffDias - b.diffDias;
    });
    res.json(notifs);
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
});

app.get('/api/acoes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT a.*, p.nome AS projeto_nome FROM acoes_finops a LEFT JOIN projetos p ON a.projeto_id = p.id WHERE a.id = $1',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Acao nao encontrada' });
    res.json(r.rows[0]);
  } catch (err) { _dbErr(res, err); }
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
    _dbErr(res, err);
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
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/acoes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM acoes_finops WHERE id = $1', [req.params.id]);
    res.json({ message: 'Acao removida' });
  } catch (err) { _dbErr(res, err); }
});

// ─── ESTIMATIVAS ─────────────────────────────────────────────────────────────
app.get('/api/estimativas', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    // recursos excluído propositalmente — pode ser MB de JSON por estimativa
    // O detalhe completo (com recursos) só é carregado em GET /api/estimativas/:id
    const r = await pool.query(`
      SELECT e.id, e.projeto_id, e.projeto_nome, e.numero, e.titulo, e.responsavel,
             e.validade_dias, e.data_estimativa, e.horas,
             e.pct_imposto, e.pct_cond, e.vl_imposto, e.vl_cond,
             e.total_brl, e.total_final, e.observacoes, e.status,
             e.criado_em, e.atualizado_em,
             p.nome AS projeto_nome_atual
      FROM estimativas e
      LEFT JOIN projetos p ON p.id = e.projeto_id
      ORDER BY e.criado_em DESC
    `);
    res.json(r.rows);
  } catch (err) { _dbErr(res, err); }
});

app.get('/api/estimativas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM estimativas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
});

app.put('/api/estimativas/:id/status', authMiddleware, dbMiddleware, async (req, res) => {
  const { status } = req.body;
  const allowed = ['Pendente', 'Aprovado', 'Nao Aprovado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const r = await pool.query(
      'UPDATE estimativas SET status = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrada' });
    res.json(r.rows[0]);
    _alertarEstimativaStatus(r.rows[0]).catch(() => {});
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/estimativas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM estimativas WHERE id = $1', [req.params.id]);
    res.json({ message: 'Estimativa removida' });
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
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

  // 1) Criar tabela se não existir — única operação síncrona (fast se já existe)
  await pool.query(`
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

  // Marca como pronto imediatamente — migrações e índices rodam em background
  // para não bloquear o startup (ALTER TABLE precisa de lock exclusivo)
  _azureTableReady = true;

  // Verifica índices existentes (fast — pg_indexes é catálogo, sem scan)
  const { rows: idxExist } = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'azure_costs'
  `);
  const idxSet = new Set(idxExist.map(r => r.indexname));
  console.log(`[Azure] Tabela azure_costs pronta ✅ (${idxSet.size} índices existentes — novos criados em background)`);

    // 5) Criar índices em background (não bloqueia o startup)
    // Cada índice é criado separado para não travar o pool com uma única query longa
    const _bgIdx = async () => {
      if (!pool) return;
      const bg = (sql, name) => {
        if (idxSet.has(name)) return Promise.resolve(); // já existe — skip
        console.log(`[DB] Criando ${name}...`);
        return pool.query(sql)
          .then(() => console.log(`[DB] ${name} ✅`))
          .catch(e => console.warn(`[DB] ${name}:`, e.message.slice(0, 80)));
      };
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_date         ON azure_costs(cost_date)`, 'idx_azure_costs_date');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_sub          ON azure_costs(subscription_id)`, 'idx_azure_costs_sub');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_rg           ON azure_costs(resource_group_name)`, 'idx_azure_costs_rg');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_service      ON azure_costs(consumed_service)`, 'idx_azure_costs_service');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_meter_cat    ON azure_costs(meter_category)`, 'idx_azure_costs_meter_cat');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_resource_id  ON azure_costs(resource_id)`, 'idx_azure_costs_resource_id');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_resource_id_upper ON azure_costs(UPPER(resource_id))`, 'idx_azure_costs_resource_id_upper');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_importado    ON azure_costs(importado_em)`, 'idx_azure_costs_importado');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_rg       ON azure_costs(subscription_id, resource_group_name)`, 'idx_azure_costs_sub_rg');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_date     ON azure_costs(subscription_id, cost_date)`, 'idx_azure_costs_sub_date');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_rg_upper     ON azure_costs(UPPER(resource_group_name))`, 'idx_azure_costs_rg_upper');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_rg_upper ON azure_costs(subscription_id, UPPER(resource_group_name))`, 'idx_azure_costs_sub_rg_upper');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_rg_date  ON azure_costs(subscription_id, UPPER(resource_group_name), cost_date)`, 'idx_azure_costs_sub_rg_date');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_charge_type   ON azure_costs(charge_type)`, 'idx_azure_costs_charge_type');
      await bg(`CREATE INDEX IF NOT EXISTS idx_azure_costs_pricing_model ON azure_costs(pricing_model)`, 'idx_azure_costs_pricing_model');
      // GIN trgm — requer superuser em alguns ambientes
      try {
        if (!idxSet.has('idx_azure_costs_uom_trgm')) {
          await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_costs_uom_trgm ON azure_costs USING GIN (unit_of_measure gin_trgm_ops)`);
          console.log('[DB] idx_azure_costs_uom_trgm (GIN) ✅');
        }
      } catch (e) { console.warn('[DB] pg_trgm não disponível:', e.message.slice(0,60)); }
      // Dedup unique — necessário para ON CONFLICT nos imports
      if (!idxSet.has('idx_azure_costs_dedup')) {
        try {
          const oldIdx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename='azure_costs' AND indexname='idx_azure_costs_dedup'`);
          if (oldIdx.rowCount > 0 && !oldIdx.rows[0].indexdef.includes('COALESCE(subscription_id')) {
            console.log('[Azure] Migrando índice de deduplicação...');
            await pool.query(`DROP INDEX IF EXISTS idx_azure_costs_dedup`);
          }
          await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_azure_costs_dedup ON azure_costs(COALESCE(subscription_id,''),COALESCE(resource_id,''),cost_date,COALESCE(meter_id,''),COALESCE(charge_type,''),COALESCE(quantity,0))`);
          console.log('[Azure] idx_azure_costs_dedup ✅');
        } catch (e) { console.warn('[Azure] idx_azure_costs_dedup:', e.message.slice(0,80)); }
      }
    };
    setTimeout(_bgIdx, 5 * 1000); // 5s delay para não competir com o primeiro request
}

// ── Cache de dropdowns (subscriptions + resource groups) ─────────────────────
// Tabelas pequenas pré-calculadas — atualizadas após cada import.
// Evita GROUP BY em toda a azure_costs a cada abertura da calculadora.
let _cacheRefreshing = false;
let _coberturaCache = null;
let _coberturaCacheTs = 0;
const _COBERTURA_TTL = 5 * 60 * 1000;
let _resumoCache = null;
let _resumoCacheTs = 0;
let _importsCache = null;
let _importsCacheTs = 0;
const _RESUMO_TTL = 5 * 60 * 1000;

// Custo + contagem de recursos por Resource Group (2026-08-31) — usado pelo fallback "custo
// do RG inteiro" do Inventário (lista de Recursos, modal de detalhe, e a vista "Por
// Assinatura"). Bug real de performance encontrado testando contra dados reais: `SUM(...)
// WHERE subscription_id AND UPPER(resource_group_name)` pra UM RG grande (Databricks, alta
// rotatividade) levou 17-23s — um `SUM`/`COUNT(DISTINCT)` precisa varrer TODAS as linhas
// daquele RG, sem atalho possível (diferente do SKU, que só precisa de 1 linha qualquer).
// Corrigido pré-computando custo+contagem de TODOS os RGs de uma vez (1 scan completo de
// `azure_costs`, resultado pequeno — só ~385 RGs no ambiente real) e cacheando em memória,
// mesmo padrão/TTL já usado por `_coberturaCache`/`_resumoCache`/`_importsCache` — depois
// disso, cada request é um lookup O(1) no Map, sem tocar o Postgres.
let _rgStatsCache = null; // Map<'subscription_id::RG_UPPER', { custo:number, recursos:number }>
let _rgStatsCacheTs = 0;
// Bug real de concorrência encontrado testando contra dados reais: sem dedup, 2-3 requests
// chegando com o cache vazio/expirado ao mesmo tempo disparavam cada uma o SEU PRÓPRIO scan
// completo de `azure_costs` (1,45M linhas) em paralelo — o build "frio" que já era caro
// (~20-90s, comparável a `_refreshAzureCache`) ficou 209s com 3 scans competindo por
// I/O/buffers ao mesmo tempo, muito pior que rodar 1 só. `_rgStatsCachePromise` guarda o
// build EM ANDAMENTO — qualquer chamada concorrente espera essa mesma promise em vez de
// iniciar outro scan.
let _rgStatsCachePromise = null;
// 2026-09-25: com `azure_costs` em ~7,8M linhas, essa agregação leva 75s a +300s (medido) — bem além
// dos 30s da tela, que mostrava "Recurso não encontrado" no detalhe e travava a lista de Recursos.
// Agora NUNCA roda no caminho da requisição: o resultado fica numa tabela pequena (`azure_rg_stats`) e em
// memória; quando envelhece, é recalculado em SEGUNDO PLANO enquanto a tela usa o último valor.
// Só a primeiríssima vez (tabela vazia) devolve mapa vazio até o cálculo terminar.
const _RG_STATS_TTL = 6 * 60 * 60 * 1000;
const _RG_STATS_MIN_INTERVALO = 30 * 60 * 1000; // nunca reconstrói mais de 1x a cada 30 min
let _rgStatsUltimoInicio = 0;

async function _carregarRgStatsDaTabela() {
  try {
    const r = await pool.query(`SELECT subscription_id, rg, custo_microsoft, custo_marketplace, recursos, atualizado_em FROM azure_rg_stats`);
    const map = new Map();
    let ts = 0;
    for (const row of r.rows) {
      map.set(row.subscription_id + '::' + row.rg, {
        custo_microsoft: parseFloat(row.custo_microsoft) || 0,
        custo_marketplace: parseFloat(row.custo_marketplace) || 0,
        recursos: parseInt(row.recursos, 10),
      });
      ts = Math.max(ts, new Date(row.atualizado_em).getTime());
    }
    return { map, ts };
  } catch (_) { return { map: new Map(), ts: 0 }; } // tabela ainda não existe
}

function _reconstruirRgStats() {
  if (_rgStatsCachePromise) return _rgStatsCachePromise;
  _rgStatsUltimoInicio = Date.now();
  _rgStatsCachePromise = (async () => {
    try {
      const t0 = Date.now();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS azure_rg_stats (
          subscription_id VARCHAR(200) NOT NULL, rg TEXT NOT NULL,
          custo_microsoft NUMERIC NOT NULL DEFAULT 0, custo_marketplace NUMERIC NOT NULL DEFAULT 0,
          recursos INTEGER NOT NULL DEFAULT 0,
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (subscription_id, rg)
        )`);
      await pool.query(`ALTER TABLE azure_rg_stats ADD COLUMN IF NOT EXISTS custo_microsoft   NUMERIC NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE azure_rg_stats ADD COLUMN IF NOT EXISTS custo_marketplace NUMERIC NOT NULL DEFAULT 0`);
      // Só SUM no billing (a parte pesada). A contagem de "recursos diferentes" vem do Inventário
      // (todos os IDs já vistos no RG, ativos ou não) — COUNT(DISTINCT resource_id) em azure_costs passa de 300s.
      const custos = await pool.query(`
        SELECT subscription_id, UPPER(resource_group_name) AS rg,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
        FROM azure_costs WHERE resource_group_name IS NOT NULL GROUP BY 1, 2`);
      const contagem = await pool.query(`
        SELECT subscription_id, UPPER(resource_group) AS rg, COUNT(*) AS recursos
        FROM azure_recursos_inventario WHERE resource_group IS NOT NULL GROUP BY 1, 2`);
      const nRec = new Map(contagem.rows.map((x) => [x.subscription_id + '::' + x.rg, parseInt(x.recursos, 10)]));
      const map = new Map();
      for (const row of custos.rows) {
        const chave = row.subscription_id + '::' + row.rg;
        map.set(chave, {
          custo_microsoft: parseFloat(row.custo_microsoft) || 0,
          custo_marketplace: parseFloat(row.custo_marketplace) || 0,
          recursos: nRec.get(chave) || 0,
        });
      }
      // Grava substituindo tudo, numa transação (a tela nunca lê uma tabela pela metade).
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM azure_rg_stats');
        const subs = [], rgs = [], cms = [], cmps = [], rc = [];
        for (const [k, v] of map) {
          const i = k.indexOf('::');
          subs.push(k.slice(0, i)); rgs.push(k.slice(i + 2));
          cms.push(v.custo_microsoft); cmps.push(v.custo_marketplace); rc.push(v.recursos);
        }
        for (let i = 0; i < subs.length; i += 5000) {
          await c.query(
            `INSERT INTO azure_rg_stats (subscription_id, rg, custo_microsoft, custo_marketplace, recursos)
             SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::int[])`,
            [subs.slice(i, i + 5000), rgs.slice(i, i + 5000), cms.slice(i, i + 5000), cmps.slice(i, i + 5000), rc.slice(i, i + 5000)]
          );
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      _rgStatsCache = map;
      _rgStatsCacheTs = Date.now();
      console.log(`[Inventario] Custo por RG recalculado em ${Math.round((Date.now() - t0) / 1000)}s (${map.size} RGs)`);
      return map;
    } catch (e) {
      console.warn('[Inventario] Falha ao recalcular custo por RG:', e.message);
      return _rgStatsCache || new Map();
    } finally {
      _rgStatsCachePromise = null;
    }
  })();
  return _rgStatsCachePromise;
}

// Nunca espera o cálculo pesado: devolve o último valor conhecido (memória → tabela → vazio) e, se
// estiver velho, dispara a reconstrução em segundo plano.
async function _getRgStatsCache() {
  if (!_rgStatsCache) {
    const { map, ts } = await _carregarRgStatsDaTabela();
    if (map.size) { _rgStatsCache = map; _rgStatsCacheTs = ts; }
  }
  const velho = !_rgStatsCache || (Date.now() - _rgStatsCacheTs) > _RG_STATS_TTL;
  if (velho && !_rgStatsCachePromise && (!_rgStatsCache || Date.now() - _rgStatsUltimoInicio > _RG_STATS_MIN_INTERVALO)) {
    _reconstruirRgStats().catch(() => {});
  }
  return _rgStatsCache || new Map();
}
async function _refreshAzureCache() {
  if (!pool || _cacheRefreshing) return;
  _cacheRefreshing = true;
  const t0 = Date.now();
  try {
    // Garante que as tabelas de cache existem
    await pool.query(`
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
        resource_group_name       VARCHAR(500),
        moeda                     VARCHAR(20),
        PRIMARY KEY (subscription_id, resource_group_name_upper)
      );
      ALTER TABLE azure_rg_cache ADD COLUMN IF NOT EXISTS resource_group_name VARCHAR(500);
      CREATE TABLE IF NOT EXISTS azure_cobertura_cache (
        mes               VARCHAR(10),
        subscription_id   VARCHAR(200),
        subscription_name VARCHAR(500),
        registros         INT,
        dias_com_dados    INT,
        dias_no_mes       INT,
        ultima_importacao VARCHAR(20),
        custo_microsoft   NUMERIC(20,2) DEFAULT 0,
        custo_marketplace NUMERIC(20,2) DEFAULT 0,
        atualizado_em     TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (mes, subscription_id)
      );
      CREATE TABLE IF NOT EXISTS azure_ws_cache (
        ws_name   TEXT PRIMARY KEY,
        parent_rg TEXT NOT NULL
      );
    `);
    // Split Microsoft/Marketplace (2026-09-29) em azure_cobertura_cache — tabela já existente
    // ganha as colunas zeradas; o próximo _refreshAzureCache() preenche de verdade.
    await pool.query(`ALTER TABLE azure_cobertura_cache ADD COLUMN IF NOT EXISTS custo_microsoft   NUMERIC(20,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE azure_cobertura_cache ADD COLUMN IF NOT EXISTS custo_marketplace NUMERIC(20,2) DEFAULT 0`);

    // Diagnóstico rápido via pg_stat_user_tables (sem scan — usa estatísticas do autovacuum)
    try {
      const { rows: [stat] } = await pool.query(`
        SELECT n_live_tup AS total, n_dead_tup AS mortos
        FROM pg_stat_user_tables WHERE relname = 'azure_costs'
      `);
      if (stat) console.log(`[Azure Cache] azure_costs: ~${stat.total} linhas (pg_stat, mortos: ${stat.mortos}) | pool: ${pool.totalCount} total / ${pool.idleCount} idle / ${pool.waitingCount} waiting`);
    } catch (_) {}

    // Helper: abre conexão dedicada, habilita workers paralelos e roda uma query pesada
    const _queryParalelo = async (sql) => {
      const conn = await pool.connect();
      let queryErr;
      try {
        await conn.query('SET max_parallel_workers_per_gather = 4');
        const { rows } = await conn.query(sql);
        return rows;
      } catch (e) {
        queryErr = e;
        throw e;
      } finally {
        // Sinaliza conexão como inválida em caso de erro — evita ECONNRESET no pool
        conn.release(queryErr);
      }
    };

    // 4 scans pesados em PARALELO — cada um em sua própria conexão
    console.log('[Azure] Iniciando 4 agregações em paralelo...');
    const [subRows, rgRows, cobRows, wsRows] = await Promise.all([
      _queryParalelo(`
        SELECT subscription_id,
               MAX(subscription_name) AS subscription_name,
               MIN(cost_date)::text   AS periodo_inicio,
               MAX(cost_date)::text   AS periodo_fim,
               MIN(billing_currency)  AS moeda
        FROM azure_costs
        WHERE subscription_id IS NOT NULL AND subscription_id <> ''
        GROUP BY subscription_id
      `),
      _queryParalelo(`
        SELECT subscription_id,
               UPPER(resource_group_name) AS resource_group_name_upper,
               MAX(resource_group_name)   AS resource_group_name,
               MIN(billing_currency)      AS moeda
        FROM azure_costs
        WHERE subscription_id IS NOT NULL AND subscription_id <> ''
          AND resource_group_name IS NOT NULL AND resource_group_name <> ''
        GROUP BY subscription_id, UPPER(resource_group_name)
      `),
      _queryParalelo(`
        SELECT mes, subscription_id, subscription_name,
               SUM(registros_dia)::int                    AS registros,
               COUNT(*)::int                              AS dias_com_dados,
               MAX(dias_no_mes)                           AS dias_no_mes,
               MAX(ultima_importacao)                     AS ultima_importacao,
               ROUND(SUM(custo_microsoft)::numeric, 2)    AS custo_microsoft,
               ROUND(SUM(custo_marketplace)::numeric, 2)  AS custo_marketplace
        FROM (
          SELECT
            TO_CHAR(DATE_TRUNC('month', cost_date), 'YYYY-MM-DD')   AS mes,
            cost_date,
            subscription_id,
            COALESCE(MAX(subscription_name), subscription_id)        AS subscription_name,
            COUNT(*)::int                                             AS registros_dia,
            ((DATE_TRUNC('month', cost_date) + INTERVAL '1 month')::date
              - DATE_TRUNC('month', cost_date)::date)                 AS dias_no_mes,
            TO_CHAR(MAX(importado_em), 'DD/MM/YYYY HH24:MI')        AS ultima_importacao,
            SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
            SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
          FROM azure_costs
          WHERE cost_date >= NOW() - INTERVAL '36 months'
            AND subscription_id IS NOT NULL AND subscription_id <> ''
          GROUP BY 1, 2, 3
        ) daily
        GROUP BY mes, subscription_id, subscription_name
        ORDER BY 1 DESC, registros DESC
      `),
      // Databricks workspace → parent RG (usa índice idx_azure_costs_service — match exato)
      _queryParalelo(`
        SELECT UPPER(resource_group_name) AS rg_upper,
               SPLIT_PART(SPLIT_PART(resource_id, '/workspaces/', 2), '/', 1) AS ws
        FROM azure_costs
        WHERE consumed_service IN ('Microsoft.Databricks','microsoft.databricks')
        GROUP BY 1, 2
        HAVING SPLIT_PART(SPLIT_PART(resource_id, '/workspaces/', 2), '/', 1) <> ''
      `).catch(() => [])
    ]);

    // Grava nas tabelas de cache via UNNEST (batch único, sem loop)
    const cw = await pool.connect();
    try {
      await cw.query('BEGIN');
      await cw.query('DELETE FROM azure_subs_cache');
      if (subRows.length) {
        await cw.query(
          `INSERT INTO azure_subs_cache (subscription_id, subscription_name, periodo_inicio, periodo_fim, moeda)
           SELECT * FROM UNNEST($1::text[],$2::text[],$3::date[],$4::date[],$5::text[])`,
          [
            subRows.map(r => r.subscription_id),
            subRows.map(r => r.subscription_name || null),
            subRows.map(r => r.periodo_inicio || null),
            subRows.map(r => r.periodo_fim     || null),
            subRows.map(r => r.moeda           || null)
          ]
        );
      }
      await cw.query('DELETE FROM azure_rg_cache');
      if (rgRows.length) {
        await cw.query(
          `INSERT INTO azure_rg_cache (subscription_id, resource_group_name_upper, resource_group_name, moeda)
           SELECT * FROM UNNEST($1::text[],$2::text[],$3::text[],$4::text[])`,
          [
            rgRows.map(r => r.subscription_id),
            rgRows.map(r => r.resource_group_name_upper),
            rgRows.map(r => r.resource_group_name || r.resource_group_name_upper),
            rgRows.map(r => r.moeda || null)
          ]
        );
      }
      // Persiste cobertura no banco — sobrevive a restarts
      if (cobRows.length) {
        await cw.query('DELETE FROM azure_cobertura_cache');
        await cw.query(
          `INSERT INTO azure_cobertura_cache
             (mes, subscription_id, subscription_name, registros, dias_com_dados, dias_no_mes, ultima_importacao, custo_microsoft, custo_marketplace)
           SELECT * FROM UNNEST($1::text[],$2::text[],$3::text[],$4::int[],$5::int[],$6::int[],$7::text[],$8::numeric[],$9::numeric[])`,
          [
            cobRows.map(r => r.mes),
            cobRows.map(r => r.subscription_id),
            cobRows.map(r => r.subscription_name || null),
            cobRows.map(r => r.registros),
            cobRows.map(r => r.dias_com_dados),
            cobRows.map(r => r.dias_no_mes),
            cobRows.map(r => r.ultima_importacao || null),
            cobRows.map(r => r.custo_microsoft || 0),
            cobRows.map(r => r.custo_marketplace || 0)
          ]
        );
      }
      await cw.query('COMMIT');
    } catch (e) {
      await cw.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      cw.release();
    }

    _coberturaCache   = cobRows;
    _coberturaCacheTs = Date.now();
    _resumoCache      = null;
    _importsCache     = null;
    // Popula e persiste cache do lookup Databricks (evita query por-request em 10M+ linhas)
    const wsFiltered = wsRows.filter(r => r.ws);
    if (wsFiltered.length) {
      // Upsert em vez de DELETE+INSERT: preserva entradas MANAGED-RG-* persistidas por _resolveParentRgs
      pool.query(
        `INSERT INTO azure_ws_cache (ws_name, parent_rg) SELECT * FROM UNNEST($1::text[], $2::text[])
         ON CONFLICT (ws_name) DO UPDATE SET parent_rg = EXCLUDED.parent_rg`,
        [wsFiltered.map(r => r.ws), wsFiltered.map(r => r.rg_upper)]
      ).catch(() => {});
      // Merge no cache em memória: adiciona novos workspaces sem apagar entradas MANAGED-RG-*
      const existing = _dbWsCache || new Map();
      for (const r of wsFiltered) existing.set(r.ws, r.rg_upper);
      _dbWsCache = existing;
      _dbWsCacheTs = Date.now();
    }
    console.log(`[Azure] Cache atualizado em ${Date.now()-t0}ms ✅ — ${subRows.length} subs · ${rgRows.length} RGs · ${cobRows.length} meses · ${wsRows.length} ws Databricks`);
  } catch (err) {
    console.error(`[Azure] Erro ao atualizar cache: ${err.message} | pool: ${pool?.totalCount}/${pool?.idleCount}/${pool?.waitingCount} (total/idle/waiting)`);
  } finally {
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
  const pq = (sql) => pool.query(sql);
  try {
    await pq(`
      CREATE TABLE IF NOT EXISTS azure_price_list (
        meter_id         VARCHAR(200)  NOT NULL,
        currency_code    VARCHAR(10)   NOT NULL DEFAULT 'BRL',
        arm_region_name  VARCHAR(100)  NOT NULL DEFAULT 'brazilsouth',
        retail_price     NUMERIC(20,10),
        retail_price_brl NUMERIC(20,10),
        unit_price       NUMERIC(20,10),
        unit_of_measure  VARCHAR(100),
        product_name     VARCHAR(500),
        sku_name         VARCHAR(500),
        service_family   VARCHAR(200),
        meter_name         VARCHAR(500),
        meter_category     VARCHAR(200),
        meter_sub_category VARCHAR(200),
        type             VARCHAR(50),
        reservation_term VARCHAR(20) NOT NULL DEFAULT '',
        effective_start  DATE,
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (meter_id, currency_code, arm_region_name, type, reservation_term)
      );
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter        ON azure_price_list (meter_id);
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter_lower  ON azure_price_list (LOWER(meter_id));
      CREATE INDEX IF NOT EXISTS idx_pricelist_service      ON azure_price_list (service_family);
      CREATE INDEX IF NOT EXISTS idx_pricelist_region       ON azure_price_list (arm_region_name);
      CREATE INDEX IF NOT EXISTS idx_pricelist_type         ON azure_price_list (type);
      CREATE TABLE IF NOT EXISTS azure_price_list_meta (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // ── Índices funcionais (idempotentes) ────────────────────────────────────
    await pq(`
      ALTER TABLE azure_price_list ADD COLUMN IF NOT EXISTS retail_price_brl NUMERIC(20,10);
      ALTER TABLE azure_price_list ADD COLUMN IF NOT EXISTS meter_name VARCHAR(500);
      ALTER TABLE azure_price_list ADD COLUMN IF NOT EXISTS meter_category VARCHAR(200);
      ALTER TABLE azure_price_list ADD COLUMN IF NOT EXISTS meter_sub_category VARCHAR(200);
      ALTER TABLE azure_price_list DROP COLUMN IF EXISTS service_name;
      CREATE INDEX IF NOT EXISTS idx_pricelist_meter_lower ON azure_price_list (LOWER(meter_id));
      CREATE INDEX IF NOT EXISTS idx_pricelist_type        ON azure_price_list (type);

      -- Partial index meter_id — cobre pl_best (match primário)
      CREATE INDEX IF NOT EXISTS idx_pricelist_join
        ON azure_price_list (LOWER(meter_id))
        WHERE type IN ('Consumption','DevTestConsumption') AND reservation_term = '';

      -- Partial index sku+service — cobre pl_sku (fallback por nome)
      CREATE INDEX IF NOT EXISTS idx_pricelist_sku_svc
        ON azure_price_list (LOWER(sku_name), LOWER(service_family))
        WHERE type IN ('Consumption','DevTestConsumption') AND reservation_term = '';
    `).catch(() => {});

    // Nota: as materialized views pl_best_mv/pl_sku_mv (JOIN azure_costs × Price List
    // pra sugerir desconto/preço de tabela nos cards da Calculadora) foram removidas
    // daqui — confirmado por auditoria (grep) que nenhuma query em todo o server.js as
    // lê mais desde que a UI de Price List na Calculadora saiu na v2.1 ("fonte_estimado"
    // é sempre 'billing' agora). Antes desta limpeza, elas continuavam sendo dropadas e
    // recriadas a cada startup, e recalculadas (REFRESH MATERIALIZED VIEW CONCURRENTLY)
    // a cada sync do Price List — trabalho de banco puro desperdício, sem nenhum
    // consumidor. A tabela azure_price_list em si continua intacta (import/sync/diag
    // seguem funcionando normalmente).
    _priceListReady = true;
    console.log('[PriceList] Tabela pronta ✅');
  } catch (err) {
    console.warn('[PriceList] Erro ao criar tabela:', err.message);
  }
}

// ── Circuit Breaker — Azure Retail Prices API ──────────────────────────────────
// Separado do CB da Coleta para não contaminar estados independentes.
// Abre após 3 falhas consecutivas; fica bloqueado 10 min; então tenta HALF_OPEN.
const _PL_CB_MAX_FAILURES = 3;
const _PL_CB_OPEN_MS      = 10 * 60 * 1000; // 10 min
let _plCB = { state: 'CLOSED', failures: 0, openUntil: null };

function _plCbCanAttempt() {
  if (_plCB.state === 'CLOSED' || _plCB.state === 'HALF_OPEN') return true;
  // OPEN — verifica se a janela de bloqueio expirou
  if (_plCB.openUntil && Date.now() >= _plCB.openUntil) {
    _plCB.state = 'HALF_OPEN';
    console.log('[PriceList CB] Estado → HALF_OPEN (janela expirou, testando)');
    return true;
  }
  return false;
}

function _plCbSuccess() {
  if (_plCB.state !== 'CLOSED') {
    console.log('[PriceList CB] Estado → CLOSED (recuperado)');
  }
  _plCB.state    = 'CLOSED';
  _plCB.failures = 0;
  _plCB.openUntil = null;
}

function _plCbFailure() {
  if (_plCB.state === 'HALF_OPEN') {
    // Falhou na sondagem — reabrir imediatamente
    _plCB.openUntil = Date.now() + _PL_CB_OPEN_MS;
    _plCB.state     = 'OPEN';
    console.warn(`[PriceList CB] Estado → OPEN (HALF_OPEN falhou, bloqueando por ${_PL_CB_OPEN_MS / 60000} min)`);
    return;
  }
  _plCB.failures++;
  if (_plCB.failures >= _PL_CB_MAX_FAILURES) {
    _plCB.openUntil = Date.now() + _PL_CB_OPEN_MS;
    _plCB.state     = 'OPEN';
    console.warn(`[PriceList CB] Estado → OPEN (${_plCB.failures} falhas consecutivas, bloqueando por ${_PL_CB_OPEN_MS / 60000} min)`);
  }
}

// Busca uma URL e retorna JSON — usado para paginar a Retail Prices API
function _fetchJson(url, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, { headers: { Accept: 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => { chunks.push(chunk); });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        // 429 — Rate limit da Azure (resposta em texto puro, não JSON)
        if (res.statusCode === 429) {
          const retryAfter = parseInt(res.headers['retry-after'] || '60', 10) || 60;
          const err = new Error(
            `Rate limit atingido (HTTP 429) pela Azure Retail Prices API. Aguarde ${retryAfter}s e tente novamente.`
          );
          err.code = 429;
          err.retryAfter = retryAfter;
          return reject(err);
        }
        // Qualquer outro status não-2xx
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(
            `Azure Retail Prices API retornou HTTP ${res.statusCode}: ${data.slice(0, 200)}`
          ));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON inválido na Retail Prices API: ' + e.message + ' — primeiros 200 chars: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', err => { err.code = err.code || 'NETWORK_ERROR'; reject(err); });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      const err = new Error(`Timeout na Retail Prices API (${timeoutMs / 1000}s)`);
      err.code = 'TIMEOUT';
      reject(err);
    });
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

// Busca uma página da Retail Prices API com retry automático + circuit breaker
async function _fetchPriceListPage(urlOrFilter, maxRetries = 5) {
  // Verifica CB antes de qualquer tentativa
  if (!_plCbCanAttempt()) {
    const bloqueadoAte = _plCB.openUntil
      ? new Date(_plCB.openUntil).toLocaleTimeString('pt-BR')
      : '?';
    throw new Error(`Circuit Breaker OPEN — Retail Prices API bloqueada até ${bloqueadoAte}. Tente novamente em ${Math.ceil((_plCB.openUntil - Date.now()) / 60000)} min.`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Timeout cresce com as tentativas: 90s → 120s → 150s → 180s → 210s
      const timeoutMs = 90000 + (attempt - 1) * 30000;
      const data = await _fetchJson(urlOrFilter, timeoutMs);
      // Sucesso — notifica CB (reseta contador ou fecha HALF_OPEN)
      _plCbSuccess();
      return { items: data.Items || [], nextLink: data.NextPageLink || null };
    } catch (err) {
      // HTTP 400 "Skip value N is greater than total count N" → fim de paginação
      // A API retorna 400 quando $skip == totalCount (deveria retornar lista vazia)
      if (err.message && /Skip value \d+ is greater than/i.test(err.message)) {
        console.log('[PriceList] Fim de paginação detectado (skip >= total) — sync concluído.');
        _plCbSuccess();
        return { items: [], nextLink: null };
      }
      const isRetryable = err.code === 429 || err.code === 'TIMEOUT'
        || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'NETWORK_ERROR';

      if (isRetryable && attempt < maxRetries) {
        let wait;
        if (err.code === 429) {
          // Respeita Retry-After; se não houver, cresce: 60s → 90s → 120s → 150s
          const base = err.retryAfter > 0 ? err.retryAfter : 60;
          wait = (base + (attempt - 1) * 30) * 1000;
          console.warn(`[PriceList] Rate limit 429 — aguardando ${wait / 1000}s (tentativa ${attempt}/${maxRetries})...`);
        } else {
          wait = attempt * 15000; // backoff 15s, 30s, 45s...
          console.warn(`[PriceList] ${err.code} — aguardando ${wait / 1000}s antes de nova tentativa (${attempt}/${maxRetries})...`);
        }
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      // Esgotou tentativas ou erro não-retryable — registra falha no CB
      // 429 não conta como falha de infraestrutura (é throttling esperado)
      if (err.code !== 429) _plCbFailure();
      throw err;
    }
  }
}

function _buildPriceListUrl(currency) {
  // Sem filtro de região — busca todos os meters disponíveis globalmente.
  // arm_region_name é salvo por item (campo armRegionName da API).
  // pl_best/pl_sku priorizam brazilsouth via ORDER BY.
  return `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&currencyCode=${currency}&$filter=type eq 'Consumption'`;
}

async function _syncPriceList(requestedCurrency = 'USD') {
  if (_syncingPriceList) return { ok: false, msg: 'Sincronização já em andamento' };
  _syncingPriceList = true;
  _syncProgress = { pages: 0, total: 0, started: new Date().toISOString(), error: null, finished: null };

  let total = 0, pages = 0;
  const resultKey = 'last_result_USD_global';

  try {
    await ensurePriceListTable();

    const currency = 'USD';
    console.log(`[PriceList] Iniciando sync — todos os meters (sem filtro de região), currency: ${currency}`);

    // Busca primeira página para validar conectividade
    const probe = await _fetchPriceListPage(_buildPriceListUrl(currency));
    console.log(`[PriceList] Primeira página → ${probe.items.length} item(s)`);

    if (probe.items.length === 0) {
      throw new Error('Nenhum dado retornado pela Azure Retail Prices API. Verifique conectividade com prices.azure.com');
    }

    // TRUNCATE isolado e rápido — de propósito FORA de qualquer transação de longa duração.
    // Bug real corrigido aqui (2026-10-03, incidente em produção): a versão anterior fazia
    // BEGIN/TRUNCATE/COMMIT numa ÚNICA transação que só fechava no fim da sincronização
    // inteira — com o rate limit pesado da Retail Prices API (muitos 429, backoff de até
    // 150s por tentativa), isso podia segurar o lock exclusivo do TRUNCATE por dezenas de
    // minutos. Qualquer outra query tocando azure_price_list (inclusive o próprio
    // GET /api/price-list/status, chamado a cada 8s pelo polling da tela) ficava bloqueada
    // esperando esse lock — e como cada chamada bloqueada segura uma conexão do pool (máx.
    // 20) até ser atendida, o pool inteiro esgotava e a aplicação inteira parecia "fora do
    // ar" pra qualquer tela que dependesse do banco, não só o Price List.
    await pool.query(`TRUNCATE TABLE azure_price_list`);

    let currentItems = probe.items;
    let nextLink     = probe.nextLink;

    while (true) {
      pages++;

      // Cada página grava e comita na própria transação curta — nenhuma conexão/lock fica
      // aberta durante a espera de rede/backoff até a próxima página (onde o rate limit
      // realmente acontece). Efeito colateral bom: progresso já coletado fica salvo de
      // verdade a cada página, não se perde tudo se a sincronização for interrompida.
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const item of currentItems) {
          if (!item.meterId) continue;
          const retailP = item.retailPrice ?? 0;
          const unitP   = item.unitPrice   ?? 0;
          if (retailP <= 0 && unitP <= 0) { total++; continue; }

          // arm_region_name vem da API — região real do item (brazilsouth, eastus, global, etc.)
          const armRegion = item.armRegionName || '';

          await c.query(`
            INSERT INTO azure_price_list
              (meter_id, currency_code, arm_region_name, retail_price, unit_price,
               unit_of_measure, product_name, sku_name, service_family,
               meter_name, meter_category, meter_sub_category,
               type, reservation_term, effective_start, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
            ON CONFLICT (meter_id, currency_code, arm_region_name, type, reservation_term)
            DO UPDATE SET
              retail_price       = GREATEST(EXCLUDED.retail_price, azure_price_list.retail_price),
              unit_price         = GREATEST(EXCLUDED.unit_price, azure_price_list.unit_price),
              product_name       = EXCLUDED.product_name,
              sku_name           = EXCLUDED.sku_name,
              service_family     = COALESCE(EXCLUDED.service_family, azure_price_list.service_family),
              meter_name         = COALESCE(EXCLUDED.meter_name, azure_price_list.meter_name),
              meter_category     = COALESCE(EXCLUDED.meter_category, azure_price_list.meter_category),
              meter_sub_category = COALESCE(EXCLUDED.meter_sub_category, azure_price_list.meter_sub_category),
              effective_start    = EXCLUDED.effective_start,
              updated_at         = NOW()
          `, [
            item.meterId,
            currency, armRegion,
            retailP,
            unitP,
            item.unitOfMeasure      ?? null,
            item.productName        ?? null,
            item.skuName            ?? null,
            item.serviceFamily      ?? null,
            item.meterName          ?? null,
            item.meterCategory      ?? null,
            item.meterSubCategory   ?? null,
            item.type               ?? 'Consumption',
            item.reservationTerm    ?? '',
            item.effectiveStartDate ? item.effectiveStartDate.slice(0, 10) : null
          ]);
          total++;
        }
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }

      _syncProgress.pages = pages;
      _syncProgress.total = total;
      if (pages % 10 === 0)
        console.log(`[PriceList] Página ${pages} — ${total} registros...`);

      if (!nextLink) break;

      // Delay entre páginas: evita 429 por burst de requisições.
      // Com $top=1000 são ~100 páginas no total; 300ms → ~30s overhead tolerável.
      await new Promise(r => setTimeout(r, 300));

      const next = await _fetchPriceListPage(nextLink);
      currentItems = next.items;
      nextLink     = next.nextLink;
    }

    _syncProgress.finished = new Date().toISOString();
    _plCobTs = 0;
    console.log(`[PriceList] ✅ Sync concluído: ${total} registros em ${pages} páginas`);

    await _gravaMeta(resultKey, { ok: true, total, pages, currency, region: 'all', ts: _syncProgress.finished });
    return { ok: true, total, pages, currency, region: 'all' };

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

// ── Price List import via CSV/ZIP ─────────────────────────────────────────────
let _plImporting = false;
let _plImportProgress = { total: 0, inserted: 0, skipped: 0, errors: 0, started: null, finished: null, error: null, filename: null };
let _plImportLog = []; // últimas 200 linhas de log — expostas em /api/price-list/import-status
function _plLog(msg) {
  console.log(msg);
  _plImportLog.push(`${new Date().toTimeString().slice(0,8)} ${msg}`);
  if (_plImportLog.length > 200) _plImportLog.shift();
}

// Normaliza cabeçalho CSV → chave canônica da tabela azure_price_list
// Suporta dois formatos: Azure Retail Prices API e Azure Price Sheet (billing export)
function _mapPlCol(h) {
  const s = h.replace(/[_\s-]/g, '').toLowerCase();
  // Azure Retail Prices API
  if (s === 'meterid')            return 'meter_id';
  if (s === 'currencycode')       return 'currency_code';
  if (s === 'armregionname')      return 'arm_region_name';
  if (s === 'retailprice')        return 'retail_price';
  if (s === 'retailpricebrl' || s === 'pricebrl') return 'retail_price_brl';
  if (s === 'unitprice')          return 'unit_price';
  if (s === 'unitofmeasure')      return 'unit_of_measure';
  if (s === 'productname')        return 'product_name';
  if (s === 'skuname')            return 'sku_name';
  if (s === 'servicefamily' || s === 'servicename') return 'service_family';
  if (s === 'type')               return 'type';
  if (s === 'reservationterm')    return 'reservation_term';
  if (s === 'effectivestartdate') return 'effective_start';
  // Azure Price Sheet (exportação billing: BillingAccountId, PriceType, MarketPrice, ...)
  if (s === 'pricetype')                           return 'type';
  if (s === 'marketprice')                         return 'retail_price';
  if (s === 'currency' || s === 'billingcurrency') return 'currency_code';
  if (s === 'meterregion')                         return 'arm_region_name';
  if (s === 'term')                                return 'reservation_term';
  if (s === 'product')                             return 'product_name';
  if (s === 'skuid')                               return 'sku_name';
  if (s === 'metername')                           return 'meter_name';
  if (s === 'metercategory' || s === 'metertype')  return 'meter_category';
  if (s === 'metersubcategory')                    return 'meter_sub_category';
  return null;
}

// clearBefore=true: apaga todos os dados do PL antes de inserir (substituição completa)
// clearBefore=false: upsert — mantém dados existentes não presentes no arquivo
// regionFilter='brazil': importa apenas linhas cuja região contém "brazil"/"brasil" ou é global/vazia
async function _importPriceListFromCSV(csvPath, filename, clearBefore = false, regionFilter = null) {
  await ensurePriceListTable();

  const ARM_REGION_FALLBACK = 'global';
  const nome = (filename || csvPath).toLowerCase();

  // ZIP: extrai cada entrada e processa com streaming para evitar OOM em arquivos grandes
  if (nome.endsWith('.zip')) {
    const AdmZip = require('adm-zip');
    const fs     = require('fs');
    const path   = require('path');
    const os     = require('os');
    const crypto = require('crypto');
    let zip;
    try { zip = new AdmZip(csvPath); } catch (e) { throw new Error(`ZIP inválido: ${e.message}`); }
    const entries = zip.getEntries().filter(e => {
      const n = e.entryName.toLowerCase();
      return !n.includes('..') && (n.endsWith('.csv') || n.endsWith('.parquet'));
    });
    if (!entries.length) throw new Error('ZIP não contém arquivos .csv ou .parquet válidos');
    let total = 0, inserted = 0, skipped = 0, errors = 0, isFirst = true;
    for (let zi = 0; zi < entries.length; zi++) {
      const entry   = entries[zi];
      const tmpName = `zip_pl_${crypto.randomBytes(6).toString('hex')}_${path.basename(entry.entryName)}`;
      const tmpPath = path.join(os.tmpdir(), tmpName);
      // Atualiza progresso com nome do arquivo atual dentro do ZIP
      if (_plImportProgress) _plImportProgress.filename = `[${zi+1}/${entries.length}] ${entry.entryName}`;
      _plLog(`[${zi+1}/${entries.length}] Iniciando: ${entry.entryName}`);
      try {
        zip.extractEntryTo(entry, os.tmpdir(), false, true, false, tmpName);
        const r = await _importPriceListFromCSV(tmpPath, entry.entryName, clearBefore && isFirst, regionFilter);
        isFirst = false;
        total += r.total; inserted += r.inserted; skipped += r.skipped; errors += r.errors;
        if (_plImportProgress) Object.assign(_plImportProgress, { total, inserted, skipped, errors });
        _plLog(`[${zi+1}/${entries.length}] ✅ ${r.inserted.toLocaleString()} ins · ${r.skipped} skip · ${r.errors} err`);
      } finally { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    }
    const ts = new Date().toISOString();
    await _gravaMeta('last_result_USD_global', { ok: true, total, pages: 1, currency: 'USD', region: ARM_REGION_FALLBACK, ts, source: 'csv', filename });
    return { total, inserted, skipped, errors };
  }

  // Parquet: carrega na memória (geralmente < 100 MB)
  let nonCsvRows = null;
  if (nome.endsWith('.parquet')) {
    nonCsvRows = await _lerArquivoRows(csvPath, filename || csvPath);
    if (!nonCsvRows.length) return { total: 0, inserted: 0, skipped: 0, errors: 0 };
  }

  let colMap = null;
  let inserted = 0, skipped = 0, errors = 0, total = 0, sp = 0;

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (clearBefore) {
      await c.query('TRUNCATE TABLE azure_price_list');
      console.log('[PriceList Import] Dados anteriores removidos (clearBefore=true)');
    }

    const processarRow = async (row) => {
      const spn = `spl_${sp++}`;
      try {
        const meterId       = (row[colMap['meter_id']] || '').trim();
        if (!meterId) { skipped++; return; }
        const currency      = (row[colMap['currency_code']]    || 'USD').trim() || 'USD';
        const armRegion     = (row[colMap['arm_region_name']]  || ARM_REGION_FALLBACK).trim() || ARM_REGION_FALLBACK;

        // Filtro de região: lista de regiões permitidas separada por vírgula
        if (regionFilter) {
          const allowed = new Set(regionFilter.split(',').map(r => r.trim().toLowerCase()));
          if (!allowed.has(armRegion.toLowerCase())) { skipped++; return; }
        }
        const retailPrice   = parseFloat(row[colMap['retail_price']]     || 0) || 0;
        const retailPriceBrl= colMap['retail_price_brl'] ? (parseFloat(row[colMap['retail_price_brl']] || 0) || null) : null;
        const unitPrice     = parseFloat(row[colMap['unit_price']]     || 0) || 0;
        const unitOfMeasure = (row[colMap['unit_of_measure']]  || null)?.trim() || null;
        const productName   = (row[colMap['product_name']]     || null)?.trim() || null;
        const skuName       = (row[colMap['sku_name']]         || null)?.trim() || null;
        const serviceFamily = (row[colMap['service_family']]   || null)?.trim() || null;
        const meterName        = (row[colMap['meter_name']]          || null)?.trim().slice(0, 500) || null;
        const meterCategory    = (row[colMap['meter_category']]      || null)?.trim().slice(0, 200) || null;
        const meterSubCategory = (row[colMap['meter_sub_category']]  || null)?.trim().slice(0, 200) || null;
        const type          = ((row[colMap['type']]             || 'Consumption').trim() || 'Consumption').slice(0, 50);
        if (type !== 'Consumption') { skipped++; return; }
        const rsvTerm       = (row[colMap['reservation_term']] || '').trim().slice(0, 20);
        // Normaliza data: aceita YYYY-MM-DD e MM/DD/YYYY (Azure Price Sheet)
        const _effRaw = (row[colMap['effective_start']] || '').trim();
        const _effMdy = _effRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        const effStart = _effMdy
          ? `${_effMdy[3]}-${_effMdy[1].padStart(2,'0')}-${_effMdy[2].padStart(2,'0')}`
          : (_effRaw.slice(0, 10) || null);

        await c.query(`SAVEPOINT ${spn}`);
        const r = await c.query(`
          INSERT INTO azure_price_list
            (meter_id, currency_code, arm_region_name, retail_price, retail_price_brl, unit_price,
             unit_of_measure, product_name, sku_name, service_family,
             meter_name, meter_category, meter_sub_category,
             type, reservation_term, effective_start, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
          ON CONFLICT (meter_id, currency_code, arm_region_name, type, reservation_term)
          DO UPDATE SET
            retail_price       = GREATEST(EXCLUDED.retail_price, azure_price_list.retail_price),
            retail_price_brl   = COALESCE(EXCLUDED.retail_price_brl, azure_price_list.retail_price_brl),
            unit_price         = GREATEST(EXCLUDED.unit_price, azure_price_list.unit_price),
            product_name       = EXCLUDED.product_name,
            sku_name           = EXCLUDED.sku_name,
            service_family     = COALESCE(EXCLUDED.service_family, azure_price_list.service_family),
            meter_name         = COALESCE(EXCLUDED.meter_name, azure_price_list.meter_name),
            meter_category     = COALESCE(EXCLUDED.meter_category, azure_price_list.meter_category),
            meter_sub_category = COALESCE(EXCLUDED.meter_sub_category, azure_price_list.meter_sub_category),
            effective_start    = EXCLUDED.effective_start,
            updated_at         = NOW()
        `, [meterId, currency, armRegion, retailPrice, retailPriceBrl, unitPrice,
            unitOfMeasure, productName, skuName, serviceFamily,
            meterName, meterCategory, meterSubCategory,
            type, rsvTerm, effStart]);
        await c.query(`RELEASE SAVEPOINT ${spn}`);
        if (r.rowCount > 0) inserted++; else skipped++;
      } catch (e) {
        await c.query(`ROLLBACK TO SAVEPOINT ${spn}`);
        await c.query(`RELEASE SAVEPOINT ${spn}`);
        errors++;
        if (errors <= 3) console.warn('[PriceList Import] erro linha:', e.message, '| meterId=', row[colMap['meter_id']] || '?');
      }
    };

    if (nonCsvRows) {
      // ZIP/Parquet — já carregado na memória
      colMap = {};
      for (const k of Object.keys(nonCsvRows[0])) {
        const mapped = _mapPlCol(k);
        if (mapped) colMap[mapped] = k;
      }
      if (!colMap['meter_id']) throw new Error('Coluna meterId / meter_id não encontrada no CSV');
      total = nonCsvRows.length;
      if (_plImportProgress) _plImportProgress.total = total;
      for (let _i = 0; _i < nonCsvRows.length; _i++) {
        await processarRow(nonCsvRows[_i]);
        if ((_i + 1) % 200 === 0 && _plImportProgress)
          Object.assign(_plImportProgress, { inserted, skipped, errors });
      }
      if (_plImportProgress) Object.assign(_plImportProgress, { inserted, skipped, errors });
    } else {
      // CSV — streaming por batches de 500 linhas (sem carregar na memória)
      await _lerCSVBatched(csvPath, 500, async (batch) => {
        if (!colMap) {
          colMap = {};
          for (const k of Object.keys(batch[0])) {
            const mapped = _mapPlCol(k);
            if (mapped) colMap[mapped] = k;
          }
          if (!colMap['meter_id']) throw new Error('Coluna meterId / meter_id não encontrada no CSV');
        }
        total += batch.length;
        if (_plImportProgress) _plImportProgress.total = total;
        for (const row of batch) await processarRow(row);
        if (_plImportProgress) Object.assign(_plImportProgress, { inserted, skipped, errors });
      });

      if (!colMap) {
        // CSV vazio — finaliza sem gravar
        await c.query('COMMIT');
        return { total: 0, inserted: 0, skipped: 0, errors: 0 };
      }
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const ts = new Date().toISOString();
  await _gravaMeta('last_result_USD_global', { ok: true, total, pages: 1, currency: 'USD', region: ARM_REGION_FALLBACK, ts, source: 'csv', filename });
  return { total, inserted, skipped, errors };
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
    subscription_id:                 _toStr(row.subscriptionId     || row.SubscriptionId     || row.SubscriptionGuid || row.subscriptionGuid || row['Subscription Id'] || row['Subscription ID'] || row['subscription id'] || row['SubscriptionId']),
    subscription_name:               _toStr(row.subscriptionName   || row.SubscriptionName   || row['Subscription Name'] || row['Subscription']),
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
    const preview    = buf.slice(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    const headerLine = preview.split(/\r?\n/)[0] || preview;
    const delim      = headerLine.includes('\t') ? '\t' : (headerLine.includes(';') ? ';' : ',');

    // Parser CSV/TSV respeitando aspas
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

// Lê CSV em streaming e chama onBatch(rows) a cada batchSize linhas.
// Evita carregar o arquivo inteiro na memória — necessário para arquivos > 500 MB.
async function _lerCSVBatched(filePath, batchSize, onBatch) {
  const fs       = require('fs');
  const readline = require('readline');

  const buf       = Buffer.allocUnsafe(4096);
  const fd        = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);
  const preview    = buf.slice(0, bytesRead).toString('utf8').replace(/^﻿/, '');
  const headerLine = preview.split(/\r?\n/)[0] || preview;
  const delim      = headerLine.includes('\t') ? '\t' : (headerLine.includes(';') ? ';' : ',');

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

  try {
    let headers = null, firstLine = true, batch = [];

    for await (const rawLine of rl) {
      const line = firstLine ? rawLine.replace(/^﻿/, '') : rawLine;
      firstLine = false;
      if (!line.trim()) continue;
      if (!headers) { headers = parseLine(line).map(h => h.trim()); continue; }
      const vals = parseLine(line);
      if (!vals.some(v => v.trim())) continue;
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      batch.push(obj);
      if (batch.length >= batchSize) { await onBatch(batch); batch = []; }
    }
    if (batch.length) await onBatch(batch);
  } finally {
    rl.close();
    stream.destroy();
  }
}

// ── Leitor universal: CSV / Parquet / ZIP (contendo CSV ou Parquet) ───────────
// Retorna array de objetos {coluna: valor} prontos para _mapRowCSV ou _mapPlCol.
async function _lerArquivoRows(filePath, filename) {
  const fs     = require('fs');
  const path   = require('path');
  const os     = require('os');
  const crypto = require('crypto');
  const nome   = (filename || path.basename(filePath)).toLowerCase();

  if (nome.endsWith('.csv')) {
    return _lerCSV(filePath);
  }

  if (nome.endsWith('.parquet')) {
    // Tenta pyarrow (Python) primeiro; fallback para @dsnp/parquetjs
    let tmpCsv = null;
    try {
      tmpCsv = await _parquetParaCSV(filePath);
      if (tmpCsv && fs.existsSync(tmpCsv)) {
        const rows = await _lerCSV(tmpCsv);
        try { fs.unlinkSync(tmpCsv); } catch (_) {}
        return rows;
      }
    } catch (pyErr) {
      if (tmpCsv) try { fs.unlinkSync(tmpCsv); } catch (_) {}
      console.warn('[lerArquivo] pyarrow falhou, tentando parquetjs:', pyErr.message);
    }

    let parquet;
    try { parquet = require('@dsnp/parquetjs'); } catch (_) {}
    if (!parquet) { try { parquet = require('parquetjs-lite'); } catch (_) {} }
    if (!parquet) throw new Error('Não foi possível ler Parquet — instale @dsnp/parquetjs');

    const rows   = [];
    const reader = await parquet.ParquetReader.openFile(filePath);
    const cursor = reader.getCursor();
    let rec;
    while ((rec = await cursor.next()) !== null) {
      rows.push(Object.fromEntries(
        Object.entries(rec).map(([k, v]) => [k, v == null ? '' : String(v)])
      ));
    }
    await reader.close();
    return rows;
  }

  if (nome.endsWith('.zip')) {
    const AdmZip  = require('adm-zip');
    let zip;
    try { zip = new AdmZip(filePath); }
    catch (e) { throw new Error(`ZIP inválido: ${e.message}`); }

    const entries = zip.getEntries().filter(e => {
      const n = e.entryName.toLowerCase();
      return !n.includes('..') && (n.endsWith('.csv') || n.endsWith('.parquet'));
    });
    if (!entries.length) throw new Error('ZIP não contém arquivos .csv ou .parquet válidos');

    const allRows = [];
    for (const entry of entries) {
      const tmpName = `zip_ex_${crypto.randomBytes(6).toString('hex')}_${path.basename(entry.entryName)}`;
      const tmpPath = path.join(os.tmpdir(), tmpName);
      try {
        zip.extractEntryTo(entry, os.tmpdir(), false, true, false, tmpName);
        const rows = await _lerArquivoRows(tmpPath, entry.entryName);
        for (const r of rows) allRows.push(r);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    }
    return allRows;
  }

  throw new Error(`Formato não suportado: ${path.extname(nome) || nome}`);
}

// ── Mapear linha CSV (camelCase Azure) → objeto DB ───────────────────────────
function _mapRowCSV(row, nomeArquivo) {
  // Suporta camelCase, PascalCase, "Title case" (MCA) e EA legacy
  // Lookup helper: percorre nomes exatos, retorna o primeiro não-nulo/vazio
  const _p = (...keys) => { for (const k of keys) { const v = row[k]; if (v != null && v !== '') return v; } return null; };
  const p = (a, b, c) => _p(a, b, c);
  const n = (a, b, c) => _toNum(row[a] ?? row[b] ?? (c ? row[c] : undefined));
  const d = (a, b, c) => _toDate(row[a] || row[b] || (c ? row[c] : null));

  // Lookup case-insensitive para lidar com qualquer variação de capitalização do Azure
  const _rowKeysLower = Object.keys(row).reduce((m, k) => { m[k.toLowerCase().replace(/[\s_-]/g, '')] = k; return m; }, {});
  const _ci = (...slugs) => { for (const s of slugs) { const k = _rowKeysLower[s]; if (k != null) { const v = row[k]; if (v != null && v !== '') return v; } } return null; };

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
    cost_date:                       _toDate(_p('date','Date','usageDate','UsageDate','Usage Date','serviceDate','ServiceDate','Service Date','UsageDateTimeKey','usageDateTimeKey')) || _toDate(_ci('date','usagedate','servicedate','usagedatetimekey')),
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
    subscription_id:                 _p('subscriptionId','SubscriptionId','Subscription ID','Subscription Id','SubscriptionGuid','subscriptionGuid') || _ci('subscriptionid','subscriptionguid','subscriptionid'),
    subscription_name:               _p('subscriptionName','SubscriptionName','Subscription Name','Subscription') || _ci('subscriptionname','subscription'),
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
//   linhas, inseridos, atualizados, erros, erros_det, subArquivo, erro, iniciado, concluido }

async function _processarImport(tmpPath, originalname, jobId) {
  const fs   = require('fs');
  const path = require('path');
  let csvGerado    = null;
  const tmpZipFiles = [];
  let totalLinhas = 0, totalIns = 0, totalUpd = 0, totalErr = 0;
  const errosDet = []; // amostras de erro (máx 50)

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
            if (errosDet.length < 50) {
              // Captura dados-chave da linha que falhou para diagnóstico
              let preview = {};
              try {
                const m = mapFn(rawRow, nomeArq);
                preview = {
                  cost_date:       m.cost_date       || null,
                  subscription_id: m.subscription_id ? m.subscription_id.slice(0, 36) : null,
                  resource_id:     m.resource_id     ? m.resource_id.slice(0, 80)     : null,
                  meter_id:        m.meter_id        ? m.meter_id.slice(0, 40)        : null,
                };
              } catch (_) {}
              errosDet.push({ linha: totalLinhas - rows.length + spCount, msg: e.message.slice(0, 200), ...preview });
              upd({ erros_det: errosDet });
            }
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

        if (nomeArq.endsWith('.csv')) {
          const linhasAntes = totalLinhas;
          await _lerCSVBatched(arquivoExtraido, 1000, async (batch) => {
            totalLinhas += batch.length;
            upd({ linhas: totalLinhas });
            await _inserirLinhas(batch, _mapRowCSV, nomeArq, sql, COLS);
          });
          if (totalLinhas === linhasAntes) {
            console.warn(`[Azure Import] ${nomeArq} sem dados válidos, ignorado.`);
            continue;
          }
        } else {
          let rows = [], mapFn = _mapRow;
          let tmpCsv = null;
          try {
            tmpCsv = await _parquetParaCSV(arquivoExtraido);
            if (tmpCsv && fs.existsSync(tmpCsv)) { rows = await _lerCSV(tmpCsv); mapFn = _mapRowCSV; }
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
            }
          }
          if (tmpCsv) try { fs.unlinkSync(tmpCsv); } catch (_) {}
          if (!rows.length) { console.warn(`[Azure Import] ${nomeArq} sem dados válidos, ignorado.`); continue; }
          totalLinhas += rows.length;
          upd({ linhas: totalLinhas });
          await _inserirLinhas(rows, mapFn, nomeArq, sql, COLS);
        }
      }

    } else {
      if (isCSV) {
        // CSV: leitura + inserção em streaming — sem carregar o arquivo inteiro na memória
        console.log('[Azure Import] Lendo CSV em streaming:', originalname);
        const linhasAntes = totalLinhas;
        await _lerCSVBatched(tmpPath, 1000, async (batch) => {
          totalLinhas += batch.length;
          upd({ linhas: totalLinhas });
          await _inserirLinhas(batch, _mapRowCSV, originalname, sql, COLS);
        });
        if (totalLinhas === linhasAntes) {
          upd({ status: 'error', erro: 'Arquivo vazio ou sem dados válidos.', concluido: Date.now() });
          return;
        }
      } else {
        // Parquet: ainda carrega na memória (pyarrow → CSV ou parquetjs)
        let rows = [], mapFn = _mapRowCSV;
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
        if (!rows.length) {
          upd({ status: 'error', erro: 'Arquivo vazio ou sem dados válidos.', concluido: Date.now() });
          return;
        }
        console.log(`[Azure Import] ${rows.length} linhas lidas.`);
        totalLinhas = rows.length;
        upd({ linhas: totalLinhas });
        await _inserirLinhas(rows, mapFn, originalname, sql, COLS);
      }
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

  // 2 GB — exports Azure multi-part (part_N_0001.csv) podem facilmente superar 500 MB
  // A leitura CSV é em streaming (readline), sem carregar o arquivo inteiro na memória
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
            error: `Arquivo muito grande (limite: 500 MB). Divida em partes menores ou exporte um período menor no Azure Cost Management.`
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
      linhas: 0, inseridos: 0, atualizados: 0, erros: 0, erros_det: [],
      subArquivo: null, erro: null,
      iniciado: Date.now(), concluido: null,
    };

    // Processar em background — não aguarda a resposta HTTP
    _processarImport(req.file.path, req.file.originalname, jobId).catch(() => {});

    res.status(202).json({ jobId, arquivo: req.file.originalname });
  });
}

// ── Cache de cobertura PL (TTL 5 min) — query pesada não bloqueia o status ───
let _plCobCache = null, _plCobTs = 0, _plCobRefreshing = false;
function _plCobRefresh() {
  if (!pool) return;
  // Guarda contra empilhamento (achado no mesmo incidente de 2026-10-03 do TRUNCATE): sem
  // isso, toda chamada a /api/price-list/status enquanto `_plCobTs` ainda está zerado (logo
  // após um sync/import, ou simplesmente antes da 1ª atualização terminar) disparava OUTRA
  // cópia dessa query pesada contra azure_costs (10M+ linhas) — com o polling de 8 em 8
  // segundos da tela, isso empilhava várias consultas concorrentes e ajudava a esgotar o pool
  // de conexões junto com o bug do TRUNCATE.
  if (_plCobRefreshing) return;
  _plCobRefreshing = true;
  // JOIN em vez de EXISTS por meter_id: muito mais rápido com índice LOWER(meter_id)
  pool.query(`
    WITH billing_meters AS (
      SELECT LOWER(meter_id) AS mid
      FROM azure_costs
      WHERE meter_id IS NOT NULL AND meter_id <> ''
      GROUP BY LOWER(meter_id)
    ),
    pl_meters AS (
      SELECT DISTINCT LOWER(meter_id) AS mid
      FROM azure_price_list
      WHERE type IN ('Consumption','DevTestConsumption') AND reservation_term = ''
    )
    SELECT
      (SELECT COUNT(*) FROM billing_meters)                          AS billing_meters,
      (SELECT COUNT(*) FROM billing_meters b
         INNER JOIN pl_meters p ON p.mid = b.mid)                   AS com_pl,
      (SELECT COUNT(DISTINCT meter_id) FROM azure_costs
         WHERE meter_id IS NULL OR meter_id = '')                   AS sem_meter_id
  `).then(r => {
    if (!r.rows[0]) return;
    const bm = parseInt(r.rows[0].billing_meters || 0);
    _plCobCache = {
      billing_meters: bm,
      com_pl:         parseInt(r.rows[0].com_pl       || 0),
      sem_meter_id:   parseInt(r.rows[0].sem_meter_id || 0),
      cobertura_pct:  bm > 0 ? Math.round(parseInt(r.rows[0].com_pl || 0) / bm * 100) : 0,
    };
    _plCobTs = Date.now();
  }).catch(() => {}).finally(() => { _plCobRefreshing = false; });
}

// ── GET /api/price-list/status ───────────────────────────────────────────────
app.get('/api/price-list/status', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const currency = 'USD';

    // Contagem de azure_price_list com timeout curto e dedicado — blindagem contra o
    // incidente de 2026-10-03 (ver _syncPriceList): se algo algum dia segurar um lock
    // exclusivo nessa tabela de novo, essa query falha rápido com erro claro em vez de
    // ficar pendurada segurando uma conexão do pool até o cliente desistir (foi isso que
    // fez o polling da tela errar "sincronização terminou sem dados").
    const cntClient = await pool.connect();
    let cnt;
    try {
      await cntClient.query('BEGIN');
      await cntClient.query(`SET LOCAL statement_timeout = '5000'`);
      cnt = await cntClient.query(`
        SELECT COUNT(*)::int                  AS total,
               COUNT(DISTINCT meter_id)::int  AS meters,
               MAX(updated_at)               AS last_updated,
               array_agg(DISTINCT currency_code ORDER BY currency_code) AS currencies
        FROM azure_price_list
      `);
      await cntClient.query('COMMIT');
    } catch (e) {
      await cntClient.query('ROLLBACK').catch(() => {});
      if (e.code === '57014') { // statement_timeout do Postgres
        return res.json({ total: null, meters: null, last_updated: null, currencies: [],
          syncing: _syncingPriceList, progress: _syncingPriceList ? _syncProgress : null,
          last_result: null, circuit_breaker: { state: _plCB.state },
          cobertura: _plCobCache,
          aviso: 'Tabela de preços temporariamente bloqueada (provavelmente por uma sincronização em andamento) — tente de novo em alguns segundos.' });
      }
      throw e;
    } finally {
      cntClient.release();
    }

    const meta = await pool.query(
      `SELECT value, updated_at FROM azure_price_list_meta WHERE key = $1`,
      [`last_result_USD_global`]
    );

    let last_result = null;
    if (meta.rows[0]) { try { last_result = JSON.parse(meta.rows[0].value); } catch (_) {} }

    const cbInfo = _plCB.state === 'OPEN'
      ? { state: _plCB.state, blocked_until: new Date(_plCB.openUntil).toISOString(), remaining_min: Math.ceil((_plCB.openUntil - Date.now()) / 60000) }
      : { state: _plCB.state, failures: _plCB.failures };

    // Cobertura: usa cache se < 5 min; dispara refresh em background caso contrário
    const COB_TTL = 5 * 60 * 1000;
    if (Date.now() - _plCobTs > COB_TTL) _plCobRefresh();

    res.json({
      total:          cnt.rows[0]?.total        || 0,
      meters:         cnt.rows[0]?.meters       || 0,
      last_updated:   cnt.rows[0]?.last_updated || null,
      currencies:     cnt.rows[0]?.currencies   || [],
      syncing:        _syncingPriceList,
      progress:       _syncingPriceList ? _syncProgress : null,
      last_result,
      circuit_breaker: cbInfo,
      cobertura:      _plCobCache,
    });
  } catch (e) { _dbErr(res, e); }
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

// ── GET /api/price-list/diag — Diagnóstico de cobertura do JOIN billing×PL ───
app.get('/api/price-list/diag', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const [plInfo, billingInfo, matchInfo, amostraBilling, amostraPL] = await Promise.all([
      // Resumo do Price List
      pool.query(`
        SELECT COUNT(*) AS total, COUNT(DISTINCT meter_id) AS meters_unicos,
               COUNT(*) FILTER (WHERE type='Consumption') AS consumption,
               COUNT(*) FILTER (WHERE type='DevTestConsumption') AS devtest,
               COUNT(*) FILTER (WHERE reservation_term='') AS sem_reserv_term,
               COUNT(*) FILTER (WHERE meter_id IS NULL OR meter_id='') AS sem_meter_id
        FROM azure_price_list`),
      // Resumo do billing
      pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(meter_id) AS com_meter_id,
               COUNT(DISTINCT meter_id) AS meters_unicos,
               COUNT(*) FILTER (WHERE meter_id IS NULL OR meter_id='') AS sem_meter_id
        FROM azure_costs`),
      // Quantos meters do billing têm match no PL
      pool.query(`
        WITH bm AS (SELECT DISTINCT LOWER(meter_id) m FROM azure_costs WHERE meter_id IS NOT NULL AND meter_id<>''),
             pm AS (SELECT DISTINCT LOWER(meter_id) m FROM azure_price_list
                    WHERE type IN ('Consumption','DevTestConsumption') AND reservation_term='')
        SELECT COUNT(*) AS billing_meters,
               COUNT(pm.m) AS com_match
        FROM bm LEFT JOIN pm ON pm.m = bm.m`),
      // Amostra de 3 meter_ids do billing com maior custo
      pool.query(`
        SELECT meter_id, MAX(meter_category) AS categoria,
               SUM(cost_in_billing_currency) AS custo_total
        FROM azure_costs WHERE meter_id IS NOT NULL AND meter_id<>''
        GROUP BY meter_id ORDER BY SUM(cost_in_billing_currency) DESC NULLS LAST LIMIT 3`),
      // Amostra de 3 meter_ids do Price List (Consumption)
      pool.query(`
        SELECT meter_id, service_family, type, reservation_term, retail_price
        FROM azure_price_list WHERE type='Consumption' AND reservation_term=''
        LIMIT 3`),
    ]);

    const bm = parseInt(matchInfo.rows[0]?.billing_meters || 0);
    const cm = parseInt(matchInfo.rows[0]?.com_match || 0);

    res.json({
      price_list:     plInfo.rows[0],
      billing:        billingInfo.rows[0],
      match:          { billing_meters: bm, com_match: cm, pct: bm > 0 ? Math.round(cm/bm*100) : 0 },
      amostra_billing: amostraBilling.rows,
      amostra_pl:      amostraPL.rows,
    });
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/price-list/schedule ─────────────────────────────────────────────
app.get('/api/price-list/schedule', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT value FROM azure_price_list_meta WHERE key = 'pl_schedule'`
    );
    if (!r.rows.length) return res.json({ ativo: false, dia_mes: 28, hora: 2 });
    res.json(JSON.parse(r.rows[0].value));
  } catch (e) { _dbErr(res, e); }
});

// ── POST /api/price-list/schedule ────────────────────────────────────────────
app.post('/api/price-list/schedule', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const ativo   = req.body.ativo   === true || req.body.ativo === 'true';
    const dia_mes = Math.min(28, Math.max(1, parseInt(req.body.dia_mes) || 28)); // 1-28 (seguro p/ fev)
    const hora    = Math.min(23, Math.max(0, parseInt(req.body.hora)    || 2));
    const cfg     = { ativo, dia_mes, hora };
    await pool.query(`
      INSERT INTO azure_price_list_meta (key, value, updated_at)
      VALUES ('pl_schedule', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify(cfg)]);
    console.log(`[PriceList] Agendamento ${ativo ? 'ativado' : 'desativado'}: dia ${dia_mes} às ${hora}h`);
    res.json({ ok: true, ...cfg });
  } catch (e) { _dbErr(res, e); }
});

// ── POST /api/price-list/reset-cb ────────────────────────────────────────────
// Reseta o Circuit Breaker do Price List sem precisar reiniciar o servidor.
// Útil após corrigir configuração que causou erros consecutivos (ex: $top inválido).
app.post('/api/price-list/reset-cb', authMiddleware, dbMiddleware, (_req, res) => {
  const anterior = { ..._plCB };
  _plCB = { state: 'CLOSED', failures: 0, openUntil: null };
  console.log(`[PriceList CB] Reset manual — estado anterior: ${anterior.state} (${anterior.failures} falhas)`);
  res.json({ ok: true, anterior, atual: { ..._plCB } });
});

// ── GET /api/price-list/import-status ────────────────────────────────────────
app.get('/api/price-list/import-status', authMiddleware, (_req, res) => {
  res.json({ importing: _plImporting, ..._plImportProgress, log: _plImportLog.slice(-50) });
});

// ── POST /api/price-list/import ───────────────────────────────────────────────
// Aceita .csv, .parquet ou .zip (contendo CSV/Parquet). Fire-and-forget.
app.post('/api/price-list/import', authMiddleware, dbMiddleware, (req, res) => {
  if (!_multer) return res.status(500).json({ error: 'multer não disponível' });
  if (_plImporting) return res.status(409).json({ error: 'Importação já em andamento' });

  const upload = _multer({ dest: _uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }).single('file');
  upload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'Arquivo muito grande (limite: 2 GB). Divida em partes menores.' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const fs       = require('fs');
    const origname = req.file.originalname || '';
    const ext      = origname.split('.').pop().toLowerCase();

    if (!['csv', 'parquet', 'zip'].includes(ext))
      return res.status(400).json({ error: 'Apenas arquivos .csv, .parquet e .zip são aceitos' });

    // Renomear o temp para ter a extensão correta (necessário para _lerArquivoRows detectar o tipo)
    const path    = require('path');
    const crypto  = require('crypto');
    const tmpDest = path.join(_uploadDir, `pl_up_${crypto.randomBytes(6).toString('hex')}.${ext}`);
    try { fs.renameSync(req.file.path, tmpDest); } catch (_) {}

    res.json({ ok: true, msg: 'Importação iniciada', filename: origname });

    _plImporting = true;
    _plImportProgress = { total: 0, inserted: 0, skipped: 0, errors: 0, started: new Date().toISOString(), finished: null, error: null, filename: origname };

    // clearBefore vem do frontend: true apenas para o primeiro arquivo de uma fila múltipla
    const clearBefore    = req.body?.clearBefore !== 'false';
    const regionFilter   = req.body?.regionFilter || null;
    if (regionFilter) _plLog(`Filtro de região ativo: ${regionFilter}`);

    (async () => {
      try {
        const result = await _importPriceListFromCSV(tmpDest, origname, clearBefore, regionFilter);
        _plImportProgress = { ...result, started: _plImportProgress.started, finished: new Date().toISOString(), error: null, filename: origname };
        _plCobTs = 0; // invalida cache de cobertura para recalcular na próxima visita
        _plLog(`✅ Concluído: ${result.inserted.toLocaleString()} ins · ${result.skipped} skip · ${result.errors} err`);
      } catch (e) {
        _plImportProgress.error    = e.message;
        _plImportProgress.finished = new Date().toISOString();
        _plLog(`❌ Erro: ${e.message}`);
      } finally {
        _plImporting = false;
        try { fs.unlinkSync(tmpDest); } catch (_) {}
      }
    })();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL PÚBLICO — sem autenticação; dados filtrados pelo admin
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: lê config do portal do banco
async function _getPortalConfig() {
  const _defaults = { ativo: false, subscription_ids: [], resource_groups: [], dominios_aceitos: [], titulo: 'Portal de Serviço', descricao: '',
    calculadora_ativa: true,
    orfaos_ativo: false, orfaos_subscription_ids: [], orfaos_resource_groups: [], orfaos_categorias: [],
    // Minha Cota Genie (2026-09-28): login PARALELO via Entra ID, sem allowlist do admin —
    // cada usuário só vê os próprios dados, então não há "quais workspaces aparecem" pra
    // configurar (diferente de orfaos_*/subscription_ids acima).
    genie_cotas_ativo: false,
    // Simulador de Preços (2026-10-03): busca sobre `azure_price_list` (catálogo público da
    // Azure Retail Prices API, já sincronizado em Configurações → Price List) — não é billing
    // nem dado do tenant, então não precisa de allowlist nem identificação, só liga/desliga.
    price_simulator_ativo: false,
    // Imposto sobre custo coletado (2026-09-28): DOIS impostos independentes — Serviço Microsoft
    // e Marketplace (`publisher_type` em azure_costs distingue os dois; medido no dado real que
    // Marketplace é ~36% do custo total, não é um caso de borda). Cada um só se aplica se
    // `ativo=true` — o padrão é `false` (mantém o valor cru da Azure) até o admin configurar E
    // ativar; diferente do imposto único da Calculadora (`taxa_imposto`, sempre ligado, 18.65%
    // default), que continua existindo separado pra não mudar o comportamento da estimativa.
    imposto_microsoft:   { ativo: false, taxa: 18.65 },
    imposto_marketplace: { ativo: false, taxa: 18.65 } };
  try {
    const r = await pool.query(`SELECT value FROM portal_config WHERE key = 'config'`);
    if (!r.rows.length) return _defaults;
    // merge com defaults para garantir campos que podem não existir em configs antigas
    return { ..._defaults, ...JSON.parse(r.rows[0].value) };
  } catch (_) { return _defaults; }
}

// Imposto adicional sobre custo coletado (2026-09-28): dois impostos independentes — Serviço
// Microsoft e Marketplace (`publisher_type` em azure_costs) — cada um só aplicado se `ativo`,
// senão mantém o valor cru da Azure. Aplicado SÓ na apresentação — nunca reescreve
// `azure_costs`/rollups — pra mudar a taxa em Configurações refletir retroativo, sem reprocessar
// coleta nenhuma. Fica de fora, de propósito: Databricks, Reconciliação (a fatura comparada não
// inclui esse imposto) e rotas de auditoria/saúde de coleta que precisam bater com o valor cru.
function _normImpostoCategoria(v) {
  const taxa = v && Number.isFinite(parseFloat(v.taxa)) ? parseFloat(v.taxa) : 18.65;
  return { ativo: !!(v && v.ativo), taxa };
}
async function _getImpostoConfig() {
  const cfg = await _getPortalConfig();
  return {
    microsoft:   _normImpostoCategoria(cfg.imposto_microsoft),
    marketplace: _normImpostoCategoria(cfg.imposto_marketplace),
  };
}
// `microsoft`/`marketplace` já vêm de SUMs separados por `publisher_type` (CASE na SQL) — soma
// cada um com seu próprio multiplicador (ou cru, se a categoria não estiver ativa).
function _comImpostoSplit(custoMicrosoft, custoMarketplace, impostoCfg) {
  const m  = custoMicrosoft   == null ? 0 : Number(custoMicrosoft);
  const mp = custoMarketplace == null ? 0 : Number(custoMarketplace);
  const vM  = impostoCfg.microsoft.ativo   ? m  * (1 + impostoCfg.microsoft.taxa / 100)   : m;
  const vMp = impostoCfg.marketplace.ativo ? mp * (1 + impostoCfg.marketplace.taxa / 100) : mp;
  return vM + vMp;
}
// Taxa única ainda usada pela Calculadora (estimativa futura, não classificada por publisher_type
// — `taxa_imposto`, sempre ligada, default 18.65%) e por telas que ainda não migraram pro split.
async function _getTaxaImposto() {
  const cfg = await _getPortalConfig();
  const t = parseFloat(cfg.taxa_imposto);
  return Number.isFinite(t) ? t : 18.65;
}
function _comImposto(valor, taxaImposto) {
  return valor == null ? valor : valor * (1 + taxaImposto / 100);
}

// Middleware: bloqueia se portal inativo
async function _portalMiddleware(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Banco de dados não disponível' });
  try {
    const cfg = await _getPortalConfig();
    if (!cfg.ativo) return res.status(403).json({ error: 'Portal desativado' });
    req.portalCfg = cfg;
    next();
  } catch (e) { _dbErr(res, e); }
}

// Serviço "Calculadora" do portal desligável pelo admin. Aplicado só nas rotas de dados da
// calculadora (não em /config nem /identificar, usados pela página inicial e pelo modal) — o
// portal não tem sessão, então esconder o card na tela não basta: o servidor também recusa.
function _calculadoraAtivaMiddleware(req, res, next) {
  if (req.portalCfg && req.portalCfg.calculadora_ativa === false) {
    return res.status(403).json({ error: 'Calculadora desativada' });
  }
  next();
}

// ── GET /api/admin/portal-config ─────────────────────────────────────────────
app.get('/api/admin/portal-config', authMiddleware, dbMiddleware, async (_req, res) => {
  try { res.json(await _getPortalConfig()); }
  catch (e) { _dbErr(res, e); }
});

// ── POST /api/admin/portal-config ────────────────────────────────────────────
app.post('/api/admin/portal-config', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { ativo, subscription_ids = [], resource_groups = [], dominios_aceitos = [], titulo = 'Portal de Serviço', descricao = '',
            taxa_imposto, taxa_cond, taxa_gordura, horario_livre, solicitar_identificacao,
            permitir_selecao_periodo, permitir_selecao_recursos,
            orfaos_ativo, orfaos_subscription_ids, orfaos_resource_groups, orfaos_categorias, calculadora_ativa,
            genie_cotas_ativo, price_simulator_ativo, imposto_microsoft, imposto_marketplace } = req.body;
    // Recursos órfãos no portal: allowlist explícita. Listas sempre normalizadas (strings não vazias);
    // categorias filtradas contra as 8 válidas — nada vindo do cliente entra sem validação.
    const _strList = (v) => (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 2000);
    const cfg = {
      ativo: !!ativo, subscription_ids, resource_groups, dominios_aceitos, titulo, descricao,
      // `!== false`: cliente antigo que não envia o campo não desliga a calculadora sem querer.
      calculadora_ativa: calculadora_ativa !== false,
      orfaos_ativo: !!orfaos_ativo,
      orfaos_subscription_ids: _strList(orfaos_subscription_ids),
      orfaos_resource_groups: _strList(orfaos_resource_groups),
      orfaos_categorias: _strList(orfaos_categorias).filter((c) => Object.prototype.hasOwnProperty.call(_DESP_LABEL_XLSX, c)),
      genie_cotas_ativo: !!genie_cotas_ativo,
      price_simulator_ativo: !!price_simulator_ativo,
      taxa_imposto:           taxa_imposto  != null ? parseFloat(taxa_imposto)  : 18.65,
      taxa_cond:              taxa_cond     != null ? parseFloat(taxa_cond)     : 13.00,
      taxa_gordura:           taxa_gordura  != null ? parseFloat(taxa_gordura)  : 0,
      imposto_microsoft:   _normImpostoCategoria(imposto_microsoft),
      imposto_marketplace: _normImpostoCategoria(imposto_marketplace),
      horario_livre:          horario_livre || { ativo: false, inicio: '09:00', fim: '18:00', dias: [1,2,3,4,5] },
      solicitar_identificacao:    !!solicitar_identificacao,
      permitir_selecao_periodo:   !!permitir_selecao_periodo,
      permitir_selecao_recursos:  !!permitir_selecao_recursos,
      updated_at: new Date().toISOString()
    };
    await pool.query(`
      INSERT INTO portal_config (key, value, updated_at)
      VALUES ('config', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify(cfg)]);
    console.log(`[Portal] Config atualizada — ativo: ${cfg.ativo}, subs: ${subscription_ids.length}, rgs: ${resource_groups.length}, dominios: ${dominios_aceitos.length}`);
    res.json({ ok: true, ...cfg });
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/public/calculadora/projetos ─────────────────────────────────────
app.get('/api/public/calculadora/projetos', _portalMiddleware, _calculadoraAtivaMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, descricao, status
       FROM projetos WHERE status = 'Ativo' ORDER BY nome`
    );
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

// ── POST /api/public/calculadora/estimativas ─────────────────────────────────
// Salva estimativa gerada pelo portal público (sem auth JWT)
app.post('/api/public/calculadora/estimativas', _portalMiddleware, _calculadoraAtivaMiddleware, dbMiddleware, async (req, res) => {
  const {
    projeto_id, projeto_nome, numero, titulo, responsavel, validade_dias,
    data_estimativa, horas, pct_imposto, pct_cond, vl_imposto, vl_cond,
    total_brl, total_final, observacoes, recursos
  } = req.body;
  try {
    // numero é sempre gerado no cliente como 'EST-' + 6 dígitos (InvoiceModal.tsx) — nunca
    // um campo de texto livre editado pelo usuário. Validar o formato aqui é defesa em
    // profundidade: fecha a porta a qualquer payload malicioso nesse campo específico
    // (ele é renderizado sem escape de HTML no PDF gerado — ver buildPdfHtml.ts) sem
    // depender só do fix client-side, sem quebrar o fluxo legítimo.
    if (typeof numero !== 'string' || !/^EST-\d{1,10}$/.test(numero))
      return res.status(400).json({ error: 'Número da estimativa inválido.' });

    // Valida recursos — só permite resource_ids cujo subscription_id (e RG, se configurado)
    // sejam permitidos pelo admin do portal (mesma validação de POST /estimar) — sem isso,
    // qualquer chamada anônima podia gravar uma estimativa fabricada (recursos/totais
    // arbitrários) direto na mesma tabela lida pelas telas autenticadas de Estimativas/Dashboard.
    const { subscription_ids: allowedSubs = [], resource_groups: allowedRGs = [] } = req.portalCfg;
    const recursosArr = Array.isArray(recursos) ? recursos : [];
    if (!recursosArr.length) return res.status(400).json({ error: 'Nenhum recurso selecionado.' });
    const ids = recursosArr.map(r => r.resource_id).filter(Boolean);
    const check = await pool.query(
      `SELECT DISTINCT resource_id, UPPER(resource_group_name) AS rg FROM azure_costs
       WHERE resource_id = ANY($1) AND subscription_id = ANY($2)`,
      [ids, allowedSubs]
    );
    const allowedRGsUpper = allowedRGs.map(rg => rg.toUpperCase());
    const validIds = new Set(
      check.rows.filter(row => !allowedRGsUpper.length || allowedRGsUpper.includes(row.rg)).map(row => row.resource_id)
    );
    if (!ids.length || !ids.every(id => validIds.has(id))) return res.status(403).json({ error: 'Recursos não autorizados para este portal.' });

    const r = await pool.query(`
      INSERT INTO estimativas
        (projeto_id, projeto_nome, numero, titulo, responsavel, validade_dias,
         data_estimativa, horas, pct_imposto, pct_cond, vl_imposto, vl_cond,
         total_brl, total_final, observacoes, recursos)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      projeto_id || null, projeto_nome || null, numero, titulo, responsavel,
      validade_dias || 30, data_estimativa || null, horas || null,
      pct_imposto || 0, pct_cond || 0, vl_imposto || 0, vl_cond || 0,
      total_brl, total_final, observacoes || null,
      recursos ? JSON.stringify(recursos) : null
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) { _dbErr(res, err); }
});

// ── GET /api/public/calculadora/config ───────────────────────────────────────
app.get('/api/public/calculadora/config', _portalMiddleware, (req, res) => {
  const { titulo, descricao, dominios_aceitos = [], taxa_imposto = 18.65, taxa_cond = 13.00, taxa_gordura = 0,
          horario_livre = { ativo: false, inicio: '09:00', fim: '18:00', dias: [1,2,3,4,5] },
          solicitar_identificacao = false,
          permitir_selecao_periodo = true, permitir_selecao_recursos = true } = req.portalCfg;
  res.json({ titulo, descricao, dominios_aceitos, taxa_imposto, taxa_cond, taxa_gordura, horario_livre,
             imposto_microsoft: _normImpostoCategoria(req.portalCfg.imposto_microsoft),
             imposto_marketplace: _normImpostoCategoria(req.portalCfg.imposto_marketplace),
             solicitar_identificacao, permitir_selecao_periodo, permitir_selecao_recursos,
             calculadora_ativa: req.portalCfg.calculadora_ativa !== false,
             orfaos_ativo: !!req.portalCfg.orfaos_ativo,
             genie_cotas_ativo: !!req.portalCfg.genie_cotas_ativo,
             price_simulator_ativo: !!req.portalCfg.price_simulator_ativo });
});

// ── GET /api/public/orfaos ────────────────────────────────────────────────────
// Visão de recursos órfãos do portal. Sem sessão (como o resto do portal), então: allowlist
// explícita do admin (assinaturas + tipos; RG opcional), campos sanitizados (NUNCA resource_id,
// subscription_id ou erros) e rate limit — a 1ª chamada com cache frio dispara consultas ao
// Resource Graph. Reaproveita o cache da rota autenticada (mesma chave: todas as assinaturas do
// Inventário) e NÃO grava em azure_desperdicio_deteccao.
const _orfaosPublicoLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});
app.get('/api/public/orfaos', _orfaosPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    const cfg = req.portalCfg;
    if (!cfg.orfaos_ativo) return res.status(403).json({ error: 'Visão de recursos órfãos desativada' });
    const subsPermitidas = new Set((cfg.orfaos_subscription_ids || []).map((s) => String(s).toLowerCase()));
    const categorias = new Set(cfg.orfaos_categorias || []);
    const rgs = new Set((cfg.orfaos_resource_groups || []).map((r) => String(r).toUpperCase()));
    const vazio = { gerado_em: new Date().toISOString(), total_itens: 0, custo_mensal_estimado_total: 0, por_categoria: [], itens: [] };
    if (!subsPermitidas.size || !categorias.size) return res.json(vazio);

    await ensureAzureColetaTable();
    const { subs } = await _getInventarioSpConfig();
    const cache = await _getDesperdicioCached(subs, 90);
    const filtrados = cache.filter((x) =>
      subsPermitidas.has(String(x.subscription_id).toLowerCase())
      && categorias.has(x.categoria)
      && (!rgs.size || (x.resource_group && rgs.has(String(x.resource_group).toUpperCase())))
      // Discos de PVC do AKS e de ASR precisam de validação manual (podem estar em uso
      // por outro sistema) — nunca expostos no portal público, só na tela interna.
      && !x.motivo_validacao);

    const det = filtrados.length
      ? await pool.query(
          `SELECT resource_id_upper, primeira_deteccao_em FROM azure_desperdicio_deteccao WHERE resource_id_upper = ANY($1)`,
          [filtrados.map((x) => String(x.resource_id).toUpperCase())])
      : { rows: [] };
    const primeira = new Map(det.rows.map((r) => [r.resource_id_upper, r.primeira_deteccao_em]));

    // Disco só entra no portal público com 90+ dias desanexados confirmados — recém-desanexado
    // tem mais chance de ser reanexado de volta (manutenção, reboot, etc.), então ainda não é um
    // candidato maduro o bastante para expor publicamente. `dias_orfao: null` (sem data conhecida)
    // também é excluído aqui — "não sabemos há quanto tempo" não é o mesmo que "sabemos que é 90+".
    const _DIAS_MIN_DISCO_PUBLICO = 90;

    // Imposto (Microsoft/Marketplace) já aplicado em _coletarDesperdicio, na origem — não
    // reaplicar aqui (dobraria o multiplicador).
    const itens = filtrados.map((x) => {
      const desde = x.marcado_orfao_em || primeira.get(String(x.resource_id).toUpperCase());
      return {
        nome: x.nome || null,
        categoria: x.categoria,
        resource_group: x.resource_group || null,
        sku: x.sku || null,
        tamanho_gb: x.tamanho_gb ?? null,
        custo_mensal_estimado: x.custo_mensal_estimado ?? null,
        dias_orfao: desde ? Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 86400000)) : null,
      };
    }).filter((it) => it.categoria !== 'disco_orfao' || (it.dias_orfao !== null && it.dias_orfao >= _DIAS_MIN_DISCO_PUBLICO))
      .sort((a, b) => (b.custo_mensal_estimado || 0) - (a.custo_mensal_estimado || 0));

    const porCat = {};
    for (const it of itens) {
      const c = (porCat[it.categoria] ||= { categoria: it.categoria, itens: 0, custo_mensal_estimado: 0 });
      c.itens++;
      c.custo_mensal_estimado += it.custo_mensal_estimado || 0;
    }
    res.json({
      gerado_em: new Date().toISOString(),
      total_itens: itens.length,
      custo_mensal_estimado_total: itens.reduce((a, x) => a + (x.custo_mensal_estimado || 0), 0),
      por_categoria: Object.values(porCat).sort((a, b) => b.custo_mensal_estimado - a.custo_mensal_estimado),
      itens,
    });
  } catch (e) {
    console.error('[Portal Órfãos] erro:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar os recursos órfãos no momento.' });
  }
});

// ── Simulador de Preços (2026-10-03) ──────────────────────────────────────────
// Busca sobre `azure_price_list` — catálogo PÚBLICO da Azure Retail Prices API, já
// sincronizado em Configurações → Price List (todas as regiões, sem filtro). Não é billing
// nem dado do tenant, então sem allowlist/identificação — só o toggle `price_simulator_ativo`.
// Mesmo padrão de rate limit de /api/public/orfaos acima (rota pública sem sessão).
const _priceSimPublicoLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});

app.get('/api/public/price-simulator/categorias', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const r = await pool.query(
      `SELECT DISTINCT service_family FROM azure_price_list
       WHERE type = 'Consumption' AND service_family IS NOT NULL AND service_family <> ''
       ORDER BY 1`
    );
    res.json(r.rows.map((row) => row.service_family));
  } catch (e) {
    console.error('[Simulador de Preços] erro ao listar categorias:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar as categorias no momento.' });
  }
});

app.get('/api/public/price-simulator/regioes', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const r = await pool.query(
      `SELECT DISTINCT arm_region_name FROM azure_price_list
       WHERE type = 'Consumption' AND arm_region_name IS NOT NULL AND arm_region_name <> ''
       ORDER BY 1`
    );
    res.json(r.rows.map((row) => row.arm_region_name));
  } catch (e) {
    console.error('[Simulador de Preços] erro ao listar regiões:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar as regiões no momento.' });
  }
});

// Mesma taxa de câmbio fixa já usada em buildEstimativa.ts/calcEstimado.ts — a sincronização
// AO VIVO do Price List (diferente da importação por CSV/planilha) não preenche
// `retail_price_brl`, então convertemos aqui quando ele vier nulo.
const _PRICE_SIM_TAXA_BRL_FALLBACK = 5.70;

app.get('/api/public/price-simulator/buscar', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const { categoria, regiao, q, produto, comPreco } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const porPagina = 50;
    const params = []; const cond = [`type = 'Consumption'`];
    if (categoria) { cond.push(`service_family = $${params.length + 1}`); params.push(categoria); }
    if (regiao)    { cond.push(`arm_region_name = $${params.length + 1}`); params.push(regiao); }
    // `produto` casa o product_name EXATO — o assistente guiado usa isso para não misturar
    // famílias parecidas (ex.: "Premium SSD Managed Disks", cobrado por disco/mês, com
    // "Azure Premium SSD v2" e "Premium SSD Managed Disks_v8", cobrados por GiB/hora).
    if (produto)   { cond.push(`product_name = $${params.length + 1}`); params.push(produto); }
    // Alguns meters do catálogo têm preço zero de verdade (ex.: "Provisioned IOPS" do
    // Premium SSD v2) — inúteis numa lista de sugestão de custo.
    if (comPreco === '1') { cond.push(`COALESCE(retail_price_brl, retail_price, 0) > 0`); }
    // `sku` exato — usado pela busca manual em dois níveis (produto → SKU/tier).
    if (req.query.sku) { cond.push(`sku_name = $${params.length + 1}`); params.push(req.query.sku); }
    // `produtos` = lista de product_name separada por "|" (caractere que não aparece em nome
    // de produto). É assim que o assistente busca a caixa de um SERVIÇO: um serviço agrupa
    // vários produtos do catálogo (ex.: "Azure Cache for Redis" reúne 10 produtos).
    if (req.query.produtos) {
      const lista = String(req.query.produtos).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 60);
      if (lista.length) { cond.push(`product_name = ANY($${params.length + 1})`); params.push(lista); }
    }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const i = params.length;
      cond.push(`(product_name ILIKE $${i} OR sku_name ILIKE $${i} OR meter_name ILIKE $${i})`);
    }
    const where = 'WHERE ' + cond.join(' AND ');
    const [totalR, itensR] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM azure_price_list ${where}`, params),
      pool.query(
        `SELECT product_name, sku_name, meter_name, unit_of_measure, retail_price, retail_price_brl, arm_region_name, service_family
         FROM azure_price_list ${where}
         ORDER BY product_name, sku_name, meter_name
         LIMIT ${porPagina} OFFSET ${(page - 1) * porPagina}`,
        params
      ),
    ]);
    const itens = itensR.rows.map((r) => ({
      produto: r.product_name, sku: r.sku_name, meter: r.meter_name, unidade: r.unit_of_measure,
      preco_brl: r.retail_price_brl != null ? Number(r.retail_price_brl) : Number(r.retail_price || 0) * _PRICE_SIM_TAXA_BRL_FALLBACK,
      regiao: r.arm_region_name, categoria: r.service_family,
    }));
    res.json({ itens, total: parseInt(totalR.rows[0].total, 10), page, por_pagina: porPagina });
  } catch (e) {
    console.error('[Simulador de Preços] erro na busca:', e.message);
    res.status(500).json({ error: 'Não foi possível buscar preços no momento.' });
  }
});

// Preço em BRL direto no SQL — igual ao cálculo de `preco_brl` acima, mas precisa estar na
// query para dar MIN()/ORDER BY. A taxa é constante numérica do servidor, não entrada do usuário.
const _SQL_PRECO_BRL = `COALESCE(retail_price_brl, retail_price * ${_PRICE_SIM_TAXA_BRL_FALLBACK})`;

// Filtros comuns dos dois endpoints de VM do assistente guiado:
//   - só VM de verdade: `product_name LIKE 'Virtual Machines%'` exclui "Cloud Services FSv2
//     Series" e "Bsv2 Series Cloud Services", que vivem no mesmo service_family 'Compute';
//   - SO e modelo de compra ficam NO SERVIDOR porque uma família como "Virtual Machines Easv5
//     Series" tem 107 meters (Linux + Windows + Spot + Low Priority) e estourava a paginação
//     de 50 do /buscar antes de qualquer refinamento no cliente.
function _vmFiltros(regiao, so, modelo) {
  const params = [];
  const cond = [
    `type = 'Consumption'`,
    `service_family = 'Compute'`,
    `product_name LIKE 'Virtual Machines%'`,
    `COALESCE(retail_price_brl, retail_price, 0) > 0`,
  ];
  if (regiao) { cond.push(`arm_region_name = $${params.length + 1}`); params.push(regiao); }
  if (so === 'windows')      cond.push(`product_name ILIKE '%Windows%'`);
  else if (so === 'linux')   cond.push(`product_name NOT ILIKE '%Windows%'`);
  if (modelo === 'spot')     cond.push(`meter_name ILIKE '%Spot%'`);
  else if (modelo === 'sob-demanda') cond.push(`meter_name NOT ILIKE '%Spot%' AND meter_name NOT ILIKE '%Low Priority%'`);
  return { where: 'WHERE ' + cond.join(' AND '), params };
}

// Famílias de VM disponíveis (ex.: "Virtual Machines Dsv5 Series") com quantos tamanhos cada
// uma tem e o preço de entrada — o assistente agrupa isso por tipo (uso geral, memória,
// computação...) usando a taxonomia da Azure, que NÃO existe no catálogo de preços.
app.get('/api/public/price-simulator/vm-familias', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const { where, params } = _vmFiltros(req.query.regiao, req.query.so, req.query.modelo);
    const r = await pool.query(
      `SELECT product_name, COUNT(DISTINCT sku_name) AS skus, MIN(${_SQL_PRECO_BRL}) AS preco_min
       FROM azure_price_list ${where}
       GROUP BY product_name
       ORDER BY product_name`,
      params
    );
    res.json(r.rows.map((x) => ({
      produto: x.product_name, skus: parseInt(x.skus, 10), preco_min: Number(x.preco_min),
    })));
  } catch (e) {
    console.error('[Simulador de Preços] erro ao listar famílias de VM:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar as famílias de VM no momento.' });
  }
});

// Tamanhos (SKUs) de uma família de VM, do mais barato pro mais caro.
app.get('/api/public/price-simulator/vm-skus', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const produto = req.query.produto;
    if (!produto) return res.status(400).json({ error: 'Informe a família de VM (produto).' });
    const { where, params } = _vmFiltros(req.query.regiao, req.query.so, req.query.modelo);
    params.push(produto);
    const r = await pool.query(
      `SELECT product_name, sku_name, meter_name, unit_of_measure, retail_price, retail_price_brl, arm_region_name, service_family
       FROM azure_price_list ${where} AND product_name = $${params.length}
       ORDER BY ${_SQL_PRECO_BRL} ASC
       LIMIT 100`,
      params
    );
    res.json({
      itens: r.rows.map((x) => ({
        produto: x.product_name, sku: x.sku_name, meter: x.meter_name, unidade: x.unit_of_measure,
        preco_brl: x.retail_price_brl != null ? Number(x.retail_price_brl) : Number(x.retail_price || 0) * _PRICE_SIM_TAXA_BRL_FALLBACK,
        regiao: x.arm_region_name, categoria: x.service_family,
      })),
      total: r.rowCount, page: 1, por_pagina: 100,
    });
  } catch (e) {
    console.error('[Simulador de Preços] erro ao listar SKUs de VM:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar os tamanhos de VM no momento.' });
  }
});

// Facetas do catálogo para a busca manual em dois níveis. Sem `produto`, devolve os PRODUTOS
// daquela categoria/região — que para Compute são as famílias de VM ("Virtual Machines Dsv5
// Series") e para Networking são serviços ("Azure Firewall"). Com `produto`, devolve os SKUs
// dele — que são os tamanhos de VM ("Standard_D4s_v5") ou os tiers do serviço ("Basic",
// "Standard", "Premium"). É o GROUP BY que o /buscar não faz, generalizado para qualquer tipo.
app.get('/api/public/price-simulator/facetas', _priceSimPublicoLimiter, _portalMiddleware, dbMiddleware, async (req, res) => {
  try {
    if (!req.portalCfg.price_simulator_ativo) return res.status(403).json({ error: 'Simulador de Preços desativado' });
    const { categoria, regiao, produto, nivel } = req.query;
    const params = []; const cond = [`type = 'Consumption'`, `COALESCE(retail_price_brl, retail_price, 0) > 0`];
    if (categoria) { cond.push(`service_family = $${params.length + 1}`); params.push(categoria); }
    if (regiao)    { cond.push(`arm_region_name = $${params.length + 1}`); params.push(regiao); }
    if (produto)   { cond.push(`product_name = $${params.length + 1}`); params.push(produto); }
    // nivel=catalogo devolve TODOS os produtos da região de uma vez, com a categoria de cada
    // um, para o assistente montar as caixas de serviço. O agrupamento produto→serviço é feito
    // no cliente, porque o catálogo não tem o nome do serviço: a Azure Retail Prices API expõe
    // `serviceName` ("Virtual Machines"), mas o sync grava só `serviceFamily` ("Compute") —
    // a coluna `meter_category` existe no schema e fica sempre nula, já que a API não devolve
    // esse campo.
    const catalogo = nivel === 'catalogo';
    const campo = produto ? 'sku_name' : 'product_name';
    const r = await pool.query(
      `SELECT ${campo} AS nome, COUNT(*) AS meters, MIN(${_SQL_PRECO_BRL}) AS preco_min
              ${catalogo ? ', service_family AS categoria' : ''}
       FROM azure_price_list
       WHERE ${cond.join(' AND ')} AND ${campo} IS NOT NULL AND ${campo} <> ''
       GROUP BY ${campo}${catalogo ? ', service_family' : ''}
       ORDER BY ${campo}
       LIMIT ${catalogo ? 2000 : 500}`,
      params
    );
    res.json({
      nivel: catalogo ? 'catalogo' : produto ? 'sku' : 'produto',
      itens: r.rows.map((x) => ({
        nome: x.nome, meters: parseInt(x.meters, 10), preco_min: Number(x.preco_min),
        ...(catalogo ? { categoria: x.categoria } : {}),
      })),
    });
  } catch (e) {
    console.error('[Simulador de Preços] erro ao listar facetas:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar as opções no momento.' });
  }
});

// Middleware do login PARALELO do portal (ver /api/public/auth/entra/url) — exige
// `payload.portal === true`, nunca aceita um JWT do app interno (e o inverso: authMiddleware
// das rotas internas não tem por que checar esse claim, mas aqui SEMPRE se checa, fechando o
// isolamento nos dois sentidos). Popula `req.portalUser = { email, nome }`.
function _portalEntraMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.portal) return res.status(401).json({ error: 'Token inválido.' });
    req.portalUser = { email: payload.email, nome: payload.nome };
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
}

// GET /api/public/genie-cotas — visão PESSOAL de cota Genie no portal público (2026-09-28,
// pedido do usuário). Diferente de /api/public/orfaos: não depende de portal_config.ativo
// nem de allowlist do admin — a proteção é o próprio login Entra ID (_portalEntraMiddleware),
// e o filtro é sempre pelo e-mail autenticado, nunca de query string. Só devolve dados do
// PRÓPRIO usuário — nunca a lista de outros workspaces/usuários (isso é exclusivo da tela
// interna, DatabricksCotasPanel.tsx).
app.get('/api/public/genie-cotas', _portalEntraMiddleware, dbMiddleware, async (req, res) => {
  try {
    const pcfg = await _getPortalConfig();
    if (!pcfg.ativo || !pcfg.genie_cotas_ativo) return res.status(403).json({ error: 'Minha Cota Genie desativada' });

    const usuario = req.portalUser.email;
    const bs = (await pool.query(`SELECT * FROM databricks_budgets WHERE ativo = true`)).rows;
    const consUser = await pool.query(
      `SELECT workspace_id, COALESCE(SUM(custo_estimado),0) AS custo
         FROM databricks_consumo
        WHERE COALESCE(usuario,'') = $1 AND sku_name ILIKE '%GENIE%'
        GROUP BY workspace_id`,
      [usuario]
    );

    const workspaces = await Promise.all(consUser.rows.map(async (r) => {
      const wsId = r.workspace_id;
      const custo = parseFloat(r.custo);
      const b = bs.find(x => (x.escopo_tipo === 'usuario' && x.usuario === usuario && x.workspace_id === wsId)
        || (x.escopo_tipo === 'usuario' && x.usuario === usuario && !x.workspace_id)
        || (x.escopo_tipo === 'workspace_por_usuario' && x.workspace_id === wsId));
      const limiteLocal = b ? parseFloat(b.valor_mensal) : null;

      const serieRows = await pool.query(
        `SELECT to_char(usage_date,'YYYY-MM-DD') AS dia,
                COALESCE(SUM(custo_estimado),0) AS custo,
                COALESCE(SUM(usage_quantity),0) AS dbus,
                COALESCE(SUM(CASE WHEN sku_name ILIKE '%FREE%' OR custo_estimado = 0 THEN usage_quantity ELSE 0 END),0) AS dbus_free
           FROM databricks_consumo
          WHERE COALESCE(usuario,'') = $1 AND workspace_id = $2 AND sku_name ILIKE '%GENIE%'
          GROUP BY 1 ORDER BY 1`,
        [usuario, wsId]
      );

      const quotaNativa = await _resolverGenieQuotaUsuario(usuario, wsId);

      return {
        workspace_id: wsId,
        custo,
        limite_local: limiteLocal,
        quota_nativa: quotaNativa.limite,
        acao_nativa: quotaNativa.acao,
        dias: serieRows.rows.map(x => ({
          dia: x.dia, custo: parseFloat(x.custo),
          dbus: parseFloat(x.dbus), dbus_free: parseFloat(x.dbus_free),
        })),
      };
    }));

    res.json({ ativo: true, nome: req.portalUser.nome, workspaces });
  } catch (e) {
    console.error('[Portal Genie Cotas] erro:', e.message);
    res.status(500).json({ error: 'Não foi possível carregar sua cota Genie no momento.' });
  }
});

// ── GET /api/admin/portal-config/orfaos-opcoes ────────────────────────────────
// Alimenta a tela de configuração do portal: tipos válidos e Resource Groups que têm órfãos.
app.get('/api/admin/portal-config/orfaos-opcoes', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const { subs } = await _getInventarioSpConfig();
    const cache = await _getDesperdicioCached(subs, 90);
    const rgMap = new Map();
    for (const x of cache) {
      if (!x.resource_group) continue;
      const k = String(x.subscription_id).toLowerCase() + '::' + String(x.resource_group).toUpperCase();
      const e = rgMap.get(k) || { subscription_id: x.subscription_id, resource_group: x.resource_group, itens: 0 };
      e.itens++;
      rgMap.set(k, e);
    }
    res.json({
      categorias: Object.entries(_DESP_LABEL_XLSX).map(([id, label]) => ({ id, label })),
      resource_groups: Array.from(rgMap.values()).sort((a, b) => a.resource_group.localeCompare(b.resource_group)),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── POST /api/public/calculadora/identificar ──────────────────────────────────
app.post('/api/public/calculadora/identificar', _portalMiddleware, async (req, res) => {
  try {
    const { nome, email } = req.body || {};
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'E-mail inválido.' });

    const dominios = req.portalCfg.dominios_aceitos || [];
    if (dominios.length) {
      const dominio = email.split('@')[1].toLowerCase();
      const aceito  = dominios.some(d => d.toLowerCase() === dominio);
      if (!aceito) return res.status(403).json({ error: `Domínio @${dominio} não autorizado para este portal.` });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    await pool.query(
      `INSERT INTO portal_acessos (nome, email, ip, user_agent) VALUES ($1, $2, $3, $4)`,
      [nome.trim(), email.trim().toLowerCase(), ip, ua]
    );
    console.log(`[Portal] Acesso identificado — ${nome.trim()} <${email.trim().toLowerCase()}> IP:${ip}`);
    res.json({ ok: true, nome: nome.trim(), email: email.trim().toLowerCase() });
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/admin/portal-acessos ────────────────────────────────────────────
app.get('/api/admin/portal-acessos', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 100), 500);
    const { rows } = await pool.query(
      `SELECT id, nome, email, ip, acessado_em FROM portal_acessos ORDER BY acessado_em DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/public/calculadora/subscriptions ────────────────────────────────
app.get('/api/public/calculadora/subscriptions', _portalMiddleware, _calculadoraAtivaMiddleware, async (req, res) => {
  try {
    const { subscription_ids } = req.portalCfg;
    if (!subscription_ids.length) return res.json([]);
    const r = await pool.query(`
      SELECT subscription_id, subscription_name, periodo_inicio, periodo_fim, moeda
      FROM azure_subs_cache
      WHERE subscription_id = ANY($1)
      ORDER BY subscription_name
    `, [subscription_ids]);
    // fallback direto na azure_costs se cache vazio
    if (!r.rows.length) {
      const rf = await pool.query(`
        SELECT subscription_id, MAX(subscription_name) AS subscription_name,
               MIN(cost_date) AS periodo_inicio, MAX(cost_date) AS periodo_fim,
               MIN(billing_currency) AS moeda
        FROM azure_costs
        WHERE subscription_id = ANY($1)
        GROUP BY subscription_id ORDER BY MAX(subscription_name)
      `, [subscription_ids]);
      return res.json(rf.rows);
    }
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/public/calculadora/resource-groups ──────────────────────────────
app.get('/api/public/calculadora/resource-groups', _portalMiddleware, _calculadoraAtivaMiddleware, async (req, res) => {
  try {
    const { subscription_ids = [], resource_groups = [] } = req.portalCfg;
    const { subscription_id } = req.query;
    const cond = []; const params = [];
    if (subscription_id) {
      const ids = subscription_id.split(',').map(s => s.trim()).filter(Boolean);
      // valida que são subs permitidas
      const allowed = ids.filter(id => subscription_ids.includes(id));
      if (!allowed.length) return res.json([]);
      cond.push(`subscription_id = ANY($${params.length+1})`); params.push(allowed);
    } else {
      if (!subscription_ids.length) return res.json([]);
      cond.push(`subscription_id = ANY($${params.length+1})`); params.push(subscription_ids);
    }
    if (resource_groups.length) {
      cond.push(`UPPER(resource_group_name) = ANY($${params.length+1})`);
      params.push(resource_groups.map(rg => rg.toUpperCase()));
    }
    // Bug real corrigido: diferente de GET /api/calculadora/resource-groups (privado), que já
    // tenta azure_rg_cache primeiro, esse endpoint público sempre ia direto pra um GROUP BY
    // completo em azure_costs (1.2M+ linhas) — reportado pelo usuário como demora perceptível
    // ao selecionar a assinatura no Portal Público (medido: ~7-8s por requisição).
    let rows = [];
    try {
      const cacheCond = [...cond];
      const cacheParams = [...params];
      if (resource_groups.length) {
        cacheCond[cacheCond.length - 1] = `resource_group_name_upper = ANY($${cacheParams.length})`;
      }
      const rc = await pool.query(`
        SELECT COALESCE(resource_group_name, resource_group_name_upper) AS resource_group_name, subscription_id, moeda
        FROM azure_rg_cache WHERE ${cacheCond.join(' AND ')}
        ORDER BY resource_group_name_upper LIMIT 500
      `, cacheParams);
      rows = rc.rows;
    } catch (_) {}
    if (!rows.length) {
      const r = await pool.query(`
        SELECT DISTINCT UPPER(resource_group_name) AS resource_group_name_upper,
               MAX(resource_group_name) AS resource_group_name,
               MAX(subscription_id) AS subscription_id
        FROM azure_costs
        WHERE ${cond.join(' AND ')} AND resource_group_name IS NOT NULL
        GROUP BY UPPER(resource_group_name)
        ORDER BY resource_group_name
        LIMIT 500
      `, params);
      rows = r.rows;
    }
    const withManaged = rows.map(row => ({ ...row, ..._detectManagedRg(row.resource_group_name) }));
    const effSubs = subscription_ids.length ? subscription_ids : [];
    res.json(await _resolveParentRgs(withManaged, effSubs));
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/public/calculadora/recursos ─────────────────────────────────────
// Reutiliza lógica do endpoint privado mas valida filtros pelo portalCfg
app.get('/api/public/calculadora/recursos', _portalMiddleware, _calculadoraAtivaMiddleware, async (req, res) => {
  try {
    const { subscription_ids: allowedSubs = [], resource_groups: allowedRGs = [] } = req.portalCfg;
    const { subscription_id, resource_group, data_inicio, data_fim } = req.query;

    // Validação: só permite subs/RGs configurados pelo admin
    const reqSubs = subscription_id ? subscription_id.split(',').map(s => s.trim()).filter(Boolean) : [];
    const filteredSubs = reqSubs.length
      ? reqSubs.filter(id => allowedSubs.includes(id))
      : allowedSubs;
    if (!filteredSubs.length) return res.json([]);

    const reqRGs = resource_group ? resource_group.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    const filteredRGs = reqRGs.length
      ? reqRGs.filter(rg => !allowedRGs.length || allowedRGs.map(r => r.toUpperCase()).includes(rg))
      : allowedRGs.map(r => r.toUpperCase());

    // Monta query reutilizando a mesma lógica — repassa como query params válidos
    req.query.subscription_id = filteredSubs.join(',');
    if (filteredRGs.length) req.query.resource_group = filteredRGs.join(',');
    if (data_inicio) req.query.data_inicio = data_inicio;
    if (data_fim)    req.query.data_fim    = data_fim;

    // Delega para o handler privado reutilizando a mesma função de query
    // (chama o próximo handler via internal forward — evita duplicar SQL)
    req.url = '/api/calculadora/recursos' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    req._portalForward = true;
    res._portalDelegateDone = false;

    // Executa a lógica do endpoint privado diretamente
    const _buildRecursosQuery = async (queryReq, queryRes) => {
      // re-usa o mesmo handler registrado — forward interno
      const handler = app._router.stack
        .filter(l => l.route && l.route.path === '/api/calculadora/recursos')
        .map(l => l.route.stack[l.route.stack.length - 1].handle)[0];
      if (handler) await handler(queryReq, queryRes, () => {});
    };
    await _buildRecursosQuery(req, res);
  } catch (e) { _dbErr(res, e); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALCULADORA PRIVADA
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/calculadora/subscriptions ───────────────────────────────────────
// Imposto travado da Calculadora interna (2026-09-28): mesma taxa/trava que o Portal Público já
// usa (`GET /api/public/calculadora/config`), liberada aqui pra qualquer usuário logado (não só
// admin) poder ver o valor sem poder editá-lo — o campo da Calculadora deixou de aceitar
// sobreposição por sessão.
app.get('/api/configuracoes/taxa-imposto', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const [taxa_imposto, impostoCfg] = await Promise.all([_getTaxaImposto(), _getImpostoConfig()]);
    res.json({ taxa_imposto, imposto_microsoft: impostoCfg.microsoft, imposto_marketplace: impostoCfg.marketplace });
  } catch (e) { _dbErr(res, e); }
});

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
  } catch (err) { _dbErr(res, err); }
});

// ── Helper: detecta RGs gerenciados (AKS, Databricks) ────────────────────────
function _detectManagedRg(name) {
  if (!name) return {};
  const upper = name.toUpperCase();
  if (upper.startsWith('DATABRICKS-RG-')) {
    // databricks-rg-{workspace}-{randomId}
    const bare = name.slice('databricks-rg-'.length);
    const lastDash = bare.lastIndexOf('-');
    const workspace = lastDash > 0 ? bare.slice(0, lastDash) : bare;
    return { managed_type: 'databricks', managed_label: workspace };
  }
  if (upper.startsWith('MANAGED-RG-ADBX-')) {
    // managed-rg-adbx-{workspace}-{randomSuffix}
    const bare = name.slice('managed-rg-adbx-'.length);
    const lastDash = bare.lastIndexOf('-');
    const workspace = lastDash > 0 ? bare.slice(0, lastDash) : bare;
    return { managed_type: 'databricks', managed_label: workspace };
  }
  if (upper.startsWith('MANAGED-RG-')) {
    // managed-rg-{suffix} — padrão genérico (ex: MANAGED-RG-DBW-*, MANAGED-RG-ADB-*)
    // managed_label = sufixo completo; parent resolvido por substring em _resolveParentRgs
    const bare = name.slice('managed-rg-'.length);
    return { managed_type: 'databricks', managed_label: bare };
  }
  if (upper.startsWith('MC_')) {
    // MC_{resourceGroup}_{clusterName}_{location}
    const inner = name.slice(3);
    const parts  = inner.split('_');
    const cluster = parts.length >= 2 ? parts[parts.length - 2] : inner;
    const region  = parts.length >= 1 ? parts[parts.length - 1] : '';
    return { managed_type: 'aks', managed_label: cluster, managed_region: region };
  }
  return {};
}

// Lista de RGs gerenciados por Databricks/AKS, cacheada (2026-09-04, achado real do code
// review) — antes desta extração, o mesmo bloco de 4 linhas (SELECT DISTINCT + classificar
// via _detectManagedRg + toUpperCase) estava duplicado em 3 lugares (GET /crescimento-liquido,
// GET /crescimento-detalhe, _computeAnomaliasCrescimentoRaw), cada um refazendo a mesma query
// + classificação a cada chamada. Mesmo padrão de TTL + dedup por promise em andamento já
// usado em `_advisorCache`/`_anomaliasCrescimentoCache` — TTL de 15min é seguro (nome de RG
// não muda a cada minuto). Deliberadamente NÃO usado por `_computeRelatorioDiarioInventario`
// — essa função classifica RGs a partir de `azure_recursos_auditoria_eventos` com filtro de
// data (universo mais estreito, não uma duplicata pura); trocar a fonte mudaria os números já
// verificados contra dado real.
const _RGS_GERENCIADOS_TTL = 15 * 60 * 1000;
let _rgsGerenciadosCache = null; // { lista, ts }
let _rgsGerenciadosPromise = null;
async function _getRgsGerenciados() {
  if (_rgsGerenciadosCache && (Date.now() - _rgsGerenciadosCache.ts) < _RGS_GERENCIADOS_TTL) {
    return _rgsGerenciadosCache.lista;
  }
  if (_rgsGerenciadosPromise) return _rgsGerenciadosPromise;
  _rgsGerenciadosPromise = (async () => {
    try {
      const rgRows = await pool.query(`SELECT DISTINCT resource_group FROM azure_recursos_inventario WHERE resource_group IS NOT NULL`);
      const lista = rgRows.rows
        .map((r) => r.resource_group)
        .filter((rg) => _detectManagedRg(rg).managed_type)
        .map((rg) => rg.toUpperCase());
      _rgsGerenciadosCache = { lista, ts: Date.now() };
      return lista;
    } finally {
      _rgsGerenciadosPromise = null;
    }
  })();
  return _rgsGerenciadosPromise;
}

// ── Helper: resolve parent_rg para RGs gerenciados (AKS e Databricks) ────────
// rows: array já com managed_type/managed_label; subs: string[] de subscription_ids para filtrar query

// Cache do mapa workspace→parent (query pesada com LIKE em 10M+ linhas)
let _dbWsCache = null;
let _dbWsCacheTs = 0;
const _DB_WS_TTL = 30 * 60 * 1000; // 30 min — workspaces mudam raramente

async function _resolveParentRgs(rows, subs) {
  if (!rows.length) return rows;

  // Conjunto de RGs não-gerenciados (uppercase) — base para matching AKS
  const normalRgs = new Set(
    rows.filter(r => !r.managed_type).map(r => (r.resource_group_name || '').toUpperCase())
  );

  // Mapa workspace_lower → parent_rg_upper para Databricks (via resource_id no billing)
  // Cache carregado em startup e atualizado pelo _refreshAzureCache (90s delay).
  // Se cache ainda não está disponível, retorna RGs sem parent mapping (evita query pesada por-request).
  let workspaceToParent = new Map();
  if (rows.some(r => r.managed_type === 'databricks')) {
    const now = Date.now();
    if (_dbWsCache && (now - _dbWsCacheTs) < _DB_WS_TTL) {
      workspaceToParent = _dbWsCache;
    }
    // Cache não disponível: retorna sem parent mapping — _refreshAzureCache popula em 90s
  }

  return rows.map(r => {
    if (!r.managed_type) return r;
    const upper = (r.resource_group_name || '').toUpperCase();
    let parent_rg = null;

    if (r.managed_type === 'aks') {
      // MC_{parent_rg}_{cluster}_{location} — encontra o maior RG conhecido que é prefixo do interior
      const inner = upper.startsWith('MC_') ? upper.slice(3) : upper;
      for (const rg of normalRgs) {
        if (inner.startsWith(rg + '_') && (!parent_rg || rg.length > parent_rg.length)) {
          parent_rg = rg;
        }
      }
    } else if (r.managed_type === 'databricks') {
      // Método 1: compara nome do managed RG contra padrão databricks-rg-{ws} / managed-rg-adbx-{ws}
      // usando workspace names vindos da query no billing (resource_id com /workspaces/)
      const rgLower = (r.resource_group_name || '').toLowerCase();
      for (const [wsLower, parentRgUpper] of workspaceToParent) {
        if (!wsLower) continue;
        if (rgLower === 'databricks-rg-' + wsLower ||
            rgLower.startsWith('databricks-rg-' + wsLower + '-') ||
            rgLower === 'managed-rg-adbx-' + wsLower ||
            rgLower.startsWith('managed-rg-adbx-' + wsLower + '-') ||
            rgLower === 'managed-rg-' + wsLower ||
            rgLower.startsWith('managed-rg-' + wsLower + '-')) {
          parent_rg = parentRgUpper;
          break;
        }
      }
      // Método 2 (exact): managed_label bate exatamente com um RG não-gerenciado
      if (!parent_rg) {
        const labelUpper = (r.managed_label || '').toUpperCase();
        if (labelUpper && normalRgs.has(labelUpper)) parent_rg = labelUpper;
      }
      // Método 3 (suffix): RG pai TERMINA COM o managed_label
      // Ex: MANAGED-RG-DBW-X → label=DBW-X → pai RG-DBW-X (termina com -DBW-X)
      // Mais confiável que substring — sem risco de falso-positivo em nomes parecidos
      if (!parent_rg) {
        const labelUpper = (r.managed_label || '').toUpperCase();
        if (labelUpper && labelUpper.length >= 6) {
          let best = null, bestLen = Infinity;
          for (const rg of normalRgs) {
            if ((rg.endsWith('-' + labelUpper) || rg.endsWith('_' + labelUpper)) &&
                rg.length < bestLen) {
              bestLen = rg.length; best = rg;
            }
          }
          if (best) parent_rg = best;
        }
      }
      // Método 4 (prefix): managed_label é prefixo do nome do RG pai
      if (!parent_rg) {
        const labelUpper = (r.managed_label || '').toUpperCase();
        if (labelUpper) {
          let best = null;
          for (const rg of normalRgs) {
            if ((rg.startsWith(labelUpper + '-') || rg.startsWith(labelUpper + '_')) &&
                (!best || rg.length < best.length)) {
              best = rg;
            }
          }
          if (best) parent_rg = best;
        }
      }
      // Método 5 (substring): managed_label está contido em algum RG normal — menor wins
      if (!parent_rg) {
        const labelUpper = (r.managed_label || '').toUpperCase();
        if (labelUpper && labelUpper.length >= 6) {
          let best = null, bestLen = Infinity;
          for (const rg of normalRgs) {
            if (rg.includes(labelUpper) && rg.length < bestLen) {
              bestLen = rg.length; best = rg;
            }
          }
          if (best) parent_rg = best;
        }
      }
      // Método 6 (substring sem prefixo "DBW-"): achado real — alguns workspaces têm
      // "DBW-" (Databricks Workspace) no nome do RG gerenciado (ex: DATABRICKS-RG-DBW-DTFN-DEV)
      // sem que o RG pai real repita esse prefixo (RG-DTFN-BRSOUTH-DEV, sem "DBW-" nenhum) —
      // diferente do padrão onde pai e filho REPETEM "DBW-" nos dois lados (RG-DBW-X /
      // MANAGED-RG-DBW-X, já resolvido pelo Método 3 acima). Sem isso, esses caíam sem parent_rg
      // mesmo com o pai presente e o token restante (ex: "DTFN") identificando só 1 candidato.
      if (!parent_rg) {
        const labelUpper = (r.managed_label || '').toUpperCase();
        if (labelUpper.startsWith('DBW-')) {
          const semDbw = labelUpper.slice(4);
          if (semDbw.length >= 4) {
            let best = null, bestLen = Infinity;
            for (const rg of normalRgs) {
              if (rg.includes(semDbw) && rg.length < bestLen) {
                bestLen = rg.length; best = rg;
              }
            }
            if (best) parent_rg = best;
          }
        }
      }
      // Persiste mapeamento encontrado em azure_ws_cache para acelerar requisições futuras
      if (parent_rg && pool) {
        const wsKey = (r.resource_group_name || '').toUpperCase();
        pool.query(
          `INSERT INTO azure_ws_cache (ws_name, parent_rg) VALUES ($1, $2)
           ON CONFLICT (ws_name) DO UPDATE SET parent_rg = EXCLUDED.parent_rg`,
          [wsKey, parent_rg]
        ).catch(() => {});
      }
    }

    return { ...r, parent_rg };
  });
}

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
      const rc = await pool.query(`SELECT COALESCE(resource_group_name, resource_group_name_upper) AS resource_group_name, moeda FROM azure_rg_cache ${where} ORDER BY resource_group_name_upper LIMIT 1000`, params);
      rows = rc.rows;
    } catch (_) {}
    // Fallback: cache vazio — lê direto
    if (!rows.length) {
      console.warn('[ResourceGroups] cache vazio — fallback para query direta em azure_costs');
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
    const withManaged = rows.map(r => ({ ...r, ..._detectManagedRg(r.resource_group_name) }));
    const subs = subscription_id ? subscription_id.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json(await _resolveParentRgs(withManaged, subs));
  } catch (err) {
    _dbErr(res, err);
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
          SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS microsoft,
          SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type = 'Marketplace')                AS marketplace
        FROM azure_costs ${where}
        GROUP BY charge_type
        ORDER BY SUM(COALESCE(cost_in_billing_currency, 0)) DESC
      `, params),
      pool.query(`
        SELECT
          COALESCE(billing_currency, 'USD') AS moeda,
          SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS microsoft,
          SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type = 'Marketplace')                AS marketplace
        FROM azure_costs ${where}
        GROUP BY billing_currency
        ORDER BY (SUM(COALESCE(cost_in_billing_currency, 0))) DESC
      `, params),
    ]);

    // SEM imposto, de propósito (ver comentário de _normImpostoCategoria/_getImpostoConfig) —
    // esta tela compara o total do banco contra a fatura/Cost Management da Azure, que não
    // inclui o imposto configurável; aplicar aqui invalidaria a própria comparação.
    const excluidos = ['Tax', 'Refund', 'RoundingAdjustment'];
    const porTipo = rTipo.rows.map(r => ({
      charge_type: r.charge_type,
      linhas:      parseInt(r.linhas, 10),
      total:       Number(r.microsoft || 0) + Number(r.marketplace || 0),
      excluido:    excluidos.includes(r.charge_type),
    }));

    const totalBruto    = porTipo.reduce((s, r) => s + r.total, 0);
    const totalExcluido = porTipo.filter(r => r.excluido).reduce((s, r) => s + r.total, 0);
    const totalSistema  = totalBruto - totalExcluido;

    res.json({
      por_tipo:        porTipo,
      por_moeda:       rMoeda.rows.map(r => ({ moeda: r.moeda, total: Number(r.microsoft || 0) + Number(r.marketplace || 0) })),
      total_bruto:     totalBruto,
      total_excluido:  totalExcluido,
      total_sistema:   totalSistema,
    });
  } catch (err) {
    _dbErr(res, err);
  }
});

// ── GET /api/calculadora/recursos ────────────────────────────────────────────
// Aceita subscription_id e resource_group como valores separados por vírgula
app.get('/api/calculadora/recursos', authMiddleware, dbMiddleware, async (req, res) => {
  console.log(`[Recursos] requisição recebida — sub=${req.query.subscription_id} rg=${req.query.resource_group} inicio=${req.query.data_inicio} fim=${req.query.data_fim}`);
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

    const where    = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const andCond  = cond.length ? 'AND '   + cond.join(' AND ') : '';

    // pico=1 opt-in: pico CTEs são pesados (2 table scans extras) — omitidos por padrão
    // Cliente solicita &pico=1 apenas ao abrir Configurar Estimativa (lazy load)
    const comPico = req.query.pico === '1';

    const _picoCtes = comPico ? `
      -- ── CTE pico_periodo: maior custo diário ÷ horas reais naquele dia ──────────
      pico_periodo AS (
        SELECT DISTINCT ON (resource_id, _uom)
          resource_id, _uom, cost_date AS pico_data, custo_dia AS pico_custo_dia,
          horas_dia AS pico_horas_dia,
          CASE
            WHEN (_uom ILIKE '%hour%' OR _uom ILIKE '%hora%' OR _uom ILIKE '%day%') AND horas_dia > 0
            THEN ROUND(custo_dia::numeric / NULLIF(horas_dia, 0), 8)
            ELSE ROUND(custo_dia::numeric / 24.0, 8)
          END AS custo_hora_pico
        FROM (
          SELECT resource_id, COALESCE(unit_of_measure, '') AS _uom, cost_date,
            SUM(COALESCE(cost_in_billing_currency, 0)) AS custo_dia,
            SUM(COALESCE(quantity, 0)
              * GREATEST(COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(unit_of_measure,''), '[^0-9]', '', 'g'),'')::numeric, 1.0), 1.0)
              * CASE WHEN COALESCE(unit_of_measure,'') ILIKE '%day%' THEN 24.0 ELSE 1.0 END
            ) AS horas_dia
          FROM azure_costs ${where}
          GROUP BY resource_id, COALESCE(unit_of_measure, ''), cost_date
        ) daily_p
        ORDER BY resource_id, _uom, custo_dia DESC
      ),
      -- ── CTE pico_databricks: pico do cluster inteiro (RG) no período selecionado ──
      pico_databricks AS (
        SELECT DISTINCT ON (rg) rg, pico_data, pico_custo_rg, pico_h_driver,
          ROUND(pico_custo_rg::numeric / NULLIF(pico_h_driver, 0), 8) AS custo_hora_pico_cluster
        FROM (
          SELECT UPPER(resource_group_name) AS rg, cost_date AS pico_data,
            SUM(COALESCE(cost_in_billing_currency, 0)) AS pico_custo_rg,
            MAX(CASE WHEN unit_of_measure ILIKE '%hour%' OR unit_of_measure ILIKE '%hora%'
              THEN COALESCE(quantity, 0)
                * GREATEST(COALESCE(NULLIF(REGEXP_REPLACE(unit_of_measure,'[^0-9]','','g'),'')::numeric,1.0),1.0)
              ELSE NULL END) AS pico_h_driver
          FROM azure_costs
          -- Mesmos 3 padrões de RG gerenciado por Databricks que _detectManagedRg() reconhece
          -- (DATABRICKS-RG-*, MANAGED-RG-ADBX-*, MANAGED-RG-* genérico — ex: MANAGED-RG-DBW-*
          -- que a Vivo usa em produção); MANAGED-RG-ADBX-% já é subconjunto de MANAGED-RG-%.
          WHERE (UPPER(resource_group_name) LIKE 'DATABRICKS-RG-%' OR UPPER(resource_group_name) LIKE 'MANAGED-RG-%')
            ${andCond}
          GROUP BY UPPER(resource_group_name), cost_date
        ) daily_db
        WHERE pico_h_driver IS NOT NULL AND pico_h_driver > 0
        ORDER BY rg, pico_custo_rg DESC
      )` : `
      pico_periodo AS (SELECT NULL::text AS resource_id, NULL::text AS _uom, NULL::date AS pico_data,
        NULL::numeric AS pico_custo_dia, NULL::numeric AS pico_horas_dia, NULL::numeric AS custo_hora_pico WHERE false),
      pico_databricks AS (SELECT NULL::text AS rg, NULL::date AS pico_data,
        NULL::numeric AS pico_custo_rg, NULL::numeric AS pico_h_driver, NULL::numeric AS custo_hora_pico_cluster WHERE false)`;

    const _t0 = Date.now();

    // Conexão dedicada com workers paralelos e work_mem elevado para o GROUP BY complexo
    console.log(`[Recursos] aguardando conexão do pool...`);
    const _conn = await pool.connect();
    console.log(`[Recursos] conexão obtida — executando query...`);
    let r;
    try {
      await _conn.query(`SET statement_timeout = '120s'`);
      await _conn.query(`SET max_parallel_workers_per_gather = 4`);
      await _conn.query(`SET work_mem = '256MB'`);
      r = await _conn.query(`
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
          -- ── TIPO DE CUSTO (RN-001 a RN-005) ──────────────────────────────────
          CASE
            WHEN MAX(COALESCE(charge_type,'')) IN ('Purchase','RoundTrustBill')
                 AND MAX(COALESCE(pricing_model,'')) = 'Reservation'
            THEN 'reserva'
            WHEN MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%'
            THEN 'hora'
            WHEN MAX(unit_of_measure) ILIKE '%day%'
            THEN 'dia'
            WHEN MAX(unit_of_measure) ILIKE '%month%'
                 AND MAX(unit_of_measure) NOT ILIKE '%gb%'
                 AND MAX(unit_of_measure) NOT ILIKE '%gib%'
                 AND MAX(unit_of_measure) NOT ILIKE '%tib%'
                 AND MAX(unit_of_measure) NOT ILIKE '%tb%'
            THEN 'mes'
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
          -- RN-006: Cost ÷ Qty = taxa real por unidade nativa (R$/GB, R$/10K tx, etc.)
          -- Regra: divide custo total pela quantidade faturada → taxa audível e infalível
          ROUND(SUM(COALESCE(cost_in_billing_currency,0))::numeric
                / NULLIF(SUM(COALESCE(quantity,0)), 0), 8)   AS custo_uom_billing,
          ROUND(SUM(COALESCE(cost_in_usd,0))::numeric
                / NULLIF(SUM(COALESCE(quantity,0)), 0), 8)   AS custo_uom_usd,
          -- RN-007: Flag RI/SP coberto — cost_in_billing=0 mas effective_price>0
          -- VMs cobertas por Reserva ou Savings Plan: custo real está no effective_price (amortizado)
          CASE
            WHEN SUM(COALESCE(cost_in_billing_currency,0)) = 0
                 AND SUM(COALESCE(NULLIF(effective_price,0), unit_price, 0)
                         * COALESCE(quantity,0)) > 0
            THEN true ELSE false
          END AS usa_amortizado,
          -- Chaves para o JOIN com price list
          MAX(meter_id)                          AS _meter_id,
          MAX(COALESCE(billing_currency, 'BRL')) AS _currency
        FROM azure_costs
        ${where}
        GROUP BY resource_id,
                 COALESCE(meter_category,''),
                 COALESCE(meter_name,''),
                 COALESCE(unit_of_measure,'')
      ),
      -- ── RN-DB-001: soma_h_driver por RG Databricks (abordagem diária) ──────────
      -- H_driver_dia = MAX(horas_recurso) por dia → soma_h_driver = SUM(H_driver_dia)
      -- Mais preciso que MAX global para job-clusters que sobem/descem por sessão
      db_daily AS (
        SELECT
          UPPER(resource_group_name) AS rg,
          SUM(max_h)                 AS soma_h_driver
        FROM (
          SELECT
            UPPER(resource_group_name) AS resource_group_name,
            cost_date,
            MAX(
              CASE
                WHEN unit_of_measure ILIKE '%hour%' OR unit_of_measure ILIKE '%hora%'
                THEN COALESCE(quantity,0)
                  * GREATEST(COALESCE(NULLIF(REGEXP_REPLACE(unit_of_measure,'[^0-9]','','g'),'')::numeric,1.0),1.0)
                ELSE NULL
              END
            ) AS max_h
          FROM azure_costs
          -- Mesmos 3 padrões de RG gerenciado por Databricks que _detectManagedRg() reconhece
          -- (DATABRICKS-RG-*, MANAGED-RG-ADBX-*, MANAGED-RG-* genérico — ex: MANAGED-RG-DBW-*
          -- que a Vivo usa em produção); MANAGED-RG-ADBX-% já é subconjunto de MANAGED-RG-%.
          WHERE (UPPER(resource_group_name) LIKE 'DATABRICKS-RG-%' OR UPPER(resource_group_name) LIKE 'MANAGED-RG-%')
            ${andCond}
          GROUP BY UPPER(resource_group_name), cost_date
        ) daily
        WHERE max_h IS NOT NULL AND max_h > 0
        GROUP BY UPPER(resource_group_name)
      ),
      ${_picoCtes}
      SELECT
        base.resource_id,
        base._meter_id,
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
        base.usa_amortizado,
        -- RN-DB-001: soma dos MAX diários de horas por RG Databricks (abordagem diária)
        COALESCE(db.soma_h_driver, 0)              AS soma_h_driver,
        -- pico_databricks: pior dia do cluster inteiro (para autoscale)
        COALESCE(pdb.custo_hora_pico_cluster, 0)   AS custo_hora_pico_cluster,
        pdb.pico_data                              AS pico_cluster_data,
        pdb.pico_custo_rg                          AS pico_cluster_custo_rg,
        pdb.pico_h_driver                          AS pico_cluster_horas_dia,
        pp.custo_hora_pico,
        pp.pico_data,
        pp.pico_custo_dia,
        pp.pico_horas_dia,
        CASE
          WHEN base.dias_ativos < 30 AND COALESCE(db.soma_h_driver, 0) = 0
          THEN true ELSE false
        END AS usa_30d
      FROM base
      LEFT JOIN db_daily        db  ON db.rg  = base.resource_group_name
      LEFT JOIN pico_periodo    pp  ON pp.resource_id = base.resource_id
        AND pp._uom = COALESCE(base.unidade, '')
      LEFT JOIN pico_databricks pdb ON pdb.rg = base.resource_group_name
      ORDER BY base.resource_group_name, base.total_billing DESC
    `, params);
    } finally {
      _conn.release();
    }

    console.log(`[Recursos] ${r.rows.length} recursos — ${Date.now()-_t0}ms`);
    res.json(r.rows);
  } catch (err) {
    _dbErr(res, err);
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
  } catch (e) { _dbErr(res, e); }
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
        SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
        SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
      FROM azure_costs
      ${where}
      GROUP BY cost_date, subscription_id, resource_id, consumed_service, meter_name
      ORDER BY cost_date DESC, SUM(COALESCE(cost_in_billing_currency,0)) DESC
      LIMIT 15000
    `, params);
    const impostoCfgDD = await _getImpostoConfig();
    res.json(r.rows.map(({ custo_microsoft, custo_marketplace, ...rest }) => ({
      ...rest, cost: _comImpostoSplit(custo_microsoft, custo_marketplace, impostoCfgDD),
    })));
  } catch (err) {
    _dbErr(res, err);
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
        SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
        SUM(COALESCE(cost_in_billing_currency, 0)) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
      FROM azure_costs
      ${where}
      GROUP BY COALESCE(NULLIF(consumed_service,''), meter_category, 'Desconhecido')
      ORDER BY (SUM(COALESCE(cost_in_billing_currency, 0))) DESC
    `, params);
    const impostoCfgPS = await _getImpostoConfig();
    res.json(r.rows.map(({ custo_microsoft, custo_marketplace, ...rest }) => ({
      ...rest, total_brl: _comImpostoSplit(custo_microsoft, custo_marketplace, impostoCfgPS),
    })));
  } catch (err) {
    _dbErr(res, err);
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
    _dbErr(res, err);
  }
});

// ── GET /api/calculadora/diag-databricks ─────────────────────────────────────
// Compara abordagem atual (MAX global) vs melhorada (SUM de MAX diário) por RG
app.get('/api/calculadora/diag-databricks', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, data_inicio, data_fim } = req.query;
    if (!data_inicio || !data_fim) return res.status(400).json({ error: 'data_inicio e data_fim obrigatórios' });

    const params = [data_inicio, data_fim];
    const subCond = subscription_id ? `AND subscription_id = $${params.push(subscription_id) && params.length}` : '';

    const r = await pool.query(`
      WITH
      -- Granularidade: por RG + resource_id + dia
      daily_resource AS (
        SELECT
          UPPER(resource_group_name)  AS rg,
          resource_id,
          cost_date,
          SUM(COALESCE(cost_in_billing_currency, 0)) AS billing_dia,
          CASE
            WHEN MAX(unit_of_measure) ILIKE '%hour%' OR MAX(unit_of_measure) ILIKE '%hora%'
            THEN SUM(COALESCE(quantity,0))
              * GREATEST(COALESCE(NULLIF(REGEXP_REPLACE(MAX(unit_of_measure),'[^0-9]','','g'),'')::numeric,1.0),1.0)
            ELSE NULL
          END AS horas_dia
        FROM azure_costs
        WHERE cost_date BETWEEN $1 AND $2
          ${subCond}
          AND (UPPER(resource_group_name) LIKE 'DATABRICKS-RG-%' OR UPPER(resource_group_name) LIKE 'MANAGED-RG-ADBX-%')
        GROUP BY UPPER(resource_group_name), resource_id, cost_date
      ),
      -- Abordagem A (atual): MAX acumulado por recurso no período inteiro
      acumulado_por_recurso AS (
        SELECT
          rg,
          resource_id,
          SUM(billing_dia)  AS billing_total_vm,
          SUM(horas_dia)    AS horas_total_vm
        FROM daily_resource
        GROUP BY rg, resource_id
      ),
      abordagem_atual AS (
        SELECT
          rg,
          SUM(billing_total_vm)   AS c_total,
          MAX(horas_total_vm)     AS h_driver_atual,
          COUNT(DISTINCT resource_id) AS n_vms
        FROM acumulado_por_recurso
        GROUP BY rg
      ),
      -- Abordagem B (melhorada): MAX por dia, somado ao longo dos dias
      max_por_dia AS (
        SELECT
          rg,
          cost_date,
          SUM(billing_dia)  AS c_dia,
          MAX(horas_dia)    AS h_driver_dia,
          COUNT(DISTINCT resource_id) AS vms_dia
        FROM daily_resource
        GROUP BY rg, cost_date
      ),
      abordagem_diaria AS (
        SELECT
          rg,
          COUNT(cost_date)  AS dias_ativos,
          SUM(c_dia)        AS c_total_check,
          SUM(h_driver_dia) AS soma_h_driver,
          MAX(vms_dia)      AS max_vms_dia
        FROM max_por_dia
        GROUP BY rg
      )
      SELECT
        a.rg,
        a.c_total,
        a.n_vms,
        -- Abordagem atual
        a.h_driver_atual,
        ROUND(a.c_total / NULLIF(a.h_driver_atual,0), 4) AS taxa_atual,
        -- Abordagem melhorada
        d.dias_ativos,
        d.soma_h_driver,
        ROUND(a.c_total / NULLIF(d.soma_h_driver,0), 4)  AS taxa_diaria,
        d.max_vms_dia,
        -- Diferença %
        ROUND(100.0 * (
          (a.c_total / NULLIF(d.soma_h_driver,0)) -
          (a.c_total / NULLIF(a.h_driver_atual,0))
        ) / NULLIF(a.c_total / NULLIF(a.h_driver_atual,0), 0), 1) AS delta_pct
      FROM abordagem_atual a
      JOIN abordagem_diaria d ON a.rg = d.rg
      WHERE a.h_driver_atual >= 24 AND a.n_vms >= 2
      ORDER BY a.c_total DESC
    `, params);

    res.json({
      periodo: { data_inicio, data_fim },
      rgs: r.rows.map(row => ({
        rg:             row.rg,
        n_vms:          Number(row.n_vms),
        dias_ativos:    Number(row.dias_ativos),
        max_vms_dia:    Number(row.max_vms_dia),
        c_total:        Number(row.c_total),
        // abordagem atual
        h_driver_atual: Number(row.h_driver_atual),
        taxa_atual:     Number(row.taxa_atual),
        // abordagem melhorada
        soma_h_driver:  Number(row.soma_h_driver),
        taxa_diaria:    Number(row.taxa_diaria),
        // diferença
        delta_pct:      Number(row.delta_pct),
        comentario: Number(row.delta_pct) > 5
          ? 'job-cluster: taxa diária mais precisa'
          : Math.abs(Number(row.delta_pct)) <= 2
          ? 'all-purpose: ambas equivalentes'
          : 'diferença moderada'
      }))
    });
  } catch (e) {
    _dbErr(res, e);
  }
});

// ── GET /api/azure-costs/diag — Diagnóstico da tabela e cache ────────────────
app.get('/api/azure-costs/diag', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const [cnt, subs, rgs, sample, tags] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total,
                         COUNT(subscription_id) AS com_sub,
                         COUNT(cost_date) AS com_data,
                         COUNT(cost_in_billing_currency) AS com_custo,
                         MIN(cost_date) AS data_min,
                         MAX(cost_date) AS data_max
                  FROM azure_costs`).catch(() => null),
      pool.query(`SELECT COUNT(*) AS total FROM azure_subs_cache`).catch(() => null),
      pool.query(`SELECT COUNT(*) AS total FROM azure_rg_cache`).catch(() => null),
      pool.query(`SELECT * FROM azure_costs LIMIT 1`).catch(() => null),
      pool.query(`SELECT COUNT(*) AS total,
                         COUNT(tags) FILTER (WHERE tags IS NOT NULL AND tags NOT IN ('null','{}','')) AS com_tags,
                         (SELECT tags FROM azure_costs WHERE tags IS NOT NULL AND tags NOT IN ('null','{}','') LIMIT 1) AS amostra_tag
                  FROM azure_costs`).catch(() => null),
    ]);
    res.json({
      azure_costs:     { ...cnt?.rows[0] },
      subs_cache:      { total: subs?.rows[0]?.total ?? '?' },
      rg_cache:        { total: rgs?.rows[0]?.total  ?? '?' },
      colunas_amostra: sample?.rows[0] ? Object.keys(sample.rows[0]) : [],
      amostra_valores: sample?.rows[0] ? {
        subscription_id: sample.rows[0].subscription_id,
        cost_date:       sample.rows[0].cost_date,
        billing_currency:sample.rows[0].billing_currency,
        cost_in_billing_currency: sample.rows[0].cost_in_billing_currency,
      } : null,
      tags: tags?.rows[0] ? {
        total_linhas:  parseInt(tags.rows[0].total   ?? 0),
        com_tags:      parseInt(tags.rows[0].com_tags ?? 0),
        amostra:       tags.rows[0].amostra_tag ?? null,
      } : null,
    });
  } catch (e) { _dbErr(res, e); }
});

// ── POST /api/azure-costs/refresh-cache — Força rebuild do cache de dropdowns ─
app.post('/api/azure-costs/refresh-cache', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await _refreshAzureCache();
    const [subs, rgs] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM azure_subs_cache`),
      pool.query(`SELECT COUNT(*) AS total FROM azure_rg_cache`),
    ]);
    res.json({ ok: true, subs: parseInt(subs.rows[0].total), rgs: parseInt(rgs.rows[0].total) });
  } catch (e) { _dbErr(res, e); }
});

// ── GET /api/azure-costs/resumo — Sumário geral para o painel de expurgo
app.get('/api/azure-costs/resumo', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const now = Date.now();
    if (_resumoCache && (now - _resumoCacheTs) < _RESUMO_TTL) return res.json(_resumoCache);
    const [r, byMonth] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)                       AS total,
               MIN(cost_date)                 AS data_inicio,
               MAX(cost_date)                 AS data_fim,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace,
               MIN(billing_currency)          AS moeda
        FROM azure_costs
      `),
      pool.query(`
        SELECT TO_CHAR(cost_date,'YYYY-MM')   AS mes,
               COUNT(*)                       AS registros,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
               SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
        FROM azure_costs
        GROUP BY mes ORDER BY mes DESC LIMIT 24
      `)
    ]);
    const impostoCfgResumo = await _getImpostoConfig();
    const { custo_microsoft, custo_marketplace, ...resumoRest } = r.rows[0];
    const payload = {
      resumo: { ...resumoRest, total_billing: _comImpostoSplit(custo_microsoft, custo_marketplace, impostoCfgResumo) },
      por_mes: byMonth.rows.map(({ custo_microsoft: m, custo_marketplace: mp, ...rest }) => ({
        ...rest, total_billing: _comImpostoSplit(m, mp, impostoCfgResumo),
      })),
    };
    _resumoCache = payload;
    _resumoCacheTs = now;
    res.json(payload);
  } catch (err) { _dbErr(res, err); }
});

// ── GET /api/azure-costs/purge/preview — Conta registros antes de apagar
app.get('/api/azure-costs/purge/preview', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { data_inicio, data_fim, arquivo } = req.query;
    let q = 'SELECT COUNT(*) AS total FROM azure_costs WHERE 1=1';
    const params = [];
    if (arquivo)     { params.push(arquivo);     q += ` AND arquivo_origem = $${params.length}`; }
    if (data_inicio) { params.push(data_inicio); q += ` AND cost_date >= $${params.length}`; }
    if (data_fim)    { params.push(data_fim);    q += ` AND cost_date <= $${params.length}`; }
    const r = await pool.query(q, params);
    res.json({ total: parseInt(r.rows[0].total) });
  } catch (err) { _dbErr(res, err); }
});

// ── DELETE /api/azure-costs/purge — Expurgo de dados por período ou arquivo
app.delete('/api/azure-costs/purge', authMiddleware, dbMiddleware, async (req, res) => {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { arquivo, data_inicio, data_fim } = req.query;
      let removidos, msg;
      if (arquivo) {
        const r = await pool.query('DELETE FROM azure_costs WHERE arquivo_origem = $1', [arquivo]);
        removidos = r.rowCount;
        msg = `${removidos} registros do arquivo "${arquivo}" removidos.`;
      } else if (data_inicio || data_fim) {
        let q = 'DELETE FROM azure_costs WHERE 1=1';
        const params = [];
        if (data_inicio) { params.push(data_inicio); q += ` AND cost_date >= $${params.length}`; }
        if (data_fim)    { params.push(data_fim);    q += ` AND cost_date <= $${params.length}`; }
        const r = await pool.query(q, params);
        removidos = r.rowCount;
        msg = `${removidos} registros do período ${data_inicio || '—'} → ${data_fim || '—'} removidos.`;
      } else {
        // TRUNCATE evita deadlock com imports concorrentes (sem bloqueio por linha)
        const count = (await pool.query('SELECT COUNT(*) AS n FROM azure_costs')).rows[0].n;
        await pool.query('TRUNCATE TABLE azure_costs');
        removidos = parseInt(count);
        msg = `Todos os ${removidos} registros foram removidos.`;
      }
      _coberturaCache = null;
      _rgStatsCache = null; _rgStatsCacheTs = 0;
      pool.query('TRUNCATE TABLE azure_rg_stats').catch(() => {}); // os dados de billing foram apagados
      _resumoCache = null;
      _importsCache = null;
      console.log(`[Azure Purge] ${msg}`);
      _refreshAzureCache().catch(() => {});
      res.json({ message: msg, removidos });
      return;
    } catch (err) {
      const isDeadlock = err.code === '40P01';
      console.error(`[Azure Purge] Tentativa ${attempt}/${MAX_RETRIES}:`, err.message);
      if (!isDeadlock || attempt === MAX_RETRIES) {
        return res.status(500).json({ error: 'Erro interno do servidor.' });
      }
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
});

// ── GET /api/azure-costs/imports ─────────────────────────────────────────────
app.get('/api/azure-costs/imports', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const now = Date.now();
    if (_importsCache && (now - _importsCacheTs) < _RESUMO_TTL) return res.json(_importsCache);
    const r = await pool.query(`
      SELECT arquivo_origem, COUNT(*) AS linhas,
             MIN(cost_date) AS periodo_inicio, MAX(cost_date) AS periodo_fim,
             SUM(cost_in_usd) AS total_usd,
             SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
             SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace,
             MIN(billing_currency) AS moeda, MAX(importado_em) AS importado_em
      FROM azure_costs
      WHERE (fonte IS NULL OR fonte = 'manual')
        AND (arquivo_origem IS NULL OR arquivo_origem NOT LIKE 'api-%')
      GROUP BY arquivo_origem ORDER BY importado_em DESC
    `);
    const impostoCfgImports = await _getImpostoConfig();
    const rows = r.rows.map(({ custo_microsoft, custo_marketplace, ...rest }) => ({
      ...rest, total_billing: _comImpostoSplit(custo_microsoft, custo_marketplace, impostoCfgImports),
    }));
    _importsCache = rows;
    _importsCacheTs = now;
    res.json(rows);
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
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
  } catch (err) { _dbErr(res, err); }
});

app.put('/api/reservas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { cloud, nome_reserva, tipo_escopo, subscription_id, resource_group_name,
            tipo_recurso, instancia, quantidade, prazo, opcao_pagamento,
            custo_total, custo_mensal, data_inicio, data_vencimento, status, observacoes } = req.body;
    if (!cloud || !nome_reserva || !tipo_recurso || !data_vencimento)
      return res.status(400).json({ error: 'cloud, nome_reserva, tipo_recurso e data_vencimento são obrigatórios' });
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
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/reservas/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM reservas_cloud WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { _dbErr(res, err); }
});

// ── Sincronização de Reservas / Savings Plans direto da Azure (SP configurado) ─────────
// GET paginado (segue nextLink) no ARM. Erro HTTP vira exceção com o status anexado.
async function _armListAll(token, url) {
  const out = [];
  let next = url;
  while (next) {
    const resp = await _cbFetch(next, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 60_000 });
    if (!resp.ok) {
      const txt = await resp.text();
      const e = new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
      e.status = resp.status;
      throw e;
    }
    const data = await _safeRespJson(resp);
    out.push(...(data.value || []));
    next = data.nextLink || null;
  }
  return out;
}

const _RSV_ROLE_HINT = 'Conceda à Service Principal o papel "Reservations Reader" (escopo /providers/Microsoft.Capacity) '
  + 'e, para Savings Plans, "Savings plan Reader" — a concessão exige um administrador com acesso elevado.';

app.post('/api/reservas/sincronizar-azure', authMiddleware, dbMiddleware, async (req, res) => {
  if (req.user?.perfil === 'reader') return res.status(403).json({ error: 'Perfil somente leitura não pode sincronizar reservas.' });
  try {
    await ensureAzureColetaTable();
    const spId = req.body && req.body.sp_id ? parseInt(req.body.sp_id, 10) : null;
    const r = spId
      ? await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [spId])
      : await pool.query(`SELECT * FROM azure_coleta_config WHERE ativo = true ORDER BY is_padrao DESC, id ASC LIMIT 1`);
    if (!r.rows.length) return res.status(404).json({ error: 'Nenhuma Service Principal ativa configurada. Cadastre uma na Coleta Azure.' });
    const cfg = r.rows[0];
    if (!cfg.ativo) return res.status(400).json({ error: `A Service Principal "${cfg.nome}" está inativa.` });

    const { token } = await _managementGetToken(
      _safeDecrypt(cfg.tenant_id), _safeDecrypt(cfg.client_id), _safeDecrypt(cfg.client_secret)
    );

    const { mapReservation, mapSavingsPlan } = require('./azureReservas');
    const avisos = [];
    const itens = [];

    // 1) Reservas: lista as ordens e, para cada uma, as reservas.
    let ordens;
    try {
      ordens = await _armListAll(token, 'https://management.azure.com/providers/Microsoft.Capacity/reservationOrders?api-version=2022-11-01');
    } catch (e) {
      if (e.status === 403 || e.status === 401) {
        return res.status(403).json({ error: `A Service Principal "${cfg.nome}" não tem permissão para ler reservas. ${_RSV_ROLE_HINT}` });
      }
      throw e;
    }
    for (let i = 0; i < ordens.length; i += 5) {
      await Promise.all(ordens.slice(i, i + 5).map(async (ordem) => {
        try {
          const rs = await _armListAll(token,
            `https://management.azure.com${ordem.id}/reservations?api-version=2022-11-01`);
          for (const rv of rs) { const m = mapReservation(rv, ordem); if (m) itens.push(m); }
        } catch (e) {
          avisos.push(`Ordem ${ordem.name}: ${e.message}`);
        }
      }));
    }

    // 2) Savings Plans (falha aqui não invalida as reservas já lidas).
    try {
      const sps = await _armListAll(token, 'https://management.azure.com/providers/Microsoft.BillingBenefits/savingsPlans?api-version=2022-11-01');
      for (const sp of sps) { const m = mapSavingsPlan(sp); if (m) itens.push(m); }
    } catch (e) {
      avisos.push(e.status === 403 || e.status === 401
        ? `Savings Plans não lidos: sem permissão. ${_RSV_ROLE_HINT}`
        : `Savings Plans não lidos: ${e.message}`);
    }

    // 3) Upsert por azure_id. Custos e observações preenchidos manualmente são preservados
    //    quando a Azure não os informa (a API de reservas não retorna preço).
    let inseridas = 0, atualizadas = 0;
    for (const m of itens) {
      const up = await pool.query(
        `INSERT INTO reservas_cloud
           (cloud, nome_reserva, tipo_escopo, subscription_id, resource_group_name, tipo_recurso,
            instancia, quantidade, prazo, opcao_pagamento, custo_total, custo_mensal,
            data_inicio, data_vencimento, status, origem, azure_id, sp_id, sincronizado_em, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'azure',$16,$17,NOW(),$18)
         ON CONFLICT (azure_id) WHERE azure_id IS NOT NULL DO UPDATE SET
           nome_reserva=EXCLUDED.nome_reserva, tipo_escopo=EXCLUDED.tipo_escopo,
           subscription_id=EXCLUDED.subscription_id, resource_group_name=EXCLUDED.resource_group_name,
           tipo_recurso=EXCLUDED.tipo_recurso, instancia=EXCLUDED.instancia, quantidade=EXCLUDED.quantidade,
           prazo=EXCLUDED.prazo, opcao_pagamento=EXCLUDED.opcao_pagamento,
           custo_total=COALESCE(EXCLUDED.custo_total, reservas_cloud.custo_total),
           custo_mensal=COALESCE(EXCLUDED.custo_mensal, reservas_cloud.custo_mensal),
           data_inicio=EXCLUDED.data_inicio, data_vencimento=EXCLUDED.data_vencimento,
           status=EXCLUDED.status, sp_id=EXCLUDED.sp_id, sincronizado_em=NOW(), atualizado_em=NOW()
         RETURNING (xmax = 0) AS inserida`,
        [m.cloud, m.nome_reserva, m.tipo_escopo, m.subscription_id, m.resource_group_name, m.tipo_recurso,
         m.instancia, m.quantidade, m.prazo, m.opcao_pagamento, m.custo_total, m.custo_mensal,
         m.data_inicio, m.data_vencimento, m.status, m.azure_id, cfg.id, req.user.id]
      );
      if (up.rows[0].inserida) inseridas++; else atualizadas++;
    }

    res.json({ ok: true, sp: cfg.nome, total: itens.length, inseridas, atualizadas, avisos });
  } catch (err) {
    console.error('[reservas] sincronizar-azure:', err);
    res.status(502).json({ error: 'Falha ao sincronizar com a Azure: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLETA AUTOMÁTICA — Azure Cost Management API (MCA)
// ══════════════════════════════════════════════════════════════════════════════

let _coletaEmExecucao = false;
let _coletaCancelada  = false;
let _coletaProgresso  = { fase: '', sub_atual: '', sub_idx: 0, sub_total: 0, chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
let _coletaIniciadaEm = null;

// Estado independente do Azure (_coletaEmExecucao acima) — Databricks e Azure podem
// coletar em paralelo sem se bloquear, já que escrevem em tabelas diferentes e não
// compartilham circuit breaker (_dbxFetch, deliberadamente separado de _cbFetch).
let _dbxColetaEmExecucao = false;
let _dbxColetaIniciadaEm = null;
let _dbxColetaProgresso  = { fase: '', ins: 0, upd: 0, err: 0, log: [] };
function _logColetaDbx(msg) {
  _dbxColetaProgresso.log.push({ ts: new Date().toISOString().slice(11, 19), msg });
  if (_dbxColetaProgresso.log.length > 200) _dbxColetaProgresso.log.shift();
  console.log('[ColetaDbx] ' + msg);
}

// Estado independente (Inventário/Auditoria de Recursos Azure, 2026-08-30) — mesmo
// espírito de _dbxColetaEmExecucao: não compete com a coleta de billing nem com a
// Databricks, tabelas e circuit breaker (_cbFetch, compartilhado com o resto do Azure,
// já que isso também é Azure Management API) próprios.
let _invColetaEmExecucao = false;
let _invColetaIniciadaEm = null;
// `tipo` distingue coleta normal (Activity Log) de reconciliação (Resource Graph) — mesmo
// estado/rota/monitor reaproveitados pras duas (mutuamente exclusivas, escrevem na mesma
// tabela) — só o frontend ajusta rótulos conforme `tipo` (ver AzureInventarioColetaMonitor.tsx).
let _invColetaProgresso  = { tipo: 'coleta', fase: '', sub_atual: '', sub_idx: 0, sub_total: 0, eventos: 0, novos: 0, atualizados: 0, excluidos: 0, log: [] };
function _logColetaInv(msg) {
  _invColetaProgresso.log.push({ ts: new Date().toISOString().slice(11, 19), msg });
  if (_invColetaProgresso.log.length > 200) _invColetaProgresso.log.shift();
  console.log('[ColetaInv] ' + msg);
}

// ── Circuit Breaker / pausa de 429 / concorrência — ver azureThrottle.js ──────────────────
// Breaker POR FAMÍLIA de API (custo, resourcegraph, advisor, reservas, arm, graph, identidade,
// blob). 429 = limitação de ritmo: pausa a família inteira pelo Retry-After e nunca abre o
// breaker; só 5xx/timeout/rede contam falha. Storage (blob) é independente das demais.
const _azThrottle = require('./azureThrottle');
const _cbCore = _azThrottle.createCbFetch({ fetch: (...a) => fetch(...a), log: (m) => _logColeta(m) });
const _mapLimit = _azThrottle.mapLimit;
const _mapLimitSettled = _azThrottle.mapLimitSettled;

// _cbFetch — fetch com timeout, retry/pausa de 429 e breaker da família da URL.
// SAS URLs (blobs) devem usar countCbFailure:false para não abrir CB por problemas de download.
function _cbFetch(url, options = {}, cfg = {}) { return _cbCore.cbFetch(url, options, cfg); }
// Falha lógica da coleta de custos (relatório falhou/5xx no polling) — família 'custo'.
function _cbRecordFailure() { _cbCore.recordFailure('custo'); }

let _coletaTableReady = false;
async function ensureAzureColetaTable() {
  if (!pool) return;
  if (_coletaTableReady) return;

  // Cada query é separada para que a falha de uma não impeça as seguintes.
  const run = (sql) => pool.query(sql).catch(e => {
    // Ignora erros inofensivos: coluna/tabela já existe, tipo já correto
    if (!e.message.includes('already exists') && !e.message.includes('does not exist'))
      console.warn('[ColetaTable]', e.message.slice(0, 120));
  });

  // ── azure_coleta_config ───────────────────────────────────────────────────
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
    )
  `);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS granularidade_dias  INTEGER DEFAULT 7`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS nome                VARCHAR(200) DEFAULT 'SP Principal'`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS expiracao_secret    DATE`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_account     VARCHAR(200)`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_container   VARCHAR(200)`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS storage_prefix      VARCHAR(500)`);
  await run(`ALTER TABLE azure_coleta_config ALTER COLUMN tenant_id TYPE TEXT`);
  await run(`ALTER TABLE azure_coleta_config ALTER COLUMN client_id TYPE TEXT`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS billing_account_id  TEXT`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS billing_profile_id  TEXT`);
  await run(`ALTER TABLE azure_coleta_config ALTER COLUMN billing_account_id TYPE TEXT`);
  await run(`ALTER TABLE azure_coleta_config ALTER COLUMN billing_profile_id TYPE TEXT`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS hora_execucao       INTEGER`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS dias_semana         TEXT`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS auto_coleta         BOOLEAN DEFAULT false`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS proxima_coleta      TIMESTAMP`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS is_padrao           BOOLEAN DEFAULT false`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS modo_coleta         VARCHAR(30) DEFAULT 'billing_profile'`);
  await run(`ALTER TABLE azure_coleta_config ADD COLUMN IF NOT EXISTS subscription_ids    TEXT`);

  // ── azure_storage_config ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_storage_config (
      id                SERIAL PRIMARY KEY,
      nome              VARCHAR(200) NOT NULL DEFAULT 'Storage 1',
      storage_account   VARCHAR(200) NOT NULL,
      storage_container VARCHAR(200) NOT NULL,
      storage_prefix    VARCHAR(500),
      ativo             BOOLEAN DEFAULT true,
      criado_em         TIMESTAMP DEFAULT NOW(),
      atualizado_em     TIMESTAMP DEFAULT NOW()
    )
  `);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS auto_coleta_horas  INTEGER`);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS proxima_coleta     TIMESTAMP`);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS hora_execucao      INTEGER`);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS dias_semana        TEXT`);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS sp_id              INTEGER REFERENCES azure_coleta_config(id) ON DELETE SET NULL`);
  await run(`ALTER TABLE azure_storage_config ADD COLUMN IF NOT EXISTS price_list_prefix  VARCHAR(500)`);

  // ── azure_coleta_historico ────────────────────────────────────────────────
  await pool.query(`
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
    )
  `);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS tipo              VARCHAR(20)`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS origem            VARCHAR(20) DEFAULT 'manual'`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS periodo_inicio    DATE`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS periodo_fim       DATE`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS subscriptions_ids TEXT[]`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS validacao_status  VARCHAR(20)`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS validacao_json    JSONB`);
  await run(`ALTER TABLE azure_coleta_historico ADD COLUMN IF NOT EXISTS sp_id             INTEGER REFERENCES azure_coleta_config(id) ON DELETE SET NULL`);

  // ── notificacoes_sistema ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificacoes_sistema (
      id         BIGSERIAL PRIMARY KEY,
      tipo       VARCHAR(50) NOT NULL,
      titulo     VARCHAR(200) NOT NULL,
      mensagem   TEXT,
      criado_em  TIMESTAMP DEFAULT NOW(),
      expira_em  TIMESTAMP NOT NULL
    )
  `);
  // destino = "view:aba" para onde o clique no sino leva (ex.: 'inventario:crescimento'). NULL = sem link.
  await pool.query(`ALTER TABLE notificacoes_sistema ADD COLUMN IF NOT EXISTS destino VARCHAR(100)`);
  // destino_params = o "onde exatamente" (ex: {subscription_id, resource_group, dia} ou {resource_id, subscription_id}) — o clique
  // no sino leva ao recurso/escopo que gerou o alerta, não só à aba.
  await pool.query(`ALTER TABLE notificacoes_sistema ADD COLUMN IF NOT EXISTS destino_params JSONB`);
  await pool.query(`UPDATE notificacoes_sistema SET destino = 'inventario:crescimento' WHERE tipo = 'inventario_crescimento' AND destino IS NULL`);
  await pool.query(`UPDATE notificacoes_sistema SET destino = 'inventario:auditoria' WHERE tipo = 'inventario_alteracao' AND destino IS NULL`);
  // ── azure_coleta_pendentes — reprocessamentos agendados para próxima execução ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_coleta_pendentes (
      id              SERIAL PRIMARY KEY,
      sp_id           INTEGER,
      subscription_id VARCHAR(200),
      sub_name        VARCHAR(500),
      data_inicio     DATE NOT NULL,
      data_fim        DATE NOT NULL,
      descricao       VARCHAR(300),
      criado_em       TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── databricks_coleta_config — Fase 1: só a configuração da conexão (credenciais
  // OAuth M2M do Service Principal + endpoint de execução). Coleta em si (Fase 2) e
  // dashboard (Fase 3) ainda não existem — ver CLAUDE.md "Coleta Databricks".
  // Mesmo padrão de campos de agendamento de azure_coleta_config (dia/hora_execucao,
  // granularidade_dias, dias_semana, auto_coleta, proxima_coleta) já incluído aqui pra
  // não precisar de migração nova quando a Fase 2 (agendador real) for implementada —
  // só não são expostos na UI ainda, já que não há nada que os consuma por enquanto.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_coleta_config (
      id                  SERIAL PRIMARY KEY,
      nome                VARCHAR(200) NOT NULL DEFAULT 'Databricks Principal',
      modo_auth           VARCHAR(20) NOT NULL DEFAULT 'oauth_m2m',
      account_id          VARCHAR(200),
      client_id           VARCHAR(200),
      client_secret       TEXT,
      token               TEXT,
      workspace_host      VARCHAR(500),
      warehouse_id        VARCHAR(200),
      ativo               BOOLEAN DEFAULT false,
      is_padrao           BOOLEAN DEFAULT false,
      granularidade_dias  INTEGER DEFAULT 7,
      dia_execucao        INTEGER DEFAULT 5,
      hora_execucao       INTEGER,
      dias_semana         TEXT,
      auto_coleta         BOOLEAN DEFAULT false,
      proxima_coleta      TIMESTAMP,
      criado_em           TIMESTAMP DEFAULT NOW(),
      atualizado_em       TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migração pra quem já tinha a tabela sem esses campos (PAT — pedido do usuário,
  // 2026-08-26: alternativa mais simples ao OAuth M2M quando não há acesso de account
  // admin pra criar Service Principal na conta Databricks — mesmo token que o usuário já
  // usaria manualmente num SQL editor).
  await run(`ALTER TABLE databricks_coleta_config ADD COLUMN IF NOT EXISTS modo_auth VARCHAR(20) NOT NULL DEFAULT 'oauth_m2m'`);
  await run(`ALTER TABLE databricks_coleta_config ADD COLUMN IF NOT EXISTS token TEXT`);

  // ── databricks_consumo — Fase 2: linhas coletadas de system.billing.usage JOIN
  // system.billing.list_prices. Granularidade por RECURSO (cluster/job/warehouse
  // individual, via recurso_hash — ver _executarColetaDatabricks), não mais por
  // (workspace,sku,dia,usuário) agregado — pedido explícito do usuário (2026-08-26)
  // pra permitir chargeback correto por custom_tags: duas linhas de billing com o
  // mesmo workspace+sku+dia+usuário mas tags/recursos diferentes (ex: dois jobs
  // rodando com o mesmo service principal de automação, cada um com uma tag de
  // projeto diferente) antes colapsavam numa única linha, guardando só UMA tag
  // "de exemplo" — atribuía 100% do custo combinado à tag errada pra qualquer
  // recurso que não fosse o escolhido arbitrariamente pelo agregado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_consumo (
      id              SERIAL PRIMARY KEY,
      workspace_id    VARCHAR(200) NOT NULL,
      sku_name        VARCHAR(200) NOT NULL,
      produto_origem  VARCHAR(100) NOT NULL DEFAULT '',
      usage_date      DATE NOT NULL,
      usage_unit      VARCHAR(50),
      usage_quantity  NUMERIC(20,6) DEFAULT 0,
      usuario         VARCHAR(300) NOT NULL DEFAULT '',
      preco_unitario  NUMERIC(20,10),
      custo_estimado  NUMERIC(20,4) DEFAULT 0,
      usage_metadata  JSONB,
      custom_tags     JSONB,
      recurso_hash    CHAR(32) NOT NULL DEFAULT '',
      config_id       INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em       TIMESTAMP DEFAULT NOW(),
      atualizado_em   TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, sku_name, produto_origem, usage_date, usuario, recurso_hash)
    )
  `);
  // Migração pra quem já tinha a tabela na granularidade antiga (agregada) — instalações
  // novas já nascem com o schema certo via CREATE TABLE acima, isto é só pra bancos
  // existentes. ADD COLUMN é sempre seguro (linhas antigas ganham os defaults); a troca de
  // UNIQUE precisa achar o nome real da constraint antiga (nomeação automática do Postgres
  // pra UNIQUE inline pode variar) em vez de arriscar um DROP CONSTRAINT com nome chutado.
  await run(`ALTER TABLE databricks_consumo ADD COLUMN IF NOT EXISTS produto_origem VARCHAR(100) NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE databricks_consumo ADD COLUMN IF NOT EXISTS usage_metadata JSONB`);
  await run(`ALTER TABLE databricks_consumo ADD COLUMN IF NOT EXISTS custom_tags JSONB`);
  await run(`ALTER TABLE databricks_consumo ADD COLUMN IF NOT EXISTS recurso_hash CHAR(32) NOT NULL DEFAULT ''`);
  await pool.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'databricks_consumo_grain_key') THEN
        FOR r IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'databricks_consumo'::regclass AND contype = 'u'
        LOOP
          EXECUTE 'ALTER TABLE databricks_consumo DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
        ALTER TABLE databricks_consumo ADD CONSTRAINT databricks_consumo_grain_key
          UNIQUE (workspace_id, sku_name, produto_origem, usage_date, usuario, recurso_hash);
      END IF;
    END $$;
  `).catch(e => console.warn('[ColetaTable] Migração databricks_consumo:', e.message.slice(0, 150)));

  // ── databricks_coleta_historico — mesmo formato de azure_coleta_historico ──────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_coleta_historico (
      id                  SERIAL PRIMARY KEY,
      iniciado_em         TIMESTAMP DEFAULT NOW(),
      concluido_em        TIMESTAMP,
      status              VARCHAR(20) DEFAULT 'executando',
      config_id           INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      origem              VARCHAR(20),
      periodo_inicio      DATE,
      periodo_fim         DATE,
      linhas_inseridas    INTEGER DEFAULT 0,
      linhas_atualizadas  INTEGER DEFAULT 0,
      linhas_erro         INTEGER DEFAULT 0,
      mensagem            TEXT,
      detalhes            JSONB,
      validacao_status    VARCHAR(20),
      validacao_json      JSONB
    )
  `);
  // Migração pra quem já tinha a tabela sem validação (2026-08-27, pedido do usuário —
  // paridade com a Coleta Azure, que já tem esse conceito desde antes).
  await run(`ALTER TABLE databricks_coleta_historico ADD COLUMN IF NOT EXISTS validacao_status VARCHAR(20)`);
  await run(`ALTER TABLE databricks_coleta_historico ADD COLUMN IF NOT EXISTS validacao_json JSONB`);

  // ── databricks_job_runs — tempo de execução + status de cada run de Job (2026-08-29,
  // pedido do usuário: "coletar o tempo que um Job executou e quanto custou"). Fonte:
  // system.lakeflow.job_run_timeline (duração real, result_state) JOIN system.lakeflow.jobs
  // (nome do job — SCD2, sem nome próprio em job_run_timeline) — pesquisado na documentação
  // oficial do Databricks (WebSearch/WebFetch, 2026-08-29), NÃO validado contra uma conta
  // real (mesma ressalva de sempre nesta feature). Custo por run NÃO é armazenado aqui —
  // computado em leitura via JOIN com databricks_consumo.usage_metadata->>'job_run_id'
  // (campo já capturado desde a Fase 2 via to_json(usage_metadata), sem nenhuma mudança na
  // coleta de billing) — ver GET /api/databricks-coleta/job-runs.
  // UNIQUE por (workspace_id,job_id,run_id): job_run_timeline emite múltiplas linhas
  // (slices) pra runs >1h — a coleta agrega (SUM de duração, MIN/MAX de início/fim) ANTES
  // de gravar, então cada run vira uma única linha aqui, nunca duplicada por slice.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_job_runs (
      id                SERIAL PRIMARY KEY,
      workspace_id      VARCHAR(200) NOT NULL,
      job_id            VARCHAR(100) NOT NULL,
      run_id            VARCHAR(100) NOT NULL,
      job_name          VARCHAR(300),
      run_name          VARCHAR(300),
      run_type          VARCHAR(50),
      trigger_type      VARCHAR(50),
      iniciado_em       TIMESTAMP,
      concluido_em      TIMESTAMP,
      duracao_segundos  NUMERIC(14,2),
      result_state      VARCHAR(30),
      termination_code  VARCHAR(60),
      config_id         INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em         TIMESTAMP DEFAULT NOW(),
      atualizado_em     TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, job_id, run_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_job_runs_iniciado ON databricks_job_runs (iniciado_em)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_job_runs_job ON databricks_job_runs (job_id)`);
  // Functional index pro JOIN de custo por run (GET /job-runs) — job_run_id só existe pra
  // uma fração das linhas de billing (jobs em all-purpose cluster nunca populam esse campo,
  // mesma limitação documentada da Azure Retail Prices/usage_metadata.job_id), então o
  // índice parcial (WHERE ... IS NOT NULL) fica pequeno mesmo em tabelas grandes.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_databricks_consumo_job_run_id ON databricks_consumo ((usage_metadata->>'job_run_id'))
    WHERE usage_metadata->>'job_run_id' IS NOT NULL
  `);

  // ── Auditoria 2026-08-29 (pedido do usuário: validar contra a documentação oficial e
  // cobrir lacunas de "Controle de Custos") — 4 tabelas novas, cada uma um schema de
  // System Tables SEPARADO de system.billing (precisa ser habilitado à parte por um
  // account admin — mesmo padrão de system.lakeflow pra Execuções de Job). Todas
  // best-effort na coleta (não derrubam billing) — ver _coletarUtilizacaoDatabricks/
  // _coletarQueryHistoryDatabricks/_coletarAiGatewayDatabricks/_coletarStorageOtimizacaoDatabricks.
  // "Model Serving" NÃO tem tabela própria aqui — a documentação oficial
  // (docs.databricks.com/aws/en/admin/system-tables/model-serving-cost) confirma que o
  // custo de Model Serving já vem 100% de system.billing.usage (SKU
  // *_SERVERLESS_REAL_TIME_INFERENCE_*, usage_metadata.endpoint_name) — dado que
  // databricks_consumo já coleta desde a Fase 2; só faltava a agregação (ver GET /resumo
  // → por_model_serving).

  // system.compute.node_timeline (minuto a minuto) é granular DEMAIS pra guardar cru —
  // agregado por (workspace,cluster,dia) na própria coleta. cpu_percent = soma de
  // cpu_user_percent+cpu_system_percent (tempo de CPU realmente em uso, exclui wait/idle).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_cluster_utilizacao (
      id                SERIAL PRIMARY KEY,
      workspace_id      VARCHAR(200) NOT NULL,
      cluster_id        VARCHAR(100) NOT NULL,
      cluster_name      VARCHAR(300),
      owned_by          VARCHAR(300),
      dia               DATE NOT NULL,
      avg_cpu_percent   NUMERIC(6,2),
      avg_mem_percent   NUMERIC(6,2),
      amostras          INTEGER DEFAULT 0,
      config_id         INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em         TIMESTAMP DEFAULT NOW(),
      atualizado_em     TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, cluster_id, dia)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_cluster_util_dia ON databricks_cluster_utilizacao (dia)`);

  // system.query.history — 1 linha por statement_id (imutável). statement_text não é
  // coletado (redigido por padrão pra quem não é admin/databricks_pii_access — não vale a
  // pena depender disso); guardamos só metadados de performance/custo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_query_history (
      id                    SERIAL PRIMARY KEY,
      workspace_id          VARCHAR(200) NOT NULL,
      statement_id          VARCHAR(100) NOT NULL,
      warehouse_id          VARCHAR(100),
      statement_type        VARCHAR(50),
      executed_by           VARCHAR(300),
      iniciado_em           TIMESTAMP,
      concluido_em          TIMESTAMP,
      duracao_total_ms      BIGINT,
      execution_status      VARCHAR(20),
      config_id             INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em             TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, statement_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_query_history_iniciado ON databricks_query_history (iniciado_em)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_query_history_warehouse ON databricks_query_history (warehouse_id)`);

  // system.ai_gateway.usage — SEM coluna de custo em R$/US$ (confirmado na documentação
  // oficial: Databricks não sabe quanto o provedor externo cobra) — agregado por
  // (workspace,destino,dia) só em volume de tokens/requisições, nunca em dinheiro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_ai_gateway_usage (
      id                SERIAL PRIMARY KEY,
      workspace_id      VARCHAR(200) NOT NULL,
      destination_name  VARCHAR(300) NOT NULL,
      destination_model VARCHAR(300),
      dia               DATE NOT NULL,
      requisicoes       BIGINT DEFAULT 0,
      input_tokens      BIGINT DEFAULT 0,
      output_tokens     BIGINT DEFAULT 0,
      config_id         INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em         TIMESTAMP DEFAULT NOW(),
      atualizado_em     TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, destination_name, destination_model, dia)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_ai_gateway_dia ON databricks_ai_gateway_usage (dia)`);

  // system.storage.predictive_optimization_operations_history — 1 linha por operation_id
  // (imutável). usage_quantity vem em ESTIMATED_DBU (a doc é explícita que é uma
  // estimativa quando operações dividem recursos de cluster).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_storage_otimizacao (
      id                SERIAL PRIMARY KEY,
      workspace_id      VARCHAR(200) NOT NULL,
      operation_id      VARCHAR(100) NOT NULL,
      catalog_name      VARCHAR(300),
      schema_name       VARCHAR(300),
      table_name        VARCHAR(300),
      operation_type    VARCHAR(50),
      operation_status  VARCHAR(50),
      iniciado_em       TIMESTAMP,
      concluido_em      TIMESTAMP,
      usage_quantity    NUMERIC(20,6) DEFAULT 0,
      config_id         INTEGER REFERENCES databricks_coleta_config(id) ON DELETE SET NULL,
      criado_em         TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, operation_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_databricks_storage_otim_iniciado ON databricks_storage_otimizacao (iniciado_em)`);

  // ── databricks_budgets — Fase 3: orçamento mensal opcional, global ou por
  // workspace (workspace_id NULL = todos). Base do alerta em GET .../alertas.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_budgets (
      id             SERIAL PRIMARY KEY,
      nome           VARCHAR(200) NOT NULL,
      workspace_id   VARCHAR(200),
      valor_mensal   NUMERIC(14,2) NOT NULL,
      ativo          BOOLEAN DEFAULT true,
      criado_em      TIMESTAMP DEFAULT NOW(),
      atualizado_em  TIMESTAMP DEFAULT NOW()
    )
  `);
  // Governança (2026-08-28, pedido do usuário): escopo por tag (projeto/time/centro de
  // custo — qualquer chave de custom_tags já coletada, ver "Coleta Databricks — Granularidade
  // por recurso") além de workspace/global, e threshold de alerta configurável por orçamento
  // (antes fixo em 75%/90% no código — ver _computeAlertasDatabricks). DEFAULT 'workspace' em
  // escopo_tipo casa com o dado real de toda linha pré-existente que tem workspace_id
  // preenchido; a única exceção (orçamento global, workspace_id NULL) é corrigida pelo UPDATE
  // abaixo — sem isso, orçamentos globais existentes ficariam com escopo_tipo='workspace'
  // errado (mas com workspace_id NULL, então o filtro efetivo continuaria correto por
  // coincidência — corrigido mesmo assim pra não deixar o dado inconsistente).
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS escopo_tipo VARCHAR(20) NOT NULL DEFAULT 'workspace'`);
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS tag_key VARCHAR(100)`);
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS tag_valor VARCHAR(200)`);
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS threshold_atencao NUMERIC(5,2) NOT NULL DEFAULT 75`);
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS threshold_critico NUMERIC(5,2) NOT NULL DEFAULT 90`);
  await run(`UPDATE databricks_budgets SET escopo_tipo = 'global' WHERE workspace_id IS NULL AND escopo_tipo = 'workspace'`);
  // Cotas por usuario (2026-09-11) -- trazido do cockpit "Gestao de Cotas", que
  // trabalha com um teto valendo para CADA usuario do workspace. Dois escopos
  // novos, deliberadamente distintos:
  //   'workspace_por_usuario' -> workspace_id + valor = teto de CADA usuario
  //                              daquele workspace (o modelo do cockpit: define
  //                              uma vez, vale para todo mundo que usar o ws)
  //   'usuario'              -> teto de UM usuario, opcionalmente restrito a um
  //                              workspace (excecao individual sobre a regra)
  // Nao confundir com as Quotas Genie: aquelas sao a Budgets API nativa do
  // Databricks e controlam acesso ao Genie, nao o consumo geral.
  await run(`ALTER TABLE databricks_budgets ADD COLUMN IF NOT EXISTS usuario VARCHAR(300)`);
  // escopo_tipo nasceu VARCHAR(20) e 'workspace_por_usuario' tem 21 caracteres --
  // o INSERT falhava com "value too long for type character varying(20)".
  // Alargar varchar e idempotente de verdade (repetir nao muda nada), diferente
  // da conversao de TIMESTAMP->TIMESTAMPTZ que precisou de guard neste arquivo.
  await run(`ALTER TABLE databricks_budgets ALTER COLUMN escopo_tipo TYPE VARCHAR(40)`);

  // ── Quotas Genie — modo demonstração (2026-08-28, pedido do usuário) ──────────────
  // As rotas /genie-budgets sempre proxeiam a Budgets API real do Databricks — sem uma
  // conexão OAuth M2M de conta configurada (Account Admin), não há nada real pra mostrar
  // ou testar. Pra validar a tela sem uma conta real disponível, guardamos aqui um
  // punhado de quotas fictícias que as rotas usam como FALLBACK — só quando não existe
  // conexão padrão em modo oauth_m2m (`_dbxDemoModeNeeded`, definido perto das rotas).
  // Nunca é alcançado quando uma conexão real existe, então não tem como esse dado
  // fictício mascarar ou se misturar com dado real — a troca pra API real acontece
  // sozinha assim que o usuário configurar uma conexão oauth_m2m de verdade.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS databricks_genie_budgets_demo (
      id            VARCHAR(50) PRIMARY KEY,
      payload       JSONB NOT NULL,
      criado_em     TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    )
  `);
  const _genieDemoCount = (await pool.query(`SELECT COUNT(*) AS n FROM databricks_genie_budgets_demo`)).rows[0].n;
  if (parseInt(_genieDemoCount, 10) === 0) {
    const _genieDemoSeed = [
      {
        id: 'demo-001',
        payload: {
          budget_configuration_id: 'demo-001', display_name: 'Quota Genie — Exemplo por Workspace', account_id: 'demo-account',
          resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
          filter: { workspace_id: { operator: 'IN', values: [123456, 789012] } },
          alert_configurations: [{
            quantity_threshold: '1500.00', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
            action_configurations: [{ action_type: 'EMAIL_NOTIFICATION', target: 'finops@vivo.com.br' }],
          }],
        },
      },
      {
        id: 'demo-002',
        payload: {
          budget_configuration_id: 'demo-002', display_name: 'Quota Genie — Exemplo por Usuário (com overrides)', account_id: 'demo-account',
          resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
          filter: { tags: [{ key: 'projeto', value: { operator: 'IN', values: ['finops-core'] } }] },
          alert_configurations: [{
            quantity_threshold: '100.00', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
            action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }],
            principal_overrides: [
              { principal_id: 900111, override_threshold: '250.00' },
              { principal_id: 900222, override_threshold: '50.00' },
            ],
          }],
        },
      },
      {
        id: 'demo-003',
        payload: {
          budget_configuration_id: 'demo-003', display_name: 'Quota Genie — Exemplo com Bloqueio', account_id: 'demo-account',
          resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
          filter: {},
          alert_configurations: [{
            quantity_threshold: '5000.00', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
            action_configurations: [{ action_type: 'BLOCK_USAGE' }],
          }],
        },
      },
    ];
    for (const b of _genieDemoSeed) {
      await pool.query(`INSERT INTO databricks_genie_budgets_demo (id, payload) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [b.id, JSON.stringify(b.payload)]);
    }
  }

  // ── Inventário + Auditoria de Recursos Azure (2026-08-30, pedido do usuário) ──────────
  // "Ontem tinha X recursos, hoje tenho X+1 — quem criou, quando, quanto custa." Fonte:
  // Azure Activity Log (Microsoft.Insights/eventtypes/management, mesma credencial ARM já
  // usada pra Cost Management — role Reader já cobre `Microsoft.Insights/eventtypes/*`,
  // nenhuma permissão nova precisa ser concedida ao Service Principal). Custo NÃO é
  // armazenado aqui — correlacionado em leitura com azure_costs por resource_id (dado que
  // já coletamos todo dia).
  //
  // Duas tabelas com propósitos deliberadamente diferentes (pedido do usuário — "inventário
  // + auditoria"):
  // - azure_recursos_inventario: 1 linha por recurso, marcada ativo=false quando excluída
  //   (default PERMANENTE — nunca é apagada). Retenção opcional `retencao_excluidos_dias`
  //   (desativada por default, via `retencao_excluidos_ativa`) — quando ativa, apaga só os
  //   recursos `ativo=false` mais antigos. Ver `_purgarRecursosExcluidos` (12410+).
  // - azure_recursos_auditoria_eventos: log bruto, 1 linha por evento detectado
  //   (CRIAÇÃO/ATUALIZAÇÃO/EXCLUSÃO), sujeito ao período de retenção configurável — é o que
  //   cresce sem limite ao longo do tempo, então precisa de limpeza periódica.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_inventario_config (
      id                 SERIAL PRIMARY KEY,
      ativo              BOOLEAN DEFAULT false,
      retencao_dias      INTEGER DEFAULT 180,
      sp_id              INTEGER REFERENCES azure_coleta_config(id) ON DELETE SET NULL,
      subscription_ids   TEXT,
      ultimo_evento_em   TIMESTAMPTZ,
      criado_em          TIMESTAMP DEFAULT NOW(),
      atualizado_em      TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migração pra TIMESTAMPTZ (2026-08-31) — coluna nasceu como TIMESTAMP (sem timezone). Como
  // o código escreve/lê `ultimo_evento_em` via objetos JS Date (não só comparação SQL
  // server-side como as outras colunas TIMESTAMP do arquivo), node-postgres reparseia um
  // TIMESTAMP sem tz usando o construtor LOCAL do JS (Date(y,m,d,h,mi,s,ms), dependente de
  // `process.env.TZ='America/Sao_Paulo'`, setado no topo deste arquivo) em vez de UTC — cada
  // leitura "somava" 3h de volta ao valor gravado, fazendo o watermark derivar pra frente do
  // relógio real a cada tick e a coleta falhar com "start time > end time" contra o Activity
  // Log indefinidamente.
  //
  // BUG REAL #2, encontrado só depois de reiniciar o servidor várias vezes com o fix acima já
  // aplicado e o erro CONTINUAR: `ALTER COLUMN ... USING ultimo_evento_em AT TIME ZONE 'UTC'`
  // não é idempotente — rodava de novo em TODO restart (esta função roda no boot, sem guard).
  // Na 1ª vez, com a coluna ainda TIMESTAMP, a conversão é correta (trata o naive como UTC).
  // Mas a partir da 2ª vez, com a coluna JÁ timestamptz, `timestamptz AT TIME ZONE 'UTC'`
  // muda de significado: converte o instante absoluto pro "relógio de parede em UTC" (vira um
  // TIMESTAMP naive de novo, com os mesmos dígitos, já que a zona é UTC) — e o `ALTER COLUMN
  // TYPE TIMESTAMPTZ` seguinte reinterpreta esse naive usando o timezone da SESSÃO do Postgres
  // (America/Sao_Paulo, não UTC) pra converter de volta — somando +3h de novo, a cada restart
  // (não a cada leitura). Corrigido guardando a conversão com uma checagem de tipo antes —
  // só converte se a coluna ainda não for timestamptz.
  const _invColType = await pool.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name='azure_inventario_config' AND column_name='ultimo_evento_em'`
  );
  if (_invColType.rows[0]?.data_type !== 'timestamp with time zone') {
    await pool.query(`ALTER TABLE azure_inventario_config ALTER COLUMN ultimo_evento_em TYPE TIMESTAMPTZ USING ultimo_evento_em AT TIME ZONE 'UTC'`).catch(() => {});
  }
  // Reset único (2026-08-31) — o valor já foi deslocado +3h em cada um dos vários restarts
  // durante o diagnóstico do bug #2 acima (multiplicador exato desconhecido); não dá pra
  // "desfazer" com confiança, então zera de vez — a próxima coleta cai no fallback de 24h de
  // lookback, mesmo comportamento de uma ativação nova. Idempotente via a flag `atualizado_em`
  // (só roda enquanto o valor ainda estiver setado — depois do reset, `ultimo_evento_em IS NULL`
  // e este UPDATE não casa mais nenhuma linha).
  await pool.query(`UPDATE azure_inventario_config SET ultimo_evento_em = NULL WHERE ultimo_evento_em IS NOT NULL AND ultimo_evento_em > NOW()`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_recursos_inventario (
      id                SERIAL PRIMARY KEY,
      subscription_id   VARCHAR(200) NOT NULL,
      resource_id       TEXT NOT NULL,
      resource_type     VARCHAR(300),
      resource_group    VARCHAR(300),
      nome              VARCHAR(500),
      criado_por        VARCHAR(300),
      criado_em         TIMESTAMPTZ,
      atualizado_por    VARCHAR(300),
      atualizado_em     TIMESTAMPTZ,
      excluido_por      VARCHAR(300),
      excluido_em       TIMESTAMPTZ,
      ativo             BOOLEAN DEFAULT true,
      detectado_em      TIMESTAMP DEFAULT NOW(),
      origem_deteccao   VARCHAR(20) DEFAULT 'activity_log'
    )
  `);
  // Migração idempotente (2026-09-02) — coluna nova pra distinguir recursos aprendidos via
  // Activity Log (fluxo normal, tem criado_por/criado_em) de recursos adicionados pela
  // reconciliação via Resource Graph (ver `_reconciliarInventarioResourceGraph` — backfill
  // de recursos que existem mas nunca geraram evento desde a ativação do Inventário, sem
  // "criado por/em" porque o Resource Graph não tem esse histórico).
  await pool.query(`ALTER TABLE azure_recursos_inventario ADD COLUMN IF NOT EXISTS origem_deteccao VARCHAR(20) DEFAULT 'activity_log'`);
  // NOTA: índice case-sensitive foi removido — usar apenas o case-insensitive criado pela migration
  // (migrations/inventarioResourceIdCase.js). Se houver conflito, dropar o antigo.
  await pool.query(`DROP INDEX IF EXISTS idx_azure_recursos_inv_uniq`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_inv_ativo ON azure_recursos_inventario (ativo)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_inv_criado ON azure_recursos_inventario (criado_em)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_desperdicio_deteccao (
      resource_id_upper    TEXT PRIMARY KEY,
      categoria            VARCHAR(30),
      primeira_deteccao_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ultima_deteccao_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Unicidade case-insensitive de resource_id (migrations/inventarioResourceIdCase.js): o índice
  // funcional é criado por ela (LOWER(resource_id)). Reconciliação usa busca + insert/update
  // explícita para evitar sintaxe ON CONFLICT com funções. Idempotente — sem custo quando já existe.
  try {
    await require('./migrations/inventarioResourceIdCase').run(pool, console.log);
  } catch (e) {
    console.error('[Inventário] FALHA na unificação de resource_id — a ingestão do Inventário vai falhar até corrigir:', e.message);
  }
  // Migração pra TIMESTAMPTZ (2026-08-31, reportado pelo usuário como "o horário parece estar
  // errado") — `criado_em`/`atualizado_em`/`excluido_em` SEMPRE foram gravados a partir de
  // `ev.eventTimestamp` (string ISO UTC do Activity Log, ex: "...T12:00:00Z"), nunca de um
  // objeto JS Date. Confirmado com um teste isolado (INSERT + to_char sem reparse do driver)
  // que uma coluna TIMESTAMP (sem tz) recebendo essa string simplesmente IGNORA o sufixo 'Z' e
  // grava os dígitos UTC como se fossem horário local — comportamento documentado do Postgres
  // pro cast texto→timestamp (timezone no input é descartado, não convertido). Resultado: toda
  // leitura mostrava o horário UTC do evento como se já fosse horário de Brasília —
  // sistematicamente 3h à FRENTE do horário real. Diferente do bug do `ultimo_evento_em`
  // (2 camadas — JS Date reinterpretado + migração não-idempotente acumulando deriva a cada
  // restart), aqui o caminho de escrita sempre foi só string (nunca Date) — os dígitos naive
  // armazenados SEMPRE equivalem aos dígitos UTC reais, então uma conversão de uma vez só
  // (`AT TIME ZONE 'UTC'`) corrige 100% do histórico, sem precisar de reset adicional. Guardado
  // por checagem de tipo (mesmo padrão do `ultimo_evento_em` acima) pra não rodar de novo em
  // cada restart — `TIMESTAMPTZ AT TIME ZONE 'UTC'` muda de significado numa coluna já convertida.
  for (const _col of ['criado_em', 'atualizado_em', 'excluido_em']) {
    const _t = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='azure_recursos_inventario' AND column_name=$1`,
      [_col]
    );
    if (_t.rows[0]?.data_type !== 'timestamp with time zone') {
      await pool.query(`ALTER TABLE azure_recursos_inventario ALTER COLUMN ${_col} TYPE TIMESTAMPTZ USING ${_col} AT TIME ZONE 'UTC'`).catch(() => {});
    }
  }
  // Backfill idempotente (2026-08-31): linhas cuja primeira detecção foi um evento de EXCLUSÃO
  // nunca tiveram `nome` preenchido (bug corrigido no handler de delete abaixo) — recalcula pra
  // quem já ficou NULL antes da correção. split_part com '/' reverso não existe em SQL puro, então
  // usa regexp pra pegar o último segmento do resource_id (mesma lógica de resourceId.split('/').pop()).
  await pool.query(`UPDATE azure_recursos_inventario SET nome = regexp_replace(resource_id, '^.*/', '') WHERE nome IS NULL`);

  // Inventário 2.0 (2026-09-03) — troca a fonte de eventos de Activity Log pra Azure Resource
  // Graph Change Analysis (tabela `resourcechanges`, ver `_resourceGraphFetchChanges` e
  // `_coletarInventarioAzure`) — pesquisa contra documentação oficial encontrou que ela grava o
  // antes/depois de QUALQUER propriedade nativamente, então o diff manual de SKU de VM
  // (`_detectarMudancasSku`, que lia o valor atual via Resource Graph e comparava contra a
  // última leitura conhecida em `sku_atual`) deixa de ser necessário — o mesmo dado já vem
  // pronto no próprio evento de mudança. Pedido explícito do usuário: zerar o histórico já
  // coletado (eventos, SKU, autores resolvidos) e recomeçar limpo com a nova fonte, em vez de
  // tentar migrar dado antigo pro formato novo. Guardado pela existência da coluna `sku_atual`
  // (só existia no schema antigo) — roda uma vez só, nunca de novo depois que ela for removida.
  const _temSkuAtual = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='azure_recursos_inventario' AND column_name='sku_atual'`);
  if (_temSkuAtual.rows.length) {
    await pool.query(`TRUNCATE TABLE azure_recursos_sku_historico, azure_recursos_auditoria_eventos, azure_recursos_inventario`);
    await pool.query(`ALTER TABLE azure_recursos_inventario DROP COLUMN sku_atual`);
    await pool.query(`UPDATE azure_inventario_config SET ultimo_evento_em = NULL`);
  }
  // Alterações de Propriedade (2026-09-03) — generaliza a antiga `azure_recursos_sku_historico`
  // (só SKU de VM) pra qualquer propriedade curada (tags, disco, storage, IP público — ver
  // `_extrairMudancasRastreadas`), já que a Change Analysis entrega o antes/depois de QUALQUER
  // propriedade de graça no mesmo evento. Tabela de SKU tinha 0 linhas reais (nenhum resize de
  // VM tinha acontecido ainda neste ambiente) — seguro trocar sem migração de dado.
  await pool.query(`DROP TABLE IF EXISTS azure_recursos_sku_historico`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_recursos_mudancas_propriedade (
      id                 SERIAL PRIMARY KEY,
      subscription_id    VARCHAR(200) NOT NULL,
      resource_id        TEXT NOT NULL,
      resource_type      VARCHAR(300),
      resource_group     VARCHAR(300),
      propriedade        VARCHAR(100) NOT NULL,
      propriedade_label  VARCHAR(200) NOT NULL,
      valor_anterior     TEXT,
      valor_novo         TEXT,
      detectado_em       TIMESTAMPTZ DEFAULT NOW(),
      evento_autor       VARCHAR(300),
      evento_quando      TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_mp_resource ON azure_recursos_mudancas_propriedade (subscription_id, resource_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_mp_detectado ON azure_recursos_mudancas_propriedade (detectado_em)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_recursos_auditoria_eventos (
      id                SERIAL PRIMARY KEY,
      subscription_id   VARCHAR(200) NOT NULL,
      resource_id       TEXT NOT NULL,
      resource_type     VARCHAR(300),
      resource_group    VARCHAR(300),
      acao              VARCHAR(20) NOT NULL,
      autor             VARCHAR(300),
      quando             TIMESTAMPTZ NOT NULL,
      operation_name    VARCHAR(300),
      correlation_id    VARCHAR(100),
      criado_em         TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_aud_quando ON azure_recursos_auditoria_eventos (quando)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_aud_resource ON azure_recursos_auditoria_eventos (resource_id)`);
  // Mesmo bug e mesma correção de `criado_em`/`atualizado_em`/`excluido_em` acima — `quando`
  // também sempre veio de `ev.eventTimestamp` (string ISO UTC), nunca de um objeto JS Date.
  {
    const _t = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='azure_recursos_auditoria_eventos' AND column_name='quando'`
    );
    if (_t.rows[0]?.data_type !== 'timestamp with time zone') {
      await pool.query(`ALTER TABLE azure_recursos_auditoria_eventos ALTER COLUMN quando TYPE TIMESTAMPTZ USING quando AT TIME ZONE 'UTC'`).catch(() => {});
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_inventario_coleta_historico (
      id                  SERIAL PRIMARY KEY,
      iniciado_em         TIMESTAMP DEFAULT NOW(),
      concluido_em        TIMESTAMP,
      status              VARCHAR(20) DEFAULT 'executando',
      origem              VARCHAR(20),
      periodo_inicio      TIMESTAMP,
      periodo_fim         TIMESTAMP,
      eventos_processados INTEGER DEFAULT 0,
      recursos_novos      INTEGER DEFAULT 0,
      recursos_atualizados INTEGER DEFAULT 0,
      recursos_excluidos  INTEGER DEFAULT 0,
      mensagem            TEXT
    )
  `);

  // Corrige linhas órfãs de 'executando' — nada as atualiza depois de um
  // restart/crash do processo (o `_coletaEmExecucao`/`_dbxColetaEmExecucao`
  // em memória volta a false num processo novo, mas a linha gravada no banco
  // pela execução anterior nunca é tocada de novo, ficando "executando" pra
  // sempre com 0/0/0 e sem concluido_em). Roda uma vez por boot (guardado
  // por _coletaTableReady acima) — num processo recém-iniciado, por
  // definição nenhuma coleta desta tabela pode genuinamente ainda estar em
  // andamento, então qualquer linha 'executando' aqui é órfã de um processo
  // anterior que morreu no meio (deploy, pm2 restart, crash).
  await run(`UPDATE azure_coleta_historico SET status='erro', concluido_em=NOW(), mensagem='Interrompida por reinício do servidor' WHERE status='executando'`);
  await run(`UPDATE databricks_coleta_historico SET status='erro', concluido_em=NOW(), mensagem='Interrompida por reinício do servidor' WHERE status='executando'`);
  await run(`UPDATE azure_inventario_coleta_historico SET status='erro', concluido_em=NOW(), mensagem='Interrompida por reinício do servidor' WHERE status='executando'`);

  // ── Retenção de recursos excluídos (2026-09-25, pedido do usuário) ─────────────────────
  // Opcionalmente apagar recursos já excluídos há mais de N dias (não toca em ativos nem em
  // auditoria — permanência é o padrão, desligado por default). Ver `_purgarRecursosExcluidos`.
  await run(`ALTER TABLE azure_inventario_config ADD COLUMN IF NOT EXISTS retencao_excluidos_ativa BOOLEAN DEFAULT false`);
  await run(`ALTER TABLE azure_inventario_config ADD COLUMN IF NOT EXISTS retencao_excluidos_dias INTEGER DEFAULT 180`);

  // ── Governança de crescimento (2026-08-31, pedido do usuário) ────────────────────────────
  // `tags_obrigatorias` — chaves separadas por vírgula (ex: "projeto,centro_custo") checadas
  // contra `azure_costs.tags` (JSON já coletado por toda a Coleta Azure — zero coleta nova).
  await run(`ALTER TABLE azure_inventario_config ADD COLUMN IF NOT EXISTS tags_obrigatorias TEXT`);

  // Orçamentos/teto de crescimento — mesmo padrão de `databricks_budgets`, mas escopado por
  // subscription/Resource Group (não workspace/tag) e com dois tipos de limite: contagem de
  // recursos ativos, ou custo do mês corrente — cobre tanto "não deixe esse RG passar de N
  // recursos" quanto "não deixe esse RG passar de R$X/mês".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_inventario_orcamentos (
      id                 SERIAL PRIMARY KEY,
      nome               VARCHAR(200) NOT NULL,
      escopo_tipo        VARCHAR(20) NOT NULL DEFAULT 'subscription',
      subscription_id    VARCHAR(200) NOT NULL,
      resource_group     VARCHAR(300),
      tipo_limite        VARCHAR(20) NOT NULL DEFAULT 'recursos',
      limite_valor       NUMERIC(20,2) NOT NULL,
      threshold_atencao  NUMERIC(5,2) DEFAULT 75,
      threshold_critico  NUMERIC(5,2) DEFAULT 90,
      ativo              BOOLEAN DEFAULT true,
      criado_em          TIMESTAMP DEFAULT NOW(),
      atualizado_em      TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_inv_orc_ativo ON azure_inventario_orcamentos (ativo)`);
  // Escopo por TAG (2026-09-04) — sem isso, orçamento e rateio por tag não se compunham: dava
  // pra ver que o projeto NFCOM gastou R$1,35 mi, mas não pra pôr um teto nele. Lê do rollup
  // `azure_custo_por_tag` já existente (zero query nova sobre os 3,7M).
  await pool.query(`ALTER TABLE azure_inventario_orcamentos ADD COLUMN IF NOT EXISTS tag_chave VARCHAR(200)`);
  await pool.query(`ALTER TABLE azure_inventario_orcamentos ADD COLUMN IF NOT EXISTS tag_valor VARCHAR(500)`);

  // Índice composto pra agregação diária de criação por RG (anomalia de crescimento) —
  // as consultas existentes (`idx_azure_recursos_aud_quando`/`idx_azure_recursos_aud_resource`)
  // não cobrem GROUP BY subscription_id+resource_group+dia com eficiência.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_aud_sub_rg_quando ON azure_recursos_auditoria_eventos (subscription_id, resource_group, quando)`);

  // Cache de nomes resolvidos via Microsoft Graph (2026-08-31, pedido do usuário: "consegue
  // trazer o nome e não o ID?") — `criado_por`/`atualizado_por`/`autor` do Activity Log quase
  // sempre trazem um Object ID puro (Service Principal ou usuário), nunca um nome amigável —
  // confirmado com dados reais: 6.426 de 6.445 eventos são GUID puro, só 1 já vinha como
  // e-mail. Resolver exige o Microsoft Graph (não o ARM já usado pro resto da coleta), com
  // uma permissão de aplicativo NOVA (Directory.Read.All) — ver _graphResolveAutores.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_autores_cache (
      guid          VARCHAR(100) PRIMARY KEY,
      nome          VARCHAR(300),
      tipo          VARCHAR(50),
      resolvido_em  TIMESTAMP DEFAULT NOW()
    )
  `);

  // Tags por recurso, materializadas (2026-09-04) — necessário, não otimização prematura.
  // Medido contra o dado real (3,7M linhas em azure_costs): servir o relatório de compliance
  // direto de azure_costs custa 45s (GROUP BY/MAX sobre 7 dias), 62s (DISTINCT ON 7 dias) ou
  // 190s (DISTINCT ON 35 dias) POR REQUISIÇÃO — inviável pra uma tela. Com esta tabela, a mesma
  // leitura vira um hash join e cai pra ~3,5s. O build custa ~234s, mas roda UMA vez em
  // background (mesma ordem de grandeza de _refreshAzureCache ~87s e da reconciliação ~190s,
  // ambos já aceitos neste app).
  // `tags` fica como TEXT (cru, como veio do export) e é parseado com JSON.parse em JS na
  // leitura — deliberadamente NÃO `::jsonb` aqui: um CAST que falhe numa única linha malformada
  // abortaria o build inteiro, e export malformado é risco real (mesma razão já documentada no
  // handler de /tags-faltantes).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_recurso_tags (
      resource_id_upper TEXT PRIMARY KEY,
      tags              TEXT,
      visto_em          DATE,
      atualizado_em     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Rollup de custo por tag (2026-09-04) — capability "Allocation" do FinOps Framework, a mais
  // priorizada do mercado. Materializado por MÊS: consultar `tags` (TEXT com JSON) ao vivo
  // significaria ~2M parses por requisição; aqui o parse é pago uma vez por mês de dado.
  // Cardinalidade é o risco real e foi medido: um único mês produz 601.841 combinações
  // (sub,chave,valor), dominadas por chaves que o Databricks injeta por execução — `ClusterId`
  // sozinho tem 364.990 valores distintos, `databricks-instance-name` 116.351. As chaves de
  // NEGÓCIO são pequenas (`projeto` 591, `sigla` 282, `bu` 70). Por isso o builder guarda o
  // top-500 valores por (mes,sub,chave) e dobra a cauda num bucket '(outros)': 601.841 → 27.194
  // linhas, com o total por chave preservado exato (é ele que alimenta o % alocado).
  // Linhas sintéticas `tag_chave='__total__'` guardam o custo total do mês/subscription — assim
  // `nao_alocado = __total__ − soma(chave)` é auto-consistente, sem depender de casar com o
  // resultado de outra query.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_custo_por_tag (
      mes             CHAR(7)       NOT NULL,
      subscription_id VARCHAR(200)  NOT NULL DEFAULT '',
      tag_chave       VARCHAR(200)  NOT NULL,
      tag_valor       VARCHAR(500)  NOT NULL,
      custo           NUMERIC(20,6) NOT NULL DEFAULT 0,
      custo_microsoft   NUMERIC(20,6) NOT NULL DEFAULT 0,
      custo_marketplace NUMERIC(20,6) NOT NULL DEFAULT 0,
      linhas          BIGINT        NOT NULL DEFAULT 0,
      PRIMARY KEY (mes, subscription_id, tag_chave, tag_valor)
    )
  `);
  // Split Microsoft/Marketplace (2026-09-28) — colunas paralelas, não uma dimensão nova no PK:
  // o `custo` total continua exato pra tudo que já lia essa coluna, e o ranking de top-500
  // valores (feito por `custo` total) não precisa mudar. Migração aditiva — tabela já existente
  // ganha as colunas zeradas; o próximo rebuild forçado preenche o histórico de verdade.
  await pool.query(`ALTER TABLE azure_custo_por_tag ADD COLUMN IF NOT EXISTS custo_microsoft   NUMERIC(20,6) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE azure_custo_por_tag ADD COLUMN IF NOT EXISTS custo_marketplace NUMERIC(20,6) NOT NULL DEFAULT 0`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_custo_por_tag_chave ON azure_custo_por_tag (mes, tag_chave)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_tag_chaves (
      mes               CHAR(7)       NOT NULL,
      tag_chave         VARCHAR(200)  NOT NULL,
      valores_distintos INT           NOT NULL DEFAULT 0,
      custo             NUMERIC(20,6) NOT NULL DEFAULT 0,
      custo_microsoft   NUMERIC(20,6) NOT NULL DEFAULT 0,
      custo_marketplace NUMERIC(20,6) NOT NULL DEFAULT 0,
      PRIMARY KEY (mes, tag_chave)
    )
  `);
  await pool.query(`ALTER TABLE azure_tag_chaves ADD COLUMN IF NOT EXISTS custo_microsoft   NUMERIC(20,6) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE azure_tag_chaves ADD COLUMN IF NOT EXISTS custo_marketplace NUMERIC(20,6) NOT NULL DEFAULT 0`);
  // Cobertura de commitment (Reservation/Savings Plan) — capability "Rate Optimization".
  // Medida em HORAS, não em dinheiro: confirmado contra o dado real que as linhas cobertas têm
  // `cost=0` E `payg_cost=0` E `effective_price=0` — só `quantity`. Uma fórmula em R$ daria 0%,
  // enganoso. Horas é também a unidade canônica de coverage de compute em FinOps.
  // Materializada porque a query ao vivo custa ~44s sobre os 3,7M (medido).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_commitment_cobertura (
      mes             CHAR(7)       NOT NULL,
      subscription_id VARCHAR(200)  NOT NULL DEFAULT '',
      h_total         NUMERIC(20,4) NOT NULL DEFAULT 0,
      h_reservation   NUMERIC(20,4) NOT NULL DEFAULT 0,
      h_savingsplan   NUMERIC(20,4) NOT NULL DEFAULT 0,
      h_spot          NUMERIC(20,4) NOT NULL DEFAULT 0,
      custo_efetivo   NUMERIC(20,6) NOT NULL DEFAULT 0,
      custo_lista     NUMERIC(20,6) NOT NULL DEFAULT 0,
      PRIMARY KEY (mes, subscription_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS azure_tag_rollup_status (
      mes           CHAR(7) PRIMARY KEY,
      construido_em TIMESTAMPTZ,
      linhas_lidas  BIGINT,
      segundos      NUMERIC(10,1)
    )
  `);

  _coletaTableReady = true;
}

// Builder do cache de tags por recurso (2026-09-04). Roda em background — nunca no caminho de
// uma requisição (custa ~234s pra um mês de billing). Incremental: reprocessa só a janela
// recente e faz upsert; o `WHERE EXCLUDED.visto_em >= ...` no ON CONFLICT garante que uma
// execução sobre uma janela antiga nunca sobrescreve uma tag mais nova já gravada.
let _recursoTagsBuildEmExecucao = false;
let _recursoTagsUltimoBuild = null;
const _RECURSO_TAGS_JANELA_DIAS = 35;

async function _rebuildRecursoTagsCache(origem = 'agendado') {
  if (_scanPesadoEmAndamento()) return { ok: false, motivo: 'outro scan pesado de azure_costs já em execução' };
  if (!pool) return { ok: false, motivo: 'sem banco' };
  _recursoTagsBuildEmExecucao = true;
  const t0 = Date.now();
  try {
    await ensureAzureColetaTable();
    // Janela ancorada em MAX(cost_date), não em CURRENT_DATE — o billing tem 2-3 dias de atraso
    // documentado, e ancorar em "hoje" perderia os dias mais recentes em bases desatualizadas.
    const r = await pool.query(
      `INSERT INTO azure_recurso_tags (resource_id_upper, tags, visto_em, atualizado_em)
       SELECT UPPER(resource_id), MAX(tags), MAX(cost_date), NOW()
       FROM azure_costs
       WHERE resource_id IS NOT NULL AND resource_id <> ''
         AND cost_date >= (SELECT MAX(cost_date) FROM azure_costs) - ($1 || ' days')::interval
       GROUP BY 1
       ON CONFLICT (resource_id_upper) DO UPDATE
         SET tags = EXCLUDED.tags, visto_em = EXCLUDED.visto_em, atualizado_em = NOW()
         WHERE EXCLUDED.visto_em >= azure_recurso_tags.visto_em`,
      [String(_RECURSO_TAGS_JANELA_DIAS)]
    );
    _recursoTagsUltimoBuild = new Date();
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[TagsCache] ${origem}: ${r.rowCount} recurso(s) atualizados em ${seg}s`);
    return { ok: true, linhas: r.rowCount, segundos: Number(seg) };
  } catch (e) {
    console.warn('[TagsCache] Falha:', e.message);
    return { ok: false, motivo: e.message };
  } finally {
    _recursoTagsBuildEmExecucao = false;
  }
}

// Timer próprio, separado do agendador de coleta (mesmo espírito de _iniciarAlertasEmail):
// tag de recurso não muda de minuto a minuto e o build é caro — 6h é folga larga.
let _recursoTagsTimer = null;
function _iniciarRecursoTagsCache() {
  if (_recursoTagsTimer) return;
  // 4 min após o boot — depois do _refreshAzureCache (90s) e do warm-up do cache de RG (120s),
  // pra não somar três operações pesadas no mesmo instante do startup.
  setTimeout(() => {
    _rebuildRecursoTagsCache('startup')
      .then(() => _rebuildAlocacaoTags('startup'))
      .catch(() => {});
  }, 240_000);
  _recursoTagsTimer = setInterval(() => {
    // Em série, não em paralelo — os dois varrem `azure_costs` e rodar juntos só faria os dois
    // demorarem mais (mesma lição do build concorrente de RG que levou 209s nesta sessão).
    _rebuildRecursoTagsCache('agendado')
      .then(() => _rebuildAlocacaoTags('agendado'))
      .catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

// Builder do rollup de custo por tag (2026-09-04) — roda em background, um MÊS por vez
// (medido: ~163s/mês contra os 3,7M de azure_costs). Idempotente: apaga e reescreve o mês.
// `pg_input_is_valid(t,'jsonb')` guarda o cast — confirmado PG 18.2 neste ambiente (a função
// exige PG≥16), e medido que hoje 0 linhas são JSON inválido; a guarda é seguro barato contra
// um import futuro trazer lixo, sem o custo de uma subtransação por linha.
const _TAG_ROLLUP_TOP_N = 500;
let _tagRollupEmExecucao = false;

// Guarda COMPARTILHADA entre os dois builders pesados (_rebuildRecursoTagsCache e
// _rebuildAlocacaoTags) — os dois varrem `azure_costs` (3,7M linhas) inteiro. Medido nesta
// sessão: o cache de tags sozinho leva ~234s, mas levou 1092s quando um rollup manual foi
// disparado em paralelo. Mesma lição do build concorrente de RG que custou 209s. Rodar em
// série é mais rápido que rodar junto.
function _scanPesadoEmAndamento() {
  return _recursoTagsBuildEmExecucao || _tagRollupEmExecucao;
}

// Reconstrói UM mês, dentro de uma TRANSAÇÃO (2026-09-04).
// Bug real encontrado testando: sem transação, o `DELETE` + os 4 `INSERT`s não são atômicos —
// um `pm2 restart` no meio deixava o mês com as linhas de tag mas SEM as linhas sintéticas
// `__total__`, e a série mensal passou a mostrar R$3,37 mi em vez dos R$7,08 mi reais, em
// silêncio (o showback e `/serie-mensal` leem justamente de `__total__`). Com transação, uma
// morte no meio faz rollback e o mês continua com o dado ANTIGO — consistente, ainda que
// defasado, que é sempre melhor que meio apagado.
async function _rebuildAlocacaoTagsMes(mes, origem = 'agendado') {
  const t0 = Date.now();
  const ini = mes + '-01';
  const client = await pool.connect();
  try {
  await client.query('BEGIN');
  await client.query(`DELETE FROM azure_custo_por_tag WHERE mes = $1`, [mes]);
  await client.query(`DELETE FROM azure_tag_chaves    WHERE mes = $1`, [mes]);

  // `pub`: normaliza publisher_type pra só 2 baldes — NULL (import antigo/incompleto) cai em
  // 'Microsoft', o mesmo catch-all já usado nas outras rotas que fazem esse split.
  const r = await client.query(
    `WITH base AS (
       SELECT subscription_id::text AS sub,
              COALESCE(cost_in_billing_currency,0) AS custo,
              CASE WHEN publisher_type = 'Marketplace' THEN 'Marketplace' ELSE 'Microsoft' END AS pub,
              NULLIF(NULLIF(NULLIF(tags,''),'null'),'{}') AS t
       FROM azure_costs
       WHERE cost_date >= $2::date AND cost_date < ($2::date + INTERVAL '1 month')
     ), bruto AS (
       SELECT b.sub, kv.key AS chave, LEFT(kv.value, 500) AS valor,
              SUM(b.custo) AS custo,
              SUM(b.custo) FILTER (WHERE b.pub = 'Microsoft')   AS custo_microsoft,
              SUM(b.custo) FILTER (WHERE b.pub = 'Marketplace') AS custo_marketplace,
              COUNT(*) AS linhas
       FROM base b
       CROSS JOIN LATERAL jsonb_each_text(b.t::jsonb) AS kv
       WHERE b.t IS NOT NULL AND pg_input_is_valid(b.t, 'jsonb')
       GROUP BY 1, 2, 3
     ), ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY sub, chave ORDER BY custo DESC) AS rn FROM bruto
     )
     INSERT INTO azure_custo_por_tag (mes, subscription_id, tag_chave, tag_valor, custo, custo_microsoft, custo_marketplace, linhas)
     SELECT $1, sub, chave, valor, custo, COALESCE(custo_microsoft,0), COALESCE(custo_marketplace,0), linhas FROM ranked WHERE rn <= $3
     UNION ALL
     SELECT $1, sub, chave, '(outros)', SUM(custo), COALESCE(SUM(custo_microsoft),0), COALESCE(SUM(custo_marketplace),0), SUM(linhas)
     FROM ranked WHERE rn > $3 GROUP BY sub, chave`,
    [mes, ini, _TAG_ROLLUP_TOP_N]
  );

  // Linhas '__total__' — custo total do mês por subscription, INCLUSIVE o que não tem tag
  // nenhuma. É o denominador de pct_alocado.
  await client.query(
    `INSERT INTO azure_custo_por_tag (mes, subscription_id, tag_chave, tag_valor, custo, custo_microsoft, custo_marketplace, linhas)
     SELECT $1, subscription_id::text, '__total__', '__total__',
            SUM(COALESCE(cost_in_billing_currency,0)),
            COALESCE(SUM(COALESCE(cost_in_billing_currency,0)) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0),
            COALESCE(SUM(COALESCE(cost_in_billing_currency,0)) FILTER (WHERE publisher_type = 'Marketplace'), 0),
            COUNT(*)
     FROM azure_costs
     WHERE cost_date >= $2::date AND cost_date < ($2::date + INTERVAL '1 month')
     GROUP BY 2`,
    [mes, ini]
  );

  await client.query(
    `INSERT INTO azure_tag_chaves (mes, tag_chave, valores_distintos, custo, custo_microsoft, custo_marketplace)
     SELECT mes, tag_chave, COUNT(DISTINCT tag_valor), SUM(custo), SUM(custo_microsoft), SUM(custo_marketplace)
     FROM azure_custo_por_tag WHERE mes = $1 AND tag_chave <> '__total__'
     GROUP BY 1, 2`,
    [mes]
  );

  // Cobertura de commitment do mesmo mês — statement separado (o rollup de tags usa LATERAL
  // jsonb_each_text, que explode as linhas; misturar os dois numa query só ficaria ilegível).
  // Roda no MESMO job de background, então nunca no caminho de uma requisição.
  await client.query(`DELETE FROM azure_commitment_cobertura WHERE mes = $1`, [mes]);
  await client.query(
    `INSERT INTO azure_commitment_cobertura
       (mes, subscription_id, h_total, h_reservation, h_savingsplan, h_spot, custo_efetivo, custo_lista)
     SELECT $1, subscription_id::text,
            COALESCE(SUM(quantity),0),
            COALESCE(SUM(quantity) FILTER (WHERE pricing_model = 'Reservation'),0),
            COALESCE(SUM(quantity) FILTER (WHERE pricing_model = 'SavingsPlan'),0),
            COALESCE(SUM(quantity) FILTER (WHERE pricing_model = 'Spot'),0),
            COALESCE(SUM(cost_in_billing_currency),0),
            COALESCE(SUM(payg_cost_in_billing_currency),0)
     FROM azure_costs
     WHERE cost_date >= $2::date AND cost_date < ($2::date + INTERVAL '1 month')
       AND charge_type = 'Usage' AND meter_category = 'Virtual Machines'
       AND unit_of_measure ILIKE '%hour%'
     GROUP BY 2`,
    [mes, ini]
  );

  const seg = Number(((Date.now() - t0) / 1000).toFixed(1));
  await client.query(
    `INSERT INTO azure_tag_rollup_status (mes, construido_em, linhas_lidas, segundos)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (mes) DO UPDATE SET construido_em = NOW(), linhas_lidas = $2, segundos = $3`,
    [mes, r.rowCount, seg]
  );
  await client.query('COMMIT');
  console.log(`[TagRollup] ${origem} ${mes}: ${r.rowCount} linha(s) em ${seg}s`);
  return { mes, linhas: r.rowCount, segundos: seg };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Reconstrói só os meses que mudaram desde o último build (compara MAX(importado_em) do mês
// contra `construido_em`) — mesma disciplina incremental já usada pelo watermark do Inventário.
async function _rebuildAlocacaoTags(origem = 'agendado', forcar = false) {
  if (_scanPesadoEmAndamento()) return { ok: false, motivo: 'outro scan pesado de azure_costs já em execução' };
  if (!pool) return { ok: false, motivo: 'sem banco' };
  _tagRollupEmExecucao = true;
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(
      `SELECT to_char(cost_date,'YYYY-MM') AS mes, MAX(importado_em) AS ultimo_import
       FROM azure_costs GROUP BY 1 ORDER BY 1`
    );
    const st = await pool.query(`SELECT mes, construido_em FROM azure_tag_rollup_status`);
    const construido = new Map(st.rows.map(x => [x.mes.trim(), x.construido_em]));
    // Um mês pode ter as tabelas de TAG prontas mas a de COBERTURA vazia — acontece sempre que
    // uma saída nova é adicionada ao builder depois de um build já ter rodado. Sem checar isso,
    // o incremental pularia o mês e a saída nova nunca seria preenchida (bug real pego no teste:
    // o rebuild manual não fazia nada e a tabela de cobertura ficava em zero).
    const cob = await pool.query(`SELECT DISTINCT mes FROM azure_commitment_cobertura`);
    const temCobertura = new Set(cob.rows.map(x => x.mes.trim()));
    const feitos = [];
    for (const row of r.rows) {
      const anterior = construido.get(row.mes);
      const atualizado = anterior && row.ultimo_import && new Date(row.ultimo_import) <= new Date(anterior);
      if (!forcar && atualizado && temCobertura.has(row.mes)) continue;
      feitos.push(await _rebuildAlocacaoTagsMes(row.mes, origem));
    }
    return { ok: true, meses: feitos };
  } catch (e) {
    console.warn('[TagRollup] Falha:', e.message);
    return { ok: false, motivo: e.message };
  } finally {
    _tagRollupEmExecucao = false;
  }
}

async function _registrarNotificacaoColeta(titulo, mensagem, tipo = 'coleta_concluida', destino = null, destinoParams = null) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO notificacoes_sistema (tipo, titulo, mensagem, destino, destino_params, expira_em) VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '48 hours')`,
      [tipo, titulo, mensagem, destino, destinoParams ? JSON.stringify(destinoParams) : null]
    );
  } catch (_) {}
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

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL — SMTP e alertas (2026-08-26)
// ══════════════════════════════════════════════════════════════════════════════
// Reaproveita a tabela `integracoes` já existente (tipo novo 'smtp'), mesmo padrão
// de AD/Entra — mas diferente deles, a senha vai cifrada com _encryptSecret (AD/
// Entra guardam segredo em texto puro no JSONB; não repetir isso aqui).
// Todas as funções abaixo são silenciosas quando SMTP não está configurado/ativo —
// o sistema inteiro funciona normalmente sem e-mail, ele só some.

function _escHtmlServer(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _parseDestinatarios(str) {
  return String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function _getSmtpConfig() {
  if (!pool) return null;
  try {
    const r = await pool.query(`SELECT config, ativo FROM integracoes WHERE tipo='smtp'`);
    if (!r.rows.length || !r.rows[0].ativo) return null;
    const cfg = r.rows[0].config || {};
    if (!cfg.host || !cfg.usuario || !cfg.senha) return null;
    return { ...cfg, senha: _safeDecrypt(cfg.senha) };
  } catch (_) { return null; }
}

// Log de tentativas de e-mail (2026-09-02, pedido do usuário: "inclua Log nas configurações de
// integrações, estou tentando configurar o e-mail mas não está indo") — ring buffer em memória
// (sem tabela nova — é um diagnóstico operacional, não um dado de negócio; se o servidor
// reiniciar, perde o histórico, mas isso é aceitável pro propósito de "o que aconteceu nos
// últimos envios/testes"). Alimentado tanto por `_sendEmail` (envios reais — alertas
// periódicos, coleta com erro, etc.) quanto por `POST /integrations/smtp/testar` (teste manual
// com credenciais ainda não salvas) — um só lugar pra ver os dois tipos de tentativa em ordem
// cronológica, já que "Testar Conexão" funcionar não garante que os envios reais (que usam a
// config SALVA, possivelmente diferente da testada) também funcionem.
const _EMAIL_LOG_MAX = 50;
let _emailLog = [];
function _logEmailAttempt({ tipo, destinatarios, assunto, ok, erro }) {
  _emailLog.unshift({
    ts: new Date().toISOString(),
    tipo, // 'teste' | 'envio'
    destinatarios: Array.isArray(destinatarios) ? destinatarios.join(', ') : (destinatarios || null),
    assunto: assunto || null,
    ok: !!ok,
    erro: erro || null,
  });
  if (_emailLog.length > _EMAIL_LOG_MAX) _emailLog.length = _EMAIL_LOG_MAX;
}

// Nunca lança pro chamador — falha de e-mail não pode quebrar uma coleta, uma
// troca de status de estimativa, nem nenhum outro fluxo real do sistema.
async function _sendEmail({ to, subject, html }) {
  const destinatarios = (Array.isArray(to) ? to : [to]).filter(Boolean);
  try {
    const cfg = await _getSmtpConfig();
    if (!cfg) return;
    if (!destinatarios.length) return;
    // Timeouts explícitos (2026-09-02) — sem isso, nodemailer usa o default de 2 MINUTOS pra
    // connectionTimeout/socketTimeout; o frontend aborta a chamada de "Testar Conexão" em 30s
    // (ver `api()` em app.js), então um SMTP lento/bloqueado por firewall (comum — silenciosamente
    // descarta pacotes em vez de recusar a conexão) fazia o CLIENTE abortar primeiro, mostrando
    // "Servidor não respondeu em 30s" — mascarando completamente a causa real (host errado,
    // porta bloqueada, credencial errada). 10s por fase é generoso pra uma conexão real e curto
    // o bastante pra devolver o erro de verdade do nodemailer (ECONNREFUSED/ETIMEDOUT/EAUTH)
    // antes de qualquer timeout do lado do cliente.
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 587,
      secure: !!cfg.secure,
      auth: { user: cfg.usuario, pass: cfg.senha },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    await transporter.sendMail({
      from: `"${cfg.remetente_nome || 'FinOps Manager'}" <${cfg.remetente_email || cfg.usuario}>`,
      to: destinatarios.join(','),
      subject,
      html,
    });
    _logEmailAttempt({ tipo: 'envio', destinatarios, assunto: subject, ok: true });
  } catch (e) {
    console.warn('[Email] Falha ao enviar:', e.message);
    _logEmailAttempt({ tipo: 'envio', destinatarios, assunto: subject, ok: false, erro: e.message });
  }
}

// Wrapper HTML com estilos inline (obrigatório em e-mail — a maioria dos clientes
// remove <style> em bloco), cabeçalho no roxo Vivo já usado no resto do app.
function _emailTemplate(titulo, corpoHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <div style="background:#6d28d9;padding:20px 24px"><span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.5px">FinOps Manager</span></div>
    <div style="padding:24px"><h2 style="margin:0 0 16px;color:#111827;font-size:16px">${_escHtmlServer(titulo)}</h2><div style="color:#374151;font-size:14px;line-height:1.6">${corpoHtml}</div></div>
    <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px">Notificação automática — FinOps Manager</div>
  </div>`;
}

// Dedup atômico: uma linha por (tipo,chave); só "ganha o direito" de enviar se não
// houver registro dentro do cooldown de 24h — sem isso, uma checagem periódica
// reenviaria o mesmo alerta a cada hora pra sempre. RETURNING vazio = já enviado
// recentemente, não reenvia (sem race condition — tudo numa query só).
async function _tentarClaimAlerta(tipo, chave) {
  const r = await pool.query(
    `INSERT INTO email_alertas_enviados (tipo, chave) VALUES ($1,$2)
     ON CONFLICT (tipo, chave) DO UPDATE SET enviado_em = NOW()
     WHERE email_alertas_enviados.enviado_em < NOW() - INTERVAL '24 hours'
     RETURNING id`,
    [tipo, chave]
  );
  return r.rows.length > 0;
}

// Orçamento Databricks estourado (≥75%) — chave inclui o mês (YYYY-MM) pra
// reavisar todo mês se continuar estourado, em vez de nunca mais alertar depois
// da primeira vez. Reaproveita a mesma regra de severidade da rota do dashboard.
async function _checkOrcamentosDatabricks() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;
  const alertas = await _computeAlertasDatabricks();
  const mes = new Date().toISOString().slice(0, 7);
  for (const a of alertas) {
    const chave = `orcamento:${a.budget.id}:${mes}`;
    if (!(await _tentarClaimAlerta('orcamento_databricks', chave))) continue;
    const pctFmt = (a.pct * 100).toFixed(0);
    const escopoTxt = a.budget.escopo_tipo === 'workspace' ? a.budget.workspace_id
      : a.budget.escopo_tipo === 'tag' ? `${a.budget.tag_key} = ${a.budget.tag_valor}`
      : 'todos os workspaces';
    await _sendEmail({
      to: destinatarios,
      subject: `⚠ Orçamento Databricks ${a.severidade === 'estourado' ? 'estourado' : 'em alerta'} — ${a.budget.nome}`,
      html: _emailTemplate('Orçamento Databricks', `
        <p><strong>${_escHtmlServer(a.budget.nome)}</strong> (${_escHtmlServer(escopoTxt)}) atingiu <strong>${pctFmt}%</strong> do valor mensal.</p>
        <p>Consumo atual: R$ ${a.custo_atual.toFixed(2)} de R$ ${parseFloat(a.budget.valor_mensal).toFixed(2)}</p>`),
    });
  }
}

// Anomalias de consumo Databricks (2026-08-28) — mesmo mecanismo de dedup/cooldown de 24h
// dos demais gatilhos; chave de custo diário não precisa de sufixo de período (usage_date
// é um dia histórico imutável, nunca se repete), chave de usuário não inclui data (o
// cooldown de 24h já cobre "continua anômalo → reavisa todo dia enquanto persistir",
// mesmo padrão de reserva/ação vencendo acima).
async function _checkAnomaliasDatabricks() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;
  const { custo_diario, usuarios } = await _computeAnomaliasDatabricks();

  for (const a of custo_diario) {
    const chave = `custo_diario:${a.escopo_tipo}:${a.escopo_valor || 'global'}:${a.usage_date}`;
    if (!(await _tentarClaimAlerta('anomalia_databricks', chave))) continue;
    const escopoTxt = a.escopo_tipo === 'workspace' ? `workspace ${a.escopo_valor}` : 'todos os workspaces';
    await _sendEmail({
      to: destinatarios,
      subject: `📈 Anomalia de custo Databricks — ${escopoTxt}`,
      html: _emailTemplate('Anomalia de custo detectada', `
        <p>Custo de <strong>${_escHtmlServer(escopoTxt)}</strong> em ${new Date(a.usage_date).toLocaleDateString('pt-BR')} ficou fora do padrão histórico (Z-score ${a.zscore.toFixed(2)}).</p>
        <p>Custo do dia: R$ ${a.custo.toFixed(2)} — média da janela: R$ ${a.media.toFixed(2)} (desvio padrão: R$ ${a.desvio.toFixed(2)})</p>`),
    });
  }

  for (const u of usuarios) {
    const chave = `usuario:${u.usuario}`;
    if (!(await _tentarClaimAlerta('anomalia_databricks_usuario', chave))) continue;
    const crescimentoTxt = u.crescimento_pct == null
      ? 'apareceu com consumo relevante sem histórico anterior'
      : `cresceu ${(u.crescimento_pct * 100).toFixed(0)}% vs. a média das últimas semanas`;
    await _sendEmail({
      to: destinatarios,
      subject: `👤 Consumo Databricks fora do padrão — ${u.usuario}`,
      html: _emailTemplate('Anomalia de consumo por usuário', `
        <p><strong>${_escHtmlServer(u.usuario)}</strong> ${crescimentoTxt}.</p>
        <p>Consumo dos últimos 7 dias: R$ ${u.custo_recente.toFixed(2)} (R$ ${u.media_diaria_recente.toFixed(2)}/dia)</p>`),
    });
  }
}

// Reservas Cloud vencendo/vencidas (≤90 dias) — mesma janela do popup in-app
// (checkRsvAlertsPopup, app.js). Destinatário: dono real (criado_por → usuarios.email)
// quando existir; sem isso, lista padrão configurada no SMTP.
async function _checkReservasVencendo() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const padrao = _parseDestinatarios(cfg.destinatarios_padrao);
  const r = await pool.query(`
    SELECT rc.*, u.email AS dono_email
    FROM reservas_cloud rc
    LEFT JOIN usuarios u ON u.id = rc.criado_por
    WHERE rc.status = 'Ativa' AND rc.data_vencimento <= NOW() + INTERVAL '90 days'
  `);
  for (const reserva of r.rows) {
    const destinatarios = reserva.dono_email ? [reserva.dono_email] : padrao;
    if (!destinatarios.length) continue;
    if (!(await _tentarClaimAlerta('reserva_vencendo', `reserva:${reserva.id}`))) continue;
    const dias = Math.floor((new Date(reserva.data_vencimento) - new Date()) / 86400000);
    const situacao = dias < 0 ? `expirada há ${Math.abs(dias)} dia(s)` : dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`;
    await _sendEmail({
      to: destinatarios,
      subject: `🔖 Reserva ${_escHtmlServer(reserva.cloud)} ${dias < 0 ? 'expirada' : 'vencendo'} — ${reserva.nome_reserva}`,
      html: _emailTemplate('Reserva Cloud vencendo', `
        <p><strong>${_escHtmlServer(reserva.nome_reserva)}</strong> (${_escHtmlServer(reserva.cloud)} · ${_escHtmlServer(reserva.tipo_recurso)}) ${situacao}.</p>
        <p>Vencimento: ${new Date(reserva.data_vencimento).toLocaleDateString('pt-BR')}</p>`),
    });
  }
}

// Ações FinOps com prazo vencendo/vencido (≤5 dias) — mesmo filtro de
// GET /api/notificacoes. `responsavel` é texto livre (sem FK/email na tabela) —
// tenta casar contra usuarios.nome (mesma convenção já usada pelo sino: lá o
// match é feito no sentido contrário, req.user.nome ILIKE responsavel); sem
// match, cai pra lista padrão.
async function _checkAcoesVencendo() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const padrao = _parseDestinatarios(cfg.destinatarios_padrao);
  const em5dias = new Date(); em5dias.setDate(em5dias.getDate() + 5);
  const r = await pool.query(`
    SELECT a.*, p.nome AS projeto_nome
    FROM acoes_finops a LEFT JOIN projetos p ON a.projeto_id = p.id
    WHERE a.status NOT IN ('Concluído','Cancelado') AND a.data_conclusao IS NOT NULL AND a.data_conclusao <= $1
  `, [em5dias.toISOString().split('T')[0]]);
  for (const acao of r.rows) {
    let destinatarios = padrao;
    if (acao.responsavel) {
      const uMatch = await pool.query(`SELECT email FROM usuarios WHERE nome ILIKE $1 LIMIT 1`, [acao.responsavel]);
      if (uMatch.rows[0]?.email) destinatarios = [uMatch.rows[0].email];
    }
    if (!destinatarios.length) continue;
    if (!(await _tentarClaimAlerta('acao_vencendo', `acao:${acao.id}`))) continue;
    const dias = Math.floor((new Date(acao.data_conclusao) - new Date()) / 86400000);
    const situacao = dias < 0 ? `venceu há ${Math.abs(dias)} dia(s)` : dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`;
    await _sendEmail({
      to: destinatarios,
      subject: `⚠ Ação FinOps ${dias < 0 ? 'vencida' : 'vencendo'} — ${acao.id_finops}`,
      html: _emailTemplate('Ação FinOps com prazo vencendo', `
        <p><strong>${_escHtmlServer(acao.acao)}</strong> (${_escHtmlServer(acao.id_finops)}${acao.projeto_nome ? ' · ' + _escHtmlServer(acao.projeto_nome) : ''}) ${situacao}.</p>
        <p>Responsável: ${_escHtmlServer(acao.responsavel || '—')}</p>`),
    });
  }
}

// Checagens periódicas — intervalo próprio, separado do agendador de coleta
// (_iniciarAgendador/_tickAgendador rodam a cada 5min com um `return` antecipado
// no bloco de Storage que pularia qualquer coisa adicionada depois no mesmo tick;
// alertas por e-mail não têm essa urgência de 5min, então não valia acoplar ali).
let _alertasEmailTimer = null;
// Governança de crescimento de Inventário (2026-08-31) — 3 gatilhos periódicos, mesmo
// padrão de dedup/cooldown de 24h dos demais. `_computeAnomaliasCrescimento`/
// `_computeOrcamentosInventarioAlertas` são declaradas mais abaixo (junto das rotas
// GET .../anomalias e .../orcamentos/alertas que também as usam) — hoisting de function
// declaration já é o padrão deste arquivo (ex: _checkAnomaliasDatabricks chama
// _computeAnomaliasDatabricks, definida centenas de linhas depois).
// Gap de coleta: alerta se Inventário não rodou em >7 dias.
// Usa dedup com 24h de cooldown (evita spam, mas re-alerta diariamente se o problema persiste).
async function _checkGapColetaInventario() {
  if (!pool) return;
  const cfg = await _getSmtpConfig();
  const destinatarios = cfg ? _parseDestinatarios(cfg.destinatarios_padrao) : [];

  const r = await pool.query(`
    SELECT MAX(concluido_em) as ultima_coleta
    FROM azure_coleta_historico
    WHERE tipo = 'Inventário' AND status = 'concluido'
  `);
  const ultimaColeta = r.rows[0]?.ultima_coleta ? new Date(r.rows[0].ultima_coleta) : null;
  const agora = new Date();
  const diasDesdeUltima = ultimaColeta ? Math.floor((agora - ultimaColeta) / (1000 * 60 * 60 * 24)) : null;

  if (!ultimaColeta || diasDesdeUltima > 7) {
    const chave = ultimaColeta ? `gap:${ultimaColeta.toISOString().slice(0, 10)}` : `gap:nunca`;
    if (!(await _tentarClaimAlerta('coleta_gap_inventario', chave))) return;

    const msg = ultimaColeta
      ? `Inventário não foi coletado há ${diasDesdeUltima} dias (última coleta: ${ultimaColeta.toLocaleDateString('pt-BR')})`
      : `Inventário nunca foi coletado`;

    await _registrarNotificacaoColeta(
      `⚠️ Gap de coleta — Inventário pausado`,
      msg,
      'coleta_gap',
      'inventario:auditoria'
    );

    if (destinatarios.length) {
      await _sendEmail({
        to: destinatarios,
        subject: `⚠️ Gap de coleta — Inventário pausado por ${diasDesdeUltima || '?'} dias`,
        html: _emailTemplate('Gap de coleta detectado', `<p>${_escHtmlServer(msg)}</p>`)
      });
    }
  }
}

// Alerta no sino (2026-09-04, pedido do usuário: "controlar e acompanhar no detalhe... pra
// agir mais rápido") — antes só existia por e-mail, então num ambiente sem SMTP configurado
// (o caso deste ambiente) a anomalia nunca era vista por ninguém. Reaproveita
// `notificacoes_sistema`/`_registrarNotificacaoColeta` (mesma tabela já usada pelas
// notificações de coleta) — some da lista do sino sozinha após 48h (`expira_em`), igual às
// demais. Roda SEMPRE, independente de SMTP configurado — só o envio de e-mail depende disso.
async function _checkAnomaliasCrescimentoInventario() {
  const anomalias = await _computeAnomaliasCrescimento();
  if (!anomalias.length) return;
  const cfg = await _getSmtpConfig();
  const destinatarios = cfg ? _parseDestinatarios(cfg.destinatarios_padrao) : [];
  for (const a of anomalias) {
    const chave = `crescimento:${a.subscription_id}:${a.resource_group || 'global'}:${a.dia}`;
    if (!(await _tentarClaimAlerta('anomalia_crescimento_inventario', chave))) continue;
    const escopoTxt = a.escopo_tipo === 'resource_group' ? `Resource Group ${a.resource_group}` : `subscription ${a.subscription_id}`;
    const partesHtml = [];
    const partesTexto = [];
    if (a.gatilho === 'criacoes' || a.gatilho === 'ambos') {
      partesHtml.push(`<strong>${a.criacoes}</strong> recurso(s) criado(s) (média: ${a.media_criacoes.toFixed(1)}/dia, Z-score ${a.zscore_criacoes.toFixed(2)})`);
      partesTexto.push(`${a.criacoes} recurso(s) criado(s) (média ${a.media_criacoes.toFixed(1)}/dia)`);
    }
    if (a.gatilho === 'custo' || a.gatilho === 'ambos') {
      partesHtml.push(`custo de <strong>R$ ${a.custo.toFixed(2)}</strong> (média: R$ ${a.media_custo.toFixed(2)}/dia, Z-score ${a.zscore_custo.toFixed(2)})`);
      partesTexto.push(`custo de R$ ${a.custo.toFixed(2)} (média R$ ${a.media_custo.toFixed(2)}/dia)`);
    }
    // O clique leva à lista de recursos do escopo que gerou o alerta (assinatura ou RG). Só filtra pelo dia
    // quando o gatilho inclui criações (a lista mostra o que foi criado naquele dia); anomalia só de
    // custo lista o escopo inteiro. Escopo de assinatura ignora RG gerenciado, como a contagem da anomalia.
    const destinoParams = {
      subscription_id: a.subscription_id,
      resource_group: a.resource_group || null,
      dia: (a.gatilho === 'criacoes' || a.gatilho === 'ambos') ? String(a.dia).slice(0, 10) : null,
      excluir_gerenciados: !a.resource_group,
    };
    await _registrarNotificacaoColeta(
      `📈 Crescimento anômalo — ${escopoTxt}`,
      `${partesTexto.join(' e ')} em ${new Date(a.dia).toLocaleDateString('pt-BR')}.`,
      'inventario_crescimento',
      'inventario:recursos',
      destinoParams
    );
    if (destinatarios.length) {
      await _sendEmail({
        to: destinatarios,
        subject: `📈 Crescimento anômalo — ${escopoTxt}`,
        html: _emailTemplate('Crescimento anômalo detectado', `
          <p><strong>${_escHtmlServer(escopoTxt)}</strong> ficou fora do padrão histórico em ${new Date(a.dia).toLocaleDateString('pt-BR')}: ${partesHtml.join(' e ')}.</p>
          <p>Janela de referência: últimos 35 dias.</p>`),
      });
    }
  }
}

// Chave inclui o mês pra tipo "custo" (reseta todo mês, mesmo padrão do orçamento
// Databricks); tipo "recursos" não tem reset mensal natural — cooldown de 24h já cobre
// "continua estourado → reavisa todo dia enquanto persistir" (mesmo padrão de reserva/
// ação vencendo).
async function _checkOrcamentosInventario() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;
  const alertas = await _computeOrcamentosInventarioAlertas();
  const mes = new Date().toISOString().slice(0, 7);
  for (const a of alertas) {
    const chave = a.orcamento.tipo_limite === 'custo' ? `orcamento_inv:${a.orcamento.id}:${mes}` : `orcamento_inv:${a.orcamento.id}`;
    if (!(await _tentarClaimAlerta('orcamento_inventario', chave))) continue;
    const pctFmt = (a.pct * 100).toFixed(0);
    const escopoTxt = a.orcamento.resource_group ? `RG ${a.orcamento.resource_group}` : `subscription ${a.orcamento.subscription_id}`;
    const custoTipo = a.orcamento.tipo_limite === 'custo';
    const fmtNum = (v) => custoTipo ? `R$ ${parseFloat(v).toFixed(2)}` : `${Math.round(v)} recurso(s)`;
    await _sendEmail({
      to: destinatarios,
      subject: `⚠ Orçamento de Inventário ${a.severidade === 'estourado' ? 'estourado' : 'em alerta'} — ${a.orcamento.nome}`,
      html: _emailTemplate('Orçamento de crescimento de recursos', `
        <p><strong>${_escHtmlServer(a.orcamento.nome)}</strong> (${_escHtmlServer(escopoTxt)}) atingiu <strong>${pctFmt}%</strong> do limite${custoTipo ? ' de custo do mês' : ' de recursos ativos'}.</p>
        <p>Valor atual: ${fmtNum(a.valor_atual)} de ${fmtNum(a.orcamento.limite_valor)}</p>`),
    });
  }
}

// Relatório semanal — chave de dedup baseada num "bucket" de 7 dias desde a epoch (não
// alinhado a semana-calendário ISO, mas determinístico e simples, sem precisar de lib de
// data nova) — muda exatamente a cada 7 dias, então dispara no máximo 1x por semana
// mesmo com o tick horário rodando o tempo todo.
async function _checkRelatorioSemanalInventario() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;

  const semanaKey = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  if (!(await _tentarClaimAlerta('relatorio_semanal_inventario', `semana:${semanaKey}`))) return;

  const hoje = new Date();
  const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
  const inicioStr = seteDiasAtras.toISOString().slice(0, 10);
  const fimStr = hoje.toISOString().slice(0, 10);

  const [eventosR, custoR, topRgR] = await Promise.all([
    pool.query(`SELECT acao, COUNT(*) AS total FROM azure_recursos_auditoria_eventos WHERE quando >= $1 GROUP BY acao`, [seteDiasAtras.toISOString()]),
    pool.query(`
      SELECT COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'), 0) AS marketplace,
             COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS microsoft
      FROM azure_costs WHERE cost_date >= $1 AND cost_date <= $2`, [inicioStr, fimStr]),
    pool.query(`
      SELECT resource_group, COUNT(*) AS criacoes FROM azure_recursos_auditoria_eventos
      WHERE acao='CRIACAO' AND quando >= $1 AND resource_group IS NOT NULL
      GROUP BY resource_group ORDER BY criacoes DESC LIMIT 5
    `, [seteDiasAtras.toISOString()]),
  ]);

  const eventos = { CRIACAO: 0, ATUALIZACAO: 0, EXCLUSAO: 0 };
  for (const row of eventosR.rows) eventos[row.acao] = parseInt(row.total, 10);
  const custoTotal = _comImpostoSplit(custoR.rows[0].microsoft, custoR.rows[0].marketplace, await _getImpostoConfig());

  const topRgHtml = topRgR.rows.length
    ? `<ul style="margin:8px 0;padding-left:20px">${topRgR.rows.map(r => `<li>${_escHtmlServer(r.resource_group)} — ${r.criacoes} recurso(s) criado(s)</li>`).join('')}</ul>`
    : '<p style="color:#9ca3af">Nenhum recurso criado nesta semana.</p>';

  await _sendEmail({
    to: destinatarios,
    subject: `📊 Relatório semanal de Inventário — ${eventos.CRIACAO} criados, ${eventos.EXCLUSAO} excluídos`,
    html: _emailTemplate('Relatório semanal de crescimento de recursos', `
      <p><strong>${eventos.CRIACAO}</strong> recurso(s) criado(s), <strong>${eventos.ATUALIZACAO}</strong> atualizado(s), <strong>${eventos.EXCLUSAO}</strong> excluído(s) nos últimos 7 dias.</p>
      <p>Custo total do período: <strong>R$ ${custoTotal.toFixed(2)}</strong></p>
      <p style="margin-top:16px;font-weight:700">Resource Groups com mais criações:</p>
      ${topRgHtml}`),
  });
}

// Relatório diário (2026-09-02, pedido do usuário: "auditoria rode uma vez por dia e faça um
// comparativo do dia anterior e informe quantos recursos novos") — complementa o relatório
// semanal acima (visão de 7 dias corridos) com um dia-a-dia: quantos recursos foram criados
// ONTEM (dia corrido completo, não "últimas 24h" a partir de agora — evita contar um dia
// parcial) comparado contra o dia anterior a esse (ANTEONTEM), mesmo espírito de "delta vs.
// período anterior" já usado no Comparativo manual da UI.
//
// Cálculo extraído pra uma função própria (2026-09-02, pedido do usuário: "mostra isso só por
// e-mail ou em algum painel também?") — reaproveitada tanto pelo e-mail (`_checkRelatorioDiarioInventario`,
// com dedup/SMTP) quanto por `GET /relatorio-diario` (card na aba Auditoria, sempre disponível,
// sem depender de SMTP configurado) — mesmo dado, dois consumidores, sem duplicar a query nem o
// filtro de RG gerenciado.
async function _computeRelatorioDiarioInventario() {
  // Dia corrido em UTC — mesma convenção já usada pra `criado_em`/`quando` (sempre gravados
  // em UTC, ver comentário da migração TIMESTAMPTZ na criação das tabelas de Inventário).
  const ontemFim = new Date(); ontemFim.setUTCHours(0, 0, 0, 0); // meia-noite de hoje = fim de ontem
  const ontemInicio = new Date(ontemFim); ontemInicio.setUTCDate(ontemInicio.getUTCDate() - 1);
  const anteontemInicio = new Date(ontemInicio); anteontemInicio.setUTCDate(anteontemInicio.getUTCDate() - 1);

  // Exclui RGs gerenciados por Databricks/AKS — mesmo filtro e mesma justificativa já usados
  // em `GET /crescimento-liquido`/`_detectarMudancasSku`: esses RGs são recriados em HORAS
  // (VMs/discos/NICs efêmeros de cluster), então a contagem bruta de CRIACAO/EXCLUSAO é
  // dominada por churn de infraestrutura, não crescimento real — confirmado com dados reais
  // desta sessão (mais de 16 mil "criações" num único dia, quase tudo em RGs `databricks-rg-*`/
  // `managed-rg-*`). Sem esse filtro, "quantos recursos novos" reportaria um número gigante e
  // sem sentido pro usuário. Classificação em JS (não dá pra fazer em SQL sem duplicar o
  // padrão de nome de `_detectManagedRg`) — tabela de RGs distintos é pequena, barato de
  // classificar a cada chamada.
  const rgRows = await pool.query(`SELECT DISTINCT resource_group FROM azure_recursos_auditoria_eventos WHERE resource_group IS NOT NULL AND quando >= $1`, [anteontemInicio.toISOString()]);
  const rgsGerenciados = rgRows.rows
    .map((r) => r.resource_group)
    .filter((rg) => _detectManagedRg(rg).managed_type)
    .map((rg) => rg.toUpperCase());

  const [ontemR, criadosAnteontemR, topRgR] = await Promise.all([
    pool.query(
      `SELECT acao, COUNT(*) AS total FROM azure_recursos_auditoria_eventos
       WHERE quando >= $1 AND quando < $2 AND NOT (UPPER(COALESCE(resource_group,'')) = ANY($3::text[]))
       GROUP BY acao`,
      [ontemInicio.toISOString(), ontemFim.toISOString(), rgsGerenciados]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM azure_recursos_auditoria_eventos
       WHERE acao='CRIACAO' AND quando >= $1 AND quando < $2 AND NOT (UPPER(COALESCE(resource_group,'')) = ANY($3::text[]))`,
      [anteontemInicio.toISOString(), ontemInicio.toISOString(), rgsGerenciados]
    ),
    pool.query(
      `SELECT resource_group, COUNT(*) AS criacoes FROM azure_recursos_auditoria_eventos
       WHERE acao='CRIACAO' AND quando >= $1 AND quando < $2 AND resource_group IS NOT NULL
         AND NOT (UPPER(COALESCE(resource_group,'')) = ANY($3::text[]))
       GROUP BY resource_group ORDER BY criacoes DESC LIMIT 5`,
      [ontemInicio.toISOString(), ontemFim.toISOString(), rgsGerenciados]
    ),
  ]);

  const eventos = { CRIACAO: 0, ATUALIZACAO: 0, EXCLUSAO: 0 };
  for (const row of ontemR.rows) eventos[row.acao] = parseInt(row.total, 10);
  const criadosAnteontem = parseInt(criadosAnteontemR.rows[0].total, 10);

  return {
    dia: ontemInicio.toISOString().slice(0, 10),
    dia_anterior: anteontemInicio.toISOString().slice(0, 10),
    criados: eventos.CRIACAO,
    atualizados: eventos.ATUALIZACAO,
    excluidos: eventos.EXCLUSAO,
    criados_dia_anterior: criadosAnteontem,
    delta: eventos.CRIACAO - criadosAnteontem,
    top_resource_groups: topRgR.rows.map((r) => ({ resource_group: r.resource_group, criacoes: parseInt(r.criacoes, 10) })),
  };
}

async function _checkRelatorioDiarioInventario() {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;

  // Dedup por data (não por bucket de tempo desde a epoch, ao contrário do semanal) — mais
  // simples de raciocinar e já expressa exatamente o que precisa ("já mandei o relatório de
  // hoje?"). Dispara no máximo 1x por dia mesmo com o tick horário rodando o tempo todo.
  const hojeStr = new Date().toISOString().slice(0, 10);
  if (!(await _tentarClaimAlerta('relatorio_diario_inventario', `dia:${hojeStr}`))) return;

  const r = await _computeRelatorioDiarioInventario();
  const delta = r.delta;
  const deltaTxt = delta === 0
    ? `igual ao dia anterior (${r.criados_dia_anterior})`
    : delta > 0
      ? `<span style="color:#22c55e">▲ ${delta} a mais</span> que o dia anterior (${r.criados_dia_anterior})`
      : `<span style="color:#ff4d6a">▼ ${Math.abs(delta)} a menos</span> que o dia anterior (${r.criados_dia_anterior})`;

  const topRgHtml = r.top_resource_groups.length
    ? `<ul style="margin:8px 0;padding-left:20px">${r.top_resource_groups.map(x => `<li>${_escHtmlServer(x.resource_group)} — ${x.criacoes} recurso(s) novo(s)</li>`).join('')}</ul>`
    : '<p style="color:#9ca3af">Nenhum recurso criado ontem.</p>';

  const dataOntemFmt = new Date(r.dia + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  await _sendEmail({
    to: destinatarios,
    subject: `📅 Inventário diário (${dataOntemFmt}) — ${r.criados} recurso(s) novo(s)`,
    html: _emailTemplate('Relatório diário de crescimento de recursos', `
      <p><strong>${r.criados}</strong> recurso(s) novo(s) em ${dataOntemFmt}, <strong>${r.atualizados}</strong> atualizado(s), <strong>${r.excluidos}</strong> excluído(s).</p>
      <p>Comparado ao dia anterior: ${deltaTxt}.</p>
      <p style="margin-top:16px;font-weight:700">Resource Groups com mais criações:</p>
      ${topRgHtml}
      <p style="margin-top:16px;font-size:11px;color:#9ca3af">Exclui recursos de Resource Groups gerenciados por Databricks/AKS (clusters efêmeros, recriados em horas) — só conta infraestrutura que de fato permanece.</p>`),
  });
}

function _iniciarAlertasEmail() {
  if (_alertasEmailTimer || !pool) return;
  const tick = async () => {
    try { await _checkOrcamentosDatabricks(); } catch (e) { console.warn('[Email] Checagem de orçamentos falhou:', e.message); }
    try { await _checkReservasVencendo(); } catch (e) { console.warn('[Email] Checagem de reservas falhou:', e.message); }
    try { await _checkAcoesVencendo(); } catch (e) { console.warn('[Email] Checagem de ações falhou:', e.message); }
    try { await _checkAnomaliasDatabricks(); } catch (e) { console.warn('[Email] Checagem de anomalias Databricks falhou:', e.message); }
    try { await _checkAnomaliasCrescimentoInventario(); } catch (e) { console.warn('[Email] Checagem de anomalias de crescimento falhou:', e.message); }
    try { await _checkOrcamentosInventario(); } catch (e) { console.warn('[Email] Checagem de orçamentos de Inventário falhou:', e.message); }
    try { await _checkGapColetaInventario(); } catch (e) { console.warn('[Email] Checagem de gap de coleta falhou:', e.message); }
    try { await _checkRelatorioSemanalInventario(); } catch (e) { console.warn('[Email] Relatório semanal de Inventário falhou:', e.message); }
    try { await _checkRelatorioDiarioInventario(); } catch (e) { console.warn('[Email] Relatório diário de Inventário falhou:', e.message); }
  };
  setTimeout(tick, 180 * 1000);
  _alertasEmailTimer = setInterval(tick, 60 * 60 * 1000);
}

// Coleta com erro (Azure API/Storage + Databricks) — evento, dispara 1x por falha
// real (não precisa de dedup, ao contrário das checagens periódicas acima).
// Chamada ao lado de cada _registrarNotificacaoColeta(...,'coleta_erro') — não
// duplica a lógica de notificação in-app, só soma o envio por e-mail.
async function _alertarColetaComErro(titulo, mensagem) {
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;
  await _sendEmail({ to: destinatarios, subject: `❌ ${titulo}`, html: _emailTemplate(titulo, `<p>${_escHtmlServer(mensagem)}</p>`) });
}

// Alteração de propriedade "de infra" (2026-09-03, pedido do usuário — 1 das 4 melhorias
// sugeridas após expandir o rastreio de propriedades) — evento, sem dedup (cada linha em
// `azure_recursos_mudancas_propriedade` só é inserida uma vez). Deliberadamente só propriedades
// de infra (SKU de VM, disco, storage, IP) — NUNCA tags: uma re-tag em massa por automação
// dispararia dezenas de e-mails de uma vez, mesmo raciocínio já usado pra excluir e-mail de
// "coleta com sucesso" ("viraria spam sem valor"). Chamado pelo próprio `_coletarInventarioAzure`
// logo após o INSERT bem-sucedido — nunca lança pro chamador (mesma garantia de `_sendEmail`).
async function _alertarMudancaPropriedade(nomeRecurso, resourceGroup, p, autor, quando, ids = null) {
  // Sino primeiro (2026-09-04) — sempre, independente de SMTP configurado (mesmo raciocínio
  // de _checkAnomaliasCrescimentoInventario). E-mail continua condicionado à config existente.
  // Com `ids`, o clique abre o detalhe do próprio recurso; sem, cai na aba Auditoria.
  await _registrarNotificacaoColeta(
    `🔧 ${p.propriedade_label} — ${nomeRecurso}`,
    `${p.valor_anterior} → ${p.valor_novo} (${resourceGroup || '—'}) · por ${autor || 'desconhecido'}`,
    'inventario_alteracao',
    ids ? 'inventario:recursos' : 'inventario:auditoria',
    ids ? { resource_id: ids.resource_id, subscription_id: ids.subscription_id } : null
  );
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  const destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (!destinatarios.length) return;
  await _sendEmail({
    to: destinatarios,
    subject: `🔧 ${p.propriedade_label} mudou — ${nomeRecurso}`,
    html: _emailTemplate('Alteração de propriedade detectada', `
      <p><strong>${_escHtmlServer(nomeRecurso)}</strong> (${_escHtmlServer(resourceGroup || '—')})</p>
      <p>${_escHtmlServer(p.propriedade_label)}: <strong style="color:#dc2626">${_escHtmlServer(p.valor_anterior)}</strong> → <strong style="color:#16a34a">${_escHtmlServer(p.valor_novo)}</strong></p>
      <p style="margin-top:12px;font-size:12px;color:#6b7280">Detectado por ${_escHtmlServer(autor || 'desconhecido')} em ${quando ? new Date(quando).toLocaleString('pt-BR') : '—'}. Veja o histórico completo em Inventário → Auditoria.</p>`),
  });
}

// Estimativa aprovada/reprovada — evento (PUT /api/estimativas/:id/status), sem
// dedup (dispara 1x por troca real de status). `responsavel` é texto livre —
// mesma tentativa de casar com usuarios.nome usada em _checkAcoesVencendo.
async function _alertarEstimativaStatus(estimativa) {
  if (estimativa.status !== 'Aprovado' && estimativa.status !== 'Nao Aprovado') return;
  const cfg = await _getSmtpConfig();
  if (!cfg) return;
  let destinatarios = _parseDestinatarios(cfg.destinatarios_padrao);
  if (estimativa.responsavel) {
    const uMatch = await pool.query(`SELECT email FROM usuarios WHERE nome ILIKE $1 LIMIT 1`, [estimativa.responsavel]);
    if (uMatch.rows[0]?.email) destinatarios = [uMatch.rows[0].email];
  }
  if (!destinatarios.length) return;
  const aprovado = estimativa.status === 'Aprovado';
  await _sendEmail({
    to: destinatarios,
    subject: `${aprovado ? '✅' : '❌'} Estimativa ${estimativa.numero || estimativa.id} — ${estimativa.status}`,
    html: _emailTemplate('Estimativa ' + estimativa.status, `
      <p><strong>${_escHtmlServer(estimativa.titulo || 'Estimativa')}</strong> (${_escHtmlServer(estimativa.numero || '#' + estimativa.id)}${estimativa.projeto_nome ? ' · ' + _escHtmlServer(estimativa.projeto_nome) : ''}) foi <strong>${aprovado ? 'aprovada' : 'reprovada'}</strong>.</p>
      <p>Total: R$ ${parseFloat(estimativa.total_final || 0).toFixed(2)}</p>`),
  });
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
  const _tickAgendador = async () => {
    // Safety valve: resetar coleta travada há mais de 6h
    if (_coletaEmExecucao && _coletaIniciadaEm) {
      const elapsedMs = Date.now() - _coletaIniciadaEm.getTime();
      if (elapsedMs > 6 * 60 * 60 * 1000) {
        console.warn('[Agendador] SAFETY VALVE: coleta travada >6h — resetando');
        _logColeta('[CB] Safety valve: coleta travada ' + Math.round(elapsedMs / 60000) + 'min (>6h) — resetando flags');
        _coletaEmExecucao = false;
        _coletaIniciadaEm = null;
        _cbCore.reset();
      }
    }
    if (_coletaEmExecucao || !pool) return;
    try {
      await ensureAzureColetaTable();
      // Storage: suporta agendamento por hora+dia ou por intervalo (legado)
      // Exige storage_account + storage_container preenchidos (credenciais reais)
      const rStg = await pool.query(`
        SELECT id, nome, hora_execucao, dias_semana, auto_coleta_horas
        FROM azure_storage_config
        WHERE ativo = true
          AND storage_account IS NOT NULL AND storage_account <> ''
          AND storage_container IS NOT NULL AND storage_container <> ''
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

      // API: agendamento por hora+dia (suporta modo billing_profile e subscription)
      // Detecção de modo pelas credenciais disponíveis, não pelo campo modo_coleta
      // (evita bloqueio quando modo_coleta está desatualizado no banco)
      const rApi = await pool.query(`
        SELECT id, nome, billing_account_id, billing_profile_id, modo_coleta, subscription_ids, granularidade_dias, hora_execucao, dias_semana
        FROM azure_coleta_config
        WHERE ativo = true
          AND auto_coleta = true
          AND hora_execucao IS NOT NULL
          AND dias_semana IS NOT NULL
          AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
          AND (
            (billing_account_id IS NOT NULL AND billing_profile_id IS NOT NULL)
            OR
            (subscription_ids IS NOT NULL AND subscription_ids <> '')
          )
        ORDER BY is_padrao DESC, proxima_coleta ASC NULLS FIRST
        LIMIT 1
      `);
      if (rApi.rows.length) {
        const sp = rApi.rows[0];
        // Detecta modo pelo que está disponível, não pelo campo modo_coleta
        const modoSp = (sp.billing_account_id && sp.billing_profile_id)
          ? 'billing_profile'
          : 'subscription';
        console.log(`[Agendador] Disparando coleta API SP #${sp.id} (${sp.nome}) modo=${modoSp}`);
        const proxima = _computeProximaColeta(sp.hora_execucao, sp.dias_semana);
        await pool.query(
          `UPDATE azure_coleta_config SET proxima_coleta=$1 WHERE id=$2`,
          [proxima, sp.id]
        );
        const granDias = sp.granularidade_dias || 7;
        const fim    = new Date(); fim.setDate(fim.getDate() - 1);
        const inicio = new Date(fim); inicio.setDate(inicio.getDate() - (granDias - 1));
        const fmt = d => d.toISOString().slice(0, 10);
        const subIds = modoSp === 'subscription'
          ? (sp.subscription_ids || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
          : [];
        const baId = modoSp === 'billing_profile' ? _decryptSecret(sp.billing_account_id) : '';
        const bpId = modoSp === 'billing_profile' ? _decryptSecret(sp.billing_profile_id) : '';
        _executarColetaAPI(sp.id, baId, bpId, fmt(inicio), fmt(fim), modoSp, subIds, undefined, undefined, 'agendado')
          .then(async () => {
            // Após coleta regular, processa itens pendentes desta SP
            try {
              const pend = await pool.query(
                `DELETE FROM azure_coleta_pendentes WHERE sp_id=$1 OR sp_id IS NULL RETURNING *`,
                [sp.id]
              );
              for (const p of pend.rows) {
                if (_coletaEmExecucao) { await new Promise(r => setTimeout(r, 500)); }
                const pSubIds = p.subscription_id ? [p.subscription_id] : subIds;
                _logColeta(`[Pendente] Iniciando reprocessamento: ${p.descricao || p.data_inicio + '→' + p.data_fim}`);
                await _executarColetaAPI(sp.id, baId, bpId, p.data_inicio, p.data_fim, modoSp, pSubIds, [], 'ActualCost', 'agendado-pendente')
                  .catch(e => _logColeta(`[Pendente] Erro: ${e.message}`));
              }
            } catch (e) { console.error('[Agendador] Erro pendentes:', e.message); }
          })
          .catch(e => console.error(`[Agendador] Erro coleta API #${sp.id}:`, e.message));
      }

      // ── Price List: agendamento mensal ───────────────────────────────────────
      if (!_syncingPriceList) {
        try {
          const rPl = await pool.query(
            `SELECT value FROM azure_price_list_meta WHERE key = 'pl_schedule'`
          );
          if (rPl.rows.length) {
            const cfg = JSON.parse(rPl.rows[0].value);
            if (cfg.ativo) {
              const now      = new Date();
              const diaMes   = parseInt(cfg.dia_mes) || 28;
              const hora     = parseInt(cfg.hora)    || 2;
              const diaAtual = now.getDate();
              const horaAtual = now.getHours();
              // Último dia do mês: se dia configurado > dias no mês atual, usa último dia
              const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const diaExec  = Math.min(diaMes, ultimoDia);
              if (diaAtual === diaExec && horaAtual === hora) {
                // Verifica se já rodou hoje para não disparar múltiplas vezes no mesmo dia/hora
                const rUlt = await pool.query(
                  `SELECT value FROM azure_price_list_meta WHERE key = 'pl_schedule_last_run'`
                );
                const hoje = now.toISOString().slice(0, 10);
                const lastRun = rUlt.rows.length ? rUlt.rows[0].value.replace(/"/g, '') : '';
                if (lastRun !== hoje) {
                  console.log(`[Agendador] Disparando sync mensal do Price List (dia ${diaExec} às ${hora}h)`);
                  await pool.query(`
                    INSERT INTO azure_price_list_meta (key, value, updated_at)
                    VALUES ('pl_schedule_last_run', $1, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                  `, [JSON.stringify(hoje)]);
                  _syncPriceList().catch(e =>
                    console.error('[Agendador] Erro sync mensal Price List:', e.message)
                  );
                }
              }
            }
          }
        } catch (ePlSched) {
          // "does not exist" = tabela ainda não criada (startup race) — skip silencioso
          if (!ePlSched.message.includes('does not exist')) {
            console.warn('[Agendador] Erro ao verificar schedule Price List:', ePlSched.message);
          }
        }
      }

      // ── Databricks: agendamento por hora+dia — independente do Azure, usa
      // _dbxColetaEmExecucao (não _coletaEmExecucao) pra não bloquear nem ser
      // bloqueado pela coleta Azure, já que escrevem em tabelas separadas.
      if (!_dbxColetaEmExecucao) {
        try {
          const rDbx = await pool.query(`
            SELECT id, nome, granularidade_dias, hora_execucao, dias_semana
            FROM databricks_coleta_config
            WHERE ativo = true
              AND auto_coleta = true
              AND hora_execucao IS NOT NULL
              AND dias_semana IS NOT NULL
              AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
            ORDER BY is_padrao DESC, proxima_coleta ASC NULLS FIRST
            LIMIT 1
          `);
          if (rDbx.rows.length) {
            const dbxCfg = rDbx.rows[0];
            console.log(`[Agendador] Disparando coleta Databricks #${dbxCfg.id} (${dbxCfg.nome})`);
            const proxima = _computeProximaColeta(dbxCfg.hora_execucao, dbxCfg.dias_semana);
            await pool.query(`UPDATE databricks_coleta_config SET proxima_coleta=$1 WHERE id=$2`, [proxima, dbxCfg.id]);
            const granDias = dbxCfg.granularidade_dias || 7;
            const fim    = new Date(); fim.setDate(fim.getDate() - 1);
            const inicio = new Date(fim); inicio.setDate(inicio.getDate() - (granDias - 1));
            const fmt = d => d.toISOString().slice(0, 10);
            _executarColetaDatabricks(dbxCfg.id, fmt(inicio), fmt(fim), 'agendado')
              .catch(e => console.error(`[Agendador] Erro coleta Databricks #${dbxCfg.id}:`, e.message));
          }
        } catch (eDbxSched) {
          if (!eDbxSched.message.includes('does not exist')) {
            console.warn('[Agendador] Erro ao verificar schedule Databricks:', eDbxSched.message);
          }
        }
      }

    } catch (e) {
      console.warn(`[Agendador] Erro ao verificar schedule: ${e.message} | pool: ${pool?.totalCount}/${pool?.idleCount}/${pool?.waitingCount} (total/idle/waiting)`);
    }
  };
  // Aguarda 120s no primeiro tick: CREATE MV (price list), CREATE INDEX (azure_costs)
  // e _refreshAzureCache (90s delay) já terminaram antes de competir por conexões.
  // Depois dispara a cada 5 minutos normalmente.
  setTimeout(_tickAgendador, 120 * 1000);
  _agendadorTimer = setInterval(_tickAgendador, 5 * 60 * 1000);
}

// ── Endpoints coleta ──────────────────────────────────────────────────────────

app.get('/api/azure-coleta/diag-agendador', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const now = new Date();
    const [rApi, rStg] = await Promise.all([
      pool.query(`
        SELECT id, nome, ativo, auto_coleta, modo_coleta, hora_execucao, dias_semana,
               subscription_ids IS NOT NULL AND subscription_ids <> '' AS tem_subs,
               billing_account_id IS NOT NULL AS tem_billing,
               proxima_coleta, NOW() AS agora_pg,
               (ativo = true AND auto_coleta = true
                AND hora_execucao IS NOT NULL AND dias_semana IS NOT NULL
                AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
                AND (
                  (billing_account_id IS NOT NULL AND billing_profile_id IS NOT NULL)
                  OR (subscription_ids IS NOT NULL AND subscription_ids <> '')
                )
               ) AS deveria_rodar
        FROM azure_coleta_config ORDER BY id`),
      pool.query(`
        SELECT id, nome, ativo, hora_execucao, dias_semana, auto_coleta_horas,
               storage_account IS NOT NULL AND storage_account <> '' AS tem_storage,
               proxima_coleta, NOW() AS agora_pg,
               (ativo = true
                AND storage_account IS NOT NULL AND storage_account <> ''
                AND storage_container IS NOT NULL AND storage_container <> ''
                AND (proxima_coleta IS NULL OR proxima_coleta <= NOW())
                AND (
                  (hora_execucao IS NOT NULL AND dias_semana IS NOT NULL)
                  OR (auto_coleta_horas IS NOT NULL AND auto_coleta_horas > 0)
                )
               ) AS deveria_rodar
        FROM azure_storage_config ORDER BY id`),
    ]);
    res.json({
      agora_node:        now.toISOString(),
      agora_node_local:  now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      tz_process:        process.env.TZ || '(nao definido)',
      coleta_em_execucao: _coletaEmExecucao,
      agendador_ativo:   !!_agendadorTimer,
      api_sps:           rApi.rows,
      storage_sps:       rStg.rows,
    });
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/cancelar', authMiddleware, (_req, res) => {
  if (!_coletaEmExecucao) return res.status(409).json({ error: 'Nenhuma coleta em execução' });
  _coletaCancelada = true;
  _logColeta('Cancelamento solicitado pelo usuário via API');
  res.json({ ok: true, message: 'Cancelamento solicitado' });
});

app.get('/api/azure-coleta/status', authMiddleware, dbMiddleware, async (_req, res) => {
  // Auto-recover: if scheduler timer was lost (e.g. startup race), restart it
  if (!_agendadorTimer && pool) _iniciarAgendador();
  if (!_alertasEmailTimer && pool) _iniciarAlertasEmail();
  if (!_invAgendadorTimer && pool) _iniciarInventarioAgendador();
  if (!_reconciliacaoAgendadorTimer && pool) _iniciarReconciliacaoAgendador();
  try {
    await ensureAzureColetaTable();
    const cols = `id,tipo,origem,iniciado_em,concluido_em,status,linhas_inseridas,linhas_atualizadas,linhas_erro,mensagem`;
    const [rAll, rApi, rStg] = await Promise.all([
      pool.query(`SELECT ${cols} FROM azure_coleta_historico ORDER BY iniciado_em DESC LIMIT 1`),
      pool.query(`SELECT ${cols} FROM azure_coleta_historico WHERE tipo='api'     ORDER BY iniciado_em DESC LIMIT 1`),
      pool.query(`SELECT ${cols} FROM azure_coleta_historico WHERE tipo='storage' ORDER BY iniciado_em DESC LIMIT 1`),
    ]);
    res.json({
      em_execucao:     _coletaEmExecucao,
      cancelando:      _coletaCancelada,
      progresso:       _coletaProgresso,
      ultimo:          rAll.rows[0] || null,
      ultimo_api:      rApi.rows[0] || null,
      ultimo_storage:  rStg.rows[0] || null,
      agendador_ativo: !!_agendadorTimer,
      circuit_breaker: { ..._cbCore.resumo(), familias: _cbCore.estado() },
    });
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/azure-coleta/cobertura-meses', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const force = req.query.force === '1';
    const now = Date.now();
    // `_coberturaCache` guarda o split cru (custo_microsoft/custo_marketplace) — SEM imposto,
    // de propósito: esta é a tela de saúde/cobertura de coleta, precisa bater com o valor cru
    // importado da Azure, não com o custo já ajustado pelo imposto configurável.
    const _comResposta = async (linhas) => linhas.map(({ custo_microsoft, custo_marketplace, ...rest }) => ({
      ...rest, total_brl: Number(custo_microsoft || 0) + Number(custo_marketplace || 0),
    }));
    if (!force && _coberturaCache && (now - _coberturaCacheTs) < _COBERTURA_TTL) {
      return res.json(await _comResposta(_coberturaCache));
    }

    // Tenta carregar do banco (sobrevive a restarts — populado pelo _refreshAzureCache)
    if (!force) {
      try {
        const { rows: dbRows } = await pool.query(
          `SELECT mes, subscription_id, subscription_name, registros, dias_com_dados,
                  dias_no_mes, ultima_importacao, custo_microsoft::float AS custo_microsoft, custo_marketplace::float AS custo_marketplace
           FROM azure_cobertura_cache ORDER BY mes DESC, registros DESC`
        );
        if (dbRows.length) {
          _coberturaCache   = dbRows;
          _coberturaCacheTs = now;
          return res.json(await _comResposta(dbRows));
        }
      } catch (_) {}
    }

    // Se o _refreshAzureCache já está rodando, espera ele terminar em vez de
    // lançar uma segunda query pesada concorrente (10M+ linhas competindo).
    if (_cacheRefreshing) {
      const deadline = Date.now() + 6 * 60 * 1000; // até 6 min
      while (_cacheRefreshing && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
      }
      if (_coberturaCache) return res.json(await _comResposta(_coberturaCache));
    }

    // Cache não foi populado pelo refresh — roda query direta com workers paralelos
    const conn = await pool.connect();
    let rows;
    try {
      await conn.query('SET max_parallel_workers_per_gather = 4');
      ({ rows } = await conn.query(`
        SELECT mes, subscription_id, subscription_name,
               SUM(registros_dia)::int                   AS registros,
               COUNT(*)::int                             AS dias_com_dados,
               MAX(dias_no_mes)                          AS dias_no_mes,
               MAX(ultima_importacao)                    AS ultima_importacao,
               ROUND(SUM(custo_microsoft)::numeric, 2)   AS custo_microsoft,
               ROUND(SUM(custo_marketplace)::numeric, 2) AS custo_marketplace
        FROM (
          SELECT
            TO_CHAR(DATE_TRUNC('month', cost_date), 'YYYY-MM-DD')   AS mes,
            cost_date,
            subscription_id,
            COALESCE(MAX(subscription_name), subscription_id)        AS subscription_name,
            COUNT(*)::int                                             AS registros_dia,
            ((DATE_TRUNC('month', cost_date) + INTERVAL '1 month')::date
              - DATE_TRUNC('month', cost_date)::date)                 AS dias_no_mes,
            TO_CHAR(MAX(importado_em), 'DD/MM/YYYY HH24:MI')        AS ultima_importacao,
            SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
            SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS custo_marketplace
          FROM azure_costs
          WHERE cost_date >= NOW() - INTERVAL '36 months'
            AND subscription_id IS NOT NULL AND subscription_id <> ''
          GROUP BY 1, 2, 3
        ) daily
        GROUP BY mes, subscription_id, subscription_name
        ORDER BY 1 DESC, registros DESC
      `));
    } finally {
      conn.release();
    }
    _coberturaCache = rows;
    _coberturaCacheTs = Date.now();
    res.json(await _comResposta(rows));
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/azure-coleta/pendentes', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const { rows } = await pool.query(`
      SELECT p.*, c.nome AS sp_nome
      FROM azure_coleta_pendentes p
      LEFT JOIN azure_coleta_config c ON c.id = p.sp_id
      ORDER BY p.criado_em ASC
    `);
    res.json(rows);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/pendentes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const { sp_id, subscription_id, sub_name, data_inicio, data_fim, descricao } = req.body;
    if (!data_inicio || !data_fim) return res.status(400).json({ error: 'data_inicio e data_fim obrigatórios' });
    await pool.query(
      `INSERT INTO azure_coleta_pendentes (sp_id, subscription_id, sub_name, data_inicio, data_fim, descricao)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sp_id || null, subscription_id || null, sub_name || null, data_inicio, data_fim, descricao || null]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-coleta/pendentes/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    await pool.query(`DELETE FROM azure_coleta_pendentes WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/azure-coleta/historico', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const tipo = req.query.tipo;
    const baseSelect = `SELECT h.id,h.tipo,h.origem,h.iniciado_em,h.concluido_em,h.status,h.linhas_inseridas,h.linhas_atualizadas,h.linhas_erro,h.mensagem,h.detalhes,h.periodo_inicio,h.periodo_fim,h.subscriptions_ids,h.validacao_status,h.validacao_json,c.nome AS sp_nome FROM azure_coleta_historico h LEFT JOIN azure_coleta_config c ON c.id = h.sp_id`;
    const { rows } = tipo === 'storage'
      ? await pool.query(`${baseSelect} WHERE h.tipo = ANY($1::text[]) ORDER BY h.iniciado_em DESC LIMIT 50`, [['storage', 'price_list']])
      : tipo
      ? await pool.query(`${baseSelect} WHERE h.tipo=$1 ORDER BY h.iniciado_em DESC LIMIT 50`, [tipo])
      : await pool.query(`${baseSelect} ORDER BY h.iniciado_em DESC LIMIT 50`);
    res.json(rows);
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-coleta/historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    await pool.query(`TRUNCATE TABLE azure_coleta_historico RESTART IDENTITY`);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/historico/:id/validar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT periodo_inicio, periodo_fim, subscriptions_ids FROM azure_coleta_historico WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Registro não encontrado' });
    const { periodo_inicio, periodo_fim, subscriptions_ids } = rows[0];
    await _validarColeta(id, subscriptions_ids, periodo_inicio, periodo_fim);
    const { rows: updated } = await pool.query(
      `SELECT validacao_status, validacao_json FROM azure_coleta_historico WHERE id=$1`, [id]
    );
    res.json(updated[0] || {});
  } catch (e) { _dbErr(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVENTÁRIO + AUDITORIA DE RECURSOS AZURE (2026-08-30, pedido do usuário)
// ══════════════════════════════════════════════════════════════════════════════
// Mesmo nível de acesso que /api/azure-coleta/sps* e /api/databricks-coleta/config*
// (só authMiddleware+dbMiddleware, sem adminMiddleware) — consistente com o resto da
// família de rotas de Coleta neste arquivo.

app.get('/api/azure-inventario/config', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    let r = await pool.query(`SELECT * FROM azure_inventario_config ORDER BY id LIMIT 1`);
    if (!r.rows.length) r = await pool.query(`INSERT INTO azure_inventario_config DEFAULT VALUES RETURNING *`);
    res.json(r.rows[0]);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-inventario/config', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    // `tags_obrigatorias` (2026-09-04): a coluna existia desde 2026-08-31 e o frontend já enviava
    // o campo, mas ele NUNCA esteve no destructure nem no UPDATE — o servidor descartava em
    // silêncio. Consequência: a coluna ficava sempre NULL, `/tags-faltantes` sempre caía no
    // early-return vazio, e o corpo real daquele endpoint nunca executou em nenhum ambiente.
    // Cadeia morta ponta a ponta, não só "órfão de UI".
    // `retencao_excluidos_*` (2026-09-25): nova retenção opcional de recursos excluídos.
    const { ativo, retencao_dias, sp_id, subscription_ids, tags_obrigatorias, retencao_excluidos_ativa, retencao_excluidos_dias } = req.body;
    await ensureAzureColetaTable();
    let r = await pool.query(`SELECT id FROM azure_inventario_config ORDER BY id LIMIT 1`);
    if (!r.rows.length) r = await pool.query(`INSERT INTO azure_inventario_config DEFAULT VALUES RETURNING id`);
    const id = r.rows[0].id;
    await pool.query(
      `UPDATE azure_inventario_config SET ativo=$1, retencao_dias=$2, sp_id=$3, subscription_ids=$4, tags_obrigatorias=$5, retencao_excluidos_ativa=$7, retencao_excluidos_dias=$8, atualizado_em=NOW() WHERE id=$6`,
      [!!ativo, Number(retencao_dias) > 0 ? Number(retencao_dias) : 180, sp_id || null, subscription_ids || null,
       (tags_obrigatorias || '').trim() || null, id, !!retencao_excluidos_ativa, Number(retencao_excluidos_dias) > 0 ? Number(retencao_excluidos_dias) : 180]
    );
    if (ativo) {
      _iniciarInventarioAgendador();
      _iniciarReconciliacaoAgendador();
    }
    // Invalida o cache do relatório de compliance — sem isso, mudar `tags_obrigatorias` não
    // teria efeito visível por até 15 min (o TTL), e o admin acharia que o save não funcionou.
    // Bug real pego no teste ponta a ponta desta própria rodada.
    _tagsFaltantesCache.clear();
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Prévia (somente leitura) do que a retenção de recursos excluídos apagaria com N dias.
app.get('/api/azure-inventario/retencao-excluidos/previa', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const dias = Number(req.query.dias) > 0 ? Math.floor(Number(req.query.dias)) : 180;
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ativo = false AND excluido_em < NOW() - ($1 || ' days')::interval) AS seriam_removidos,
         COUNT(*) FILTER (WHERE ativo = false) AS total_excluidos,
         COUNT(*) FILTER (WHERE ativo = true) AS total_ativos
       FROM azure_recursos_inventario`,
      [dias]
    );
    const row = r.rows[0];
    res.json({
      dias,
      seriam_removidos: Number(row.seriam_removidos),
      total_excluidos: Number(row.total_excluidos),
      total_ativos: Number(row.total_ativos),
    });
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-inventario/coletar', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_invColetaEmExecucao) return res.status(409).json({ error: 'Coleta de Inventário já em execução' });
  res.json({ ok: true, message: 'Coleta de Inventário iniciada' });
  _coletarInventarioAzure('manual').catch(e => console.error('[Inventario] Erro:', e.message));
});

app.get('/api/azure-inventario/status', authMiddleware, dbMiddleware, async (_req, res) => {
  res.json({ em_execucao: _invColetaEmExecucao, iniciada_em: _invColetaIniciadaEm, progresso: _invColetaProgresso });
});

// Reconciliação via Resource Graph (2026-09-02) — ver _reconciliarInventarioResourceGraph
// pro porquê: o Inventário via Activity Log só aprende sobre um recurso quando há um evento
// depois da ativação da feature, deixando de fora recursos antigos nunca mais tocados (mas
// ainda cobrando). Mesma flag/monitor de progresso da coleta normal (mutuamente exclusivas).
app.post('/api/azure-inventario/reconciliar', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_invColetaEmExecucao) return res.status(409).json({ error: 'Já existe uma coleta ou reconciliação de Inventário em execução' });
  res.json({ ok: true, message: 'Reconciliação via Resource Graph iniciada' });
  _reconciliarInventarioResourceGraph('manual').catch(e => console.error('[Inventario] Erro na reconciliação:', e.message));
});

// Recomendações do Azure Advisor (2026-09-02, inspirado no ARI) — sem `subscription_id`,
// agrega TODAS as subscriptions configuradas pro Inventário; erro numa subscription não
// derruba as outras (`erros` na resposta lista qual falhou e por quê, mesmo padrão de
// resiliência já usado na coleta/reconciliação). `category` opcional filtra client-side
// (Cost/Security/HighAvailability/Performance/OperationalExcellence).
app.get('/api/azure-inventario/advisor', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id, category } = req.query;
    const { getToken, subs } = await _getInventarioSpConfig();
    const token = await getToken();
    const alvo = subscription_id ? [subscription_id] : subs;
    if (!alvo.length) return res.status(400).json({ error: 'Nenhuma subscription configurada' });

    const porSub = await _mapLimit(alvo, 4, async (sub) => {
      try {
        return { subscription_id: sub, recomendacoes: await _getAdvisorCached(token, sub), erro: null };
      } catch (e) {
        return { subscription_id: sub, recomendacoes: [], erro: e.message };
      }
    });

    let itens = [];
    for (const p of porSub) {
      for (const r of p.recomendacoes) {
        itens.push({
          id: r.id,
          subscription_id: p.subscription_id,
          categoria: r.properties?.category || null,
          impacto: r.properties?.impact || null,
          tipo_recurso: r.properties?.impactedField || null,
          recurso: r.properties?.impactedValue || null,
          resource_id: r.properties?.resourceMetadata?.resourceId || null,
          problema: r.properties?.shortDescription?.problem || null,
          solucao: r.properties?.shortDescription?.solution || null,
          beneficio_potencial: r.properties?.potentialBenefits || null,
        });
      }
    }
    if (category) itens = itens.filter((i) => i.categoria === category);

    const porCategoria = {};
    for (const i of itens) porCategoria[i.categoria || 'Outro'] = (porCategoria[i.categoria || 'Outro'] || 0) + 1;

    res.json({
      total: itens.length,
      itens,
      por_categoria: porCategoria,
      erros: porSub.filter((p) => p.erro).map((p) => ({ subscription_id: p.subscription_id, erro: p.erro })),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Topologia de rede (2026-09-02, inspirado no ARI — que gera diagrama draw.io de VNets/
// peerings). Campos confirmados na documentação oficial da REST API de Virtual Network
// (learn.microsoft.com/rest/api/virtualnetwork/virtual-networks/get):
// `properties.addressSpace.addressPrefixes[]`, `properties.subnets[].{name,properties.addressPrefix}`,
// `properties.virtualNetworkPeerings[].properties.{remoteVirtualNetwork.id,peeringState}`.
// Resource Graph devolve o mesmo bag `properties` cru do ARM (é o índice dele), então esses
// caminhos valem igual via Resource Graph. Renderizado como SVG simples no frontend — sem
// lib de diagrama nova, mesmo padrão já usado pros outros gráficos desta sessão.
app.get('/api/azure-inventario/rede-topologia', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { subscription_id } = req.query;
    if (!subscription_id) return res.status(400).json({ error: 'subscription_id é obrigatório' });
    const { getToken } = await _getInventarioSpConfig();
    const token = await getToken();
    const body = {
      subscriptions: [subscription_id],
      query: `Resources | where type =~ 'microsoft.network/virtualnetworks' | project id, name, resourceGroup, properties | limit 1000`,
    };
    const resp = await _cbFetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 30_000 }
    );
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Resource Graph falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);

    const vnets = (data.data || []).map((v) => ({
      id: v.id,
      nome: v.name,
      resource_group: v.resourceGroup,
      address_space: v.properties?.addressSpace?.addressPrefixes || [],
      subnets: (v.properties?.subnets || []).map((s) => ({ nome: s.name, prefixo: s.properties?.addressPrefix || null })),
      peerings: (v.properties?.virtualNetworkPeerings || [])
        .map((p) => ({ vnet_remoto_id: p.properties?.remoteVirtualNetwork?.id || null, estado: p.properties?.peeringState || null }))
        .filter((p) => p.vnet_remoto_id),
    }));
    res.json({ vnets });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/azure-inventario/coleta-historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT * FROM azure_inventario_coleta_historico ORDER BY iniciado_em DESC LIMIT 50`);
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-inventario/coleta-historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    await pool.query(`TRUNCATE TABLE azure_inventario_coleta_historico RESTART IDENTITY`);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Inventário — lista de recursos conhecidos (permanente, nunca afetado pela retenção).
// Custo correlacionado em LEITURA com azure_costs por resource_id (já coletado todo dia,
// nenhuma coleta nova precisa disso).
app.get('/api/azure-inventario/recursos', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const { subscription_id, resource_group, ativo, criado_por, data_inicio, data_fim, excluir_gerenciados } = req.query;
    let where = '1=1';
    const params = [];
    // Vindo do sino: a contagem da anomalia de assinatura já desconta RG gerenciado (Databricks/AKS).
    if (excluir_gerenciados === 'true') {
      params.push(await _getRgsGerenciados());
      where += ` AND UPPER(COALESCE(ri.resource_group,'')) <> ALL($${params.length}::text[])`;
    }
    if (subscription_id) { params.push(subscription_id); where += ` AND ri.subscription_id = $${params.length}`; }
    if (resource_group) { params.push(resource_group); where += ` AND UPPER(ri.resource_group) = UPPER($${params.length})`; }
    if (ativo === 'true') where += ` AND ri.ativo = true`;
    else if (ativo === 'false') where += ` AND ri.ativo = false`;
    if (criado_por) { params.push('%' + criado_por + '%'); where += ` AND ri.criado_por ILIKE $${params.length}`; }
    if (data_inicio) { params.push(data_inicio); where += ` AND ri.criado_em >= $${params.length}`; }
    if (data_fim) { params.push(data_fim); where += ` AND ri.criado_em < $${params.length}::date + INTERVAL '1 day'`; }

    const r = await pool.query(
      `SELECT ri.*,
         COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac WHERE UPPER(ac.resource_id) = UPPER(ri.resource_id) AND ac.publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS custo_acumulado_microsoft,
         COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac WHERE UPPER(ac.resource_id) = UPPER(ri.resource_id) AND ac.publisher_type = 'Marketplace'), 0) AS custo_acumulado_marketplace,
         cac1.nome AS criado_por_nome, cac2.nome AS atualizado_por_nome, cac3.nome AS excluido_por_nome
       FROM azure_recursos_inventario ri
       LEFT JOIN azure_autores_cache cac1 ON cac1.guid = ri.criado_por
       LEFT JOIN azure_autores_cache cac2 ON cac2.guid = ri.atualizado_por
       LEFT JOIN azure_autores_cache cac3 ON cac3.guid = ri.excluido_por
       WHERE ${where}
       ORDER BY ri.criado_em DESC NULLS LAST
       LIMIT 500`,
      params
    );

    // Fallback de custo por Resource Group — mesmo motivo já documentado no endpoint de
    // detalhe (`/recurso-detalhe`): custo direto por resource_id fica zerado pra ~97% dos
    // recursos ativos (confirmado com dados reais), porque VMs/discos/NICs de cluster
    // Databricks são recriados pela Azure em questão de horas e o billing tem ~2-3 dias de
    // atraso pra ser publicado — o resource_id exato quase nunca sobrevive até aparecer no
    // billing. Sem esse fallback TAMBÉM na LISTA (não só no modal de detalhe), a tabela
    // inteira de Recursos parecia "toda zerada", mesmo a maioria dos RGs tendo custo real.
    // Lookup no cache pré-computado (`_getRgStatsCache`) em vez de agregar `azure_costs` a
    // cada request — um RG grande sozinho já levava 17-23s pra somar (ver comentário na
    // declaração do cache), inaceitável mesmo batendo só 1 query por página.
    const rgStats = await _getRgStatsCache();
    const impostoCfgRg = await _getImpostoConfig();
    const recursos = r.rows.map(row => {
      const rg = row.resource_group ? rgStats.get(row.subscription_id + '::' + row.resource_group.toUpperCase()) : null;
      const { custo_acumulado_microsoft, custo_acumulado_marketplace, ...rest } = row;
      return {
        ...rest,
        custo_acumulado: _comImpostoSplit(custo_acumulado_microsoft, custo_acumulado_marketplace, impostoCfgRg),
        custo_resource_group: rg ? _comImpostoSplit(rg.custo_microsoft, rg.custo_marketplace, impostoCfgRg) : 0,
      };
    });

    res.json({ total: recursos.length, recursos });
  } catch (e) { _dbErr(res, e); }
});

// Exportar Inventário pra Excel (2026-09-02, inspirado no Azure Resource Inventory —
// github.com/microsoft/ARI, que gera relatório .xlsx completo) — reaproveita ExcelJS e a
// paleta roxa Vivo já usadas em GET /api/export/excel (Ações), mas com estilo local a esta
// rota (não um refactor do export existente). Sem LIMIT — dump completo (a tabela é pequena,
// ~29 mil linhas no ambiente real, ExcelJS escreve isso em segundos).
app.get('/api/azure-inventario/export/excel', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    await ensureAzureColetaTable();
    const { subscription_id, ativo } = req.query;
    let where = '1=1';
    const params = [];
    if (subscription_id) { params.push(subscription_id); where += ` AND ri.subscription_id = $${params.length}`; }
    if (ativo === 'true') where += ` AND ri.ativo = true`;
    else if (ativo === 'false') where += ` AND ri.ativo = false`;

    const [r, subsRow, rgStats] = await Promise.all([
      pool.query(
        `SELECT ri.*, cac1.nome AS criado_por_nome
         FROM azure_recursos_inventario ri
         LEFT JOIN azure_autores_cache cac1 ON cac1.guid = ri.criado_por
         WHERE ${where}
         ORDER BY ri.subscription_id, ri.resource_group, ri.nome`,
        params
      ),
      pool.query(`SELECT subscription_id, subscription_name FROM azure_subs_cache`),
      _getRgStatsCache(),
    ]);
    const subsMap = new Map(subsRow.rows.map((s) => [s.subscription_id, s.subscription_name]));

    const PURPLE_MAIN = '7B2FBE', PURPLE_LIGHT = 'F3E8FF', NAVY = 'FF1B2A4A', GRAY_BDR = 'FFE0D4F5';
    const BRL_FMT = '"R$ "#,##0.00';
    const hFill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } });
    const hFont = (bold, color, size) => ({ bold: !!bold, color: { argb: color || NAVY }, size: size || 9, name: 'Arial' });
    const hBorder = () => { const s = { style: 'thin', color: { argb: GRAY_BDR } }; return { left: s, right: s, top: s, bottom: s }; };
    const styleCell = (cell, { fill, font, alignment, border, numFmt } = {}) => {
      if (fill) cell.fill = fill;
      if (font) cell.font = font;
      if (alignment) cell.alignment = alignment;
      if (border) cell.border = border;
      if (numFmt) cell.numFmt = numFmt;
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FinOps Manager';
    wb.created = new Date();

    const ws = wb.addWorksheet('Recursos');
    ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 1 }];
    ws.columns = [{ width: 26 }, { width: 38 }, { width: 42 }, { width: 30 }, { width: 8 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 20 }];
    const headers = ['Assinatura', 'Resource Group', 'Nome', 'Tipo', 'Ativo', 'Criado por', 'Criado em', 'Custo Direto (R$)', 'Custo do RG (~aprox., R$)'];
    const headerRow = ws.getRow(1);
    headers.forEach((h, i) => {
      styleCell(headerRow.getCell(i + 1), {
        fill: hFill(PURPLE_MAIN), font: hFont(true, 'FFFFFFFF', 10),
        alignment: { horizontal: 'center', vertical: 'middle' }, border: hBorder(),
      });
      headerRow.getCell(i + 1).value = h;
    });
    headerRow.height = 20;

    const impostoCfgExport = await _getImpostoConfig();
    let rowIdx = 2;
    for (const row of r.rows) {
      const rgKey = row.resource_group ? row.subscription_id + '::' + row.resource_group.toUpperCase() : null;
      const rgVal = rgKey ? rgStats.get(rgKey) : null;
      const custoRg = rgVal ? _comImpostoSplit(rgVal.custo_microsoft, rgVal.custo_marketplace, impostoCfgExport) : 0;
      const excelRow = ws.getRow(rowIdx);
      excelRow.getCell(1).value = subsMap.get(row.subscription_id) || row.subscription_id;
      excelRow.getCell(2).value = row.resource_group || '';
      excelRow.getCell(3).value = row.nome || row.resource_id;
      excelRow.getCell(4).value = row.resource_type || '';
      excelRow.getCell(5).value = row.ativo ? 'Sim' : 'Não';
      excelRow.getCell(6).value = row.criado_por_nome || row.criado_por || 'desconhecido';
      excelRow.getCell(7).value = row.criado_em ? new Date(row.criado_em) : null;
      excelRow.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
      excelRow.getCell(8).value = parseFloat(row.custo_acumulado) || 0;
      excelRow.getCell(8).numFmt = BRL_FMT;
      excelRow.getCell(9).value = custoRg;
      excelRow.getCell(9).numFmt = BRL_FMT;
      const fundo = rowIdx % 2 === 0 ? PURPLE_LIGHT : 'FFFFFF';
      for (let c = 1; c <= 9; c++) styleCell(excelRow.getCell(c), { border: hBorder(), font: hFont(false, NAVY, 9), fill: hFill(fundo) });
      rowIdx++;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventario-azure-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { _dbErr(res, e); }
});

// Distingue VM/VM Scale Set "normal" de VM/VMSS que é nó de cluster Databricks (2026-09-01,
// pedido do usuário: "separar nos Card o que é VM, o que é Scale Set, o que é VM de
// Databricks") — reaproveita `_detectManagedRg` (já usado pra badge/agrupamento de RG
// gerenciado na Calculadora, ver seção RN-DB-001) em vez de duplicar a lógica de padrão de
// nome de RG. Sufixo `::databricks` (nunca aparece num resource_type real do ARM, que só usa
// `/`) marca a variante — o frontend (`resourceTypeLabel`/`resourceTypeIcon`) reconhece esse
// sufixo e rotula/ícone diferente, sem mexer no `resource_type` original armazenado.
const _PA_VM_TYPES = new Set(['MICROSOFT.COMPUTE/VIRTUALMACHINES', 'MICROSOFT.COMPUTE/VIRTUALMACHINESCALESETS']);
function _paTipoDisplay(resourceType, resourceGroup) {
  const base = (resourceType && resourceType.trim()) || '(desconhecido)';
  if (_PA_VM_TYPES.has(base.toUpperCase()) && _detectManagedRg(resourceGroup).managed_type === 'databricks') {
    return base + '::databricks';
  }
  return base;
}

// Hierarquia Assinatura → Resource Group (2026-08-31, pedido do usuário: "algo por
// Assinatura, tipo lista as assinaturas e vou fazendo drill down dos dados até chegar no
// recurso... mostra assinaturas e na frente uns ícones em destaque com o número") — vista
// alternativa à lista plana da aba Recursos. Sem `subscription_id` → nível 1 (uma linha por
// assinatura); com `subscription_id` → nível 2 (uma linha por Resource Group dentro dela).
// Cada nível vem com `por_tipo` (mesmas caixas por Tipo de Recurso já usadas na Auditoria)
// pros badges/ícones em destaque. Baseado só em `azure_recursos_inventario` (permanente —
// ~16 mil linhas ativas no ambiente real, cabe inteiro em memória sem problema) — NUNCA em
// `azure_costs` (~1,45M linhas) — evita de propósito o mesmo risco de performance já
// encontrado/corrigido antes nesta sessão pra tabelas grandes. Agregação em JS (não SQL
// GROUP BY) — mais simples de aplicar `_paTipoDisplay` (função JS) e evita de vez os bugs de
// casing já encontrados nas versões anteriores desta rota (MAX() escolhendo grafias
// diferentes por subgrupo). O 3º nível (recursos dentro do RG) reaproveita
// `GET /recursos?subscription_id=&resource_group=` direto — não precisa de rota nova.
app.get('/api/azure-inventario/resumo-por-assinatura', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const { subscription_id } = req.query;

    if (!subscription_id) {
      const r = await pool.query(`SELECT subscription_id, resource_group, resource_type FROM azure_recursos_inventario WHERE ativo = true`);
      const bySub = new Map();
      for (const row of r.rows) {
        if (!bySub.has(row.subscription_id)) bySub.set(row.subscription_id, { subscription_id: row.subscription_id, total: 0, tipos: new Map() });
        const e = bySub.get(row.subscription_id);
        e.total += 1;
        const tipo = _paTipoDisplay(row.resource_type, row.resource_group);
        const tKey = tipo.toUpperCase();
        e.tipos.set(tKey, { tipo, total: (e.tipos.get(tKey)?.total || 0) + 1 });
      }
      const itens = [...bySub.values()]
        .map((a) => ({ subscription_id: a.subscription_id, total: a.total, por_tipo: [...a.tipos.values()].sort((x, y) => y.total - x.total) }))
        .sort((a, b) => b.total - a.total);
      return res.json({ nivel: 'assinatura', itens });
    }

    const r = await pool.query(`SELECT resource_group, resource_type FROM azure_recursos_inventario WHERE ativo = true AND subscription_id = $1`, [subscription_id]);
    const byRg = new Map();
    for (const row of r.rows) {
      const rg = (row.resource_group && row.resource_group.trim()) || '(sem Resource Group)';
      const rgKey = rg.toUpperCase();
      if (!byRg.has(rgKey)) byRg.set(rgKey, { resource_group: rg, total: 0, tipos: new Map() });
      const e = byRg.get(rgKey);
      e.total += 1;
      const tipo = _paTipoDisplay(row.resource_type, row.resource_group);
      const tKey = tipo.toUpperCase();
      e.tipos.set(tKey, { tipo, total: (e.tipos.get(tKey)?.total || 0) + 1 });
    }
    const itens = [...byRg.values()]
      .map((g) => ({ resource_group: g.resource_group, total: g.total, por_tipo: [...g.tipos.values()].sort((x, y) => y.total - x.total) }))
      .sort((a, b) => b.total - a.total);
    res.json({ nivel: 'resource_group', itens });
  } catch (e) { _dbErr(res, e); }
});

// Crescimento líquido (2026-09-02, pedido do usuário: "a ideia é ver crescimento de recurso
// novos, que cresça e não morra") — diferente do gráfico "Crescimento de Recursos" removido
// antes nesta sessão (baseado em `azure_costs`, contava QUALQUER resource_id cobrado no dia,
// dominado pelo churn de VMs/discos/NICs efêmeros de cluster), este conta, dia a dia, quantos
// recursos de `azure_recursos_inventario` estavam ativos NAQUELE dia — EXCLUINDO Resource
// Groups gerenciados por Databricks/AKS (mesma detecção `_detectManagedRg` já usada pra
// separar VM de "VM (Databricks)" nos badges de "Por Assinatura"). Sem esse filtro, o
// crescimento de recursos "de verdade" (que nascem e permanecem) fica invisível atrás do
// vaivém de nós de cluster que vivem só algumas horas.
app.get('/api/azure-inventario/crescimento-liquido', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    let { data_inicio, data_fim } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }

    // Classificação de RG gerenciado (_getRgsGerenciados — cacheada, ver definição perto de
    // _detectManagedRg) — evita refazer a mesma query+classificação a cada chamada.
    const rgsGerenciados = await _getRgsGerenciados();

    // CROSS JOIN dias × recursos é barato aqui — azure_recursos_inventario é a tabela
    // PERMANENTE do Inventário (só alguns milhares de linhas), nunca a azure_costs (~1,45M).
    // "Ativo no dia D" = criado até D (ou criado_em desconhecido — recurso que já existia
    // antes da 1ª coleta, mesma convenção já usada no Comparativo) E ainda não excluído (ou
    // excluído depois de D).
    const r = await pool.query(
      `WITH dias AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS dia)
       SELECT d.dia,
         COUNT(*) FILTER (
           WHERE (ri.criado_em IS NULL OR ri.criado_em::date <= d.dia)
             AND (ri.excluido_em IS NULL OR ri.excluido_em::date > d.dia)
         ) AS ativos
       FROM dias d
       CROSS JOIN azure_recursos_inventario ri
       WHERE NOT (UPPER(COALESCE(ri.resource_group,'')) = ANY($3::text[]))
       GROUP BY d.dia ORDER BY d.dia`,
      [data_inicio, data_fim, rgsGerenciados]
    );
    res.json({
      periodo: { inicio: data_inicio, fim: data_fim },
      dias: r.rows.map((row) => ({ dia: row.dia.toISOString().slice(0, 10), ativos: parseInt(row.ativos, 10) })),
    });
  } catch (e) { _dbErr(res, e); }
});

// Detalhe do Crescimento Líquido (2026-09-04, pedido do usuário: "controlar e acompanhar no
// detalhe o crescimento de recursos fixos... pra rastrear e agir mais rápido") — quebra o
// total do gráfico acima por Tipo de Recurso e por Resource Group (snapshot "ativo no dia" no
// início vs. fim do período — mesma convenção já usada em /crescimento-liquido e no
// Comparativo, nunca uma soma de eventos), mais um ranking "Top Criadores" — prática de
// accountability do capability Governance/Anomaly Management do FinOps Framework: metadados
// de posse (quem criou) são o que torna possível rotear e agir sobre um desvio, não só
// visualizá-lo. Mesma exclusão de RGs gerenciados por Databricks/AKS de sempre — um recurso
// efêmero de cluster não é "crescimento fixo".
async function _computeCrescimentoDetalheRaw(data_inicio, data_fim) {
  const rgsGerenciados = await _getRgsGerenciados();

  async function snapshot(dia) {
    const r = await pool.query(
      `SELECT resource_type, resource_group FROM azure_recursos_inventario ri
       WHERE (ri.criado_em IS NULL OR ri.criado_em::date <= $1) AND (ri.excluido_em IS NULL OR ri.excluido_em::date > $1)
         AND NOT (UPPER(COALESCE(ri.resource_group,'')) = ANY($2::text[]))`,
      [dia, rgsGerenciados]
    );
    return r.rows;
  }
  // rCriadores é totalmente independente dos 2 snapshots (WHERE diferente, não depende do
  // resultado deles) — junto no mesmo Promise.all em vez de um await sequencial à parte
  // (achado do code review: 2026-09-04).
  const [inicioRows, fimRows, rCriadores] = await Promise.all([
    snapshot(data_inicio),
    snapshot(data_fim),
    // Top Criadores — quem mais criou recursos que AINDA estão ativos no fim do período
    // (accountability sobre crescimento líquido real, não churn bruto — um recurso criado e
    // já excluído de novo não conta aqui, mesma filosofia "só o que nasce e permanece" do
    // gráfico principal).
    pool.query(
      `SELECT COALESCE(ac.nome, ri.criado_por, '(desconhecido)') AS criador, COUNT(*)::int AS total
       FROM azure_recursos_inventario ri
       LEFT JOIN azure_autores_cache ac ON ac.guid = ri.criado_por
       WHERE ri.ativo = true AND ri.criado_em >= $1 AND ri.criado_em < $2::date + INTERVAL '1 day'
         AND NOT (UPPER(COALESCE(ri.resource_group,'')) = ANY($3::text[]))
       GROUP BY 1 ORDER BY total DESC LIMIT 10`,
      [data_inicio, data_fim, rgsGerenciados]
    ),
  ]);

  function contarPor(rows, keyFn) {
    const m = new Map();
    for (const row of rows) { const k = keyFn(row); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }
  function delta(mapA, mapB) {
    const chaves = new Set([...mapA.keys(), ...mapB.keys()]);
    const out = [];
    for (const k of chaves) {
      const a = mapA.get(k) || 0, b = mapB.get(k) || 0;
      if (a === b) continue;
      out.push({ chave: k, inicio: a, fim: b, delta: b - a });
    }
    out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return out;
  }

  const porTipo = delta(
    contarPor(inicioRows, (r) => _paTipoDisplay(r.resource_type, r.resource_group)),
    contarPor(fimRows, (r) => _paTipoDisplay(r.resource_type, r.resource_group))
  ).slice(0, 12).map((x) => ({ tipo: x.chave, inicio: x.inicio, fim: x.fim, delta: x.delta }));

  const porRg = delta(
    contarPor(inicioRows, (r) => r.resource_group || '(sem Resource Group)'),
    contarPor(fimRows, (r) => r.resource_group || '(sem Resource Group)')
  ).slice(0, 12).map((x) => ({ resource_group: x.chave, inicio: x.inicio, fim: x.fim, delta: x.delta }));

  return {
    periodo: { inicio: data_inicio, fim: data_fim },
    por_tipo: porTipo,
    por_resource_group: porRg,
    top_criadores: rCriadores.rows.map((r) => ({ criador: r.criador, total: r.total })),
  };
}

// Cache (2026-09-04, achado do code review) — este endpoint agora roda sempre, em todo mount
// da tela Inventário (mesmo nível do gráfico de Crescimento Líquido, nunca dentro de uma aba
// condicional) — sem proteção nenhuma, 2+ requests concorrentes (ex: vários usuários abrindo a
// tela ao mesmo tempo) disparariam o mesmo cálculo em paralelo. A tabela em si é pequena
// (azure_recursos_inventario, ~29 mil linhas — não o azure_costs de 3,7M que causou o bug de
// 175s em Anomalias), então o objetivo aqui é só dedup de concorrência, não economizar uma
// query pesada — TTL curto (5min) é suficiente. Chave por período (não um conjunto pequeno e
// fixo tipo subscription_id) — cap simples de tamanho evita crescimento sem limite se usuários
// navegarem por muitos períodos diferentes ao longo do uptime do processo.
const _CRESCIMENTO_DETALHE_TTL = 5 * 60 * 1000;
const _CRESCIMENTO_DETALHE_CACHE_MAX = 50;
const _crescimentoDetalheCache = new Map(); // `${inicio}:${fim}` -> { dados, ts }
const _crescimentoDetalhePromises = new Map();
async function _getCrescimentoDetalheCached(dataInicio, dataFim) {
  const chave = `${dataInicio}:${dataFim}`;
  const cached = _crescimentoDetalheCache.get(chave);
  if (cached && (Date.now() - cached.ts) < _CRESCIMENTO_DETALHE_TTL) return cached.dados;
  if (_crescimentoDetalhePromises.has(chave)) return _crescimentoDetalhePromises.get(chave);
  const p = (async () => {
    try {
      const dados = await _computeCrescimentoDetalheRaw(dataInicio, dataFim);
      if (_crescimentoDetalheCache.size >= _CRESCIMENTO_DETALHE_CACHE_MAX) _crescimentoDetalheCache.clear();
      _crescimentoDetalheCache.set(chave, { dados, ts: Date.now() });
      return dados;
    } finally {
      _crescimentoDetalhePromises.delete(chave);
    }
  })();
  _crescimentoDetalhePromises.set(chave, p);
  return p;
}

app.get('/api/azure-inventario/crescimento-detalhe', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    let { data_inicio, data_fim } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    res.json(await _getCrescimentoDetalheCached(data_inicio, data_fim));
  } catch (e) { _dbErr(res, e); }
});

// Auditoria — log bruto de eventos (sujeito à retenção configurável).
app.get('/api/azure-inventario/auditoria', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    let { data_inicio, data_fim, resource_id, acao, subscription_id, resource_type } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `e.quando >= $1 AND e.quando < $2::date + INTERVAL '1 day'`;
    const params = [data_inicio, data_fim];
    if (resource_id) { params.push(resource_id); where += ` AND LOWER(e.resource_id) = LOWER($${params.length})`; }
    if (acao) { params.push(acao); where += ` AND e.acao = $${params.length}`; }
    if (subscription_id) { params.push(subscription_id); where += ` AND e.subscription_id = $${params.length}`; }

    // Caixas por Tipo de Recurso (2026-08-31, pedido do usuário) — agregada sobre TODO o
    // período/filtros já aplicados (`where`), nunca só os 300 eventos retornados abaixo pro
    // LIMIT da tabela; funciona como chip-bar (mostra sempre todos os tipos do escopo atual,
    // independente de `resource_type` estar selecionado ou não — mesmo padrão já usado pela
    // chip-bar de tipos da Calculadora). Agrupado por UPPER() — confirmado com dados reais que
    // o Activity Log devolve o MESMO resource_type com casing divergente entre eventos (ex:
    // "Microsoft.Insights/metricAlerts" vs "microsoft.insights/metricAlerts") — sem isso, o
    // mesmo tipo apareceria em duas caixas separadas.
    const rTipo = await pool.query(
      `SELECT MAX(base) AS tipo, COUNT(*)::int AS total
       FROM (
         SELECT COALESCE(NULLIF(TRIM(e.resource_type), ''), '(desconhecido)') AS base
         FROM azure_recursos_auditoria_eventos e WHERE ${where}
       ) s
       GROUP BY UPPER(base) ORDER BY total DESC`,
      params
    );

    let whereEventos = where;
    const paramsEventos = [...params];
    if (resource_type) {
      paramsEventos.push(resource_type);
      whereEventos += ` AND UPPER(COALESCE(NULLIF(TRIM(e.resource_type), ''), '(desconhecido)')) = UPPER($${paramsEventos.length})`;
    }

    // LEFT JOIN pro nome amigável do recurso (`ri.nome` — mesma string que a aba Recursos já
    // mostra) — exact match é seguro aqui (não o mesmo risco de casing do JOIN com azure_costs):
    // as duas tabelas são gravadas na MESMA iteração de _coletarInventarioAzure, a partir da
    // MESMA variável `resourceId` (Activity Log), nunca de fontes divergentes.
    const r = await pool.query(
      `SELECT e.*, ri.nome, cac.nome AS autor_nome
       FROM azure_recursos_auditoria_eventos e
       LEFT JOIN azure_recursos_inventario ri ON ri.subscription_id = e.subscription_id AND LOWER(ri.resource_id) = LOWER(e.resource_id)
       LEFT JOIN azure_autores_cache cac ON cac.guid = e.autor
       WHERE ${whereEventos} ORDER BY e.quando DESC LIMIT 300`,
      paramsEventos
    );
    res.json({
      periodo: { inicio: data_inicio, fim: data_fim },
      total: r.rows.length,
      eventos: r.rows,
      por_tipo: rTipo.rows.map((x) => ({ tipo: x.tipo, total: x.total })),
    });
  } catch (e) { _dbErr(res, e); }
});

// Alterações de Propriedade (2026-09-02, SKU de VM; expandido 2026-09-03 pra tags/disco/storage/
// IP público — ver `_extrairMudancasRastreadas`) — histórico gravado direto por
// `_coletarInventarioAzure` a partir do antes/depois que a Change Analysis já entrega no próprio
// evento. `resource_id` opcional filtra pra um recurso específico (usado por
// `RecursoDetalheModal.tsx`); sem ele, lista tudo no período (mesmo padrão `periodo`/300 linhas
// já usado por `/auditoria`).
app.get('/api/azure-inventario/mudancas-propriedade', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    let { data_inicio, data_fim, resource_id, subscription_id } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `h.detectado_em >= $1 AND h.detectado_em < $2::date + INTERVAL '1 day'`;
    const params = [data_inicio, data_fim];
    if (resource_id) { params.push(resource_id); where += ` AND LOWER(h.resource_id) = LOWER($${params.length})`; }
    if (subscription_id) { params.push(subscription_id); where += ` AND h.subscription_id = $${params.length}`; }
    const r = await pool.query(
      `SELECT h.*, ri.nome, cac.nome AS evento_autor_nome
       FROM azure_recursos_mudancas_propriedade h
       LEFT JOIN azure_recursos_inventario ri ON ri.subscription_id = h.subscription_id AND LOWER(ri.resource_id) = LOWER(h.resource_id)
       LEFT JOIN azure_autores_cache cac ON cac.guid = h.evento_autor
       WHERE ${where} ORDER BY h.detectado_em DESC LIMIT 300`,
      params
    );
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, total: r.rows.length, mudancas: r.rows });
  } catch (e) { _dbErr(res, e); }
});

// Comparativo dia-a-dia pra painel (2026-09-02, pedido do usuário: "mostra isso só por e-mail
// ou em algum painel também?") — mesmo cálculo do relatório diário por e-mail
// (`_computeRelatorioDiarioInventario`), exposto sob demanda (sempre disponível, não depende
// de SMTP configurado nem do tick horário já ter rodado — card na aba Auditoria da UI).
app.get('/api/azure-inventario/relatorio-diario', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    res.json(await _computeRelatorioDiarioInventario());
  } catch (e) { _dbErr(res, e); }
});

// Crescimento — contagem diária de resource_id distintos, ZERO coleta nova (já vem de
// azure_costs, coletado todo dia pela Coleta Azure existente). Serve pro gráfico "ontem
// tinha X, hoje tenho X+1" independente do Activity Log estar configurado ou não — a
// contagem funciona com o que já existe; só "quem criou" depende do Inventário/Auditoria.
app.get('/api/azure-inventario/crescimento', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, subscription_id } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `cost_date >= $1 AND cost_date <= $2 AND resource_id IS NOT NULL AND resource_id <> ''`;
    const params = [data_inicio, data_fim];
    if (subscription_id) { params.push(subscription_id); where += ` AND subscription_id = $${params.length}`; }

    const r = await pool.query(
      `SELECT cost_date, COUNT(DISTINCT resource_id) AS recursos FROM azure_costs WHERE ${where} GROUP BY cost_date ORDER BY cost_date`,
      params
    );
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, dias: r.rows });
  } catch (e) { _dbErr(res, e); }
});

// Comparativo entre dois períodos (2026-08-30, pedido do usuário) — pra cada período,
// calcula um SNAPSHOT de quantos recursos estavam ativos no FIM daquele período (não uma
// soma de eventos), mais quantos eventos de cada tipo aconteceram DENTRO do período e o
// custo total. `criado_em IS NULL` (recurso detectado por um evento de atualização/exclusão
// antes de qualquer criação conhecida — comum pra recursos que já existiam antes da
// primeira coleta) é tratado como "sempre existiu" pro snapshot, nunca excluído por falta
// de data de criação conhecida.
app.get('/api/azure-inventario/comparativo', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { a_inicio, a_fim, b_inicio, b_fim, subscription_id } = req.query;
    if (![a_inicio, a_fim, b_inicio, b_fim].every((d) => _DATE_RE.test(d || ''))) {
      return res.status(400).json({ error: 'a_inicio, a_fim, b_inicio e b_fim são obrigatórios (formato YYYY-MM-DD)' });
    }

    async function _snapshotPeriodo(inicio, fim) {
      const subCond = subscription_id ? ` AND subscription_id = $3` : '';
      const paramsSnap = subscription_id ? [fim, fim, subscription_id] : [fim, fim];
      const snap = await pool.query(
        `SELECT COUNT(*) AS total FROM azure_recursos_inventario
         WHERE (criado_em IS NULL OR criado_em <= $1) AND (excluido_em IS NULL OR excluido_em > $2)${subCond}`,
        paramsSnap
      );
      const evCond = subscription_id ? ` AND subscription_id = $3` : '';
      const evParams = subscription_id ? [inicio, fim, subscription_id] : [inicio, fim];
      const ev = await pool.query(
        `SELECT acao, COUNT(*) AS total FROM azure_recursos_auditoria_eventos
         WHERE quando >= $1 AND quando < $2::date + INTERVAL '1 day'${evCond}
         GROUP BY acao`,
        evParams
      );
      const eventos = { CRIACAO: 0, ATUALIZACAO: 0, EXCLUSAO: 0 };
      for (const row of ev.rows) eventos[row.acao] = parseInt(row.total, 10);

      const custoCond = subscription_id ? ` AND subscription_id = $3` : '';
      const custoParams = subscription_id ? [inicio, fim, subscription_id] : [inicio, fim];
      const custo = await pool.query(
        `SELECT COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS microsoft,
                COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'), 0)                AS marketplace
         FROM azure_costs WHERE cost_date >= $1 AND cost_date <= $2${custoCond}`,
        custoParams
      );

      return {
        inicio, fim,
        total_recursos: parseInt(snap.rows[0].total, 10),
        custo_total: _comImpostoSplit(custo.rows[0].microsoft, custo.rows[0].marketplace, await _getImpostoConfig()),
        criados: eventos.CRIACAO, atualizados: eventos.ATUALIZACAO, excluidos: eventos.EXCLUSAO,
      };
    }

    const [periodoA, periodoB] = await Promise.all([
      _snapshotPeriodo(a_inicio, a_fim),
      _snapshotPeriodo(b_inicio, b_fim),
    ]);
    res.json({ periodo_a: periodoA, periodo_b: periodoB });
  } catch (e) { _dbErr(res, e); }
});

// Detalhe de um recurso — timeline completa de eventos (2026-08-30, pedido do usuário:
// "abrir detalhes do recurso que sofreu alteração"). resource_id vem por query param (não
// path param) porque um resource ID completo do ARM contém `/`, o que quebraria o
// roteamento do Express se fosse um segmento de path.
// Propriedades REAIS do recurso via Resource Graph (2026-09-02, inspirado no ARI) — chamada
// AO VIVO na Azure (não armazenado, sempre a versão mais recente), diferente do
// `billing_detalhe` do endpoint abaixo (que aproxima SKU/tipo a partir do billing quando não
// há dado melhor). Aqui, quando o recurso ainda existe na Azure, vem o SKU exato e o bag
// `properties` completo (varia por tipo — VM traz vmSize/osProfile, disco traz diskSizeGB,
// etc.) — mostrado como JSON formatado no frontend por causa dessa variedade, sem tentar
// mapear campo por campo pra cada um dos milhares de tipos de recurso possíveis no Azure.
// 404 é o caso normal pra recursos efêmeros já excluídos (a maioria, ver "custo direto
// zerado" documentado acima) — não é erro, o frontend trata como "não disponível".
app.get('/api/azure-inventario/recurso-arm-detalhe', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { resource_id, subscription_id } = req.query;
    if (!resource_id || !subscription_id) return res.status(400).json({ error: 'resource_id e subscription_id são obrigatórios' });
    const { getToken } = await _getInventarioSpConfig();
    const token = await getToken();
    const recurso = await _resourceGraphFetchRecursoPorId(token, subscription_id, resource_id);
    if (!recurso) return res.status(404).json({ error: 'Recurso não encontrado no Resource Graph (pode ter sido excluído)' });
    res.json(recurso);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/azure-inventario/recurso-detalhe', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { resource_id, subscription_id } = req.query;
    if (!resource_id || !subscription_id) return res.status(400).json({ error: 'resource_id e subscription_id são obrigatórios' });

    const recursoR = await pool.query(
      `SELECT ri.*,
         COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac WHERE UPPER(ac.resource_id) = UPPER(ri.resource_id) AND ac.publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS custo_acumulado_microsoft,
         COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac WHERE UPPER(ac.resource_id) = UPPER(ri.resource_id) AND ac.publisher_type = 'Marketplace'), 0) AS custo_acumulado_marketplace,
         cac1.nome AS criado_por_nome, cac2.nome AS atualizado_por_nome, cac3.nome AS excluido_por_nome
       FROM azure_recursos_inventario ri
       LEFT JOIN azure_autores_cache cac1 ON cac1.guid = ri.criado_por
       LEFT JOIN azure_autores_cache cac2 ON cac2.guid = ri.atualizado_por
       LEFT JOIN azure_autores_cache cac3 ON cac3.guid = ri.excluido_por
       WHERE ri.subscription_id=$1 AND LOWER(ri.resource_id)=LOWER($2)`,
      [subscription_id, resource_id]
    );
    if (!recursoR.rows.length) return res.status(404).json({ error: 'Recurso não encontrado no inventário' });
    const impostoCfgDet = await _getImpostoConfig();
    const { custo_acumulado_microsoft, custo_acumulado_marketplace, ...recurso } = recursoR.rows[0];
    recurso.custo_acumulado = _comImpostoSplit(custo_acumulado_microsoft, custo_acumulado_marketplace, impostoCfgDet);

    // Custo do Resource Group inteiro — além do custo DIRETO do resource_id (que fica
    // sistematicamente zerado pra VMs/discos/NICs efêmeros de cluster Databricks, já que a
    // Azure recria essas instâncias em questão de horas: o resource_id exato pouco raramente
    // sobrevive tempo suficiente pra aparecer no billing, que tem ~2-3 dias de atraso pra ser
    // publicado). O RG agrega TODO o ambiente (todas as VMs/discos que já passaram por ali),
    // então é o número que reflete custo real, mesmo quando o recurso individual nunca teve
    // billing próprio. Pedido do usuário — "custo direto por recurso é zero e é muito
    // complexo tentar capturar isso do jeito que já temos os consumos". Sempre calculado
    // (não só pra RGs Databricks) — dá contexto útil pra qualquer recurso.
    const [eventosR, custoR, custoRGR] = await Promise.all([
      pool.query(
        `SELECT e.*, cac.nome AS autor_nome FROM azure_recursos_auditoria_eventos e
         LEFT JOIN azure_autores_cache cac ON cac.guid = e.autor
         WHERE e.subscription_id=$1 AND LOWER(e.resource_id)=LOWER($2) ORDER BY e.quando ASC LIMIT 200`,
        [subscription_id, resource_id]
      ),
      pool.query(
        `SELECT cost_date,
                SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace') AS microsoft,
                SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace')                AS marketplace
         FROM azure_costs
         WHERE UPPER(resource_id)=UPPER($1) AND cost_date >= CURRENT_DATE - INTERVAL '90 days'
         GROUP BY cost_date ORDER BY cost_date`,
        [resource_id]
      ),
      // Lookup no cache pré-computado (`_getRgStatsCache`, ver declaração acima) em vez de
      // agregar `azure_costs` a cada request — a query direta (`SUM`+`COUNT(DISTINCT)` pra
      // UM RG) já chegou a levar 17-23s pra RGs grandes de alta rotatividade (Databricks).
      recurso.resource_group
        ? _getRgStatsCache().then((map) => ({
            rows: [map.get(subscription_id + '::' + recurso.resource_group.toUpperCase()) || { custo_microsoft: 0, custo_marketplace: 0, recursos: 0 }],
          }))
        : Promise.resolve({ rows: [{ custo_microsoft: 0, custo_marketplace: 0, recursos: 0 }] }),
    ]);

    // SKU/tipo (2026-08-31, pedido do usuário: "é possível colar o SKU da Máquina, tipo de
    // Disco e Etc") — Azure Cost Management já traz isso por linha de billing, sem precisar
    // de nenhuma chamada nova à ARM: `meter_sub_category` já dá o tipo (ex: "Premium SSD
    // Managed Disks" pra disco, "Virtual Machines Ddsv5 Series" pra VM), e `additional_info`
    // (JSON) traz `ServiceType` — confirmado com dados reais desta sessão que, pra VM, é
    // exatamente a SKU no formato do Azure (`"Standard_D4ds_v5"`); usado como valor
    // principal quando presente, com `meter_name` de fallback (parse defensivo — formato de
    // `additional_info` não é documentado oficialmente, varia por meter).
    // Mesma limitação estrutural já documentada pro custo: o resource_id exato de VMs/discos
    // efêmeros de cluster (Databricks/AKS) raramente sobrevive até o billing (~2-3 dias de
    // atraso) — confirmado testando contra o inventário real: de 40 recursos não-Databricks
    // amostrados, só 4 tinham QUALQUER linha de billing pelo resource_id exato. Por isso,
    // sem billing direto, cai num fallback: SKU de outro recurso do MESMO tipo no MESMO
    // Resource Group (clusters tendem a ter nós homogêneos) — melhor que nada, mas marcado
    // como `origem:'rg_mesmo_tipo'` pro frontend deixar claro que é uma aproximação.
    // Bug real de performance encontrado testando contra dados reais desta sessão, corrigido
    // ANTES de reportar a feature como pronta: a 1ª versão usava `resource_type=$3` no
    // fallback (filtrando pelo tipo ARM vindo do inventário) + `ORDER BY cost_date DESC` —
    // travou 2-4 MINUTOS num RG real de 64 mil linhas. Duas causas, as duas corrigidas:
    // (1) `azure_costs.resource_type` está SEMPRE NULL neste ambiente (a exportação de
    // billing usada aqui nunca populou essa coluna) — o filtro nunca batia com nada, e o
    // planner ainda tinha que visitar (e filtrar) todas as ~22 mil linhas do RG pra chegar
    // nessa conclusão; trocado por `resource_id ILIKE '%/' || tipo || '/%'` — o path do
    // resource_id SEMPRE carrega o tipo ARM (`/providers/Microsoft.Compute/disks/...`),
    // então filtra corretamente sem depender de uma coluna que não existe nesta exportação.
    // (2) `ORDER BY cost_date DESC` força um Sort sobre TODO o conjunto filtrado antes do
    // `LIMIT 1` poder cortar — sem o ORDER BY, o planner para no primeiro match (confirmado
    // via EXPLAIN ANALYZE: de ~1s com Bitmap Heap Scan + Sort pra ~0,2ms com Index Scan
    // parando cedo). "Qualquer" linha recente é suficiente pra esta feature (é uma
    // aproximação, não uma auditoria de billing exata), então perder a garantia de "a mais
    // recente" é um trade-off aceitável pela mudança de minutos pra milissegundos.
    let _bdRow = null, _bdOrigem = null;
    const _bdDireto = await pool.query(
      `SELECT meter_category, meter_sub_category, meter_name, product_name, additional_info
       FROM azure_costs WHERE UPPER(resource_id) = UPPER($1) AND additional_info IS NOT NULL AND additional_info <> ''
       LIMIT 1`,
      [resource_id]
    );
    if (_bdDireto.rows.length) {
      _bdRow = _bdDireto.rows[0]; _bdOrigem = 'direto';
    } else if (recurso.resource_group && recurso.resource_type) {
      const _bdRg = await pool.query(
        `SELECT meter_category, meter_sub_category, meter_name, product_name, additional_info
         FROM azure_costs
         WHERE subscription_id=$1 AND UPPER(resource_group_name)=UPPER($2)
           AND resource_id ILIKE '%/' || $3 || '/%'
           AND additional_info IS NOT NULL AND additional_info <> ''
         LIMIT 1`,
        [subscription_id, recurso.resource_group, recurso.resource_type]
      );
      if (_bdRg.rows.length) { _bdRow = _bdRg.rows[0]; _bdOrigem = 'rg_mesmo_tipo'; }
    }
    let billing_detalhe = null;
    if (_bdRow) {
      let sku = null, vcpus = null;
      try {
        const info = JSON.parse(_bdRow.additional_info);
        sku = info.ServiceType || null;
        vcpus = typeof info.VCPUs === 'number' ? info.VCPUs : null;
      } catch {}
      billing_detalhe = {
        meter_category: _bdRow.meter_category, meter_sub_category: _bdRow.meter_sub_category,
        meter_name: _bdRow.meter_name, product_name: _bdRow.product_name,
        sku, vcpus, origem: _bdOrigem,
      };
    }

    res.json({
      recurso,
      eventos: eventosR.rows,
      custo_diario: custoR.rows.map(r => ({ cost_date: r.cost_date, custo: _comImpostoSplit(r.microsoft, r.marketplace, impostoCfgDet) })),
      custo_resource_group: _comImpostoSplit(custoRGR.rows[0].custo_microsoft, custoRGR.rows[0].custo_marketplace, impostoCfgDet),
      resource_group_recursos: parseInt(custoRGR.rows[0].recursos, 10) || 0,
      billing_detalhe,
    });
  } catch (e) { _dbErr(res, e); }
});

// ── Inventário — Governança de crescimento (2026-08-31, pedido do usuário: "quais
// melhorias vc me sugere para poder ter o controle de crescimento de recursos") ─────────
// Três peças, cada uma reaproveitando infraestrutura já existente (dedup de e-mail,
// motor de Z-score do Databricks como referência, tabela de auditoria já coletada):
// (1) anomalia de crescimento por RG/subscription, (2) orçamento/teto de recursos ou
// custo por escopo, (3) checagem de tags obrigatórias via azure_costs.tags (já coletado).

const _ANOM_CRESCIMENTO_ZSCORE = 2.5;       // mesmo threshold já validado pro Databricks
const _ANOM_CRESCIMENTO_MIN_CRIACOES = 3;   // piso — evita ruído de RG que foi de 0→1 recurso/dia
const _ANOM_CRESCIMENTO_MIN_CUSTO = 50;     // piso em R$ — mesmo raciocínio de _ANOM_USER_MIN_CUSTO (Databricks)

// Anomalia de crescimento — mesma técnica de Z-score já usada pro custo diário Databricks
// (_computeAnomaliasDatabricks), aplicada à contagem de CRIAÇÕES por dia (não custo). Global
// (toda a subscription) e por Resource Group — um RG pequeno "some" dentro da média da
// subscription inteira, por isso os dois níveis. Janela de 35 dias, in-sample (mesma
// simplificação já documentada/aceita pro Databricks — um outlier isolado não domina a
// média o suficiente pra mascarar a si mesmo). `HAVING COUNT(*) >= 5` na base de stats —
// só considera RG/subscription com pelo menos 5 dias de atividade de criação na janela,
// senão a média/desvio de uma amostra minúscula não é confiável.
// Combina DOIS sinais — quantidade de recursos criados E custo (R$) — no mesmo dia/escopo
// (2026-08-31, pedido do usuário: "anomalias de Crescimento com base a mudança e Dinheiro").
// Antes só contava CRIACAO por dia; agora cada linha carrega os dois Z-scores (criações e
// custo), e um dia entra na lista se QUALQUER um dos dois estourar o threshold — um RG pode
// crescer em volume sem custo relevante (recursos free-tier/pequenos) ou o oposto (poucos
// recursos novos mas caros), então nenhum dos dois sinais sozinho conta a história inteira.
// `custo` vem de azure_costs (mesma fonte já usada em todo o resto do Inventário/
// Comparativo) — como os dois lados (auditoria de eventos e billing) não têm garantia de
// cobrir exatamente os mesmos dias (billing tem ~2-3 dias de atraso, documentado acima em
// "Custo direto quase sempre zerado..."), a união das CHAVES (dia+escopo) de ambas as fontes
// via UNION é o que garante que um dia com só criação (sem billing ainda) ou só custo (sem
// criação nova, ex: recurso existente cresceu de tamanho) apareça na base, com o lado
// ausente virando 0 — não NULL, pra não quebrar a média/desvio.
// Exclusão de RGs gerenciados por Databricks/AKS (2026-09-04, achado real ao reintroduzir
// esta feature na UI — antes só existia por e-mail, nunca visível diretamente) — esta
// função é de 2026-08-31, ANTES do padrão "excluir RG gerenciado" ter sido estabelecido nas
// features de crescimento seguintes (Crescimento Líquido, Detalhe do Crescimento, Relatório
// Diário, todas 2026-09-02+). Nunca tinha sido corrigida porque nunca tinha UI pra notar o
// problema — confirmado testando contra o ambiente real: dos 334 anomalias retornadas, ~1/3
// eram de RG `MANAGED-RG-*`/`DATABRICKS-RG-*` — recursos efêmeros de cluster (recriados em
// horas) dominando o Z-score de "crescimento" que deveria ser sobre infraestrutura fixa.
// Mesma técnica já usada em GET /crescimento-liquido: classifica RGs distintos em JS
// (_detectManagedRg), passa a lista pro SQL como filtro.
async function _computeAnomaliasCrescimentoRaw() {
  const hoje = new Date();
  const fim = hoje.toISOString().slice(0, 10);
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 34);
  const inicioStr = inicio.toISOString().slice(0, 10);

  const rgsGerenciados = await _getRgsGerenciados();
  // Multiplicador por publisher_type injetado direto no SQL (não dá pra separar-e-recombinar
  // em JS aqui: o custo alimenta AVG/STDDEV_POP dentro da própria query, pra calcular o
  // Z-score). Matematicamente seguro: multiplicar cada `custo` por uma constante NÃO muda o
  // Z-score (média e desvio escalam pelo mesmo fator, a razão fica idêntica) — só corrige o
  // valor absoluto exibido.
  const impostoCfgAnom = await _getImpostoConfig();
  const multMs = impostoCfgAnom.microsoft.ativo   ? 1 + impostoCfgAnom.microsoft.taxa / 100   : 1;
  const multMp = impostoCfgAnom.marketplace.ativo ? 1 + impostoCfgAnom.marketplace.taxa / 100 : 1;

  // Exclusão de RG gerenciado SEM filtrar por linha antes de agregar — bug real de
  // performance encontrado testando contra o ambiente real (~3,7M linhas em `azure_costs`):
  // um `NOT (UPPER(resource_group_name) = ANY($3))` avaliado linha a linha (antes do GROUP
  // BY) fez o endpoint ir de resposta imediata pra quase 3 MINUTOS — mesma classe de
  // problema já documentada antes nesta sessão pro fallback de custo por RG ("Qualquer linha
  // recente é suficiente... ORDER BY força Sort sobre todo o conjunto"), só que aqui era um
  // predicado de exclusão sobre a tabela inteira, não um LIMIT 1. Corrigido com dois padrões,
  // cada um evitando o filtro caro em cima de milhões de linhas:
  //  - Nível subscription (RG "some" na soma, não dá pra filtrar depois de agregar): 2
  //    agregações — uma SEM filtro (idêntica à consulta original, já rápida) e outra SÓ com
  //    os RGs gerenciados via `= ANY` de INCLUSÃO (poucas centenas de valores, casa bem com o
  //    índice funcional `idx_azure_costs_rg_upper`) — subtrai a segunda da primeira em SQL.
  //  - Nível resource_group (RG já é chave do GROUP BY): filtra DEPOIS de agregar — o
  //    conjunto já agrupado por dia+RG é pequeno (algumas centenas de RGs × 35 dias), custa
  //    quase nada excluir ali, mesmo raciocínio de "filtrar o resultado pequeno, não a
  //    tabela grande" já usado no resto desta sessão.
  const [rSub, rRg, rPersistente] = await Promise.all([
    pool.query(`
      WITH criacoes_todas AS (
        SELECT subscription_id, DATE(quando) AS dia, COUNT(*) AS criacoes
        FROM azure_recursos_auditoria_eventos
        WHERE acao = 'CRIACAO' AND quando >= $1 AND quando < $2::date + INTERVAL '1 day'
        GROUP BY 1, 2
      ), criacoes_gerenciadas AS (
        SELECT subscription_id, DATE(quando) AS dia, COUNT(*) AS criacoes
        FROM azure_recursos_auditoria_eventos
        WHERE acao = 'CRIACAO' AND quando >= $1 AND quando < $2::date + INTERVAL '1 day'
          AND UPPER(COALESCE(resource_group,'')) = ANY($3::text[])
        GROUP BY 1, 2
      ), criacoes AS (
        SELECT t.subscription_id, t.dia, t.criacoes - COALESCE(g.criacoes,0) AS criacoes
        FROM criacoes_todas t LEFT JOIN criacoes_gerenciadas g ON g.subscription_id=t.subscription_id AND g.dia=t.dia
      ), custos_todos AS (
        SELECT subscription_id, cost_date AS dia,
               SUM(cost_in_billing_currency * CASE WHEN publisher_type = 'Marketplace' THEN $5::numeric ELSE $4::numeric END) AS custo
        FROM azure_costs WHERE cost_date >= $1 AND cost_date <= $2
        GROUP BY 1, 2
      ), custos_gerenciados AS (
        SELECT subscription_id, cost_date AS dia,
               SUM(cost_in_billing_currency * CASE WHEN publisher_type = 'Marketplace' THEN $5::numeric ELSE $4::numeric END) AS custo
        FROM azure_costs WHERE cost_date >= $1 AND cost_date <= $2 AND UPPER(resource_group_name) = ANY($3::text[])
        GROUP BY 1, 2
      ), custos AS (
        SELECT t.subscription_id, t.dia, t.custo - COALESCE(g.custo,0) AS custo
        FROM custos_todos t LEFT JOIN custos_gerenciados g ON g.subscription_id=t.subscription_id AND g.dia=t.dia
      ), chaves AS (
        SELECT subscription_id, dia FROM criacoes
        UNION SELECT subscription_id, dia FROM custos
      ), combinado AS (
        SELECT k.subscription_id, k.dia, COALESCE(c.criacoes,0) AS criacoes, COALESCE(cu.custo,0) AS custo
        FROM chaves k
        LEFT JOIN criacoes c ON c.subscription_id=k.subscription_id AND c.dia=k.dia
        LEFT JOIN custos cu ON cu.subscription_id=k.subscription_id AND cu.dia=k.dia
      ), stats AS (
        SELECT subscription_id,
          AVG(criacoes) AS media_criacoes, STDDEV_POP(criacoes) AS desvio_criacoes,
          AVG(custo) AS media_custo, STDDEV_POP(custo) AS desvio_custo, COUNT(*) AS dias
        FROM combinado GROUP BY 1 HAVING COUNT(*) >= 5
      )
      SELECT co.subscription_id, to_char(co.dia,'YYYY-MM-DD') AS dia, co.criacoes, co.custo,
        s.media_criacoes, s.desvio_criacoes, s.media_custo, s.desvio_custo,
        CASE WHEN s.desvio_criacoes > 0 THEN (co.criacoes - s.media_criacoes) / s.desvio_criacoes ELSE 0 END AS zscore_criacoes,
        CASE WHEN s.desvio_custo > 0 THEN (co.custo - s.media_custo) / s.desvio_custo ELSE 0 END AS zscore_custo
      FROM combinado co JOIN stats s USING (subscription_id)
      ORDER BY co.subscription_id, co.dia
    `, [inicioStr, fim, rgsGerenciados, multMs, multMp]),
    pool.query(`
      WITH criacoes AS (
        SELECT * FROM (
          SELECT subscription_id, UPPER(resource_group) AS resource_group, DATE(quando) AS dia, COUNT(*) AS criacoes
          FROM azure_recursos_auditoria_eventos
          WHERE acao = 'CRIACAO' AND quando >= $1 AND quando < $2::date + INTERVAL '1 day' AND resource_group IS NOT NULL
          GROUP BY 1, 2, 3
        ) g WHERE NOT (resource_group = ANY($3::text[]))
      ), custos AS (
        SELECT * FROM (
          SELECT subscription_id, UPPER(resource_group_name) AS resource_group, cost_date AS dia,
                 SUM(cost_in_billing_currency * CASE WHEN publisher_type = 'Marketplace' THEN $5::numeric ELSE $4::numeric END) AS custo
          FROM azure_costs WHERE cost_date >= $1 AND cost_date <= $2 AND resource_group_name IS NOT NULL
          GROUP BY 1, 2, 3
        ) g WHERE NOT (resource_group = ANY($3::text[]))
      ), chaves AS (
        SELECT subscription_id, resource_group, dia FROM criacoes
        UNION SELECT subscription_id, resource_group, dia FROM custos
      ), combinado AS (
        SELECT k.subscription_id, k.resource_group, k.dia, COALESCE(c.criacoes,0) AS criacoes, COALESCE(cu.custo,0) AS custo
        FROM chaves k
        LEFT JOIN criacoes c ON c.subscription_id=k.subscription_id AND c.resource_group=k.resource_group AND c.dia=k.dia
        LEFT JOIN custos cu ON cu.subscription_id=k.subscription_id AND cu.resource_group=k.resource_group AND cu.dia=k.dia
      ), stats AS (
        SELECT subscription_id, resource_group,
          AVG(criacoes) AS media_criacoes, STDDEV_POP(criacoes) AS desvio_criacoes,
          AVG(custo) AS media_custo, STDDEV_POP(custo) AS desvio_custo, COUNT(*) AS dias
        FROM combinado GROUP BY 1, 2 HAVING COUNT(*) >= 5
      )
      SELECT co.subscription_id, co.resource_group, to_char(co.dia,'YYYY-MM-DD') AS dia, co.criacoes, co.custo,
        s.media_criacoes, s.desvio_criacoes, s.media_custo, s.desvio_custo,
        CASE WHEN s.desvio_criacoes > 0 THEN (co.criacoes - s.media_criacoes) / s.desvio_criacoes ELSE 0 END AS zscore_criacoes,
        CASE WHEN s.desvio_custo > 0 THEN (co.custo - s.media_custo) / s.desvio_custo ELSE 0 END AS zscore_custo
      FROM combinado co JOIN stats s USING (subscription_id, resource_group)
      ORDER BY co.subscription_id, co.resource_group, co.dia
    `, [inicioStr, fim, rgsGerenciados, multMs, multMp]),
    pool.query(`
      WITH persistentes AS (
        SELECT subscription_id, DATE_TRUNC('day', CURRENT_TIMESTAMP)::DATE AS dia,
          COUNT(*) AS recursos_persistentes,
          SUM(CASE WHEN EXTRACT(EPOCH FROM (NOW() - criado_em)) / 86400 >= 7 AND EXTRACT(EPOCH FROM (NOW() - criado_em)) / 86400 < 14 THEN 1 ELSE 0 END) AS novos_persistentes
        FROM azure_recursos_inventario
        WHERE ativo = true AND EXTRACT(EPOCH FROM (NOW() - criado_em)) / 86400 >= 7 AND NOT UPPER(COALESCE(resource_group,'')) = ANY($3::text[])
        GROUP BY 1, 2
      ), stats AS (
        SELECT subscription_id,
          AVG(recursos_persistentes) AS media, STDDEV_POP(recursos_persistentes) AS desvio,
          COUNT(*) AS dias
        FROM persistentes WHERE dia >= $1::date AND dia <= $2::date
        GROUP BY 1 HAVING COUNT(*) >= 5
      )
      SELECT p.subscription_id, to_char(p.dia,'YYYY-MM-DD') AS dia, p.recursos_persistentes, p.novos_persistentes,
        s.media, s.desvio,
        CASE WHEN s.desvio > 0 THEN (p.recursos_persistentes - s.media) / s.desvio ELSE 0 END AS zscore
      FROM persistentes p LEFT JOIN stats s ON p.subscription_id = s.subscription_id
      ORDER BY p.subscription_id, p.dia
    `, [inicioStr, fim, rgsGerenciados]),
  ]);

  function processar(rows, escopoTipo) {
    const out = [];
    for (const r of rows) {
      const criacoes = parseInt(r.criacoes, 10);
      const custo = parseFloat(r.custo);
      const zCriacoes = parseFloat(r.zscore_criacoes);
      const zCusto = parseFloat(r.zscore_custo);
      const anomaloCriacoes = criacoes >= _ANOM_CRESCIMENTO_MIN_CRIACOES && Math.abs(zCriacoes) >= _ANOM_CRESCIMENTO_ZSCORE;
      const anomaloCusto = custo >= _ANOM_CRESCIMENTO_MIN_CUSTO && Math.abs(zCusto) >= _ANOM_CRESCIMENTO_ZSCORE;
      if (!anomaloCriacoes && !anomaloCusto) continue;
      out.push({
        escopo_tipo: escopoTipo, subscription_id: r.subscription_id, resource_group: r.resource_group || null, dia: r.dia,
        criacoes, custo, media_criacoes: parseFloat(r.media_criacoes), desvio_criacoes: parseFloat(r.desvio_criacoes),
        media_custo: parseFloat(r.media_custo), desvio_custo: parseFloat(r.desvio_custo),
        zscore_criacoes: zCriacoes, zscore_custo: zCusto,
        gatilho: anomaloCriacoes && anomaloCusto ? 'ambos' : anomaloCriacoes ? 'criacoes' : 'custo',
      });
    }
    return out;
  }

  function processarPersistente(rows) {
    const out = [];
    for (const r of rows) {
      const recursos = parseInt(r.recursos_persistentes, 10);
      const novos = parseInt(r.novos_persistentes, 10);
      const zscore = parseFloat(r.zscore) || 0;
      const anomalo = recursos >= 5 && zscore >= 2.5;
      if (!anomalo) continue;
      out.push({
        escopo_tipo: 'persistente', subscription_id: r.subscription_id, resource_group: null, dia: r.dia,
        recursos_persistentes: recursos, novos_persistentes: novos,
        media: parseFloat(r.media) || 0, desvio: parseFloat(r.desvio) || 0,
        zscore: zscore, severidade: zscore >= 2.5 ? 'critico' : 'atencao',
      });
    }
    return out;
  }

  const crescimento = [...processar(rSub.rows, 'subscription'), ...processar(rRg.rows, 'resource_group'), ...processarPersistente(rPersistente.rows)];
  crescimento.sort((a, b) => {
    const scoreA = Math.max(Math.abs(a.zscore_criacoes || 0), Math.abs(a.zscore_custo || 0), Math.abs(a.zscore || 0));
    const scoreB = Math.max(Math.abs(b.zscore_criacoes || 0), Math.abs(b.zscore_custo || 0), Math.abs(b.zscore || 0));
    return scoreB - scoreA;
  });
  return crescimento;
}

// Cache em memória (2026-09-04) — mesmo padrão já usado pro Advisor (_advisorCache): mesmo
// depois de otimizar a query (ver comentário acima, de ~3min pra ~45s), ainda é pesado demais
// pra rodar a cada carregamento da tela — Z-score sobre 35 dias não muda minuto a minuto, TTL
// de 20min é uma folga segura. Dedup por promise em andamento evita 2 requests concorrentes
// disparando 2 cálculos completos (mesmo problema de concorrência já documentado e corrigido
// antes nesta sessão pro cache de custo por RG).
const _ANOM_CRESCIMENTO_TTL = 20 * 60 * 1000;
let _anomaliasCrescimentoCache = null; // { dados, ts }
let _anomaliasCrescimentoPromise = null;
async function _computeAnomaliasCrescimento() {
  if (_anomaliasCrescimentoCache && (Date.now() - _anomaliasCrescimentoCache.ts) < _ANOM_CRESCIMENTO_TTL) {
    return _anomaliasCrescimentoCache.dados;
  }
  if (_anomaliasCrescimentoPromise) return _anomaliasCrescimentoPromise;
  _anomaliasCrescimentoPromise = (async () => {
    try {
      const dados = await _computeAnomaliasCrescimentoRaw();
      _anomaliasCrescimentoCache = { dados, ts: Date.now() };
      return dados;
    } finally {
      _anomaliasCrescimentoPromise = null;
    }
  })();
  return _anomaliasCrescimentoPromise;
}

app.get('/api/azure-inventario/anomalias', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    res.json(await _computeAnomaliasCrescimento());
  } catch (e) { _dbErr(res, e); }
});

// Crescimento persistente — recursos criados há 7+ dias e ainda ativos, Z-score anômalo
app.get('/api/azure-inventario/crescimento-persistente', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const todas = await _computeAnomaliasCrescimento();
    const persistentes = todas.filter(a => a.escopo_tipo === 'persistente');
    res.json(persistentes);
  } catch (e) { _dbErr(res, e); }
});

// Orçamentos/teto — mesmo padrão de databricks_budgets (ver _validarBudgetInput ali), mas
// escopado por subscription/Resource Group (não workspace/tag) e com 2 tipos de limite:
// contagem de recursos ATIVOS (snapshot atual, não soma de eventos) ou custo do mês
// corrente — cobre tanto "não deixe esse RG passar de N recursos" quanto "não deixe esse
// RG passar de R$X/mês", sem duplicar a lógica de threshold configurável já validada lá.
function _validarOrcamentoInventarioInput(body) {
  const { nome, limite_valor, ativo } = body;
  let { escopo_tipo, subscription_id, resource_group, tipo_limite, threshold_atencao, threshold_critico, tag_chave, tag_valor } = body;
  escopo_tipo = escopo_tipo || (resource_group ? 'resource_group' : (tag_chave ? 'tag' : 'subscription'));
  if (!['subscription', 'resource_group', 'tag'].includes(escopo_tipo)) return { error: 'escopo_tipo inválido' };
  // Escopo de TAG atravessa assinaturas por natureza ("o projeto NFCOM não pode passar de X"),
  // então `subscription_id` vira opcional aqui — '' significa "todas". A coluna é NOT NULL no
  // schema, por isso string vazia e não null.
  if (escopo_tipo === 'tag') {
    subscription_id = subscription_id || '';
    if (!tag_chave || !tag_valor) return { error: 'tag_chave e tag_valor são obrigatórios para escopo "tag"' };
    resource_group = null;
    // Contagem de recursos não é calculável por tag: `azure_recursos_inventario` (plano ARM) não
    // guarda tags — elas vivem no billing. Forçar 'custo' em vez de deixar o usuário criar um
    // orçamento que silenciosamente mediria a coisa errada.
    if (tipo_limite && tipo_limite !== 'custo') return { error: 'escopo "tag" só aceita tipo_limite "custo" (contagem de recursos por tag não é calculável)' };
    tipo_limite = 'custo';
  } else {
    if (!subscription_id) return { error: 'subscription_id é obrigatório' };
    tag_chave = null; tag_valor = null;
  }
  if (!nome || limite_valor == null) return { error: 'nome e limite_valor são obrigatórios' };
  if (escopo_tipo === 'resource_group' && !resource_group) return { error: 'resource_group é obrigatório para escopo "resource_group"' };
  if (escopo_tipo !== 'resource_group') resource_group = null;
  tipo_limite = tipo_limite || 'recursos';
  if (!['recursos', 'custo'].includes(tipo_limite)) return { error: 'tipo_limite inválido (use "recursos" ou "custo")' };
  const limiteNum = parseFloat(limite_valor);
  if (!(limiteNum > 0)) return { error: 'limite_valor deve ser maior que zero' };
  threshold_atencao = threshold_atencao != null ? parseFloat(threshold_atencao) : 75;
  threshold_critico = threshold_critico != null ? parseFloat(threshold_critico) : 90;
  if (!(threshold_atencao > 0 && threshold_atencao < 100)) return { error: 'threshold_atencao deve estar entre 0 e 100' };
  if (!(threshold_critico > threshold_atencao && threshold_critico <= 100)) return { error: 'threshold_critico deve ser maior que threshold_atencao e no máximo 100' };
  return { value: { nome, escopo_tipo, subscription_id, resource_group, tipo_limite, limite_valor: limiteNum, threshold_atencao, threshold_critico, ativo: ativo !== false, tag_chave: tag_chave || null, tag_valor: tag_valor || null } };
}

app.get('/api/azure-inventario/orcamentos', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM azure_inventario_orcamentos ORDER BY nome`);
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-inventario/orcamentos', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const v = _validarOrcamentoInventarioInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const o = v.value;
    const r = await pool.query(
      `INSERT INTO azure_inventario_orcamentos (nome, escopo_tipo, subscription_id, resource_group, tipo_limite, limite_valor, threshold_atencao, threshold_critico, ativo, tag_chave, tag_valor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [o.nome, o.escopo_tipo, o.subscription_id, o.resource_group, o.tipo_limite, o.limite_valor, o.threshold_atencao, o.threshold_critico, o.ativo, o.tag_chave, o.tag_valor]
    );
    res.json(r.rows[0]);
  } catch (e) { _dbErr(res, e); }
});

app.put('/api/azure-inventario/orcamentos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const v = _validarOrcamentoInventarioInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const o = v.value;
    const r = await pool.query(
      `UPDATE azure_inventario_orcamentos SET nome=$1, escopo_tipo=$2, subscription_id=$3, resource_group=$4, tipo_limite=$5, limite_valor=$6, threshold_atencao=$7, threshold_critico=$8, ativo=$9, tag_chave=$10, tag_valor=$11, atualizado_em=NOW() WHERE id=$12 RETURNING *`,
      [o.nome, o.escopo_tipo, o.subscription_id, o.resource_group, o.tipo_limite, o.limite_valor, o.threshold_atencao, o.threshold_critico, o.ativo, o.tag_chave, o.tag_valor, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-inventario/orcamentos/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM azure_inventario_orcamentos WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Status de cada orçamento ativo — extraído numa função compartilhada (dashboard sob
// demanda + _checkOrcamentosInventario periódica pra e-mail), mesmo padrão de
// _computeAlertasDatabricks. "recursos" é sempre um SNAPSHOT atual (COUNT ativo=true),
// nunca uma soma de eventos — bate com o mesmo conceito já usado no Comparativo.
async function _computeOrcamentosInventarioAlertas() {
  const orcamentos = (await pool.query(`SELECT * FROM azure_inventario_orcamentos WHERE ativo = true`)).rows;
  if (!orcamentos.length) return [];

  const inicioMes = new Date(); inicioMes.setDate(1);
  const inicioMesStr = inicioMes.toISOString().slice(0, 10);
  const impostoCfg = await _getImpostoConfig();

  const alertas = [];
  for (const o of orcamentos) {
    let atual;
    if (o.escopo_tipo === 'tag') {
      // Lê do rollup `azure_custo_por_tag` (mês corrente), não de azure_costs — o rollup já
      // existe pro showback e é minúsculo. Caveat real: ele é reconstruído de 6 em 6h, então
      // um orçamento por tag reage com essa defasagem (os outros escopos leem o billing ao
      // vivo). É o trade-off de não varrer 3,7M linhas por orçamento a cada checagem.
      const mesAtual = new Date().toISOString().slice(0, 7);
      const params = [mesAtual, o.tag_chave, o.tag_valor];
      let sql = `SELECT COALESCE(SUM(custo_microsoft),0) AS microsoft, COALESCE(SUM(custo_marketplace),0) AS marketplace
                 FROM azure_custo_por_tag WHERE mes=$1 AND tag_chave=$2 AND tag_valor=$3`;
      if (o.subscription_id) { params.push(o.subscription_id); sql += ` AND subscription_id=$4`; }
      const r = await pool.query(sql, params);
      atual = _comImpostoSplit(r.rows[0].microsoft, r.rows[0].marketplace, impostoCfg);
    } else if (o.tipo_limite === 'recursos') {
      const params = [o.subscription_id];
      let sql = `SELECT COUNT(*) AS total FROM azure_recursos_inventario WHERE ativo=true AND subscription_id=$1`;
      if (o.resource_group) { params.push(o.resource_group); sql += ` AND UPPER(resource_group)=UPPER($2)`; }
      const r = await pool.query(sql, params);
      atual = parseInt(r.rows[0].total, 10);
    } else {
      const params = [inicioMesStr, o.subscription_id];
      let sql = `SELECT COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'), 0) AS marketplace,
                        COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS microsoft
                 FROM azure_costs WHERE cost_date >= $1 AND subscription_id=$2`;
      if (o.resource_group) { params.push(o.resource_group); sql += ` AND UPPER(resource_group_name)=UPPER($3)`; }
      const r = await pool.query(sql, params);
      atual = _comImpostoSplit(r.rows[0].microsoft, r.rows[0].marketplace, impostoCfg);
    }
    const limite = parseFloat(o.limite_valor);
    const pct = limite > 0 ? atual / limite : 0;
    const thAtencao = parseFloat(o.threshold_atencao) / 100;
    const thCritico = parseFloat(o.threshold_critico) / 100;
    if (pct < thAtencao) continue;
    const severidade = pct >= 1 ? 'estourado' : pct >= thCritico ? 'critico' : 'atencao';
    alertas.push({ orcamento: o, valor_atual: atual, pct, severidade });
  }
  alertas.sort((a, b) => b.pct - a.pct);
  return alertas;
}

app.get('/api/azure-inventario/orcamentos/alertas', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    res.json(await _computeOrcamentosInventarioAlertas());
  } catch (e) { _dbErr(res, e); }
});

// Tags obrigatórias — checa as tags dos recursos ATIVOS do inventário contra as chaves
// configuradas em `azure_inventario_config.tags_obrigatorias`. Fonte das tags:
// `azure_recurso_tags`, materializada em background a partir de `azure_costs` (ver
// _rebuildRecursoTagsCache) — zero coleta nova, mas dado DEFASADO por construção, então a
// resposta sempre carrega `atualizado_em` pro cliente poder avisar (mesma disciplina do
// `stale` já adotada noutros caches deste arquivo).
// Recursos sem NENHUMA linha em azure_costs (comum — ver "custo direto zerado" documentado
// acima) entram como "não verificável", NUNCA como não-conforme — não dá pra afirmar que
// faltam tags num recurso que nunca vimos no billing.
const _TAGS_FALTANTES_TTL = 15 * 60 * 1000;
const _tagsFaltantesCache = new Map();    // subscription_id|'' -> { dados, ts }
const _tagsFaltantesPromises = new Map();

app.get('/api/azure-inventario/tags-faltantes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const chave = String(req.query.subscription_id || '');
    const cached = _tagsFaltantesCache.get(chave);
    if (cached && (Date.now() - cached.ts) < _TAGS_FALTANTES_TTL) return res.json(cached.dados);
    if (_tagsFaltantesPromises.has(chave)) return res.json(await _tagsFaltantesPromises.get(chave));
    const p = _computeTagsFaltantes(req.query.subscription_id).finally(() => _tagsFaltantesPromises.delete(chave));
    _tagsFaltantesPromises.set(chave, p);
    const dados = await p;
    _tagsFaltantesCache.set(chave, { dados, ts: Date.now() });
    res.json(dados);
  } catch (e) { _dbErr(res, e); }
});

async function _computeTagsFaltantes(subscription_id) {
  const cfgRow = await pool.query(`SELECT tags_obrigatorias FROM azure_inventario_config ORDER BY id LIMIT 1`);
  const chaves = (cfgRow.rows[0]?.tags_obrigatorias || '').split(',').map(s => s.trim()).filter(Boolean);
  const metaRow = await pool.query(`SELECT MAX(atualizado_em) AS atualizado_em, COUNT(*)::int AS recursos_conhecidos FROM azure_recurso_tags`);
  const meta = {
    atualizado_em: metaRow.rows[0]?.atualizado_em || null,
    recursos_conhecidos: metaRow.rows[0]?.recursos_conhecidos || 0,
  };
  if (!chaves.length) return { chaves: [], nao_conformes: [], nao_verificaveis: 0, total_verificado: 0, ...meta };

  const params = [];
  let where = 'ri.ativo = true';
  if (subscription_id) { params.push(subscription_id); where += ` AND ri.subscription_id = $${params.length}`; }

  // Query reescrita (2026-09-04). A versão original era uma subquery CORRELACIONADA por linha
  // (`SELECT ac.tags ... ORDER BY cost_date DESC LIMIT 1` para cada um dos ~29 mil recursos
  // ativos) contra a tabela de 3,7M — a classe "trabalho por linha contra a tabela grande" que
  // já custou 175s neste arquivo. Nunca tinha sido medida porque a cadeia estava morta (ver o
  // fix de `tags_obrigatorias` no POST /config).
  // Medido: servir isto direto de azure_costs custa 45s (GROUP BY/MAX 7d), 62s (DISTINCT ON 7d)
  // ou 190s (DISTINCT ON 35d) — todas inviáveis pra uma tela. Lendo de `azure_recurso_tags`
  // (materializada em background, ver _rebuildRecursoTagsCache) vira hash join: ~3,5s.
  // JSON.parse por linha em JS mantido de propósito (CAST ::jsonb que falhe abortaria tudo).
  const r = await pool.query(`
    SELECT ri.subscription_id, ri.resource_id, ri.nome, ri.resource_group, ri.resource_type, t.tags
    FROM azure_recursos_inventario ri
    LEFT JOIN azure_recurso_tags t ON t.resource_id_upper = UPPER(ri.resource_id)
    WHERE ${where}
  `, params);

  let naoVerificaveis = 0;
  let totalNaoConformes = 0;
  const naoConformes = [];
  for (const row of r.rows) {
    if (!row.tags) { naoVerificaveis++; continue; }
    let tagsObj = null;
    try { tagsObj = JSON.parse(row.tags); } catch { /* export malformado — trata como sem tags */ }
    const faltando = chaves.filter(k => !tagsObj || tagsObj[k] == null || tagsObj[k] === '');
    if (faltando.length) {
      totalNaoConformes++;
      // Lista capada — a CONTAGEM (que alimenta pct_conformes) continua exata; só o detalhe é
      // truncado, mesmo padrão de LIMIT 300 já usado nas outras rotas de listagem do arquivo.
      if (naoConformes.length < 300) naoConformes.push({
        subscription_id: row.subscription_id, resource_id: row.resource_id, nome: row.nome,
        resource_group: row.resource_group, resource_type: row.resource_type, tags_faltando: faltando,
      });
    }
  }
  // pct_conformes é sobre o VERIFICÁVEL (exclui não-verificáveis do denominador) — incluir
  // recursos que nunca vimos no billing puniria o número por falta de dado, não por falta de
  // tag. Benchmark de mercado: 80%+ antes de outros KPIs de FinOps fazerem sentido.
  const verificaveis = r.rows.length - naoVerificaveis;
  return {
    chaves,
    nao_conformes: naoConformes,
    nao_verificaveis: naoVerificaveis,
    total_verificado: r.rows.length,
    verificaveis,
    total_nao_conformes: totalNaoConformes,
    conformes: verificaveis - totalNaoConformes,
    pct_conformes: verificaveis > 0 ? (verificaveis - totalNaoConformes) / verificaveis : null,
    ...meta,
  };
}

app.get('/api/azure-inventario/conformidade-por-subscription', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const dados = await _computeConformidadePorSubscription();
    res.json(dados);
  } catch (e) { _dbErr(res, e); }
});

async function _computeConformidadePorSubscription() {
  const cfgRow = await pool.query(`SELECT tags_obrigatorias FROM azure_inventario_config ORDER BY id LIMIT 1`);
  const chaves = (cfgRow.rows[0]?.tags_obrigatorias || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!chaves.length) return { por_subscription: [], chaves: [] };

  // Recursos persistentes (7+ dias) em RGs não-gerenciados + tags conhecidas
  const r = await pool.query(`
    SELECT ri.subscription_id, ri.resource_id, ri.nome, ri.resource_group, ri.resource_type, t.tags
    FROM azure_recursos_inventario ri
    LEFT JOIN azure_recurso_tags t ON t.resource_id_upper = UPPER(ri.resource_id)
    WHERE ri.ativo = true
      AND COALESCE(EXTRACT(EPOCH FROM (NOW() - ri.criado_em)) / 86400, 0) >= 7
      AND NOT (UPPER(ri.resource_group) LIKE 'DATABRICKS-RG-%' OR UPPER(ri.resource_group) LIKE 'MANAGED-RG-%' OR UPPER(ri.resource_group) LIKE 'MC_%')
      AND t.tags IS NOT NULL
  `);

  const porSub = new Map();
  for (const row of r.rows) {
    if (!porSub.has(row.subscription_id)) {
      porSub.set(row.subscription_id, { conformes: 0, nao_conformes: 0, nao_conformes_list: [] });
    }

    let tagsObj = null;
    try { tagsObj = JSON.parse(row.tags); } catch { /* malformado */ }

    const faltando = chaves.filter(k => !tagsObj || tagsObj[k] == null || tagsObj[k] === '');
    const sub = porSub.get(row.subscription_id);

    if (faltando.length) {
      sub.nao_conformes++;
      if (sub.nao_conformes_list.length < 10) {
        sub.nao_conformes_list.push({
          resource_id: row.resource_id,
          nome: row.nome,
          resource_group: row.resource_group,
          resource_type: row.resource_type,
          tags_faltando: faltando,
        });
      }
    } else {
      sub.conformes++;
    }
  }

  const resultado = Array.from(porSub.entries()).map(([sub_id, data]) => {
    const total = data.conformes + data.nao_conformes;
    return {
      subscription_id: sub_id,
      total_verificado: total,
      conformes: data.conformes,
      nao_conformes: data.nao_conformes,
      pct_conformes: total > 0 ? data.conformes / total : null,
      nao_conformes_amostra: data.nao_conformes_list,
    };
  }).sort((a, b) => (a.pct_conformes || 0) - (b.pct_conformes || 0));

  return { por_subscription: resultado, chaves };
}

// Atualiza SOMENTE `tags_obrigatorias` (2026-09-04, pedido do usuário: poder configurar as tags
// obrigatórias direto na tela de Conformidade, sem ir até Inventário → Configuração).
// Endpoint próprio, não reuso do `POST /azure-inventario/config`: aquele faz UPDATE de TODOS os
// campos (ativo, sp_id, subscription_ids, retencao_dias), então salvar a partir de outra tela
// exigiria reenviar tudo — e um campo faltando zeraria a configuração da coleta. Com uma rota
// dedicada, as duas telas podem editar o mesmo dado sem risco de uma sobrescrever a outra.
app.put('/api/azure-inventario/tags-obrigatorias', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const valor = String(req.body?.tags_obrigatorias || '')
      .split(',').map(x => x.trim()).filter(Boolean).join(',');
    let r = await pool.query(`SELECT id FROM azure_inventario_config ORDER BY id LIMIT 1`);
    if (!r.rows.length) r = await pool.query(`INSERT INTO azure_inventario_config DEFAULT VALUES RETURNING id`);
    await pool.query(
      `UPDATE azure_inventario_config SET tags_obrigatorias = $1, atualizado_em = NOW() WHERE id = $2`,
      [valor || null, r.rows[0].id]
    );
    // Sem isso o relatório continuaria servindo o resultado antigo por até 15 min (o TTL) e o
    // usuário acharia que o save não funcionou — mesmo bug já corrigido no POST /config.
    _tagsFaltantesCache.clear();
    res.json({ ok: true, tags_obrigatorias: valor || null });
  } catch (e) { _dbErr(res, e); }
});

// Rebuild manual do cache de tags por recurso — o build automático roda de 6 em 6h, mas depois
// de uma importação grande o admin pode querer forçar. Responde 202 na hora (o build leva
// ~4min) — erro cru de propósito, é o ponto da rota.
app.post('/api/azure-inventario/recurso-tags/rebuild', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_scanPesadoEmAndamento()) return res.status(409).json({ error: 'Outro scan pesado de azure_costs já em execução' });
  res.status(202).json({ ok: true, message: 'Rebuild do cache de tags iniciado (leva alguns minutos)' });
  _rebuildRecursoTagsCache('manual')
    .then(() => { _tagsFaltantesCache.clear(); })
    .catch(e => console.error('[TagsCache] Erro:', e.message));
});

// ── ALOCAÇÃO DE CUSTO POR TAG (showback) ─────────────────────────────────────
// Capability "Allocation" do FinOps Framework. Lê do rollup materializado
// (azure_custo_por_tag) — nunca de azure_costs ao vivo. Ver _rebuildAlocacaoTagsMes.

// Chaves de tag disponíveis, pro seletor. Ordenadas por custo coberto (a chave que "explica"
// mais dinheiro primeiro), com `valores_distintos` pra UI poder avisar sobre chaves de
// cardinalidade absurda (ex: ClusterId, com 364 mil valores — inútil pra rateio).
app.get('/api/azure-costs/tag-chaves', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const { mes_inicio, mes_fim } = req.query;
    const params = [];
    let where = "tag_chave <> '__total__'";
    if (mes_inicio) { params.push(mes_inicio); where += ` AND mes >= $${params.length}`; }
    if (mes_fim)    { params.push(mes_fim);    where += ` AND mes <= $${params.length}`; }
    const r = await pool.query(
      `SELECT tag_chave, MAX(valores_distintos) AS valores_distintos,
              SUM(custo_microsoft) AS custo_microsoft, SUM(custo_marketplace) AS custo_marketplace
       FROM azure_tag_chaves WHERE ${where}
       GROUP BY 1 ORDER BY (SUM(custo_microsoft) + SUM(custo_marketplace)) DESC LIMIT 200`, params
    );
    const st = await pool.query(`SELECT mes, construido_em FROM azure_tag_rollup_status ORDER BY mes`);
    const impostoCfg = await _getImpostoConfig();
    res.json({
      chaves: r.rows.map(x => ({
        chave: x.tag_chave, valores_distintos: Number(x.valores_distintos),
        custo: _comImpostoSplit(x.custo_microsoft, x.custo_marketplace, impostoCfg),
      })),
      meses_construidos: st.rows.map(x => ({ mes: x.mes.trim(), construido_em: x.construido_em })),
    });
  } catch (e) { _dbErr(res, e); }
});

// Rateio por uma chave. `nao_alocado` vem da linha sintética '__total__' menos o alocado —
// auto-consistente por construção (ver comentário na criação da tabela).
// **Valor de tag VAZIO não conta como alocado** (2026-09-04): medido no dado real que 206 linhas
// do rollup somam R$6,66 mi com `tag_valor` em branco, concentradas justamente nas chaves que
// importam (`bu` R$966 mil, `centroDeCusto` R$672 mil, `idFinOps` R$672 mil) — contá-las como
// alocadas inflaria o percentual sem nenhuma informação de rateio. É também o que
// `/tags-faltantes` já faz (trata `tagsObj[k] === ''` como faltando); as duas telas precisam
// concordar. Filtrado na LEITURA (não no builder) — evita reconstruir o rollup inteiro.
app.get('/api/azure-costs/alocacao-tags', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const chave = String(req.query.chave || '').trim();
    if (!chave) return res.status(400).json({ error: 'Parâmetro `chave` é obrigatório' });
    const { mes_inicio, mes_fim, subscription_id } = req.query;

    // Dois conjuntos de parâmetros: as queries que filtram por `chave` levam $1 = chave, e a
    // query de total (que não filtra por chave nenhuma) tem sua própria numeração. Misturar as
    // duas com um replace de string desalinharia $2/$3 — bug pego antes de rodar.
    const filtros = (base) => {
      const cond = [], params = [...base];
      if (mes_inicio)      { params.push(mes_inicio);      cond.push(`mes >= $${params.length}`); }
      if (mes_fim)         { params.push(mes_fim);         cond.push(`mes <= $${params.length}`); }
      if (subscription_id) { params.push(subscription_id); cond.push(`subscription_id = $${params.length}`); }
      return { extra: cond.length ? ' AND ' + cond.join(' AND ') : '', params };
    };
    const comChave = filtros([chave]);
    const semChave = filtros([]);

    const [rItens, rTotal, rMes, rStatus] = await Promise.all([
      pool.query(
        `SELECT tag_valor, SUM(custo_microsoft) AS custo_microsoft, SUM(custo_marketplace) AS custo_marketplace, SUM(linhas) AS linhas
         FROM azure_custo_por_tag WHERE tag_chave = $1 AND TRIM(tag_valor) <> ''${comChave.extra}
         GROUP BY 1 ORDER BY (SUM(custo_microsoft) + SUM(custo_marketplace)) DESC LIMIT 100`, comChave.params),
      pool.query(
        `SELECT SUM(custo_microsoft) AS custo_microsoft, SUM(custo_marketplace) AS custo_marketplace FROM azure_custo_por_tag
         WHERE tag_chave = '__total__'${semChave.extra}`, semChave.params),
      pool.query(
        `SELECT mes,
                SUM(custo_microsoft)   FILTER (WHERE tag_chave = $1 AND TRIM(tag_valor) <> '') AS alocado_microsoft,
                SUM(custo_marketplace) FILTER (WHERE tag_chave = $1 AND TRIM(tag_valor) <> '') AS alocado_marketplace,
                SUM(custo_microsoft)   FILTER (WHERE tag_chave = '__total__')                  AS total_microsoft,
                SUM(custo_marketplace) FILTER (WHERE tag_chave = '__total__')                  AS total_marketplace
         FROM azure_custo_por_tag
         WHERE (tag_chave = $1 OR tag_chave = '__total__')${comChave.extra}
         GROUP BY 1 ORDER BY 1`, comChave.params),
      pool.query(`SELECT MAX(construido_em) AS construido_em FROM azure_tag_rollup_status`),
    ]);

    // `alocado` vem da soma por MÊS (que cobre todos os valores), não da lista de itens — essa
    // é capada em 100 e subestimaria o alocado numa chave com muitos valores.
    // Imposto aplicado nos valores brutos (por categoria) antes de qualquer %: como multiplica
    // numerador e denominador pelo mesmo fator quando a MESMA categoria está ativa nos dois lados,
    // pct_alocado/pct seguem corretos.
    const impostoCfg = await _getImpostoConfig();
    const alocado = _comImpostoSplit(
      rMes.rows.reduce((a, x) => a + Number(x.alocado_microsoft || 0), 0),
      rMes.rows.reduce((a, x) => a + Number(x.alocado_marketplace || 0), 0),
      impostoCfg);
    const total = _comImpostoSplit(rTotal.rows[0]?.custo_microsoft, rTotal.rows[0]?.custo_marketplace, impostoCfg);
    res.json({
      chave,
      total,
      alocado,
      nao_alocado: Math.max(0, total - alocado),
      pct_alocado: total > 0 ? alocado / total : null,
      itens: rItens.rows.map(x => {
        const custo = _comImpostoSplit(x.custo_microsoft, x.custo_marketplace, impostoCfg);
        return { valor: x.tag_valor, custo, linhas: Number(x.linhas), pct: total > 0 ? custo / total : null };
      }),
      por_mes: rMes.rows.map(x => {
        const a = _comImpostoSplit(x.alocado_microsoft, x.alocado_marketplace, impostoCfg);
        const t = _comImpostoSplit(x.total_microsoft, x.total_marketplace, impostoCfg);
        return { mes: x.mes.trim(), alocado: a, total: t, nao_alocado: Math.max(0, t - a), pct_alocado: t > 0 ? a / t : null };
      }),
      atualizado_em: rStatus.rows[0]?.construido_em || null,
    });
  } catch (e) { _dbErr(res, e); }
});

// Série mensal de custo — base do forecast. Lê das linhas sintéticas '__total__' do rollup em
// vez de `GET /api/azure-costs/resumo`: aquele endpoint faz várias agregações sobre os 3,7M e
// leva **42s a frio** (medido), aceitável quando só o modal de Expurgo o usava, inaceitável numa
// aba que carrega sempre. Aqui são 159ms. Confirmado que os totais batem exatamente
// (R$7.077.247,4494 nos dois). `ate` é MAX(cost_date) — o front precisa dele pra saber quantos
// dias do mês corrente já têm billing (o divisor do run-rate).
app.get('/api/azure-costs/serie-mensal', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const [rSerie, rMax] = await Promise.all([
      pool.query(`SELECT mes, SUM(custo_microsoft) AS microsoft, SUM(custo_marketplace) AS marketplace
                  FROM azure_custo_por_tag WHERE tag_chave = '__total__' GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT MAX(cost_date) AS ate FROM azure_costs`),
    ]);
    const ate = rMax.rows[0]?.ate;
    const impostoCfg = await _getImpostoConfig();
    res.json({
      por_mes: rSerie.rows.map(x => ({ mes: x.mes.trim(), custo: _comImpostoSplit(x.microsoft, x.marketplace, impostoCfg) })),
      // Formata como YYYY-MM-DD sem passar por toISOString (que converteria pro fuso UTC e
      // poderia voltar um dia — armadilha de timezone já documentada neste arquivo).
      ate: ate ? `${ate.getFullYear()}-${String(ate.getMonth() + 1).padStart(2, '0')}-${String(ate.getDate()).padStart(2, '0')}` : null,
    });
  } catch (e) { _dbErr(res, e); }
});

// ── COBERTURA DE COMMITMENT (Rate Optimization) ──────────────────────────────
// Medida em HORAS de VM, não em R$ — ver comentário na criação de azure_commitment_cobertura.
// Dois números, de propósito: `cobertura_global` (toda hora de VM) e `cobertura_elegivel`
// (excluindo Spot, que não é elegível a Reservation/Savings Plan). Reportar só o global
// subestimaria o esforço do time, já que Spot nunca poderia ser coberto.
// **ESR de commitment NÃO é exposto**: as linhas cobertas vêm com custo E valor de lista zero
// neste export, então não há como medir a economia da reserva. O desconto que É medível
// (lista → efetivo) é desconto negociado EA/MCA sobre On-Demand — rotulado como tal, nunca
// como "ESR", que significaria outra coisa.
app.get('/api/azure-costs/commitment-cobertura', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await ensureAzureColetaTable();
    const { subscription_id } = req.query;
    const params = [];
    let where = '1=1';
    if (subscription_id) { params.push(subscription_id); where += ` AND subscription_id = $${params.length}`; }

    const [rMes, rStatus] = await Promise.all([
      pool.query(
        `SELECT mes, SUM(h_total) AS h_total, SUM(h_reservation) AS h_reservation,
                SUM(h_savingsplan) AS h_savingsplan, SUM(h_spot) AS h_spot,
                SUM(custo_efetivo) AS custo_efetivo, SUM(custo_lista) AS custo_lista
         FROM azure_commitment_cobertura WHERE ${where} GROUP BY 1 ORDER BY 1`, params),
      pool.query(`SELECT MAX(construido_em) AS construido_em FROM azure_tag_rollup_status`),
    ]);

    const porMes = rMes.rows.map(x => {
      const hTotal = Number(x.h_total), hSpot = Number(x.h_spot);
      const hCob = Number(x.h_reservation) + Number(x.h_savingsplan);
      const elegivel = hTotal - hSpot;
      return {
        mes: x.mes.trim(),
        horas_total: hTotal,
        horas_reservation: Number(x.h_reservation),
        horas_savingsplan: Number(x.h_savingsplan),
        horas_spot: hSpot,
        horas_cobertas: hCob,
        horas_elegiveis: elegivel,
        cobertura_global: hTotal > 0 ? hCob / hTotal : null,
        cobertura_elegivel: elegivel > 0 ? hCob / elegivel : null,
        custo_efetivo: Number(x.custo_efetivo),
        custo_lista: Number(x.custo_lista),
      };
    });

    const som = (f) => porMes.reduce((a, m) => a + f(m), 0);
    const hTotal = som(m => m.horas_total), hSpot = som(m => m.horas_spot);
    const hCob = som(m => m.horas_cobertas), elegivel = hTotal - hSpot;
    const efetivo = som(m => m.custo_efetivo), lista = som(m => m.custo_lista);

    res.json({
      // `determinavel` fica false quando o rollup ainda não foi construído — a UI mostra um card
      // explicando, nunca um "0%" que o usuário leria como "não temos nenhuma reserva".
      determinavel: porMes.length > 0,
      total: {
        horas_total: hTotal, horas_cobertas: hCob, horas_spot: hSpot, horas_elegiveis: elegivel,
        cobertura_global: hTotal > 0 ? hCob / hTotal : null,
        cobertura_elegivel: elegivel > 0 ? hCob / elegivel : null,
        horas_reservation: som(m => m.horas_reservation),
        horas_savingsplan: som(m => m.horas_savingsplan),
      },
      // Desconto sobre On-Demand (EA/MCA negociado) — NÃO é ESR de commitment. Ver comentário.
      desconto_ondemand: {
        custo_efetivo: efetivo, custo_lista: lista,
        pct: lista > 0 ? 1 - efetivo / lista : null,
      },
      esr_commitment: {
        calculavel: false,
        motivo: 'As linhas cobertas por Reservation/Savings Plan vêm com custo e valor de lista zerados neste export — não há base para medir a economia do compromisso.',
      },
      por_mes: porMes,
      atualizado_em: rStatus.rows[0]?.construido_em || null,
    });
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-costs/alocacao-tags/rebuild', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_scanPesadoEmAndamento()) return res.status(409).json({ error: 'Outro scan pesado de azure_costs já em execução' });
  res.status(202).json({ ok: true, message: 'Rollup de alocação por tag iniciado (leva alguns minutos por mês)' });
  // Manual = FORÇA. Um gatilho manual que silenciosamente não faz nada (porque o incremental
  // achou tudo atualizado) é pior que não ter o botão.
  _rebuildAlocacaoTags('manual', true).catch(e => console.error('[TagRollup] Erro:', e.message));
});

// ── DESPERDÍCIO AZURE (Usage Optimization) ───────────────────────────────────
// Capability "Usage Optimization" — a #1 prioridade atual do State of FinOps 2026. Detecção
// própria via Azure Resource Graph, reusando a MESMA Service Principal do Inventário (role
// Reader, já concedida) — zero permissão nova.
//
// Deliberadamente NÃO inclui rightsizing de VM: isso exigiria métricas do Azure Monitor (CPU/
// memória), que é outra API, outra coleta e outra permissão. As categorias aqui são todas
// determináveis pelo estado do próprio recurso.
const _DESPERDICIO_TTL = 20 * 60 * 1000;
const _desperdicioCache = new Map();     // subscription_id -> { itens, ts }
const _desperdicioPromises = new Map();

const _KQL_DISCOS_ORFAOS = `
  Resources | where type =~ 'microsoft.compute/disks'
  | extend diskState = tostring(properties.diskState)
  | where isempty(managedBy) or diskState =~ 'Unattached'
  | project id, name, resourceGroup, location, sku = tostring(sku.name),
            sizeGB = toint(properties.diskSizeGB), criadoEm = tostring(properties.timeCreated), diskState,
            orfaoDesde = tostring(properties.LastOwnershipUpdateTime)`;

// Dentro de `disco_orfao` há dois grupos que precisam de VALIDAÇÃO MANUAL antes de
// qualquer ação — não são "lixo pronto para apagar" como o resto da categoria:
// - PVC do AKS: volume persistente do Kubernetes, só aparece aqui porque o cluster
//   ficou sem o Pod que o usava — pode voltar a ser montado. RG MC_* (mesmo sinal já
//   usado em `_detectManagedRg`) ou nome prefixado `pvc-` (nomenclatura do CSI driver).
// - ASR (Azure Site Recovery): os times marcam esses discos colocando "asr"/"ASR" no
//   nome (convenção interna, não uma propriedade do Azure) — convém reaproveitar esse
//   sinal de nome em vez de inventar um novo, já que é o que os times já usam.
function _classificarDiscoValidacao(disco) {
  const nome = (disco.name || '').toLowerCase();
  const managed = _detectManagedRg(disco.resourceGroup || '');
  if (managed.managed_type === 'aks' || nome.startsWith('pvc-')) return 'aks_pvc';
  if (nome.includes('asr')) return 'asr';
  return null;
}

const _KQL_NICS_ORFAS = `
  Resources | where type =~ 'microsoft.network/networkinterfaces'
  | where isnull(properties.virtualMachine) or isempty(tostring(properties.virtualMachine.id))
  | project id, name, resourceGroup, location`;

const _KQL_IPS_SOLTOS = `
  Resources | where type =~ 'microsoft.network/publicipaddresses'
  | where isnull(properties.ipConfiguration) and isnull(properties.natGateway)
  | project id, name, resourceGroup, location, sku = tostring(sku.name),
            tier = tostring(sku.tier), alloc = tostring(properties.publicIPAllocationMethod)`;

// Mitigação obrigatória do falso-positivo nº1 desta feature: um IP público em frontend de Load
// Balancer / Bastion / Firewall / NAT Gateway / VPN Gateway pode ter `ipConfiguration` vazio e
// estar perfeitamente EM USO. Marcar esses como desperdício destruiria a confiança na tela
// inteira — então coletamos os ids de PIP referenciados por esses tipos e subtraímos.
const _KQL_IPS_REFERENCIADOS = `
  Resources
  | where type =~ 'microsoft.network/loadbalancers'
      or type =~ 'microsoft.network/bastionhosts'
      or type =~ 'microsoft.network/azurefirewalls'
      or type =~ 'microsoft.network/natgateways'
      or type =~ 'microsoft.network/virtualnetworkgateways'
      or type =~ 'microsoft.network/applicationgateways'
  | project ids = extract_all(@'"(/subscriptions/[^"]*/publicIPAddresses/[^"]*)"', tostring(properties))
  | mv-expand ids to typeof(string)
  | project id = ids`;

// Categorias "revisar" (validadas contra o Azure real, 2026-09-24): geram custo, mas o estado do
// recurso não prova sozinho que é abandono — podem estar reservados de propósito.
// Plano sem nenhum app: tiers sem cobrança fixa (Free/Shared/Dynamic/FlexConsumption) ficam de fora.
const _KQL_ASP_VAZIOS = `
  Resources | where type =~ 'microsoft.web/serverfarms'
  | where toint(properties.numberOfSites) == 0
  | where tostring(sku.tier) !in~ ('Free','Shared','Dynamic','FlexConsumption','')
  | project id, name, resourceGroup, location, sku = tostring(sku.name)`;

// Só Standard cobra (Basic é grátis). Membro real = NIC/IP no pool; a chave
// "loadBalancerBackendAddresses" sozinha não conta (aparece mesmo vazia).
const _KQL_LBS_SEM_BACKEND = `
  Resources | where type =~ 'microsoft.network/loadbalancers'
  | where tostring(sku.name) =~ 'Standard'
  | extend pj = tostring(properties.backendAddressPools)
  | where not(pj contains 'networkInterfaceIPConfiguration' or pj contains 'backendIPConfigurations' or pj contains 'ipAddress')
  | project id, name, resourceGroup, location, sku = tostring(sku.name)`;

const _KQL_APPGWS_SEM_BACKEND = `
  Resources | where type =~ 'microsoft.network/applicationgateways'
  | extend pj = tostring(properties.backendAddressPools)
  | where not(pj contains 'ipAddress' or pj contains 'fqdn' or pj contains 'backendIPConfigurations')
  | project id, name, resourceGroup, location, sku = tostring(properties.sku.name)`;

// "stopped" (parada pelo SO, sem desalocar) ainda fatura computação; "deallocated" não.
const _KQL_VMS_PARADAS = `
  Resources | where type =~ 'microsoft.compute/virtualmachines'
  | where tostring(properties.extended.instanceView.powerState.code) =~ 'PowerState/stopped'
  | project id, name, resourceGroup, location, sku = tostring(properties.hardwareProfile.vmSize)`;

function _kqlSnapshotsAntigos(dias) {
  return `
    Resources | where type =~ 'microsoft.compute/snapshots'
    | extend criado = todatetime(properties.timeCreated)
    | where criado < ago(${dias}d)
    | project id, name, resourceGroup, location, sizeGB = toint(properties.diskSizeGB),
              criadoEm = tostring(properties.timeCreated)`;
}

// Custo observado no billing, não preço de tabela. Predicado de INCLUSÃO sobre
// idx_azure_costs_resource_id_upper + recorte por cost_date — o oposto do `NOT ... = ANY` que já
// custou 175s neste arquivo. `JOIN unnest(...)` e não `= ANY(array)`: com milhares de elementos
// o planner degrada `= ANY` pra seq scan.
async function _custoObservadoPorResourceId(ids, desdeISO) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 1000) {
    const lote = ids.slice(i, i + 1000).map((x) => x.toUpperCase());
    const r = await pool.query(
      `SELECT UPPER(ac.resource_id) AS rid,
              SUM(COALESCE(ac.cost_in_billing_currency,0)) FILTER (WHERE ac.publisher_type = 'Marketplace') AS custo_marketplace,
              SUM(COALESCE(ac.cost_in_billing_currency,0)) FILTER (WHERE ac.publisher_type IS DISTINCT FROM 'Marketplace') AS custo_microsoft,
              COUNT(DISTINCT ac.cost_date) AS dias
       FROM azure_costs ac
       JOIN unnest($2::text[]) AS t(rid) ON UPPER(ac.resource_id) = t.rid
       WHERE ac.cost_date >= $1
       GROUP BY 1`,
      [desdeISO, lote]
    );
    for (const row of r.rows) out.set(row.rid, {
      custo_microsoft: Number(row.custo_microsoft || 0),
      custo_marketplace: Number(row.custo_marketplace || 0),
      dias: Number(row.dias),
    });
  }
  return out;
}

// Recebe a LISTA de assinaturas: 9 chamadas ao Resource Graph no total (uma por tipo de consulta)
// em vez de 9 por assinatura — com 51 assinaturas eram 459 chamadas, ~45s+ e várias pausas por 429.
async function _coletarDesperdicio(subscriptionIds, diasSnapshot) {
  const { getToken } = await _getInventarioSpConfig();
  const token = await getToken();

  const [discos, nics, ipsBrutos, ipsRefs, snapshots, asps, lbs, appgws, vms] = await Promise.all([
    _resourceGraphQuery(token, subscriptionIds, _KQL_DISCOS_ORFAOS),
    _resourceGraphQuery(token, subscriptionIds, _KQL_NICS_ORFAS),
    _resourceGraphQuery(token, subscriptionIds, _KQL_IPS_SOLTOS),
    _resourceGraphQuery(token, subscriptionIds, _KQL_IPS_REFERENCIADOS),
    _resourceGraphQuery(token, subscriptionIds, _kqlSnapshotsAntigos(diasSnapshot)),
    _resourceGraphQuery(token, subscriptionIds, _KQL_ASP_VAZIOS),
    _resourceGraphQuery(token, subscriptionIds, _KQL_LBS_SEM_BACKEND),
    _resourceGraphQuery(token, subscriptionIds, _KQL_APPGWS_SEM_BACKEND),
    _resourceGraphQuery(token, subscriptionIds, _KQL_VMS_PARADAS),
  ]);

  const referenciados = new Set(ipsRefs.map((x) => String(x.id || '').toUpperCase()).filter(Boolean));
  const ips = ipsBrutos.filter((x) => !referenciados.has(String(x.id || '').toUpperCase()));

  const brutos = [
    ...discos.map((x) => ({ ...x, categoria: 'disco_orfao' })),
    ...nics.map((x) => ({ ...x, categoria: 'nic_orfa' })),
    ...ips.map((x) => ({ ...x, categoria: 'ip_solto' })),
    ...snapshots.map((x) => ({ ...x, categoria: 'snapshot_antigo' })),
    ...asps.map((x) => ({ ...x, categoria: 'app_service_plan_vazio' })),
    ...lbs.map((x) => ({ ...x, categoria: 'lb_sem_backend' })),
    ...appgws.map((x) => ({ ...x, categoria: 'appgw_sem_backend' })),
    ...vms.map((x) => ({ ...x, categoria: 'vm_parada' })),
  ];

  // Exclui RG gerenciado por Databricks/AKS item a item — o `resourceGroup` já vem do ARG, então
  // não precisa de `_getRgsGerenciados()` (que leria de azure_recursos_inventario). Um disco
  // efêmero de nó de cluster não é desperdício, é o ciclo de vida normal do cluster.
  // Exceção: disco solto em RG de AKS (`MC_*`) é volume persistente (PVC) abandonado — disco de nó
  // fica anexado ao VMSS, então nunca aparece aqui. Databricks continua excluído (disco solto é transitório).
  const itens = brutos.filter((x) => {
    const tipo = _detectManagedRg(x.resourceGroup || '').managed_type;
    return !tipo || (tipo === 'aks' && x.categoria === 'disco_orfao');
  });

  const desde = new Date();
  desde.setDate(desde.getDate() - 30);
  const custos = await _custoObservadoPorResourceId(itens.map((x) => x.id), desde.toISOString().slice(0, 10));
  const impostoCfg = await _getImpostoConfig();

  return itens.map((x) => {
    const c = custos.get(String(x.id || '').toUpperCase());
    // Data real quando o Azure informa: disco = último desanexo; snapshot = criação. NIC/IP
    // não têm esse dado — o endpoint completa pela primeira detecção registrada.
    // Disco nunca anexado não tem LastOwnershipUpdateTime: órfão desde a criação.
    const desdeReal = x.categoria === 'disco_orfao' ? (x.orfaoDesde || x.criadoEm || null)
      : x.categoria === 'snapshot_antigo' ? (x.criadoEm || null) : null;
    // Custo com imposto (Microsoft/Marketplace, cada um só se ativo) aplicado aqui, ANTES de
    // dividir pelos dias — assim o multiplicador não se acumula na extrapolação mensal.
    const custoPeriodoComImposto = c ? _comImpostoSplit(c.custo_microsoft, c.custo_marketplace, impostoCfg) : null;
    // Extrapolação honesta NESTAS categorias: disco managed e IP Standard estático faturam a
    // mesma taxa anexados ou não, então o custo observado É o desperdício. Sem billing conhecido
    // → null, NUNCA zero (mesma convenção de `nao_verificaveis` no compliance de tags): zero
    // significaria "não custa nada", e o que sabemos é "não sabemos".
    const custoMensal = c && c.dias > 0 ? (custoPeriodoComImposto / c.dias) * 30 : null;
    return {
      categoria: x.categoria,
      subscription_id: String(x.id || '').split('/')[2] || null,
      resource_id: x.id,
      nome: x.name,
      resource_group: x.resourceGroup,
      location: x.location,
      sku: x.sku || null,
      tamanho_gb: x.sizeGB ?? null,
      criado_em: x.criadoEm || null,
      motivo_validacao: x.categoria === 'disco_orfao' ? _classificarDiscoValidacao(x) : null,
      custo_periodo: custoPeriodoComImposto,
      dias_observados: c ? c.dias : 0,
      custo_mensal_estimado: custoMensal,
      marcado_orfao_em: desdeReal,
      dias_orfao: null,
    };
  });
}

async function _getDesperdicioCached(subscriptionIds, diasSnapshot) {
  const chave = `${[...subscriptionIds].sort().join(',')}:${diasSnapshot}`;
  const cached = _desperdicioCache.get(chave);
  if (cached && (Date.now() - cached.ts) < _DESPERDICIO_TTL) return cached.itens;
  if (_desperdicioPromises.has(chave)) return _desperdicioPromises.get(chave);
  const p = (async () => {
    try {
      const itens = await _coletarDesperdicio(subscriptionIds, diasSnapshot);
      _desperdicioCache.set(chave, { itens, ts: Date.now() });
      return itens;
    } finally {
      _desperdicioPromises.delete(chave);
    }
  })();
  _desperdicioPromises.set(chave, p);
  return p;
}

app.get('/api/azure-inventario/desperdicio', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const t0Desp = Date.now();
    await ensureAzureColetaTable();
    const dias = Math.max(1, Math.min(3650, parseInt(req.query.dias_snapshot, 10) || 90));
    const { subscription_id } = req.query;
    const { subs } = await _getInventarioSpConfig();
    const alvos = subscription_id ? [String(subscription_id)] : subs;
    if (!alvos.length) return res.status(400).json({ error: 'Nenhuma subscription configurada no Inventário' });

    // Caminho rápido: todas as assinaturas numa chamada por tipo de consulta. Plano B, se a chamada
    // conjunta falhar (ex: uma assinatura com problema): assinatura por assinatura, e uma sem
    // permissão não derruba as outras (mesmo padrão do /advisor).
    const erros = [];
    let listas;
    try {
      listas = [await _getDesperdicioCached(alvos, dias)];
    } catch (e) {
      console.warn('[Desperdicio] Consulta conjunta falhou, usando modo por assinatura:', e.message);
      listas = await _mapLimit(alvos, 4, async (sid) => {
        try { return await _getDesperdicioCached([sid], dias); }
        catch (e2) { erros.push({ subscription_id: sid, erro: e2.message }); return []; }
      });
    }
    // Imposto (Microsoft/Marketplace) já aplicado em _coletarDesperdicio, na origem — não
    // reaplicar aqui (dobraria o multiplicador).
    const itens = listas.flat().map((x) => ({ ...x }));

    // Primeira detecção (1 query para todos). Se ficou >3 dias sem ser visto como órfão, o
    // recurso foi reaproveitado e depois abandonado de novo — reinicia a contagem.
    if (itens.length) {
      const up = await pool.query(
        `INSERT INTO azure_desperdicio_deteccao (resource_id_upper, categoria)
         SELECT DISTINCT ON (UPPER(u.id)) UPPER(u.id), u.cat FROM unnest($1::text[], $2::text[]) AS u(id, cat)
         ON CONFLICT (resource_id_upper) DO UPDATE SET
           primeira_deteccao_em = CASE WHEN azure_desperdicio_deteccao.ultima_deteccao_em < NOW() - INTERVAL '3 days' THEN NOW() ELSE azure_desperdicio_deteccao.primeira_deteccao_em END,
           ultima_deteccao_em = NOW(), categoria = EXCLUDED.categoria
         RETURNING resource_id_upper, primeira_deteccao_em`,
        [itens.map((x) => x.resource_id), itens.map((x) => x.categoria)]
      );
      const primeira = new Map(up.rows.map((r) => [r.resource_id_upper, r.primeira_deteccao_em]));
      for (const it of itens) {
        const desde = it.marcado_orfao_em || primeira.get(String(it.resource_id).toUpperCase());
        it.marcado_orfao_em = desde ? new Date(desde).toISOString() : null;
        it.dias_orfao = desde ? Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 86400000)) : null;
      }
    }

    const porCategoria = {};
    for (const it of itens) {
      const c = (porCategoria[it.categoria] ||= { categoria: it.categoria, itens: 0, custo_mensal_estimado: 0, sem_custo_conhecido: 0 });
      c.itens++;
      if (it.custo_mensal_estimado === null) c.sem_custo_conhecido++;
      else c.custo_mensal_estimado += it.custo_mensal_estimado;
    }

    itens.sort((a, b) => (b.custo_mensal_estimado || 0) - (a.custo_mensal_estimado || 0));
    console.log(`[Desperdicio] ${itens.length} itens de ${alvos.length} assinatura(s) em ${Date.now() - t0Desp} ms`);
    res.json({
      gerado_em: new Date().toISOString(),
      dias_snapshot: dias,
      total_itens: itens.length,
      custo_mensal_estimado_total: itens.reduce((a, x) => a + (x.custo_mensal_estimado || 0), 0),
      sem_custo_conhecido: itens.filter((x) => x.custo_mensal_estimado === null).length,
      por_categoria: Object.values(porCategoria).sort((a, b) => b.custo_mensal_estimado - a.custo_mensal_estimado),
      itens,
      erros,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Exportar Desperdício pra Excel — mesmo layout do Excel de Ações FinOps (GET /api/export/excel):
// banner roxo, aba "Sumário Executivo" e aba de detalhes. Recebe os itens já filtrados na tela
// (o que o usuário vê é o que sai no arquivo).
const _DESP_LABEL_XLSX = {
  disco_orfao: 'Disco não anexado', snapshot_antigo: 'Snapshot antigo', ip_solto: 'IP público sem uso',
  nic_orfa: 'NIC não anexada', app_service_plan_vazio: 'App Service Plan sem apps',
  lb_sem_backend: 'Load Balancer sem backend', appgw_sem_backend: 'App Gateway sem backend',
  vm_parada: 'VM parada (sem desalocar)',
};
app.post('/api/azure-inventario/desperdicio/export/excel', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const body = req.body || {};
    if (!Array.isArray(body.itens)) return res.status(400).json({ error: 'Lista de itens inválida' });
    const txt = (v) => (v == null ? '' : String(v).slice(0, 2000));
    const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const itens = body.itens.slice(0, 50000).map((x) => ({
      categoria: txt(x.categoria), subscription_id: txt(x.subscription_id), resource_id: txt(x.resource_id),
      nome: txt(x.nome), resource_group: txt(x.resource_group), location: txt(x.location), sku: txt(x.sku),
      tamanho_gb: num(x.tamanho_gb), custo_mensal_estimado: x.custo_mensal_estimado === null ? null : num(x.custo_mensal_estimado),
      dias_orfao: num(x.dias_orfao), marcado_orfao_em: x.marcado_orfao_em ? new Date(x.marcado_orfao_em) : null,
    }));
    const filtrosTxt = txt(body.filtros_descricao) || 'Sem filtros';

    const subsRow = await pool.query(`SELECT subscription_id, subscription_name FROM azure_subs_cache`);
    const subsMap = new Map(subsRow.rows.map((s) => [s.subscription_id, s.subscription_name]));

    const GREEN_DARK = '4A0080', GREEN_MAIN = '7B2FBE', GREEN_LIGHT = 'F3E8FF', GREEN_TOTAL = '9333EA';
    const NAVY = 'FF1B2A4A', GRAY_BDR = 'FFE0D4F5';
    const BRL_FMT = '"R$ "#,##0.00', PCT_FMT = '0.0%';
    const hoje = new Date();
    const hojeStr = hoje.toLocaleDateString('pt-BR') + ' às ' + hoje.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const periodo = String(hoje.getFullYear());
    const hFill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } });
    const hFont = (bold, color, size, italic) => ({ bold: !!bold, color: { argb: color || NAVY }, size: size || 9, italic: !!italic, name: 'Arial' });
    const hAlign = (h, v, wrap) => ({ horizontal: h || 'left', vertical: v || 'middle', wrapText: !!wrap });
    const hBorder = (color) => { const s = { style: 'thin', color: { argb: color || GRAY_BDR } }; return { left: s, right: s, top: s, bottom: s }; };
    const styleCell = (cell, { fill, font, alignment, border, numFmt } = {}) => {
      if (fill) cell.fill = fill; if (font) cell.font = font; if (alignment) cell.alignment = alignment;
      if (border) cell.border = border; if (numFmt) cell.numFmt = numFmt;
    };
    const headerRow = (ws, rowNum, headers, bg) => {
      const row = ws.getRow(rowNum); row.height = 18;
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1); cell.value = h;
        styleCell(cell, { fill: hFill(bg || GREEN_MAIN), font: hFont(true, 'FFFFFFFF', 9), alignment: hAlign('center'), border: hBorder('FF' + GREEN_DARK) });
      });
    };
    const dataStyle = (ws, rowNum, ncols, shade) => {
      const row = ws.getRow(rowNum); row.height = 16;
      for (let i = 1; i <= ncols; i++) styleCell(row.getCell(i), { fill: hFill(shade ? GREEN_LIGHT : 'FFFFFF'), font: hFont(false, NAVY, 9), alignment: hAlign('left'), border: hBorder() });
    };
    const writeHeaderBlock = (ws, title, subtitle, ncols) => {
      ws.mergeCells(1, 1, 2, ncols);
      const c1 = ws.getCell(1, 1); c1.value = '  FinOps Manager   |   ' + title;
      styleCell(c1, { fill: hFill(GREEN_DARK), font: hFont(true, 'FFFFFFFF', 13), alignment: hAlign('left', 'middle') });
      ws.getRow(1).height = 28; ws.getRow(2).height = 6;
      ws.mergeCells(3, 1, 3, ncols); ws.getCell(3, 1).fill = hFill(GREEN_MAIN); ws.getRow(3).height = 4;
      ws.mergeCells(4, 1, 4, ncols);
      const c4 = ws.getCell(4, 1); c4.value = '  ' + subtitle;
      styleCell(c4, { fill: hFill('FFFFFF'), font: hFont(false, 'FF5B2080', 9, true), alignment: hAlign('left', 'middle') });
      ws.getRow(4).height = 16;
      ws.mergeCells(5, 1, 5, ncols); ws.getRow(5).height = 6;
      return 6;
    };
    const sectionTitle = (ws, r, ncols, t) => {
      ws.mergeCells(r, 1, r, ncols);
      const c = ws.getCell(r, 1); c.value = t;
      styleCell(c, { fill: hFill(GREEN_DARK), font: hFont(true, 'FFFFFFFF', 10), alignment: hAlign('left', 'middle') });
      ws.getRow(r).height = 20;
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FinOps Manager'; wb.created = hoje;

    const custoTotal = itens.reduce((a, i) => a + (i.custo_mensal_estimado || 0), 0);
    const semCusto = itens.filter((i) => i.custo_mensal_estimado === null).length;

    // ── ABA 1: SUMÁRIO EXECUTIVO ──
    const ws1 = wb.addWorksheet('Sumário Executivo');
    ws1.views = [{ showGridLines: false }];
    const N1 = 4;
    let r = writeHeaderBlock(ws1, `Desperdício de Recursos — ${periodo}`, `Gerado em: ${hojeStr}   |   Recursos ociosos: ${itens.length}   |   Filtros: ${filtrosTxt}`, N1);
    sectionTitle(ws1, r, N1, 'VISÃO GERAL DO DESPERDÍCIO'); r++;
    headerRow(ws1, r, ['Indicador', 'Valor', '', '']); r++;
    [['Recursos ociosos', itens.length, null], ['Desperdício estimado por mês (R$)', custoTotal, BRL_FMT],
     ['Projeção anual (R$)', custoTotal * 12, BRL_FMT], ['Recursos sem billing conhecido', semCusto, null]].forEach(([k, v, fmt], idx) => {
      dataStyle(ws1, r, N1, idx % 2 === 1);
      ws1.getRow(r).getCell(1).value = k;
      ws1.getRow(r).getCell(2).value = v;
      styleCell(ws1.getRow(r).getCell(2), { alignment: hAlign('right'), numFmt: fmt || '0' });
      r++;
    });
    r++;
    sectionTitle(ws1, r, N1, 'DESPERDÍCIO POR TIPO DE RECURSO'); r++;
    headerRow(ws1, r, ['Tipo de recurso', 'Qtd', '% do custo', 'Custo/mês (R$)'], GREEN_TOTAL); r++;
    const porTipo = {};
    for (const i of itens) { const t = (porTipo[i.categoria] ||= { qtd: 0, custo: 0 }); t.qtd++; t.custo += i.custo_mensal_estimado || 0; }
    Object.entries(porTipo).sort((a, b) => b[1].custo - a[1].custo).forEach(([cat, v], idx) => {
      dataStyle(ws1, r, N1, idx % 2 === 1);
      const row = ws1.getRow(r);
      row.getCell(1).value = _DESP_LABEL_XLSX[cat] || cat;
      row.getCell(2).value = v.qtd; styleCell(row.getCell(2), { alignment: hAlign('center') });
      row.getCell(3).value = custoTotal > 0 ? v.custo / custoTotal : 0; styleCell(row.getCell(3), { alignment: hAlign('center'), numFmt: PCT_FMT });
      row.getCell(4).value = v.custo; styleCell(row.getCell(4), { alignment: hAlign('right'), numFmt: BRL_FMT });
      r++;
    });
    ws1.getRow(r).height = 18;
    for (let i = 1; i <= N1; i++) styleCell(ws1.getRow(r).getCell(i), { fill: hFill(GREEN_TOTAL), font: hFont(true, 'FFFFFFFF', 9), alignment: hAlign('center'), border: hBorder('FF' + GREEN_DARK) });
    ws1.getRow(r).getCell(1).value = 'TOTAL'; ws1.getRow(r).getCell(1).alignment = hAlign('left', 'middle');
    ws1.getRow(r).getCell(2).value = itens.length;
    ws1.getRow(r).getCell(3).value = 1; styleCell(ws1.getRow(r).getCell(3), { numFmt: PCT_FMT });
    ws1.getRow(r).getCell(4).value = custoTotal; styleCell(ws1.getRow(r).getCell(4), { numFmt: BRL_FMT, alignment: hAlign('right') });
    [38, 16, 14, 22].forEach((w, i) => { ws1.getColumn(i + 1).width = w; });

    // ── ABA 2: RECURSOS DETALHADOS ──
    const ws2 = wb.addWorksheet('Recursos Detalhados');
    const hdrs2 = ['Assinatura', 'Resource Group', 'Recurso', 'Tipo', 'SKU', 'Tamanho (GB)', 'Localização', 'Custo/mês (R$)', 'Dias órfão', 'Órfão desde', 'Resource ID'];
    const N2 = hdrs2.length;
    let r2 = writeHeaderBlock(ws2, `Recursos Ociosos — ${periodo}`, `Gerado em: ${hojeStr}`, N2);
    headerRow(ws2, r2, hdrs2); r2++;
    itens.forEach((it, idx) => {
      dataStyle(ws2, r2, N2, idx % 2 === 1);
      const row = ws2.getRow(r2);
      [subsMap.get(it.subscription_id) || it.subscription_id, it.resource_group || '—', it.nome || it.resource_id,
       _DESP_LABEL_XLSX[it.categoria] || it.categoria, it.sku || '—', it.tamanho_gb, it.location || '—',
       it.custo_mensal_estimado, it.dias_orfao, it.marcado_orfao_em, it.resource_id].forEach((v, i) => { row.getCell(i + 1).value = v === null ? '—' : v; });
      styleCell(row.getCell(6), { alignment: hAlign('right') });
      styleCell(row.getCell(8), { alignment: hAlign('right'), numFmt: BRL_FMT });
      styleCell(row.getCell(9), { alignment: hAlign('center') });
      styleCell(row.getCell(10), { alignment: hAlign('center'), numFmt: 'dd/mm/yyyy' });
      r2++;
    });
    ws2.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(r2 - 1, 6), column: N2 } };
    ws2.views = [{ showGridLines: false, state: 'frozen', ySplit: 6, xSplit: 0, activeCell: 'A7' }];
    [26, 34, 38, 28, 16, 13, 16, 18, 11, 13, 60].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="FinOps_Desperdicio_${hoje.toISOString().split('T')[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[Excel Desperdício] erro:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar Excel: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE PRINCIPALS — CRUD (credenciais de autenticação para Storage)
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/azure-coleta/sps', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT id,nome,tenant_id,client_id,ativo,is_padrao,expiracao_secret,billing_account_id,billing_profile_id,modo_coleta,subscription_ids,granularidade_dias,dia_execucao,hora_execucao,dias_semana,auto_coleta,proxima_coleta,atualizado_em FROM azure_coleta_config ORDER BY is_padrao DESC, id ASC`);
    res.json(r.rows.map(row => ({
      ...row,
      tenant_id:          _safeDecrypt(row.tenant_id),
      client_id:          _safeDecrypt(row.client_id),
      billing_account_id: row.billing_account_id ? _safeDecrypt(row.billing_account_id) : '',
      billing_profile_id: row.billing_profile_id ? _safeDecrypt(row.billing_profile_id) : '',
    })));
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/sps', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, tenant_id, client_id, client_secret, ativo, expiracao_secret, billing_account_id, billing_profile_id, modo_coleta, subscription_ids, dia_execucao, granularidade_dias } = req.body;
    await ensureAzureColetaTable();
    const tE   = tenant_id?.trim()         ? _encryptSecret(tenant_id.trim())         : '';
    const cE   = client_id?.trim()          ? _encryptSecret(client_id.trim())          : '';
    const sE   = client_secret?.trim()      ? _encryptSecret(client_secret.trim())      : '';
    const baE  = billing_account_id?.trim() ? _encryptSecret(billing_account_id.trim()) : null;
    const bpE  = billing_profile_id?.trim() ? _encryptSecret(billing_profile_id.trim()) : null;
    const diaE = dia_execucao       != null ? Math.max(1, Math.min(28, parseInt(dia_execucao) || 5))  : 5;
    const granE= granularidade_dias != null ? Math.max(1, parseInt(granularidade_dias) || 7)           : 7;
    const modoE = ['billing_profile','subscription'].includes(modo_coleta) ? modo_coleta : 'billing_profile';
    const subsE = subscription_ids?.trim() || null;
    await pool.query(
      `INSERT INTO azure_coleta_config(nome,tenant_id,client_id,client_secret,ativo,expiracao_secret,billing_account_id,billing_profile_id,modo_coleta,subscription_ids,dia_execucao,granularidade_dias) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [nome || 'Nova SP', tE, cE, sE, ativo ?? true, expiracao_secret || null, baE, bpE, modoE, subsE, diaE, granE]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.put('/api/azure-coleta/sps/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, tenant_id, client_id, client_secret, ativo, expiracao_secret, billing_account_id, billing_profile_id, modo_coleta, subscription_ids, dia_execucao, granularidade_dias } = req.body;
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
    const modoE = ['billing_profile','subscription'].includes(modo_coleta) ? modo_coleta : 'billing_profile';
    const subsE = subscription_ids?.trim() || null;
    await pool.query(
      `UPDATE azure_coleta_config SET nome=$1,tenant_id=$2,client_id=$3,client_secret=$4,ativo=$5,expiracao_secret=$6,billing_account_id=$7,billing_profile_id=$8,modo_coleta=$9,subscription_ids=$10,dia_execucao=$11,granularidade_dias=$12,atualizado_em=NOW() WHERE id=$13`,
      [nome || 'SP', tE, cE, sE, ativo ?? true, expiracao_secret || null, baE, bpE, modoE, subsE, diaE, granE, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Atualização parcial segura — só altera os campos explicitamente enviados
app.patch('/api/azure-coleta/sps/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const allowed = { subscription_ids: v => v?.trim() || null, granularidade_dias: v => v != null ? Math.max(1, parseInt(v) || 7) : null, modo_coleta: v => ['billing_profile','subscription'].includes(v) ? v : null };
    const sets = []; const vals = [];
    for (const [k, fn] of Object.entries(allowed)) {
      if (k in req.body) { const v = fn(req.body[k]); if (v !== null || k === 'subscription_ids') { sets.push(`${k}=$${vals.length+1}`); vals.push(v); } }
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    await pool.query(`UPDATE azure_coleta_config SET ${sets.join(',')},atualizado_em=NOW() WHERE id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
});

// Define esta SP como padrão (única por vez) — limpa is_padrao das outras
app.patch('/api/azure-coleta/sps/:id/padrao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`UPDATE azure_coleta_config SET is_padrao=false`);
    await pool.query(`UPDATE azure_coleta_config SET is_padrao=true,atualizado_em=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-coleta/sps/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
});

// Lista subscriptions de uma SP (para wizard de coleta)
// Endpoint de preview — aceita credenciais no body (nova SP ainda não salva)
app.post('/api/azure-coleta/listar-subs-preview', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { tenant_id, client_id, client_secret } = req.body;
    if (!tenant_id?.trim() || !client_id?.trim() || !client_secret?.trim())
      return res.status(400).json({ error: 'tenant_id, client_id e client_secret são obrigatórios' });
    const { token } = await _managementGetToken(tenant_id.trim(), client_id.trim(), client_secret.trim());
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
        return res.json({ subs, fonte: 'tenant' });
      }
    } catch (_) {}
    // Fallback: cache local
    const cached = await pool.query(
      `SELECT subscription_id, subscription_name FROM azure_subs_cache ORDER BY subscription_name`
    );
    const subs = cached.rows.map(r => ({ subscriptionId: r.subscription_id, nome: r.subscription_name || r.subscription_id }));
    res.json({ subs, fonte: 'cache' });
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/sps/:id/listar-subs', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'SP não encontrada' });
    const cfg = r.rows[0];
    const { token } = await _managementGetToken(
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
  } catch (e) { _dbErr(res, e); }
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
      const { token } = await _managementGetToken(
        _safeDecrypt(cfg.tenant_id), _safeDecrypt(cfg.client_id), _safeDecrypt(cfg.client_secret)
      );
      // Paralelo: busca RGs de todas as subs simultaneamente
      const results = await _mapLimitSettled(subscription_ids, 6, async subId => {
        const subRgs = [];
        let url = `https://management.azure.com/subscriptions/${subId}/resourcegroups?api-version=2021-04-01&$top=1000`;
        while (url) {
          const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
          if (!resp.ok) break;
          const data = await _safeRespJson(resp);
          for (const rg of (data.value || [])) subRgs.push({ subscriptionId: subId, name: rg.name });
          url = data.nextLink || null;
        }
        return subRgs;
      });
      const rgs = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      if (rgs.length > 0) return res.json({ rgs, fonte: 'arm' });
    } catch (_) {}

    // Fallback: cache local (normaliza para lowercase para evitar mismatch de case)
    const lowerIds = subscription_ids.map(id => (id || '').toLowerCase().trim());
    const ph = lowerIds.map((_, i) => `$${i + 1}`).join(',');
    const cached = await pool.query(
      `SELECT subscription_id, COALESCE(resource_group_name, resource_group_name_upper) AS name FROM azure_rg_cache WHERE LOWER(subscription_id) IN (${ph}) ORDER BY subscription_id, name`,
      lowerIds
    );
    res.json({ rgs: cached.rows.map(r => ({ subscriptionId: r.subscription_id, name: r.name })), fonte: cached.rowCount > 0 ? 'cache' : 'empty' });
  } catch (e) { _dbErr(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLETA DATABRICKS — CONFIGURAÇÃO DA API (FASE 1)
// ══════════════════════════════════════════════════════════════════════════════
// Fase 1: só CRUD de credenciais + teste de conexão. A coleta agendada de verdade
// (contra system.billing.usage/system.billing.list_prices, pra ter custo por usuário e
// free-tier vs. pago — dado que azure_costs nunca vai ter isso, confirmado nesta sessão)
// é Fase 2 — ver CLAUDE.md "Coleta Databricks". Reaproveita _encryptSecret/_safeDecrypt
// (mesma cifra AES-256-GCM já usada pras credenciais Azure) — zero cripto nova.
//
// Fetch próprio, NÃO usa _cbFetch: aquele helper está acoplado ao circuit breaker
// global do Azure (_cbAPI/_cbCanAttempt) — reusar significaria falhas do Databricks
// abrindo o circuito e bloqueando chamadas Azure não relacionadas (e vice-versa). Sem
// retry/circuit breaker próprio por enquanto — Fase 1 só faz teste de conexão pontual,
// não um job agendado recorrente (que precisaria de um breaker dedicado na Fase 2).
async function _dbxFetch(url, options = {}, timeoutMs = 30000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// Troca client_id/client_secret por um access token via OAuth 2.0 client_credentials —
// Service Principal de conta (account-level), mesmo padrão que _managementGetToken faz
// pro Azure. NÃO VALIDADO contra uma conta Databricks real neste ambiente (sem
// credenciais disponíveis) — ajustar endpoint/scope aqui se necessário ao testar com uma
// conta real pela primeira vez.
async function _databricksGetToken(accountId, clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await _dbxFetch(`https://accounts.azuredatabricks.net/oidc/accounts/${accountId}/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }).toString(),
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Databricks falhou (${resp.status}): ${e}`); }
  const tkData = await _safeRespJson(resp);
  if (!tkData.access_token) throw new Error('Token Databricks: resposta sem access_token');
  return { token: tkData.access_token, expiresIn: tkData.expires_in || 3600 };
}

// Executa uma query SQL via Statement Execution API contra o warehouse configurado —
// usado pelo teste de conexão (SELECT 1) e, na Fase 2, pelas queries reais de billing e
// execuções de Job. `parameters` — array de {name, value, type} — usa placeholders `:nome`
// na SQL em vez de concatenar valores direto na string, mesma prática de parametrização já
// usada em toda query Postgres deste arquivo (aqui obrigatório mesmo pra um sistema
// externo: a Fase 2 passa datas vindas do agendador OU de um gatilho manual via API, nunca
// confiar em concatenação de string pra isso).
//
// Bug real encontrado e corrigido (2026-08-29, auditoria pedida pelo usuário contra a
// documentação oficial): `wait_timeout: '30s'` + `_parseDatabricksResult` lançando erro
// pra qualquer `status.state` != 'SUCCEEDED' significava que uma query que não terminasse
// dentro de 30s (SQL Warehouse frio começando do zero — cold start documentado como
// levando de dezenas de segundos a poucos minutos —, ou um scan grande de
// system.billing.usage num período longo) derrubava a coleta inteira com "não concluiu",
// mesmo a query estando genuinamente ainda em execução no lado do Databricks (o parâmetro
// default do endpoint é justamente deixar a query rodando em background quando o timeout
// de espera é atingido — `on_wait_timeout: 'CONTINUE'`, comportamento padrão da API). A
// documentação oficial (docs.databricks.com/api/workspace/statementexecution) confirma
// `GET /api/2.0/sql/statements/{statement_id}` como o endpoint de polling — mesma forma de
// resposta (status/manifest/result) do POST inicial. Corrigido: `wait_timeout` no máximo
// permitido pela API ('50s', faixa válida é 0 ou 5-50) pra minimizar quantas vezes o
// polling é sequer necessário, e polling de verdade (a cada 3s, até 5 min) quando o estado
// inicial vem `PENDING`/`RUNNING` em vez de tratar isso como falha.
const _DBX_POLL_INTERVAL_MS = 3000;
const _DBX_POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function _databricksRunQuery(workspaceHost, warehouseId, token, sql, parameters = []) {
  const host = (workspaceHost || '').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const resp = await _dbxFetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: '50s', parameters }),
  }, 55000);
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Query Databricks falhou (${resp.status}): ${e}`); }
  let result = await _safeRespJson(resp);

  const inicio = Date.now();
  while (['PENDING', 'RUNNING'].includes(result?.status?.state) && Date.now() - inicio < _DBX_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, _DBX_POLL_INTERVAL_MS));
    const pollResp = await _dbxFetch(`${host}/api/2.0/sql/statements/${result.statement_id}`, { headers }, 15000);
    if (!pollResp.ok) { const e = await pollResp.text(); throw new Error(`Consulta de status da query Databricks falhou (${pollResp.status}): ${e}`); }
    result = await _safeRespJson(pollResp);
  }
  return result;
}

// Converte a resposta da Statement Execution API (colunas + linhas em array) em objetos
// nomeados — NÃO VALIDADO contra uma resposta real (ver nota em _databricksGetToken).
function _parseDatabricksResult(result) {
  const state = result?.status?.state;
  if (state !== 'SUCCEEDED') {
    const aindaRodando = state === 'PENDING' || state === 'RUNNING';
    const motivo = aindaRodando
      ? 'query ainda em execução após 5 minutos de espera (SQL Warehouse pode estar sobrecarregado, ou o período selecionado é grande demais) — tente novamente ou reduza o intervalo de datas'
      : (result?.status?.error?.message || 'sem detalhes retornados pela API');
    throw new Error(`Query Databricks não concluiu (status: ${state || 'desconhecido'}) — ${motivo}`);
  }
  const cols = (result.manifest?.schema?.columns || []).map(c => c.name);
  const rows = result.result?.data_array || [];
  return rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// Resolve o bearer token a usar contra a Statement Execution API, de acordo com
// cfg.modo_auth — pedido do usuário (2026-08-26): alternativa mais simples ao OAuth
// M2M pra quem não tem acesso de account admin pra criar um Service Principal na
// conta Databricks (só precisa de workspace_host + warehouse_id + um Personal Access
// Token gerado pelo próprio usuário em User Settings → Developer → Access tokens, ou
// por um Service Principal a nível de workspace). PAT não precisa de troca de token —
// usado direto como Bearer. `cfg` é a linha crua de databricks_coleta_config (campos
// sensíveis ainda cifrados, decifrados aqui).
async function _resolveDbxToken(cfg) {
  if (cfg.modo_auth === 'pat') {
    const token = _safeDecrypt(cfg.token);
    if (!token) throw new Error('Token PAT não configurado para esta conexão');
    return token;
  }
  const accountId = _safeDecrypt(cfg.account_id);
  const clientId  = _safeDecrypt(cfg.client_id);
  const secret    = _safeDecrypt(cfg.client_secret);
  const { token } = await _databricksGetToken(accountId, clientId, secret);
  return token;
}

app.get('/api/databricks-coleta/config', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT id,nome,modo_auth,account_id,client_id,workspace_host,warehouse_id,ativo,is_padrao,granularidade_dias,dia_execucao,hora_execucao,dias_semana,auto_coleta,proxima_coleta,atualizado_em FROM databricks_coleta_config ORDER BY is_padrao DESC, id ASC`);
    res.json(r.rows.map(row => ({
      ...row,
      account_id: _safeDecrypt(row.account_id),
      client_id:  _safeDecrypt(row.client_id),
      // client_secret/token nunca voltam do GET (mesmo padrão de credenciais Azure/SMTP)
    })));
  } catch (e) { _dbErr(res, e); }
});

// modo_auth='oauth_m2m' (padrão) exige account_id/client_id/client_secret; modo_auth='pat'
// exige só token (Personal Access Token — ver _resolveDbxToken). workspace_host/
// warehouse_id são obrigatórios nos dois modos.
app.post('/api/databricks-coleta/config', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, modo_auth, account_id, client_id, client_secret, token, workspace_host, warehouse_id, ativo } = req.body;
    const modo = modo_auth === 'pat' ? 'pat' : 'oauth_m2m';
    if (!workspace_host?.trim() || !warehouse_id?.trim())
      return res.status(400).json({ error: 'workspace_host e warehouse_id são obrigatórios' });
    if (modo === 'pat' && !token?.trim())
      return res.status(400).json({ error: 'token é obrigatório no modo Personal Access Token' });
    if (modo === 'oauth_m2m' && (!account_id?.trim() || !client_id?.trim() || !client_secret?.trim()))
      return res.status(400).json({ error: 'account_id, client_id e client_secret são obrigatórios no modo OAuth M2M' });
    await ensureAzureColetaTable();
    const aE = account_id?.trim() ? _encryptSecret(account_id.trim()) : null;
    const cE = client_id?.trim() ? _encryptSecret(client_id.trim()) : null;
    const sE = client_secret?.trim() ? _encryptSecret(client_secret.trim()) : null;
    const tE = token?.trim() ? _encryptSecret(token.trim()) : null;
    await pool.query(
      `INSERT INTO databricks_coleta_config(nome,modo_auth,account_id,client_id,client_secret,token,workspace_host,warehouse_id,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [nome || 'Databricks Principal', modo, aE, cE, sE, tE, workspace_host.trim(), warehouse_id.trim(), ativo ?? true]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.put('/api/databricks-coleta/config/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, modo_auth, account_id, client_id, client_secret, token, workspace_host, warehouse_id, ativo } = req.body;
    const modo = modo_auth === 'pat' ? 'pat' : 'oauth_m2m';
    if (!workspace_host?.trim() || !warehouse_id?.trim())
      return res.status(400).json({ error: 'workspace_host e warehouse_id são obrigatórios' });
    if (modo === 'oauth_m2m' && (!account_id?.trim() || !client_id?.trim()))
      return res.status(400).json({ error: 'account_id e client_id são obrigatórios no modo OAuth M2M' });
    const ex = await pool.query(`SELECT client_secret, token FROM databricks_coleta_config WHERE id=$1`, [req.params.id]);
    if (!ex.rows.length) return res.status(404).json({ error: 'Configuração não encontrada' });
    if (modo === 'pat' && !token?.trim() && !ex.rows[0].token)
      return res.status(400).json({ error: 'token é obrigatório no modo Personal Access Token' });
    // client_secret/token vazios no body = manter o valor já salvo (mesmo padrão de
    // "opcional, mantém o atual se vazio" já usado pra client_secret antes desta mudança)
    let sE = ex.rows[0].client_secret || null;
    if (client_secret?.trim()) sE = _encryptSecret(client_secret.trim());
    let tE = ex.rows[0].token || null;
    if (token?.trim()) tE = _encryptSecret(token.trim());
    const aE = account_id?.trim() ? _encryptSecret(account_id.trim()) : null;
    const cE = client_id?.trim() ? _encryptSecret(client_id.trim()) : null;
    await pool.query(
      `UPDATE databricks_coleta_config SET nome=$1,modo_auth=$2,account_id=$3,client_id=$4,client_secret=$5,token=$6,workspace_host=$7,warehouse_id=$8,ativo=$9,atualizado_em=NOW() WHERE id=$10`,
      [nome || 'Databricks', modo, aE, cE, sE, tE, workspace_host.trim(), warehouse_id.trim(), ativo ?? true, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.patch('/api/databricks-coleta/config/:id/ativo', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { ativo } = req.body;
    await pool.query(`UPDATE databricks_coleta_config SET ativo=$1,atualizado_em=NOW() WHERE id=$2`, [!!ativo, req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.patch('/api/databricks-coleta/config/:id/padrao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`UPDATE databricks_coleta_config SET is_padrao=false`);
    await pool.query(`UPDATE databricks_coleta_config SET is_padrao=true,atualizado_em=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/databricks-coleta/config/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM databricks_coleta_config WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// System Tables exigidas pela coleta (system.billing.usage/system.billing.list_prices) —
// no Databricks, o schema `system` inteiro (e cada subschema, como `billing`) precisa ser
// EXPLICITAMENTE habilitado por um account admin (Catalog Explorer → System Tables), e o
// Service Principal precisa de USE SCHEMA + SELECT nessas tabelas. Nomes fixos (não vêm do
// request), então interpolar na query é seguro — não é entrada de usuário.
const _DBX_REQUIRED_TABLES = ['system.billing.usage', 'system.billing.list_prices'];
// System Tables da feature de tempo+custo de execução de Job (2026-08-29) — schema
// `system.lakeflow` é habilitado separadamente de `system.billing` por um account admin
// (Catalog Explorer → System Tables tem uma entrada própria pra "Job runtime" /lakeflow).
// Tratadas como OPCIONAIS (não derrubam "Conexão OK" se ausentes) — billing/custo por
// recurso (Fases 1-3, já em produção) não depende delas; só o card de "Execuções de Job"
// (duração + status) fica vazio sem esse schema habilitado.
// 2026-08-29: 4 grupos novos, cada um pra uma feature de "Controle de Custos" separada
// (Utilização de Cluster, Custo por Query, AI Gateway, Otimização de Storage) — todos
// opcionais pelo mesmo motivo de system.lakeflow (schema próprio, habilitado à parte por
// um account admin, nunca derruba billing/custo por recurso se ausente).
const _DBX_OPTIONAL_TABLES = [
  'system.lakeflow.job_run_timeline', 'system.lakeflow.jobs',
  'system.compute.node_timeline', 'system.compute.clusters',
  'system.query.history',
  'system.ai_gateway.usage',
  'system.storage.predictive_optimization_operations_history',
];

// Diagnóstico — a mensagem de erro É o propósito da rota (mesmo padrão de
// POST /api/azure-coleta/sps/:id/testar), não genericizar com _dbErr aqui.
// Além de autenticar e validar o SQL Warehouse, testa CADA System Table exigida
// individualmente — "Testar Conexão" sozinho (SELECT 1) só prova que o warehouse
// responde, não que o schema `system.billing` está habilitado na conta nem que o
// Service Principal tem grant nele; sem esse detalhamento, um erro de permissão nas
// tabelas só apareceria na primeira coleta agendada de verdade, sem diagnóstico claro.
app.post('/api/databricks-coleta/config/:id/testar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM databricks_coleta_config WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Configuração não encontrada' });
    const cfg = r.rows[0];
    const token = await _resolveDbxToken(cfg);
    await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, 'SELECT 1');

    const tabelas = {};
    let todasOk = true;
    for (const tabela of _DBX_REQUIRED_TABLES) {
      try {
        await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, `SELECT 1 FROM ${tabela} LIMIT 1`);
        tabelas[tabela] = { ok: true, message: 'Acessível.' };
      } catch (eTab) {
        todasOk = false;
        tabelas[tabela] = { ok: false, message: eTab.message };
      }
    }

    const tabelasOpcionais = {};
    for (const tabela of _DBX_OPTIONAL_TABLES) {
      try {
        await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, `SELECT 1 FROM ${tabela} LIMIT 1`);
        tabelasOpcionais[tabela] = { ok: true, message: 'Acessível.' };
      } catch (eTab) {
        tabelasOpcionais[tabela] = { ok: false, message: eTab.message };
      }
    }
    const opcionaisOk = Object.values(tabelasOpcionais).every(t => t.ok);

    res.json({
      ok: todasOk,
      message: todasOk
        ? 'Conexão com Databricks OK — autenticação, SQL Warehouse e System Tables validados.'
        : 'Autenticação e SQL Warehouse OK, mas uma ou mais System Tables não estão acessíveis — veja detalhes.',
      tabelas,
      tabelas_opcionais: tabelasOpcionais,
      opcionais_ok: opcionaisOk,
      opcionais_aviso: opcionaisOk
        ? null
        : 'Duração/status de execuções de Job (system.lakeflow) não disponível — schema não habilitado ou sem grant. Custo por recurso continua funcionando normalmente.',
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Fase 2: coleta real contra system.billing.usage/system.billing.list_prices ──
// Uma linha por recurso individual (workspace, sku, produto, dia, usuário, recurso_hash)
// — granularidade que azure_costs nunca vai ter (sem identidade de usuário nem SKU
// nativo do Databricks). NÃO VALIDADO contra uma conta Databricks real neste ambiente —
// mesma ressalva de _databricksGetToken/_databricksRunQuery. A sintaxe de acesso aos
// campos STRUCT (identity_metadata.run_as, pricing.effective_list.default — este último
// confirmado 2026-08-29 contra a query de exemplo oficial da Databricks pra "Total Dollar
// Cost", ver nota na query abaixo) e os nomes exatos de coluna podem precisar de ajuste na
// primeira execução real.
// Grava `linhas` (mesmo shape nos dois chamadores — ver _executarColetaDatabricks e
// _processarImportDatabricks: workspace_id/sku_name/produto_origem/usage_date/
// usage_unit/usage_quantity/usuario/preco_unitario/custo_estimado/usage_metadata_json/
// custom_tags_json) em databricks_consumo e finaliza o registro de histórico —
// extraído (2026-08-27) pra ser compartilhado entre a coleta ao vivo (via API) e a
// importação manual (via CSV), sem duplicar upsert/hash/validação/notificação.
async function _processarLinhasDatabricks(histId, configId, origem, periodoInicio, periodoFim, linhas, msgFinal) {
  let totalIns = 0, totalUpd = 0, totalErr = 0;
  for (const l of linhas) {
    try {
      // recurso_hash — identifica um recurso individual (cluster/job/warehouse) sem
      // depender de um nome de campo específico dentro de usage_metadata (System
      // Tables): duas linhas com o mesmo workspace+sku+produto+dia+usuário mas
      // metadata/tags diferentes (ex: dois jobs simultâneos) viram registros
      // separados, em vez de colapsar numa linha só com uma tag "de exemplo" errada
      // pra 2/3 do custo. Hash dos JSONs crus (não do objeto reparseado) — evita
      // qualquer risco de reordenação de chaves alterar o hash pro mesmo recurso.
      const recursoHash = crypto.createHash('md5')
        .update((l.usage_metadata_json || '') + '|' + (l.custom_tags_json || ''))
        .digest('hex');
      const ins = await pool.query(
        `INSERT INTO databricks_consumo (workspace_id,sku_name,produto_origem,usage_date,usage_unit,usage_quantity,usuario,preco_unitario,custo_estimado,usage_metadata,custom_tags,recurso_hash,config_id,atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (workspace_id,sku_name,produto_origem,usage_date,usuario,recurso_hash) DO UPDATE SET
           usage_quantity=EXCLUDED.usage_quantity, usage_unit=EXCLUDED.usage_unit,
           preco_unitario=EXCLUDED.preco_unitario, custo_estimado=EXCLUDED.custo_estimado,
           usage_metadata=EXCLUDED.usage_metadata, custom_tags=EXCLUDED.custom_tags,
           config_id=EXCLUDED.config_id, atualizado_em=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [l.workspace_id, l.sku_name, l.produto_origem || '', l.usage_date, l.usage_unit || null, l.usage_quantity || 0, l.usuario || '', l.preco_unitario || null, l.custo_estimado || 0, l.usage_metadata_json || null, l.custom_tags_json || null, recursoHash, configId]
      );
      if (ins.rows[0]?.inserted) totalIns++; else totalUpd++;
      _dbxColetaProgresso.ins = totalIns; _dbxColetaProgresso.upd = totalUpd;
    } catch (eLinha) {
      totalErr++;
      _dbxColetaProgresso.err = totalErr;
      _logColetaDbx(`Erro na linha (${l.workspace_id}/${l.sku_name}/${l.usage_date}): ${eLinha.message}`);
    }
  }

  _logColetaDbx(`Concluído: ${totalIns} ins, ${totalUpd} upd, ${totalErr} err`);
  const detFinal = JSON.stringify({ log: [..._dbxColetaProgresso.log] });
  await pool.query(
    `UPDATE databricks_coleta_historico SET status='concluido',concluido_em=NOW(),linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
    [totalIns, totalUpd, totalErr, msgFinal, detFinal, histId]
  );
  _dbxColetaProgresso.fase = 'Concluído';
  _validarColetaDatabricks(histId, configId, periodoInicio, periodoFim).catch(() => {});
  _registrarNotificacaoColeta(
    origem === 'import' ? 'Importação Databricks concluída' : 'Coleta Databricks concluída',
    origem === 'import' ? msgFinal : `${origem === 'agendado' ? '⏰ Agendada' : '👤 Manual'} · ${msgFinal}`,
    'coleta_concluida'
  ).catch(() => {});
}

// Execuções de Job (duração + status) — system.lakeflow.job_run_timeline (imutável;
// runs >1h emitem múltiplas linhas/"slices", cada uma um pedaço do intervalo total,
// mesmo run_id repetido) JOIN system.lakeflow.jobs (SCD2 — job_run_timeline não traz o
// NOME do job, só job_id; jobs precisa da linha mais recente não-deletada por job_id).
// Agrega por run ANTES de gravar (SUM da duração das slices; MIN/MAX pra início/fim
// reais; MAX em result_state/termination_code ignora NULL e sobra só o valor real, que a
// documentação confirma populado apenas na ÚLTIMA slice de runs longos) — cada run vira
// exatamente 1 linha em databricks_job_runs, nunca duplicada por slice. NÃO VALIDADO
// contra uma conta Databricks real — sintaxe/nomes de coluna conforme documentação
// oficial pesquisada em 2026-08-29 (WebSearch/WebFetch contra docs.databricks.com/aws/en/
// admin/system-tables/jobs); ajustar se a primeira execução real reportar erro de coluna.
async function _coletarJobRunsDatabricks(cfg, token, startDate, endDate, configId) {
  const sql = `
    WITH runs AS (
      SELECT workspace_id, job_id, run_id,
             MAX(run_type)     AS run_type,
             MAX(trigger_type) AS trigger_type,
             MAX(run_name)     AS run_name,
             MIN(period_start_time) AS iniciado_em,
             MAX(period_end_time)   AS concluido_em,
             SUM(unix_timestamp(period_end_time) - unix_timestamp(period_start_time)) AS duracao_segundos,
             MAX(result_state)     AS result_state,
             MAX(termination_code) AS termination_code
      FROM system.lakeflow.job_run_timeline
      WHERE CAST(period_start_time AS DATE) >= :data_inicio AND CAST(period_start_time AS DATE) <= :data_fim
      GROUP BY workspace_id, job_id, run_id
    ),
    jobs_latest AS (
      SELECT job_id, name,
             ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY change_time DESC) AS rn
      FROM system.lakeflow.jobs
      WHERE delete_time IS NULL
    )
    SELECT r.workspace_id, r.job_id, r.run_id, r.run_type, r.trigger_type, r.run_name,
           r.iniciado_em, r.concluido_em, r.duracao_segundos, r.result_state, r.termination_code,
           j.name AS job_name
    FROM runs r
    LEFT JOIN jobs_latest j ON j.job_id = r.job_id AND j.rn = 1
  `;
  const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
    { name: 'data_inicio', value: startDate, type: 'DATE' },
    { name: 'data_fim', value: endDate, type: 'DATE' },
  ]);
  const linhas = _parseDatabricksResult(raw);

  let ins = 0, upd = 0;
  for (const l of linhas) {
    const r = await pool.query(
      `INSERT INTO databricks_job_runs (workspace_id,job_id,run_id,job_name,run_name,run_type,trigger_type,iniciado_em,concluido_em,duracao_segundos,result_state,termination_code,config_id,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (workspace_id,job_id,run_id) DO UPDATE SET
         job_name=EXCLUDED.job_name, run_name=EXCLUDED.run_name, run_type=EXCLUDED.run_type,
         trigger_type=EXCLUDED.trigger_type, iniciado_em=EXCLUDED.iniciado_em, concluido_em=EXCLUDED.concluido_em,
         duracao_segundos=EXCLUDED.duracao_segundos, result_state=EXCLUDED.result_state,
         termination_code=EXCLUDED.termination_code, config_id=EXCLUDED.config_id, atualizado_em=NOW()
       RETURNING (xmax = 0) AS inserted`,
      [l.workspace_id, l.job_id, l.run_id, l.job_name || null, l.run_name || null, l.run_type || null,
       l.trigger_type || null, l.iniciado_em || null, l.concluido_em || null, l.duracao_segundos || null,
       l.result_state || null, l.termination_code || null, configId]
    );
    if (r.rows[0]?.inserted) ins++; else upd++;
  }
  return { total: linhas.length, ins, upd };
}

// Utilização de Cluster (2026-08-29, auditoria pedida pelo usuário — lacuna de
// "otimização de custo" identificada: o sistema já mostra CUSTO por cluster (RN-DB-001),
// mas não se aquele cluster está superdimensionado/ocioso). system.compute.node_timeline
// é minuto a minuto por instância — granular DEMAIS pra guardar cru (um cluster de 10
// workers por 30 dias = ~432 mil linhas só pra um cluster); agregado por
// (workspace,cluster,dia) na própria query Spark SQL antes de gravar. cpu_percent =
// cpu_user_percent + cpu_system_percent (tempo de CPU realmente em uso — exclui
// cpu_wait_percent, que é I/O, não trabalho). jobs_latest (SCD2) só pro nome/dono mais
// recente do cluster, mesmo padrão já usado pra system.lakeflow.jobs.
async function _coletarUtilizacaoDatabricks(cfg, token, startDate, endDate, configId) {
  const sql = `
    WITH util AS (
      SELECT workspace_id, cluster_id,
             CAST(start_time AS DATE) AS dia,
             AVG(cpu_user_percent + cpu_system_percent) AS avg_cpu_percent,
             AVG(mem_used_percent) AS avg_mem_percent,
             COUNT(*) AS amostras
      FROM system.compute.node_timeline
      WHERE CAST(start_time AS DATE) >= :data_inicio AND CAST(start_time AS DATE) <= :data_fim
      GROUP BY workspace_id, cluster_id, CAST(start_time AS DATE)
    ),
    clusters_latest AS (
      SELECT cluster_id, cluster_name, owned_by,
             ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS rn
      FROM system.compute.clusters
      WHERE delete_time IS NULL
    )
    SELECT u.workspace_id, u.cluster_id, u.dia, u.avg_cpu_percent, u.avg_mem_percent, u.amostras,
           c.cluster_name, c.owned_by
    FROM util u
    LEFT JOIN clusters_latest c ON c.cluster_id = u.cluster_id AND c.rn = 1
  `;
  const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
    { name: 'data_inicio', value: startDate, type: 'DATE' },
    { name: 'data_fim', value: endDate, type: 'DATE' },
  ]);
  const linhas = _parseDatabricksResult(raw);
  let ins = 0, upd = 0;
  for (const l of linhas) {
    const r = await pool.query(
      `INSERT INTO databricks_cluster_utilizacao (workspace_id,cluster_id,cluster_name,owned_by,dia,avg_cpu_percent,avg_mem_percent,amostras,config_id,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (workspace_id,cluster_id,dia) DO UPDATE SET
         cluster_name=EXCLUDED.cluster_name, owned_by=EXCLUDED.owned_by, avg_cpu_percent=EXCLUDED.avg_cpu_percent,
         avg_mem_percent=EXCLUDED.avg_mem_percent, amostras=EXCLUDED.amostras, config_id=EXCLUDED.config_id, atualizado_em=NOW()
       RETURNING (xmax = 0) AS inserted`,
      [l.workspace_id, l.cluster_id, l.cluster_name || null, l.owned_by || null, l.dia,
       l.avg_cpu_percent || null, l.avg_mem_percent || null, l.amostras || 0, configId]
    );
    if (r.rows[0]?.inserted) ins++; else upd++;
  }
  return { total: linhas.length, ins, upd };
}

// Custo/performance por Query em SQL Warehouse (2026-08-29, auditoria pedida pelo
// usuário — lacuna identificada: "Por Warehouse" já mostra custo agregado, mas não qual
// QUERY/usuário específico consumiu mais). system.query.history não tem coluna de custo
// própria (confirmado na documentação oficial — precisa correlacionar com
// system.billing.usage por warehouse_id+janela de tempo); guardamos só performance aqui,
// custo é atribuído proporcionalmente em LEITURA (ver GET /query-history). statement_text
// NÃO é coletado (redigido por padrão pra quem não é admin/databricks_pii_access — não
// vale a pena depender disso, e não precisamos do SQL em si, só metadados).
async function _coletarQueryHistoryDatabricks(cfg, token, startDate, endDate, configId) {
  const sql = `
    SELECT workspace_id, statement_id, compute.warehouse_id AS warehouse_id, statement_type,
           executed_by, start_time, end_time, total_duration_ms, execution_status
    FROM system.query.history
    WHERE CAST(start_time AS DATE) >= :data_inicio AND CAST(start_time AS DATE) <= :data_fim
      AND compute.warehouse_id IS NOT NULL
  `;
  const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
    { name: 'data_inicio', value: startDate, type: 'DATE' },
    { name: 'data_fim', value: endDate, type: 'DATE' },
  ]);
  const linhas = _parseDatabricksResult(raw);
  let ins = 0, upd = 0;
  for (const l of linhas) {
    const r = await pool.query(
      `INSERT INTO databricks_query_history (workspace_id,statement_id,warehouse_id,statement_type,executed_by,iniciado_em,concluido_em,duracao_total_ms,execution_status,config_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (workspace_id,statement_id) DO UPDATE SET
         warehouse_id=EXCLUDED.warehouse_id, statement_type=EXCLUDED.statement_type, executed_by=EXCLUDED.executed_by,
         iniciado_em=EXCLUDED.iniciado_em, concluido_em=EXCLUDED.concluido_em, duracao_total_ms=EXCLUDED.duracao_total_ms,
         execution_status=EXCLUDED.execution_status, config_id=EXCLUDED.config_id
       RETURNING (xmax = 0) AS inserted`,
      [l.workspace_id, l.statement_id, l.warehouse_id || null, l.statement_type || null, l.executed_by || null,
       l.start_time || null, l.end_time || null, l.total_duration_ms || null, l.execution_status || null, configId]
    );
    if (r.rows[0]?.inserted) ins++; else upd++;
  }
  return { total: linhas.length, ins, upd };
}

// AI Gateway — volume de uso de modelos externos (2026-08-29, auditoria pedida pelo
// usuário — lacuna identificada como "gasto com AI Gateway", CORRIGIDA durante a própria
// pesquisa: `system.ai_gateway.external_model_spend` (nome usado numa rodada anterior
// desta sessão) NÃO EXISTE — a tabela real é `system.ai_gateway.usage`, confirmada
// oficialmente SEM nenhuma coluna de custo em R$/US$: a Databricks não sabe quanto o
// provedor externo (OpenAI, Anthropic etc.) cobra por trás do Gateway, só registra volume
// de tokens/requisições. Por isso esta feature mostra VOLUME, nunca "gasto estimado" — não
// existe base pra estimar isso sem uma tabela de preço por provedor externo, que não faz
// parte de nenhum system table. Agregado por (workspace,destino,dia) — volume de
// requisições por request individual seria alto demais pra guardar cru.
async function _coletarAiGatewayDatabricks(cfg, token, startDate, endDate, configId) {
  const sql = `
    SELECT workspace_id, destination_name, destination_model,
           CAST(event_time AS DATE) AS dia,
           COUNT(*) AS requisicoes,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens
    FROM system.ai_gateway.usage
    WHERE CAST(event_time AS DATE) >= :data_inicio AND CAST(event_time AS DATE) <= :data_fim
    GROUP BY workspace_id, destination_name, destination_model, CAST(event_time AS DATE)
  `;
  const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
    { name: 'data_inicio', value: startDate, type: 'DATE' },
    { name: 'data_fim', value: endDate, type: 'DATE' },
  ]);
  const linhas = _parseDatabricksResult(raw);
  let ins = 0, upd = 0;
  for (const l of linhas) {
    const r = await pool.query(
      `INSERT INTO databricks_ai_gateway_usage (workspace_id,destination_name,destination_model,dia,requisicoes,input_tokens,output_tokens,config_id,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (workspace_id,destination_name,destination_model,dia) DO UPDATE SET
         requisicoes=EXCLUDED.requisicoes, input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
         config_id=EXCLUDED.config_id, atualizado_em=NOW()
       RETURNING (xmax = 0) AS inserted`,
      [l.workspace_id, l.destination_name || 'desconhecido', l.destination_model || null, l.dia,
       l.requisicoes || 0, l.input_tokens || 0, l.output_tokens || 0, configId]
    );
    if (r.rows[0]?.inserted) ins++; else upd++;
  }
  return { total: linhas.length, ins, upd };
}

// Otimização de Storage (2026-08-29, auditoria pedida pelo usuário — TCO geral, fora do
// escopo de compute). usage_quantity vem em ESTIMATED_DBU — a documentação oficial é
// explícita que é uma estimativa quando operações dividem recursos de cluster.
async function _coletarStorageOtimizacaoDatabricks(cfg, token, startDate, endDate, configId) {
  const sql = `
    SELECT workspace_id, operation_id, catalog_name, schema_name, table_name,
           operation_type, operation_status, start_time, end_time, usage_quantity
    FROM system.storage.predictive_optimization_operations_history
    WHERE CAST(start_time AS DATE) >= :data_inicio AND CAST(start_time AS DATE) <= :data_fim
  `;
  const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
    { name: 'data_inicio', value: startDate, type: 'DATE' },
    { name: 'data_fim', value: endDate, type: 'DATE' },
  ]);
  const linhas = _parseDatabricksResult(raw);
  let ins = 0, upd = 0;
  for (const l of linhas) {
    const r = await pool.query(
      `INSERT INTO databricks_storage_otimizacao (workspace_id,operation_id,catalog_name,schema_name,table_name,operation_type,operation_status,iniciado_em,concluido_em,usage_quantity,config_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (workspace_id,operation_id) DO UPDATE SET
         operation_status=EXCLUDED.operation_status, concluido_em=EXCLUDED.concluido_em,
         usage_quantity=EXCLUDED.usage_quantity, config_id=EXCLUDED.config_id
       RETURNING (xmax = 0) AS inserted`,
      [l.workspace_id, l.operation_id, l.catalog_name || null, l.schema_name || null, l.table_name || null,
       l.operation_type || null, l.operation_status || null, l.start_time || null, l.end_time || null,
       l.usage_quantity || 0, configId]
    );
    if (r.rows[0]?.inserted) ins++; else upd++;
  }
  return { total: linhas.length, ins, upd };
}

// Extraído (2026-08-29) pra evitar repetir o mesmo try/catch+log+anotação de histórico 5x
// (Job Runs, Utilização de Cluster, Query History, AI Gateway, Storage Otimização) — todas
// coletas best-effort com o mesmo formato de sucesso ({total,ins,upd}) e o mesmo
// tratamento de falha (anota "indisponível" na mensagem, nunca lança pro chamador).
async function _bestEffortColetaExtra(histId, label, faseMsg, fn) {
  try {
    _dbxColetaProgresso.fase = faseMsg;
    _logColetaDbx(faseMsg);
    const info = await fn();
    _logColetaDbx(`${label}: ${info.total} linha(s) — ${info.ins} novo(s), ${info.upd} atualizado(s)`);
    await pool.query(`UPDATE databricks_coleta_historico SET mensagem = mensagem || $1 WHERE id=$2`,
      [` | ${label}: ${info.total} (${info.ins} novo(s))`, histId]).catch(() => {});
  } catch (e) {
    _logColetaDbx(`${label}: não coletado — ${e.message}`);
    await pool.query(`UPDATE databricks_coleta_historico SET mensagem = mensagem || $1 WHERE id=$2`,
      [` | ${label}: indisponível (${e.message.slice(0, 120)})`, histId]).catch(() => {});
  }
}

async function _executarColetaDatabricks(configId, startDate, endDate, origem = 'manual') {
  if (_dbxColetaEmExecucao) throw new Error('Coleta Databricks já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _dbxColetaEmExecucao = true;
  _dbxColetaIniciadaEm = new Date();
  _dbxColetaProgresso  = { fase: 'Iniciando...', ins: 0, upd: 0, err: 0, log: [] };
  _logColetaDbx(`Coleta Databricks — ${startDate} → ${endDate}`);
  let histId;

  try {
    await ensureAzureColetaTable();
    const r = await pool.query(
      `INSERT INTO databricks_coleta_historico (status,config_id,origem,periodo_inicio,periodo_fim) VALUES ('executando',$1,$2,$3,$4) RETURNING id`,
      [configId, origem, startDate, endDate]
    );
    histId = r.rows[0].id;

    const cfgRow = await pool.query(`SELECT * FROM databricks_coleta_config WHERE id=$1`, [configId]);
    if (!cfgRow.rows.length) throw new Error('Configuração não encontrada');
    const cfg = cfgRow.rows[0];

    _dbxColetaProgresso.fase = 'Autenticando...';
    _logColetaDbx(cfg.modo_auth === 'pat' ? 'Usando Personal Access Token...' : 'Autenticando via OAuth M2M...');
    const token = await _resolveDbxToken(cfg);

    _dbxColetaProgresso.fase = 'Consultando System Tables...';
    _logColetaDbx('Consultando system.billing.usage + system.billing.list_prices...');
    // Granularidade por recurso (2026-08-26, pedido do usuário — ver comentário em
    // ensureAzureColetaTable/databricks_consumo): usage_metadata (STRUCT) e custom_tags
    // (MAP) vêm via to_json() em vez de acessar campos aninhados específicos tipo
    // `usage_metadata.machine.sku` — esse caminho exato não é confirmado no schema real
    // do Databricks (não validável neste ambiente, sem conta real disponível), e um nome
    // de campo errado quebraria a query inteira. to_json() captura o que existir de
    // verdade, sem apostar num caminho específico, e serve como chave de agrupamento
    // (MAP não pode ir em GROUP BY no Spark SQL — precisa ser uma STRING).
    //
    // Bug real encontrado e corrigido (2026-08-29, auditoria pedida pelo usuário contra a
    // documentação oficial): usava `p.pricing.default` — a doc descreve esse campo como
    // "preço de tabela base pra estimativas de longo prazo", NÃO o campo usado pra calcular
    // custo real. A query de exemplo oficial da Databricks pra "Total Dollar Cost"
    // (docs.databricks.com/aws/en/admin/system-tables/pricing) usa
    // `pricing.effective_list.default` — "resolve o preço de lista e o promocional, e
    // contém o preço de lista efetivo usado pra calcular o custo". Sem isso, qualquer SKU
    // com preço promocional ativo tinha o custo estimado systematicamente errado (usando o
    // preço de tabela cheio em vez do efetivo). `COALESCE(...,p.pricing.default)` mantém um
    // fallback só por segurança, caso `effective_list` venha nulo pra algum SKU específico.
    // Join trocado de `usage_start_time` pra `usage_end_time` na mesma correção, batendo
    // exatamente com a query de exemplo oficial (usage_quantity e o preço vigente no fim do
    // período de uso, não no início — só importa pra registros que cruzam uma mudança de
    // preço no meio do intervalo, caso raro, mas sem motivo pra divergir do padrão oficial).
    const sql = `
      SELECT
        u.workspace_id                                 AS workspace_id,
        u.sku_name                                      AS sku_name,
        COALESCE(u.billing_origin_product, '')          AS produto_origem,
        u.usage_date                                    AS usage_date,
        u.usage_unit                                    AS usage_unit,
        COALESCE(u.identity_metadata.run_as, '')        AS usuario,
        to_json(u.usage_metadata)                       AS usage_metadata_json,
        to_json(u.custom_tags)                          AS custom_tags_json,
        SUM(u.usage_quantity)                           AS usage_quantity,
        MAX(COALESCE(p.pricing.effective_list.default, p.pricing.default)) AS preco_unitario,
        SUM(u.usage_quantity * COALESCE(p.pricing.effective_list.default, p.pricing.default, 0)) AS custo_estimado
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices p
        ON u.sku_name = p.sku_name AND u.cloud = p.cloud
        AND u.usage_end_time >= p.price_start_time
        AND (p.price_end_time IS NULL OR u.usage_end_time < p.price_end_time)
      WHERE u.usage_date >= :data_inicio AND u.usage_date <= :data_fim
      GROUP BY u.workspace_id, u.sku_name, u.billing_origin_product, u.usage_date, u.usage_unit,
               u.identity_metadata.run_as, to_json(u.usage_metadata), to_json(u.custom_tags)
    `;
    const raw = await _databricksRunQuery(cfg.workspace_host, cfg.warehouse_id, token, sql, [
      { name: 'data_inicio', value: startDate, type: 'DATE' },
      { name: 'data_fim', value: endDate, type: 'DATE' },
    ]);
    const linhas = _parseDatabricksResult(raw);
    _dbxColetaProgresso.fase = `Gravando ${linhas.length} linha(s)...`;
    _logColetaDbx(`${linhas.length} linha(s) retornada(s) — gravando em databricks_consumo...`);

    const msgFinal = `Databricks — ${linhas.length} linha(s) | ${startDate}→${endDate}`;
    await _processarLinhasDatabricks(histId, configId, origem, startDate, endDate, linhas, msgFinal);

    // Coletas adicionais best-effort (2026-08-29) — cada uma um schema de System Tables
    // SEPARADO de system.billing, habilitado independentemente por um account admin; uma
    // falha aqui só anota "indisponível" na mensagem do histórico, nunca derruba a coleta
    // de billing acima (já concluída e persistida antes deste ponto).
    await _bestEffortColetaExtra(histId, 'Job Runs', 'Consultando execuções de Job (system.lakeflow)...',
      () => _coletarJobRunsDatabricks(cfg, token, startDate, endDate, configId));
    await _bestEffortColetaExtra(histId, 'Utilização de Cluster', 'Consultando utilização de cluster (system.compute)...',
      () => _coletarUtilizacaoDatabricks(cfg, token, startDate, endDate, configId));
    await _bestEffortColetaExtra(histId, 'Query History', 'Consultando histórico de queries (system.query)...',
      () => _coletarQueryHistoryDatabricks(cfg, token, startDate, endDate, configId));
    await _bestEffortColetaExtra(histId, 'AI Gateway', 'Consultando uso de AI Gateway (system.ai_gateway)...',
      () => _coletarAiGatewayDatabricks(cfg, token, startDate, endDate, configId));
    await _bestEffortColetaExtra(histId, 'Storage Otimização', 'Consultando otimização de storage (system.storage)...',
      () => _coletarStorageOtimizacaoDatabricks(cfg, token, startDate, endDate, configId));

  } catch (err) {
    _logColetaDbx(`ERRO: ${err.message}`);
    const detErr = JSON.stringify({ log: [..._dbxColetaProgresso.log] });
    if (histId) await pool.query(
      `UPDATE databricks_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1,detalhes=$2 WHERE id=$3`,
      [err.message, detErr, histId]
    ).catch(() => {});
    _registrarNotificacaoColeta('Coleta Databricks com erro', err.message, 'coleta_erro').catch(() => {});
    _alertarColetaComErro('Coleta Databricks com erro', err.message).catch(() => {});
  } finally {
    _dbxColetaEmExecucao = false;
    _dbxColetaIniciadaEm = null;
  }
}

// Mapeia uma linha de CSV de importação manual pro mesmo shape que a coleta ao vivo
// produz (ver SELECT em _executarColetaDatabricks) — nomes de coluna esperados batem
// 1:1 com os campos internos (workspace_id, sku_name, produto_origem, usage_date,
// usage_unit, usage_quantity, usuario, preco_unitario, custo_estimado, usage_metadata,
// custom_tags), com alguns aliases pros nomes nativos do Databricks (ex:
// billing_origin_product). Preferido a tentar imitar o formato exato de export do
// Databricks (desconhecido/não confirmável sem conta real) — um template próprio,
// documentado na UI, é previsível e não depende de nenhuma suposição sobre como o
// usuário extraiu os dados.
function _mapRowDatabricksImport(row) {
  const keysLower = Object.keys(row).reduce((m, k) => { m[k.toLowerCase().replace(/[\s_-]/g, '')] = k; return m; }, {});
  const ci = (...slugs) => { for (const s of slugs) { const k = keysLower[s]; if (k != null) { const v = row[k]; if (v != null && v !== '') return v; } } return null; };

  const workspace_id = ci('workspaceid');
  const sku_name      = ci('skuname');
  const produto_origem = ci('produtoorigem', 'billingoriginproduct') || '';
  const usage_date    = ci('usagedate');
  const usage_unit    = ci('usageunit');
  const usage_quantity = parseFloat(ci('usagequantity')) || 0;
  const usuario        = ci('usuario', 'usageuser', 'runas', 'identitymetadatarunas') || '';
  const precoRaw   = ci('precounitario', 'price', 'unitprice');
  const preco_unitario = precoRaw != null ? parseFloat(precoRaw) : null;
  const custoRaw   = ci('custoestimado', 'cost');
  const custo_estimado = custoRaw != null ? parseFloat(custoRaw) : (usage_quantity * (preco_unitario || 0));

  // usage_metadata/custom_tags: só aceita se for JSON válido — se o usuário deixou
  // texto livre ou uma coluna vazia, trata como ausente em vez de falhar a linha
  // inteira (essas colunas são opcionais; sem elas, a linha ainda tem
  // workspace/sku/data/usuário suficientes pra formar um recurso_hash próprio).
  function _validJsonOrNull(raw) {
    if (!raw) return null;
    try { JSON.parse(raw); return raw; } catch (_) { return null; }
  }
  const usage_metadata_json = _validJsonOrNull(ci('usagemetadata'));
  const custom_tags_json    = _validJsonOrNull(ci('customtags'));

  return { workspace_id, sku_name, produto_origem, usage_date, usage_unit, usage_quantity, usuario, preco_unitario, custo_estimado, usage_metadata_json, custom_tags_json };
}

// Importação manual (CSV) — pedido do usuário (2026-08-27), mesma ideia do "Importação
// Manual" já existente pra Azure, mas reaproveitando a infraestrutura de progresso já
// construída pra Databricks (_dbxColetaProgresso/_dbxColetaEmExecucao) em vez de criar
// um segundo mecanismo de job/polling só pra isso — o monitor ao vivo já existente
// (DatabricksColetaMonitor) funciona sem nenhuma mudança no frontend além do botão de
// upload. config_id sempre NULL (dado avulso, não atribuído a nenhuma conexão
// OAuth/PAT específica) — _validarColetaDatabricks usa IS NOT DISTINCT FROM (não `=`)
// pra continuar funcionando corretamente com config_id NULL (SQL `NULL = NULL` nunca é
// verdadeiro; precisa do operador null-safe).
async function _processarImportDatabricks(tmpPath, originalname) {
  if (_dbxColetaEmExecucao) throw new Error('Coleta Databricks já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _dbxColetaEmExecucao = true;
  _dbxColetaIniciadaEm = new Date();
  _dbxColetaProgresso  = { fase: 'Lendo arquivo...', ins: 0, upd: 0, err: 0, log: [] };
  _logColetaDbx(`Importação manual — ${originalname}`);
  let histId;

  try {
    await ensureAzureColetaTable();
    // `_lerArquivoRows` (2026-09-04) em vez de `_lerCSV` — mesmo dispatcher de formato que o
    // import Azure já usa: .csv, .parquet (pyarrow com fallback pro @dsnp/parquetjs) e .zip
    // (extrai cada .csv/.parquet de dentro). Zero dependência nova — as duas libs já estavam
    // instaladas; a única razão de o Databricks aceitar só CSV era a chamada estar amarrada
    // ao leitor de CSV.
    const rows = await _lerArquivoRows(tmpPath, originalname);
    if (!rows.length) throw new Error('Arquivo vazio ou sem linhas de dados.');

    const linhas = [];
    let ignoradas = 0;
    for (const row of rows) {
      const m = _mapRowDatabricksImport(row);
      if (!m.workspace_id || !m.sku_name || !m.usage_date) { ignoradas++; continue; }
      linhas.push(m);
    }
    if (ignoradas) _logColetaDbx(`${ignoradas} linha(s) ignorada(s) — sem workspace_id/sku_name/usage_date.`);
    if (!linhas.length) throw new Error('Nenhuma linha válida — confira as colunas obrigatórias (workspace_id, sku_name, usage_date).');

    const datas = linhas.map(l => l.usage_date).sort();
    const periodoInicio = datas[0], periodoFim = datas[datas.length - 1];

    const r = await pool.query(
      `INSERT INTO databricks_coleta_historico (status,config_id,origem,periodo_inicio,periodo_fim) VALUES ('executando',NULL,'import',$1,$2) RETURNING id`,
      [periodoInicio, periodoFim]
    );
    histId = r.rows[0].id;

    _dbxColetaProgresso.fase = `Gravando ${linhas.length} linha(s)...`;
    _logColetaDbx(`${linhas.length} linha(s) válida(s) — gravando em databricks_consumo...`);
    const msgFinal = `Import manual — ${originalname} — ${linhas.length} linha(s)`;
    await _processarLinhasDatabricks(histId, null, 'import', periodoInicio, periodoFim, linhas, msgFinal);

  } catch (err) {
    _logColetaDbx(`ERRO: ${err.message}`);
    const detErr = JSON.stringify({ log: [..._dbxColetaProgresso.log] });
    if (histId) await pool.query(
      `UPDATE databricks_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1,detalhes=$2 WHERE id=$3`,
      [err.message, detErr, histId]
    ).catch(() => {});
    _registrarNotificacaoColeta('Importação Databricks com erro', err.message, 'coleta_erro').catch(() => {});
    _alertarColetaComErro('Importação Databricks com erro', err.message).catch(() => {});
  } finally {
    _dbxColetaEmExecucao = false;
    _dbxColetaIniciadaEm = null;
    const fs = require('fs');
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

const _DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.post('/api/databricks-coleta/config/:id/coletar', authMiddleware, dbMiddleware, async (req, res) => {
  if (_dbxColetaEmExecucao) return res.status(409).json({ error: 'Coleta Databricks já em execução' });
  const { data_inicio, data_fim } = req.body;
  if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || ''))
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios (formato YYYY-MM-DD)' });
  res.json({ ok: true, message: 'Coleta Databricks iniciada' });
  _executarColetaDatabricks(parseInt(req.params.id), data_inicio, data_fim, 'manual')
    .catch(e => console.error('[ColetaDbx] Erro:', e.message));
});

app.get('/api/databricks-coleta/status', authMiddleware, dbMiddleware, async (_req, res) => {
  res.json({
    em_execucao: _dbxColetaEmExecucao,
    iniciada_em: _dbxColetaIniciadaEm,
    progresso: _dbxColetaProgresso,
  });
});

// Importação manual (CSV) — só .csv (diferente do import Azure, que aceita .csv/
// .parquet/.zip pra lidar com exports oficiais grandes; aqui é um export manual que o
// próprio usuário monta a partir de uma query no SQL editor do Databricks, tipicamente
// bem menor). Reaproveita _dbxColetaEmExecucao como trava (mesma trava que já bloqueia
// coleta ao vivo concorrente — os dois usam a mesma tabela de destino).
if (_multer) {
  const _uploadDbx = _multer({
    storage: _multer.diskStorage({
      destination: (_, __, cb) => cb(null, _uploadDir),
      filename: (_, file, cb) => cb(null, Date.now() + '_' + file.originalname),
    }),
    // 500 MB (2026-09-04) — subiu de 100 MB junto com o suporte a .parquet/.zip: um export
    // comprimido de várias semanas passa fácil de 100 MB. Ainda bem abaixo dos 2 GB do Azure,
    // que aceita o export oficial particionado do Cost Management.
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  });

  app.post('/api/databricks-coleta/import', authMiddleware, dbMiddleware, (req, res, next) => {
    _uploadDbx.single('arquivo')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo muito grande (limite: 500 MB).' });
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
      }
      next();
    });
  }, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const _extDbx = (req.file.originalname || '').split('.').pop().toLowerCase();
    if (!['csv', 'parquet', 'zip'].includes(_extDbx)) {
      require('fs').unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Apenas arquivos .csv, .parquet e .zip são aceitos.' });
    }
    if (_dbxColetaEmExecucao) {
      require('fs').unlink(req.file.path, () => {});
      return res.status(409).json({ error: 'Uma coleta ou importação Databricks já está em andamento. Aguarde a conclusão.' });
    }
    res.status(202).json({ ok: true, message: 'Importação iniciada' });
    _processarImportDatabricks(req.file.path, req.file.originalname)
      .catch(e => console.error('[ImportDbx] Erro:', e.message));
  });
}

// Espelha GET/DELETE /api/azure-coleta/historico — mesmo shape de HistoricoItem
// (frontend), sem `tipo` (conceito que não existe pra Databricks: uma única query
// por coleta, sem sub-tipo api/storage/price_list). validacao_status/validacao_json
// agora incluídos (2026-08-27, paridade com a Coleta Azure — ver
// _validarColetaDatabricks). Alimenta a aba "Coleta Databricks" do seletor de
// Histórico de Execuções em ColetaView.tsx.
app.get('/api/databricks-coleta/historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT h.id, h.iniciado_em, h.concluido_em, h.status, h.origem, h.periodo_inicio, h.periodo_fim,
             h.linhas_inseridas, h.linhas_atualizadas, h.linhas_erro, h.mensagem, h.detalhes,
             h.validacao_status, h.validacao_json, h.config_id, c.nome AS sp_nome
      FROM databricks_coleta_historico h
      LEFT JOIN databricks_coleta_config c ON c.id = h.config_id
      ORDER BY h.iniciado_em DESC LIMIT 50
    `);
    res.json(rows);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/databricks-coleta/historico/:id/validar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT config_id, periodo_inicio, periodo_fim FROM databricks_coleta_historico WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Registro não encontrado' });
    const { config_id, periodo_inicio, periodo_fim } = rows[0];
    await _validarColetaDatabricks(id, config_id, periodo_inicio, periodo_fim);
    const { rows: updated } = await pool.query(
      `SELECT validacao_status, validacao_json FROM databricks_coleta_historico WHERE id=$1`, [id]
    );
    res.json(updated[0] || {});
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/databricks-coleta/historico', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await pool.query(`TRUNCATE TABLE databricks_coleta_historico RESTART IDENTITY`);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Expurgo de databricks_consumo (2026-08-27, pedido do usuário) — espelha
// GET/DELETE /api/azure-costs/purge, mas escopado por workspace_id em vez de
// arquivo_origem: databricks_consumo não rastreia de qual arquivo cada linha
// veio (config_id fica NULL pra import manual — ver nota em
// _processarImportDatabricks), então "por arquivo" não é um filtro possível
// hoje; "por workspace" cobre o caso de uso real (limpar um workspace de
// teste específico) sem precisar de uma coluna nova. Sem retry de deadlock
// (diferente do purge Azure) — volume de escrita concorrente muito menor
// aqui, esse cenário não se aplica.
app.get('/api/databricks-coleta/purge/preview', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { data_inicio, data_fim, workspace_id } = req.query;
    let q = 'SELECT COUNT(*) AS total FROM databricks_consumo WHERE 1=1';
    const params = [];
    if (workspace_id) { params.push(workspace_id); q += ` AND workspace_id = $${params.length}`; }
    if (data_inicio)  { params.push(data_inicio);  q += ` AND usage_date >= $${params.length}`; }
    if (data_fim)     { params.push(data_fim);     q += ` AND usage_date <= $${params.length}`; }
    const r = await pool.query(q, params);
    res.json({ total: parseInt(r.rows[0].total) });
  } catch (err) { _dbErr(res, err); }
});

app.delete('/api/databricks-coleta/purge', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { data_inicio, data_fim, workspace_id } = req.query;
    let removidos, msg;
    if (workspace_id) {
      const r = await pool.query('DELETE FROM databricks_consumo WHERE workspace_id = $1', [workspace_id]);
      removidos = r.rowCount;
      msg = `${removidos} registro(s) do workspace "${workspace_id}" removidos.`;
    } else if (data_inicio || data_fim) {
      let q = 'DELETE FROM databricks_consumo WHERE 1=1';
      const params = [];
      if (data_inicio) { params.push(data_inicio); q += ` AND usage_date >= $${params.length}`; }
      if (data_fim)    { params.push(data_fim);    q += ` AND usage_date <= $${params.length}`; }
      const r = await pool.query(q, params);
      removidos = r.rowCount;
      msg = `${removidos} registro(s) do período ${data_inicio || '—'} → ${data_fim || '—'} removidos.`;
    } else {
      const count = (await pool.query('SELECT COUNT(*) AS n FROM databricks_consumo')).rows[0].n;
      await pool.query('TRUNCATE TABLE databricks_consumo');
      removidos = parseInt(count);
      msg = `Todos os ${removidos} registros foram removidos.`;
    }
    console.log(`[Databricks Purge] ${msg}`);
    res.json({ message: msg, removidos });
  } catch (err) { _dbErr(res, err); }
});

// Espelha PUT /api/azure-coleta/sps/:id/agendamento — agendamento em campos próprios,
// separado do CRUD principal de credenciais.
app.put('/api/databricks-coleta/config/:id/agendamento', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { hora_execucao, dias_semana, auto_coleta, granularidade_dias } = req.body;
    const hora  = hora_execucao != null ? Math.max(0, Math.min(23, parseInt(hora_execucao))) : null;
    const dias  = dias_semana || null;
    const ativo = auto_coleta ? true : false;
    const gran  = granularidade_dias != null ? Math.max(1, parseInt(granularidade_dias) || 7) : 7;
    const proxima = ativo ? _computeProximaColeta(hora, dias) : null;
    await pool.query(
      `UPDATE databricks_coleta_config
       SET hora_execucao=$1, dias_semana=$2, auto_coleta=$3, granularidade_dias=$4, proxima_coleta=$5, atualizado_em=NOW()
       WHERE id=$6`,
      [hora, dias, ativo, gran, proxima, req.params.id]
    );
    const r = await pool.query(
      `SELECT id, nome, hora_execucao, dias_semana, auto_coleta, granularidade_dias, proxima_coleta FROM databricks_coleta_config WHERE id=$1`,
      [req.params.id]
    );
    res.json({ ok: true, config: r.rows[0] });
  } catch (e) { _dbErr(res, e); }
});

// ── Fase 3: dashboard (agregações), orçamentos e alerta de estouro ─────────────
// databricks_consumo é uma série temporal que cresce por coleta (diferente de
// acoes/estimativas, pequenas e agregadas no cliente) — segue o padrão de
// azure_costs: agregação em SQL. Tabela ainda pequena comparada a azure_costs,
// sem necessidade do cache de 5min usado lá (YAGNI aqui).
app.get('/api/databricks-coleta/resumo', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, workspace_id, sku_name, usuario, job_id, cluster_id, warehouse_id, mes } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setMonth(ini.getMonth() - 6);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `usage_date >= $1 AND usage_date <= $2`;
    const params = [data_inicio, data_fim];
    // Drill-down (dashboard): clicar num item de Workspace/SKU/Usuário/Job/Cluster/Warehouse
    // reconsulta TODAS as agregações abaixo já escopadas — cada card passa a mostrar a
    // composição DENTRO do filtro ativo (ex: SKUs só daquele job), não uma seleção
    // client-side sobre um /resumo genérico (o endpoint só devolve agregados, nunca as
    // linhas cruas). 'usuario' precisa de um sentinel pro caso "Não identificado"
    // (usage_metadata sem run_as vira usuario='' no banco) — usuario='' via querystring
    // vira ausente (`?usuario=` é indistinguível de omitido em vários clientes), então o
    // card usa '__vazio__' explicitamente pra esse caso.
    if (workspace_id) { params.push(workspace_id); where += ` AND workspace_id = $${params.length}`; }
    if (sku_name) { params.push(sku_name); where += ` AND sku_name = $${params.length}`; }
    if (usuario) { params.push(usuario === '__vazio__' ? '' : usuario); where += ` AND COALESCE(usuario,'') = $${params.length}`; }
    if (job_id) { params.push(job_id); where += ` AND usage_metadata->>'job_id' = $${params.length}`; }
    if (cluster_id) { params.push(cluster_id); where += ` AND usage_metadata->>'cluster_id' = $${params.length}`; }
    if (warehouse_id) { params.push(warehouse_id); where += ` AND usage_metadata->>'warehouse_id' = $${params.length}`; }

    // mes (clique numa barra da Tendência Mensal) — aplicado a TUDO exceto à própria
    // query rMes: selecionar um mês detalha o KPI de total e os cards de Workspace/SKU/
    // Usuário/Job/Cluster/Warehouse pra aquele mês especificamente, mas o gráfico de
    // tendência continua mostrando todos os meses do período (senão colapsaria pra 1
    // barra só ao selecionar, perdendo o contexto que o gráfico existe pra dar — clicar
    // de novo no mesmo mês, ou no chip "Detalhando por", remove o filtro e mostra o
    // total do período de novo).
    let whereMes = where;
    let paramsMes = params;
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      paramsMes = [...params, mes];
      whereMes = where + ` AND to_char(usage_date,'YYYY-MM') = $${paramsMes.length}`;
    }

    // por_job/por_cluster/por_warehouse — zero coleta nova: usage_metadata (JSONB, já
    // capturado por recurso desde a granularidade por-recurso) já traz job_id/job_name/
    // cluster_id/warehouse_id quando aplicável (confirmado na documentação oficial do
    // schema de system.billing.usage, pesquisada 2026-08-28) — só faltava a agregação.
    // Filtra por `usage_metadata->>'chave' IS NOT NULL`, não pelo operador de existência
    // de chave (`?`) — usage_metadata é uma STRUCT no Databricks, então job_id/cluster_id/
    // warehouse_id SEMPRE existem como campo, só variam entre um valor real e `null`
    // quando não aplicável (ex: linha de storage não tem job_id). `?` (existência de
    // chave) retornaria true pra toda linha mesmo quando o valor é null, empurrando um
    // bucket gigante "job_id: null" pro topo do ranking — bug real encontrado testando
    // contra os dados sintéticos desta sessão (job_id sempre presente como chave, null
    // quando o produto não é JOBS). Sem nome amigável pra cluster/warehouse
    // (usage_metadata não traz cluster_name, só node_type; nome de verdade precisaria de
    // uma coleta nova contra system.compute.clusters, fora de escopo desta rodada) — job
    // usa job_name quando disponível, cluster/warehouse mostram só o id.
    const [rTotal, rMes, rWs, rSku, rUser, rFree, rJob, rCluster, rWarehouse, rModelServing] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(custo_estimado),0) AS total, COUNT(*) AS linhas FROM databricks_consumo WHERE ${whereMes}`, paramsMes),
      pool.query(
        `SELECT to_char(usage_date,'YYYY-MM') AS mes, SUM(custo_estimado) AS custo,
                COALESCE(SUM(custo_estimado) FILTER (WHERE sku_name ILIKE '%FREE%' OR custo_estimado = 0), 0) AS free,
                COALESCE(SUM(custo_estimado) FILTER (WHERE NOT (sku_name ILIKE '%FREE%' OR custo_estimado = 0)), 0) AS pago
         FROM databricks_consumo WHERE ${where} GROUP BY 1 ORDER BY 1`, params
      ),
      pool.query(`SELECT workspace_id, SUM(custo_estimado) AS custo FROM databricks_consumo WHERE ${whereMes} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
      pool.query(`SELECT sku_name, SUM(custo_estimado) AS custo FROM databricks_consumo WHERE ${whereMes} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
      pool.query(`SELECT NULLIF(usuario,'') AS usuario, SUM(custo_estimado) AS custo FROM databricks_consumo WHERE ${whereMes} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
      pool.query(
        `SELECT
           COALESCE(SUM(custo_estimado) FILTER (WHERE sku_name ILIKE '%FREE%' OR custo_estimado = 0), 0) AS free,
           COALESCE(SUM(custo_estimado) FILTER (WHERE NOT (sku_name ILIKE '%FREE%' OR custo_estimado = 0)), 0) AS pago,
           COALESCE(SUM(usage_quantity) FILTER (WHERE sku_name ILIKE '%FREE%' OR custo_estimado = 0), 0) AS dbu_free,
           COALESCE(SUM(usage_quantity) FILTER (WHERE NOT (sku_name ILIKE '%FREE%' OR custo_estimado = 0)), 0) AS dbu_pago
         FROM databricks_consumo WHERE ${whereMes}`, paramsMes
      ),
      pool.query(`SELECT usage_metadata->>'job_id' AS job_id, MAX(usage_metadata->>'job_name') AS job_name, SUM(custo_estimado) AS custo
        FROM databricks_consumo WHERE ${whereMes} AND usage_metadata->>'job_id' IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 10`, paramsMes),
      pool.query(`SELECT usage_metadata->>'cluster_id' AS cluster_id, SUM(custo_estimado) AS custo
        FROM databricks_consumo WHERE ${whereMes} AND usage_metadata->>'cluster_id' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
      pool.query(`SELECT usage_metadata->>'warehouse_id' AS warehouse_id, SUM(custo_estimado) AS custo
        FROM databricks_consumo WHERE ${whereMes} AND usage_metadata->>'warehouse_id' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
      // Model Serving — ZERO coleta nova (auditoria 2026-08-29): a documentação oficial
      // (docs.databricks.com/aws/en/admin/system-tables/model-serving-cost) confirma que o
      // custo de Model Serving já vem inteiro de system.billing.usage, via o SKU
      // *_SERVERLESS_REAL_TIME_INFERENCE_* — dado que databricks_consumo já coleta desde a
      // Fase 2; só faltava esta agregação. usage_metadata->>'endpoint_name' pode não vir
      // preenchido em toda linha do SKU (nem toda oferta de Model Serving usa esse campo,
      // conforme a mesma doc) — fallback pro sku_name quando ausente.
      pool.query(`SELECT COALESCE(usage_metadata->>'endpoint_name', sku_name) AS endpoint, SUM(custo_estimado) AS custo
        FROM databricks_consumo WHERE ${whereMes} AND sku_name ILIKE '%SERVERLESS_REAL_TIME_INFERENCE%' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, paramsMes),
    ]);

    res.json({
      periodo: { inicio: data_inicio, fim: data_fim },
      tem_dados: parseInt(rTotal.rows[0].linhas, 10) > 0,
      total_custo: rTotal.rows[0].total,
      por_mes: rMes.rows,
      por_workspace: rWs.rows,
      por_sku: rSku.rows,
      por_usuario: rUser.rows.map(r => ({ usuario: r.usuario || 'Não identificado', custo: r.custo })),
      free_vs_pago: { free: rFree.rows[0].free, pago: rFree.rows[0].pago },
      dbus_free_vs_pago: { free: rFree.rows[0].dbu_free, pago: rFree.rows[0].dbu_pago },
      por_job: rJob.rows,
      por_cluster: rCluster.rows,
      por_warehouse: rWarehouse.rows,
      por_model_serving: rModelServing.rows,
    });
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/databricks-coleta/budgets', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM databricks_budgets ORDER BY nome`);
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

// Validação compartilhada por POST/PUT — escopo por tag (custom_tags, ex: projeto/time/
// centro de custo) além de workspace/global, e threshold de alerta/crítico configuráveis
// por orçamento (antes fixos em 75%/90% direto no código de _computeAlertasDatabricks).
function _validarBudgetInput(body) {
  const { nome, valor_mensal, ativo } = body;
  let { escopo_tipo, workspace_id, tag_key, tag_valor, usuario, threshold_atencao, threshold_critico } = body;
  if (!nome || !valor_mensal) return { error: 'nome e valor_mensal são obrigatórios' };
  escopo_tipo = escopo_tipo || (workspace_id ? 'workspace' : 'global');
  if (!['global', 'workspace', 'tag', 'workspace_por_usuario', 'usuario'].includes(escopo_tipo)) return { error: 'escopo_tipo inválido' };
  if (escopo_tipo === 'workspace' && !workspace_id) return { error: 'workspace_id é obrigatório para escopo "workspace"' };
  if (escopo_tipo === 'tag' && (!tag_key || !tag_valor)) return { error: 'tag_key e tag_valor são obrigatórios para escopo "tag"' };
  if (escopo_tipo === 'workspace_por_usuario' && !workspace_id) return { error: 'workspace_id é obrigatório para escopo "workspace_por_usuario"' };
  if (escopo_tipo === 'usuario' && !usuario) return { error: 'usuario é obrigatório para escopo "usuario"' };
  // workspace_id sobrevive em 'workspace_por_usuario' (define de qual ws e o
  // teto) e e OPCIONAL em 'usuario' (restringe a excecao aquele workspace).
  if (!['workspace', 'workspace_por_usuario', 'usuario'].includes(escopo_tipo)) workspace_id = null;
  if (escopo_tipo !== 'usuario') usuario = null;
  if (escopo_tipo !== 'tag') { tag_key = null; tag_valor = null; }
  threshold_atencao = threshold_atencao != null ? parseFloat(threshold_atencao) : 75;
  threshold_critico = threshold_critico != null ? parseFloat(threshold_critico) : 90;
  if (!(threshold_atencao > 0 && threshold_atencao < 100)) return { error: 'threshold_atencao deve estar entre 0 e 100' };
  if (!(threshold_critico > threshold_atencao && threshold_critico <= 100)) return { error: 'threshold_critico deve ser maior que threshold_atencao e no máximo 100' };
  return { value: { nome, escopo_tipo, workspace_id: workspace_id || null, tag_key, tag_valor, usuario: usuario || null, valor_mensal, threshold_atencao, threshold_critico, ativo: ativo !== false } };
}

app.post('/api/databricks-coleta/budgets', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const v = _validarBudgetInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const b = v.value;
    const r = await pool.query(
      `INSERT INTO databricks_budgets (nome, escopo_tipo, workspace_id, tag_key, tag_valor, usuario, valor_mensal, threshold_atencao, threshold_critico, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.nome, b.escopo_tipo, b.workspace_id, b.tag_key, b.tag_valor, b.usuario, b.valor_mensal, b.threshold_atencao, b.threshold_critico, b.ativo]
    );
    res.json(r.rows[0]);
  } catch (e) { _dbErr(res, e); }
});

app.put('/api/databricks-coleta/budgets/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const v = _validarBudgetInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const b = v.value;
    const r = await pool.query(
      `UPDATE databricks_budgets SET nome=$1, escopo_tipo=$2, workspace_id=$3, tag_key=$4, tag_valor=$5, usuario=$6, valor_mensal=$7, threshold_atencao=$8, threshold_critico=$9, ativo=$10, atualizado_em=NOW() WHERE id=$11 RETURNING *`,
      [b.nome, b.escopo_tipo, b.workspace_id, b.tag_key, b.tag_valor, b.usuario, b.valor_mensal, b.threshold_atencao, b.threshold_critico, b.ativo, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { _dbErr(res, e); }
});

// ─── COTAS (consumo x teto) ───────────────────────────────────────────────────
// Alimenta a aba "Cotas", o semaforo trazido do cockpit "Gestao de Cotas".
//
// Diferenca essencial para o cockpit original: la os percentuais vinham
// prontos numa planilha, DESCOLADOS das linhas de consumo -- auditado e
// medido: o declarado chegava a 28x o que as linhas sustentavam. Aqui o
// percentual e sempre DERIVADO de databricks_consumo, que ja e coletado.
// Nao existe caminho onde a % venha de outro lugar que nao a soma real.
//
// Devolve duas listas para o mes corrente:
//   por_workspace -> consumo do ws x cota do orcamento de escopo 'workspace'
//   por_usuario   -> consumo do usuario x teto aplicavel, que e o mais
//                    especifico entre um orcamento 'usuario' (excecao
//                    individual) e o 'workspace_por_usuario' do ws dele.
function _cotaStatus(pct, thAtencao, thCritico) {
  if (pct == null) return 'sem_cota';
  if (pct >= 100) return 'estourado';
  if (pct >= thCritico) return 'critico';
  if (pct >= thAtencao) return 'atencao';
  return 'ok';
}

// Recorte de datas dos filtros de Cotas. O cockpit oferece periodos livres
// (todos / hoje / mes atual / 7 / 30 / 90 dias / este ano / personalizado),
// entao a rota aceita um intervalo em vez de so um mes. Sem data nenhuma =
// "Todos os periodos", que e o padrao do cockpit. `mes=YYYY-MM` continua
// aceito como atalho de um mes fechado.
function _cotasPeriodo(q) {
  const dia = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const di = dia(q.data_inicio), df = dia(q.data_fim);
  if (di || df) {
    const w = [], p = [];
    if (di) { p.push(di); w.push(`usage_date >= $${p.length}`); }
    if (df) { p.push(df); w.push(`usage_date <= $${p.length}`); }
    return { where: 'WHERE ' + w.join(' AND '), params: p };
  }
  if (typeof q.mes === 'string' && /^\d{4}-\d{2}$/.test(q.mes)) {
    return {
      where: `WHERE usage_date >= $1 AND usage_date < ($1::date + INTERVAL '1 month')`,
      params: [q.mes + '-01'],
    };
  }
  return { where: '', params: [] };
}

app.get('/api/databricks-coleta/cotas', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const _janela = _cotasPeriodo(req.query);

    // mesma restricao das series: a tela e dedicada ao Genie. `produto_origem`
    // nao tem um valor "GENIE" -- quem identifica e o sku_name.
    if (String(req.query.genie || '') === '1') {
      _janela.where = (_janela.where ? _janela.where + ' AND ' : 'WHERE ') + `sku_name ILIKE '%GENIE%'`;
    }

    const [budgets, consWs, consUser, meses] = await Promise.all([
      // ORDER BY id: podem existir dois orcamentos ativos para o mesmo escopo
      // (nada impede hoje). Sem ordem explicita o Postgres nao garante qual vem
      // primeiro, e o .find() abaixo escolheria um deles a cada request --
      // o percentual exibido mudaria sozinho entre recargas. Fixado no mais
      // antigo, que e o previsivel para quem configurou primeiro.
      pool.query(`SELECT * FROM databricks_budgets WHERE ativo = true ORDER BY id`),
      // free x pago: mesma heuristica ja usada por free_vs_pago em /resumo
      // (SKU com FREE no nome ou custo zerado). Alimenta os dois medidores de
      // DBU do modal de detalhe -- o card de custo esconde o volume free, que
      // sempre custa zero por definicao mas consome DBU de verdade.
      pool.query(`SELECT workspace_id, COALESCE(SUM(custo_estimado),0) AS custo,
                         COALESCE(SUM(usage_quantity),0) AS dbus,
                         COALESCE(SUM(CASE WHEN sku_name ILIKE '%FREE%' OR custo_estimado = 0
                                           THEN usage_quantity ELSE 0 END),0) AS dbus_free,
                         COALESCE(SUM(CASE WHEN NOT (sku_name ILIKE '%FREE%' OR custo_estimado = 0)
                                           THEN usage_quantity ELSE 0 END),0) AS dbus_pago
                  FROM databricks_consumo ${_janela.where}
                  GROUP BY workspace_id`, _janela.params),
      pool.query(`SELECT workspace_id, COALESCE(usuario,'') AS usuario,
                         COALESCE(SUM(custo_estimado),0) AS custo,
                         COALESCE(SUM(usage_quantity),0) AS dbus,
                         COALESCE(SUM(CASE WHEN sku_name ILIKE '%FREE%' OR custo_estimado = 0
                                           THEN usage_quantity ELSE 0 END),0) AS dbus_free,
                         COALESCE(SUM(CASE WHEN NOT (sku_name ILIKE '%FREE%' OR custo_estimado = 0)
                                           THEN usage_quantity ELSE 0 END),0) AS dbus_pago
                  FROM databricks_consumo ${_janela.where}
                  GROUP BY workspace_id, usuario`, _janela.params),
      // meses DENTRO do recorte escolhido -- e por eles que a cota mensal e
      // escalada logo abaixo. Global daria o numero errado em qualquer
      // periodo que nao fosse "todos".
      pool.query(`SELECT DISTINCT to_char(usage_date,'YYYY-MM') AS mes
                  FROM databricks_consumo ${_janela.where} ORDER BY 1 DESC`, _janela.params),
    ]);

    const bs = budgets.rows;
    const num = (v, d) => (v != null ? parseFloat(v) : d);
    // A cota cadastrada e MENSAL. Num recorte que atravessa varios meses, medir
    // o acumulado contra o teto de UM mes inflaria o percentual na proporcao do
    // periodo -- entao a cota e escalada pelo numero de meses com dado dentro
    // do recorte. Para recortes menores que um mes o fator e 1: o percentual
    // passa a ler "quanto da cota do mes esse periodo ja queimou", que e a
    // leitura util. A tela diz qual dos dois casos esta valendo.
    const mesesConsid = Math.max(1, meses.rows.length);

    // --- workspaces ---
    const porWs = consWs.rows.map(r => {
      const b = bs.find(x => x.escopo_tipo === 'workspace' && x.workspace_id === r.workspace_id);
      const custo = parseFloat(r.custo);
      const cota = b ? parseFloat(b.valor_mensal) * mesesConsid : null;
      const pct = cota > 0 ? (custo / cota) * 100 : null;
      return {
        workspace_id: r.workspace_id,
        custo, dbus: parseFloat(r.dbus),
        dbus_free: parseFloat(r.dbus_free), dbus_pago: parseFloat(r.dbus_pago),
        cota, pct,
        budget_nome: b ? b.nome : null,
        status: _cotaStatus(pct, num(b && b.threshold_atencao, 75), num(b && b.threshold_critico, 90)),
      };
    }).sort((a, b2) => b2.custo - a.custo);

    // --- usuarios ---
    // Teto aplicavel = o mais especifico: um orcamento 'usuario' vence o
    // 'workspace_por_usuario' do workspace dele. Entre dois de escopo
    // 'usuario', o que amarra workspace vence o global daquele usuario.
    const porUser = consUser.rows.map(r => {
      const indivWs = bs.find(x => x.escopo_tipo === 'usuario' && x.usuario === r.usuario && x.workspace_id === r.workspace_id);
      const indiv   = indivWs || bs.find(x => x.escopo_tipo === 'usuario' && x.usuario === r.usuario && !x.workspace_id);
      const doWs    = bs.find(x => x.escopo_tipo === 'workspace_por_usuario' && x.workspace_id === r.workspace_id);
      const b = indiv || doWs;
      const custo = parseFloat(r.custo);
      const limite = b ? parseFloat(b.valor_mensal) * mesesConsid : null;
      const pct = limite > 0 ? (custo / limite) * 100 : null;
      return {
        workspace_id: r.workspace_id,
        usuario: r.usuario || '(não identificado)',
        custo, limite, pct,
        dbus: parseFloat(r.dbus),
        dbus_free: parseFloat(r.dbus_free), dbus_pago: parseFloat(r.dbus_pago),
        origem_limite: b ? (indiv ? 'individual' : 'workspace') : null,
        budget_nome: b ? b.nome : null,
        status: _cotaStatus(pct, num(b && b.threshold_atencao, 75), num(b && b.threshold_critico, 90)),
      };
    }).sort((a, b2) => b2.custo - a.custo);

    const comCota = porWs.filter(w => w.cota != null);
    res.json({
      // meses realmente cobertos pelo recorte -- a tela usa pra dizer se o
      // percentual esta medido contra uma cota mensal ou contra N meses
      meses_disponiveis: meses.rows.map(r => r.mes),
      meses_considerados: mesesConsid,
      por_workspace: porWs,
      por_usuario: porUser,
      resumo: {
        custo_total: porWs.reduce((a, w) => a + w.custo, 0),
        cota_total: comCota.reduce((a, w) => a + w.cota, 0),
        workspaces_sem_cota: porWs.length - comCota.length,
        usuarios_acima_do_limite: porUser.filter(u => u.status === 'estourado').length,
      },
    });
  } catch (e) { _dbErr(res, e); }
});

// Serie DIARIA que alimenta os dois graficos da aba Cotas (porte do usageChart
// e do productChart do cockpit v56). Separada de /cotas de proposito: so e
// consultada quando ha exatamente 1 workspace ou 1 usuario selecionado no
// filtro -- somar dias de varios workspaces numa serie so nao diria nada, e a
// "cota" viraria uma soma sem significado.
app.get('/api/databricks-coleta/cotas-serie', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    // mesmo recorte livre de /cotas (todos / hoje / N dias / este ano / ...)
    const _janela = _cotasPeriodo(req.query);
    const ws = req.query.workspace_id ? String(req.query.workspace_id) : null;
    const usuario = req.query.usuario != null ? String(req.query.usuario) : null;
    // A tela de Cotas e dedicada ao Genie. `produto_origem` NAO tem um valor
    // "GENIE" (so INTERACTIVE/SQL/JOBS/MODEL_SERVING) -- o que identifica Genie
    // e o sku_name (GENIE_FREE_USAGE). Nome fixo aqui, nunca vindo do request.
    const soGenie = String(req.query.genie || '') === '1';

    const params = [..._janela.params];
    const cond = _janela.where ? [_janela.where.replace(/^WHERE /, '')] : [];
    if (soGenie) cond.push(`sku_name ILIKE '%GENIE%'`);

    const serie = async (extraCond, extraParams) => {
      const p = params.concat(extraParams);
      const w = cond.concat(extraCond);
      // to_char, nao a coluna DATE crua: o driver pg desserializa DATE como
      // objeto Date do Node e res.json() o serializa como ISO datetime completo
      // ("2026-08-05T03:00:00.000Z"), que o cliente teria de reparsear.
      const r = await pool.query(
        `SELECT to_char(usage_date,'YYYY-MM-DD') AS dia,
                COALESCE(SUM(custo_estimado),0) AS custo,
                COALESCE(SUM(usage_quantity),0) AS dbus,
                COALESCE(SUM(CASE WHEN sku_name ILIKE '%FREE%' OR custo_estimado = 0
                                  THEN usage_quantity ELSE 0 END),0) AS dbus_free
           FROM databricks_consumo
          ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
          GROUP BY 1 ORDER BY 1`, p);
      return r.rows.map(x => ({
        dia: x.dia, custo: parseFloat(x.custo),
        dbus: parseFloat(x.dbus), dbus_free: parseFloat(x.dbus_free),
      }));
    };

    // O MESMO usuario aparece em varios workspaces (nos dados reais, os 6
    // usuarios aparecem nos 4 workspaces). Com um workspace tambem selecionado,
    // a serie do usuario e escopada nele -- senao o grafico somaria o consumo
    // dele em workspaces que a tela nem esta mostrando, divergindo dos cartoes.
    const condUser = [`COALESCE(usuario,'') = $${params.length + 1}`];
    const parUser = [usuario];
    if (ws) { condUser.push(`workspace_id = $${params.length + 2}`); parUser.push(ws); }

    // Sem workspace escolhido a serie e a AGREGADA (todos os workspaces) em vez
    // de vazia: o painel abria com uma caixa "selecione um workspace" e passava
    // a impressao de que o grafico nao existia. A serie do usuario continua
    // exigindo um usuario -- sem um, ela seria identica a agregada acima.
    // Consumo por PRODUTO e dia (Genie, SQL, JOBS, ...) — alimenta o grafico
    // empilhado do cockpit v51. Respeita os mesmos filtros de workspace/usuario
    // do resto da rota, senao a soma das fatias nao bateria com o outro grafico.
    const condProd = ws ? [`workspace_id = $${params.length + 1}`] : [];
    const parProd = ws ? [ws] : [];
    if (usuario != null) {
      condProd.push(`COALESCE(usuario,'') = $${params.length + parProd.length + 1}`);
      parProd.push(usuario);
    }
    const prodSql = `SELECT COALESCE(NULLIF(produto_origem,''),'Não informado') AS produto,
                            to_char(usage_date,'YYYY-MM-DD') AS dia,
                            COALESCE(SUM(custo_estimado),0) AS custo,
                            COALESCE(SUM(usage_quantity),0) AS dbus
                       FROM databricks_consumo
                      ${cond.concat(condProd).length ? 'WHERE ' + cond.concat(condProd).join(' AND ') : ''}
                      GROUP BY 1, 2 ORDER BY 2`;

    const [porDiaWs, porDiaUser, porProduto] = await Promise.all([
      ws ? serie([`workspace_id = $${params.length + 1}`], [ws]) : serie([], []),
      usuario != null ? serie(condUser, parUser) : Promise.resolve([]),
      pool.query(prodSql, params.concat(parProd)),
    ]);

    res.json({
      workspace: porDiaWs,
      usuario: porDiaUser,
      produto: porProduto.rows.map(r => ({
        produto: r.produto, dia: r.dia,
        custo: parseFloat(r.custo), dbus: parseFloat(r.dbus),
      })),
    });
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/databricks-coleta/budgets/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM databricks_budgets WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

// Alerta de estouro — soma custo_estimado do mês corrente por orçamento ativo, escopado
// por workspace_id OU por tag (custom_tags->>tag_key = tag_valor) conforme escopo_tipo do
// orçamento (ver migração de databricks_budgets acima) — retorna só os que passam do
// próprio threshold_atencao do orçamento (antes um valor fixo de 75% pra todos). Extraído
// pra função compartilhada (2026-08-26) — usada tanto por esta rota (dashboard, sob
// demanda) quanto por _checkOrcamentosDatabricks() (checagem periódica pra e-mail, ver
// seção EMAIL) — mesma regra de severidade/threshold nos dois lugares, sem duplicar.
async function _computeAlertasDatabricks() {
  const budgets = (await pool.query(`SELECT * FROM databricks_budgets WHERE ativo = true`)).rows;
  if (!budgets.length) return [];

  const inicioMes = new Date();
  inicioMes.setDate(1);
  const inicioMesStr = inicioMes.toISOString().slice(0, 10);

  const alertas = [];
  for (const b of budgets) {
    const params = [inicioMesStr];
    let sql = `SELECT COALESCE(SUM(custo_estimado),0) AS custo FROM databricks_consumo WHERE usage_date >= $1`;
    if (b.escopo_tipo === 'workspace' && b.workspace_id) {
      sql += ` AND workspace_id = $2`; params.push(b.workspace_id);
    } else if (b.escopo_tipo === 'tag' && b.tag_key && b.tag_valor) {
      params.push(b.tag_key, b.tag_valor);
      sql += ` AND custom_tags ->> $2 = $3`;
    } else if (b.escopo_tipo === 'usuario' && b.usuario) {
      sql += ` AND usuario = $2`; params.push(b.usuario);
      if (b.workspace_id) { sql += ` AND workspace_id = $3`; params.push(b.workspace_id); }
    } else if (b.escopo_tipo === 'workspace_por_usuario' && b.workspace_id) {
      // O teto vale para CADA usuario, entao o que interessa aqui e o MAIOR
      // consumo individual do workspace -- nao a soma. Somar diria que o
      // workspace estourou quando na verdade ninguem passou do proprio limite.
      sql = `SELECT COALESCE(MAX(c),0) AS custo FROM (
               SELECT COALESCE(SUM(custo_estimado),0) AS c FROM databricks_consumo
               WHERE usage_date >= $1 AND workspace_id = $2 GROUP BY usuario
             ) t`;
      params.push(b.workspace_id);
    }
    const r = await pool.query(sql, params);
    const custoAtual = parseFloat(r.rows[0].custo);
    const valorMensal = parseFloat(b.valor_mensal);
    const pct = valorMensal > 0 ? custoAtual / valorMensal : 0;
    const thAtencao = parseFloat(b.threshold_atencao) / 100;
    const thCritico = parseFloat(b.threshold_critico) / 100;
    if (pct < thAtencao) continue;
    const severidade = pct >= 1 ? 'estourado' : pct >= thCritico ? 'critico' : 'atencao';
    alertas.push({ budget: b, custo_atual: custoAtual, pct, severidade });
  }
  alertas.sort((a, b) => b.pct - a.pct);
  return alertas;
}

app.get('/api/databricks-coleta/alertas', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    res.json(await _computeAlertasDatabricks());
  } catch (e) { _dbErr(res, e); }
});

// Chaves/valores de custom_tags já vistos em databricks_consumo — alimenta o dropdown de
// "Escopo por tag" do modal de orçamento (evita texto livre propenso a erro de digitação,
// ex: "projeto" vs "Projeto" nunca baterem no filtro). custom_tags é JSONB de estrutura
// livre (cada linha pode ter chaves diferentes — ver "Granularidade por recurso"), então
// não dá pra saber as chaves de antemão; jsonb_object_keys() precisa de LATERAL/CROSS JOIN
// pra expandir por linha.
app.get('/api/databricks-coleta/tags', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT chave FROM databricks_consumo, LATERAL jsonb_object_keys(custom_tags) AS chave
      WHERE custom_tags IS NOT NULL ORDER BY 1
    `);
    res.json(r.rows.map(row => row.chave));
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/databricks-coleta/tags/:chave/valores', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT custom_tags ->> $1 AS valor FROM databricks_consumo
       WHERE custom_tags ? $1 ORDER BY 1`,
      [req.params.chave]
    );
    res.json(r.rows.map(row => row.valor).filter(v => v != null));
  } catch (e) { _dbErr(res, e); }
});

// ── Execuções de Job — tempo + custo (2026-08-29, pedido do usuário) ───────────────────
// Lista databricks_job_runs (coletado de system.lakeflow.job_run_timeline — ver
// _coletarJobRunsDatabricks) com o custo de cada run calculado em LEITURA via subquery
// correlacionada contra databricks_consumo.usage_metadata->>'job_run_id' (campo já
// capturado desde a Fase 2, sem nenhuma mudança na coleta de billing — índice funcional
// parcial em idx_databricks_consumo_job_run_id cobre esse JOIN). `custo_estimado` retorna
// `null` (não 0) quando não há nenhuma linha de billing com esse job_run_id — a
// documentação oficial confirma que usage_metadata.job_run_id só é populado pra jobs em
// job compute/serverless compute, NUNCA pra jobs num cluster all-purpose; 0 sugeriria
// "rodou de graça", null deixa claro que o dado simplesmente não está disponível.
// Range padrão menor (7 dias, não os 6 meses do /resumo) — job runs são por EXECUÇÃO
// (podem ser centenas por dia num workspace ativo), volume bem maior que billing diário.
app.get('/api/databricks-coleta/job-runs', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, job_id, workspace_id, result_state } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 7);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `jr.iniciado_em >= $1 AND jr.iniciado_em < $2::date + INTERVAL '1 day'`;
    const params = [data_inicio, data_fim];
    if (job_id) { params.push(job_id); where += ` AND jr.job_id = $${params.length}`; }
    if (workspace_id) { params.push(workspace_id); where += ` AND jr.workspace_id = $${params.length}`; }
    if (result_state) { params.push(result_state); where += ` AND jr.result_state = $${params.length}`; }

    const r = await pool.query(
      `SELECT jr.workspace_id, jr.job_id, jr.run_id, jr.job_name, jr.run_name, jr.run_type, jr.trigger_type,
              jr.iniciado_em, jr.concluido_em, jr.duracao_segundos, jr.result_state, jr.termination_code,
              (SELECT SUM(dc.custo_estimado) FROM databricks_consumo dc
                WHERE dc.usage_metadata ->> 'job_run_id' = jr.run_id) AS custo_estimado
       FROM databricks_job_runs jr
       WHERE ${where}
       ORDER BY jr.iniciado_em DESC
       LIMIT 200`,
      params
    );
    res.json({
      periodo: { inicio: data_inicio, fim: data_fim },
      tem_dados: r.rows.length > 0,
      total: r.rows.length,
      runs: r.rows,
    });
  } catch (e) { _dbErr(res, e); }
});

// ── Utilização de Cluster (2026-08-29, auditoria) — ver _coletarUtilizacaoDatabricks.
// Ordenado por avg_cpu_percent ASC (clusters mais OCIOSOS primeiro) — a feature existe
// pra chamar atenção pra rightsizing, não pra listar em ordem alfabética/de custo.
// `ocioso` (threshold 15% de CPU em uso) é uma constante do servidor, não configurável
// ainda — nenhum dado real disponível pra calibrar um threshold "correto" pra este
// ambiente, 15% é um ponto de partida conservador (clusters legitimamente idle costumam
// ficar bem abaixo disso, não perto do limiar).
const _CLUSTER_OCIOSO_CPU_PCT = 15;
app.get('/api/databricks-coleta/cluster-utilizacao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, workspace_id } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `dia >= $1 AND dia <= $2`;
    const params = [data_inicio, data_fim];
    if (workspace_id) { params.push(workspace_id); where += ` AND workspace_id = $${params.length}`; }

    const r = await pool.query(
      `SELECT workspace_id, cluster_id, MAX(cluster_name) AS cluster_name, MAX(owned_by) AS owned_by,
              AVG(avg_cpu_percent) AS avg_cpu_percent, AVG(avg_mem_percent) AS avg_mem_percent,
              COUNT(*) AS dias_observados
       FROM databricks_cluster_utilizacao
       WHERE ${where}
       GROUP BY workspace_id, cluster_id
       ORDER BY avg_cpu_percent ASC NULLS LAST
       LIMIT 100`,
      params
    );
    const clusters = r.rows.map(c => ({ ...c, ocioso: c.avg_cpu_percent != null && Number(c.avg_cpu_percent) < _CLUSTER_OCIOSO_CPU_PCT }));
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, tem_dados: clusters.length > 0, total: clusters.length, threshold_ocioso_pct: _CLUSTER_OCIOSO_CPU_PCT, clusters });
  } catch (e) { _dbErr(res, e); }
});

// ── Custo por Query em SQL Warehouse (2026-08-29, auditoria) — ver
// _coletarQueryHistoryDatabricks. `custo_estimado` é uma ALOCAÇÃO PROPORCIONAL (não um
// valor exato como em Job Runs, que tem job_run_id direto no billing): system.query.history
// não tem coluna de custo própria (confirmado na documentação oficial), então o custo
// diário do warehouse (databricks_consumo) é dividido entre as queries daquele dia na
// proporção da duração de cada uma — mesmo espírito de rateio já usado em RN-DB-001
// (cluster Databricks) e no cálculo de "custo médio pra período" da Calculadora Azure,
// nunca um valor de billing exato por query.
app.get('/api/databricks-coleta/query-history', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, warehouse_id, executed_by } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 7);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `q.iniciado_em >= $1 AND q.iniciado_em < $2::date + INTERVAL '1 day'`;
    const params = [data_inicio, data_fim];
    if (warehouse_id) { params.push(warehouse_id); where += ` AND q.warehouse_id = $${params.length}`; }
    if (executed_by) { params.push(executed_by); where += ` AND q.executed_by = $${params.length}`; }

    const r = await pool.query(
      `WITH warehouse_daily_cost AS (
         SELECT usage_metadata->>'warehouse_id' AS warehouse_id, usage_date, SUM(custo_estimado) AS custo_dia
         FROM databricks_consumo WHERE usage_metadata->>'warehouse_id' IS NOT NULL GROUP BY 1, 2
       ),
       query_daily_duration AS (
         SELECT warehouse_id, CAST(iniciado_em AS DATE) AS dia, SUM(duracao_total_ms) AS soma_duracao_dia
         FROM databricks_query_history WHERE warehouse_id IS NOT NULL GROUP BY 1, 2
       )
       SELECT q.workspace_id, q.statement_id, q.warehouse_id, q.statement_type, q.executed_by,
              q.iniciado_em, q.concluido_em, q.duracao_total_ms, q.execution_status,
              CASE WHEN qd.soma_duracao_dia > 0 AND wc.custo_dia IS NOT NULL
                   THEN wc.custo_dia * (q.duracao_total_ms::numeric / qd.soma_duracao_dia)
                   ELSE NULL END AS custo_estimado
       FROM databricks_query_history q
       LEFT JOIN query_daily_duration qd ON qd.warehouse_id = q.warehouse_id AND qd.dia = CAST(q.iniciado_em AS DATE)
       LEFT JOIN warehouse_daily_cost wc ON wc.warehouse_id = q.warehouse_id AND wc.usage_date = CAST(q.iniciado_em AS DATE)
       WHERE ${where}
       ORDER BY q.iniciado_em DESC
       LIMIT 200`,
      params
    );
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, tem_dados: r.rows.length > 0, total: r.rows.length, queries: r.rows });
  } catch (e) { _dbErr(res, e); }
});

// ── AI Gateway — volume de modelos externos (2026-08-29, auditoria) — ver
// _coletarAiGatewayDatabricks. SEM campo de custo — a documentação oficial confirma que
// system.ai_gateway.usage não tem coluna de USD/spend (Databricks não sabe quanto o
// provedor externo cobra); só volume de tokens/requisições.
app.get('/api/databricks-coleta/ai-gateway-usage', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, workspace_id } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `dia >= $1 AND dia <= $2`;
    const params = [data_inicio, data_fim];
    if (workspace_id) { params.push(workspace_id); where += ` AND workspace_id = $${params.length}`; }

    const r = await pool.query(
      `SELECT destination_name, destination_model,
              SUM(requisicoes) AS requisicoes, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM databricks_ai_gateway_usage
       WHERE ${where}
       GROUP BY 1, 2
       ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
       LIMIT 20`,
      params
    );
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, tem_dados: r.rows.length > 0, total: r.rows.length, destinos: r.rows });
  } catch (e) { _dbErr(res, e); }
});

// ── Otimização de Storage / Predictive Optimization (2026-08-29, auditoria) — ver
// _coletarStorageOtimizacaoDatabricks. usage_quantity em ESTIMATED_DBU (documentação
// oficial confirma que é estimativa quando operações dividem recursos de cluster).
app.get('/api/databricks-coleta/storage-otimizacao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    let { data_inicio, data_fim, workspace_id } = req.query;
    if (!_DATE_RE.test(data_inicio || '') || !_DATE_RE.test(data_fim || '')) {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setDate(ini.getDate() - 30);
      data_fim = fim.toISOString().slice(0, 10);
      data_inicio = ini.toISOString().slice(0, 10);
    }
    let where = `iniciado_em >= $1 AND iniciado_em < $2::date + INTERVAL '1 day'`;
    const params = [data_inicio, data_fim];
    if (workspace_id) { params.push(workspace_id); where += ` AND workspace_id = $${params.length}`; }

    const r = await pool.query(
      `SELECT catalog_name, schema_name, table_name, operation_type,
              COUNT(*) AS operacoes, COALESCE(SUM(usage_quantity),0) AS dbus,
              SUM(CASE WHEN operation_status = 'SUCCESSFUL' THEN 1 ELSE 0 END) AS sucesso
       FROM databricks_storage_otimizacao
       WHERE ${where}
       GROUP BY 1, 2, 3, 4
       ORDER BY dbus DESC
       LIMIT 50`,
      params
    );
    res.json({ periodo: { inicio: data_inicio, fim: data_fim }, tem_dados: r.rows.length > 0, total: r.rows.length, operacoes: r.rows });
  } catch (e) { _dbErr(res, e); }
});

// ── Anomaly Detection (2026-08-28, pedido do usuário) ──────────────────────────────────
// Dois tipos de anomalia, escolhidos pelo que o dado atual (databricks_consumo) realmente
// permite detectar com confiança estatística — "consumo noturno"/"job anormal" do prompt
// original ficaram de fora: exigiriam granularidade de horário (usage_date é DATE, sem
// hora) ou inventário de jobs (não coletado, ver Fase C não implementada), nenhum dos dois
// existe hoje.
//
// 1. Custo diário fora do padrão (Z-score) — série contínua de 1 variável (custo/dia),
//    caso clássico de Z-score: (valor - média) / desvio-padrão da própria janela. Rodado
//    por escopo global E por workspace (workspaces pequenos/novos não "somem" dentro da
//    média geral).
// 2. Usuário com crescimento fora do padrão — comparação de % de crescimento (janela
//    recente vs. janela histórica anterior), não Z-score: a "série" por usuário é só 2
//    números agregados (não uma série diária), Z-score exigiria aproximar variância de
//    uma soma de N dias (estatisticamente frágil) — % de crescimento é mais direto e mais
//    fácil de explicar num alerta ("consumo de X cresceu 340% essa semana").
const _ANOM_ZSCORE_THRESHOLD = 2.5;      // |z| >= 2.5 ~ eventos além de 98.7% da distribuição normal
const _ANOM_USER_GROWTH_PCT = 1.0;       // crescimento >= 100% (dobrou) vs. média histórica
const _ANOM_USER_MIN_CUSTO = 50;         // piso em R$ — evita ruído de usuário com R$2→R$6 "triplicando"

async function _computeAnomaliasDatabricks() {
  const hoje = new Date();
  const fim = hoje.toISOString().slice(0, 10);
  const recenteIni = new Date(hoje); recenteIni.setDate(recenteIni.getDate() - 6); // últimos 7 dias (inclusive hoje)
  const historicoIni = new Date(hoje); historicoIni.setDate(historicoIni.getDate() - 34); // 4 semanas antes disso
  const recenteIniStr = recenteIni.toISOString().slice(0, 10);
  const historicoIniStr = historicoIni.toISOString().slice(0, 10);

  // Custo diário — global e por workspace, últimos 35 dias (janela usada como base da
  // média/desvio). In-sample (o próprio dia entra na média) — simplificação deliberada;
  // com uma janela de 35 dias um único outlier não domina a média o suficiente pra mascarar
  // a si mesmo.
  const [rGlobal, rWs] = await Promise.all([
    pool.query(`
      WITH diario AS (
        SELECT usage_date, SUM(custo_estimado) AS custo FROM databricks_consumo
        WHERE usage_date >= $1 AND usage_date <= $2 GROUP BY 1
      ), stats AS (SELECT AVG(custo) AS media, STDDEV_POP(custo) AS desvio FROM diario)
      SELECT to_char(d.usage_date,'YYYY-MM-DD') AS usage_date, d.custo, s.media, s.desvio,
        CASE WHEN s.desvio > 0 THEN (d.custo - s.media) / s.desvio ELSE 0 END AS zscore
      FROM diario d, stats s ORDER BY d.usage_date
    `, [historicoIniStr, fim]),
    pool.query(`
      WITH diario AS (
        SELECT workspace_id, usage_date, SUM(custo_estimado) AS custo FROM databricks_consumo
        WHERE usage_date >= $1 AND usage_date <= $2 GROUP BY 1, 2
      ), stats AS (SELECT workspace_id, AVG(custo) AS media, STDDEV_POP(custo) AS desvio FROM diario GROUP BY 1)
      SELECT d.workspace_id, to_char(d.usage_date,'YYYY-MM-DD') AS usage_date, d.custo, s.media, s.desvio,
        CASE WHEN s.desvio > 0 THEN (d.custo - s.media) / s.desvio ELSE 0 END AS zscore
      FROM diario d JOIN stats s USING (workspace_id) ORDER BY d.workspace_id, d.usage_date
    `, [historicoIniStr, fim]),
  ]);

  const custoDiario = [];
  for (const r of rGlobal.rows) {
    if (Math.abs(parseFloat(r.zscore)) >= _ANOM_ZSCORE_THRESHOLD) {
      custoDiario.push({ escopo_tipo: 'global', escopo_valor: null, usage_date: r.usage_date, custo: parseFloat(r.custo), media: parseFloat(r.media), desvio: parseFloat(r.desvio), zscore: parseFloat(r.zscore) });
    }
  }
  for (const r of rWs.rows) {
    if (Math.abs(parseFloat(r.zscore)) >= _ANOM_ZSCORE_THRESHOLD) {
      custoDiario.push({ escopo_tipo: 'workspace', escopo_valor: r.workspace_id, usage_date: r.usage_date, custo: parseFloat(r.custo), media: parseFloat(r.media), desvio: parseFloat(r.desvio), zscore: parseFloat(r.zscore) });
    }
  }
  custoDiario.sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore));

  // Usuário — janela recente (7 dias) vs. janela histórica (4 semanas anteriores a essa).
  const rUser = await pool.query(`
    WITH recente AS (
      SELECT COALESCE(usuario,'') AS usuario, SUM(custo_estimado) AS custo, COUNT(DISTINCT usage_date) AS dias
      FROM databricks_consumo WHERE usage_date >= $1 AND usage_date <= $2 GROUP BY 1
    ), historico AS (
      SELECT COALESCE(usuario,'') AS usuario, SUM(custo_estimado) AS custo, COUNT(DISTINCT usage_date) AS dias
      FROM databricks_consumo WHERE usage_date >= $3 AND usage_date < $1 GROUP BY 1
    )
    SELECT r.usuario, r.custo AS custo_recente, r.dias AS dias_recente,
      COALESCE(h.custo, 0) AS custo_historico, COALESCE(h.dias, 0) AS dias_historico
    FROM recente r LEFT JOIN historico h USING (usuario)
  `, [recenteIniStr, fim, historicoIniStr]);

  const usuarios = [];
  for (const r of rUser.rows) {
    const custoRecente = parseFloat(r.custo_recente);
    if (custoRecente < _ANOM_USER_MIN_CUSTO) continue;
    const diasRecente = parseInt(r.dias_recente, 10) || 1;
    const diasHistorico = parseInt(r.dias_historico, 10);
    const mediaDiariaRecente = custoRecente / diasRecente;
    const custoHistorico = parseFloat(r.custo_historico);
    const mediaDiariaHistorica = diasHistorico > 0 ? custoHistorico / diasHistorico : 0;
    // sem histórico algum (usuário novo) → sinaliza como "novo usuário de alto custo" (crescimento_pct null),
    // não um crescimento percentual (base 0 tornaria qualquer custo um "infinito%")
    const crescimentoPct = mediaDiariaHistorica > 0 ? (mediaDiariaRecente / mediaDiariaHistorica - 1) : null;
    const anomalo = crescimentoPct === null ? true : crescimentoPct >= _ANOM_USER_GROWTH_PCT;
    if (!anomalo) continue;
    usuarios.push({
      usuario: r.usuario || 'Não identificado',
      custo_recente: custoRecente, media_diaria_recente: mediaDiariaRecente,
      custo_historico: custoHistorico, media_diaria_historica: mediaDiariaHistorica,
      crescimento_pct: crescimentoPct,
    });
  }
  usuarios.sort((a, b) => (b.crescimento_pct ?? Infinity) - (a.crescimento_pct ?? Infinity));

  return { custo_diario: custoDiario, usuarios };
}

app.get('/api/databricks-coleta/anomalias', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    res.json(await _computeAnomaliasDatabricks());
  } catch (e) { _dbErr(res, e); }
});

// ── Quotas Genie via Databricks Account Budgets API (2026-08-28, pedido do usuário) ────
// Diferente de databricks_budgets (orçamento CALCULADO por nós sobre databricks_consumo,
// só alerta) — isto é a Budgets API NATIVA do Databricks (nível de conta,
// /api/2.1/accounts/{account_id}/budgets, resource_type=BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY,
// já que Genie roda sobre o Unity AI Gateway), que o próprio Databricks aplica — inclusive
// podendo BLOQUEAR acesso real ao Genie quando um threshold é cruzado (ação BLOCK_USAGE).
// Pesquisado via documentação oficial (WebFetch/WebSearch, 2026-08-28) — NÃO VALIDADO
// contra uma conta Databricks real (mesma ressalva de _databricksGetToken/_databricksRunQuery)
// — nomes exatos de campo da resposta (principalmente o shape de spend status) podem
// precisar de ajuste na primeira chamada real.
//
// Exige OAuth M2M de Service Principal de CONTA com a role Account Admin/escopo `billing`
// — um grant bem mais alto que o já usado pra ler System Tables (USE SCHEMA+SELECT, a
// nível de dado). O modo PAT (workspace-level) não serve pra API de conta — rejeitado
// explicitamente abaixo com uma mensagem que explica o motivo, em vez de uma falha de
// autenticação genérica do Databricks.
const _DBX_ACCOUNTS_BASE = 'https://accounts.azuredatabricks.net';

async function _getDbxAccountConfigRow() {
  const r = await pool.query(`SELECT * FROM databricks_coleta_config WHERE is_padrao = true LIMIT 1`);
  return r.rows[0] || null;
}

// Modo demonstração das Quotas Genie (2026-08-28) — verdadeiro sempre que NÃO existe uma
// conexão padrão em modo OAuth M2M (sem conexão nenhuma, ou só PAT). Usado pelas 5 rotas
// de genie-budgets/genie-principals abaixo pra decidir entre a Budgets API real e o
// fallback local (databricks_genie_budgets_demo) — nunca os dois ao mesmo tempo, então
// não tem como o dado fictício se misturar com um dado real.
function _dbxDemoModeNeeded(cfg) {
  return !cfg || cfg.modo_auth !== 'oauth_m2m';
}

async function _getDbxAccountCredentials() {
  const cfg = await _getDbxAccountConfigRow();
  if (!cfg) throw new Error('Nenhuma conexão Databricks configurada como padrão (Coleta Automática → Coleta Databricks).');
  if (cfg.modo_auth !== 'oauth_m2m') {
    throw new Error('A conexão padrão usa modo PAT (workspace-level). Quotas Genie usam a API de conta do Databricks, que exige OAuth M2M de Service Principal de CONTA com role Account Admin — configure uma conexão em modo OAuth M2M e marque como padrão.');
  }
  const accountId = _safeDecrypt(cfg.account_id);
  const clientId = _safeDecrypt(cfg.client_id);
  const clientSecret = _safeDecrypt(cfg.client_secret);
  if (!accountId || !clientId || !clientSecret) throw new Error('Credenciais OAuth M2M incompletas na conexão padrão.');
  const { token } = await _databricksGetToken(accountId, clientId, clientSecret);
  return { accountId, token };
}

async function _dbxBudgetsFetch(accountId, token, path, opts = {}) {
  const resp = await _dbxFetch(`${_DBX_ACCOUNTS_BASE}/api/2.1/accounts/${accountId}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  }, 30000);
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Budgets API do Databricks falhou (${resp.status}): ${e}`); }
  return _safeRespJson(resp);
}

// Account SCIM v2.1 — usado só pra resolver e-mail/nome de grupo em principal_id (int64),
// campo exigido pelos overrides por usuário/grupo dos budgets (ver POST .../genie-budgets
// abaixo). Prefixo de path diferente da Budgets API (/api/2.0, não /api/2.1) — helper
// próprio em vez de generalizar _dbxBudgetsFetch pra não confundir as duas versões.
// NÃO VALIDADO contra uma conta Databricks real (mesma ressalva de toda a Coleta
// Databricks) — pesquisado via documentação oficial (WebSearch, 2026-08-28).
async function _dbxScimFetch(accountId, token, path) {
  const resp = await _dbxFetch(`${_DBX_ACCOUNTS_BASE}/api/2.0/accounts/${accountId}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 30000);
  if (!resp.ok) { const e = await resp.text(); throw new Error(`SCIM API do Databricks falhou (${resp.status}): ${e}`); }
  return _safeRespJson(resp);
}

// Busca usuário (por e-mail, filtro `emails.value eq`) ou grupo (por nome, filtro
// `displayName eq`) — usado pelo modal de Quota Genie pra resolver o principal_id
// (numérico, exigido pela API) a partir do que o admin realmente conhece (e-mail/nome).
// Busca fictícia (modo demonstração) — mesmo shape da resposta real do SCIM, filtrada
// por substring (não exige match exato como a busca real, já que é só pra exercitar a
// UI sem uma conta de verdade pra buscar).
const _GENIE_DEMO_PRINCIPALS = {
  user: [
    { id: '900333', nome: 'ana.silva@vivo.com.br' },
    { id: '900444', nome: 'carlos.souza@vivo.com.br' },
  ],
  group: [
    { id: '900555', nome: 'Time de Dados' },
    { id: '900666', nome: 'Time FinOps' },
  ],
};

app.get('/api/databricks-coleta/genie-principals', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { tipo, query } = req.query;
    if (!query) return res.status(400).json({ error: 'query é obrigatório' });
    const cfg = await _getDbxAccountConfigRow();
    if (_dbxDemoModeNeeded(cfg)) {
      const lista = _GENIE_DEMO_PRINCIPALS[tipo === 'group' ? 'group' : 'user'];
      return res.json(lista.filter(p => p.nome.toLowerCase().includes(String(query).toLowerCase())));
    }
    const { accountId, token } = await _getDbxAccountCredentials();
    const resource = tipo === 'group' ? 'Groups' : 'Users';
    // Busca por substring (`co`, "contains"), não mais match exato (`eq`) — confirmado
    // pelo usuário (2026-08-29) que a conta Databricks da Vivo já tem provisionamento
    // SCIM configurado a partir do Entra ID (fora do nosso app — configurado no console
    // da conta Databricks/Azure AD), então o diretório real tem muito mais usuários/grupos
    // do que os poucos usados nos testes: exigir o e-mail/nome completo e exato pra achar
    // alguém deixaria de ser prático. `userName` (não `emails.value`) pro filtro de
    // usuário — confirmado suportado com `co` na documentação oficial da Account SCIM API
    // (`userName co "doe"`); `emails.value` não tem esse suporte confirmado. Em contas
    // provisionadas via Entra ID, `userName` normalmente já é o e-mail/UPN do usuário, então
    // continua funcionando como busca "por e-mail" na prática. `count=25` (máximo
    // documentado é 100) — resultado é uma lista curta pro usuário escolher, não uma
    // listagem paginada completa.
    const filterField = tipo === 'group' ? 'displayName' : 'userName';
    const filterVal = String(query).replace(/"/g, '\\"');
    const filter = encodeURIComponent(`${filterField} co "${filterVal}"`);
    const data = await _dbxScimFetch(accountId, token, `/scim/v2/${resource}?filter=${filter}&count=25`);
    const resultados = (data.Resources || []).map(r => ({
      id: r.id,
      nome: r.displayName || r.userName || r.emails?.[0]?.value || r.id,
    }));
    res.json(resultados);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/databricks-coleta/genie-budgets', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const cfg = await _getDbxAccountConfigRow();
    if (_dbxDemoModeNeeded(cfg)) {
      const demo = await pool.query(`SELECT payload FROM databricks_genie_budgets_demo ORDER BY criado_em`);
      return res.json(demo.rows.map(r => ({ ...r.payload, _demo: true })));
    }
    const { accountId, token } = await _getDbxAccountCredentials();
    const data = await _dbxBudgetsFetch(accountId, token, '/budgets?include_spend_status=true');
    const genieBudgets = (data.budgets || []).filter(b => b.resource_type === 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY');
    res.json(genieBudgets);
  } catch (e) {
    // Erro cru é o propósito da rota (mesmo padrão de POST .../config/:id/testar) — as
    // mensagens de _getDbxAccountCredentials/_dbxBudgetsFetch explicam exatamente o que
    // falhou (modo de auth errado, credenciais incompletas, erro da API do Databricks);
    // _dbErr mascararia tudo isso pra "Erro interno do servidor.", inútil aqui.
    res.status(400).json({ error: e.message });
  }
});

// Resolve a quota Genie nativa (Budgets API, BLOCK_USAGE/EMAIL_NOTIFICATION) aplicável a um
// usuário — 2026-09-28, pedido do usuário: trazer pro gráfico "Genie · Cota e uso do
// usuário" (DatabricksCotasPanel.tsx) a quota que REALMENTE pode bloquear o Genie, distinta
// do orçamento local (databricks_budgets, só alerta). Não existe endpoint pronto pra isso —
// a Budgets API só devolve principal_id numérico nos overrides, nunca e-mail, então é
// preciso resolver e-mail → principal_id primeiro (mesma lógica de /genie-principals, mas
// com filtro exato, não substring — aqui queremos UM usuário, não uma lista pra escolher).
// Função pura por trás de GET /api/databricks-coleta/genie-quota-usuario — extraída pra ser
// reaproveitada por GET /api/public/genie-cotas (2026-09-28, visão pessoal do portal
// público), que precisa da MESMA resolução mas nunca deve confiar num e-mail vindo de query
// string (ali o e-mail vem do JWT autenticado via Entra ID, não de req.query).
async function _resolverGenieQuotaUsuario(usuario, workspaceId) {
  const cfg = await _getDbxAccountConfigRow();
  const demo = _dbxDemoModeNeeded(cfg);

  let principalId = null;
  if (demo) {
    const achado = _GENIE_DEMO_PRINCIPALS.user.find(p => p.nome.toLowerCase() === String(usuario).toLowerCase());
    principalId = achado ? achado.id : null;
  }

  let budgets;
  if (demo) {
    const rows = await pool.query(`SELECT payload FROM databricks_genie_budgets_demo ORDER BY criado_em`);
    budgets = rows.rows.map(r => r.payload);
  } else {
    const { accountId, token } = await _getDbxAccountCredentials();
    const filterVal = String(usuario).replace(/"/g, '\\"');
    const filter = encodeURIComponent(`userName eq "${filterVal}"`);
    const scim = await _dbxScimFetch(accountId, token, `/scim/v2/Users?filter=${filter}&count=1`);
    const achado = (scim.Resources || [])[0];
    principalId = achado ? achado.id : null;
    const data = await _dbxBudgetsFetch(accountId, token, '/budgets?include_spend_status=true');
    budgets = (data.budgets || []).filter(b => b.resource_type === 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY');
  }

  if (!principalId) return { limite: null, acao: null, principal_encontrado: false, demo };

  const wsNum = workspaceId ? Number(workspaceId) : null;
  const aplicaveis = [];
  for (const b of budgets) {
    const wsFiltro = b.filter?.workspace_id?.values;
    if (wsNum != null && Array.isArray(wsFiltro) && wsFiltro.length && !wsFiltro.includes(wsNum)) continue;
    for (const alerta of b.alert_configurations || []) {
      for (const ov of alerta.principal_overrides || []) {
        if (String(ov.principal_id) === String(principalId)) {
          const valor = parseFloat(ov.override_threshold ?? alerta.quantity_threshold);
          if (Number.isFinite(valor)) aplicaveis.push({ valor, acao: alerta.action_configurations?.[0]?.action_type || null });
        }
      }
    }
  }
  if (!aplicaveis.length) return { limite: null, acao: null, principal_encontrado: true, demo };
  // Mais de uma quota aplicável: a mais restritiva (menor teto) é a que dispara primeiro —
  // somar não faz sentido para um limite de bloqueio.
  aplicaveis.sort((a, b) => a.valor - b.valor);
  return { limite: aplicaveis[0].valor, acao: aplicaveis[0].acao, principal_encontrado: true, demo };
}

// 2026-09-28, pedido do usuário: trazer pro gráfico "Genie · Cota e uso do usuário"
// (DatabricksCotasPanel.tsx) a quota que REALMENTE pode bloquear o Genie, distinta do
// orçamento local (databricks_budgets, só alerta).
app.get('/api/databricks-coleta/genie-quota-usuario', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { usuario, workspace_id } = req.query;
    if (!usuario) return res.status(400).json({ error: 'usuario é obrigatório' });
    res.json(await _resolverGenieQuotaUsuario(usuario, workspace_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Validação + montagem do payload — compartilhado entre POST (criar) e PUT (atualizar,
// 2026-08-28): a Budgets API não tem PATCH parcial, PUT é substituição total do budget
// (mesmo payload de criação, só que no path /budgets/{id} em vez de /budgets). Extraído
// pra não duplicar as duas validações (BLOCK_USAGE/confirmar_bloqueio e overrides só com
// escopo per-user) entre as duas rotas.
function _validarGenieBudgetPayload(body, accountId) {
  const { display_name, workspace_ids, tags, threshold, confirmar_bloqueio, principal_overrides } = body;
  if (!display_name || !threshold?.quantity_threshold || !threshold?.scope_type || !threshold?.action_type) {
    return { error: 'display_name e threshold (quantity_threshold, scope_type, action_type) são obrigatórios' };
  }
  // Guard-rail: BLOCK_USAGE bloqueia acesso real ao Genie assim que o threshold é
  // cruzado — aplicado pelo próprio Databricks, sem nenhuma checagem nossa depois de
  // criado/atualizado. Exige confirmação explícita no BODY da requisição (não só um
  // confirm() no frontend) — quem chamar essa rota direto (curl/script) também precisa
  // declarar ciência, mesmo padrão já usado pro segundo gate do Expurgo de dados.
  if (threshold.action_type === 'BLOCK_USAGE' && !confirmar_bloqueio) {
    return { error: 'Threshold com ação BLOCK_USAGE requer confirmar_bloqueio:true no payload — essa ação bloqueia acesso real ao Genie assim que o limite é cruzado.' };
  }
  // Overrides (limite individual por usuário/grupo) só fazem sentido com escopo "por
  // usuário" — a documentação do Databricks é explícita: overrides são ignorados
  // silenciosamente em budgets de escopo compartilhado. Bloqueado aqui com uma mensagem
  // clara em vez de deixar o admin descobrir isso só depois de salvar.
  const temOverrides = Array.isArray(principal_overrides) && principal_overrides.length > 0;
  if (temOverrides && threshold.scope_type !== 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER') {
    return { error: 'Overrides por usuário/grupo só valem com escopo "Por usuário" — o Databricks os ignora silenciosamente em budgets de escopo compartilhado.' };
  }

  const filter = {};
  if (Array.isArray(workspace_ids) && workspace_ids.length) filter.workspace_id = { operator: 'IN', values: workspace_ids };
  if (Array.isArray(tags) && tags.length) filter.tags = tags.map(t => ({ key: t.key, value: { operator: 'IN', values: [t.value] } }));

  const actionConfig = { action_type: threshold.action_type };
  if (threshold.action_type === 'EMAIL_NOTIFICATION' && threshold.email_target) actionConfig.target = threshold.email_target;

  const alertConfig = {
    time_period: 'MONTH',
    trigger_type: 'CUMULATIVE_SPENDING_EXCEEDED',
    quantity_type: 'LIST_PRICE_DOLLARS_USD',
    quantity_threshold: String(threshold.quantity_threshold),
    scope_type: threshold.scope_type,
    action_configurations: [actionConfig],
  };
  if (temOverrides) {
    alertConfig.principal_overrides = principal_overrides.map(p => ({
      principal_id: Number(p.principal_id),
      override_threshold: String(p.override_threshold),
    }));
  }

  return {
    value: {
      display_name,
      account_id: accountId,
      resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
      filter,
      alert_configurations: [alertConfig],
    },
  };
}

app.post('/api/databricks-coleta/genie-budgets', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const cfg = await _getDbxAccountConfigRow();
    const demoMode = _dbxDemoModeNeeded(cfg);
    const v = _validarGenieBudgetPayload(req.body, demoMode ? 'demo-account' : _safeDecrypt(cfg.account_id));
    if (v.error) return res.status(400).json({ error: v.error });
    if (demoMode) {
      const id = 'demo-' + Date.now().toString(36);
      const payload = { budget_configuration_id: id, ...v.value };
      await pool.query(`INSERT INTO databricks_genie_budgets_demo (id, payload) VALUES ($1,$2)`, [id, JSON.stringify(payload)]);
      return res.json({ ...payload, _demo: true });
    }
    const { accountId, token } = await _getDbxAccountCredentials();
    const data = await _dbxBudgetsFetch(accountId, token, '/budgets', { method: 'POST', body: JSON.stringify({ budget: v.value }) });
    res.json(data.budget || data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT — substituição total (a Budgets API não tem PATCH parcial). budget_configuration_id
// vai no corpo além do path, como a documentação exige.
app.put('/api/databricks-coleta/genie-budgets/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const cfg = await _getDbxAccountConfigRow();
    const demoMode = _dbxDemoModeNeeded(cfg);
    const v = _validarGenieBudgetPayload(req.body, demoMode ? 'demo-account' : _safeDecrypt(cfg.account_id));
    if (v.error) return res.status(400).json({ error: v.error });
    v.value.budget_configuration_id = req.params.id;
    if (demoMode) {
      const r = await pool.query(`UPDATE databricks_genie_budgets_demo SET payload=$1, atualizado_em=NOW() WHERE id=$2 RETURNING id`, [JSON.stringify(v.value), req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Quota de demonstração não encontrada — pode já ter sido excluída.' });
      return res.json({ ...v.value, _demo: true });
    }
    const { accountId, token } = await _getDbxAccountCredentials();
    const data = await _dbxBudgetsFetch(accountId, token, `/budgets/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify({ budget: v.value }) });
    res.json(data.budget || data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/databricks-coleta/genie-budgets/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const cfg = await _getDbxAccountConfigRow();
    if (_dbxDemoModeNeeded(cfg)) {
      await pool.query(`DELETE FROM databricks_genie_budgets_demo WHERE id=$1`, [req.params.id]);
      return res.json({ ok: true });
    }
    const { accountId, token } = await _getDbxAccountCredentials();
    await _dbxBudgetsFetch(accountId, token, `/budgets/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLETA VIA AZURE BLOB STORAGE
// ══════════════════════════════════════════════════════════════════════════════

async function _storageGetToken(tenantId, clientId, clientSecret) {
  const ac  = new AbortController();
  const tid = setTimeout(() => ac.abort(), 30_000);
  try {
    const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, scope: 'https://storage.azure.com/.default'
      }).toString()
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Storage falhou (${resp.status}): ${e}`); }
    const tk = await _safeRespJson(resp);
    if (!tk.access_token) throw new Error('Token Storage: resposta sem access_token');
    return { token: tk.access_token, expiresIn: tk.expires_in || 3600 };
  } finally { clearTimeout(tid); }
}

// Getter com cache e renovação proativa (buffer de 10 min)
function _makeStorageTokenGetter(tenantId, clientId, clientSecret) {
  let _tok = null, _exp = 0;
  return async function getToken(force = false) {
    const now    = Date.now();
    const motivo = force ? 'forçado (401)' : !_tok ? 'primeiro uso' : 'buffer 10 min';
    if (force || !_tok || now >= _exp - 600_000) {
      const { token, expiresIn } = await _storageGetToken(tenantId, clientId, clientSecret);
      _tok = token; _exp = now + expiresIn * 1000;
      _logColeta(`[Token Storage] Renovado — motivo: ${motivo}, válido por ${Math.round(expiresIn / 60)} min`);
    }
    return _tok;
  };
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
    { timeoutMs: 30_000, countCbFailure: false }
  );
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Management falhou (${resp.status}): ${e}`); }
  const tkData = await _safeRespJson(resp);
  if (!tkData.access_token) throw new Error(`Token Management: resposta sem access_token`);
  return { token: tkData.access_token, expiresIn: tkData.expires_in || 3600 };
}

// Mesmo fluxo client_credentials de _managementGetToken, mas pro recurso do Microsoft
// Graph (não o ARM) — usado só pra resolver GUID→nome de autores do Activity Log (ver
// _graphResolveAutores). Exige a permissão de aplicativo Directory.Read.All concedida no
// Entra ID pra esta Service Principal — sem isso, o token até é emitido (client_credentials
// sempre emite um token), mas toda chamada ao Graph retorna 403 (verificado no momento da
// chamada, não aqui).
async function _graphGetToken(tenantId, clientId, clientSecret) {
  const resp = await _cbFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default'
      }).toString(),
    },
    { timeoutMs: 30_000, countCbFailure: false }
  );
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Microsoft Graph falhou (${resp.status}): ${e}`); }
  const tkData = await _safeRespJson(resp);
  if (!tkData.access_token) throw new Error('Token Microsoft Graph: resposta sem access_token');
  return { token: tkData.access_token, expiresIn: tkData.expires_in || 3600 };
}

// Mesmo fluxo client_credentials de _managementGetToken, mas pro recurso do Log
// Analytics Query API (api.loganalytics.io) — usado pela feature Log Analytics FinOps
// (2026-09-29) pra rodar KQL contra os workspaces descobertos via ARM. Exige o papel
// "Log Analytics Reader" (ou "Monitoring Reader") concedido a esta Service Principal —
// sem isso o token é emitido normalmente (client_credentials sempre emite), mas toda
// query retorna 403 (verificado no momento da chamada, não aqui — mesmo caveat já
// documentado em _graphGetToken).
async function _logAnalyticsGetToken(tenantId, clientId, clientSecret) {
  const resp = await _cbFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, scope: 'https://api.loganalytics.io/.default'
      }).toString(),
    },
    { timeoutMs: 30_000, countCbFailure: false }
  );
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Token Log Analytics falhou (${resp.status}): ${e}`); }
  const tkData = await _safeRespJson(resp);
  if (!tkData.access_token) throw new Error('Token Log Analytics: resposta sem access_token');
  return { token: tkData.access_token, expiresIn: tkData.expires_in || 3600 };
}

// Retorna função getToken() que renova automaticamente 10 min antes do vencimento
function _makeTokenGetter(tenantId, clientId, clientSecret) {
  let _tok = null, _exp = 0;
  return async function getToken(force = false) {
    const agoraMs = Date.now();
    const motivo = force ? 'forçado (401)' : !_tok ? 'primeiro uso' : 'buffer 10 min';
    if (force || !_tok || agoraMs >= _exp - 600_000) {
      const { token, expiresIn } = await _managementGetToken(tenantId, clientId, clientSecret);
      _tok = token;
      _exp = agoraMs + expiresIn * 1000;
      _logColeta(`[Token] Renovado — motivo: ${motivo}, válido por ${Math.round(expiresIn / 60)} min`);
    }
    return _tok;
  };
}

// Mesmo padrão de _makeTokenGetter, pro escopo do Log Analytics Query API.
function _makeLogAnalyticsTokenGetter(tenantId, clientId, clientSecret) {
  let _tok = null, _exp = 0;
  return async function getLogAnalyticsToken(force = false) {
    const agoraMs = Date.now();
    if (force || !_tok || agoraMs >= _exp - 600_000) {
      const { token, expiresIn } = await _logAnalyticsGetToken(tenantId, clientId, clientSecret);
      _tok = token;
      _exp = agoraMs + expiresIn * 1000;
    }
    return _tok;
  };
}

// Lê JSON de uma Response sem quebrar em corpo vazio (Azure retorna 200/202 vazios)
async function _safeRespJson(resp) {
  const txt = await resp.text();
  if (!txt || !txt.trim()) return {};
  try { return JSON.parse(txt); } catch (_) { return {}; }
}

// ══════════════════════════════════════════════════════════════════════════════
// INVENTÁRIO + AUDITORIA DE RECURSOS AZURE (2026-08-30, pedido do usuário)
// ══════════════════════════════════════════════════════════════════════════════
// "Ontem tinha X recursos, hoje tenho X+1 — quem criou, quando, quanto custa." Fonte
// (2026-09-03, "Inventário 2.0" — ver `_resourceGraphFetchChanges`): Azure Resource Graph
// Change Analysis, mesma credencial ARM (Service Principal com role Reader) já usada pra
// Cost Management/Resource Graph — nenhuma role nova precisa ser concedida. Substitui o
// Activity Log original: além de criação/atualização/exclusão, Change Analysis grava
// nativamente o antes/depois de propriedade (usado aqui pra SKU de VM, sem round-trip
// extra), e "quem mudou" já vem como e-mail na maioria dos casos.
//
// Retenção nativa da Change Analysis é 14 dias — por isso a janela de coleta nunca busca
// mais que 13 dias pra trás (margem de segurança de 1 dia), e por isso um recurso criado
// antes da primeira coleta deste sistema nunca vai ter `criado_por` conhecido (dado que não
// existe mais na fonte). A Reconciliação via Resource Graph (`_reconciliarInventarioResourceGraph`,
// mais abaixo) continua sendo o único jeito de descobrir recursos que já existiam antes da
// ativação do Inventário — Change Analysis também é um stream daqui pra frente, não um
// catálogo do passado.

// Remove eventos de auditoria mais antigos que a retenção configurada — NUNCA toca em
// azure_recursos_inventario (permanente por design, ver comentário na criação da tabela em
// ensureAzureColetaTable). Chamado ao final de toda coleta bem-sucedida.
async function _purgarAuditoriaInventario(retencaoDias) {
  const dias = Number(retencaoDias) > 0 ? Number(retencaoDias) : 180;
  const r = await pool.query(`DELETE FROM azure_recursos_auditoria_eventos WHERE quando < NOW() - ($1 || ' days')::interval`, [dias]);
  if (r.rowCount > 0) _logColetaInv(`Retenção: ${r.rowCount} evento(s) de auditoria removido(s) (> ${dias} dias)`);
}

// Opcionalmente apaga recursos já excluídos (ativo=false) há mais de N dias — desativado por
// default (comportamento de permanência). Quando ativado, só afeta recursos `ativo=false`
// (nunca toca em ativos). Não toca em `azure_recursos_auditoria_eventos` — aquela tem sua
// própria retenção, independente.
async function _purgarRecursosExcluidos(ativa, dias) {
  if (!ativa) return;
  const d = Number(dias) > 0 ? Number(dias) : 180;
  const r = await pool.query(
    `DELETE FROM azure_recursos_inventario WHERE ativo = false AND excluido_em < NOW() - ($1 || ' days')::interval`,
    [d]
  );
  if (r.rowCount > 0) _logColetaInv(`Retenção: ${r.rowCount} recurso(s) excluído(s) removido(s) do inventário (> ${d} dias)`);
}

// Resolve GUID→nome via Microsoft Graph (`directoryObjects/getByIds`, batch — até 1000 IDs
// por chamada, resolve usuário/Service Principal/grupo numa única requisição, sem precisar
// saber de antemão o tipo de cada um). Best-effort — chamado automaticamente ao final de
// toda coleta de Inventário bem-sucedida (não bloqueia a coleta principal se falhar, ex:
// Directory.Read.All ainda não concedida) e também exposto como rota manual pra popular o
// cache dos GUIDs já conhecidos sem esperar o próximo ciclo. Reusa a MESMA Service Principal
// já configurada pro Inventário — só troca o token (Graph, não ARM).
async function _graphResolveAutores() {
  const cfgRow = await pool.query(`SELECT * FROM azure_inventario_config ORDER BY id LIMIT 1`);
  const cfg = cfgRow.rows[0];
  if (!cfg || !cfg.sp_id) throw new Error('Inventário sem Service Principal configurado');
  const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [cfg.sp_id]);
  if (!spRow.rows.length) throw new Error('Service Principal do Inventário não encontrado');
  const spCfg = spRow.rows[0];
  const { token } = await _graphGetToken(_safeDecrypt(spCfg.tenant_id), _safeDecrypt(spCfg.client_id), _safeDecrypt(spCfg.client_secret));

  const rIds = await pool.query(`
    SELECT DISTINCT autor FROM (
      SELECT criado_por AS autor FROM azure_recursos_inventario WHERE criado_por IS NOT NULL
      UNION SELECT atualizado_por FROM azure_recursos_inventario WHERE atualizado_por IS NOT NULL
      UNION SELECT excluido_por FROM azure_recursos_inventario WHERE excluido_por IS NOT NULL
      UNION SELECT autor FROM azure_recursos_auditoria_eventos WHERE autor IS NOT NULL
    ) t
    WHERE autor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND autor NOT IN (SELECT guid FROM azure_autores_cache)
  `);
  const ids = rIds.rows.map(r => r.autor);
  if (!ids.length) return { resolvidos: 0, pendentes: 0 };

  let resolvidos = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const resp = await _cbFetch('https://graph.microsoft.com/v1.0/directoryObjects/getByIds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: chunk }),
    }, { timeoutMs: 30_000, countCbFailure: false });
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Microsoft Graph falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);
    for (const obj of (data.value || [])) {
      const nome = obj.displayName || obj.userPrincipalName || null;
      if (!nome || !obj.id) continue;
      const tipo = (obj['@odata.type'] || '').replace('#microsoft.graph.', '') || 'desconhecido';
      await pool.query(
        `INSERT INTO azure_autores_cache (guid, nome, tipo, resolvido_em) VALUES ($1,$2,$3,NOW())
         ON CONFLICT (guid) DO UPDATE SET nome=EXCLUDED.nome, tipo=EXCLUDED.tipo, resolvido_em=NOW()`,
        [obj.id, nome, tipo]
      );
      resolvidos++;
    }
  }
  return { resolvidos, pendentes: ids.length - resolvidos };
}

app.post('/api/azure-inventario/resolver-autores', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    res.json(await _graphResolveAutores());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Coleta incremental (watermark `ultimo_evento_em` em azure_inventario_config) — cada
// execução busca só o que aconteceu desde a última vez, nunca refaz o intervalo inteiro.
// Fire-and-forget (não relança erro pro chamador) — mesmo padrão de
// _executarColetaDatabricks: o histórico + log já capturam a falha, quem chama (rota
// manual ou o agendador) só dispara e segue, acompanhando via GET /status.
async function _coletarInventarioAzure(origem = 'manual') {
  if (_invColetaEmExecucao) throw new Error('Coleta de Inventário já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _invColetaEmExecucao = true;
  _invColetaIniciadaEm = new Date();
  _invColetaProgresso = { tipo: 'coleta', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0, eventos: 0, novos: 0, atualizados: 0, excluidos: 0, descartadas: 0, log: [] };
  let histId;
  try {
    await ensureAzureColetaTable();
    const cfgRow = await pool.query(`SELECT * FROM azure_inventario_config ORDER BY id LIMIT 1`);
    if (!cfgRow.rows.length) throw new Error('Inventário não configurado');
    const cfg = cfgRow.rows[0];
    if (!cfg.ativo) throw new Error('Inventário desativado');
    if (!cfg.sp_id) throw new Error('Nenhum Service Principal configurado para o Inventário');

    const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [cfg.sp_id]);
    if (!spRow.rows.length) throw new Error('Service Principal do Inventário não encontrado');
    const spCfg = spRow.rows[0];
    const getToken = _makeTokenGetter(_safeDecrypt(spCfg.tenant_id), _safeDecrypt(spCfg.client_id), _safeDecrypt(spCfg.client_secret));
    const token = await getToken();

    const subs = (spCfg.subscription_ids || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!subs.length) throw new Error('Nenhuma subscription configurada (nem no Inventário, nem no Service Principal escolhido)');

    // Retenção nativa da Change Analysis é 14 dias (vs. 90 do Activity Log antigo) — janela
    // nunca busca mais que 13 dias pra trás (margem de segurança de 1 dia). `ate` fica 5min no
    // passado (não `agora` puro): a documentação oficial diz que uma mudança pode levar até 5min
    // pra ser indexada — sem essa margem, uma mudança bem recente poderia cair fora da janela
    // atual E fora da próxima (o watermark já teria avançado pra depois dela), perdida pra
    // sempre. Não existia no código do Activity Log (lá o comentário já mencionava "alguns
    // minutos de atraso" mas nunca tinha sido tratado com uma margem explícita).
    const agora = new Date();
    const MAX_JANELA_MS = 13 * 24 * 60 * 60 * 1000;
    const PROPAGACAO_MS = 5 * 60 * 1000;
    const ate = new Date(agora.getTime() - PROPAGACAO_MS);
    let desde = cfg.ultimo_evento_em ? new Date(cfg.ultimo_evento_em) : new Date(ate.getTime() - 24 * 60 * 60 * 1000);
    if (ate.getTime() - desde.getTime() > MAX_JANELA_MS) desde = new Date(ate.getTime() - MAX_JANELA_MS);
    const desdeISO = desde.toISOString();
    const ateISO = ate.toISOString();

    const hist = await pool.query(
      `INSERT INTO azure_inventario_coleta_historico (status,origem,periodo_inicio,periodo_fim) VALUES ('executando',$1,$2,$3) RETURNING id`,
      [origem, desdeISO, ateISO]
    );
    histId = hist.rows[0].id;
    _logColetaInv(`Inventário — ${desdeISO} → ${ateISO} | ${subs.length} subscription(s)`);

    let totalEventos = 0, totalNovos = 0, totalAtualizados = 0, totalExcluidos = 0, totalMudancasProp = 0, totalDescartadas = 0;
    _invColetaProgresso.sub_total = subs.length;

    for (let i = 0; i < subs.length; i++) {
      const subId = subs[i];
      _invColetaProgresso.sub_idx = i + 1;
      _invColetaProgresso.sub_atual = subId;
      _invColetaProgresso.fase = `[${i + 1}/${subs.length}] Consultando Change Analysis — ${subId}`;
      let mudancas;
      try {
        mudancas = await _resourceGraphFetchChanges(token, subId, desdeISO, ateISO);
      } catch (eSub) {
        _logColetaInv(`  ✗ ${subId}: ${eSub.message}`);
        continue;
      }
      _logColetaInv(`  ${subId}: ${mudancas.length} mudança(s) retornada(s)`);
      let mudancasPropSub = 0;

      for (const ch of mudancas) {
        const resourceId = ch.targetResourceId;
        if (!resourceId || !ch.changeType) continue;

        const autor = ch.changedBy || null;
        const quando = ch.changeTime || null;
        const resourceType = ch.targetResourceType || null;
        const resourceGroup = ch.resourceGroup || null;
        totalEventos++;

        if (ch.changeType === 'Delete') {
          const nomeDel = resourceId.split('/').pop();
          const lowerResourceId = resourceId.toLowerCase();
          const existing = await pool.query(
            `SELECT id FROM azure_recursos_inventario WHERE subscription_id = $1 AND LOWER(resource_id) = $2 LIMIT 1`,
            [subId, lowerResourceId]
          );
          if (existing.rows.length > 0) {
            await pool.query(
              `UPDATE azure_recursos_inventario SET
                 nome=COALESCE(nome, $1),
                 excluido_por=$2, excluido_em=$3, ativo=false
               WHERE id = $4`,
              [nomeDel, autor, quando, existing.rows[0].id]
            );
          } else {
            await pool.query(
              `INSERT INTO azure_recursos_inventario (subscription_id,resource_id,resource_type,resource_group,nome,excluido_por,excluido_em,ativo)
               VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
              [subId, resourceId, resourceType, resourceGroup, nomeDel, autor, quando]
            );
          }
          totalExcluidos++;
          await pool.query(
            `INSERT INTO azure_recursos_auditoria_eventos (subscription_id,resource_id,resource_type,resource_group,acao,autor,quando,operation_name,correlation_id)
             VALUES ($1,$2,$3,$4,'EXCLUSAO',$5,$6,'Delete',$7)`,
            [subId, resourceId, resourceType, resourceGroup, autor, quando, ch.correlationId || null]
          );
        } else {
          const nome = resourceId.split('/').pop();
          const lowerResourceId = resourceId.toLowerCase();
          const existing = await pool.query(
            `SELECT id FROM azure_recursos_inventario WHERE subscription_id = $1 AND LOWER(resource_id) = $2 LIMIT 1`,
            [subId, lowerResourceId]
          );
          let acao;
          if (existing.rows.length > 0) {
            await pool.query(
              `UPDATE azure_recursos_inventario SET
                 atualizado_por=$1, atualizado_em=$2,
                 resource_type=COALESCE(resource_type, $3),
                 resource_group=COALESCE(resource_group, $4),
                 ativo=true
               WHERE id = $5`,
              [autor, quando, resourceType, resourceGroup, existing.rows[0].id]
            );
            acao = 'ATUALIZACAO';
            totalAtualizados++;
          } else {
            await pool.query(
              `INSERT INTO azure_recursos_inventario (subscription_id,resource_id,resource_type,resource_group,nome,criado_por,criado_em,atualizado_por,atualizado_em,ativo)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$7,true)`,
              [subId, resourceId, resourceType, resourceGroup, nome, autor, quando]
            );
            acao = 'CRIACAO';
            totalNovos++;
          }
          // `changeType` já diferencia Create de Update nativamente — não precisa mais do
          // truque `RETURNING (xmax=0)` que o Activity Log exigia (lá o mesmo evento `/write`
          // servia pros dois casos, sem como saber qual sem olhar o estado anterior da linha).
          await pool.query(
            `INSERT INTO azure_recursos_auditoria_eventos (subscription_id,resource_id,resource_type,resource_group,acao,autor,quando,operation_name,correlation_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [subId, resourceId, resourceType, resourceGroup, acao, autor, quando, ch.changeType, ch.correlationId || null]
          );

          // Alterações de Propriedade (paridade com SKU de VM + expansão — tags, disco, storage,
          // IP público, ver `_extrairMudancasRastreadas`) — o valor antes/depois já vem NO
          // MESMO evento (Change Analysis), sem precisar de uma segunda chamada ao Resource
          // Graph pra comparar contra uma última leitura conhecida (como o detector manual
          // antigo de SKU, `_detectarMudancasSku`, fazia). Mesma exclusão de RGs gerenciados por
          // Databricks/AKS de sempre, aplicada UMA vez antes do loop de propriedades — lá o
          // recurso é recriado em horas, qualquer "mudança" seria ruído de recriação, não uma
          // mudança real, vale igualmente pra tag/disco/tier quanto pra SKU de VM.
          if (acao === 'ATUALIZACAO' && !_detectManagedRg(resourceGroup || '').managed_type) {
            const propriedades = _extrairMudancasRastreadas(resourceType, ch.changes);
            // Contador de descarte (2026-09-03, item 4 das melhorias sugeridas) — quantas
            // propriedades vieram no bag da Change Analysis mas NÃO bateram na allowlist
            // curada (ruído tipo `provisioningState`/`instanceView`). Só conta eventos já
            // dentro do escopo não-gerenciado (mesmo `if` acima) — não é sobre TODO evento,
            // é sobre "quanto sinal perdemos dentro do que já íamos processar mesmo".
            totalDescartadas += Object.keys(ch.changes || {}).length - propriedades.length;
            for (const p of propriedades) {
              if (!p.valor_anterior || !p.valor_novo || p.valor_anterior === p.valor_novo) continue;
              await pool.query(
                `INSERT INTO azure_recursos_mudancas_propriedade (subscription_id,resource_id,resource_type,resource_group,propriedade,propriedade_label,valor_anterior,valor_novo,evento_autor,evento_quando)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [subId, resourceId, resourceType, resourceGroup, p.propriedade, p.propriedade_label, p.valor_anterior, p.valor_novo, autor, quando]
              );
              totalMudancasProp++;
              mudancasPropSub++;
              // Alerta por e-mail (2026-09-03, item 1) — só propriedades de infra, nunca tags
              // (ver `_alertarMudancaPropriedade`). Best-effort, nunca derruba a coleta.
              if (!p.propriedade.startsWith('tag:')) {
                _alertarMudancaPropriedade(nome, resourceGroup, p, autor, quando, { subscription_id: subId, resource_id: resourceId }).catch((eMail) => {
                  _logColetaInv(`  ✗ ${subId}: alerta por e-mail falhou — ${eMail.message}`);
                });
              }
            }
          }
        }
        _invColetaProgresso.eventos = totalEventos;
        _invColetaProgresso.novos = totalNovos;
        _invColetaProgresso.atualizados = totalAtualizados;
        _invColetaProgresso.excluidos = totalExcluidos;
        _invColetaProgresso.descartadas = totalDescartadas;
      }
      if (mudancasPropSub > 0) _logColetaInv(`  ${subId}: ${mudancasPropSub} alteração(ões) de propriedade detectada(s)`);
    }

    await pool.query(`UPDATE azure_inventario_config SET ultimo_evento_em=$1, atualizado_em=NOW() WHERE id=$2`, [ateISO, cfg.id]);
    const msg = `${totalEventos} evento(s) | ${totalNovos} novo(s), ${totalAtualizados} atualizado(s), ${totalExcluidos} excluído(s)${totalMudancasProp > 0 ? ` | ${totalMudancasProp} alteração(ões) de propriedade` : ''}${totalDescartadas > 0 ? ` | ${totalDescartadas} propriedade(s) descartada(s) (ruído)` : ''}`;
    _logColetaInv(`Concluído: ${msg}`);
    await pool.query(
      `UPDATE azure_inventario_coleta_historico SET status='concluido',concluido_em=NOW(),eventos_processados=$1,recursos_novos=$2,recursos_atualizados=$3,recursos_excluidos=$4,mensagem=$5 WHERE id=$6`,
      [totalEventos, totalNovos, totalAtualizados, totalExcluidos, msg, histId]
    );
    await _purgarAuditoriaInventario(cfg.retencao_dias);
    await _purgarRecursosExcluidos(cfg.retencao_excluidos_ativa, cfg.retencao_excluidos_dias);
    // Best-effort — nunca derruba a coleta principal (já concluída e persistida acima).
    // Falha esperada até o admin conceder Directory.Read.All no Entra ID (ver
    // _graphResolveAutores); só loga, não vira status='erro' no histórico desta coleta.
    try {
      const rGraph = await _graphResolveAutores();
      if (rGraph.resolvidos > 0) _logColetaInv(`Nomes resolvidos (Graph): ${rGraph.resolvidos}`);
    } catch (eGraph) { _logColetaInv(`Resolução de nomes (Graph) indisponível: ${eGraph.message}`); }
  } catch (err) {
    _logColetaInv(`ERRO: ${err.message}`);
    if (histId) await pool.query(
      `UPDATE azure_inventario_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1 WHERE id=$2`,
      [err.message, histId]
    ).catch(() => {});
  } finally {
    _invColetaEmExecucao = false;
    _invColetaIniciadaEm = null;
  }
}

// Reconciliação via Azure Resource Graph (2026-09-02, pedido do usuário: validou que "Por
// Assinatura" mostrava só uma fração dos recursos reais — confirmado com dados reais que só
// 0,37% dos resource_ids cobrados num único dia tinham QUALQUER registro no Inventário).
// Causa raiz: o Inventário (Activity Log) é um rastreador INCREMENTAL, não um catálogo — só
// aprende sobre um recurso quando há um evento de criação/atualização/exclusão DEPOIS da
// ativação da feature (2026-08-30). Um recurso criado meses antes e nunca mais tocado (ex:
// um disco de restore point de backup) segue cobrando todo dia sem nunca ter gerado um
// evento — invisível pro Inventário, mesmo 100% ativo. Resource Graph resolve isso porque
// lista TUDO que existe AGORA, independente de histórico — mesma permissão Reader já
// concedida à Service Principal (Resource Graph não exige nenhum grant adicional).
//
// Só ADICIONA recursos ausentes — nunca desativa um recurso que o Resource Graph não
// retornou. Deliberado: "não apareceu no Resource Graph" pode significar "foi excluído" OU
// "erro de paginação/transiente" — só o Activity Log (evento de delete real, com autor e
// timestamp) tem confiança suficiente pra marcar `ativo=false`. Reconciliação e coleta
// normal são mutuamente exclusivas (mesma flag `_invColetaEmExecucao`) — as duas escrevem
// na mesma tabela, evita condição de corrida.
// Lookup compartilhado (2026-09-02) da credencial/subscriptions configuradas pro Inventário
// — usado pelas rotas novas de Detalhe ARM e Advisor. Não usado por `_coletarInventarioAzure`/
// `_reconciliarInventarioResourceGraph` de propósito — são funções já testadas/em produção,
// evita risco de regressão só pra eliminar uma pequena duplicação.
async function _getInventarioSpConfig() {
  const cfgRow = await pool.query(`SELECT * FROM azure_inventario_config ORDER BY id LIMIT 1`);
  if (!cfgRow.rows.length) throw new Error('Inventário não configurado');
  const cfg = cfgRow.rows[0];
  if (!cfg.sp_id) throw new Error('Nenhum Service Principal configurado para o Inventário');
  const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [cfg.sp_id]);
  if (!spRow.rows.length) throw new Error('Service Principal do Inventário não encontrado');
  const spCfg = spRow.rows[0];
  const tenantId = _safeDecrypt(spCfg.tenant_id), clientId = _safeDecrypt(spCfg.client_id), clientSecret = _safeDecrypt(spCfg.client_secret);
  const getToken = _makeTokenGetter(tenantId, clientId, clientSecret);
  // Log Analytics FinOps (2026-09-29): mesma SP, escopo diferente (api.loganalytics.io) —
  // exige o papel "Log Analytics Reader" concedido à parte, ver _logAnalyticsGetToken.
  const getLogAnalyticsToken = _makeLogAnalyticsTokenGetter(tenantId, clientId, clientSecret);
  const subs = (spCfg.subscription_ids || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return { cfg, spCfg, getToken, getLogAnalyticsToken, subs };
}

// Query genérica ao Resource Graph com paginação por $skipToken (2026-09-04). Criada em vez de
// generalizar `_resourceGraphFetchRecursos` (logo abaixo): aquela tem query FIXA e é usada pela
// reconciliação, que já está em produção — mesma justificativa que levou `_getInventarioSpConfig`
// a não ser retrofitado nas funções de coleta.
// `subscriptionId` aceita 1 id ou uma lista (o Resource Graph aceita até 1000 assinaturas por chamada).
async function _resourceGraphQuery(token, subscriptionId, kql) {
  const itens = [];
  let skipToken = null;
  let paginas = 0;
  do {
    const body = {
      subscriptions: Array.isArray(subscriptionId) ? subscriptionId : [subscriptionId],
      query: kql,
      options: { $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
    };
    const resp = await _cbFetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 30_000 }
    );
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Resource Graph falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);
    for (const item of (data.data || [])) itens.push(item);
    skipToken = data.$skipToken || null;
    paginas++;
  } while (skipToken && paginas < 200);
  return itens;
}

async function _resourceGraphFetchRecursos(token, subscriptionId) {
  const recursos = [];
  let skipToken = null;
  let paginas = 0;
  do {
    const body = {
      subscriptions: [subscriptionId],
      query: 'Resources | project id, name, type, resourceGroup',
      options: { $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
    };
    const resp = await _cbFetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 30_000 }
    );
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Resource Graph falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);
    for (const item of (data.data || [])) recursos.push(item);
    skipToken = data.$skipToken || null;
    paginas++;
  } while (skipToken && paginas < 1000); // guarda-corpo generoso (até 1M recursos por subscription)
  return recursos;
}

// Mudanças de recurso via Azure Resource Graph Change Analysis (2026-09-03, "Inventário 2.0" —
// substitui o Activity Log como fonte de eventos do Inventário). Tabela `resourcechanges`,
// mesmo endpoint/api-version/permissão Reader já usados por `_resourceGraphFetchRecursos` acima
// — zero credencial nova. Diferente do Activity Log (só diz QUE um `/write` aconteceu),
// Change Analysis grava o antes/depois de cada propriedade que mudou no mesmo evento — por isso
// já extrai `vmSizeChange` (propriedade `hardwareProfile.vmSize`, a única rastreada nesta v1,
// paridade com o que o Inventário já tinha antes) direto na query, sem round-trip extra pra
// descobrir o valor. `changeType` ('Create'|'Update'|'Delete') substitui o truque antigo de
// checar `RETURNING (xmax=0)` no upsert pra decidir Criação vs. Atualização — Change Analysis já
// diferencia isso nativamente. `resourceGroup` vem como coluna própria da tabela (não precisa
// extrair do resource_id), confirmado no exemplo oficial "Resources deleted in a specific
// resource group" da documentação.
async function _resourceGraphFetchChanges(token, subscriptionId, desdeISO, ateISO) {
  const desdeEsc = String(desdeISO).replace(/'/g, "''");
  const ateEsc = String(ateISO).replace(/'/g, "''");
  // `changes = properties.changes` traz o bag INTEIRO de propriedades alteradas (não só SKU de
  // VM como antes) — a filtragem pro allowlist curado acontece em Node
  // (`_extrairMudancasRastreadas`), não em KQL, pra ser mais simples de estender depois.
  const query = `resourcechanges
| extend changeTime = todatetime(properties.changeAttributes.timestamp),
         targetResourceId = tostring(properties.targetResourceId),
         targetResourceType = tostring(properties.targetResourceType),
         changeType = tostring(properties.changeType),
         changedBy = tostring(properties.changeAttributes.changedBy),
         correlationId = tostring(properties.changeAttributes.correlationId),
         changes = properties.changes
| where changeTime > datetime('${desdeEsc}') and changeTime <= datetime('${ateEsc}')
| project changeTime, targetResourceId, targetResourceType, resourceGroup, changeType, changedBy, correlationId, changes
| order by changeTime asc`;
  const mudancas = [];
  let skipToken = null;
  let paginas = 0;
  do {
    const body = {
      subscriptions: [subscriptionId],
      query,
      options: { $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
    };
    const resp = await _cbFetch(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 30_000 }
    );
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Resource Graph Change Analysis falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);
    for (const item of (data.data || [])) mudancas.push(item);
    skipToken = data.$skipToken || null;
    paginas++;
  } while (skipToken && paginas < 1000);
  return mudancas;
}

// Extrai as propriedades curadas de um bag de mudanças da Change Analysis (2026-09-03,
// "expandir rastreio além de SKU de VM" — pedido do usuário logo após o Inventário 2.0: já que
// a Change Analysis captura o antes/depois de QUALQUER propriedade de graça, aproveitar além de
// só SKU de VM). Deliberadamente uma ALLOWLIST curada, não o bag inteiro sem filtro — o exemplo
// oficial da Microsoft mostra que ele inclui ruído tipo `properties.provisioningState:
// Updating→Succeeded` em toda atualização de VM, que afogaria a feature em ruído sem valor real
// (mesma classe de problema que já motivou excluir RGs gerenciados por Databricks/AKS em vários
// pontos desta sessão). Tags são a exceção dinâmica (`tags.<chave>`, qualquer uma) — resto é
// lookup direto de um caminho de propriedade fixo, sensível ao `resourceType` porque `sku.name`
// significa coisas diferentes em disco vs. storage account. Função pura (sem I/O) — recebe o
// bag `changes` já desserializado (objeto JS) e o `resourceType` do evento, devolve um array de
// `{propriedade, propriedade_label, valor_anterior, valor_novo}` só com o que bateu na allowlist.
// IP privado de NIC (`ip_privado_nic`, abaixo) é ESPECULATIVO — nunca confirmado contra uma
// mudança real, ver comentário no próprio caso.
const _IP_PRIVADO_NIC_RE = /^properties\.ipConfigurations\[\d+\]\.properties\.privateIPAddress$/;
function _extrairMudancasRastreadas(resourceType, changes) {
  if (!changes || typeof changes !== 'object') return [];
  const tipo = (resourceType || '').toUpperCase();
  const achados = [];

  for (const [chave, valor] of Object.entries(changes)) {
    if (!valor || typeof valor !== 'object') continue;
    const anterior = valor.previousValue;
    const novo = valor.newValue;
    if (chave.startsWith('tags.')) {
      const tagNome = chave.slice('tags.'.length);
      achados.push({ propriedade: `tag:${tagNome}`, propriedade_label: `Tag: ${tagNome}`, valor_anterior: anterior, valor_novo: novo });
      continue;
    }
    if (chave === 'properties.hardwareProfile.vmSize' && tipo === 'MICROSOFT.COMPUTE/VIRTUALMACHINES') {
      achados.push({ propriedade: 'sku_vm', propriedade_label: 'SKU da VM', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'properties.diskSizeGB' && tipo === 'MICROSOFT.COMPUTE/DISKS') {
      achados.push({ propriedade: 'disco_tamanho_gb', propriedade_label: 'Tamanho do disco (GB)', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'sku.name' && tipo === 'MICROSOFT.COMPUTE/DISKS') {
      // Redundância/tipo de armazenamento do disco (Premium_LRS, StandardSSD_LRS, ...) —
      // diferente de `properties.tier` abaixo (tier de performance dentro de Premium, ex:
      // P4→P6). Confirmado como propriedades DISTINTAS testando contra dados reais desta
      // sessão — `properties.tier` foi o que realmente mudou num disco de verdade, `sku.name`
      // nunca apareceu mudando na amostra observada, mas é um valor real e válido do schema.
      achados.push({ propriedade: 'disco_sku', propriedade_label: 'Tipo de armazenamento do disco', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'properties.tier' && tipo === 'MICROSOFT.COMPUTE/DISKS') {
      achados.push({ propriedade: 'disco_tier', propriedade_label: 'Tier de performance do disco', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'sku.name' && tipo === 'MICROSOFT.STORAGE/STORAGEACCOUNTS') {
      achados.push({ propriedade: 'storage_sku', propriedade_label: 'SKU/Tier da Storage Account', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'properties.accessTier' && tipo === 'MICROSOFT.STORAGE/STORAGEACCOUNTS') {
      achados.push({ propriedade: 'storage_access_tier', propriedade_label: 'Tier de acesso (Storage)', valor_anterior: anterior, valor_novo: novo });
    } else if (chave === 'properties.ipAddress' && tipo === 'MICROSOFT.NETWORK/PUBLICIPADDRESSES') {
      achados.push({ propriedade: 'ip_publico', propriedade_label: 'Endereço IP público', valor_anterior: anterior, valor_novo: novo });
    } else if (_IP_PRIVADO_NIC_RE.test(chave) && tipo === 'MICROSOFT.NETWORK/NETWORKINTERFACES') {
      // ESPECULATIVO (2026-09-03) — nunca confirmado contra uma mudança real de IP privado (30
      // atualizações de NIC observadas em 24h de dados reais, nenhuma mexendo em
      // `ipConfigurations`). Adicionado por analogia: a mesma investigação confirmou que a
      // Change Analysis diffa arrays com índice explícito no path (visto em
      // `properties.routes[N].xxx` de route tables) — a premissa antiga de "arrays não diffam
      // limpo" era errada. Path completo confere com o schema ARM de NIC
      // (`properties.ipConfigurations[N].properties.privateIPAddress`), mas só fica confirmado
      // de verdade quando uma linha real aparecer em produção.
      achados.push({ propriedade: 'ip_privado_nic', propriedade_label: 'IP privado (NIC)', valor_anterior: anterior, valor_novo: novo });
    }
  }
  return achados;
}

// Detalhe completo de UM recurso via Resource Graph (2026-09-02, inspirado no ARI — que lê
// propriedades reais de cada recurso pro relatório Excel). Diferente de uma chamada ARM
// direta (`GET /{resourceId}?api-version=...`), que exigiria saber o api-version certo pra
// CADA provider/tipo (não existe um valor universal) — Resource Graph mantém seu próprio
// índice de propriedades por recurso, então UMA query serve pra qualquer tipo. `=~` é
// comparação case-insensitive em KQL (resource_id pode divergir em casing entre fontes, já
// documentado várias vezes neste arquivo). Aspas simples escapadas (dobradas) — resource_id
// nunca deveria conter aspas, mas o valor vem de query string, defensivo por padrão.
async function _resourceGraphFetchRecursoPorId(token, subscriptionId, resourceId) {
  const idEscapado = String(resourceId).replace(/'/g, "''");
  const body = {
    subscriptions: [subscriptionId],
    query: `Resources | where id =~ '${idEscapado}' | project id, name, type, resourceGroup, location, sku, properties, tags | limit 1`,
  };
  const resp = await _cbFetch(
    'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { timeoutMs: 30_000 }
  );
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Resource Graph falhou (${resp.status}): ${e}`); }
  const data = await _safeRespJson(resp);
  return (data.data && data.data[0]) || null;
}

// Recomendações do Azure Advisor (2026-09-02, inspirado no ARI, que integra com Advisor/
// Security Center) — Custo/Segurança/Confiabilidade/Performance/Excelência Operacional.
// Confirmado na documentação oficial (learn.microsoft.com/rest/api/advisor/recommendations/list):
// exige só a role Reader (já concedida), formato de resposta `{ value: [{ id, properties:
// { category, impact, impactedField, impactedValue, label, shortDescription:{problem,
// solution}, potentialBenefits, resourceMetadata:{resourceId} } }] }`. Não existe um campo
// numérico de "economia estimada" na API base — `potentialBenefits` é texto livre, mostrado
// como está, sem inventar um valor em R$ que a API não fornece.
async function _advisorFetchRecomendacoes(token, subscriptionId) {
  const recs = [];
  let url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01&$top=200`;
  let paginas = 0;
  while (url && paginas < 100) {
    const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Azure Advisor falhou (${resp.status}): ${e}`); }
    const data = await _safeRespJson(resp);
    for (const item of (data.value || [])) recs.push(item);
    url = data.nextLink || null;
    paginas++;
  }
  return recs;
}

// Cache em memória (2026-09-02) — a chamada ao vivo levou ~46s pra 3 subscriptions reais
// (13 mil recomendações, dezenas de páginas) — inaceitável pra uma aba interativa. TTL de
// 20 min (recomendações do Advisor não mudam minuto a minuto) + dedup por promise em
// andamento (mesmo padrão já usado em `_getRgStatsCache`, evita 2 requests concorrentes
// disparando 2 fetches completos da mesma subscription).
const _ADVISOR_TTL = 20 * 60 * 1000;
const _advisorCache = new Map(); // subscription_id -> { recs, ts }
const _advisorCachePromises = new Map(); // subscription_id -> Promise em andamento
async function _getAdvisorCached(token, subscriptionId) {
  const cached = _advisorCache.get(subscriptionId);
  if (cached && (Date.now() - cached.ts) < _ADVISOR_TTL) return cached.recs;
  if (_advisorCachePromises.has(subscriptionId)) return _advisorCachePromises.get(subscriptionId);
  const p = (async () => {
    try {
      const recs = await _advisorFetchRecomendacoes(token, subscriptionId);
      _advisorCache.set(subscriptionId, { recs, ts: Date.now() });
      return recs;
    } finally {
      _advisorCachePromises.delete(subscriptionId);
    }
  })();
  _advisorCachePromises.set(subscriptionId, p);
  return p;
}

async function _reconciliarInventarioResourceGraph(origem = 'manual') {
  if (_invColetaEmExecucao) throw new Error('Já existe uma coleta ou reconciliação de Inventário em execução');
  if (!pool) throw new Error('Banco não conectado');
  _invColetaEmExecucao = true;
  _invColetaIniciadaEm = new Date();
  _invColetaProgresso = { tipo: 'reconciliacao', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0, eventos: 0, novos: 0, atualizados: 0, excluidos: 0, log: [] };
  let histId;
  try {
    await ensureAzureColetaTable();
    const cfgRow = await pool.query(`SELECT * FROM azure_inventario_config ORDER BY id LIMIT 1`);
    if (!cfgRow.rows.length) throw new Error('Inventário não configurado');
    const cfg = cfgRow.rows[0];
    if (!cfg.sp_id) throw new Error('Nenhum Service Principal configurado para o Inventário');
    const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [cfg.sp_id]);
    if (!spRow.rows.length) throw new Error('Service Principal do Inventário não encontrado');
    const spCfg = spRow.rows[0];
    const getToken = _makeTokenGetter(_safeDecrypt(spCfg.tenant_id), _safeDecrypt(spCfg.client_id), _safeDecrypt(spCfg.client_secret));
    const token = await getToken();

    const subs = (spCfg.subscription_ids || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!subs.length) throw new Error('Nenhuma subscription configurada (nem no Inventário, nem no Service Principal escolhido)');

    const hist = await pool.query(
      `INSERT INTO azure_inventario_coleta_historico (status,origem) VALUES ('executando',$1) RETURNING id`,
      ['reconciliacao_' + origem]
    );
    histId = hist.rows[0].id;
    _logColetaInv(`Reconciliação (Resource Graph) — ${subs.length} subscription(s)`);
    _invColetaProgresso.sub_total = subs.length;

    // Limpar duplicatas (recursos com mesmo (subscription_id, LOWER(resource_id)))
    // antes de começar a reconciliação — mantém o mais recente
    try {
      const duplicatasDel = await pool.query(`
        DELETE FROM azure_recursos_inventario
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY subscription_id, LOWER(resource_id)
              ORDER BY GREATEST(criado_em, atualizado_em, detectado_em::timestamptz) DESC NULLS LAST, id DESC
            ) AS rn
            FROM azure_recursos_inventario
          ) t WHERE rn > 1
        )
      `);
      if (duplicatasDel.rowCount > 0) {
        _logColetaInv(`  Limpeza preventiva: ${duplicatasDel.rowCount} linha(s) duplicada(s) removida(s)`);
      }
    } catch (eLimpeza) {
      _logColetaInv(`  ⚠ Não conseguiu limpar duplicatas (não é crítico): ${eLimpeza.message}`);
    }

    let totalEncontrados = 0, totalNovos = 0;
    for (let i = 0; i < subs.length; i++) {
      const subId = subs[i];
      _invColetaProgresso.sub_idx = i + 1;
      _invColetaProgresso.sub_atual = subId;
      _invColetaProgresso.fase = `[${i + 1}/${subs.length}] Consultando Resource Graph — ${subId}`;
      let recursos;
      const inicioSnapshot = new Date();
      try {
        recursos = await _resourceGraphFetchRecursos(token, subId);
      } catch (eSub) {
        _logColetaInv(`  ✗ ${subId}: ${eSub.message}`);
        continue;
      }
      _logColetaInv(`  ${subId}: ${recursos.length} recurso(s) encontrado(s)`);
      totalEncontrados += recursos.length;

      for (const item of recursos) {
        if (!item.id) continue;
        const nome = item.name || String(item.id).split('/').pop();
        const resourceId = item.id.toLowerCase();
        const existing = await pool.query(
          `SELECT id FROM azure_recursos_inventario WHERE subscription_id = $1 AND LOWER(resource_id) = $2 LIMIT 1`,
          [subId, resourceId]
        );
        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE azure_recursos_inventario SET
               ativo=true,
               resource_type=COALESCE(resource_type, $1),
               resource_group=COALESCE(resource_group, $2),
               nome=COALESCE(nome, $3),
               atualizado_em=NOW()
             WHERE id = $4`,
            [item.type || null, item.resourceGroup || null, nome, existing.rows[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO azure_recursos_inventario (subscription_id,resource_id,resource_type,resource_group,nome,ativo,origem_deteccao)
             VALUES ($1,$2,$3,$4,$5,true,'resource_graph')`,
            [subId, item.id, item.type || null, item.resourceGroup || null, nome]
          );
          totalNovos++;
        }
        _invColetaProgresso.eventos = totalEncontrados;
        _invColetaProgresso.novos = totalNovos;
      }

      // Reconciliação nos DOIS sentidos: o que está ativo no Inventário mas não existe mais no
      // Resource Graph foi excluído sem o evento de exclusão ter sido capturado. Só roda quando a
      // consulta desta subscription veio completa (falha de página cai no catch acima).
      try {
        const { planejarDesativacao } = require('./inventarioReconcile');
        const ativos = await pool.query(
          `SELECT id, resource_id, resource_type,
                  GREATEST(criado_em, atualizado_em, detectado_em::timestamptz) AS ref_em
           FROM azure_recursos_inventario WHERE subscription_id = $1 AND ativo = true`, [subId]);
        const plano = planejarDesativacao({
          ativosNoBanco: ativos.rows,
          idsNoAzure: new Set(recursos.filter(x => x.id).map(x => String(x.id).toLowerCase())),
          tiposNoAzure: new Set(recursos.filter(x => x.type).map(x => String(x.type).toLowerCase())),
          inicioSnapshot,
        });
        if (plano.bloqueado) {
          _logColetaInv(`  ⚠ ${subId}: desativação de inexistentes bloqueada — ${plano.motivo}`);
        } else if (plano.desativar.length) {
          await pool.query(
            `UPDATE azure_recursos_inventario SET ativo = false, excluido_em = NOW(), excluido_por = 'Reconciliação (Resource Graph)'
             WHERE id = ANY($1::int[])`, [plano.desativar]);
          _invColetaProgresso.excluidos = (_invColetaProgresso.excluidos || 0) + plano.desativar.length;
          _logColetaInv(`  ${subId}: ${plano.desativar.length} recurso(s) inexistente(s) no Azure marcados como excluídos (${plano.protegidosRecentes} recentes preservados)`);
        }
      } catch (eDes) {
        _logColetaInv(`  ✗ ${subId}: falha ao desativar inexistentes — ${eDes.message}`);
      }
    }

    const msg = `${totalEncontrados} recurso(s) encontrados no Resource Graph | ${totalNovos} novo(s) adicionado(s) ao Inventário`;
    _logColetaInv(`Reconciliação concluída: ${msg}`);
    await pool.query(
      `UPDATE azure_inventario_coleta_historico SET status='concluido',concluido_em=NOW(),eventos_processados=$1,recursos_novos=$2,mensagem=$3 WHERE id=$4`,
      [totalEncontrados, totalNovos, msg, histId]
    );
  } catch (err) {
    _logColetaInv(`ERRO (reconciliação): ${err.message}`);
    if (histId) await pool.query(
      `UPDATE azure_inventario_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1 WHERE id=$2`,
      [err.message, histId]
    ).catch(() => {});
  } finally {
    _invColetaEmExecucao = false;
    _invColetaIniciadaEm = null;
  }
}

// Intervalo próprio (mesmo espírito de _iniciarAlertasEmail) — não acoplado ao agendador
// de billing de 5 em 5 min; detecção de novos recursos não precisa dessa urgência, e o
// Activity Log tem no mínimo alguns minutos de atraso de submissão mesmo na origem.
let _invAgendadorTimer = null;
function _iniciarInventarioAgendador() {
  if (_invAgendadorTimer || !pool) return;
  const tick = async () => {
    if (_invColetaEmExecucao) return;
    try {
      const cfgRow = await pool.query(`SELECT ativo FROM azure_inventario_config ORDER BY id LIMIT 1`);
      if (!cfgRow.rows.length || !cfgRow.rows[0].ativo) return;
      await _coletarInventarioAzure('agendado');
    } catch (e) { console.warn('[Inventario] Tick falhou:', e.message); }
  };
  setTimeout(tick, 150 * 1000);
  _invAgendadorTimer = setInterval(tick, 60 * 60 * 1000); // a cada hora
}

// Reconciliação automática semanal (segunda-feira 01:00 UTC, ~1 vez por semana)
let _reconciliacaoAgendadorTimer = null;
function _iniciarReconciliacaoAgendador() {
  if (_reconciliacaoAgendadorTimer || !pool) return;
  const tick = async () => {
    if (_invColetaEmExecucao) return;
    try {
      const cfgRow = await pool.query(`SELECT ativo FROM azure_inventario_config ORDER BY id LIMIT 1`);
      if (!cfgRow.rows.length || !cfgRow.rows[0].ativo) return;
      _logColetaInv('[Agendador Reconciliação] Iniciando reconciliação semanal');
      await _reconciliarInventarioResourceGraph('agendado');
    } catch (e) { _logColetaInv(`[Agendador Reconciliação] Falha: ${e.message}`); }
  };
  // Próxima segunda 01:00 UTC (7 dias = 7 * 24 * 60 * 60 * 1000)
  const agora = new Date();
  const proximaExecucao = new Date(agora);
  proximaExecucao.setUTCDate(proximaExecucao.getUTCDate() + (1 - proximaExecucao.getUTCDay() + 7) % 7 || 7);
  proximaExecucao.setUTCHours(1, 0, 0, 0);
  const msAteProxima = Math.max(1000, proximaExecucao.getTime() - agora.getTime());
  _logColetaInv(`[Agendador Reconciliação] Próxima execução em ${Math.round(msAteProxima / 1000 / 60)} minutos`);
  setTimeout(tick, msAteProxima);
  _reconciliacaoAgendadorTimer = setInterval(tick, 7 * 24 * 60 * 60 * 1000); // a cada 7 dias
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
async function _gerarRelatorioAPI(getToken, scopeUrl, startDate, endDate, label, metric = 'ActualCost') {
  const fs     = require('fs');
  const os     = require('os');
  const path   = require('path');
  const crypto = require('crypto');

  const MAX_POLL_ATTEMPTS = 60; // 60 × 6s = 360s máximo por subscription

  const genUrl  = `https://management.azure.com${scopeUrl}/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2023-08-01`;
  _logColeta(`→ Solicitando relatório: ${label}`);

  let token = await getToken();
  let genResp = await _cbFetch(
    genUrl,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, timePeriod: { start: startDate, end: endDate } }),
    },
    { timeoutMs: 60_000 }
  );

  // Token expirado → renova e tenta uma vez mais
  if (genResp.status === 401) {
    _logColeta(`  Token expirado, renovando para ${label}...`);
    token = await getToken(true);
    genResp = await _cbFetch(
      genUrl,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric, timePeriod: { start: startDate, end: endDate } }) },
      { timeoutMs: 60_000 }
    );
  }

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

    const pr = await _cbFetch(pollUrl, { headers: { Authorization: `Bearer ${await getToken()}` } }, { timeoutMs: 30_000 });
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
      // Stream direto para disco — evita carregar blob inteiro na RAM
      const { pipeline } = require('stream/promises');
      const { Readable } = require('stream');
      await pipeline(Readable.fromWeb(dlResp.body), fs.createWriteStream(dest));
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
      // _lerCSVBatched processa 500 linhas por vez — nunca carrega o CSV inteiro na RAM
      await _lerCSVBatched(dest, 500, async (batch) => {
        linhas += batch.length;
        const client = await pool.connect();
        let spCount = 0;
        try {
          await client.query('BEGIN');
          for (const raw of batch) {
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
          await client.query('COMMIT');
          _coletaProgresso.ins = ins; _coletaProgresso.upd = upd; _coletaProgresso.err = err;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      });
      _logColeta(`  ${label}: ${linhas} linhas importadas${rgFilter ? ` (filtro: ${rgFilter.size} RGs)` : ''}`);
    } finally {
      try { fs.unlinkSync(dest); } catch (_) {}
    }
  }
  return { ins, upd, err, linhas };
}

// ── Coleta via Azure Cost Management API ─────────────────────────────────────
// modo: 'billing_profile' (padrão) ou 'subscription' (direto por subscription IDs)
// Fatia um range em chunks de 1 mês calendário (limite Azure generateCostDetailsReport)
// Cada chunk começa no 1º dia do mês e termina no último — nunca cruza fronteira de mês
function _splitDateRange(startDate, endDate) {
  const chunks = [];
  const fmt = d => d.toISOString().slice(0, 10);
  let cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cur <= end) {
    // Último dia do mês atual
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 12, 0, 0);
    const chunkEnd = monthEnd < end ? monthEnd : new Date(end);
    chunks.push({ start: fmt(cur), end: fmt(chunkEnd) });
    // Avança para o 1º dia do mês seguinte
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12, 0, 0);
  }
  return chunks;
}

// Executa fn com até `tentativas` tentativas totais, aguardando entre falhas.
// Lança na última tentativa ou se o usuário cancelar.
async function _comRetentativa(fn, label, tentativas = 3) {
  for (let t = 1; t <= tentativas; t++) {
    try {
      return await fn();
    } catch (e) {
      if (e.message === 'Cancelado pelo usuário') throw e;
      if (t === tentativas) throw e;
      const esperaSeg = t * 30; // 30s na 1ª falha, 60s na 2ª
      _logColeta(`  ✗ ${label} — tentativa ${t}/${tentativas}: ${e.message}`);
      _logColeta(`  ↻ Aguardando ${esperaSeg}s antes de nova tentativa...`);
      for (let s = 0; s < esperaSeg; s++) {
        if (_coletaCancelada) throw new Error('Cancelado pelo usuário');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

async function _executarColetaAPI(spId, billingAccountId, billingProfileId, startDate, endDate, modo = 'billing_profile', subscriptionIds = [], resourceGroups = [], metric = 'ActualCost', origem = 'manual') {
  if (_coletaEmExecucao) throw new Error('Coleta já em execução');
  if (!pool) throw new Error('Banco não conectado');
  _coletaEmExecucao = true;
  _coletaIniciadaEm = new Date();
  const _coletaStartEm = _coletaIniciadaEm;
  _coletaCancelada  = false;
  _coletaProgresso  = { tipo: 'api', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0,
                        chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
  const rgFilter = resourceGroups.length ? new Set(resourceGroups.map(r => r.toUpperCase())) : null;
  _logColeta(`Coleta API [${modo}] — ${startDate} → ${endDate}${rgFilter ? ` | ${rgFilter.size} RG(s) filtrado(s)` : ''}`);
  let histId, totalIns = 0, totalUpd = 0, totalErr = 0, totalLinhas = 0;
  let subCount = 0;

  try {
    await ensureAzureColetaTable();
    const r = await pool.query(
      `INSERT INTO azure_coleta_historico (status,tipo,sp_id,origem,periodo_inicio,periodo_fim,subscriptions_ids) VALUES ('executando','api',$1,$2,$3,$4,$5) RETURNING id`,
      [spId || null, origem, startDate || null, endDate || null, subscriptionIds.length ? subscriptionIds : null]
    );
    histId = r.rows[0].id;

    // 1) Credenciais e token (getter com renovação automática)
    const spRow = await pool.query(`SELECT * FROM azure_coleta_config WHERE id=$1`, [spId]);
    if (!spRow.rows.length) throw new Error('SP não encontrada');
    const spCfg   = spRow.rows[0];
    const getToken = _makeTokenGetter(
      _safeDecrypt(spCfg.tenant_id), _safeDecrypt(spCfg.client_id), _safeDecrypt(spCfg.client_secret)
    );
    await getToken(); // valida credenciais logo no início

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

      // Coleta de uma subscription (reutilizada nos passes de recuperação)
      const _coletarSubId = async (subId) => {
        const subScope = `/subscriptions/${subId}`;
        const chunks = _splitDateRange(startDate, endDate);
        if (chunks.length > 1) _logColeta(`  Período fatiado em ${chunks.length} chunk(s) de até 30 dias`);
        for (const chunk of chunks) {
          if (_coletaCancelada) throw new Error('Cancelado pelo usuário');
          const label = chunks.length > 1 ? `${subId} [${chunk.start}→${chunk.end}]` : subId;
          const arquivos = await _gerarRelatorioAPI(getToken, subScope, chunk.start, chunk.end, label, metric);
          const res      = await _importarArquivosAPI(arquivos, subId, sql, COLS, rgFilter);
          totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
        }
      };

      // Passe principal
      const _subsFalhou = [];
      for (let i = 0; i < subscriptionIds.length; i++) {
        if (_coletaCancelada) { _logColeta('Cancelado'); break; }
        const subId = subscriptionIds[i].trim();
        if (!subId) continue;
        _coletaProgresso.sub_idx   = i + 1;
        _coletaProgresso.sub_atual = subId;
        _coletaProgresso.fase      = `[${i + 1}/${subscriptionIds.length}] ${subId}`;
        try {
          await _comRetentativa(() => _coletarSubId(subId), subId);
        } catch (e) {
          _logColeta(`  ✗ Falha após tentativas — ${subId}: ${e.message}`);
          _subsFalhou.push(subId);
        }
      }

      // Passes de recuperação — repete apenas as que falharam
      let aRetentar = [..._subsFalhou];
      for (let passe = 2; aRetentar.length > 0 && !_coletaCancelada && passe <= 4; passe++) {
        _logColeta(`\n🔄 Passe ${passe} — recuperando ${aRetentar.length} sub(s): ${aRetentar.join(', ')}`);
        _logColeta(`  ↻ Aguardando 60s antes do passe ${passe}...`);
        for (let s = 0; s < 60 && !_coletaCancelada; s++) await new Promise(r => setTimeout(r, 1000));
        const aindaFalhou = [];
        for (const subId of aRetentar) {
          if (_coletaCancelada) break;
          _coletaProgresso.sub_atual = subId;
          _coletaProgresso.fase      = `[Passe ${passe}] ${subId}`;
          try {
            await _comRetentativa(() => _coletarSubId(subId), subId);
            _logColeta(`  ✓ ${subId} coletada com sucesso no passe ${passe}`);
          } catch (e) {
            _logColeta(`  ✗ Passe ${passe} — ainda falhou: ${subId}`);
            aindaFalhou.push(subId);
          }
        }
        aRetentar = aindaFalhou;
      }
      if (aRetentar.length > 0) {
        _logColeta(`⚠ ${aRetentar.length} sub(s) não coletada(s) após todos os passes: ${aRetentar.join(', ')}`);
        totalErr += aRetentar.length;
      }

    } else {
      // ── Modo: Billing Profile (MCA) ────────────────────────────────────────
      _coletaProgresso.fase = 'Listando subscriptions do Billing Profile...';
      let subs = [];
      try {
        subs = await _listarSubsBillingProfile(await getToken(), billingAccountId, billingProfileId);
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

        // Coleta de uma subscription BP (reutilizada nos passes de recuperação)
        const _coletarSubBP = async (sub) => {
          const subScope = `/subscriptions/${sub.subscriptionId}`;
          const chunks = _splitDateRange(startDate, endDate);
          if (chunks.length > 1) _logColeta(`  Período fatiado em ${chunks.length} chunk(s) de até 30 dias`);
          for (const chunk of chunks) {
            if (_coletaCancelada) throw new Error('Cancelado pelo usuário');
            const label = chunks.length > 1 ? `${sub.nome} [${chunk.start}→${chunk.end}]` : sub.nome;
            const arquivos = await _gerarRelatorioAPI(getToken, subScope, chunk.start, chunk.end, label, metric);
            const res      = await _importarArquivosAPI(arquivos, sub.nome, sql, COLS, rgFilter);
            totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
          }
        };

        // Passe principal
        const _subsBPFalhou = [];
        for (let i = 0; i < subs.length; i++) {
          if (_coletaCancelada) { _logColeta('Cancelado'); break; }
          const sub = subs[i];
          _coletaProgresso.sub_idx   = i + 1;
          _coletaProgresso.sub_atual = sub.nome;
          _coletaProgresso.fase      = `[${i + 1}/${subs.length}] ${sub.nome}`;
          try {
            await _comRetentativa(() => _coletarSubBP(sub), sub.nome);
          } catch (e) {
            _logColeta(`  ✗ Falha após tentativas — ${sub.nome}: ${e.message}`);
            _subsBPFalhou.push(sub);
          }
        }

        // Passes de recuperação — repete apenas as que falharam
        let aRetentarBP = [..._subsBPFalhou];
        for (let passe = 2; aRetentarBP.length > 0 && !_coletaCancelada && passe <= 4; passe++) {
          _logColeta(`\n🔄 Passe ${passe} — recuperando ${aRetentarBP.length} sub(s): ${aRetentarBP.map(s => s.nome).join(', ')}`);
          _logColeta(`  ↻ Aguardando 60s antes do passe ${passe}...`);
          for (let s = 0; s < 60 && !_coletaCancelada; s++) await new Promise(r => setTimeout(r, 1000));
          const aindaFalhoBP = [];
          for (const sub of aRetentarBP) {
            if (_coletaCancelada) break;
            _coletaProgresso.sub_atual = sub.nome;
            _coletaProgresso.fase      = `[Passe ${passe}] ${sub.nome}`;
            try {
              await _comRetentativa(() => _coletarSubBP(sub), sub.nome);
              _logColeta(`  ✓ ${sub.nome} coletada com sucesso no passe ${passe}`);
            } catch (e) {
              _logColeta(`  ✗ Passe ${passe} — ainda falhou: ${sub.nome}`);
              aindaFalhoBP.push(sub);
            }
          }
          aRetentarBP = aindaFalhoBP;
        }
        if (aRetentarBP.length > 0) {
          _logColeta(`⚠ ${aRetentarBP.length} sub(s) não coletada(s) após todos os passes: ${aRetentarBP.map(s => s.nome).join(', ')}`);
          totalErr += aRetentarBP.length;
        }

        // Passagem no Billing Profile para capturar Tax/Purchase/Refund
        if (!_coletaCancelada) {
          _coletaProgresso.sub_idx   = subs.length + 1;
          _coletaProgresso.sub_atual = 'Billing Profile (Tax/Fiscal)';
          _coletaProgresso.fase      = 'Coletando impostos fiscais (Tax) do Billing Profile...';
          _logColeta('Passagem Billing Profile — Tax/Purchase/Refund...');
          try {
            await _comRetentativa(async () => {
              const chunks = _splitDateRange(startDate, endDate);
              for (const chunk of chunks) {
                if (_coletaCancelada) throw new Error('Cancelado pelo usuário');
                const label = chunks.length > 1 ? `Billing Profile [${chunk.start}→${chunk.end}]` : 'Billing Profile';
                const arquivos = await _gerarRelatorioAPI(getToken, bpScope, chunk.start, chunk.end, label, metric);
                const res      = await _importarArquivosAPI(arquivos, 'Billing Profile', sql, COLS, rgFilter);
                totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
              }
            }, 'Billing Profile (Tax)');
          } catch (e) {
            _logColeta(`Aviso: passagem Billing Profile falhou definitivamente — ${e.message}`);
          }
        }
      } else {
        // Fallback: coleta direto no Billing Profile scope
        _coletaProgresso.sub_total = 1;
        _coletaProgresso.sub_idx   = 1;
        _coletaProgresso.sub_atual = 'Billing Profile';
        const chunks = _splitDateRange(startDate, endDate);
        for (const chunk of chunks) {
          if (_coletaCancelada) break;
          const label = chunks.length > 1 ? `Billing Profile [${chunk.start}→${chunk.end}]` : 'Billing Profile';
          const arquivos = await _gerarRelatorioAPI(getToken, bpScope, chunk.start, chunk.end, label, metric);
          const res      = await _importarArquivosAPI(arquivos, 'Billing Profile', sql, COLS, rgFilter);
          totalIns += res.ins; totalUpd += res.upd; totalErr += res.err; totalLinhas += res.linhas;
        }
      }
    }

    // Resumo final
    try {
      const rCT = await pool.query(`SELECT COALESCE(charge_type,'(sem tipo)') AS ct, COUNT(*) AS n FROM azure_costs GROUP BY charge_type ORDER BY n DESC LIMIT 20`);
      _logColeta('Charge types: ' + rCT.rows.map(r => `${r.ct}:${r.n}`).join(', '));
    } catch (_) {}

    _logColeta(`Concluído: ${totalIns} ins, ${totalUpd} upd, ${totalErr} err / ${totalLinhas} linhas`);
    // Marca registros desta coleta como fonte='api' para não aparecerem no histórico de import manual
    pool.query(`UPDATE azure_costs SET fonte='api' WHERE importado_em >= $1 AND (fonte IS NULL OR fonte='manual')`, [_coletaStartEm]).catch(() => {});
    // Invalida caches imediatamente — dados já estão em azure_costs; _refreshAzureCache leva ~87s e não deve bloquear a visibilidade
    _coberturaCache = null; _resumoCache = null; _importsCache = null; _dbWsCache = null; _rgStatsCacheTs = 0; // marca como velho: recalcula em segundo plano, sem apagar o último valor
    _refreshAzureCache().catch(() => {});
    const msgFinal = modo === 'subscription'
      ? `API Subscription — ${subCount} sub(s) | ${startDate}→${endDate}`
      : `API Billing Profile — ${subCount} sub(s) + Tax | ${startDate}→${endDate}`;
    const detFinal = JSON.stringify({ tipo: 'api', modo, log: [..._coletaProgresso.log] });
    await pool.query(
      `UPDATE azure_coleta_historico SET status='concluido',concluido_em=NOW(),linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, msgFinal, detFinal, histId]
    );
    _validarColeta(histId, subscriptionIds, startDate, endDate).catch(() => {});
    _coletaProgresso.fase = 'Concluído';
    _registrarNotificacaoColeta(
      `Coleta API concluída`,
      `${origem === 'agendado' ? '⏰ Agendada' : '👤 Manual'} · ${msgFinal}`,
      'coleta_concluida'
    ).catch(() => {});

  } catch (err) {
    _logColeta(`ERRO: ${err.message}`);
    const detErr = JSON.stringify({ tipo: 'api', modo, log: [..._coletaProgresso.log] });
    if (histId) await pool.query(
      `UPDATE azure_coleta_historico SET status='erro',concluido_em=NOW(),mensagem=$1,detalhes=$2 WHERE id=$3`,
      [err.message, detErr, histId]
    ).catch(() => {});
    _registrarNotificacaoColeta(
      `Coleta API com erro`,
      err.message,
      'coleta_erro'
    ).catch(() => {});
    _alertarColetaComErro('Coleta API com erro', err.message).catch(() => {});
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
  const _bn    = blobName.toLowerCase();
  const ext    = _bn.endsWith('.parquet') ? '.parquet' : _bn.endsWith('.zip') ? '.zip' : '.csv';
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
  const _coletaStartEm = new Date();
  _coletaProgresso  = { tipo: 'storage', fase: 'Iniciando...', sub_atual: '', sub_idx: 0, sub_total: 0, chunk_atual: '', chunk_idx: 0, chunk_total: 0, ins: 0, upd: 0, err: 0, log: [] };
  _logColeta(`Coleta Storage iniciada (${modo}${storageId ? ' STG#'+storageId : ''})`);

  let histId, totalIns = 0, totalUpd = 0, totalErr = 0;

  try {
    await ensureAzureColetaTable();
    const origemDb = modo === 'auto' ? 'agendado' : 'manual';
    const r = await pool.query(`INSERT INTO azure_coleta_historico (status,tipo,origem) VALUES ('executando','storage',$1) RETURNING id`, [origemDb]);
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

    // Registra SP usada no histórico
    if (histId && sp.id) await pool.query(
      'UPDATE azure_coleta_historico SET sp_id=$1 WHERE id=$2', [sp.id, histId]
    ).catch(() => {});

    _coletaProgresso.fase = 'Autenticando no Azure Storage...';
    _logColeta('Obtendo token de Storage...');
    const getStorageToken = _makeStorageTokenGetter(tenantId, clientId, secret);
    await getStorageToken(); // valida credenciais logo no início

    _coletaProgresso.fase = 'Listando arquivos no container...';
    _logColeta(`Listando em ${storageAccount}/${container}/${prefix || '*'}`);
    let blobs = await _storageListBlobs(await getStorageToken(), storageAccount, container, prefix);
    blobs = blobs.filter(b => /\.(csv|parquet|zip)$/i.test(b.name));
    _logColeta(`${blobs.length} arquivo(s) CSV/Parquet/ZIP encontrado(s)`);
    if (!blobs.length) throw new Error('Nenhum arquivo CSV/Parquet/ZIP encontrado no caminho configurado');
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
        let dlToken = await getStorageToken();
        try {
          tmpFile = await _storageDownloadBlob(dlToken, storageAccount, container, blob.name);
        } catch (e401) {
          if (e401.message.includes('(401)')) {
            _logColeta(`  [Token Storage] 401 no download — renovando token...`);
            dlToken = await getStorageToken(true);
            tmpFile = await _storageDownloadBlob(dlToken, storageAccount, container, blob.name);
          } else throw e401;
        }
        const rows = await _lerArquivoRows(tmpFile, blob.name);
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

    // Marca registros desta coleta como fonte='storage' para não aparecerem no histórico de import manual
    pool.query(`UPDATE azure_costs SET fonte='storage' WHERE importado_em >= $1 AND (fonte IS NULL OR fonte='manual')`, [_coletaStartEm]).catch(() => {});
    // Invalida caches imediatamente — dados já estão em azure_costs; _refreshAzureCache leva ~87s e não deve bloquear a visibilidade
    _coberturaCache = null; _resumoCache = null; _importsCache = null; _dbWsCache = null; _rgStatsCacheTs = 0; // marca como velho: recalcula em segundo plano, sem apagar o último valor
    _refreshAzureCache().catch(() => {});

    // ── Price List via Storage (opcional) ──────────────────────────────────────
    let plMsg = '';
    if (stg.price_list_prefix?.trim()) {
      const plPrefix = stg.price_list_prefix.trim();
      let plHistId, plLog = [];
      const _logPl = msg => { _logColeta(`[PL] ${msg}`); plLog.push(msg); };
      try {
        const plHistR = await pool.query(
          `INSERT INTO azure_coleta_historico (status,tipo,sp_id,origem) VALUES ('executando','price_list',$1,$2) RETURNING id`,
          [sp.id || null, origemDb]
        );
        plHistId = plHistR.rows[0].id;
      } catch (_) {}
      _coletaProgresso.fase = 'Coletando Price List do Storage...';
      _logPl(`Listando em ${storageAccount}/${container}/${plPrefix}`);
      let plIns = 0, plSkip = 0, plErr = 0, plBlobs = [];
      try {
        plBlobs = await _storageListBlobs(await getStorageToken(), storageAccount, container, plPrefix);
        plBlobs = plBlobs.filter(b => /\.(csv|parquet|zip)$/i.test(b.name));
        _logPl(`${plBlobs.length} arquivo(s) CSV/Parquet/ZIP encontrado(s)`);
        for (const pb of plBlobs) {
          if (_coletaCancelada) break;
          let plTmp;
          try {
            let plTok = await getStorageToken();
            try {
              plTmp = await _storageDownloadBlob(plTok, storageAccount, container, pb.name);
            } catch (e401pl) {
              if (e401pl.message.includes('(401)')) {
                plTok = await getStorageToken(true);
                plTmp = await _storageDownloadBlob(plTok, storageAccount, container, pb.name);
              } else throw e401pl;
            }
            const plR = await _importPriceListFromCSV(plTmp, pb.name.split('/').pop());
            plIns  += plR.inserted;
            plSkip += plR.skipped;
            plErr  += plR.errors;
            _logPl(`${pb.name.split('/').pop()} → ins:${plR.inserted} skip:${plR.skipped} err:${plR.errors}`);
          } catch (plBlobErr) {
            _logPl(`ERRO ${pb.name.split('/').pop()}: ${plBlobErr.message.slice(0, 60)}`);
            plErr++;
          } finally {
            const fs = require('fs');
            if (plTmp) try { fs.unlinkSync(plTmp); } catch (_) {}
          }
        }
        plMsg = ` · PriceList: ${plBlobs.length} arquivo(s) · ins:${plIns} skip:${plSkip} err:${plErr}`;
        _logPl(`Concluída${plMsg}`);
        if (plHistId) await pool.query(
          `UPDATE azure_coleta_historico SET concluido_em=NOW(),status='concluido',linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
          [plIns, plSkip, plErr,
           `Price List via Storage · ${plBlobs.length} arquivo(s) · ${plIns} inseridos · ${plSkip} ignorados · ${plErr} erros`,
           JSON.stringify({ tipo: 'price_list', modo, log: plLog }), plHistId]
        ).catch(() => {});
      } catch (plListErr) {
        _logPl(`Erro ao listar: ${plListErr.message.slice(0, 80)}`);
        plMsg = ` · PriceList: erro (${plListErr.message.slice(0, 40)})`;
        if (plHistId) await pool.query(
          `UPDATE azure_coleta_historico SET concluido_em=NOW(),status='erro',linhas_erro=1,mensagem=$1,detalhes=$2 WHERE id=$3`,
          [plListErr.message, JSON.stringify({ tipo: 'price_list', modo, log: plLog }), plHistId]
        ).catch(() => {});
      }
    }

    const msg = `Storage · ${blobs.length} arquivo(s) · ${totalIns} inseridos · ${totalUpd} atualizados · ${totalErr} erros${plMsg}`;
    _coletaProgresso.fase = 'Concluída';
    _logColeta('Concluída: ' + msg);
    await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='concluido',linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, msg, JSON.stringify({ tipo: 'storage', modo, log: [..._coletaProgresso.log] }), histId]);
    _validarColeta(histId, null, null, null).catch(() => {});
    _registrarNotificacaoColeta(
      `Coleta Storage concluída`,
      `${origemDb === 'agendado' ? '⏰ Agendada' : '👤 Manual'} · ${msg}`,
      'coleta_concluida'
    ).catch(() => {});
    return { ok: true, msg };
  } catch (err) {
    _coletaProgresso.fase = 'Erro: ' + err.message.slice(0, 80);
    _logColeta('Erro: ' + err.message.slice(0, 80));
    const detStgErr = JSON.stringify({ tipo: 'storage', modo, log: [..._coletaProgresso.log] });
    if (histId) await pool.query(`UPDATE azure_coleta_historico SET concluido_em=NOW(),status='erro',linhas_inseridas=$1,linhas_atualizadas=$2,linhas_erro=$3,mensagem=$4,detalhes=$5 WHERE id=$6`,
      [totalIns, totalUpd, totalErr, err.message, detStgErr, histId]).catch(() => {});
    _registrarNotificacaoColeta(
      `Coleta Storage com erro`,
      err.message,
      'coleta_erro'
    ).catch(() => {});
    _alertarColetaComErro('Coleta Storage com erro', err.message).catch(() => {});
    throw err;
  } finally {
    _coletaEmExecucao = false;
    _coletaCancelada  = false;
  }
}

// ── Validação pós-coleta ──────────────────────────────────────────────────────
async function _validarColeta(histId, subIds, inicio, fim) {
  if (!histId || !pool) return;
  try {
    const subsArr = Array.isArray(subIds) ? subIds.filter(Boolean) : [];
    let periodoInicio = inicio ? String(inicio).slice(0, 10) : null;
    let periodoFim    = fim    ? String(fim).slice(0, 10)    : null;

    // Para coleta Storage (sem período explícito): deriva do que foi inserido desde o início da coleta
    if (!periodoInicio || !periodoFim) {
      const { rows: [pr] } = await pool.query(
        `SELECT MIN(cost_date)::text AS ini, MAX(cost_date)::text AS fim
         FROM azure_costs
         WHERE importado_em >= (SELECT iniciado_em FROM azure_coleta_historico WHERE id=$1)`,
        [histId]
      );
      periodoInicio = pr?.ini || null;
      periodoFim    = pr?.fim || null;
    }

    if (!periodoInicio || !periodoFim) {
      await pool.query(
        `UPDATE azure_coleta_historico SET validacao_status='inconclusivo', validacao_json=$1 WHERE id=$2`,
        [JSON.stringify({ erro: 'Período não determinado — sem registros novos', validado_em: new Date().toISOString() }), histId]
      );
      return;
    }

    const diasEsperados = Math.round((new Date(periodoFim) - new Date(periodoInicio)) / 86400000) + 1;

    // Totais do período
    const mainQ = subsArr.length
      ? `SELECT COUNT(DISTINCT cost_date) AS dias, COUNT(DISTINCT subscription_id) AS subs,
                COUNT(*) AS total,
                COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS custo_microsoft,
                COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'), 0)                AS custo_marketplace
         FROM azure_costs WHERE subscription_id = ANY($1) AND cost_date BETWEEN $2 AND $3`
      : `SELECT COUNT(DISTINCT cost_date) AS dias, COUNT(DISTINCT subscription_id) AS subs,
                COUNT(*) AS total,
                COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'), 0) AS custo_microsoft,
                COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'), 0)                AS custo_marketplace
         FROM azure_costs WHERE cost_date BETWEEN $1 AND $2`;
    const mainParams = subsArr.length ? [subsArr, periodoInicio, periodoFim] : [periodoInicio, periodoFim];
    const { rows: [row] } = await pool.query(mainQ, mainParams);

    const diasComDados = parseInt(row.dias  || 0);
    const subsComDados = parseInt(row.subs  || 0);
    const totalReg     = parseInt(row.total || 0);
    // SEM imposto, de propósito — validação de saúde de coleta precisa bater com o valor cru
    // importado da Azure, não com o custo já ajustado pelo imposto configurável.
    const custoTotal   = Number(row.custo_microsoft || 0) + Number(row.custo_marketplace || 0);

    // Dias sem dados (máx 31 para não pesar)
    let diasSemDados = [];
    if (totalReg > 0 && diasComDados < diasEsperados) {
      const gapQ = subsArr.length
        ? `SELECT gs::date::text AS dt FROM generate_series($1::date,$2::date,'1 day') gs
           WHERE gs::date NOT IN (
             SELECT DISTINCT cost_date FROM azure_costs
             WHERE subscription_id=ANY($3) AND cost_date BETWEEN $1 AND $2
           ) ORDER BY dt LIMIT 31`
        : `SELECT gs::date::text AS dt FROM generate_series($1::date,$2::date,'1 day') gs
           WHERE gs::date NOT IN (
             SELECT DISTINCT cost_date FROM azure_costs WHERE cost_date BETWEEN $1 AND $2
           ) ORDER BY dt LIMIT 31`;
      const gapParams = subsArr.length ? [periodoInicio, periodoFim, subsArr] : [periodoInicio, periodoFim];
      const { rows: gaps } = await pool.query(gapQ, gapParams);
      diasSemDados = gaps.map(g => g.dt);
    }

    // Subscriptions sem dados (apenas quando lista explícita foi fornecida)
    let subsSemDados = [];
    if (subsArr.length > 0) {
      const { rows: subRows } = await pool.query(
        `SELECT DISTINCT subscription_id FROM azure_costs
         WHERE subscription_id = ANY($1) AND cost_date BETWEEN $2 AND $3`,
        [subsArr, periodoInicio, periodoFim]
      );
      const comDados = new Set(subRows.map(r => r.subscription_id));
      subsSemDados = subsArr.filter(s => !comDados.has(s));
    }

    // Status
    let validStatus;
    if (totalReg === 0) {
      validStatus = 'falha';
    } else if (subsSemDados.length > 0 || diasComDados < Math.floor(diasEsperados * 0.85)) {
      validStatus = 'aviso';
    } else {
      validStatus = 'ok';
    }

    const validJson = {
      dias_esperados:  diasEsperados,
      dias_com_dados:  diasComDados,
      subs_esperadas:  subsArr.length,
      subs_com_dados:  subsComDados,
      total_registros: totalReg,
      custo_total:     custoTotal,
      subs_sem_dados:  subsSemDados,
      dias_sem_dados:  diasSemDados,
      validado_em:     new Date().toISOString()
    };

    await pool.query(
      `UPDATE azure_coleta_historico SET validacao_status=$1, validacao_json=$2, periodo_inicio=$3, periodo_fim=$4 WHERE id=$5`,
      [validStatus, JSON.stringify(validJson), periodoInicio, periodoFim, histId]
    );
    console.log(`[Validação] #${histId}: ${validStatus} — ${totalReg} reg | ${diasComDados}/${diasEsperados} dias | ${subsComDados}/${subsArr.length || '?'} subs`);
  } catch (e) {
    console.warn(`[Validação] Erro #${histId}:`, e.message);
  }
}

// Espelha _validarColeta (Azure) — mesma ideia (dias com dados vs. esperados no
// período, custo total, gaps), mas sem o conceito de "subscriptions esperadas":
// a Coleta Databricks não tem um escopo explícito de workspaces escolhido pelo
// usuário (System Tables são a nível de conta inteira) — subs_esperadas fica
// sempre 0, mesmo tratamento que a Coleta Azure já dá pro modo Storage (sem
// lista explícita = informativo, não afeta o status ok/aviso/falha).
// workspaces_com_dados é reportado no campo subs_com_dados (mesmo ValidacaoJson
// do frontend, reaproveitado — só o rótulo muda na UI pra "Workspaces").
async function _validarColetaDatabricks(histId, configId, inicio, fim) {
  if (!histId || !pool) return;
  try {
    let periodoInicio = inicio ? String(inicio).slice(0, 10) : null;
    let periodoFim    = fim    ? String(fim).slice(0, 10)    : null;

    if (!periodoInicio || !periodoFim) {
      const { rows: [pr] } = await pool.query(
        `SELECT MIN(usage_date)::text AS ini, MAX(usage_date)::text AS fim
         FROM databricks_consumo
         WHERE config_id IS NOT DISTINCT FROM $1 AND atualizado_em >= (SELECT iniciado_em FROM databricks_coleta_historico WHERE id=$2)`,
        [configId, histId]
      );
      periodoInicio = pr?.ini || null;
      periodoFim    = pr?.fim || null;
    }

    if (!periodoInicio || !periodoFim) {
      await pool.query(
        `UPDATE databricks_coleta_historico SET validacao_status='inconclusivo', validacao_json=$1 WHERE id=$2`,
        [JSON.stringify({ erro: 'Período não determinado — sem registros novos', validado_em: new Date().toISOString() }), histId]
      );
      return;
    }

    const diasEsperados = Math.round((new Date(periodoFim) - new Date(periodoInicio)) / 86400000) + 1;

    const { rows: [row] } = await pool.query(
      `SELECT COUNT(DISTINCT usage_date) AS dias, COUNT(DISTINCT workspace_id) AS workspaces,
              COUNT(*) AS total, COALESCE(SUM(custo_estimado),0) AS custo
       FROM databricks_consumo WHERE config_id IS NOT DISTINCT FROM $1 AND usage_date BETWEEN $2 AND $3`,
      [configId, periodoInicio, periodoFim]
    );
    const diasComDados       = parseInt(row.dias  || 0);
    const workspacesComDados = parseInt(row.workspaces || 0);
    const totalReg           = parseInt(row.total || 0);
    const custoTotal         = parseFloat(row.custo || 0);

    let diasSemDados = [];
    if (totalReg > 0 && diasComDados < diasEsperados) {
      const { rows: gaps } = await pool.query(
        `SELECT gs::date::text AS dt FROM generate_series($1::date,$2::date,'1 day') gs
         WHERE gs::date NOT IN (
           SELECT DISTINCT usage_date FROM databricks_consumo WHERE config_id IS NOT DISTINCT FROM $3 AND usage_date BETWEEN $1 AND $2
         ) ORDER BY dt LIMIT 31`,
        [periodoInicio, periodoFim, configId]
      );
      diasSemDados = gaps.map(g => g.dt);
    }

    let validStatus;
    if (totalReg === 0) validStatus = 'falha';
    else if (diasComDados < Math.floor(diasEsperados * 0.85)) validStatus = 'aviso';
    else validStatus = 'ok';

    const validJson = {
      dias_esperados:  diasEsperados,
      dias_com_dados:  diasComDados,
      subs_esperadas:  0,
      subs_com_dados:  workspacesComDados,
      total_registros: totalReg,
      custo_total:     custoTotal,
      subs_sem_dados:  [],
      dias_sem_dados:  diasSemDados,
      validado_em:     new Date().toISOString()
    };

    await pool.query(
      `UPDATE databricks_coleta_historico SET validacao_status=$1, validacao_json=$2, periodo_inicio=$3, periodo_fim=$4 WHERE id=$5`,
      [validStatus, JSON.stringify(validJson), periodoInicio, periodoFim, histId]
    );
    console.log(`[ValidaçãoDbx] #${histId}: ${validStatus} — ${totalReg} reg | ${diasComDados}/${diasEsperados} dias | ${workspacesComDados} workspaces`);
  } catch (e) {
    console.warn(`[ValidaçãoDbx] Erro #${histId}:`, e.message);
  }
}

// ── Storage CRUD ──────────────────────────────────────────────────────────────

app.get('/api/azure-coleta/storages', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureAzureColetaTable();
    const r = await pool.query(`SELECT * FROM azure_storage_config ORDER BY id`);
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/azure-coleta/storages', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, storage_account, storage_container, storage_prefix, price_list_prefix, ativo, sp_id } = req.body;
    await ensureAzureColetaTable();
    if (!storage_account?.trim() || !storage_container?.trim()) return res.status(400).json({ error: 'Storage Account e Container são obrigatórios' });
    const r = await pool.query(
      `INSERT INTO azure_storage_config(nome,storage_account,storage_container,storage_prefix,price_list_prefix,ativo,sp_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [nome || 'Storage 1', storage_account.trim(), storage_container.trim(), storage_prefix?.trim() || null, price_list_prefix?.trim() || null, ativo ?? true, sp_id || null]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { _dbErr(res, e); }
});

app.put('/api/azure-coleta/storages/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { nome, storage_account, storage_container, storage_prefix, price_list_prefix, ativo, sp_id } = req.body;
    await pool.query(
      `UPDATE azure_storage_config SET nome=$1,storage_account=$2,storage_container=$3,storage_prefix=$4,price_list_prefix=$5,ativo=$6,sp_id=$7,atualizado_em=NOW() WHERE id=$8`,
      [nome, storage_account?.trim(), storage_container?.trim(), storage_prefix?.trim() || null, price_list_prefix?.trim() || null, ativo ?? true, sp_id || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
});

app.delete('/api/azure-coleta/storages/:id', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM azure_storage_config WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
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
  } catch (e) { _dbErr(res, e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG ANALYTICS FINOPS (2026-09-29) — v1: descoberta de workspaces + ingestão
// diária por tabela + motor de regras + export Excel. Reaproveita a MESMA
// Service Principal do Inventário (_getInventarioSpConfig), só com um escopo de
// token adicional (_logAnalyticsGetToken) — exige o papel "Log Analytics
// Reader" concedido a essa SP, separado do acesso a Resource Graph/Cost
// Management que ela já tem. Fora do escopo desta v1: score 0-100, os 3
// dashboards, modelo de economia em R$, coleta 3x/dia, alertas, limiares
// configuráveis pelo admin (ficam fixos por enquanto, ver
// _LOG_ANALYTICS_LIMIARES) — tudo isso é v2/v3.
// ═══════════════════════════════════════════════════════════════════════════

let _logAnalyticsTableReady = false;
let _logAnalyticsTablePromise = null;
// Guarda contra corrida (achado em produção, 2026-10-03): várias chamadas concorrentes —
// comum logo após restart, quando LogAnalyticsView dispara ~5 queries em paralelo — viam
// `_logAnalyticsTableReady === false` ao mesmo tempo (a flag só é setada no FINAL da função) e
// rodavam todo `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` concorrentemente. Postgres não
// garante atomicidade nisso entre sessões — uma das chamadas perdia a corrida e quebrava com
// 23505 em pg_type (`log_analytics_consultas_tabela` foi o caso real). Com a promise
// compartilhada, toda chamada concorrente aguarda a MESMA execução em vez de repeti-la.
async function ensureLogAnalyticsTable() {
  if (!pool) return;
  if (_logAnalyticsTableReady) return;
  if (_logAnalyticsTablePromise) return _logAnalyticsTablePromise;
  _logAnalyticsTablePromise = (async () => {
  try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_workspaces (
      resource_id     TEXT PRIMARY KEY,
      workspace_guid  TEXT NOT NULL,
      subscription_id VARCHAR(200), resource_group VARCHAR(500), nome VARCHAR(500),
      retencao_dias   INT, sku VARCHAR(100),
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Daily Cap (workspaceCapping.dailyQuotaGb no ARM) — teto diário de ingestão configurado pra
  // controlar custo. -1 (ou ausente) significa "sem limite" — guardamos como NULL pra
  // diferenciar de "configurado em 0" (o que travaria toda ingestão, caso real de alerta).
  await pool.query(`ALTER TABLE log_analytics_workspaces ADD COLUMN IF NOT EXISTS daily_cap_gb NUMERIC(14,4)`);
  // Auditoria de consultas (LAQueryLogs) — ao contrário de tudo que coletamos até aqui, isso
  // exige HABILITAR algo novo na Azure (Diagnostic Setting categoria "Audit" no próprio
  // workspace) — nunca liga sozinho, só via botão manual (ver _habilitarAuditoriaConsultas).
  await pool.query(`ALTER TABLE log_analytics_workspaces ADD COLUMN IF NOT EXISTS auditoria_consultas_habilitada BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_analytics_ws_guid ON log_analytics_workspaces (workspace_guid)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_ingestao_diaria (
      workspace_guid TEXT NOT NULL, dia DATE NOT NULL, tabela VARCHAR(200) NOT NULL,
      gb NUMERIC(14,4) NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_guid, dia, tabela)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_recomendacoes (
      id SERIAL PRIMARY KEY,
      workspace_guid TEXT NOT NULL, regra VARCHAR(50) NOT NULL, severidade VARCHAR(20) NOT NULL,
      detalhe TEXT, criado_em TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (workspace_guid, regra)
    )
  `);
  // 'origem' separa quem é dono de cada recomendação: _avaliarRegrasLogAnalytics (diário) só
  // apaga/recria as suas ('ingestao'); o fan-out de Diagnostic Settings (semanal) só mexe nas
  // dele ('diagnostic_settings') — sem isso, a coleta diária apagaria a recomendação de fan-out
  // todo dia, já que ela faz DELETE+INSERT completo por workspace.
  await pool.query(`ALTER TABLE log_analytics_recomendacoes ADD COLUMN IF NOT EXISTS origem VARCHAR(30) NOT NULL DEFAULT 'ingestao'`);
  // Config de retenção POR TABELA (ARM Tables - List) — o workspace tem uma retenção padrão,
  // mas cada tabela pode sobrescrever isso, e é aí que custo de retenção "escondido" aparece.
  // retencao_e_padrao=false é o sinal direto de "alguém customizou a retenção desta tabela".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_tabelas (
      workspace_guid TEXT NOT NULL, tabela VARCHAR(200) NOT NULL,
      plano VARCHAR(20), retencao_dias INT, retencao_total_dias INT, retencao_arquivo_dias INT,
      retencao_e_padrao BOOLEAN, atualizado_em TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (workspace_guid, tabela)
    )
  `);
  // Quantas queries KQL rodaram em cada tabela (LAQueryLogs, só pros workspaces com auditoria
  // habilitada — ver auditoria_consultas_habilitada). Atribuição de tabela é por TEXTO (não
  // existe coluna oficial "tabela consultada" no LAQueryLogs) — aproximação documentada no
  // plano, não é garantia pra queries complexas (union/múltiplos joins).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_consultas_tabela (
      workspace_guid TEXT NOT NULL, tabela VARCHAR(200) NOT NULL,
      consultas_30d INT NOT NULL DEFAULT 0, gb_escaneado_30d NUMERIC(14,4) NOT NULL DEFAULT 0,
      ultima_consulta TIMESTAMPTZ, atualizado_em TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (workspace_guid, tabela)
    )
  `);
  // Diagnostic Settings — "quais recursos estão coletando" via API oficial por recurso (o
  // Resource Graph não indexa esse recurso de extensão de forma confiável em todo tenant/tipo,
  // ver comentário de _coletarDiagnosticSettings). Etapa cara, cadência própria (não é a coleta
  // diária) — por isso fica em tabela separada, sobrescrita por execução completa (não upsert
  // incremental: um recurso que perdeu o Diagnostic Setting não pode "sobrar" aqui).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_diagnostic_settings (
      id BIGSERIAL PRIMARY KEY,
      workspace_guid TEXT NOT NULL, nome_config VARCHAR(500),
      recurso_id TEXT NOT NULL, recurso_tipo VARCHAR(200),
      categorias_habilitadas TEXT, categorias_desabilitadas TEXT, grupos_categoria TEXT,
      metricas_habilitadas TEXT, metricas_desabilitadas TEXT,
      envia_storage BOOLEAN DEFAULT false, envia_eventhub BOOLEAN DEFAULT false,
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_analytics_diag_ws ON log_analytics_diagnostic_settings (workspace_guid)`);
  // DCR (Data Collection Rule) — a outra via de coleta (Azure Monitor Agent: Syslog, Windows
  // Event Log, Performance Counters, Custom Logs, extensões). 1 chamada por subscription, barato
  // o bastante pra entrar na coleta diária normal.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_dcrs (
      id BIGSERIAL PRIMARY KEY,
      subscription_id VARCHAR(200), resource_group VARCHAR(500), nome VARCHAR(500),
      workspace_guid_destino TEXT, streams TEXT, tipos_fonte TEXT, detalhe_fontes TEXT,
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_analytics_dcr_ws ON log_analytics_dcrs (workspace_guid_destino)`);
  // Application Insights — alavancas de custo próprias (Sampling, Daily Cap, Retenção),
  // diferentes de Diagnostic Settings. sampling_percentage/retencao_dias/ingestion_mode/
  // workspace_resource_id vêm do Resource Graph (barato, 1 query pra todos os componentes);
  // daily_cap_gb vem de uma chamada por componente (currentbillingfeatures), mas como o volume
  // é só "componentes de App Insights" (não os ~42 tipos monitoráveis), cabe na coleta diária.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS log_analytics_app_insights (
      resource_id         TEXT PRIMARY KEY,
      subscription_id     VARCHAR(200), resource_group VARCHAR(500), nome VARCHAR(500),
      sampling_percentage NUMERIC(5,2), retencao_dias INT, ingestion_mode VARCHAR(50),
      workspace_resource_id TEXT, daily_cap_gb NUMERIC(14,4),
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_analytics_ai_ws ON log_analytics_app_insights (workspace_resource_id)`);
  _logAnalyticsTableReady = true;
  } finally { _logAnalyticsTablePromise = null; }
  })();
  return _logAnalyticsTablePromise;
}

// Tipos de recurso candidatos a ter Diagnostic Setting configurado — mesma lista usada pelo
// framework de assessment de referência (Azure_LogAnalytics_FinOps_Assessment_Framework),
// cobrindo compute, dados, rede, integração, segurança e IA (~42 tipos). Ajustar aqui se o
// tenant usar um tipo de recurso não coberto.
const _LOG_ANALYTICS_TIPOS_MONITORAVEIS = [
  'microsoft.compute/virtualmachines', 'microsoft.compute/virtualmachinescalesets',
  'microsoft.containerservice/managedclusters', 'microsoft.containerinstance/containergroups',
  'microsoft.containerregistry/registries', 'microsoft.app/containerapps', 'microsoft.batch/batchaccounts',
  'microsoft.web/sites', 'microsoft.sql/servers/databases', 'microsoft.sql/managedinstances',
  'microsoft.dbforpostgresql/servers', 'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbformysql/servers', 'microsoft.dbformysql/flexibleservers', 'microsoft.documentdb/databaseaccounts',
  'microsoft.cache/redis', 'microsoft.datafactory/factories', 'microsoft.synapse/workspaces',
  'microsoft.kusto/clusters', 'microsoft.databricks/workspaces', 'microsoft.search/searchservices',
  'microsoft.network/networksecuritygroups', 'microsoft.network/applicationgateways',
  'microsoft.network/azurefirewalls', 'microsoft.network/loadbalancers', 'microsoft.network/publicipaddresses',
  'microsoft.network/virtualnetworkgateways', 'microsoft.network/expressroutecircuits',
  'microsoft.network/bastionhosts', 'microsoft.network/trafficmanagerprofiles', 'microsoft.network/frontdoors',
  'microsoft.cdn/profiles', 'microsoft.network/privatednszones', 'microsoft.network/dnszones',
  'microsoft.apimanagement/service', 'microsoft.servicebus/namespaces', 'microsoft.eventhub/namespaces',
  'microsoft.logic/workflows', 'microsoft.automation/automationaccounts', 'microsoft.devices/iothubs',
  'microsoft.signalrservice/signalr', 'microsoft.keyvault/vaults', 'microsoft.aad/domainservices',
  'microsoft.recoveryservices/vaults', 'microsoft.storage/storageaccounts', 'microsoft.insights/components',
  'microsoft.machinelearningservices/workspaces', 'microsoft.cognitiveservices/accounts',
];

// Descoberta via ARM (plano de gerência — usa o token/acesso que a SP já tem hoje, sem
// precisar da permissão nova). Upsert em log_analytics_workspaces.
async function _descobrirLogAnalyticsWorkspaces() {
  await ensureLogAnalyticsTable();
  const { getToken, subs } = await _getInventarioSpConfig();
  const token = await getToken();
  const todos = [];
  await _mapLimit(subs, 4, async (sub) => {
    const url = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.OperationalInsights/workspaces?api-version=2023-09-01`;
    let resp;
    try {
      resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
    } catch (e) {
      console.warn(`[LogAnalytics] Erro ao listar workspaces da assinatura ${sub}:`, e.message);
      return;
    }
    if (!resp.ok) { console.warn(`[LogAnalytics] Assinatura ${sub} retornou ${resp.status} ao listar workspaces`); return; }
    const data = await _safeRespJson(resp);
    for (const ws of (data.value || [])) {
      if (!ws.properties?.customerId) continue;
      // dailyQuotaGb vem -1 quando "sem limite" (e não costuma vir ausente, mas o `?? null`
      // cobre workspaces antigos/tier legado onde o campo nem existe) — guardamos -1 como NULL
      // pra "Daily Cap" na tela virar direto "Sem limite" sem lógica extra no consumidor.
      const dailyQuotaGb = ws.properties.workspaceCapping?.dailyQuotaGb;
      todos.push({
        resource_id: ws.id,
        workspace_guid: ws.properties.customerId,
        subscription_id: sub,
        resource_group: String(ws.id).split('/')[4] || null,
        nome: ws.name,
        retencao_dias: ws.properties.retentionInDays ?? null,
        sku: ws.properties.sku?.name ?? null,
        daily_cap_gb: (dailyQuotaGb == null || dailyQuotaGb < 0) ? null : dailyQuotaGb,
      });
    }
  });
  if (!todos.length) return todos;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const w of todos) {
      await c.query(
        `INSERT INTO log_analytics_workspaces (resource_id, workspace_guid, subscription_id, resource_group, nome, retencao_dias, sku, daily_cap_gb, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (resource_id) DO UPDATE SET
           workspace_guid=EXCLUDED.workspace_guid, resource_group=EXCLUDED.resource_group, nome=EXCLUDED.nome,
           retencao_dias=EXCLUDED.retencao_dias, sku=EXCLUDED.sku, daily_cap_gb=EXCLUDED.daily_cap_gb, atualizado_em=NOW()`,
        [w.resource_id, w.workspace_guid, w.subscription_id, w.resource_group, w.nome, w.retencao_dias, w.sku, w.daily_cap_gb]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return todos;
}

// UMA query KQL por workspace cobre as 5 regras (ingestão por tabela × dia, 30d) — ver
// _avaliarRegrasLogAnalytics. Plano de dados — exige "Log Analytics Reader" na SP.
async function _coletarIngestaoWorkspace(ws, getLogAnalyticsToken) {
  const token = await getLogAnalyticsToken();
  const kql = `Usage | where TimeGenerated > ago(30d) | summarize GB = sum(Quantity)/1024 by DataType, bin(TimeGenerated, 1d)`;
  const url = `https://api.loganalytics.io/v1/workspaces/${ws.workspace_guid}/query`;
  const resp = await _cbFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: kql }),
  }, { timeoutMs: 30_000 });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    if (resp.status === 403) {
      throw new Error(`Sem permissão de leitura no workspace ${ws.nome} (403) — confirme o papel "Log Analytics Reader" concedido à Service Principal.`);
    }
    throw new Error(`Consulta KQL falhou no workspace ${ws.nome} (${resp.status}): ${errTxt.slice(0, 300)}`);
  }
  const data = await _safeRespJson(resp);
  const table = data.tables?.[0];
  if (!table || !table.rows?.length) return [];
  const cols = table.columns.map(c => c.name);
  const iGB = cols.indexOf('GB'), iTipo = cols.indexOf('DataType'), iDia = cols.indexOf('TimeGenerated');
  const linhas = table.rows.map(r => ({ tabela: r[iTipo], dia: String(r[iDia]).slice(0, 10), gb: Number(r[iGB]) || 0 }));
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const l of linhas) {
      await c.query(
        `INSERT INTO log_analytics_ingestao_diaria (workspace_guid, dia, tabela, gb)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (workspace_guid, dia, tabela) DO UPDATE SET gb = EXCLUDED.gb`,
        [ws.workspace_guid, l.dia, l.tabela, l.gb]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return linhas;
}

// Config de retenção por tabela — plano de gerência (ARM), MESMO token do
// _getInventarioSpConfig usado pra descobrir os workspaces (não precisa do escopo extra
// de Log Analytics Reader, que só serve pra Query API de ingestão). Responde diretamente
// "quais tabelas estão pagando retenção diferente do padrão do workspace".
async function _coletarTabelasWorkspace(ws, getToken) {
  const token = await getToken();
  const url = `https://management.azure.com${ws.resource_id}/tables?api-version=2023-09-01`;
  const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
  if (!resp.ok) {
    console.warn(`[LogAnalytics] Falha ao listar tabelas do workspace ${ws.nome} (${resp.status})`);
    return [];
  }
  const data = await _safeRespJson(resp);
  const tabelas = (data.value || []).map(t => {
    const p = t.properties || {};
    return {
      tabela: t.name,
      plano: p.plan || 'Analytics',
      retencao_dias: p.retentionInDays ?? null,
      retencao_total_dias: p.totalRetentionInDays ?? null,
      retencao_arquivo_dias: p.archiveRetentionInDays ?? null,
      retencao_e_padrao: p.retentionInDaysAsDefault !== false && p.totalRetentionInDaysAsDefault !== false,
    };
  });
  if (!tabelas.length) return tabelas;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const t of tabelas) {
      await c.query(
        `INSERT INTO log_analytics_tabelas (workspace_guid, tabela, plano, retencao_dias, retencao_total_dias, retencao_arquivo_dias, retencao_e_padrao, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (workspace_guid, tabela) DO UPDATE SET
           plano=EXCLUDED.plano, retencao_dias=EXCLUDED.retencao_dias, retencao_total_dias=EXCLUDED.retencao_total_dias,
           retencao_arquivo_dias=EXCLUDED.retencao_arquivo_dias, retencao_e_padrao=EXCLUDED.retencao_e_padrao, atualizado_em=NOW()`,
        [ws.workspace_guid, t.tabela, t.plano, t.retencao_dias, t.retencao_total_dias, t.retencao_arquivo_dias, t.retencao_e_padrao]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return tabelas;
}

// Habilita a auditoria de consultas (LAQueryLogs) — PRIMEIRA ação de ESCRITA na Azure em todo
// o projeto (tudo antes disso é leitura). Nunca roda sozinho: só via botão manual, porque muda
// configuração real do cliente e gera ingestão nova (pequena, mas real e billable). Cria um
// Diagnostic Setting no PRÓPRIO workspace (categoria "Audit"), mandando a auditoria pra ele
// mesmo — mesmo padrão documentado pela Microsoft ("select the workspace so that the auditing
// data is stored in the same workspace"). Exige que a SP tenha permissão de ESCRITA
// (Microsoft.Insights/diagnosticSettings/write) no workspace — ela só precisa de leitura pra
// tudo mais nesta feature, então isso tem que ser concedido à parte.
async function _habilitarAuditoriaConsultas(ws, getToken) {
  const token = await getToken();
  const nomeConfig = 'finops-audit-consultas';
  const url = `https://management.azure.com${ws.resource_id}/providers/microsoft.insights/diagnosticSettings/${nomeConfig}?api-version=2021-05-01-preview`;
  const body = {
    properties: {
      workspaceId: ws.resource_id, // auditoria do workspace mandada pra ele mesmo
      logs: [{ category: 'Audit', enabled: true }],
    },
  };
  const resp = await _cbFetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: 30_000 });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    const msg = resp.status === 403
      ? `Sem permissão de escrita (403) — confirme que a Service Principal tem "Microsoft.Insights/diagnosticSettings/write" neste workspace (ela só precisa de leitura pra tudo mais).`
      : `Falha ao habilitar auditoria (${resp.status}): ${errTxt.slice(0, 300)}`;
    throw new Error(msg);
  }
  await pool.query(`UPDATE log_analytics_workspaces SET auditoria_consultas_habilitada = true WHERE workspace_guid = $1`, [ws.workspace_guid]);
  return { ok: true };
}

// Quantas queries rodaram em cada tabela, últimos 30 dias — só pros workspaces com auditoria
// habilitada (ver _habilitarAuditoriaConsultas). Mesma Query API/token de
// _coletarIngestaoWorkspace, só muda a tabela-alvo (LAQueryLogs em vez de Usage).
//
// Atribuição de tabela por TEXTO: LAQueryLogs não tem coluna "tabela consultada" (só
// QueryText cru e RequestContext com workspaces/recursos, não tabelas) — pegamos o primeiro
// identificador da query e só contamos se ele bater com uma tabela já conhecida deste
// workspace (evita contar qualquer palavra solta como "tabela"). Aproximação: queries simples
// (`Tabela | where ...`) acertam, queries complexas (union, múltiplos joins) podem não ser
// atribuídas a nenhuma tabela — fica de fora da contagem em vez de adivinhar errado.
async function _coletarConsultasPorTabela(ws, getLogAnalyticsToken) {
  const tabelasConhecidas = new Set(
    (await pool.query(`SELECT tabela FROM log_analytics_tabelas WHERE workspace_guid = $1`, [ws.workspace_guid])).rows.map(r => r.tabela)
  );
  if (!tabelasConhecidas.size) return [];

  const token = await getLogAnalyticsToken();
  const kql = `LAQueryLogs | where TimeGenerated > ago(30d) | project QueryText, TimeGenerated, ScannedGB`;
  const url = `https://api.loganalytics.io/v1/workspaces/${ws.workspace_guid}/query`;
  const resp = await _cbFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: kql }),
  }, { timeoutMs: 30_000 });
  if (!resp.ok) {
    console.warn(`[LogAnalytics] Falha ao consultar LAQueryLogs do workspace ${ws.nome} (${resp.status})`);
    return [];
  }
  const data = await _safeRespJson(resp);
  const table = data.tables?.[0];
  if (!table || !table.rows?.length) return [];
  const cols = table.columns.map(c => c.name);
  const iQuery = cols.indexOf('QueryText'), iTime = cols.indexOf('TimeGenerated'), iGB = cols.indexOf('ScannedGB');

  const agregados = new Map(); // tabela -> { consultas, gb, ultima }
  for (const row of table.rows) {
    const texto = String(row[iQuery] || '').trim();
    const primeiroToken = (texto.match(/^[A-Za-z_][A-Za-z0-9_]*/) || [])[0];
    if (!primeiroToken || !tabelasConhecidas.has(primeiroToken)) continue; // não atribuível, fica de fora
    const ag = agregados.get(primeiroToken) || { consultas: 0, gb: 0, ultima: null };
    ag.consultas++;
    ag.gb += Number(row[iGB]) || 0;
    const dataConsulta = row[iTime];
    if (!ag.ultima || dataConsulta > ag.ultima) ag.ultima = dataConsulta;
    agregados.set(primeiroToken, ag);
  }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM log_analytics_consultas_tabela WHERE workspace_guid = $1`, [ws.workspace_guid]);
    for (const [tabela, ag] of agregados.entries()) {
      await c.query(
        `INSERT INTO log_analytics_consultas_tabela (workspace_guid, tabela, consultas_30d, gb_escaneado_30d, ultima_consulta, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [ws.workspace_guid, tabela, ag.consultas, ag.gb, ag.ultima]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return Array.from(agregados.entries());
}

// Data Collection Rules (Azure Monitor Agent — Syslog, Windows Event Log, Performance
// Counters, Custom Logs, extensões) — 1 chamada por subscription, barato o bastante pra
// entrar na coleta diária normal (ao contrário de Diagnostic Settings, que é por recurso).
// Só grava linhas cujo destino bate com um workspace já inventariado (uma DCR pode ter mais
// de um destino Log Analytics — 1 linha por destino que interessa).
async function _coletarDCRs(getToken, workspaceByResourceId) {
  const { subs } = await _getInventarioSpConfig();
  const token = await getToken();
  const todasLinhas = [];
  await _mapLimit(subs, 4, async (sub) => {
    const url = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.Insights/dataCollectionRules?api-version=2023-03-11`;
    let resp;
    try {
      resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 30_000 });
    } catch (e) {
      console.warn(`[LogAnalytics] Erro ao listar DCRs da assinatura ${sub}:`, e.message);
      return;
    }
    if (!resp.ok) { console.warn(`[LogAnalytics] Assinatura ${sub} retornou ${resp.status} ao listar DCRs`); return; }
    const data = await _safeRespJson(resp);
    for (const dcr of (data.value || [])) {
      const p = dcr.properties || {};
      const destinosLA = p.destinations?.logAnalytics || [];
      const streams = Array.from(new Set((p.dataFlows || []).flatMap(f => f.streams || []))).sort();
      const { tiposFonte, detalheFontes } = _descreverFontesDcr(p.dataSources);
      for (const dest of destinosLA) {
        const wsGuid = workspaceByResourceId.get(String(dest.workspaceResourceId || '').toLowerCase());
        if (!wsGuid) continue; // destino fora do inventário de workspaces conhecidos
        todasLinhas.push({
          subscription_id: sub,
          resource_group: String(dcr.id).split('/')[4] || null,
          nome: dcr.name,
          workspace_guid_destino: wsGuid,
          streams: streams.join('; '),
          tipos_fonte: tiposFonte,
          detalhe_fontes: detalheFontes,
        });
      }
    }
  });
  if (todasLinhas.length) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM log_analytics_dcrs WHERE subscription_id = ANY($1)`, [subs]);
      for (const l of todasLinhas) {
        await c.query(
          `INSERT INTO log_analytics_dcrs (subscription_id, resource_group, nome, workspace_guid_destino, streams, tipos_fonte, detalhe_fontes, atualizado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [l.subscription_id, l.resource_group, l.nome, l.workspace_guid_destino, l.streams, l.tipos_fonte, l.detalhe_fontes]
        );
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  return todasLinhas;
}

// Decompõe dcr.properties.dataSources (equivalente, pra DCR, das "categorias habilitadas" de
// um Diagnostic Setting) num resumo legível por tipo de fonte de coleta.
function _descreverFontesDcr(dataSources) {
  if (!dataSources) return { tiposFonte: null, detalheFontes: null };
  const tipos = [];
  const detalhes = [];
  if (dataSources.performanceCounters?.length) {
    tipos.push('PerformanceCounters');
    const specs = Array.from(new Set(dataSources.performanceCounters.flatMap(d => d.counterSpecifiers || []))).slice(0, 15);
    detalhes.push('Perf: ' + specs.join(', '));
  }
  if (dataSources.windowsEventLogs?.length) {
    tipos.push('WindowsEventLogs');
    const q = Array.from(new Set(dataSources.windowsEventLogs.flatMap(d => d.xPathQueries || []))).slice(0, 10);
    detalhes.push('WinEvent: ' + q.join(', '));
  }
  if (dataSources.syslog?.length) {
    tipos.push('Syslog');
    const facilities = Array.from(new Set(dataSources.syslog.flatMap(d => d.facilityNames || [])));
    detalhes.push('Syslog: ' + facilities.join(', '));
  }
  if (dataSources.extensions?.length) {
    tipos.push('Extensions');
    const nomes = Array.from(new Set(dataSources.extensions.map(d => d.extensionName).filter(Boolean)));
    detalhes.push('Extensions: ' + nomes.join(', '));
  }
  if (dataSources.logFiles?.length) {
    tipos.push('LogFiles');
    const patterns = Array.from(new Set(dataSources.logFiles.flatMap(d => d.filePatterns || []))).slice(0, 10);
    detalhes.push('LogFiles: ' + patterns.join(', '));
  }
  if (dataSources.iisLogs?.length) tipos.push('IISLogs');
  if (dataSources.prometheusForwarder?.length) tipos.push('PrometheusMetrics');
  return { tiposFonte: tipos.join('; ') || null, detalheFontes: detalhes.join(' | ') || null };
}

// Application Insights — alavancas de custo próprias (Sampling, Daily Cap, Retenção),
// diferentes de Diagnostic Settings/DCR. Duas chamadas ARM read-only, sem permissão nova:
// (1) Resource Graph indexa `properties` do componente (SamplingPercentage, RetentionInDays,
// IngestionMode, WorkspaceResourceId) — UMA query cobre todos os componentes de todas as
// subscriptions, bem mais barato que Diagnostic Settings (que o Resource Graph não indexa).
// (2) Daily Cap (`currentbillingfeatures`) é um sub-endpoint fora do Resource Graph — precisa
// 1 chamada por componente, mas o volume aqui é só "componentes de App Insights", não os ~42
// tipos monitoráveis de Diagnostic Settings, então cabe na coleta diária normal (sem cadência
// semanal separada). `workspace_resource_id`, quando presente, é o vínculo direto com
// log_analytics_workspaces — App Insights "workspace-based" fatura através do workspace.
async function _coletarAppInsightsTudo() {
  await ensureLogAnalyticsTable();
  const { getToken, subs } = await _getInventarioSpConfig();
  const token = await getToken();
  const kql = `resources | where type == 'microsoft.insights/components' | project id, name, resourceGroup, subscriptionId, properties`;
  const componentes = await _resourceGraphQuery(token, subs, kql);
  if (!componentes.length) return { ok: true, componentes: 0 };

  const linhas = componentes.map(c => {
    const p = c.properties || {};
    return {
      resource_id: c.id,
      subscription_id: c.subscriptionId,
      resource_group: c.resourceGroup,
      nome: c.name,
      sampling_percentage: p.SamplingPercentage ?? null,
      retencao_dias: p.RetentionInDays ?? null,
      ingestion_mode: p.IngestionMode ?? null,
      workspace_resource_id: p.WorkspaceResourceId ?? null,
    };
  });

  // Daily Cap — 1 chamada por componente, em paralelo.
  await _mapLimit(linhas, 8, async (l) => {
    const url = `https://management.azure.com${l.resource_id}/currentbillingfeatures?api-version=2015-05-01`;
    try {
      const resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 20_000 });
      if (!resp.ok) return;
      const data = await _safeRespJson(resp);
      const cap = data.DataVolumeCap?.Cap;
      l.daily_cap_gb = (cap == null || cap < 0) ? null : cap;
    } catch (e) {
      console.warn(`[LogAnalytics] Falha ao buscar Daily Cap de App Insights ${l.nome}:`, e.message);
    }
  });

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const l of linhas) {
      await c.query(
        `INSERT INTO log_analytics_app_insights
           (resource_id, subscription_id, resource_group, nome, sampling_percentage, retencao_dias,
            ingestion_mode, workspace_resource_id, daily_cap_gb, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (resource_id) DO UPDATE SET
           subscription_id=EXCLUDED.subscription_id, resource_group=EXCLUDED.resource_group, nome=EXCLUDED.nome,
           sampling_percentage=EXCLUDED.sampling_percentage, retencao_dias=EXCLUDED.retencao_dias,
           ingestion_mode=EXCLUDED.ingestion_mode, workspace_resource_id=EXCLUDED.workspace_resource_id,
           daily_cap_gb=EXCLUDED.daily_cap_gb, atualizado_em=NOW()`,
        [l.resource_id, l.subscription_id, l.resource_group, l.nome, l.sampling_percentage, l.retencao_dias,
          l.ingestion_mode, l.workspace_resource_id, l.daily_cap_gb ?? null]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true, componentes: linhas.length };
}

// Diagnostic Settings — "quais recursos estão coletando" e "quais categorias de log estão
// habilitadas". Etapa CARA: o Resource Graph não indexa de forma confiável o recurso de
// extensão `microsoft.insights/diagnosticsettings` (constatado em produção neste tenant — um
// Diagnostic Setting ativo e visível no Portal, num Azure Firewall, não aparecia via Resource
// Graph). A API oficial usada pelo próprio Portal é `diagnosticSettings.list` POR RECURSO —
// então usamos o Resource Graph só pra ENUMERAR candidatos (rápido, tabela `resources` é
// confiável) e chamamos a API oficial recurso a recurso, em paralelo. Por isso cadência
// própria (semanal + botão manual), não entra no loop diário de 24h da coleta principal.
let _logAnalyticsDiagEmExecucao = false;
async function _coletarDiagnosticSettingsTudo() {
  if (_logAnalyticsDiagEmExecucao) return { ok: false, motivo: 'coleta de Diagnostic Settings já em execução' };
  _logAnalyticsDiagEmExecucao = true;
  const t0 = Date.now();
  try {
    await ensureLogAnalyticsTable();
    const { getToken, subs } = await _getInventarioSpConfig();
    const wsRows = (await pool.query(`SELECT resource_id, workspace_guid FROM log_analytics_workspaces`)).rows;
    if (!wsRows.length) return { ok: false, motivo: 'Nenhum workspace inventariado ainda — rode a coleta principal antes' };
    const workspaceByResourceId = new Map(wsRows.map(w => [String(w.resource_id).toLowerCase(), w.workspace_guid]));

    const token = await getToken();
    const tiposClause = _LOG_ANALYTICS_TIPOS_MONITORAVEIS.map(t => `'${t}'`).join(', ');
    const kql = `resources | where type in (${tiposClause}) | project id, type, subscriptionId`;
    const candidatos = await _resourceGraphQuery(token, subs, kql);
    console.log(`[LogAnalytics] Diagnostic Settings: ${candidatos.length} recurso(s) candidato(s) de ${_LOG_ANALYTICS_TIPOS_MONITORAVEIS.length} tipo(s) monitorados.`);

    const linhas = [];
    let checados = 0, naoEncontrados = 0, outrasFalhas = 0;
    await _mapLimit(candidatos, 8, async (recurso) => {
      const url = `https://management.azure.com${recurso.id}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview`;
      let resp;
      try {
        resp = await _cbFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 20_000 });
      } catch (e) { outrasFalhas++; return; }
      checados++;
      if (resp.status === 404) { naoEncontrados++; return; } // recurso efêmero (ex.: VM de cluster auto-scaling), já não existe
      if (!resp.ok) { outrasFalhas++; return; }
      const data = await _safeRespJson(resp);
      for (const setting of (data.value || [])) {
        const p = setting.properties || {};
        const wsGuid = workspaceByResourceId.get(String(p.workspaceId || '').toLowerCase());
        if (!wsGuid) continue; // não aponta pra um workspace do nosso inventário
        const logsCat = _categoriasDiagnostic(p.logs);
        const metricsCat = _categoriasDiagnostic(p.metrics);
        linhas.push({
          workspace_guid: wsGuid,
          nome_config: setting.name,
          recurso_id: recurso.id,
          recurso_tipo: recurso.type,
          categorias_habilitadas: logsCat.habilitadas,
          categorias_desabilitadas: logsCat.desabilitadas,
          grupos_categoria: logsCat.grupos,
          metricas_habilitadas: metricsCat.habilitadas,
          metricas_desabilitadas: metricsCat.desabilitadas,
          envia_storage: !!p.storageAccountId,
          envia_eventhub: !!p.eventHubAuthorizationRuleId,
        });
      }
    });

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM log_analytics_diagnostic_settings`);
      for (const l of linhas) {
        await c.query(
          `INSERT INTO log_analytics_diagnostic_settings
             (workspace_guid, nome_config, recurso_id, recurso_tipo, categorias_habilitadas, categorias_desabilitadas,
              grupos_categoria, metricas_habilitadas, metricas_desabilitadas, envia_storage, envia_eventhub, atualizado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [l.workspace_guid, l.nome_config, l.recurso_id, l.recurso_tipo, l.categorias_habilitadas, l.categorias_desabilitadas,
            l.grupos_categoria, l.metricas_habilitadas, l.metricas_desabilitadas, l.envia_storage, l.envia_eventhub]
        );
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }

    let fanout = 0;
    try { fanout = await _avaliarFanoutDiagnosticSettings(); }
    catch (e) { console.warn('[LogAnalytics] Falha ao avaliar fan-out de Diagnostic Settings:', e.message); }

    console.log(`[LogAnalytics] Diagnostic Settings: ${checados} recurso(s) consultado(s) (${naoEncontrados} não encontrados, ${outrasFalhas} outras falhas), ${linhas.length} configuração(ões) casada(s), ${fanout} recurso(s) com fan-out em ${Math.round((Date.now() - t0) / 1000)}s.`);
    return { ok: true, candidatos: candidatos.length, checados, configuracoes: linhas.length, fanout };
  } catch (e) {
    console.warn('[LogAnalytics] Falha geral na coleta de Diagnostic Settings:', e.message);
    return { ok: false, motivo: e.message };
  } finally {
    _logAnalyticsDiagEmExecucao = false;
  }
}

function _categoriasDiagnostic(lista) {
  if (!lista || !lista.length) return { habilitadas: null, desabilitadas: null, grupos: null };
  const habilitadas = new Set(), desabilitadas = new Set(), grupos = new Set();
  for (const item of lista) {
    const label = item.category || item.categoryGroup || 'N/A';
    if (item.categoryGroup) grupos.add(item.categoryGroup);
    (item.enabled ? habilitadas : desabilitadas).add(label);
  }
  return {
    habilitadas: habilitadas.size ? Array.from(habilitadas).sort().join('; ') : null,
    desabilitadas: desabilitadas.size ? Array.from(desabilitadas).sort().join('; ') : null,
    grupos: grupos.size ? Array.from(grupos).sort().join('; ') : null,
  };
}

// Fan-out: o MESMO recurso (ex.: um Firewall) com Diagnostic Settings mandando log pra MAIS DE
// UM workspace diferente — cada envio é cobrado como ingestão nova no workspace de destino, ou
// seja, o mesmo dado é pago em dobro (ou mais). Às vezes é intencional (segregação prod/dev,
// time de segurança com workspace próprio), mas é raro o suficiente pra merecer confirmação.
// Roda 1x por coleta de Diagnostic Settings (não é por workspace — é por RECURSO, cruzando os
// workspaces), por isso recalcula tudo e usa origem='diagnostic_settings' (não mexe nas
// recomendações 'ingestao' do loop diário, ver coluna `origem`).
async function _avaliarFanoutDiagnosticSettings() {
  const r = await pool.query(`
    SELECT d.recurso_id, d.recurso_tipo,
           array_agg(DISTINCT w.nome ORDER BY w.nome) AS workspaces,
           array_agg(DISTINCT d.workspace_guid) AS workspace_guids
    FROM log_analytics_diagnostic_settings d
    JOIN log_analytics_workspaces w ON w.workspace_guid = d.workspace_guid
    GROUP BY d.recurso_id, d.recurso_tipo
    HAVING COUNT(DISTINCT d.workspace_guid) > 1
  `);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM log_analytics_recomendacoes WHERE origem = 'diagnostic_settings'`);
    for (const row of r.rows) {
      const nomeRecurso = String(row.recurso_id).split('/').pop();
      const regra = ('fanout_' + nomeRecurso).slice(0, 50);
      const detalhe = `Recurso "${nomeRecurso}" (${row.recurso_tipo}) tem Diagnostic Settings mandando dado pra ${row.workspace_guids.length} workspaces diferentes: ${row.workspaces.join(', ')}. Cada destino é ingestão paga separadamente — confirme se é intencional (ex.: segregação por time/ambiente) ou se há um Diagnostic Setting duplicado pra desligar.`;
      for (const wsGuid of row.workspace_guids) {
        await c.query(
          `INSERT INTO log_analytics_recomendacoes (workspace_guid, regra, severidade, detalhe, origem)
           VALUES ($1,$2,'atencao',$3,'diagnostic_settings')
           ON CONFLICT (workspace_guid, regra) DO UPDATE SET detalhe = EXCLUDED.detalhe, criado_em = NOW()`,
          [wsGuid, regra, detalhe]
        );
      }
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return r.rows.length;
}

// Cadência própria (semanal) — separada do loop diário de 24h da coleta principal, porque é
// uma etapa muito mais cara (1 chamada de API por recurso candidato do tenant inteiro).
let _logAnalyticsDiagTimer = null;
function _iniciarLogAnalyticsDiagAgendador() {
  if (_logAnalyticsDiagTimer) return;
  setTimeout(() => { _coletarDiagnosticSettingsTudo().catch(() => {}); }, 600_000);
  _logAnalyticsDiagTimer = setInterval(() => {
    _coletarDiagnosticSettingsTudo().catch(() => {});
  }, 7 * 24 * 60 * 60 * 1000);
}

// Limiares fixos na v1 (tornar configurável pelo admin fica pra v2, junto do motor de
// score — mesmo formato do split Microsoft/Marketplace de imposto, quando chegar a hora).
const _LOG_ANALYTICS_LIMIARES = {
  appInsightsPct: 30, retencaoDias: 90, diagnosticsPct: 40, containerLogPct: 30, crescimentoPct: 20,
};
const _LOG_ANALYTICS_APP_INSIGHTS_TABELAS = ['AppTraces', 'AppRequests', 'AppDependencies', 'AppExceptions', 'AppPageViews', 'AppEvents'];

async function _avaliarRegrasLogAnalytics(ws) {
  const r = await pool.query(
    `SELECT dia, tabela, gb FROM log_analytics_ingestao_diaria WHERE workspace_guid = $1 ORDER BY dia`,
    [ws.workspace_guid]
  );
  const linhas = r.rows;
  const totalGeral = linhas.reduce((a, x) => a + Number(x.gb), 0);
  const porTabela = {};
  for (const l of linhas) porTabela[l.tabela] = (porTabela[l.tabela] || 0) + Number(l.gb);
  const pctTabelas = (nomes) => totalGeral > 0
    ? (Object.entries(porTabela).filter(([t]) => nomes.includes(t)).reduce((a, [, v]) => a + v, 0) / totalGeral) * 100
    : 0;

  const recos = [];
  const appInsightsPct = pctTabelas(_LOG_ANALYTICS_APP_INSIGHTS_TABELAS);
  if (appInsightsPct > _LOG_ANALYTICS_LIMIARES.appInsightsPct) {
    recos.push({ regra: 'app_insights_alto', severidade: 'atencao',
      detalhe: `Application Insights representa ${appInsightsPct.toFixed(1)}% da ingestão dos últimos 30 dias. Considere reduzir logs de nível Information, mantendo Warning/Error/Critical.` });
  }
  if (ws.retencao_dias != null && ws.retencao_dias > _LOG_ANALYTICS_LIMIARES.retencaoDias) {
    recos.push({ regra: 'retencao_alta', severidade: 'atencao',
      detalhe: `Retenção configurada em ${ws.retencao_dias} dias. Considere mover dados frios para a camada Archive.` });
  }
  const diagPct = pctTabelas(['AzureDiagnostics']);
  if (diagPct > _LOG_ANALYTICS_LIMIARES.diagnosticsPct) {
    recos.push({ regra: 'diagnostics_alto', severidade: 'atencao',
      detalhe: `AzureDiagnostics representa ${diagPct.toFixed(1)}% da ingestão. Revise os Diagnostic Settings vinculados a este workspace.` });
  }
  const containerPct = pctTabelas(['ContainerLogV2']);
  if (containerPct > _LOG_ANALYTICS_LIMIARES.containerLogPct) {
    recos.push({ regra: 'aks_log_alto', severidade: 'atencao',
      detalhe: `ContainerLogV2 (AKS) representa ${containerPct.toFixed(1)}% da ingestão. Considere reduzir a verbosidade de log dos containers.` });
  }
  const porDia = {};
  for (const l of linhas) porDia[l.dia] = (porDia[l.dia] || 0) + Number(l.gb);
  const dias = Object.keys(porDia).sort();
  if (dias.length >= 2) {
    const ontem = porDia[dias[dias.length - 2]], hoje = porDia[dias[dias.length - 1]];
    const crescimentoPct = ontem > 0 ? ((hoje - ontem) / ontem) * 100 : 0;
    if (crescimentoPct > _LOG_ANALYTICS_LIMIARES.crescimentoPct) {
      recos.push({ regra: 'crescimento_anomalo', severidade: 'critico',
        detalhe: `Ingestão cresceu ${crescimentoPct.toFixed(1)}% de um dia para o outro (${dias[dias.length - 2]} → ${dias[dias.length - 1]}).` });
    }
  }

  // Regras 6 e 7 usam a config real por tabela (ARM), coletada em _coletarTabelasWorkspace —
  // não fazem sentido sem isso, então saem em silêncio se a tabela ainda não foi populada.
  const rTabelas = await pool.query(
    `SELECT tabela, plano, retencao_total_dias, retencao_e_padrao FROM log_analytics_tabelas WHERE workspace_guid = $1`,
    [ws.workspace_guid]
  );
  // Fase 4 do plano de Auditoria de Consultas: quando o workspace tem a auditoria habilitada
  // (_coletarConsultasPorTabela já rodou antes desta função, ver _coletarLogAnalyticsTudo),
  // usa a frequência real de consultas pra refinar a confiança da regra de Basic — sem isso,
  // ela só enxerga volume de ingestão, que sozinho não diz se a tabela é realmente usada.
  const rConsultas = await pool.query(
    `SELECT tabela, consultas_30d FROM log_analytics_consultas_tabela WHERE workspace_guid = $1`,
    [ws.workspace_guid]
  );
  const temAuditoria = rConsultas.rows.length > 0;
  const consultasPorTabela = {};
  for (const c of rConsultas.rows) consultasPorTabela[c.tabela] = c.consultas_30d;

  for (const t of rTabelas.rows) {
    const gbTabela = porTabela[t.tabela] || 0;
    const pctTabela = totalGeral > 0 ? (gbTabela / totalGeral) * 100 : 0;
    if (t.plano === 'Analytics' && pctTabela > 10 && gbTabela > 0) {
      const consultas = consultasPorTabela[t.tabela] ?? null;
      // Consultada com frequência: Basic cobra por GB escaneado em query, então migrar pode
      // sair mais caro do que continuar em Analytics — suprime a recomendação neste caso.
      const consultadaComFrequencia = temAuditoria && consultas != null && consultas > 5;
      if (!consultadaComFrequencia) {
        const semNenhumaConsulta = temAuditoria && (consultas == null || consultas === 0);
        recos.push({ regra: ('candidata_basic_' + t.tabela).slice(0, 50), severidade: semNenhumaConsulta ? 'critico' : 'atencao',
          detalhe: semNenhumaConsulta
            ? `Tabela "${t.tabela}" está no plano Analytics, representa ${pctTabela.toFixed(1)}% da ingestão e NÃO teve nenhuma consulta nos últimos 30 dias (auditoria de consultas habilitada). Forte candidata a mover para o plano Basic.`
            : `Tabela "${t.tabela}" está no plano Analytics e representa ${pctTabela.toFixed(1)}% da ingestão. Se não precisa de alertas nem de queries frequentes, considere mover para o plano Basic (ingestão bem mais barata, cobra por GB escaneado em consulta).` });
      }
    }
    if (t.retencao_e_padrao === false && t.retencao_total_dias != null && t.retencao_total_dias > 31) {
      recos.push({ regra: ('retencao_custom_' + t.tabela).slice(0, 50), severidade: 'atencao',
        detalhe: `Tabela "${t.tabela}" tem retenção customizada de ${t.retencao_total_dias} dias (acima do padrão do workspace). Confirme se esse prazo é realmente necessário — reduzir a retenção corta o custo de armazenamento dessa tabela.` });
    }
  }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM log_analytics_recomendacoes WHERE workspace_guid = $1 AND origem = 'ingestao'`, [ws.workspace_guid]);
    for (const rec of recos) {
      await c.query(
        `INSERT INTO log_analytics_recomendacoes (workspace_guid, regra, severidade, detalhe, origem) VALUES ($1,$2,$3,$4,'ingestao')`,
        [ws.workspace_guid, rec.regra, rec.severidade, rec.detalhe]
      );
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return recos;
}

let _logAnalyticsColetaEmExecucao = false;
async function _coletarLogAnalyticsTudo(origem = 'agendado') {
  if (_logAnalyticsColetaEmExecucao) return { ok: false, motivo: 'coleta já em execução' };
  _logAnalyticsColetaEmExecucao = true;
  const t0 = Date.now();
  try {
    await ensureLogAnalyticsTable();
    const workspaces = await _descobrirLogAnalyticsWorkspaces();
    const { getToken, getLogAnalyticsToken } = await _getInventarioSpConfig();
    // `workspaces` vem fresco do ARM (_descobrirLogAnalyticsWorkspaces), não tem o flag que só
    // existe no nosso banco (setado por _habilitarAuditoriaConsultas) — busca à parte.
    const comAuditoria = new Set(
      (await pool.query(`SELECT workspace_guid FROM log_analytics_workspaces WHERE auditoria_consultas_habilitada = true`)).rows.map(r => r.workspace_guid)
    );
    const resultados = await _mapLimitSettled(workspaces, 4, async (ws) => {
      await _coletarIngestaoWorkspace(ws, getLogAnalyticsToken);
      await _coletarTabelasWorkspace(ws, getToken);
      if (comAuditoria.has(ws.workspace_guid)) {
        try { await _coletarConsultasPorTabela(ws, getLogAnalyticsToken); }
        catch (e) { console.warn(`[LogAnalytics] Falha ao coletar LAQueryLogs de ${ws.nome}:`, e.message); }
      }
      return _avaliarRegrasLogAnalytics(ws);
    });
    // DCR é barato (1 chamada por subscription, não por recurso) — entra na coleta diária.
    // Diagnostic Settings NÃO entra aqui (etapa cara, 1 chamada por recurso do tenant inteiro)
    // — tem cadência própria, ver _iniciarLogAnalyticsDiagAgendador.
    try {
      const workspaceByResourceId = new Map(workspaces.map(w => [String(w.resource_id).toLowerCase(), w.workspace_guid]));
      await _coletarDCRs(getToken, workspaceByResourceId);
    } catch (e) {
      console.warn('[LogAnalytics] Falha ao coletar DCRs:', e.message);
    }
    // Application Insights também é barato (1 Resource Graph query + 1 chamada por componente,
    // não por tipo monitorável) — entra na coleta diária, igual DCR.
    try {
      await _coletarAppInsightsTudo();
    } catch (e) {
      console.warn('[LogAnalytics] Falha ao coletar Application Insights:', e.message);
    }
    const falhas = resultados.filter(r => r.status === 'rejected');
    console.log(`[LogAnalytics] ${origem}: ${workspaces.length} workspace(s), ${falhas.length} falha(s) em ${Math.round((Date.now() - t0) / 1000)}s`);
    if (falhas.length) console.warn('[LogAnalytics] Primeira falha:', falhas[0].reason?.message);
    return { ok: true, workspaces: workspaces.length, falhas: falhas.length };
  } catch (e) {
    console.warn('[LogAnalytics] Falha geral na coleta:', e.message);
    return { ok: false, motivo: e.message };
  } finally {
    _logAnalyticsColetaEmExecucao = false;
  }
}

// 1x/dia — v1 não precisa de 3x/dia (isso é v3). Delay de boot próprio, escalonado dos
// outros scans pesados (mesmo espírito de _iniciarRecursoTagsCache).
let _logAnalyticsTimer = null;
function _iniciarLogAnalyticsAgendador() {
  if (_logAnalyticsTimer) return;
  setTimeout(() => { _coletarLogAnalyticsTudo('startup').catch(() => {}); }, 240_000);
  _logAnalyticsTimer = setInterval(() => {
    _coletarLogAnalyticsTudo('agendado').catch(() => {});
  }, 24 * 60 * 60 * 1000);
}

// Custo real (não estimado) vem de `azure_costs`, já coletado todo dia pela Coleta Azure
// existente (Cost Management) pra toda a assinatura — um workspace de Log Analytics é só
// mais um resource_id do ARM, então basta o JOIN por resource_id, sem coleta nova nem
// permissão nova (mesmo padrão de correlação em leitura usado no Inventário/Recursos
// Órfãos). O bucket ingestão×retenção é por padrão de texto no meter_name porque o nome
// exato do meter varia entre "Log Analytics", "Azure Monitor" e "Insight and Analytics"
// (tiers legados) — ver MODULES/04-AZURE-API para o desenho geral de azure_costs.
//
// Janela de 30 dias corridos, NÃO "mês corrente" (2026-10-01): a importação de Cost
// Management tem atraso de publicação do próprio Azure, e nesta base real chegou a ficar
// 9+ dias sem dado novo — com "mês corrente" isso dava custo zerado pra TODO workspace nos
// primeiros dias de cada mês (e sempre que a coleta atrasasse), parecendo bug. Últimos 30
// dias é uma janela móvel que sempre tem alguma sobreposição com o dado mais recente
// disponível, mesmo com esse atraso. Os nomes das colunas finais (`custo_mes_*`) ficaram
// mantidos por compatibilidade com o resto do código — o rótulo exibido na UI/Excel/Dashboard
// é que diz "últimos 30 dias".
//
// Vem BRUTO, separado por publisher_type (Microsoft × Marketplace) — não dá pra aplicar o
// imposto configurável em Configurações (`_getImpostoConfig`/`_comImpostoSplit`, mesma lógica
// já usada em Inventário/Alocação/Custo por Recurso) direto em SQL porque essa config é lida
// de forma assíncrona do `portal_config`. Cada consumidor desta constante DEVE passar as linhas
// por `_aplicarImpostoLogAnalytics(row, impostoCfg)` antes de expor `custo_mes_*` ao cliente —
// sem isso, o custo mostrado fica "cru", inconsistente com o resto do app.
const _LOG_ANALYTICS_CUSTO_SQL = `
  COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac
            WHERE UPPER(ac.resource_id) = UPPER(w.resource_id) AND ac.cost_date >= CURRENT_DATE - INTERVAL '30 days'
              AND ac.publisher_type IS DISTINCT FROM 'Marketplace'
              AND ac.meter_name NOT ILIKE '%retention%' AND ac.meter_name NOT ILIKE '%retenção%'), 0) AS _la_ing_ms,
  COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac
            WHERE UPPER(ac.resource_id) = UPPER(w.resource_id) AND ac.cost_date >= CURRENT_DATE - INTERVAL '30 days'
              AND ac.publisher_type = 'Marketplace'
              AND ac.meter_name NOT ILIKE '%retention%' AND ac.meter_name NOT ILIKE '%retenção%'), 0) AS _la_ing_mp,
  COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac
            WHERE UPPER(ac.resource_id) = UPPER(w.resource_id) AND ac.cost_date >= CURRENT_DATE - INTERVAL '30 days'
              AND ac.publisher_type IS DISTINCT FROM 'Marketplace'
              AND (ac.meter_name ILIKE '%retention%' OR ac.meter_name ILIKE '%retenção%')), 0) AS _la_ret_ms,
  COALESCE((SELECT SUM(ac.cost_in_billing_currency) FROM azure_costs ac
            WHERE UPPER(ac.resource_id) = UPPER(w.resource_id) AND ac.cost_date >= CURRENT_DATE - INTERVAL '30 days'
              AND ac.publisher_type = 'Marketplace'
              AND (ac.meter_name ILIKE '%retention%' OR ac.meter_name ILIKE '%retenção%')), 0) AS _la_ret_mp
`;

function _aplicarImpostoLogAnalytics(row, impostoCfg) {
  const custo_mes_ingestao = _comImpostoSplit(row._la_ing_ms, row._la_ing_mp, impostoCfg);
  const custo_mes_retencao = _comImpostoSplit(row._la_ret_ms, row._la_ret_mp, impostoCfg);
  delete row._la_ing_ms; delete row._la_ing_mp; delete row._la_ret_ms; delete row._la_ret_mp;
  return { ...row, custo_mes_ingestao, custo_mes_retencao, custo_mes_total: custo_mes_ingestao + custo_mes_retencao };
}

app.get('/api/log-analytics/workspaces', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureLogAnalyticsTable();
    const impostoCfg = await _getImpostoConfig();
    // JOINs pré-agregados (1 scan cada), não sub-select correlacionado por workspace — com
    // 100+ workspaces isso era 300+ execuções de subquery só pra montar essa lista.
    const r = await pool.query(`
      SELECT w.*,
        COALESCE(ing.gb_mes, 0) AS ingestao_mes_gb,
        COALESCE(rec.n, 0) AS recomendacoes_abertas,
        COALESCE(tc.n, 0) AS tabelas_retencao_customizada,
        ${_LOG_ANALYTICS_CUSTO_SQL}
      FROM log_analytics_workspaces w
      LEFT JOIN (
        SELECT workspace_guid, SUM(gb) AS gb_mes FROM log_analytics_ingestao_diaria
        WHERE dia >= date_trunc('month', CURRENT_DATE) GROUP BY workspace_guid
      ) ing ON ing.workspace_guid = w.workspace_guid
      LEFT JOIN (
        SELECT workspace_guid, COUNT(*) AS n FROM log_analytics_recomendacoes GROUP BY workspace_guid
      ) rec ON rec.workspace_guid = w.workspace_guid
      LEFT JOIN (
        SELECT workspace_guid, COUNT(*) AS n FROM log_analytics_tabelas WHERE retencao_e_padrao = false GROUP BY workspace_guid
      ) tc ON tc.workspace_guid = w.workspace_guid
    `);
    const linhas = r.rows.map(w => _aplicarImpostoLogAnalytics(w, impostoCfg))
      .sort((a, b) => (b.custo_mes_total || 0) - (a.custo_mes_total || 0));
    res.json(linhas);
  } catch (e) { _dbErr(res, e); }
});

// Inventário de Application Insights — nível topo (não dentro do drill-down de um workspace,
// já que nem todo componente é workspace-based). LEFT JOIN só pra trazer o nome do workspace
// vinculado quando existir, sem repetir a lógica de custo (App Insights workspace-based já
// fatura através do workspace, que aparece no card de Workspaces).
app.get('/api/log-analytics/app-insights', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    await ensureLogAnalyticsTable();
    const r = await pool.query(`
      SELECT ai.*, w.nome AS workspace_nome
      FROM log_analytics_app_insights ai
      LEFT JOIN log_analytics_workspaces w ON UPPER(w.resource_id) = UPPER(ai.workspace_resource_id)
      ORDER BY ai.nome
    `);
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

app.get('/api/log-analytics/workspaces/:guid/ingestao', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT dia, tabela, gb FROM log_analytics_ingestao_diaria WHERE workspace_guid = $1 ORDER BY dia, tabela`,
      [req.params.guid]
    );
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

// Inventário completo por tabela (retenção + custo). O custo por tabela é uma ESTIMATIVA por
// rateio, não a fatura exata — o Cost Management do Azure não fatura por tabela, só por
// workspace (ver plano aprovado desta feature). Rateio de ingestão pelo peso do GB da tabela;
// rateio de retenção pelo peso GB × dias de retenção além do período grátis (31d), porque uma
// tabela pequena com retenção de 2 anos pesa mais no custo de retenção do que uma tabela
// grande com retenção padrão.
app.get('/api/log-analytics/workspaces/:guid/tabelas', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { guid } = req.params;
    const wsR = await pool.query(`SELECT resource_id, auditoria_consultas_habilitada FROM log_analytics_workspaces WHERE workspace_guid = $1`, [guid]);
    if (!wsR.rows.length) return res.status(404).json({ error: 'Workspace não encontrado' });
    const resourceId = wsR.rows[0].resource_id;
    const auditoriaHabilitada = wsR.rows[0].auditoria_consultas_habilitada;

    const [tabelasR, gbR, custoR, impostoCfg, consultasR] = await Promise.all([
      pool.query(`SELECT tabela, plano, retencao_dias, retencao_total_dias, retencao_arquivo_dias, retencao_e_padrao
                  FROM log_analytics_tabelas WHERE workspace_guid = $1`, [guid]),
      pool.query(`SELECT tabela, SUM(gb) AS gb FROM log_analytics_ingestao_diaria
                  WHERE workspace_guid = $1 AND dia >= date_trunc('month', CURRENT_DATE) GROUP BY tabela`, [guid]),
      // Bruto, separado por publisher_type — mesmo motivo de _LOG_ANALYTICS_CUSTO_SQL acima:
      // precisa passar por _comImpostoSplit antes de virar o total exibido/rateado.
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN (meter_name ILIKE '%retention%' OR meter_name ILIKE '%retenção%') AND publisher_type IS DISTINCT FROM 'Marketplace' THEN cost_in_billing_currency ELSE 0 END), 0) AS ret_ms,
          COALESCE(SUM(CASE WHEN (meter_name ILIKE '%retention%' OR meter_name ILIKE '%retenção%') AND publisher_type = 'Marketplace' THEN cost_in_billing_currency ELSE 0 END), 0) AS ret_mp,
          COALESCE(SUM(CASE WHEN meter_name NOT ILIKE '%retention%' AND meter_name NOT ILIKE '%retenção%' AND publisher_type IS DISTINCT FROM 'Marketplace' THEN cost_in_billing_currency ELSE 0 END), 0) AS ing_ms,
          COALESCE(SUM(CASE WHEN meter_name NOT ILIKE '%retention%' AND meter_name NOT ILIKE '%retenção%' AND publisher_type = 'Marketplace' THEN cost_in_billing_currency ELSE 0 END), 0) AS ing_mp
        FROM azure_costs WHERE UPPER(resource_id) = UPPER($1) AND cost_date >= CURRENT_DATE - INTERVAL '30 days'`, [resourceId]),
      _getImpostoConfig(),
      pool.query(`SELECT tabela, consultas_30d, gb_escaneado_30d, ultima_consulta FROM log_analytics_consultas_tabela WHERE workspace_guid = $1`, [guid]),
    ]);

    const consultasPorTabela = {};
    for (const r of consultasR.rows) consultasPorTabela[r.tabela] = r;
    const gbPorTabela = {};
    for (const r of gbR.rows) gbPorTabela[r.tabela] = Number(r.gb) || 0;
    const custoIngestaoTotal = _comImpostoSplit(custoR.rows[0]?.ing_ms, custoR.rows[0]?.ing_mp, impostoCfg);
    const custoRetencaoTotal = _comImpostoSplit(custoR.rows[0]?.ret_ms, custoR.rows[0]?.ret_mp, impostoCfg);

    const nomesTabelas = new Set([...Object.keys(gbPorTabela), ...tabelasR.rows.map(t => t.tabela)]);
    const linhas = Array.from(nomesTabelas).map((nome) => {
      const cfg = tabelasR.rows.find(t => t.tabela === nome) || {};
      const gb = gbPorTabela[nome] || 0;
      const diasExtra = Math.max(0, (cfg.retencao_total_dias ?? 31) - 31);
      return { tabela: nome, gb, pesoRetencao: gb * diasExtra, ...cfg };
    });
    const gbTotal = linhas.reduce((a, l) => a + l.gb, 0);
    const pesoRetencaoTotal = linhas.reduce((a, l) => a + l.pesoRetencao, 0);

    const resultado = linhas.map((l) => {
      const consulta = consultasPorTabela[l.tabela];
      return {
        tabela: l.tabela,
        plano: l.plano ?? null,
        retencao_dias: l.retencao_dias ?? null,
        retencao_total_dias: l.retencao_total_dias ?? null,
        retencao_arquivo_dias: l.retencao_arquivo_dias ?? null,
        retencao_e_padrao: l.retencao_e_padrao ?? null,
        gb_mes: l.gb,
        custo_ingestao_estimado: gbTotal > 0 ? (custoIngestaoTotal * l.gb / gbTotal) : 0,
        custo_retencao_estimado: pesoRetencaoTotal > 0 ? (custoRetencaoTotal * l.pesoRetencao / pesoRetencaoTotal) : 0,
        consultas_30d: consulta ? consulta.consultas_30d : null,
        gb_escaneado_30d: consulta ? Number(consulta.gb_escaneado_30d) : null,
        ultima_consulta: consulta ? consulta.ultima_consulta : null,
      };
    }).sort((a, b) => (b.custo_ingestao_estimado + b.custo_retencao_estimado) - (a.custo_ingestao_estimado + a.custo_retencao_estimado));

    res.json({ auditoria_consultas_habilitada: auditoriaHabilitada, tabelas: resultado });
  } catch (e) { _dbErr(res, e); }
});

// Liga a auditoria de consultas (LAQueryLogs) — ver comentário de _habilitarAuditoriaConsultas.
// Ação de ESCRITA na Azure, por isso é um POST explícito (não acontece em nenhuma coleta
// automática) e devolve o erro de permissão de forma clara em vez de genérica.
app.post('/api/log-analytics/workspaces/:guid/auditoria-consultas/habilitar', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { guid } = req.params;
    const wsR = await pool.query(`SELECT resource_id, workspace_guid, nome FROM log_analytics_workspaces WHERE workspace_guid = $1`, [guid]);
    if (!wsR.rows.length) return res.status(404).json({ error: 'Workspace não encontrado' });
    const { getToken } = await _getInventarioSpConfig();
    await _habilitarAuditoriaConsultas(wsR.rows[0], getToken);
    res.json({ ok: true, message: 'Auditoria de consultas habilitada — dados começam a aparecer a partir da próxima coleta diária (só contam consultas feitas DAQUI pra frente).' });
  } catch (e) {
    res.status(e.message?.includes('403') ? 403 : 502).json({ error: e.message });
  }
});

// "Fontes de Log" consolidado — de onde vêm os dados de um workspace: Diagnostic Settings
// (recursos ARM enviando log/métrica diretamente) + Data Collection Rules (pipelines de
// Custom Logs/Azure Monitor Agent). Mesmo formato de WorkspaceLogSources.csv do framework de
// assessment de referência.
app.get('/api/log-analytics/workspaces/:guid/fontes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { guid } = req.params;
    const [diagR, dcrR] = await Promise.all([
      pool.query(`SELECT recurso_tipo, recurso_id, categorias_habilitadas FROM log_analytics_diagnostic_settings WHERE workspace_guid = $1`, [guid]),
      pool.query(`SELECT nome, streams, tipos_fonte, detalhe_fontes FROM log_analytics_dcrs WHERE workspace_guid_destino = $1 ORDER BY nome`, [guid]),
    ]);

    const porTipo = new Map();
    for (const r of diagR.rows) {
      const grupo = porTipo.get(r.recurso_tipo) || { recursos: new Set(), categorias: new Set() };
      grupo.recursos.add(r.recurso_id);
      for (const cat of String(r.categorias_habilitadas || '').split(';')) {
        const c = cat.trim();
        if (c) grupo.categorias.add(c);
      }
      porTipo.set(r.recurso_tipo, grupo);
    }

    const fontes = [];
    for (const [tipo, grupo] of porTipo.entries()) {
      fontes.push({
        mecanismo: 'Diagnostic Setting',
        tipo,
        contagem: grupo.recursos.size,
        detalhe: Array.from(grupo.categorias).sort().slice(0, 15).join('; ') || null,
      });
    }
    for (const r of dcrR.rows) {
      const streamCount = r.streams ? String(r.streams).split(';').filter(s => s.trim()).length : 0;
      fontes.push({
        mecanismo: 'Data Collection Rule',
        tipo: r.nome,
        contagem: streamCount,
        detalhe: r.streams || r.detalhe_fontes || null,
      });
    }
    fontes.sort((a, b) => b.contagem - a.contagem);

    const diagAtualizadoEm = (await pool.query(`SELECT MAX(atualizado_em) AS m FROM log_analytics_diagnostic_settings WHERE workspace_guid = $1`, [guid])).rows[0]?.m || null;
    res.json({ fontes, diagnostic_settings_atualizado_em: diagAtualizadoEm });
  } catch (e) { _dbErr(res, e); }
});

// Detalhe por RECURSO (não agregado como /fontes) — quais categorias de log estão
// habilitadas/desabilitadas em cada Diagnostic Setting configurado apontando pra este
// workspace. Vem direto de log_analytics_diagnostic_settings, já coletado via API oficial
// (ver _coletarDiagnosticSettingsTudo) — sem chamada nova à Azure.
app.get('/api/log-analytics/workspaces/:guid/diagnostic-settings', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { guid } = req.params;
    const r = await pool.query(
      // outros_workspaces: fan-out — mesmo recurso também apontando pra outro(s) workspace(s)
      // diferente deste (ver _avaliarFanoutDiagnosticSettings, que já gera a recomendação
      // correspondente) — aqui é só pra badge inline, não repete a lógica, só confere.
      `SELECT d.nome_config, d.recurso_id, d.recurso_tipo, d.categorias_habilitadas, d.categorias_desabilitadas,
              d.grupos_categoria, d.metricas_habilitadas, d.metricas_desabilitadas, d.envia_storage, d.envia_eventhub, d.atualizado_em,
              (SELECT array_agg(DISTINCT w2.nome ORDER BY w2.nome) FROM log_analytics_diagnostic_settings d2
                 JOIN log_analytics_workspaces w2 ON w2.workspace_guid = d2.workspace_guid
                 WHERE d2.recurso_id = d.recurso_id AND d2.workspace_guid <> d.workspace_guid) AS outros_workspaces
       FROM log_analytics_diagnostic_settings d
       WHERE d.workspace_guid = $1
       ORDER BY d.recurso_tipo, d.recurso_id`,
      [guid],
    );
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

// Detalhamento por RECURSO de uma tabela específica — a API de consumo do Log Analytics
// (tabela Usage, que já usamos pra GB por tabela) não expõe o recurso de origem, só o
// DataType. Pra saber qual recurso exato gerou o volume é preciso consultar a tabela de log
// real (custo de scan de verdade, ao contrário do resto da tela que só lê dados já
// coletados) — por isso é sob demanda (POST, não faz parte de nenhuma coleta automática) e
// com janela curta (3 dias, não 30) pra limitar o custo dessa query pontual.
app.post('/api/log-analytics/workspaces/:guid/tabelas/:tabela/detalhar-recurso', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { guid, tabela } = req.params;
    if (!/^[A-Za-z0-9_]+$/.test(tabela)) return res.status(400).json({ error: 'Nome de tabela inválido' });
    const { getLogAnalyticsToken } = await _getInventarioSpConfig();
    const token = await getLogAnalyticsToken();
    const kql = `${tabela} | where TimeGenerated > ago(3d) | summarize GB = sum(_BilledSize)/1024.0/1024/1024 by _ResourceId | top 20 by GB desc`;
    const url = `https://api.loganalytics.io/v1/workspaces/${guid}/query`;
    // 45s, não 30s: é uma query de verdade contra a tabela de log (não a Usage, leve) — uma
    // tabela grande/verbosa pode legitimamente demorar. O timeout do apiFetch no frontend pra
    // essa chamada precisa ficar ACIMA deste valor (ver detalharRecursoTabela em
    // logAnalytics.ts), senão o front aborta antes do backend terminar e some o motivo real.
    let resp;
    try {
      resp = await _cbFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: kql }),
      }, { timeoutMs: 45_000 });
    } catch (fetchErr) {
      console.error('[LogAnalytics] detalhar-recurso falhou:', fetchErr.message);
      return res.status(504).json({ error: `Consulta demorou demais ou falhou de rede contra o workspace (tabela "${tabela}"): ${fetchErr.message}` });
    }
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      console.error(`[LogAnalytics] detalhar-recurso (${tabela}) retornou ${resp.status}:`, errTxt.slice(0, 500));
      return res.status(resp.status === 403 ? 403 : 502).json({ error: `Consulta falhou (${resp.status}) na tabela "${tabela}": ${errTxt.slice(0, 300) || 'sem detalhe retornado pela Azure'}` });
    }
    const data = await _safeRespJson(resp);
    const table = data.tables?.[0];
    if (!table || !table.rows?.length) return res.json({ recursos: [], janela_dias: 3 });
    const cols = table.columns.map(c => c.name);
    const iGB = cols.indexOf('GB'), iRes = cols.indexOf('_ResourceId');
    const recursos = table.rows.map(r => ({ resource_id: r[iRes], gb: Number(r[iGB]) || 0 }));
    res.json({ recursos, janela_dias: 3 });
  } catch (e) {
    console.error('[LogAnalytics] detalhar-recurso erro inesperado:', e.message);
    res.status(500).json({ error: `Erro inesperado ao detalhar por recurso: ${e.message}` });
  }
});

app.get('/api/log-analytics/recomendacoes', authMiddleware, dbMiddleware, async (req, res) => {
  try {
    const { severidade } = req.query;
    const params = []; let where = '1=1';
    if (severidade) { params.push(severidade); where += ` AND rec.severidade = $${params.length}`; }
    const r = await pool.query(
      `SELECT rec.*, w.nome AS workspace_nome, w.subscription_id
       FROM log_analytics_recomendacoes rec
       JOIN log_analytics_workspaces w ON w.workspace_guid = rec.workspace_guid
       WHERE ${where} ORDER BY rec.severidade DESC, rec.criado_em DESC`,
      params
    );
    res.json(r.rows);
  } catch (e) { _dbErr(res, e); }
});

app.post('/api/log-analytics/coleta/forcar', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_logAnalyticsColetaEmExecucao) return res.status(409).json({ error: 'Coleta de Log Analytics já em execução' });
  res.status(202).json({ ok: true, message: 'Coleta de Log Analytics iniciada — pode levar alguns minutos' });
  _coletarLogAnalyticsTudo('manual').catch(e => console.error('[LogAnalytics] Erro na coleta manual:', e.message));
});

// Separado da coleta principal de propósito — é uma chamada de API por recurso monitorável do
// tenant inteiro (ver comentário de _coletarDiagnosticSettingsTudo), pode levar minutos.
app.post('/api/log-analytics/diagnostic-settings/forcar', authMiddleware, dbMiddleware, async (_req, res) => {
  if (_logAnalyticsDiagEmExecucao) return res.status(409).json({ error: 'Coleta de Diagnostic Settings já em execução' });
  res.status(202).json({ ok: true, message: 'Coleta de Diagnostic Settings iniciada — em tenants grandes pode levar vários minutos' });
  _coletarDiagnosticSettingsTudo().catch(e => console.error('[LogAnalytics] Erro na coleta de Diagnostic Settings:', e.message));
});

app.get('/api/log-analytics/export/excel', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const impostoCfgExcel = await _getImpostoConfig();
    const [wsRows, recRows, tabRows, diagRows, dcrRows] = await Promise.all([
      pool.query(`SELECT w.*, ${_LOG_ANALYTICS_CUSTO_SQL} FROM log_analytics_workspaces w`),
      pool.query(`SELECT rec.*, w.nome AS workspace_nome FROM log_analytics_recomendacoes rec
                  JOIN log_analytics_workspaces w ON w.workspace_guid = rec.workspace_guid
                  ORDER BY rec.severidade DESC, rec.criado_em DESC`),
      // JOIN pré-agregado, NÃO sub-select correlacionado por linha (log_analytics_tabelas tem
      // ~74 mil linhas num tenant real — um SELECT escalar por linha contra
      // log_analytics_ingestao_diaria media SEGUNDOS a mais nessa tela, era o maior gargalo).
      pool.query(`SELECT w.nome AS workspace_nome, t.tabela, t.plano, t.retencao_dias, t.retencao_total_dias, t.retencao_e_padrao,
                    COALESCE(g.gb_mes, 0) AS gb_mes
                  FROM log_analytics_tabelas t
                  JOIN log_analytics_workspaces w ON w.workspace_guid = t.workspace_guid
                  LEFT JOIN (
                    SELECT workspace_guid, tabela, SUM(gb) AS gb_mes
                    FROM log_analytics_ingestao_diaria
                    WHERE dia >= date_trunc('month', CURRENT_DATE)
                    GROUP BY workspace_guid, tabela
                  ) g ON g.workspace_guid = t.workspace_guid AND g.tabela = t.tabela
                  ORDER BY w.nome, gb_mes DESC`),
      pool.query(`SELECT w.nome AS workspace_nome, d.recurso_tipo, d.recurso_id, d.nome_config,
                    d.categorias_habilitadas, d.categorias_desabilitadas, d.envia_storage, d.envia_eventhub
                  FROM log_analytics_diagnostic_settings d
                  JOIN log_analytics_workspaces w ON w.workspace_guid = d.workspace_guid
                  ORDER BY w.nome, d.recurso_tipo`),
      pool.query(`SELECT w.nome AS workspace_nome, c.nome AS dcr_nome, c.streams, c.tipos_fonte, c.resource_group, c.subscription_id
                  FROM log_analytics_dcrs c
                  JOIN log_analytics_workspaces w ON w.workspace_guid = c.workspace_guid_destino
                  ORDER BY w.nome, c.nome`),
    ]);
    wsRows.rows = wsRows.rows.map(w => _aplicarImpostoLogAnalytics(w, impostoCfgExcel))
      .sort((a, b) => (b.custo_mes_total || 0) - (a.custo_mes_total || 0));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FinOps Manager'; wb.created = new Date();
    const PURPLE = '7B2FBE';
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + PURPLE } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Aba "Sumário Executivo" — primeira aba do workbook, igual ao AssessmentSummary.xlsx do
    // framework de referência (reporting.py::_build_executive_summary_sheet), com cartões de
    // KPI antes das abas de dado bruto. Diferença: nosso custo é REAL (JOIN com azure_costs),
    // não uma estimativa de preço manual por GB.
    const subsNoEscopo = new Set(wsRows.rows.map(w => w.subscription_id).filter(Boolean)).size;
    const gbIngeridoMes = wsRows.rows.reduce((a, w) => a + (Number(w.ingestao_mes_gb) || 0), 0);
    const custoRealMes = wsRows.rows.reduce((a, w) => a + (Number(w.custo_mes_total) || 0), 0);
    const tabelasRetencaoAlta = tabRows.rows.filter(t => Number(t.retencao_total_dias) > 90).length;
    const tabelasRetencaoCustom = tabRows.rows.filter(t => t.retencao_e_padrao === false).length;
    const recursosComDiagSetting = new Set(diagRows.rows.map(d => d.recurso_id)).size;
    const dcrsMapeadas = new Set(dcrRows.rows.map(d => d.dcr_nome)).size;

    const wsSumario = wb.addWorksheet('Sumário Executivo');
    wsSumario.views = [{ showGridLines: false }];
    wsSumario.mergeCells('B2:H2');
    wsSumario.getCell('B2').value = 'Log Analytics — FinOps Assessment';
    wsSumario.getCell('B2').font = { bold: true, size: 16, color: { argb: 'FF' + PURPLE } };
    wsSumario.mergeCells('B3:H3');
    wsSumario.getCell('B3').value = `Gerado em ${new Date().toLocaleString('pt-BR')} · Janela de ingestão: mês corrente`;
    wsSumario.getCell('B3').font = { italic: true, size: 10, color: { argb: 'FF595959' } };

    const kpis = [
      ['Subscriptions no escopo', String(subsNoEscopo)],
      ['Workspaces inventariados', String(wsRows.rows.length)],
      ['GB ingeridos (mês corrente)', gbIngeridoMes.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB'],
      ['Custo real (últimos 30 dias, R$)', custoRealMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
      ['Tabelas com retenção > 90 dias', String(tabelasRetencaoAlta)],
      ['Tabelas com retenção customizada', String(tabelasRetencaoCustom)],
      ['Recursos com Diagnostic Setting', String(recursosComDiagSetting)],
      ['Data Collection Rules mapeadas', String(dcrsMapeadas)],
    ];
    let kpiRow = 5, kpiCol = 2;
    for (const [label, value] of kpis) {
      wsSumario.mergeCells(kpiRow, kpiCol, kpiRow, kpiCol + 1);
      wsSumario.getCell(kpiRow, kpiCol).value = label;
      wsSumario.getCell(kpiRow, kpiCol).font = { bold: true, size: 11 };
      wsSumario.getCell(kpiRow, kpiCol).alignment = { wrapText: true, vertical: 'top' };
      wsSumario.mergeCells(kpiRow + 1, kpiCol, kpiRow + 1, kpiCol + 1);
      wsSumario.getCell(kpiRow + 1, kpiCol).value = value;
      wsSumario.getCell(kpiRow + 1, kpiCol).font = { bold: true, size: 18, color: { argb: 'FF' + PURPLE } };
      kpiCol += 2;
      if (kpiCol > 8) { kpiCol = 2; kpiRow += 4; }
    }

    const conteudoRow = kpiRow + 5;
    wsSumario.mergeCells(conteudoRow, 2, conteudoRow, 8);
    wsSumario.getCell(conteudoRow, 2).value = 'Conteúdo do workbook';
    wsSumario.getCell(conteudoRow, 2).font = { bold: true, size: 11 };
    const abas = ['Workspaces', 'Recomendações', 'Tabelas', 'Diagnostic Settings', 'Fontes de Log (DCR)'];
    abas.forEach((nome, i) => { wsSumario.getCell(conteudoRow + 1 + i, 2).value = '• ' + nome; });
    for (let c = 2; c <= 8; c++) wsSumario.getColumn(c).width = 18;

    const ws1 = wb.addWorksheet('Workspaces');
    ws1.columns = [
      { header: 'Nome', key: 'nome', width: 30 }, { header: 'Assinatura', key: 'subscription_id', width: 38 },
      { header: 'Resource Group', key: 'resource_group', width: 28 }, { header: 'Retenção (dias)', key: 'retencao_dias', width: 16 },
      { header: 'SKU', key: 'sku', width: 16 }, { header: 'Daily Cap (GB/dia)', key: 'daily_cap_gb', width: 18 },
      { header: 'Ingestão do mês (GB)', key: 'ingestao_mes_gb', width: 20 },
      { header: 'Custo 30d (R$)', key: 'custo_mes_total', width: 18 }, { header: 'Custo ingestão 30d (R$)', key: 'custo_mes_ingestao', width: 18 },
      { header: 'Custo retenção 30d (R$)', key: 'custo_mes_retencao', width: 18 },
    ];
    ws1.getRow(1).font = headerFont; ws1.getRow(1).fill = headerFill;
    ws1.addRows(wsRows.rows);

    const ws2 = wb.addWorksheet('Recomendações');
    ws2.columns = [
      { header: 'Workspace', key: 'workspace_nome', width: 30 }, { header: 'Regra', key: 'regra', width: 22 },
      { header: 'Severidade', key: 'severidade', width: 14 }, { header: 'Detalhe', key: 'detalhe', width: 70 },
    ];
    ws2.getRow(1).font = headerFont; ws2.getRow(1).fill = headerFill;
    ws2.addRows(recRows.rows);

    const ws3 = wb.addWorksheet('Tabelas');
    ws3.columns = [
      { header: 'Workspace', key: 'workspace_nome', width: 30 }, { header: 'Tabela', key: 'tabela', width: 30 },
      { header: 'Plano', key: 'plano', width: 12 }, { header: 'Retenção interativa (dias)', key: 'retencao_dias', width: 22 },
      { header: 'Retenção total (dias)', key: 'retencao_total_dias', width: 20 }, { header: 'Retenção customizada?', key: 'retencao_e_padrao', width: 20 },
      { header: 'Ingestão do mês (GB)', key: 'gb_mes', width: 20 },
    ];
    ws3.getRow(1).font = headerFont; ws3.getRow(1).fill = headerFill;
    ws3.addRows(tabRows.rows.map(r => ({ ...r, retencao_e_padrao: r.retencao_e_padrao === false ? 'Sim' : 'Não' })));

    const ws4 = wb.addWorksheet('Diagnostic Settings');
    ws4.columns = [
      { header: 'Workspace', key: 'workspace_nome', width: 30 }, { header: 'Tipo de recurso', key: 'recurso_tipo', width: 30 },
      { header: 'Recurso', key: 'recurso_id', width: 60 }, { header: 'Nome da config.', key: 'nome_config', width: 24 },
      { header: 'Categorias habilitadas', key: 'categorias_habilitadas', width: 50 }, { header: 'Categorias desabilitadas', key: 'categorias_desabilitadas', width: 50 },
      { header: 'Também envia p/ Storage', key: 'envia_storage', width: 20 }, { header: 'Também envia p/ Event Hub', key: 'envia_eventhub', width: 22 },
    ];
    ws4.getRow(1).font = headerFont; ws4.getRow(1).fill = headerFill;
    ws4.addRows(diagRows.rows.map(r => ({ ...r, envia_storage: r.envia_storage ? 'Sim' : 'Não', envia_eventhub: r.envia_eventhub ? 'Sim' : 'Não' })));

    const ws5 = wb.addWorksheet('Fontes de Log (DCR)');
    ws5.columns = [
      { header: 'Workspace', key: 'workspace_nome', width: 30 }, { header: 'DCR', key: 'dcr_nome', width: 30 },
      { header: 'Streams', key: 'streams', width: 40 }, { header: 'Tipos de fonte', key: 'tipos_fonte', width: 30 },
      { header: 'Resource Group', key: 'resource_group', width: 28 }, { header: 'Assinatura', key: 'subscription_id', width: 38 },
    ];
    ws5.getRow(1).font = headerFont; ws5.getRow(1).fill = headerFill;
    ws5.addRows(dcrRows.rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="log-analytics-finops.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { _dbErr(res, e); }
});

// Chart.js vendorizado localmente (vendor/chart.umd.min.js, MIT) — embutido INLINE no HTML do
// dashboard, igual à técnica do framework de referência: um <script src="cdn...."> quebraria o
// requisito de "abre sem internet/servidor" (rede corporativa bloqueando CDN, ou o arquivo
// sendo aberto direto do disco depois de baixado). Lido uma vez, cacheado em memória.
let _logAnalyticsChartJsCache = null;
function _getLogAnalyticsChartJs() {
  if (_logAnalyticsChartJsCache === null) {
    try {
      _logAnalyticsChartJsCache = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.min.js'), 'utf8');
    } catch (e) {
      console.warn('[LogAnalytics] vendor/chart.umd.min.js não encontrado — dashboard sairá sem gráficos:', e.message);
      _logAnalyticsChartJsCache = '';
    }
  }
  return _logAnalyticsChartJsCache;
}

// Dashboard HTML autocontido (réplica do AssessmentDashboard.html do framework de referência,
// modules/htmlreport.py) — cartões de KPI, 4 gráficos (Chart.js embutido) e tabelas com
// busca/ordenação em JS puro, sem depender do resto do app (pode ser aberto offline, enviado
// por e-mail, publicado em storage estático). Paleta roxa (#7B2FBE) — a mesma dos outros
// exports do FinOps Manager, não o azul do modelo original.
// Dados puros (sem HTML) por trás do Dashboard — reaproveitados pelo endpoint JSON
// `/resumo` (painel nativo na tela) E pelo gerador de HTML (`_gerarLogAnalyticsDashboardHtml`),
// pra não duplicar as 5 queries nem o cálculo de KPIs/rankings nos dois lugares.
async function _coletarResumoLogAnalytics() {
  const impostoCfgResumo = await _getImpostoConfig();
  const [wsRows, recRows, tabRows, diagRows, dcrRows] = await Promise.all([
    pool.query(`SELECT w.*,
                  COALESCE(ing.gb_mes, 0) AS ingestao_mes_gb,
                  ${_LOG_ANALYTICS_CUSTO_SQL}
                FROM log_analytics_workspaces w
                LEFT JOIN (
                  SELECT workspace_guid, SUM(gb) AS gb_mes FROM log_analytics_ingestao_diaria
                  WHERE dia >= date_trunc('month', CURRENT_DATE) GROUP BY workspace_guid
                ) ing ON ing.workspace_guid = w.workspace_guid`),
    pool.query(`SELECT rec.*, w.nome AS workspace_nome FROM log_analytics_recomendacoes rec
                JOIN log_analytics_workspaces w ON w.workspace_guid = rec.workspace_guid
                ORDER BY rec.severidade DESC, rec.criado_em DESC`),
    // JOIN pré-agregado, não sub-select por linha — mesmo motivo do export Excel (74 mil linhas
    // em log_analytics_tabelas; essa query roda a cada abertura da tela via /resumo).
    pool.query(`SELECT w.nome AS workspace_nome, t.tabela, t.plano, t.retencao_dias, t.retencao_total_dias, t.retencao_e_padrao,
                  COALESCE(g.gb_mes, 0) AS gb_mes
                FROM log_analytics_tabelas t
                JOIN log_analytics_workspaces w ON w.workspace_guid = t.workspace_guid
                LEFT JOIN (
                  SELECT workspace_guid, tabela, SUM(gb) AS gb_mes
                  FROM log_analytics_ingestao_diaria
                  WHERE dia >= date_trunc('month', CURRENT_DATE)
                  GROUP BY workspace_guid, tabela
                ) g ON g.workspace_guid = t.workspace_guid AND g.tabela = t.tabela
                ORDER BY w.nome, gb_mes DESC`),
    pool.query(`SELECT w.nome AS workspace_nome, d.recurso_tipo, d.recurso_id, d.nome_config,
                  d.categorias_habilitadas, d.categorias_desabilitadas, d.envia_storage, d.envia_eventhub
                FROM log_analytics_diagnostic_settings d
                JOIN log_analytics_workspaces w ON w.workspace_guid = d.workspace_guid
                ORDER BY w.nome, d.recurso_tipo`),
    pool.query(`SELECT w.nome AS workspace_nome, c.nome AS dcr_nome, c.streams, c.tipos_fonte, c.resource_group, c.subscription_id
                FROM log_analytics_dcrs c
                JOIN log_analytics_workspaces w ON w.workspace_guid = c.workspace_guid_destino
                ORDER BY w.nome, c.nome`),
  ]);
  wsRows.rows = wsRows.rows.map(w => _aplicarImpostoLogAnalytics(w, impostoCfgResumo))
    .sort((a, b) => (b.custo_mes_total || 0) - (a.custo_mes_total || 0));

  const subsNoEscopo = new Set(wsRows.rows.map(w => w.subscription_id).filter(Boolean)).size;
  const gbIngeridoMes = wsRows.rows.reduce((a, w) => a + (Number(w.ingestao_mes_gb) || 0), 0);
  const custoRealMes = wsRows.rows.reduce((a, w) => a + (Number(w.custo_mes_total) || 0), 0);
  const tabelasRetencaoAlta = tabRows.rows.filter(t => Number(t.retencao_total_dias) > 90).length;
  const recursosComDiagSetting = new Set(diagRows.rows.map(d => d.recurso_id)).size;
  const dcrsMapeadas = new Set(dcrRows.rows.map(d => d.dcr_nome)).size;

  const custoPorWorkspace = wsRows.rows.slice(0, 10).map(w => ({
    label: w.nome || w.workspace_guid, valor: Number(Number(w.custo_mes_total || 0).toFixed(2)),
  }));

  const topTabelas = tabRows.rows.slice().sort((a, b) => Number(b.gb_mes) - Number(a.gb_mes)).slice(0, 10).map(t => ({
    label: `${t.tabela} (${t.workspace_nome})`, valor: Number(Number(t.gb_mes || 0).toFixed(2)),
  }));

  const fontes = [
    { label: 'Diagnostic Setting', valor: recursosComDiagSetting },
    { label: 'Data Collection Rule', valor: dcrsMapeadas },
  ];

  const faixas = [
    { label: '≤ 30 dias', min: -1, max: 30 },
    { label: '31–90 dias', min: 30, max: 90 },
    { label: '91–180 dias', min: 90, max: 180 },
    { label: '181–365 dias', min: 180, max: 365 },
    { label: '> 365 dias', min: 365, max: Infinity },
  ];
  const distribuicaoRetencao = faixas.map(f => ({
    label: f.label,
    valor: tabRows.rows.filter(t => {
      const d = Number(t.retencao_total_dias) || 0;
      return d > f.min && d <= f.max;
    }).length,
  }));

  return {
    kpis: {
      subsNoEscopo, workspaces: wsRows.rows.length, gbIngeridoMes, custoRealMes,
      tabelasRetencaoAlta, recursosComDiagSetting, dcrsMapeadas,
    },
    custoPorWorkspace, topTabelas, fontes, distribuicaoRetencao,
    wsRows: wsRows.rows, recRows: recRows.rows, tabRows: tabRows.rows, diagRows: diagRows.rows, dcrRows: dcrRows.rows,
  };
}

app.get('/api/log-analytics/resumo', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const resumo = await _coletarResumoLogAnalytics();
    const { wsRows, recRows, tabRows, diagRows, dcrRows, ...publico } = resumo; // linhas cruas só servem ao HTML/Excel
    res.json(publico);
  } catch (e) { _dbErr(res, e); }
});

async function _gerarLogAnalyticsDashboardHtml() {
  const resumo = await _coletarResumoLogAnalytics();
  const { kpis, custoPorWorkspace, topTabelas, fontes, distribuicaoRetencao, wsRows, recRows, tabRows, diagRows, dcrRows } = resumo;

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const fmtGB = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB';

  const kpiCards = [
    ['Subscriptions no escopo', String(kpis.subsNoEscopo)],
    ['Workspaces inventariados', String(kpis.workspaces)],
    ['GB ingeridos (mês corrente)', fmtGB(kpis.gbIngeridoMes)],
    ['Custo real (últimos 30 dias)', brl(kpis.custoRealMes)],
    ['Tabelas com retenção > 90 dias', String(kpis.tabelasRetencaoAlta)],
    ['Recursos com Diagnostic Setting', String(kpis.recursosComDiagSetting)],
    ['Data Collection Rules mapeadas', String(kpis.dcrsMapeadas)],
  ];

  const chartCustoWorkspace = { labels: custoPorWorkspace.map(x => x.label), values: custoPorWorkspace.map(x => x.valor) };
  const chartTopTabelas = { labels: topTabelas.map(x => x.label), values: topTabelas.map(x => x.valor) };
  const chartFontes = { labels: fontes.map(x => x.label), values: fontes.map(x => x.valor) };
  const chartRetencao = { labels: distribuicaoRetencao.map(x => x.label), values: distribuicaoRetencao.map(x => x.valor) };

  // --- tabelas navegáveis (mesmos 5 datasets do Excel) ---
  const datasets = [
    { label: 'Workspaces', cols: ['nome', 'subscription_id', 'resource_group', 'retencao_dias', 'sku', 'ingestao_mes_gb', 'custo_mes_total'], rows: wsRows },
    { label: 'Tabelas', cols: ['workspace_nome', 'tabela', 'plano', 'retencao_dias', 'retencao_total_dias', 'gb_mes'], rows: tabRows },
    { label: 'Diagnostic Settings', cols: ['workspace_nome', 'recurso_tipo', 'recurso_id', 'categorias_habilitadas'], rows: diagRows },
    { label: 'Fontes de Log (DCR)', cols: ['workspace_nome', 'dcr_nome', 'streams', 'tipos_fonte'], rows: dcrRows },
    { label: 'Recomendações', cols: ['workspace_nome', 'regra', 'severidade', 'detalhe'], rows: recRows },
  ];

  const kpiCardsHtml = kpiCards.map(([label, value]) =>
    `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${esc(value)}</span></div>`,
  ).join('');

  const tabsHtml = datasets.map((d, i) =>
    `<button id="btn-panel-${i}" class="tab-button${i === 0 ? ' active' : ''}" onclick="showTab('panel-${i}')">${esc(d.label)} <span class="tab-count">(${d.rows.length})</span></button>`,
  ).join('');

  const panelsHtml = datasets.map((d, i) => {
    const tableId = `table-panel-${i}`;
    if (!d.rows.length) {
      return `<div id="panel-${i}" class="tab-panel${i === 0 ? ' active' : ''}"><p class="empty-state">Nenhum dado coletado para "${esc(d.label)}".</p></div>`;
    }
    const headerCells = d.cols.map((c, ci) => `<th onclick="sortTable('${tableId}', ${ci})">${esc(c)}</th>`).join('');
    const bodyRows = d.rows.map((r) =>
      '<tr>' + d.cols.map(c => `<td>${esc(r[c])}</td>`).join('') + '</tr>',
    ).join('');
    return `<div id="panel-${i}" class="tab-panel${i === 0 ? ' active' : ''}">
      <input type="text" class="table-search" placeholder="Buscar em ${esc(d.label)}..." oninput="filterTable(this, '${tableId}')">
      <div class="table-scroll"><table id="${tableId}"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>
    </div>`;
  }).join('');

  const chartJsSource = _getLogAnalyticsChartJs();
  const geradoEm = new Date().toLocaleString('pt-BR');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log Analytics — FinOps Assessment</title>
<script>${chartJsSource}</script>
<style>
:root{--primary:#7B2FBE;--accent:#9d5fd6;--bg:#F4F1F9;--card-bg:#FFFFFF;--border:#E4DCF2;--text:#2B2F36;--muted:#6B7280}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Calibri,sans-serif;background:var(--bg);color:var(--text)}
.banner{background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;padding:28px 40px}
.banner h1{margin:0;font-size:24px}
.subtitle{margin:4px 0 0;opacity:.85;font-size:13px}
main{padding:24px 40px 60px;max-width:1400px;margin:0 auto}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
.kpi-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;gap:6px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.kpi-label{font-size:12.5px;color:var(--muted);font-weight:600}
.kpi-value{font-size:26px;font-weight:700;color:var(--primary)}
.charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px;margin-bottom:32px}
.chart-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:18px 20px 8px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.chart-card h2{font-size:14px;margin:0 0 12px}
.chart-card canvas{max-height:280px}
.empty-state{color:var(--muted);font-size:13px;font-style:italic}
.tables-section h2{font-size:16px;margin-bottom:12px}
.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:2px solid var(--border)}
.tab-button{background:none;border:none;padding:10px 16px;cursor:pointer;font-size:13px;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px;font-weight:600}
.tab-button:hover{color:var(--primary)}
.tab-button.active{color:var(--primary);border-bottom-color:var(--primary)}
.tab-count{color:var(--muted);font-weight:400}
.tab-panel{display:none;background:var(--card-bg);border:1px solid var(--border);border-top:none;padding:16px;border-radius:0 0 10px 10px}
.tab-panel.active{display:block}
.table-search{width:100%;max-width:320px;padding:8px 12px;margin-bottom:12px;border:1px solid var(--border);border-radius:6px;font-size:13px}
.table-scroll{overflow-x:auto;max-height:480px;overflow-y:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{position:sticky;top:0;background:var(--primary);color:#fff;padding:8px 10px;text-align:left;cursor:pointer;white-space:nowrap}
thead th:hover{background:var(--accent)}
tbody td{padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
tbody tr:nth-child(even){background:#FAF8FC}
footer{margin-top:40px;text-align:center;color:var(--muted);font-size:11.5px}
</style></head><body>
<header class="banner">
  <div><h1>Log Analytics — FinOps Assessment</h1>
  <p class="subtitle">Gerado em ${esc(geradoEm)} · Ingestão do mês corrente · Custo real (últimos 30 dias, Cost Management)</p></div>
</header>
<main>
  <section class="kpi-grid">${kpiCardsHtml}</section>
  <section class="charts-grid">
    <div class="chart-card"><h2>Custo por Workspace (Top 10, R$)</h2><canvas id="chartCusto"></canvas></div>
    <div class="chart-card"><h2>Fontes de Log (Diagnostic Setting × DCR)</h2><canvas id="chartFontes"></canvas></div>
    <div class="chart-card"><h2>Top Tabelas por Volume (Top 10, GB)</h2><canvas id="chartTabelas"></canvas></div>
    <div class="chart-card"><h2>Distribuição de Retenção por Tabela</h2><canvas id="chartRetencao"></canvas></div>
  </section>
  <section class="tables-section">
    <h2>Dados Detalhados</h2>
    <div class="tabs">${tabsHtml}</div>
    ${panelsHtml}
  </section>
  <footer><p>FinOps Manager · Log Analytics · Gerado automaticamente — custo por tabela é estimativa por rateio, custo por workspace é real.</p></footer>
</main>
<script>
const chartData = ${JSON.stringify({ custo: chartCustoWorkspace, tabelas: chartTopTabelas, fontes: chartFontes, retencao: chartRetencao })};
const palette = ['#7B2FBE','#9d5fd6','#b98be0','#d4b8ec','#4a0080','#ff8c42','#ff4d6a','#2f9bbe','#70AD47','#A9D18E'];
function makeBarChart(id, ds, horizontal) {
  const ctx = document.getElementById(id);
  if (!ctx || !ds.labels.length) { if (ctx) ctx.parentElement.innerHTML += '<p class="empty-state">Sem dados coletados.</p>'; return; }
  try {
    new Chart(ctx, { type: 'bar', data: { labels: ds.labels, datasets: [{ data: ds.values, backgroundColor: palette[0], borderRadius: 4 }] },
      options: { indexAxis: horizontal ? 'y' : 'x', responsive: true, plugins: { legend: { display: false } } } });
  } catch (err) { console.error('Falha ao renderizar ' + id, err); ctx.parentElement.innerHTML += '<p class="empty-state">Não foi possível renderizar.</p>'; }
}
function makeDonutChart(id, ds) {
  const ctx = document.getElementById(id);
  if (!ctx || !ds.labels.length) { if (ctx) ctx.parentElement.innerHTML += '<p class="empty-state">Sem dados coletados.</p>'; return; }
  try {
    new Chart(ctx, { type: 'doughnut', data: { labels: ds.labels, datasets: [{ data: ds.values, backgroundColor: palette }] },
      options: { responsive: true, plugins: { legend: { position: 'right' } } } });
  } catch (err) { console.error('Falha ao renderizar ' + id, err); ctx.parentElement.innerHTML += '<p class="empty-state">Não foi possível renderizar.</p>'; }
}
if (typeof Chart === 'undefined') {
  document.querySelectorAll('.chart-card canvas').forEach(c => { c.parentElement.innerHTML += '<p class="empty-state">Biblioteca de gráficos não carregou.</p>'; });
} else {
  makeBarChart('chartCusto', chartData.custo, false);
  makeDonutChart('chartFontes', chartData.fontes);
  makeBarChart('chartTabelas', chartData.tabelas, true);
  makeBarChart('chartRetencao', chartData.retencao, false);
}
function showTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('btn-' + id).classList.add('active');
}
function filterTable(inputEl, tableId) {
  const q = inputEl.value.toLowerCase();
  document.querySelectorAll('#' + tableId + ' tbody tr').forEach(row => { row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none'; });
}
function sortTable(tableId, colIndex) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const asc = table.dataset.sortCol == colIndex ? table.dataset.sortDir !== 'asc' : true;
  rows.sort((a, b) => {
    const av = a.children[colIndex].textContent.trim(), bv = b.children[colIndex].textContent.trim();
    const an = parseFloat(av.replace(/[.,]/g, m => m === ',' ? '.' : '')), bn = parseFloat(bv.replace(/[.,]/g, m => m === ',' ? '.' : ''));
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv, 'pt-BR');
    return asc ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
  table.dataset.sortCol = colIndex; table.dataset.sortDir = asc ? 'asc' : 'desc';
}
</script>
</body></html>`;
}

app.get('/api/log-analytics/export/dashboard', authMiddleware, dbMiddleware, async (_req, res) => {
  try {
    const html = await _gerarLogAnalyticsDashboardHtml();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="log-analytics-dashboard.html"');
    res.send(html);
  } catch (e) { _dbErr(res, e); }
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
  // Limpar uploads_tmp ao iniciar — arquivos temporários deixados por crash ou restart
  try {
    const tmpDir = path.join(__dirname, 'uploads_tmp');
    if (fs.existsSync(tmpDir)) {
      const tmpFiles = fs.readdirSync(tmpDir);
      let freed = 0;
      for (const f of tmpFiles) {
        try {
          const fp = path.join(tmpDir, f);
          const stat = fs.statSync(fp);
          freed += stat.size;
          fs.unlinkSync(fp);
        } catch {}
      }
      if (tmpFiles.length > 0) console.log(`  [Startup] Limpeza uploads_tmp: ${tmpFiles.length} arquivo(s) removido(s) (${(freed/1024/1024).toFixed(0)} MB)`);
    }
  } catch {}

  // Start HTTP server first — wizard needs it before DB is ready
  app.listen(PORT, () => {
    console.log('');
    console.log('  FinOps Manager rodando em http://localhost:' + PORT);
    console.log('');
  });

  // Try to connect with existing config
  const cfg = getDbConfig();
  if (cfg) {
    console.log(`  Conectando ao banco: ${cfg.host || cfg.connectionString?.split('@')[1]?.split('/')[0] || 'localhost'}:${cfg.port || 5432}/${cfg.database || cfg.connectionString?.split('/').pop() || '?'}`);
    try {
      createPool(cfg);
      // Teste rápido de conectividade antes do initDB completo
      try {
        await pool.query('SELECT 1');
        console.log('  Conexao com banco OK.');
      } catch (connErr) {
        throw new Error('Nao foi possivel conectar ao PostgreSQL: ' + connErr.message);
      }
      await initDB();
      // Inicializar tabelas na startup — uma vez só, não em cada request
      try { await ensureAzureCostsTable(); } catch (e) { console.warn('[Azure] Tabela será criada na primeira importação:', e.message); }
      try { await ensureAzureColetaTable(); } catch (e) { console.warn('[Coleta] Tabela de histórico não iniciada:', e.message); }
      // Price List: cria azure_price_list_meta (necessária para o agendador) antes de iniciar o timer.
      // MVs podem demorar com dados; executar antes do agendador garante que a tabela exista no primeiro tick.
      try { await ensurePriceListTable(); } catch (e) { console.warn('[PriceList] Tabela será criada no primeiro sync:', e.message); }
      _iniciarAgendador();
      _iniciarAlertasEmail();
      _iniciarInventarioAgendador();
      _iniciarReconciliacaoAgendador();
      _iniciarRecursoTagsCache();
      _iniciarLogAnalyticsAgendador();
      _iniciarLogAnalyticsDiagAgendador();
      // Carrega caches persistentes imediatamente do banco (sem query pesada)
      pool.query(`SELECT ws_name, parent_rg FROM azure_ws_cache`).then(r => {
        if (r.rows.length) {
          _dbWsCache = new Map(r.rows.map(x => [x.ws_name, x.parent_rg]));
          _dbWsCacheTs = Date.now();
          console.log(`  [WsCache] ${r.rows.length} workspaces Databricks carregados`);
        } else {
          // Cache vazio — warmup rápido via consumed_service (usa índice, sem ILIKE)
          pool.query(`
            SELECT UPPER(resource_group_name) AS rg_upper,
                   SPLIT_PART(SPLIT_PART(resource_id, '/workspaces/', 2), '/', 1) AS ws
            FROM azure_costs
            WHERE consumed_service IN ('Microsoft.Databricks','microsoft.databricks')
            GROUP BY 1, 2
            HAVING SPLIT_PART(SPLIT_PART(resource_id, '/workspaces/', 2), '/', 1) <> ''
          `).then(wk => {
            if (wk.rows.length) {
              _dbWsCache = new Map(wk.rows.map(r => [r.ws, r.rg_upper]));
              _dbWsCacheTs = Date.now();
              console.log(`  [WsCache] ${wk.rows.length} workspaces Databricks (warmup direto)`);
            }
          }).catch(() => {});
        }
      }).catch(() => {});
      // Cache é pesado — escalonado para não saturar o pool no startup.
      setTimeout(() => {
        _refreshAzureCache().catch(e => console.warn('[Azure] Cache de dropdowns não pôde ser construído:', e.message));
      }, 90 * 1000);
      // Pré-aquece o cache de custo por Resource Group (usado pelo Inventário — lista de
      // Recursos, modal de detalhe, vista "Por Assinatura") — sem isso, o PRIMEIRO usuário a
      // abrir qualquer uma dessas telas depois do boot paga o custo do scan completo
      // (~20-90s). Delay maior que o de `_refreshAzureCache` (mais 30s depois) pra não somar
      // dois scans pesados de `azure_costs` no mesmo instante do startup.
      setTimeout(() => {
        _getRgStatsCache().catch(e => console.warn('[Inventario] Cache de custo por RG não pôde ser pré-aquecido:', e.message));
      }, 120 * 1000);
      // Índice pesado criado em background (3 min de delay) — evita saturar o pool no startup
      setTimeout(() => {
        if (!pool) return;
        console.log('[DB] Criando idx_azure_costs_sub_date_rg em background...');
        pool.query(`
          CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_date_rg
            ON azure_costs (subscription_id, cost_date, UPPER(resource_group_name))
        `).then(() => console.log('[DB] idx_azure_costs_sub_date_rg pronto ✅'))
          .catch(e => console.warn('[DB] Índice sub_date_rg:', e.message));
      }, 3 * 60 * 1000);
      // Migração de fonte: remarcar registros de coletas API/Storage que ficaram com fonte='manual'.
      // Roda com 60s de delay para não competir com os requests iniciais pelo pool de conexões.
      setTimeout(() => {
        if (!pool) return;
        pool.query(`
          UPDATE azure_costs ac
          SET fonte = h.tipo
          FROM azure_coleta_historico h
          WHERE h.tipo IN ('api', 'storage')
            AND h.concluido_em IS NOT NULL
            AND ac.importado_em >= h.iniciado_em
            AND ac.importado_em <= h.concluido_em + INTERVAL '5 minutes'
            AND ac.fonte = 'manual'
        `).then(r => { if (r.rowCount > 0) console.log(`[Migration] ${r.rowCount} registros remarcados com fonte api/storage`); }).catch(() => {});
      }, 60 * 1000);
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

  // Keep-alive: ping no banco a cada 4 min e reconexao automatica.
  //
  // A versao anterior desistia para sempre: comecava com `if (!pool) return`
  // e, no primeiro fracasso de reconexao, fazia `pool = null` -- entao todo
  // tick seguinte caia no return e nunca mais tentava. Na pratica, uma queda
  // de rede de 30s virava indisponibilidade ate alguem reiniciar o processo a
  // mao (observado: 19h fora do ar apos uma troca de IP da maquina).
  //
  // Isto pesa MAIS em producao, onde banco e aplicacao ficam em hosts
  // separados e reinicio de banco, failover e timeout de firewall sao
  // rotina -- exatamente os casos em que o processo precisa se recuperar
  // sozinho.
  //
  // Agora: tenta reconectar tambem com o pool nulo, com recuo progressivo
  // para nao martelar um banco que esta reiniciando.
  //
  // Sequencia real dos intervalos entre tentativas (tick de 4 min):
  //   4, 4, 8, 12, 16, 20, 20, 20...  -- teto em 20 min
  // ou seja, as DUAS primeiras tentativas ficam a 4 min uma da outra (o recuo
  // so comeca a crescer da terceira em diante), o que cobre de graca o caso
  // mais comum: reinicio rapido do banco, resolvido em ate 8 min sem espera
  // longa. As tentativas caem nos minutos 4, 8, 16, 28, 44 e 64 apos a queda.
  let _dbFalhas = 0;      // fracassos consecutivos de reconexao
  let _dbPularTicks = 0;  // ticks a ignorar (recuo progressivo)
  let _dbCaiuEm = null;   // instante da queda, so para medir o tempo fora

  const _keepAliveTimer = setInterval(async () => {
    if (pool) {
      try {
        await pool.query('SELECT 1');
        return;                       // saudavel, nada a fazer
      } catch (err) {
        console.warn('  Keep-alive falhou:', err.message);
        pool = null;                  // derruba o pool quebrado
        if (!_dbCaiuEm) _dbCaiuEm = Date.now();
      }
    }

    // Daqui para baixo o pool esta nulo -- inclusive quando a conexao inicial
    // do boot falhou, caso que a versao antiga tambem nunca recuperava.
    if (_dbPularTicks > 0) { _dbPularTicks--; return; }
    if (!_dbCaiuEm) _dbCaiuEm = Date.now();

    try {
      const cfg = getDbConfig();      // relido a cada tentativa: env vars em
      if (!cfg) return;               // producao, .finops_setup no local
      createPool(cfg);
      await pool.query('SELECT 1');

      const fora = Math.round((Date.now() - _dbCaiuEm) / 1000);
      console.log(`  Banco reconectado apos ${fora}s fora e ${_dbFalhas + 1} tentativa(s).`);
      _dbFalhas = 0; _dbPularTicks = 0; _dbCaiuEm = null;

      // Os timers sao idempotentes (cada um guarda a propria variavel), entao
      // re-chamar aqui e seguro e devolve os agendadores que pararam na queda.
      _iniciarAgendador();
      _iniciarAlertasEmail();
      _iniciarInventarioAgendador();
      _iniciarReconciliacaoAgendador();
      _iniciarRecursoTagsCache();
      _iniciarLogAnalyticsAgendador();
      _iniciarLogAnalyticsDiagAgendador();
    } catch (e2) {
      pool = null;
      _dbFalhas++;
      _dbPularTicks = Math.min(4, _dbFalhas - 1);   // teto: 5 ticks = 20 min
      const proxima = (_dbPularTicks + 1) * 4;
      console.error(`  Reconexao falhou (tentativa ${_dbFalhas}): ${e2.message}. Nova tentativa em ${proxima} min.`);
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
