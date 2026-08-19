import crypto from 'node:crypto'
import { logger } from '../config/logger.js'
import { requestContext } from '../utils/asyncContext.js'

const HEADER_NAME = 'x-request-id'

const isValidReqId = (id) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 200 &&
  /^[A-Za-z0-9_\-]+$/.test(id)

export const requestContextMiddleware = (req, res, next) => {
  const incoming = req.headers[HEADER_NAME]
  const reqId = isValidReqId(incoming) ? incoming : crypto.randomUUID()

  req.id = reqId
  res.setHeader('x-request-id', reqId)

  req.log = logger.child({ reqId })

  requestContext.run({ reqId, log: req.log }, () => next())
}

export default requestContextMiddleware
