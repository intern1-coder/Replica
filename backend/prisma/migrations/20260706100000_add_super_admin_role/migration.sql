-- Add SUPER_ADMIN role for developer-level access above client ADMIN.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
