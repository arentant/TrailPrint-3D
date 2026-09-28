export const authEnv: Record<'AUTH_URL' | 'AUTH_SECRET' | 'AUTH_GOOGLE_ID' | 'AUTH_GOOGLE_SECRET' | 'ALLOWED_EMAILS', string>
export function sessionCookie(options?: { email?: string; secret?: string; maxAge?: number; verified?: boolean; origin?: string }): Promise<{ name: string; value: string }>
