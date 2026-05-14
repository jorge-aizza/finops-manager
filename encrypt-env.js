#!/usr/bin/env node
/**
 * FinOps Manager — .env Encryptor / Decryptor
 * Usage:
 *   node encrypt-env.js encrypt   → encrypts .env → .env.enc
 *   node encrypt-env.js decrypt   → decrypts .env.enc → .env.decrypted
 *   node encrypt-env.js run       → loads encrypted .env.enc and starts server
 */
'use strict';
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ALG        = 'aes-256-gcm';
const KEY_LEN    = 32;
const IV_LEN     = 16;
const TAG_LEN    = 16;
const ENV_FILE   = path.join(__dirname, '.env');
const ENC_FILE   = path.join(__dirname, '.env.enc');
const KEY_FILE   = path.join(__dirname, '.env.key');

// ─── KEY MANAGEMENT ───────────────────────────
function getOrCreateKey() {
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(KEY_LEN);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  console.log('✅ Chave gerada em .env.key — guarde este arquivo com segurança!');
  console.log('⚠  NUNCA envie .env.key para o repositório Git.');
  console.log('   Adicione ao .gitignore: .env, .env.key, .env.enc');
  return key;
}

// ─── ENCRYPT ──────────────────────────────────
function encryptEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ Arquivo .env não encontrado.');
    process.exit(1);
  }
  const key = getOrCreateKey();
  const iv  = crypto.randomBytes(IV_LEN);
  const plaintext = fs.readFileSync(ENV_FILE);

  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag    = cipher.getAuthTag();

  // Format: iv(16) + tag(16) + ciphertext
  const out = Buffer.concat([iv, tag, enc]);
  fs.writeFileSync(ENC_FILE, out.toString('base64'), { mode: 0o600 });
  console.log('✅ .env criptografado → .env.enc');
  console.log('   Você pode apagar o .env original com segurança.');
  console.log('   Para iniciar o servidor com env criptografado:');
  console.log('   node encrypt-env.js run');
}

// ─── DECRYPT ──────────────────────────────────
function decryptEnvBuffer() {
  if (!fs.existsSync(ENC_FILE)) {
    console.error('❌ Arquivo .env.enc não encontrado. Execute "encrypt" primeiro.');
    process.exit(1);
  }
  if (!fs.existsSync(KEY_FILE)) {
    console.error('❌ Chave .env.key não encontrada. Sem a chave, não é possível descriptografar.');
    process.exit(1);
  }
  const key  = getOrCreateKey();
  const raw  = Buffer.from(fs.readFileSync(ENC_FILE, 'utf8').trim(), 'base64');
  const iv   = raw.slice(0, IV_LEN);
  const tag  = raw.slice(IV_LEN, IV_LEN + TAG_LEN);
  const enc  = raw.slice(IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function decryptEnv() {
  const plain = decryptEnvBuffer();
  fs.writeFileSync(ENV_FILE + '.decrypted', plain, { mode: 0o600 });
  console.log('✅ .env.enc descriptografado → .env.decrypted');
}

// ─── LOAD INTO PROCESS ────────────────────────
function loadEncryptedEnv() {
  let plain;
  if (fs.existsSync(ENC_FILE) && fs.existsSync(KEY_FILE)) {
    try {
      plain = decryptEnvBuffer();
      console.log('🔐 Variáveis de ambiente carregadas de .env.enc');
    } catch (e) {
      console.error('❌ Falha ao descriptografar .env.enc:', e.message);
      process.exit(1);
    }
  } else if (fs.existsSync(ENV_FILE)) {
    plain = fs.readFileSync(ENV_FILE, 'utf8');
    console.log('📄 Variáveis de ambiente carregadas de .env (plain)');
  } else {
    console.warn('⚠  Nenhum .env ou .env.enc encontrado — usando variáveis do sistema.');
    return;
  }

  plain.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx < 0) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  });
}

// ─── MAIN ─────────────────────────────────────
const cmd = process.argv[2];

if (cmd === 'encrypt') {
  encryptEnv();
} else if (cmd === 'decrypt') {
  decryptEnv();
} else if (cmd === 'run') {
  loadEncryptedEnv();
  console.log('🚀 Iniciando FinOps Manager com env criptografado...\n');
  require('./server.js');
} else {
  console.log('FinOps Manager — .env Encryptor\n');
  console.log('Uso:');
  console.log('  node encrypt-env.js encrypt  → criptografa .env → .env.enc');
  console.log('  node encrypt-env.js decrypt  → descriptografa .env.enc → .env.decrypted');
  console.log('  node encrypt-env.js run      → carrega .env.enc e inicia o servidor\n');
  console.log('Fluxo recomendado em produção:');
  console.log('  1. Configure suas variáveis no .env');
  console.log('  2. node encrypt-env.js encrypt');
  console.log('  3. Apague o .env: rm .env  (ou del .env no Windows)');
  console.log('  4. Guarde o .env.key em local seguro (cofre de senhas, Secrets Manager)');
  console.log('  5. Em produção: node encrypt-env.js run\n');
}
