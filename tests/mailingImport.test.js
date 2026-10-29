const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
const parserStart = serverSource.indexOf('function _delimitadorCsvMailing')
const parserEnd = serverSource.indexOf('\nif (_multer)', parserStart)
if (parserStart < 0 || parserEnd < 0) throw new Error('Não foi possível localizar o parser Mailing em server.js')
const loadParser = new Function('fs', 'Buffer', 'require', `${serverSource.slice(parserStart, parserEnd)}; return _parsePlanilhaContatos`)
const parsePlanilhaContatos = loadParser(fs, Buffer, require)

function diretorioTemporario(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailing-import-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('parser importa CSV brasileiro separado por ponto-e-vírgula', async (t) => {
  const dir = diretorioTemporario(t)
  const arquivo = path.join(dir, 'contatos.csv')
  fs.writeFileSync(arquivo, 'Email;Nome\nana@example.com;Ana\nbeto@example.com;Beto\n')

  const resultado = await parsePlanilhaContatos(arquivo, 'contatos.csv')

  assert.equal(resultado.colEmailEncontrada, true)
  assert.deepEqual(resultado.linhas, [
    { email: 'ana@example.com', nome: 'Ana' },
    { email: 'beto@example.com', nome: 'Beto' },
  ])
})

test('parser lê e-mails em células de fórmula, texto rico e hyperlink no XLSX', async (t) => {
  const ExcelJS = require('exceljs')
  const dir = diretorioTemporario(t)
  const arquivo = path.join(dir, 'contatos.xlsx')
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Contatos')
  worksheet.addRow(['E-mail', 'Nome'])
  worksheet.addRow([{ formula: '"ana@example.com"', result: 'ana@example.com' }, 'Ana'])
  worksheet.addRow([{ richText: [{ text: 'beto@' }, { text: 'example.com' }] }, 'Beto'])
  worksheet.addRow([{ text: 'caio@example.com', hyperlink: 'mailto:caio@example.com' }, 'Caio'])
  await workbook.xlsx.writeFile(arquivo)

  const resultado = await parsePlanilhaContatos(arquivo, 'contatos.xlsx')

  assert.equal(resultado.colEmailEncontrada, true)
  assert.deepEqual(resultado.linhas, [
    { email: 'ana@example.com', nome: 'Ana' },
    { email: 'beto@example.com', nome: 'Beto' },
    { email: 'caio@example.com', nome: 'Caio' },
  ])
})