import type { AppConfig } from "../types/config";

/** 托盘凹槽底面 Z (mm)，与 Tray_Base 坐标系一致（底面 Z=0） */
export function trayRecessFloorZMm(config: AppConfig): number {
  return config.tray.totalThicknessMm - config.tray.recessDepthMm;
}

/**
 * 预览/装配：将 Terrain_Main 平移至托盘凹槽内。
 * 地形网格底面在 Z = -baseSolidThicknessMm，平移后底面落在凹槽底面。
 */
export function computeTerrainAssemblyOffsetZMm(config: AppConfig): number {
  const text = config.terrain.text;
  const undersideRelief = text?.enabled && text.placement !== 'front' && text.style === 'raised' && (text.title.trim() || text.subtitle.trim()) ? text.heightMm : 0;
  const logo = config.terrain.logo;
  const logoRelief = logo?.enabled && logo.asset && logo.placement !== 'front' && logo.style === 'raised' ? logo.heightMm : 0;
  return (config.tray.enabled ? trayRecessFloorZMm(config) : 0) + config.terrain.baseSolidThicknessMm + Math.max(undersideRelief, logoRelief);
}
