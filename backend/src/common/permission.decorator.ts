import { SetMetadata } from '@nestjs/common';
import type { Action } from '../features';

export const PERMISSION_KEY = 'sbc:required-permission';

export interface RequiredPermission {
  featureKey: string;
  action: Action;
}

/**
 * Declares the CAAS feature/action pair a route requires,
 * e.g. `@RequirePermission('budget', 'export')`.
 */
export const RequirePermission = (featureKey: string, action: Action) =>
  SetMetadata<string, RequiredPermission>(PERMISSION_KEY, {
    featureKey,
    action,
  });
