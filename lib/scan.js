import fs from 'node:fs/promises';

// Strings that reveal AI provenance inside metadata. Case-sensitive on purpose:
// it keeps random matches inside compressed pixel/audio data negligible.
const MARKERS = [
  ['c2pa', 'Credenciais de conteúdo C2PA'],
  ['jumb', 'Contêiner JUMBF (C2PA)'],
  ['trainedAlgorithmicMedia', 'IPTC: mídia gerada por IA'],
  ['compositeSynthetic', 'IPTC: composição sintética'],
  ['DigitalSourceType', 'Campo IPTC DigitalSourceType'],
  ['AI generated', 'Texto "AI generated"'],
  ['AI-generated', 'Texto "AI-generated"'],
  ['Made with AI', 'Texto "Made with AI"'],
  ['OpenAI', 'OpenAI'],
  ['DALL', 'DALL·E'],
  ['Sora', 'Sora'],
  ['Midjourney', 'Midjourney'],
  ['Firefly', 'Adobe Firefly'],
  ['Gemini', 'Google Gemini'],
  ['Imagen', 'Google Imagen'],
  ['SynthID', 'Google SynthID'],
  ['Stable Diffusion', 'Stable Diffusion'],
  ['CFG scale', 'Parâmetros de geração (Stable Diffusion)'],
  ['class_type', 'Fluxo do ComfyUI'],
  ['Runway', 'Runway'],
  ['Kling', 'Kling AI'],
  ['Meta AI', 'Meta AI'],
  ['Grok', 'Grok'],
  ['Higgsfield', 'Higgsfield'],
  ['ChatGPT', 'ChatGPT'],
  ['Copilot', 'Microsoft Copilot'],
  ['Claude', 'Claude'],
].map(([text, label]) => [Buffer.from(text, 'utf8'), label]);

const EDGE_BYTES = 8 * 1024 * 1024;

export function scanBuffer(buf) {
  const found = new Set();
  for (const [needle, label] of MARKERS) {
    if (buf.indexOf(needle) !== -1) found.add(label);
  }
  return [...found];
}

// Container metadata lives at the start or end of a video file, so only the
// edges are scanned instead of reading gigabytes of media data.
export async function scanFile(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= EDGE_BYTES * 2) {
      return scanBuffer(await handle.readFile());
    }
    const head = Buffer.alloc(EDGE_BYTES);
    const tail = Buffer.alloc(EDGE_BYTES);
    await handle.read(head, 0, EDGE_BYTES, 0);
    await handle.read(tail, 0, EDGE_BYTES, size - EDGE_BYTES);
    return [...new Set([...scanBuffer(head), ...scanBuffer(tail)])];
  } finally {
    await handle.close();
  }
}
