import { type Role, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { type Decimal } from '@/domain/money';

export type Action =
  | 'pr.create'
  | 'pr.approve'
  | 'po.manage'
  | 'po.approve'
  | 'receipt.create'
  | 'invoice.manage'
  | 'payable.request'
  | 'pv.manage'
  | 'pv.approve'
  | 'pv.pay'
  | 'closeShort.approve'
  | 'master.manage'
  | 'users.manage'
  | 'settings.manage'
  | 'export.view'
  | 'project.view';

export interface PolicyContext {
  projectId?: string | null;
  createdBy?: string;
  gross?: Decimal;
  poApprovalLimit?: Decimal;
}

const SITE_ROLES: Role[] = ['FOREMAN', 'ENGINEER', 'PM'];
const GLOBAL_PROJECT_VIEW_ROLES: Role[] = [
  'PURCHASING',
  'PURCHASING_HEAD',
  'FINANCE',
  'OWNER',
  'ADMIN',
];

function hasRole(u: SessionUser, roles: Role[]): boolean {
  return u.roles.some((r) => roles.includes(r));
}

function isProjectMember(u: SessionUser, projectId?: string | null): boolean {
  if (!projectId) return false;
  return u.projectIds.includes(projectId);
}

export function isSiteScopedOnly(u: SessionUser): boolean {
  return !hasRole(u, GLOBAL_PROJECT_VIEW_ROLES);
}

export function can(u: SessionUser, action: Action, ctx: PolicyContext = {}): boolean {
  switch (action) {
    case 'project.view': {
      if (hasRole(u, GLOBAL_PROJECT_VIEW_ROLES)) return true;
      if (ctx.projectId === null || ctx.projectId === undefined) return false;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'pr.create': {
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'pr.approve': {
      if (hasRole(u, ['OWNER'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'po.manage':
    case 'payable.request': {
      return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN']);
    }
    case 'po.approve': {
      if (hasRole(u, ['OWNER'])) return true;
      if (!hasRole(u, ['PURCHASING_HEAD'])) return false;
      if (ctx.createdBy && ctx.createdBy === u.id) return false;
      if (!ctx.gross || !ctx.poApprovalLimit) return false;
      return ctx.gross.lt(ctx.poApprovalLimit);
    }
    case 'receipt.create': {
      if (ctx.projectId === null) {
        return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'ADMIN', 'OWNER']);
      }
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'invoice.manage':
    case 'pv.manage': {
      return hasRole(u, ['FINANCE', 'OWNER', 'ADMIN']);
    }
    case 'pv.approve':
    case 'closeShort.approve': {
      return hasRole(u, ['OWNER']);
    }
    case 'pv.pay': {
      return hasRole(u, ['FINANCE', 'OWNER']);
    }
    case 'master.manage': {
      return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'ADMIN', 'OWNER']);
    }
    case 'users.manage': {
      return hasRole(u, ['ADMIN', 'OWNER']);
    }
    case 'settings.manage': {
      return hasRole(u, ['ADMIN', 'OWNER']);
    }
    case 'export.view': {
      return hasRole(u, ['FINANCE', 'OWNER', 'ADMIN']);
    }
    default:
      return false;
  }
}

export function assertCan(u: SessionUser, action: Action, ctx: PolicyContext = {}): void {
  if (!can(u, action, ctx)) {
    throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
  }
}
