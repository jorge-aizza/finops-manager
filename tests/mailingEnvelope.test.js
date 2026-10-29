const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
const envelopeStart = serverSource.indexOf('function _mailingEmailEnvelope')
const envelopeEnd = serverSource.indexOf('\nfunction _mailingPaginaDescadastro', envelopeStart)
if (envelopeStart < 0 || envelopeEnd < 0) throw new Error('Não foi possível localizar o envelope do Mailing em server.js')
const mailingEmailEnvelope = new Function(`${serverSource.slice(envelopeStart, envelopeEnd)}; return _mailingEmailEnvelope`)()

test('envelope do Mailing centraliza o conteúdo e normaliza tabelas antigas para Outlook', () => {
  const html = mailingEmailEnvelope('<table><tr><td><img src="cid:logo" width="120"></td><td><p><span style="font-size:18px;color:#ff0000"><a href="https://example.com/info" style="color:#7b2fbe">Comunicado de teste</a></span></p></td></tr></table>', 'https://example.com/unsubscribe')

  assert.match(html, /<!DOCTYPE html>/i)
  assert.match(html, /<table role="presentation" width="100%"/)
  assert.match(html, /<!--\[if mso\]>.*?width="640".*?<!\[endif\]-->/s)
  assert.match(html, /max-width:640px/)
  assert.match(html, /<table width="100%" border="0" cellpadding="0" cellspacing="0">/)
  assert.equal((html.match(/valign="top"/g) || []).length, 3)
  assert.match(html, /font-size:14px;line-height:21px;mso-line-height-rule:exactly/)
  assert.match(html, /padding:16px 24px/)
  assert.match(html, /<img src="cid:logo" width="120">/)
  assert.match(html, /font-size:18px;color:#ff0000/)
  assert.match(html, /<a href="https:\/\/example\.com\/info" style="color:#7b2fbe">Comunicado de teste<\/a>/)
  assert.match(html, /href="https:\/\/example\.com\/unsubscribe"/)
  assert.match(html, /Descadastrar-se/)
})

test('envelope do Mailing preserva a quantidade de espaços repetidos no texto', () => {
  const html = mailingEmailEnvelope('<p>Antes   depois</p><p><strong>Texto   em destaque</strong></p>', 'https://example.com/unsubscribe')

  assert.match(html, /Antes&nbsp;&nbsp;&nbsp;depois/)
  assert.match(html, /<strong>Texto&nbsp;&nbsp;&nbsp;em destaque<\/strong>/)
})

test('envelope aplica grade e espaçamento às tabelas de dados, mas não à assinatura', () => {
  const html = mailingEmailEnvelope('<table><tr><th>Status</th><th>Ação</th></tr><tr><td>Alerta</td><td>Mitigar</td></tr></table><table><tr><td><img src="cid:logo"></td><td>Assinatura</td></tr></table>', 'https://example.com/unsubscribe')

  assert.match(html, /<table width="100%" border="1" cellpadding="6" cellspacing="0"[^>]*border-collapse:collapse/)
  assert.match(html, /<th[^>]*border:1px solid #cbd5e1;padding:7px 9px/)
  assert.match(html, /<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td valign="top"><img src="cid:logo"/)
})