// Stylometric heuristics that hint at AI-written text. They are indicators,
// not proof: every threshold below is a starting point meant to be tuned.

export const SHORT_TEXT_WORDS = 150;
const MIN_SENTENCES = 5;
const MIN_PARAGRAPHS = 3;
const MIN_PARAGRAPH_WORDS = 8; // shorter "paragraphs" are headings or list items
const MIN_SENTENCE_WORDS = 3;
const MATTR_WINDOW = 100;

// [id, label, weight, value at score 0, value at score 100, explanation]
const INDICATORS = {
  sentences: ['Variação das frases', 0.3, 0.6, 0.25, 'Humanos alternam frases curtas e longas; texto de IA tende a ter frases do mesmo tamanho.'],
  phrases: ['Expressões típicas de IA', 0.3, 0, 6, 'Ocorrências por 1000 palavras de expressões comuns em textos de modelos de linguagem.'],
  connectors: ['Conectivos repetitivos', 0.2, 0.05, 0.25, 'Fração das frases que começam com conectivos como "Além disso" ou "No entanto".'],
  paragraphs: ['Uniformidade dos parágrafos', 0.1, 0.6, 0.2, 'Parágrafos de tamanho muito parecido são comuns em texto gerado.'],
  vocabulary: ['Diversidade de vocabulário', 0.1, 0.85, 0.7, 'Proporção de palavras distintas (MATTR). Vocabulário mais repetitivo é comum em IA; sinal fraco quando isolado.'],
};

const STOPWORDS = {
  pt: new Set(['de', 'que', 'não', 'uma', 'para', 'com', 'os', 'da', 'dos', 'das', 'em', 'na', 'um', 'é', 'se', 'por', 'mais', 'como', 'mas', 'ao', 'ele', 'ela', 'isso', 'também', 'são', 'pelo', 'pela', 'foi', 'muito', 'já']),
  en: new Set(['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'with', 'was', 'on', 'are', 'be', 'this', 'by', 'not', 'or', 'have', 'from', 'but', 'they', 'which', 'their', 'can', 'will', 'its', 'also', 'were', 'has']),
};

const AI_PHRASES = [
  // Português
  'é importante ressaltar', 'é importante destacar', 'é importante notar', 'é importante lembrar',
  'vale ressaltar', 'vale destacar', 'vale a pena destacar', 'cabe ressaltar', 'cabe destacar',
  'em suma', 'em síntese', 'em última análise', 'papel crucial', 'papel fundamental', 'papel essencial',
  'de suma importância', 'no cenário atual', 'em um mundo cada vez mais', 'nos dias de hoje',
  'uma ampla gama', 'abordagem holística', 'multifacetado', 'multifacetada', 'fica evidente',
  'torna-se evidente', 'não se trata apenas', 'navegar pelas complexidades', 'em constante evolução',
  'potencializar', 'alavancar',
  // English
  "it's important to note", 'it is important to note', "it's worth noting", 'it is worth noting',
  'in conclusion', 'in summary', 'delve', 'delves', 'delving', 'tapestry', 'testament to',
  'plays a crucial role', 'plays a pivotal role', 'pivotal', "in today's", 'ever-evolving',
  'ever-changing', 'navigate the complexities', 'a myriad of', 'multifaceted', 'holistic',
  'seamless', 'seamlessly', 'underscore', 'underscores', 'in the realm of', 'landscape', 'foster',
  'leverage', 'embark',
];

const CONNECTORS = [
  // Português
  'além disso', 'no entanto', 'dessa forma', 'desta forma', 'dessa maneira', 'assim', 'portanto',
  'por fim', 'em suma', 'em resumo', 'ademais', 'contudo', 'todavia', 'por outro lado', 'nesse sentido',
  'neste sentido', 'nesse contexto', 'neste contexto', 'sendo assim', 'em primeiro lugar',
  'em segundo lugar', 'por conseguinte', 'consequentemente', 'em conclusão', 'logo',
  // English
  'additionally', 'furthermore', 'moreover', 'however', 'therefore', 'in addition', 'overall',
  'ultimately', 'consequently', 'in conclusion', 'in summary', 'firstly', 'secondly', 'lastly',
  'finally', 'thus', 'hence', 'as a result', 'on the other hand', 'notably', 'importantly',
];

const ABBREVIATIONS = /\b(sr|sra|srta|dr|dra|prof|profa|etc|ex|p|pp|vol|n|cap|art|fig|vs|mr|mrs|ms|st|e\.g|i\.e)\./giu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const NOT_LETTER = '(?![\\p{L}\\p{N}])';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PHRASE_RES = AI_PHRASES.map((p) => [p, new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}${NOT_LETTER}`, 'gu')]);
const CONNECTOR_RES = CONNECTORS.map((c) => new RegExp(`^${escapeRe(c)}${NOT_LETTER}`, 'u'));

export function words(text) {
  return normalize(text).match(WORD) ?? [];
}

export function countWords(text) {
  return words(text ?? '').length;
}

function normalize(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[’‘]/g, "'");
}

function splitSentences(text) {
  const protectedText = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, '\u0000'));
  return protectedText
    .split(/(?<=[.!?…])["'”)\]]*\s+|\n+/u)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter((s) => countWords(s) >= MIN_SENTENCE_WORDS);
}

function splitParagraphs(text) {
  let parts = text.split(/\n\s*\n/);
  if (parts.length < MIN_PARAGRAPHS) parts = text.split(/\n/);
  return parts.map((p) => p.trim()).filter((p) => countWords(p) >= MIN_PARAGRAPH_WORDS);
}

function coefficientOfVariation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// Moving-average type-token ratio: stable regardless of text length.
function mattr(tokens) {
  if (tokens.length <= MATTR_WINDOW) return new Set(tokens).size / tokens.length;
  const counts = new Map();
  let distinct = 0;
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    if ((counts.get(tokens[i]) ?? 0) === 0) distinct++;
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    if (i >= MATTR_WINDOW) {
      const out = tokens[i - MATTR_WINDOW];
      counts.set(out, counts.get(out) - 1);
      if (counts.get(out) === 0) distinct--;
    }
    if (i >= MATTR_WINDOW - 1) total += distinct / MATTR_WINDOW;
  }
  return total / (tokens.length - MATTR_WINDOW + 1);
}

function scoreBetween(value, zeroAt, hundredAt) {
  const t = (value - zeroAt) / (hundredAt - zeroAt);
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

function indicator(id, value) {
  const [label, weight, zeroAt, hundredAt, detail] = INDICATORS[id];
  return { id, label, weight, value: Math.round(value * 100) / 100, score: scoreBetween(value, zeroAt, hundredAt), detail };
}

function detectLanguage(tokens) {
  let pt = 0;
  let en = 0;
  for (const t of tokens) {
    if (STOPWORDS.pt.has(t)) pt++;
    if (STOPWORDS.en.has(t)) en++;
  }
  return en > pt ? 'en' : 'pt';
}

export function levelOf(score) {
  if (score < 35) return 'baixo';
  if (score < 65) return 'médio';
  return 'alto';
}

export function analyzeText(input) {
  const text = normalize(input ?? '').trim();
  const tokens = words(text).map((w) => w.toLowerCase());
  const lower = text.toLowerCase();
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);

  const phrases = PHRASE_RES
    .map(([phrase, re]) => ({ phrase, count: lower.match(re)?.length ?? 0 }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  const indicators = [];
  if (sentences.length >= MIN_SENTENCES) {
    indicators.push(indicator('sentences', coefficientOfVariation(sentences.map(countWords))));
    const starts = sentences.filter((s) => CONNECTOR_RES.some((re) => re.test(s.toLowerCase()))).length;
    indicators.push(indicator('connectors', starts / sentences.length));
  }
  if (tokens.length) {
    const total = phrases.reduce((a, p) => a + p.count, 0);
    indicators.push(indicator('phrases', (total / tokens.length) * 1000));
  }
  if (paragraphs.length >= MIN_PARAGRAPHS) {
    indicators.push(indicator('paragraphs', coefficientOfVariation(paragraphs.map(countWords))));
  }
  if (tokens.length >= 50) indicators.push(indicator('vocabulary', mattr(tokens)));

  const weight = indicators.reduce((a, i) => a + i.weight, 0);
  const score = weight ? Math.round(indicators.reduce((a, i) => a + i.score * i.weight, 0) / weight) : 0;

  return {
    language: detectLanguage(tokens),
    words: tokens.length,
    sentences: sentences.length,
    short: tokens.length < SHORT_TEXT_WORDS,
    score,
    level: levelOf(score),
    indicators,
    phrases,
  };
}
