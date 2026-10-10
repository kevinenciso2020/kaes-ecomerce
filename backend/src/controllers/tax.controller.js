import * as Tax from '../services/tax-settings.service.js'

export const getTax = async (req, res, next) => {
  try {
    const setting = await Tax.getTaxSetting()
    // Los ADMIN sólo necesitan la tasa (vista previa del precio); el detalle es del SUPER_ADMIN.
    if (req.user.role !== 'SUPER_ADMIN') return res.json({ rate: setting.rate })
    res.json(setting)
  } catch (err) { next(err) }
}

export const updateRate = async (req, res, next) => {
  try {
    res.json(await Tax.setRate(req.body.rate, req.user.id))
  } catch (err) { next(err) }
}

export const applyPending = async (req, res, next) => {
  try {
    res.json(await Tax.applyPendingRate(req.user.id))
  } catch (err) { next(err) }
}
