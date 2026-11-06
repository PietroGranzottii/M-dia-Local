# Detector e limpeza de documentos (DOCX, PDF, TXT) — Design

Data: 2026-11-05
Status: aprovado em conversa, aguardando revisão do spec

## Objetivo

Adicionar ao MídiaLocal uma página **"Analisar documentos"** que:

1. Analisa um DOCX, PDF, TXT ou texto colado e mostra **indícios de texto gerado por IA**, com base em heurísticas de estilo (texto) e em sinais dos metadados (arquivo).
2. Para DOCX e PDF, oferece o download de uma **cópia com os metadados limpos**, sem alterar o conteúdo.

Tudo roda localmente, como o resto do site. Nenhum texto sai do computador.

## Ajustes feitos durante o protótipo

- **TXT é lido no navegador** (`file.text()`) e enviado para `/api/analyze-text`. O `/api/document` aceita só DOCX e PDF, porque TXT não tem metadados nem cópia limpa.
- **`TotalTime` é removido**, não zerado. Um valor 0 faria o próprio detector (e outros) concluir "texto colado".
- **Diversidade de vocabulário invertida:** MATTR ≥ 0,85 dá nota 0 e ≤ 0,70 dá nota 100. No teste, o texto humano tinha vocabulário mais variado que o de IA.
- O módulo compartilhado do front-end se chama `public/shared.js`, porque além do upload ele guarda os helpers de cartão e DOM.
- A variável de ambiente `MIDIALOCAL_TMP` troca a pasta temporária, para o teste do servidor não apagar arquivos de uma instância aberta.
- `pdfjs-dist` 6 exige Node ≥ 22.13. O campo `engines` foi atualizado.

## Fora do escopo

- Modelos de linguagem (perplexidade), APIs externas, marcas d'água (SynthID etc.).
- Reescrever ou alterar o texto do documento.
- Outros formatos (ODT, RTF, DOC antigo).
- OCR de PDFs escaneados.

## Arquitetura

O processamento acontece no servidor e segue o padrão atual: upload, tarefa (`startJob`), consulta em `/api/jobs/:id` e download em `/api/download/:id`.

### Dependências novas

| Pacote | Uso |
|---|---|
| `pdfjs-dist` | Extrair o texto e os metadados (Info + XMP) do PDF |
| `pdf-lib` | Regravar o PDF sem o Info e sem o XMP |
| `fflate` | Ler e regravar o ZIP do DOCX |

O `iniciar.bat` roda `npm install` quando a pasta `node_modules` não existe.

### Módulos

| Arquivo | Responsabilidade | Interface |
|---|---|---|
| `lib/textstats.js` | Heurísticas de estilo. Função pura, sem I/O. | `analyzeText(text) → { language, words, short, score, level, indicators[], phrases[] }` |
| `lib/docx.js` | Ler os metadados e o texto, gerar a cópia limpa | `inspectDocx(buf) → { text, metadata, signals[] }`; `cleanDocx(buf) → { data, removed[] }` |
| `lib/pdf.js` | O mesmo para PDF | `inspectPdf(buf) → { text, metadata, signals[] }`; `cleanPdf(buf) → { data, removed[] }` |
| `lib/scan.js` | Ganha os marcadores "ChatGPT", "Copilot" e "Claude". Usado só nas partes de metadados. | `scanBuffer` (sem mudança) |
| `public/shared.js` | `upload()`, `waitForJob()`, cartões e helpers de DOM, extraídos do `app.js` e usados pelas duas páginas | módulo ES |
| `public/documentos.html` + `public/documentos.js` | Nova página | — |

### Rotas

- `POST /api/document`: corpo binário com cabeçalho `X-Filename`. Aceita `.docx` e `.pdf`, até 50 MB, e responde `202 { id }`. Resultado da tarefa:
  `{ kind: 'document', format, text: <relatório analyzeText | null>, metadata, signals[], removed[] }`.
- `POST /api/analyze-text`: corpo JSON `{ text }`, até 1 MB. Responde `200` com o relatório de `analyzeText` na hora.

A rota de página `/documentos` entra em `PAGES`. O link "Analisar documentos" é adicionado à navegação das três páginas.

## Detector de texto (`lib/textstats.js`)

1. **Idioma:** proporção de stopwords PT e EN. O padrão é PT.
2. **Segmentação:** frases separadas por `.`, `!`, `?` e `…` (sem quebrar abreviações comuns como "Sr.", "etc.", "e.g."). Parágrafos separados por linhas em branco ou quebras de linha.
3. **Indicadores.** Cada um gera uma nota de 0 a 100 (100 = mais parecido com IA):

| Indicador | Medida | Peso |
|---|---|---|
| Variação das frases | Coeficiente de variação do tamanho das frases. CV ≥ 0,6 dá nota 0, CV ≤ 0,25 dá nota 100, com interpolação linear entre os dois | 0,30 |
| Expressões típicas de IA | Ocorrências da lista PT/EN por 1000 palavras. 0 dá nota 0, ≥ 6 dá nota 100 | 0,30 |
| Conectivos repetitivos | Fração das frases que começam com conectivo da lista. ≤ 5% dá nota 0, ≥ 25% dá nota 100 | 0,20 |
| Uniformidade dos parágrafos | CV do tamanho dos parágrafos (só com 3 ou mais parágrafos; senão o peso é redistribuído). CV ≥ 0,6 dá nota 0, ≤ 0,2 dá nota 100 | 0,10 |
| Diversidade de vocabulário | MATTR com janela de 100 palavras. ≥ 0,85 dá nota 0, ≤ 0,70 dá nota 100 | 0,10 |

4. **Pontuação:** média ponderada. Nível `baixo` < 35 ≤ `médio` < 65 ≤ `alto`.
5. **Texto curto:** com menos de 150 palavras, `short: true` e a interface mostra o aviso de baixa confiabilidade.
6. **`phrases[]`:** as expressões encontradas, com a contagem de cada uma.

Os limiares são pontos de partida e ficam como constantes no topo do arquivo, para ajuste depois.

## Sinais de metadados

Os sinais são alertas `{ level: 'info' | 'warn', message }`. Eles **não** entram na pontuação de estilo.

**DOCX** (`docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml`, `customXml/*`, `word/settings.xml`):
- Mostra o programa (`Application` / `AppVersion`), o autor, o último editor, as datas de criação e modificação e a revisão.
- `warn` quando o tempo de edição (`TotalTime`) fica abaixo de 1 minuto por 250 palavras, com a mensagem "texto provavelmente colado de outro lugar".
- `info` com o número de sessões de edição (quantidade de `w:rsid` em `settings.xml`). `warn` quando há 2 ou menos sessões e mais de 500 palavras.
- `warn` para cada marcador de IA encontrado pelo `scanBuffer` nessas partes.

**PDF:**
- Mostra Title, Author, Producer, Creator, as datas e o `xmp:CreatorTool`.
- `warn` para cada marcador de IA encontrado nesses campos.

## Limpeza

O conteúdo nunca é alterado: o texto, a formatação, as imagens, os comentários e as alterações controladas continuam iguais.

**DOCX:**
- `core.xml`: remove `dc:creator`, `cp:lastModifiedBy`, `dc:title`, `dc:subject`, `cp:keywords`, `dc:description` e `cp:lastPrinted`. `cp:revision` passa a ser `1`. `dcterms:created` e `dcterms:modified` passam para a data de agora.
- `app.xml`: remove `TotalTime`, `Application`, `AppVersion`, `Company`, `Manager` e `Template`.
- `docProps/custom.xml`: removido, junto com a entrada no `[Content_Types].xml` e o relacionamento em `_rels/.rels`.
- `docProps/thumbnail.*`: removido da mesma forma.
- `rsid`: remove o elemento `w:rsids` de `settings.xml` e todos os atributos `w:rsid*` das partes em `word/*.xml`.

**PDF:**
- Remove o dicionário Info e o `/Metadata` do catálogo com o `pdf-lib`, e salva com a regravação completa. Assim não sobra cópia antiga no arquivo, como sobraria numa atualização incremental.

A lista `removed[]` descreve cada campo removido com o valor que ele tinha, para a interface mostrar o "antes".

A cópia é salva como `<nome>_limpo.<ext>`.

## Interface (`/documentos`)

- Mantém o mesmo cabeçalho, estilo e área de soltar arquivos das outras páginas, aceitando `.docx`, `.pdf` e `.txt`.
- Abaixo, uma área "ou cole um texto" com o botão **Analisar**.
- Cada resultado vira um cartão na fila com:
  - a barra de pontuação, o nível e o aviso de texto curto, se for o caso;
  - a lista dos indicadores, cada um com sua nota e uma explicação de uma linha;
  - as expressões encontradas, com contagem;
  - os sinais de metadados (info/alerta);
  - para DOCX e PDF, o botão **Baixar versão limpa** e a lista "removido".
- Um aviso fixo: "Este resultado é um indicador estatístico, não uma prova. Detectores erram, especialmente com textos curtos, formais ou de quem escreve em segunda língua."

## Erros

| Situação | Comportamento |
|---|---|
| PDF com senha | Erro "PDF protegido por senha; não é possível analisar." |
| PDF sem texto extraível | Analisa só os metadados. `text: null`, com o aviso "PDF sem texto (provavelmente escaneado)". |
| DOCX inválido ou sem `word/document.xml` | Erro "DOCX corrompido ou inválido." |
| Arquivo acima de 50 MB, ou texto colado acima de 1 MB | Erro 413 com mensagem |
| Extensão não aceita | Erro 400, como hoje |

## Testes (`node:test`, `npm test`)

- `test/textstats.test.js`: texto uniforme e cheio de expressões típicas tem pontuação maior que um texto humano variado. Texto curto marca `short`. A detecção de idioma funciona.
- `test/docx.test.js`: gera um DOCX mínimo com `fflate` e metadados conhecidos. `inspectDocx` lê os campos e produz os sinais esperados. `cleanDocx` remove os campos e os `rsid`, e o texto extraído depois é idêntico ao de antes.
- `test/pdf.test.js`: gera um PDF com `pdf-lib`, com Info preenchido e texto. `cleanPdf` remove o Info e o XMP, e o texto extraído depois é idêntico.
- `test/server.test.js`: sobe o `server.js` num processo filho com `PORT=3999` (exige o FFmpeg instalado, como o próprio servidor). Verifica que `/api/analyze-text` responde com o relatório e que `/api/document` recusa extensões não aceitas.
