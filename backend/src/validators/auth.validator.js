import { body } from 'express-validator'

export const register = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .escape(),
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('El email no puede superar los 255 caracteres'),
  body('password')
    .trim()
    .notEmpty().withMessage('La contraseña es requerida')
    .isLength({ min: 6, max: 50 }).withMessage('La contraseña debe tener entre 6 y 50 caracteres')
]

export const login = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .normalizeEmail(),
  body('password')
    .trim()
    .notEmpty().withMessage('La contraseña es requerida')
]

export const refresh = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('El refresh token es requerido')
]

export const logout = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('El refresh token es requerido')
]

export const resendVerification = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .normalizeEmail(),
]

export const forgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .normalizeEmail(),
]

export const resetPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .normalizeEmail(),
  body('code')
    .trim()
    .notEmpty().withMessage('El código es requerido')
    .matches(/^\d{6}$/).withMessage('El código debe tener 6 dígitos'),
  body('password')
    .trim()
    .notEmpty().withMessage('La contraseña es requerida')
    .isLength({ min: 6, max: 50 }).withMessage('La contraseña debe tener entre 6 y 50 caracteres'),
  body('confirmPassword')
    .trim()
    .notEmpty().withMessage('Confirma tu contraseña'),
]