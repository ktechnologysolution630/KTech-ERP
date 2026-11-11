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
  | 'project.finance'
  | 'boq.manage'
  | 'project.manage'
  | 'project.delete'
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
  | 'advance.pay'
  | 'prv.create'
  | 'prv.verify'
  | 'prv.approve'
  | 'stock.items'
  | 'stock.move'
  | 'stock.approveAdjust'
  | 'asset.manage'
  | 'asset.inspect'
  | 'asset.delete'
  | 'prv.delete'
  | 'vendor.delete'
  | 'pr.delete'
  | 'item.delete'
  | 'po.delete'
  | 'vehicle.request'
  | 'vehicle.approve'
  | 'vehicle.track'
  | 'vehicle.manage';

export interface PolicyContext {
  projectId?: string | null;
  createdBy?: string;
  gross?: Decimal;
  poApprovalLimit?: Decimal;
}

const SITE_ROLES: Role[] = ['FOREMAN', 'ENGINEER', 'ARCHITECT', 'PROJECT_CLERK', 'PM'];
const GLOBAL_PROJECT_VIEW_ROLES: Role[] = [
  'PURCHASING',
  'PURCHASING_HEAD',
  'FINANCE',
  'GENERAL_MANAGER',
  'OWNER',
  'ADMIN',
];

export const ASSET_OFFICE_ROLES: Role[] = ['FINANCE', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'];
/** Who approves vehicle use and watches the fleet */
export const VEHICLE_OFFICE_ROLES: Role[] = ['GENERAL_MANAGER', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'];

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
    case 'project.finance': {
      // Income, payments and cost performance: management, office money roles and the project's PM
      if (hasRole(u, ['FINANCE', 'PURCHASING', 'PURCHASING_HEAD', 'GENERAL_MANAGER', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'pr.create': {
      if (hasRole(u, ['OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'pr.approve': {
      if (hasRole(u, ['OWNER', 'GENERAL_MANAGER'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'po.manage':
    case 'payable.request': {
      return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN']);
    }
    case 'po.approve': {
      if (hasRole(u, ['OWNER'])) return true;
      if (!hasRole(u, ['PURCHASING_HEAD', 'GENERAL_MANAGER'])) return false;
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
    case 'prv.create': {
      // Site staff raise claims for their projects; purchasing/finance/management for any
      if (hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'FINANCE', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'prv.verify': {
      if (hasRole(u, ['OWNER', 'GENERAL_MANAGER'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'prv.approve': {
      return hasRole(u, ['OWNER']);
    }
    case 'stock.items': {
      return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN']);
    }
    case 'stock.move': {
      // Purchasing and management handle every location (incl. the central store, projectId null);
      // site staff record receipts/issues/transfers only for projects they belong to
      if (hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'stock.approveAdjust': {
      return hasRole(u, ['PURCHASING_HEAD', 'GENERAL_MANAGER', 'OWNER', 'ADMIN']);
    }
    case 'advance.approve': {
      return hasRole(u, ['GENERAL_MANAGER', 'OWNER', 'ADMIN']);
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
      return hasRole(u, ['GENERAL_MANAGER', 'OWNER', 'ADMIN']);
    }
    case 'milestone.pay': {
      return hasRole(u, ['FINANCE', 'OWNER']);
    }
    case 'vo.manage':
    case 'milestone.manage':
    case 'project.manage': {
      if (hasRole(u, ['GENERAL_MANAGER', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, ['PM']) && isProjectMember(u, ctx.projectId);
    }
    case 'task.progress': {
      // Site staff report progress on tasks of their own projects
      if (hasRole(u, ['GENERAL_MANAGER', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'task.manage':
    case 'boq.manage': {
      if (hasRole(u, ['GENERAL_MANAGER', 'OWNER', 'ADMIN'])) return true;
      return hasRole(u, ['PM', 'ENGINEER', 'ARCHITECT']) && isProjectMember(u, ctx.projectId);
    }
    case 'asset.manage': {
      return hasRole(u, ASSET_OFFICE_ROLES);
    }
    case 'asset.inspect': {
      // Site staff check what is on their projects; the office checks everything, incl. what is held at the office
      if (hasRole(u, ASSET_OFFICE_ROLES)) return true;
      return hasRole(u, SITE_ROLES) && isProjectMember(u, ctx.projectId);
    }
    case 'project.delete':
    case 'asset.delete':
    case 'prv.delete':
    case 'pr.delete':
    case 'item.delete': {
      return hasRole(u, ['OWNER', 'ADMIN']);
    }
    case 'vendor.delete': {
      return hasRole(u, ['OWNER', 'ADMIN']);
    }
    case 'po.delete': {
      return hasRole(u, ['ADMIN']);
    }
    case 'master.manage': {
      return hasRole(u, ['PURCHASING', 'PURCHASING_HEAD', 'GENERAL_MANAGER', 'ADMIN', 'OWNER']);
    }
    case 'users.manage': {
      return hasRole(u, ['ADMIN']);
    }
    case 'settings.manage': {
      return hasRole(u, ['ADMIN', 'OWNER']);
    }
    case 'vehicle.request': {
      // Anyone signed in may ask for a vehicle
      return u.roles.length > 0;
    }
    case 'vehicle.approve':
    case 'vehicle.manage': {
      return hasRole(u, VEHICLE_OFFICE_ROLES);
    }
    case 'vehicle.track': {
      // The live map and every trip; finance sees them for the costs
      return hasRole(u, [...VEHICLE_OFFICE_ROLES, 'FINANCE']);
    }
    case 'export.view': {
      return hasRole(u, ['FINANCE', 'GENERAL_MANAGER', 'OWNER', 'ADMIN']);
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
