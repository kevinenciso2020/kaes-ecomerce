import { describe, it, expect, vi } from 'vitest'
import { body, validationResult } from 'express-validator'
import { validate } from '../../src/middleware/validate.js'

const mockRes = () => {
  const res = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

const buildReq = (body = {}) => ({ body })

describe('validate', () => {
  it('returns 400 with formatted errors when validation fails', async () => {
    const validators = [body('email').isEmail().withMessage('email invalido')]
    const req = buildReq({ email: 'not-an-email' })
    const res = mockRes()
    const next = vi.fn()

    const mw = validate(validators)
    await mw(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      errors: [expect.objectContaining({ field: 'email', message: 'email invalido' })],
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() when all validators pass', async () => {
    const validators = [body('email').isEmail()]
    const req = buildReq({ email: 'ok@example.com' })
    const res = mockRes()
    const next = vi.fn()

    const mw = validate(validators)
    await mw(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('runs multiple validators sequentially', async () => {
    const validators = [
      body('name').notEmpty().withMessage('requerido'),
      body('email').isEmail().withMessage('email invalido'),
    ]
    const req = buildReq({ name: '', email: 'bad' })
    const res = mockRes()
    const next = vi.fn()

    const mw = validate(validators)
    await mw(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    const { errors } = res.json.mock.calls[0][0]
    expect(errors).toHaveLength(2)
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', message: 'requerido' }),
        expect.objectContaining({ field: 'email', message: 'email invalido' }),
      ]),
    )
  })
})