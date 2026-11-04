import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Verifiserer et Google ID-token. Kaster hvis tokenet er ugyldig. Byttes ut i tester. */
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity>;

/** Faste kategorier for avviste tokens. Bare disse logges, aldri feilmeldingen eller tokenet. */
export type GoogleTokenFailure =
  | 'expired'
  | 'wrong_audience'
  | 'wrong_issuer'
  | 'bad_signature'
  | 'malformed'
  | 'missing_claims'
  | 'invalid_token';

export class GoogleTokenError extends Error {
  override name = 'GoogleTokenError';
  constructor(public readonly category: GoogleTokenFailure) {
    super(`Google-tokenet ble avvist (${category})`);
  }
}

/**
 * Gjør en feil fra google-auth-library om til en fast kategori. Meldingen kan inneholde
 * deler av tokenet, så den brukes bare til å velge kategori og kastes så.
 */
export function classifyGoogleError(error: unknown): GoogleTokenFailure {
  if (error instanceof GoogleTokenError) return error.category;
  const message = error instanceof Error ? error.message : '';
  if (/too late|expired/i.test(message)) return 'expired';
  if (/audience/i.test(message)) return 'wrong_audience';
  if (/issuer/i.test(message)) return 'wrong_issuer';
  if (/signature|certificate|pem|no pem found/i.test(message)) return 'bad_signature';
  if (/segments|parse|envelope|json|token used too early/i.test(message)) return 'malformed';
  return 'invalid_token';
}

export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client({ clientId });
  return async (credential) => {
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch (error) {
      throw new GoogleTokenError(classifyGoogleError(error));
    }
    if (!payload?.sub || !payload.email) throw new GoogleTokenError('missing_claims');
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  };
}
