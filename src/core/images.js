'use strict';
/** Recognise image files by their first bytes, never by name or content-type alone. */
function sniffImage(buf, { svg = false } = {}) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  if (svg) {
    const head = buf.toString('utf8', 0, Math.min(buf.length, 600)).trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head) || head.startsWith('<svg')) return 'svg';
  }
  return null;
}
/** An MP4/M4V/MOV container (but not a HEIC/AVIF picture, which uses the same box type). */
function sniffVideo(buf) {
  if (!buf || buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const brand = buf.toString('latin1', 8, 12);
  if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)) return null;
  return 'mp4';
}
module.exports = { sniffImage, sniffVideo };
