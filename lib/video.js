import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { scanFile } from './scan.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const execFileAsync = promisify(execFile);

const MP4_VIDEO_COPY = new Set(['h264', 'hevc', 'av1', 'mpeg4']);
const MP4_AUDIO_COPY = new Set(['aac', 'mp3', 'alac', 'ac3', 'eac3']);
// Structural tags that the muxer always rewrites; not worth reporting.
const BORING_TAGS = new Set(['major_brand', 'minor_version', 'compatible_brands', 'handler_name', 'vendor_id', 'language']);

export async function checkFfmpeg() {
  await execFileAsync(FFMPEG, ['-version']);
  await execFileAsync(FFPROBE, ['-version']);
}

async function probe(file) {
  const { stdout } = await execFileAsync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt:stream_tags:format=duration:format_tags', '-of', 'json', file],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const info = JSON.parse(stdout);
  return { ...info, duration: Number(info.format?.duration) || 0 };
}

function runFfmpeg(args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-y', ...args]);
    let stderr = '';
    let pending = '';

    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match && duration > 0) onProgress(Math.min(0.99, Number(match[1]) / 1e6 / duration));
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg falhou: ${stderr.trim().split('\n').slice(-3).join(' ') || `código ${code}`}`));
    });
  });
}

export async function convertMovToMp4(input, output, onProgress) {
  const info = await probe(input);
  const video = info.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('Nenhuma faixa de vídeo encontrada no arquivo.');
  const audio = info.streams.filter((s) => s.codec_type === 'audio');

  const copyVideo = MP4_VIDEO_COPY.has(video.codec_name);
  const copyAudio = audio.every((a) => MP4_AUDIO_COPY.has(a.codec_name));
  const highBitDepth = /1[02](le|be)$/.test(video.pix_fmt ?? '');

  let videoArgs;
  let encoder = null;
  if (copyVideo) {
    videoArgs = ['-c:v', 'copy', ...(video.codec_name === 'hevc' ? ['-tag:v', 'hvc1'] : [])];
  } else if (highBitDepth) {
    // 10/12-bit sources (ProRes, HDR) keep their bit depth with HEVC.
    videoArgs = ['-c:v', 'libx265', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'];
    encoder = 'HEVC 10-bit, CRF 14';
  } else {
    videoArgs = ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p'];
    encoder = 'H.264, CRF 16';
  }
  const audioArgs = copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];

  await runFfmpeg(
    ['-i', input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs, ...audioArgs, '-map_metadata', '0', '-movflags', '+faststart', output],
    info.duration,
    onProgress,
  );

  return {
    mode: copyVideo && copyAudio ? 'remux' : 'reencode',
    videoCodec: video.codec_name,
    audioCodecs: [...new Set(audio.map((a) => a.codec_name))],
    videoReencoded: !copyVideo,
    audioReencoded: !copyAudio,
    encoder,
  };
}

export async function cleanVideo(input, output, onProgress) {
  const [info, hintsBefore] = await Promise.all([probe(input), scanFile(input)]);

  const tagSources = [info.format?.tags, ...info.streams.map((s) => s.tags)];
  const removed = new Set();
  for (const tags of tagSources) {
    for (const key of Object.keys(tags ?? {})) {
      if (!BORING_TAGS.has(key)) removed.add(key);
    }
  }

  const isIsoMedia = ['.mp4', '.mov', '.m4v'].includes(path.extname(output).toLowerCase());
  await runFfmpeg(
    [
      '-i', input,
      '-map', '0:V', '-map', '0:a?',
      '-c', 'copy',
      '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
      '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      ...(isIsoMedia ? ['-movflags', '+faststart'] : []),
      output,
    ],
    info.duration,
    onProgress,
  );

  return { removed: [...removed], hintsBefore, hintsAfter: await scanFile(output) };
}
