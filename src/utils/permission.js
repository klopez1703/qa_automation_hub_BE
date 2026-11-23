function getRoleName(user) {
  if (!user) return "";
  return typeof user.role === "string" ? user.role : user.role?.name || "";
}

function getEffectivePermissions(user) {
  if (!user) return [];
  if (getRoleName(user).toUpperCase() === "ADMIN") return ["*"];

  const now = new Date();
  const rolePermissions = user.roleObj?.permissions || user.role?.permissions || [];
  const roleActions = rolePermissions.map((p) => p.action);

  const directActions = (user.extraPermissions || [])
    .filter((up) => !up.expiresAt || new Date(up.expiresAt) > now)
    .map((up) => up.permission.action);

  return [...new Set([...roleActions, ...directActions])];
}

function hasPermission(user, requiredAction) {
  const perms = getEffectivePermissions(user);
  return perms.includes("*") || perms.includes(requiredAction);
}

function hasProjectAccess(user, projectId) {
  if (!user) return false;
  if (getRoleName(user).toUpperCase() === "ADMIN") return true;
  return (user.projects || []).some((p) => p.id === Number(projectId));
}

module.exports = {
  getEffectivePermissions,
  hasPermission,
  hasProjectAccess,
};