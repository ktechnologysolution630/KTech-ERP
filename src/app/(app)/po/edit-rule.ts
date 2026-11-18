import { type PoStatus } from '@/db/schema';

/**
 * Where updatePo saves: a draft or sent-back PO is changed in place, an approved or ordered one as a
 * revision that is approved again. While it waits for review or approval it cannot be changed.
 */
export const PO_EDITABLE: readonly PoStatus[] = ['DRAFT', 'REJECTED', 'APPROVED', 'ORDERED'];
