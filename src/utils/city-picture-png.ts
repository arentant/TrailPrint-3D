import type { CityGenerateRequest, CityPictureMap, CityPictureImage } from '@shared/types/city';
import { cityPicturePngPlan } from '@shared/city/picture-png';
import { MAX_PICTURE_BYTES, validateCityPictureImage } from '@shared/city/picture-map';
import { citySelectionCrop } from '@shared/city/selection-crop';
import { renderPrintableCityMap } from '@shared/city/printable-map';

/** Rasterize the same complete SVG used for print, at 4096px on its longest side. */
export async function renderCityPicturePng(request: CityGenerateRequest, map: CityPictureMap): Promise<CityPictureImage> {
  const plan = cityPicturePngPlan(request);
  const source = renderPrintableCityMap(request, citySelectionCrop(request), map);
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  svg.documentElement.setAttribute('width', String(plan.pixelWidth));
  svg.documentElement.setAttribute('height', String(plan.pixelHeight));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device cannot render the 4K PNG. Try again.');
    context.drawImage(image, 0, 0, plan.pixelWidth, plan.pixelHeight);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the 4K PNG. Try again.')), 'image/png'));
    if (blob.size > MAX_PICTURE_BYTES) throw new Error('The 4K PNG exceeds 32 MB. Choose a smaller map area.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not prepare the 4K PNG. Try again.'));
      reader.readAsDataURL(blob);
    });
    const result = { ...plan, dataUrl };
    validateCityPictureImage(result);
    return result;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
