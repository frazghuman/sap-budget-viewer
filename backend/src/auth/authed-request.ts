import type { SessionUser } from './session.types';

/**
 * Express request enriched by {@link SessionAuthGuard}.
 * `sessionUser` is used rather than `user` so the shape never collides with
 * the `Express.User` declaration merged in by passport's typings.
 */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  caasToken?: string;
  sessionUser?: SessionUser;
}
