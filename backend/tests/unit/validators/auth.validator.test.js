import { describe, it, expect } from 'vitest'
import { register, login, forgotPassword } from '../../../src/validators/auth.validator.js'
import { validate } from '../../../src/middleware/validate.js'

const run = async (validators, body) => {
  const req = { body }
  const errors = []
  for (const v of validators) {
    await v.run(req)
  }
  const { validationResult } = await import('express-validator')
  return validationResult(req).array().map(e => ({ field: e.path, message: e.msg }))
}

describe('auth validators — register', () => {
  it('passes with a valid payload', async () => {
    const errs = await run(register, {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'secret123',
      acceptPrivacy: true,
    })
    expect(errs).toEqual([])
  })

  it('requires Habeas Data authorization', async () => {
    const errs = await run(register, {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'secret123',
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'acceptPrivacy' })]),
    )
  })

  it('rejects passwords without a number', async () => {
    const errs = await run(register, {
      name: 'Ada', email: 'ada@example.com', password: 'soloLetras', acceptPrivacy: true,
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password', message: expect.stringMatching(/número/) })]),
    )
  })

  it('rejects empty name', async () => {
    const errs = await run(register, {
      name: '',
      email: 'ada@example.com',
      password: 'secret123',
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name', message: 'El nombre es requerido' })]),
    )
  })

  it('rejects short name', async () => {
    const errs = await run(register, {
      name: 'A',
      email: 'ada@example.com',
      password: 'secret123',
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/entre 2 y 100/) })]),
    )
  })

  it('rejects invalid email', async () => {
    const errs = await run(register, {
      name: 'Ada',
      email: 'not-an-email',
      password: 'secret123',
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email', message: 'El email debe ser válido' })]),
    )
  })

  it('rejects short password', async () => {
    const errs = await run(register, {
      name: 'Ada',
      email: 'ada@example.com',
      password: '123',
    })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password', message: expect.stringMatching(/entre 8 y 72/) })]),
    )
  })
})

describe('auth validators — login', () => {
  it('passes with valid email and password', async () => {
    const errs = await run(login, { email: 'ada@example.com', password: 'whatever' })
    expect(errs).toEqual([])
  })

  it('rejects missing password', async () => {
    const errs = await run(login, { email: 'ada@example.com' })
    expect(errs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    )
  })
})

describe('auth validators — email normalization', () => {
  it('lowercases emails but keeps Gmail dots (no normalizeEmail)', async () => {
    const req = { body: { email: '  Juan.Perez@Gmail.com ' } }
    for (const v of forgotPassword) await v.run(req)
    expect(req.body.email).toBe('juan.perez@gmail.com')
  })
})
