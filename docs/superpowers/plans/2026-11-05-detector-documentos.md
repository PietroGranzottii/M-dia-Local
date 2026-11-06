# Detector e limpeza de documentos — Plano de implementação

> **Para agentes:** use superpowers:executing-plans (ou subagent-driven-development) para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** página `/documentos` no MídiaLocal que mostra indícios de IA no estilo do texto e nos metadados de DOCX/PDF/TXT, e gera cópia de DOCX/PDF sem metadados.

**Arquitetura:** análise no servidor Node (`http` puro), reaproveitando `startJob`/`/api/jobs`/`/api/download`. Três módulos puros em `lib/` (`textstats`, `docx`, `pdf`), duas rotas novas, um módulo de front-end compartilhado e a página nova.

**Stack:** Node ≥ 22.13 (ESM), `fflate`, `pdf-lib`, `pdfjs-dist` 6, `node:test`.

**Spec:** [2026-11-05-detector-documentos-design.md](../specs/2026-11-05-detector-documentos-design.md)

## Restrições globais

- Tudo roda em `127.0.0.1`; nenhum texto sai do computador.
- O conteúdo do documento nunca é alterado na limpeza.
- Mensagens de interface e de erro em português.
- O detector sempre se apresenta como indicador, nunca como prova.
- Sem novas dependências além de `fflate`, `pdf-lib` e `pdfjs-dist`.

## Nota sobre o código

Todo o código abaixo foi escrito e validado num protótipo (cópia do projeto no rascunho da sessão): **25 testes passando** em `npm test`, incluindo o servidor real com FFmpeg. A execução consiste em levar cada arquivo ao projeto na ordem das tarefas, rodando os testes de cada uma. Os arquivos citados são a fonte da verdade do código.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `package.json` | Modificar | dependências, `engines >=22.13`, `"test": "node --test test/*.test.js"` |
| `iniciar.bat` | Modificar | roda `npm install --omit=dev` quando falta `node_modules` |
| `lib/scan.js` | Modificar | marcadores `ChatGPT`, `Copilot`, `Claude` |
| `lib/textstats.js` | Criar | `analyzeText`, `countWords`, `words`, `levelOf`, `SHORT_TEXT_WORDS` |
| `lib/docx.js` | Criar | `inspectDocx`, `cleanDocx(buf, now?)`, `extractDocxText` |
| `lib/pdf.js` | Criar | `inspectPdf`, `cleanPdf` (async) |
| `server.js` | Modificar | `MIDIALOCAL_TMP`, rota `/documentos`, `POST /api/document`, `POST /api/analyze-text`, `rejectUpload(..., status)` |
| `public/shared.js` | Criar | `upload(endpoint, file, onProgress)`, `waitForJob`, `setupDropZone`, `createCard(queue, title, subtitle)`, `downloadLink`, `row`, `el`, `extOf`, `formatBytes` |
| `public/app.js` | Modificar | passa a importar de `shared.js` |
| `public/documentos.html`, `public/documentos.js` | Criar | página nova |
| `public/index.html`, `public/limpar.html` | Modificar | link "Analisar documentos" na navegação |
| `public/style.css` | Modificar | estilos de `.paste`, `.meter`, `.indicators`, `.meta` |
| `test/samples.js`, `test/fixtures.js` | Criar | textos de exemplo; `makeDocx(opts)`, `makePdf(opts)` |
| `test/*.test.js` | Criar | `textstats`, `docx`, `pdf`, `server` |

## Interfaces

```js
analyzeText(text) → { language: 'pt'|'en', words, sentences, short, score, level: 'baixo'|'médio'|'alto',
                      indicators: [{ id, label, weight, value, score, detail }], phrases: [{ phrase, count }] }
inspectDocx(buf)  → { text, metadata: [{ label, value }], signals: [{ level: 'info'|'warn', message }] }
cleanDocx(buf, now = new Date()) → { data: Buffer, removed: [{ field, value }] }
inspectPdf(buf)   → Promise<mesmo formato de inspectDocx>
cleanPdf(buf)     → Promise<mesmo formato de cleanDocx>
Resultado da tarefa /api/document → { kind: 'document', format, text: analyzeText|null, metadata, signals, removed,
                                       name, inputSize, size }
```

---

### Tarefa 1: Dependências e detector de texto

**Arquivos:** `package.json`, `iniciar.bat`, `lib/textstats.js`, `test/samples.js`, `test/textstats.test.js`

- [ ] Atualizar `package.json` e `iniciar.bat`; rodar `npm install`.
- [ ] Criar `test/samples.js` e `test/textstats.test.js` (8 testes: contagem de palavras, limites de nível, texto IA = alto, texto humano = baixo, inglês, texto curto, texto vazio, abreviações).
- [ ] `node --test test/textstats.test.js` → falha (módulo inexistente).
- [ ] Criar `lib/textstats.js`.
- [ ] `node --test test/textstats.test.js` → 8 passando.

### Tarefa 2: DOCX

**Arquivos:** `lib/scan.js`, `lib/docx.js`, `test/fixtures.js`, `test/docx.test.js`

- [ ] Adicionar os marcadores em `lib/scan.js`.
- [ ] Criar `test/fixtures.js` e `test/docx.test.js` (6 testes: texto, metadados, alertas, sem alertas falsos, DOCX inválido, limpeza completa preservando o texto).
- [ ] Rodar → falha. Criar `lib/docx.js`. Rodar → 6 passando.

### Tarefa 3: PDF

**Arquivos:** `lib/pdf.js`, `test/pdf.test.js`

- [ ] Criar `test/pdf.test.js` (5 testes: leitura de Info/XMP/texto, PDF sem texto, PDF inválido no inspect e no clean, limpeza preservando o texto).
- [ ] Rodar → falha. Criar `lib/pdf.js`. Rodar → 5 passando.

### Tarefa 4: Rotas do servidor

**Arquivos:** `server.js`, `test/server.test.js`

- [ ] Criar `test/server.test.js` (6 testes; sobe o servidor na porta 3999 com `MIDIALOCAL_TMP` temporário).
- [ ] Rodar → falha. Aplicar as mudanças em `server.js`. Rodar → 6 passando.

### Tarefa 5: Interface

**Arquivos:** `public/shared.js`, `public/app.js`, `public/documentos.html`, `public/documentos.js`, `public/index.html`, `public/limpar.html`, `public/style.css`

- [ ] Criar `shared.js` e refatorar `app.js` para usá-lo.
- [ ] Criar a página e o script; adicionar o link de navegação e os estilos.
- [ ] `npm test` → 25 passando (a página `/documentos` é coberta pelo teste do servidor).
- [ ] Verificação manual no navegador (Playwright): as três páginas carregam sem erro no console; colar texto mostra o relatório; enviar DOCX e PDF mostra o relatório e o botão de download; o arquivo baixado abre; as páginas antigas continuam convertendo/limpando; layout ok em 375 px de largura.
