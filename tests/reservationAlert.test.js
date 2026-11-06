const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
const functionStart = serverSource.indexOf('async function _checkReservasVencendo')
const functionEnd = serverSource.indexOf('\n// Ações FinOps', functionStart)
if (functionStart < 0 || functionEnd < 0) throw new Error('Não foi possível localizar _checkReservasVencendo em server.js')

function makeChecker({ reservas, recentes = [], envioAceito = true }) {
  const mensagens = []
  const chavesMarcadas = []
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM reservas_cloud')) return { rows: reservas }
      if (sql.includes('INSERT INTO email_alertas_enviados')) {
        chavesMarcadas.push(...params[0])
        return { rows: [] }
      }
      if (sql.includes('DELETE FROM email_alertas_enviados')) return { rows: [] }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
  }
  const checker = new Function(
    'pool', '_alertaAtivo', '_getSmtpConfig', '_parseDestinatarios', '_tentarClaimAlerta', '_sendEmail',
    '_emailAppLink', '_emailTemplate', '_escHtmlServer',
    `${serverSource.slice(functionStart, functionEnd)}; return _checkReservasVencendo`
  )(
    pool,
    async () => true,
    async () => ({ destinatarios_padrao: 'finops@example.com' }),
    (value) => String(value || '').split(',').map((email) => email.trim()).filter(Boolean),
    async (_tipo, chave) => !recentes.includes(chave),
    async (mensagem) => { mensagens.push(mensagem); return envioAceito },
    () => '',
    (titulo, corpo) => `<article><h1>${titulo}</h1>${corpo}</article>`,
    (value) => String(value)
  )

  return { checker, mensagens, chavesMarcadas }
}

function reserva(id, cloud, tipo_recurso) {
  return {
    id,
    cloud,
    nome_reserva: `Reserva ${id}`,
    tipo_recurso,
    data_vencimento: new Date(Date.now() + 10 * 86400000),
    dono_email: null,
  }
}

test('envia o grupo completo de clouds e tipos quando uma reserva sai do cooldown', async () => {
  const reservas = Array.from({ length: 12 }, (_, index) => reserva(index + 1, index % 2 ? 'AWS' : 'Azure', 'Reserved VM Instances'))
  reservas.push(reserva(13, 'Azure', 'Azure Savings Plan (Compute)'))
  const recentes = reservas.slice(0, 12).map((item) => `reserva:${item.id}`)
  const { checker, mensagens, chavesMarcadas } = makeChecker({ reservas, recentes })

  await checker()

  assert.equal(mensagens.length, 1)
  assert.match(mensagens[0].subject, /13 reserva\(s\)/)
  assert.match(mensagens[0].html, /Azure Savings Plan \(Compute\)/)
  assert.match(mensagens[0].html, /AWS/)
  assert.equal(chavesMarcadas.length, 13)
})

test('não consome o cooldown quando o Relay não aceita o envio', async () => {
  const { checker, mensagens, chavesMarcadas } = makeChecker({
    reservas: [reserva(1, 'Azure', 'Azure Savings Plan (Compute)')],
    envioAceito: false,
  })

  await checker()

  assert.equal(mensagens.length, 1)
  assert.deepEqual(chavesMarcadas, [])
})

test('não reenvia o grupo quando todas as reservas estão no cooldown', async () => {
  const reservas = [reserva(1, 'Azure', 'Reserved VM Instances'), reserva(2, 'AWS', 'Savings Plan')]
  const recentes = reservas.map((item) => `reserva:${item.id}`)
  const { checker, mensagens, chavesMarcadas } = makeChecker({ reservas, recentes })

  await checker()

  assert.deepEqual(mensagens, [])
  assert.deepEqual(chavesMarcadas, [])
})