import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

export const requestContext = {
  run(store, fn) {
    return storage.run(store, fn)
  },
  get() {
    return storage.getStore()
  },
  getReqId() {
    return storage.getStore()?.reqId
  },
}

export default requestContext
