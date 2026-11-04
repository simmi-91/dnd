import type { ApiError } from '@dnd/shared';
import type { FastifyReply } from 'fastify';

/** Faste feilkoder og norske meldinger. `error` er stabil, `message` kan vises til brukeren. */
export const ERRORS = {
  unauthorized: { status: 401, message: 'Du er ikke logget inn' },
  blocked: { status: 403, message: 'Kontoen er sperret' },
  csrf: { status: 403, message: 'Forespørselen mangler headeren X-Requested-With' },
  email_not_verified: { status: 403, message: 'E-postadressen til Google-kontoen er ikke bekreftet' },
  invalid_token: { status: 401, message: 'Kunne ikke bekrefte Google-innloggingen' },
  google_not_configured: { status: 503, message: 'Google-innlogging er ikke satt opp på serveren' },
  account_conflict: {
    status: 409,
    message: 'E-postadressen er allerede knyttet til en annen Google-konto',
  },
  invalid_request: { status: 400, message: 'Ugyldig forespørsel' },
  not_found: { status: 404, message: 'Fant ikke ressursen' },
  payload_too_large: { status: 413, message: 'Forespørselen er for stor' },
  unsupported_media_type: { status: 415, message: 'Ukjent innholdstype' },
  request_error: { status: 400, message: 'Forespørselen kunne ikke behandles' },
  server_error: { status: 500, message: 'Noe gikk galt på serveren' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;

export function errorBody(code: ErrorCode, message?: string): ApiError {
  return { error: code, message: message ?? ERRORS[code].message };
}

export function sendError(reply: FastifyReply, code: ErrorCode, message?: string): FastifyReply {
  return reply.code(ERRORS[code].status).send(errorBody(code, message));
}
