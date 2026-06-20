import { Role } from '@prisma/client';

// Augment Express's Request type so req.user is typed project-wide.
// Any middleware that sets req.user must conform to this shape.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: Role;
      };
    }
  }
}

export {};
