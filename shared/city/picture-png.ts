import type { CityGenerateRequest, CityPictureImage } from '../types/city';
import { citySelectionCrop } from './selection-crop';
import { cityPictureLayout } from './printable-map';
import { CITY_PICTURE_PNG_PIXELS, validateCityPictureImage } from './picture-map';

export function cityPicturePngPlan(request: CityGenerateRequest) {
  const { width, height } = cityPictureLayout(citySelectionCrop(request), request.config.picture);
  const scale = CITY_PICTURE_PNG_PIXELS / Math.max(width, height);
  return { pixelWidth: Math.max(1, Math.round(width * scale)), pixelHeight: Math.max(1, Math.round(height * scale)) };
}

/** Validate the complete poster before including it in the download. */
export function cityPicturePngBytes(value: unknown, request: CityGenerateRequest): Uint8Array {
  const image = value as CityPictureImage | undefined;
  const plan = cityPicturePngPlan(request);
  if (!image || image.pixelWidth !== plan.pixelWidth || image.pixelHeight !== plan.pixelHeight) {
    throw new Error('The 4K PNG is missing or has the wrong dimensions. Generate the map picture again.');
  }
  validateCityPictureImage(image);
  return Uint8Array.from(atob(image.dataUrl.slice(22)), char => char.charCodeAt(0));
}
