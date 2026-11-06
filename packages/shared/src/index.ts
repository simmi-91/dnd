import { z } from 'zod';

// API-kontrakten mellom web og server. Endringer her må gjøres i begge.

export const userSchema = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

/** Feilsvar fra API-et. `error` er en fast kode, `message` er norsk tekst som kan vises. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** GET /api/auth/config */
export const authConfigSchema = z.object({
  googleClientId: z.string().nullable(),
  /** true når GET /api/auth/dev-login er tilgjengelig (ikke i produksjon). */
  devLogin: z.boolean(),
});
export type AuthConfig = z.infer<typeof authConfigSchema>;

/** POST /api/auth/google (body) */
export const googleLoginRequestSchema = z.object({
  credential: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof googleLoginRequestSchema>;

/** Svar fra POST /api/auth/google og GET /api/me */
export const meResponseSchema = z.object({
  user: userSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** GET /api/health */
export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Header som kreves på alle skrivende kall (POST, PUT, PATCH, DELETE). */
export const REQUESTED_WITH_HEADER = 'X-Requested-With';
export const REQUESTED_WITH_VALUE = 'dnd';

/** Navnet på sesjonsinformasjonskapselen. */
export const SESSION_COOKIE = 'dd_session';

export * from './games.ts';
export * from './combat.ts';
export * from './mentions.ts';
export * from './campaign.ts';
