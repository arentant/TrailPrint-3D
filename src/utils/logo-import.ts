import { traceLogoPixels, type LogoTraceMode } from '@shared/utils/logo-trace';
import type { ModelLogoAsset } from '@shared/types/config';

function prepareSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror')) throw new Error('Choose a valid SVG logo.');
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'clipPath', 'mask', 'use', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'style', 'title', 'desc']);
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!allowed.has(element.localName)) throw new Error('Use an SVG with outlined shapes. Convert text to paths and remove embedded images, scripts or filters.');
    const css = [element.getAttribute('style') ?? '', element.localName === 'style' ? element.textContent ?? '' : ''].join(' ');
    if (/[\\@]/.test(css) || [...css.matchAll(/url\(([^)]*)\)/gi)].some(match => !match[1]!.trim().replace(/^['"]|['"]$/g, '').startsWith('#'))) throw new Error('The SVG must be self-contained, with no external styles, fonts or images.');
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) || (attribute.localName === 'href' && !attribute.value.startsWith('#')) || /(?:https?:|data:|file:|javascript:)/i.test(attribute.value) && attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) throw new Error('The SVG must contain only local, static artwork.');
    }
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) {
    const scale = 512 / Math.max(viewBox[2]!, viewBox[3]!);
    root.setAttribute('width', String(Math.max(1, Math.round(viewBox[2]! * scale))));
    root.setAttribute('height', String(Math.max(1, Math.round(viewBox[3]! * scale))));
  }
  return new XMLSerializer().serializeToString(root);
}

export async function importModelLogo(file: File, mode: LogoTraceMode): Promise<ModelLogoAsset> {
  const svg = /\.svg$/i.test(file.name), png = /\.png$/i.test(file.name);
  if (!svg && !png) throw new Error('Choose an SVG or PNG logo.');
  if (file.size > (svg ? 2 : 5) * 1024 * 1024) throw new Error(`Choose a logo smaller than ${svg ? 2 : 5} MB.`);
  let blob: Blob;
  if (svg) {
    const source = prepareSvg(await file.text());
    const { traceSvgLogo } = await import('./logo-svg');
    const asset = await traceSvgLogo(source, file.name, mode);
    if (asset) return asset;
    blob = new Blob([source], { type: 'image/svg+xml' });
  }
  else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((value, i) => bytes[i] !== value) || bytes.length < 24) throw new Error('Choose a valid PNG logo.');
    const header = new DataView(bytes.buffer);
    if (header.getUint32(16) * header.getUint32(20) > 16_777_216) throw new Error('Choose a PNG with no more than 16 megapixels.');
    blob = new Blob([bytes], { type: 'image/png' });
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode().catch(() => { throw new Error('The logo image could not be opened. Try saving it again as SVG or PNG.'); });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth / image.naturalHeight > 50 || image.naturalHeight / image.naturalWidth > 50) throw new Error('Choose a logo with a usable width and height.');
    const scale = 512 / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Logo import is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return traceLogoPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, file.name, mode);
  } finally { URL.revokeObjectURL(url); }
}
