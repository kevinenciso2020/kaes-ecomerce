import { body } from 'express-validator'

// NO usar .normalizeEmail() de express-validator: en Gmail quita los puntos
// (juan.perez@gmail.com → juanperez@gmail.com) y el usuario deja de coincidir
// con lo guardado. Sólo se normaliza a minúsculas y sin espacios.
export const normalizeEmailLower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v)

const strongPassword = (field) =>
  body(field)
    .isString().withMessage('La contraseña es requerida')
    .isLength({ min: 8, max: 72 }).withMessage('La contraseña debe tener entre 8 y 72 caracteres')
    .matches(/[A-Za-z]/).withMessage('La contraseña debe tener al menos una letra')
    .matches(/\d/).withMessage('La contraseña debe tener al menos un número')

export const register = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .customSanitizer(normalizeEmailLower)
    .isLength({ max: 255 }).withMessage('El email no puede superar los 255 caracteres'),
  strongPassword('password'),
  body('acceptPrivacy')
    .custom((v) => v === true || v === 'true')
    .withMessage('Debes autorizar el tratamiento de tus datos personales para crear la cuenta'),
]

export const login = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .customSanitizer(normalizeEmailLower),
  body('password')
    .isString()
    .notEmpty().withMessage('La contraseña es requerida')
    .isLength({ max: 200 }).withMessage('Contraseña inválida')
]

export const resendVerification = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .customSanitizer(normalizeEmailLower),
]

export const forgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .customSanitizer(normalizeEmailLower),
]

export const resetPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('El email debe ser válido')
    .customSanitizer(normalizeEmailLower),
  body('code')
    .trim()
    .notEmpty().withMessage('El código es requerido')
    .matches(/^\d{6}$/).withMessage('El código debe tener 6 dígitos'),
  strongPassword('password'),
  body('confirmPassword')
    .trim()
    .notEmpty().withMessage('Confirma tu contraseña'),
]