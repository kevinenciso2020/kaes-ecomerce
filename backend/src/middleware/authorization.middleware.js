import jwt from 'jsonwebtoken'

const PERMISSIONS = {
  USER_CREATE_ADMIN: 'user:create_admin',
  USER_DELETE_ADMIN: 'user:delete_admin',
  USER_VIEW_ALL: 'user:view_all',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',
  PRODUCT_VIEW: 'product:view',
  ORDER_VIEW_ALL: 'order:view_all',
  ORDER_UPDATE: 'order:update',
  ORDER_VIEW: 'order:view',
  DISCOUNT_CREATE: 'discount:create',
  DISCOUNT_VIEW: 'discount:view',
  COUPON_CREATE: 'coupon:create',
  COUPON_VIEW: 'coupon:view',
  DASHBOARD_VIEW: 'dashboard:view',
}

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: [
    PERMISSIONS.USER_CREATE_ADMIN,
    PERMISSIONS.USER_DELETE_ADMIN,
    PERMISSIONS.USER_VIEW_ALL,
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.ORDER_VIEW_ALL,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.DISCOUNT_CREATE,
    PERMISSIONS.DISCOUNT_VIEW,
    PERMISSIONS.COUPON_CREATE,
    PERMISSIONS.COUPON_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
  ],
  ADMIN: [
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.ORDER_VIEW_ALL,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.DISCOUNT_CREATE,
    PERMISSIONS.DISCOUNT_VIEW,
    PERMISSIONS.COUPON_CREATE,
    PERMISSIONS.COUPON_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
  ],
  CUSTOMER: [],
}

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  CUSTOMER: 'CUSTOMER',
}

export const AUTHORIZATION = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
}

function getRoleLevel(role) {
  const levels = {
    CUSTOMER: 0,
    ADMIN: 1,
    SUPER_ADMIN: 2,
  }
  return levels[role] ?? -1
}

export const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      req.log?.warn({ reqId: req.id }, 'authz.unauthenticated')
      return res.status(401).json({ error: 'No autenticado' })
    }

    const userRole = req.user.role
    const userPermissions = ROLE_PERMISSIONS[userRole] || []

    const hasPermission = requiredPermissions.some(perm =>
      userPermissions.includes(perm)
    )

    if (!hasPermission) {
      req.log?.warn(
        { reqId: req.id, userId: req.user.id, userRole, requiredPermissions },
        'authz.permission_denied'
      )
      return res.status(403).json({
        error: 'Sin permisos suficientes',
        required: requiredPermissions,
        userRole,
      })
    }

    next()
  }
}

export const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      req.log?.warn({ reqId: req.id }, 'authz.unauthenticated')
      return res.status(401).json({ error: 'No autenticado' })
    }

    const userRole = req.user.role
    const userLevel = getRoleLevel(userRole)

    const hasAccess = allowedRoles.some(role => {
      const requiredLevel = getRoleLevel(role)
      return userLevel >= requiredLevel
    })

    if (!hasAccess) {
      req.log?.warn(
        { reqId: req.id, userId: req.user.id, userRole, allowedRoles },
        'authz.role_denied'
      )
      return res.status(403).json({
        error: 'Rol insuficiente',
        required: allowedRoles,
        current: userRole,
      })
    }

    next()
  }
}

export const canManageAdmins = (req, res, next) => {
  if (!req.user || req.user.role !== ROLES.SUPER_ADMIN) {
    req.log?.warn(
      { reqId: req.id, userId: req.user?.id, role: req.user?.role },
      'authz.super_admin_required'
    )
    return res.status(403).json({ error: 'Solo SUPER_ADMIN puede gestionar administradores' })
  }
  next()
}

export { PERMISSIONS, ROLE_PERMISSIONS }