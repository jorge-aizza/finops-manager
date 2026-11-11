# 17 — Tema, cores e layout visual

Este guia define como manter os temas claro e escuro consistentes no FinOps Manager. A
fonte de verdade dos tokens globais e das regras compartilhadas é `styles.css`, usado pela
interface legada e pelas telas React.

## Estado do tema

- O atributo `data-theme="light"` no elemento `<html>` ativa o tema claro.
- Sem esse atributo, o CSS usa os tokens do tema escuro.
- No carregamento da aplicação, `index.html` lê `localStorage['finops-theme']`: sem a
  preferência `dark`, define o tema claro. Portanto, o padrão CSS é escuro, mas a primeira
  visita da aplicação é clara.
- `toggleTheme()` em `app.js` altera o atributo e persiste `light` ou `dark` na mesma chave.
- Não crie um estado de tema independente em uma tela ou componente React. Leia o tema do
  documento e use os tokens CSS para manter uma única fonte de verdade.

## Tokens de cor

Use as variáveis abaixo em vez de repetir valores hexadecimais em componentes, estilos inline
ou novos seletores. A tabela registra os valores globais atuais de `styles.css`.

| Papel | Token | Escuro | Claro |
|---|---|---|---|
| Fundo da aplicação | `--bg` | `#18171b` | `#f4f5f7` |
| Superfície/cartão | `--bg-card` | `#222126` | `#ffffff` |
| Superfície alternativa | `--surface-alt` | `#29272d` | `#f8f8fa` |
| Hover | `--bg-hover` | `rgba(255,255,255,.06)` | `rgba(102,0,153,.06)` |
| Borda | `--border` | `#39373e` | `#dfe1e6` |
| Borda secundária | `--border-light` | `#4a474f` | `#e9e7ed` |
| Texto principal | `--text` | `#f4f2f5` | `#111827` |
| Texto secundário | `--text-muted` | `#b4afb9` | `#606672` |
| Texto de destaque | `--text-dim` | `#e2c8ef` | `#660099` |
| Acento de interação | `--accent` | `#d49be1` | `#660099` |
| Roxo da marca | `--accent-brand` | `#660099` | `#660099` |
| Rosa da marca | `--accent-secondary` | `#e6007e` | `#e6007e` |
| Acento forte | `--accent-strong` | `#a82bd0` | `#660099` |
| Fundo de acento | `--accent-dim` | `rgba(212,155,225,.14)` | `rgba(102,0,153,.09)` |
| Erro | `--danger` | `#ff4d6a` | `#b91c1c` |
| Vermelho semântico | `--text-red` | `#ff7185` | `#b91c1c` |
| Laranja semântico | `--text-orange` | `#ff8c42` | `#92400e` |
| Verde semântico | `--text-green` | `#22c55e` | `#166534` |
| Azul semântico | `--text-blue` | `#4da6ff` | `#1d4ed8` |

`--surface`, `--base`, `--text-primary`, `--red`, `--orange`, `--green` e `--blue` são
aliases de compatibilidade usados por estilos legados. Em código novo, prefira os tokens
semânticos acima.

## Regras de uso

- Fundos, cartões, campos, tabelas, modais e bordas devem usar `--bg`, `--bg-card`,
  `--surface`, `--border` e `--text`, não cores fixas.
- Use `--accent` para interação e foco; `--accent-brand` e `--accent-secondary` para sinais
  de marca pontuais. No tema claro, a sidebar e a top-bar são brancas; roxo é acento para
  navegação ativa, marca e foco, não um fundo dominante.
- Use os tokens semânticos para estados e mantenha o rótulo, ícone ou texto do estado. A cor
  sozinha não deve ser a única forma de comunicar sucesso, alerta ou erro.
- Cores específicas de cloud, status de reserva e gráficos podem ter mapeamentos próprios,
  mas precisam ser legíveis nos dois temas. Reaproveite as regras existentes antes de criar
  outra paleta local.
- Evite cores hard-coded em CSS de componentes. Se um novo papel de cor for necessário,
  adicione o token no `:root` e uma contraparte em `[data-theme="light"]` em `styles.css`.
- Gradientes e cores de marca são detalhes de ênfase; superfícies grandes e conteúdo devem
  continuar usando os fundos neutros de cada tema.

Exemplo:

```css
.painel-exemplo {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text);
}

.painel-exemplo a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

## Layout claro e escuro

- O tema escuro usa o fundo `--bg` e superfícies `--bg-card`, com texto claro e bordas
  discretas.
- O tema claro mantém o fundo geral cinza claro, cartões brancos, sidebar e top-bar brancas,
  bordas cinza e roxo nos estados ativos.
- A estrutura principal ocupa a altura da janela, com navegação lateral e conteúdo rolável.
  A sidebar tem largura de referência de 220 px no desktop e pode colapsar para ícones.
- Preserve os breakpoints existentes em `styles.css` (1280, 1100, 900, 640 e 380 px). Em
  telas menores, valide navegação, tabelas, filtros, modais e formulários sem rolagem
  horizontal acidental ou sobreposição.
- A tela de login usa a imagem de fundo no tema escuro e uma superfície clara sólida no tema
  claro. Não aplique o fundo escuro por cima do tema claro.
- Use os assets de logo apropriados para cada tema, pelas classes existentes (`topbar-logo-light`
  e `topbar-logo-dark`). Não tente tornar o logo legível aplicando filtros CSS ao arquivo de
  imagem.

## Acessibilidade e validação

- Mantenha contraste WCAG AA: pelo menos 4,5:1 para texto comum e 3:1 para texto grande e
  componentes gráficos relevantes.
- Verifique foco visível, hover, desabilitado, erro, carregamento, vazio e sucesso nos dois
  temas.
- Valide a tela em tema claro e escuro e em larguras próximas a 900 px, 640 px e 380 px.
- Ao alterar tokens globais, revise também gráficos, badges, placeholders, tooltips, overlays,
  modais e estados de carregamento; cores fixas antigas podem ficar invisíveis no tema oposto.
- Quando houver teste visual ou de acessibilidade para a tela alterada, rode-o nos dois temas.

## Arquivos de referência

- Tokens e regras compartilhadas: `styles.css`
- Bootstrap do tema e HTML da aplicação: `index.html`
- Toggle, persistência e sincronização do ícone: `app.js`
- Telas React: `frontend/src/`