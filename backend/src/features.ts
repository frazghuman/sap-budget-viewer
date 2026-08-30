/**
 * Canonical feature catalog for SUI Budget Control.
 * Keys MUST match CAAS One seed (`seed-budget.ts`).
 */
export type Action =
  'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';

export interface FeatureDef {
  key: string;
  name: string;
  module: string;
  actions: Action[];
}

export const FEATURES: FeatureDef[] = [
  {
    key: 'budget',
    name: 'Budget Data',
    module: 'Budget',
    actions: ['view', 'create', 'delete', 'export'],
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
