import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, countWords, levelOf } from '../lib/textstats.js';
import { AI_LIKE_PT, HUMAN_LIKE_PT, AI_LIKE_EN } from './samples.js';

test('countWords conta palavras com acentos, hífen e apóstrofo', () => {
  assert.equal(countWords("Olá, mundo! Guarda-chuva e it's ok."), 6);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
});

test('levelOf usa os limites 35 e 65', () => {
  assert.equal(levelOf(34), 'baixo');
  assert.equal(levelOf(35), 'médio');
  assert.equal(levelOf(64), 'médio');
  assert.equal(levelOf(65), 'alto');
});

test('texto com estilo de IA pontua alto', () => {
  const r = analyzeText(AI_LIKE_PT);
  assert.equal(r.language, 'pt');
  assert.equal(r.short, false);
  assert.equal(r.level, 'alto', `pontuação ${r.score}`);
  assert.ok(r.phrases.some((p) => p.phrase === 'é importante ressaltar'));
  assert.deepEqual(r.indicators.map((i) => i.id).sort(), ['connectors', 'paragraphs', 'phrases', 'sentences', 'vocabulary']);
});

test('texto humano variado pontua baixo', () => {
  const r = analyzeText(HUMAN_LIKE_PT);
  assert.equal(r.short, false);
  assert.equal(r.level, 'baixo', `pontuação ${r.score}`);
  assert.deepEqual(r.phrases, []);
});

test('detecta inglês e as expressões em inglês', () => {
  const r = analyzeText(AI_LIKE_EN);
  assert.equal(r.language, 'en');
  assert.ok(r.phrases.some((p) => p.phrase === 'delve'));
  assert.ok(r.score >= 50, `pontuação ${r.score}`);
});

test('texto curto é marcado e pula indicadores sem dados suficientes', () => {
  const r = analyzeText('Uma frase curta. Outra frase aqui.');
  assert.equal(r.short, true);
  assert.deepEqual(r.indicators.map((i) => i.id), ['phrases']);
});

test('texto vazio não quebra', () => {
  const r = analyzeText('   ');
  assert.equal(r.words, 0);
  assert.equal(r.score, 0);
  assert.deepEqual(r.indicators, []);
});

test('abreviações não quebram frases', () => {
  const r = analyzeText('O Sr. Silva chegou cedo hoje. O Dr. Souza saiu tarde ontem.');
  assert.equal(r.sentences, 2);
});
