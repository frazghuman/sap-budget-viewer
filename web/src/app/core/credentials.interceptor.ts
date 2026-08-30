import { HttpInterceptorFn } from '@angular/common/http';

/** The session rides on an httpOnly cookie, so every call must send it. */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
