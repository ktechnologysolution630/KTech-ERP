import { type PrStatus, type SessionUser } from '@/db/schema';

/**
 * A requisition can be changed while it is a draft or was sent back, by whoever asked for it, the
 * owner or an admin: the rule updatePr enforces, so the edit button only shows where saving works.
 */
export function canEditPr(actor: SessionUser, pr: { status: PrStatus; requestedBy: string }): boolean {
  return (
    (pr.status === 'DRAFT' || pr.status === 'REJECTED') &&
    (pr.requestedBy === actor.id || actor.roles.includes('OWNER') || actor.roles.includes('ADMIN'))
  );
}
