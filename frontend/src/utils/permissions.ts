/** Apply view ↔ action dependency rules in the permission matrix editor. */
export function applyPermissionToggle(
  prev: Record<string, boolean>,
  key: string,
  value: boolean,
  groups: { resource: string; actions: string[] }[]
): Record<string, boolean> {
  const next = { ...prev, [key]: value };
  const [resource, action] = key.split(':');
  const group = groups.find((g) => g.resource === resource);
  if (!group || !group.actions.includes('view')) return next;

  if (action === 'view' && !value) {
    for (const a of group.actions) {
      if (a !== 'view') next[`${resource}:${a}`] = false;
    }
  } else if (action !== 'view' && value) {
    next[`${resource}:view`] = true;
  }

  return next;
}
