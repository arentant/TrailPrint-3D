export interface ModelColors {
  terrain: string;
  trail: string;
  tray: string;
}

export function createDefaultModelColors(workspace: 'mountain' | 'city' = 'mountain'): ModelColors {
  return {
    terrain: workspace === 'city' ? '#bfc8bd' : '#f3ead6',
    trail: '#e84335',
    tray: '#5c6670',
  };
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Older presets have no colors; invalid entries fall back per part. */
export function normalizeModelColors(value: unknown, workspace: 'mountain' | 'city' = 'mountain'): ModelColors {
  const colors = createDefaultModelColors(workspace);
  if (!value || typeof value !== 'object') return colors;
  for (const part of Object.keys(colors) as (keyof ModelColors)[]) {
    const hex = (value as Record<string, unknown>)[part];
    if (isHexColor(hex)) colors[part] = hex.toLowerCase();
  }
  return colors;
}
