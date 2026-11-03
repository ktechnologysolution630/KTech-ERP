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
  | 'project.view'
  | 'boq.manage'
  | 'project.manage'
  | 'task.manage'
  | 'task.progress'
  | 'milestone.manage'
  | 'milestone.approve'
  | 'milestone.pay'
  | 'boqOverrun.approve'
  | 'vo.manage'
  | 'vo.approve'
  | 'ar.manage'
  | 'advance.request'
  | 'advance.approve'
  | 'advance.pay';

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
    case 'advance.request': {
      // Any active staff member may ask for a cash advance
      return true;
    }
    case 'advance.approve': {
      return hasRole(u, ['OWNER', 'ADMIN']);
    }
    case 'advance.pay': {
      return hasRole(u, ['FINANCE', 'OWNER']);
    }
    case 'ar.manage':
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
    case 'vo.approve':
    case 'boqOverrun.approve': {
      // Buying beyond the agreed BOQ is a commercial decision for the owner
      return hasRole(u, ['OWNER']);
    }
    case 'milestone.approve': {
      return hasRole(u, ['OWNER', 'ADMIN']);
    }
    case 'milestone.pay': {
      return hasRole(u, ['FINANCE', 'OWNER']);
    }
    case 'vo.manage':
    case 'milestone.manage':
    case 'project.manage': {
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'task.progress': {
      // Site staff report progress on tasks of their own projects
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'task.manage':
    case 'boq.manage': {
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, ['PM', 'ENGINEER']) && isProjectMember(u, ctx.projectId);
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
