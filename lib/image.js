// Lossless metadata removal: the compressed pixel data is copied byte for byte,
// only metadata segments/chunks are dropped. No re-encoding happens.
import { scanBuffer } from './scan.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function cleanImage(buf) {
  const type = detectImageType(buf);
  const cleaners = { jpeg: cleanJpeg, png: cleanPng, webp: cleanWebp };
  if (!type) throw new Error('Imagem não reconhecida (aceita JPEG, PNG e WebP).');
  const { data, removed, ...extra } = cleaners[type](buf);
  return {
    data,
    removed: [...new Set(removed)],
    hintsBefore: scanBuffer(buf),
    hintsAfter: scanBuffer(data),
    ...extra,
  };
}

// ---------- JPEG ----------

function cleanJpeg(buf) {
  const parts = [buf.subarray(0, 2)];
  const removed = [];
  let orientation = 1;
  let pos = 2;

  while (pos < buf.length - 1) {
    if (buf[pos] !== 0xff) throw new Error('JPEG corrompido.');
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; }
    if (marker === 0xd9) { parts.push(buf.subarray(pos, pos + 2)); break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }

    const end = pos + 2 + buf.readUInt16BE(pos + 2);
    const segment = buf.subarray(pos, end);

    if (marker === 0xda) {
      // Start of scan: keep everything up to the end of the primary image.
      // Data appended after EOI (MPF secondary images) is discarded.
      parts.push(buf.subarray(pos, findJpegEnd(buf, end)));
      break;
    }

    const label = jpegMetadataLabel(marker, segment);
    if (label) {
      removed.push(label);
      if (label === 'EXIF') orientation = readExifOrientation(segment);
    } else {
      parts.push(segment);
    }
    pos = end;
  }

  // Keep the rotation so photos don't show up sideways once EXIF is gone.
  if (orientation > 1 && orientation <= 8) {
    const afterApp0 = parts[1]?.[1] === 0xe0 ? 2 : 1;
    parts.splice(afterApp0, 0, orientationOnlyExif(orientation));
  }

  return { data: Buffer.concat(parts), removed, orientationKept: orientation > 1 };
}

function jpegMetadataLabel(marker, segment) {
  const id = segment.toString('latin1', 4, Math.min(segment.length, 40));
  if (marker === 0xe0) return null; // JFIF
  if (marker === 0xe2 && id.startsWith('ICC_PROFILE')) return null; // color profile
  if (marker === 0xee && id.startsWith('Adobe')) return null; // needed for CMYK/YCCK decoding
  if (marker === 0xfe) return 'Comentário';
  if (marker < 0xe0 || marker > 0xef) return null;

  if (marker === 0xe1 && id.startsWith('Exif')) return 'EXIF';
  if (marker === 0xe1 && id.startsWith('http://ns.adobe.com/xap/1.0/')) return 'XMP';
  if (marker === 0xe1 && id.startsWith('http://ns.adobe.com/xmp/extension/')) return 'XMP estendido';
  if (marker === 0xe2 && id.startsWith('MPF')) return 'MPF (imagens secundárias)';
  if (marker === 0xeb) return 'C2PA / JUMBF';
  if (marker === 0xed) return 'IPTC / Photoshop';
  return `APP${marker - 0xe0}`;
}

function findJpegEnd(buf, pos) {
  while (pos < buf.length - 1) {
    if (buf[pos] !== 0xff) { pos += 1; continue; }
    const marker = buf[pos + 1];
    if (marker === 0x00 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === 0xd9) return pos + 2;
    pos += 2 + buf.readUInt16BE(pos + 2); // DHT/SOS between progressive scans
  }
  return buf.length;
}

function readExifOrientation(segment) {
  try {
    const tiff = 10;
    const littleEndian = segment.toString('latin1', tiff, tiff + 2) === 'II';
    const u16 = (o) => (littleEndian ? segment.readUInt16LE(o) : segment.readUInt16BE(o));
    const u32 = (o) => (littleEndian ? segment.readUInt32LE(o) : segment.readUInt32BE(o));
    const ifd = tiff + u32(tiff + 4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) return u16(entry + 8);
    }
  } catch {
    // Malformed EXIF: treat as unrotated.
  }
  return 1;
}

function orientationOnlyExif(orientation) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0x00, 0x00]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

// ---------- PNG ----------

const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT',
  'pHYs', 'bKGD', 'hIST', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLi',
]);

function cleanPng(buf) {
  const parts = [PNG_SIGNATURE];
  const removed = [];
  let pos = 8;

  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    const chunk = buf.subarray(pos, end);

    if (PNG_KEEP.has(type)) {
      parts.push(chunk);
    } else {
      removed.push(pngChunkLabel(type, chunk));
    }
    pos = end;
    if (type === 'IEND') break;
  }

  return { data: Buffer.concat(parts), removed };
}

function pngChunkLabel(type, chunk) {
  if (type === 'iTXt' && chunk.toString('latin1', 8, 25) === 'XML:com.adobe.xmp') return 'XMP';
  if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') return 'Texto embutido (prompt/parâmetros)';
  if (type === 'eXIf') return 'EXIF';
  if (type === 'caBX') return 'C2PA / JUMBF';
  if (type === 'tIME') return 'Data de modificação';
  return `Bloco ${type}`;
}

// ---------- WebP ----------

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const WEBP_LABELS = { EXIF: 'EXIF', 'XMP ': 'XMP', C2PA: 'C2PA / JUMBF' };

function cleanWebp(buf) {
  const chunks = [];
  const removed = [];
  let pos = 12;

  while (pos + 8 <= buf.length) {
    const type = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = Math.min(buf.length, pos + 8 + size + (size & 1));
    let chunk = buf.subarray(pos, end);

    if (WEBP_KEEP.has(type)) {
      if (type === 'VP8X') {
        chunk = Buffer.from(chunk);
        chunk[8] &= ~(0x08 | 0x04); // clear EXIF and XMP flags
      }
      chunks.push(chunk);
    } else {
      removed.push(WEBP_LABELS[type] ?? `Bloco ${type.trim()}`);
    }
    pos = end;
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { data: Buffer.concat([header, body]), removed };
}
