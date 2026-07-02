import { Role } from '@prisma/client';
import type { PermissionKey } from '../../lib/permissions';

// Augment Express's Request type so req.user is typed project-wide.
// Any middleware that sets req.user must conform to this shape.
declare global {
  namespace Express {
    interface Request {
      // Correlation id assigned by middleware/requestId.ts; present on every request.
      id?: string;
      user?: {
        id: string;
        email: string;
        name: string;
        role: Role;
        canAuthorizeJobs: boolean;
        // Resolved effective permissions (role preset + overrides).
        permissions: Record<PermissionKey, boolean>;
        can: (key: PermissionKey) => boolean;
      };
    }
  }
}

export {};
