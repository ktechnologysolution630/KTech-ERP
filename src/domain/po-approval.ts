import { type Decimal } from './money';

export function requiredPoApprover(
  gross: Decimal,
  limit: Decimal,
): 'PURCHASING_HEAD' | 'OWNER' {
  return gross.lt(limit) ? 'PURCHASING_HEAD' : 'OWNER';
}
