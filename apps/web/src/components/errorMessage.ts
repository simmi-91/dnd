import { isApiRequestError } from '../api/client';

export function errorMessage(err: unknown): string {
  if (isApiRequestError(err)) return err.message;
  return 'Noe uventet skjedde. Prøv igjen.';
}
