# IVA automático en precios de producto

Fecha: 2026-10-09 · Estado: pendiente de revisión

## Objetivo
El admin escribe el precio **sin IVA** al crear o editar un producto; la tienda muestra y cobra el **precio final con IVA**. La tasa de IVA vive en un solo lugar, la cambia el SUPER_ADMIN, y un job diario avisa si la fuente oficial indica otra tasa (nunca la aplica solo).

## Decisiones ya acordadas
- `Product.price` sigue siendo el **precio final con IVA**. Carrito, cupones, descuentos, pedidos y pagos no cambian.
- Los productos existentes **conservan su precio final**; su `basePrice` se calcula hacia atrás.
- Tasa configurable + alerta (no actualización automática). Si la fuente falla, no se toca nada.
- Tasa general 19 %. Ejemplo: base $20.000 → final $23.800 (el ejemplo de $23.000 equivalía a 15 %).

## Modelo de datos (migración obligatoria, CI revisa drift)
- `Product.basePrice Decimal(10,2)` (sin IVA) y `Product.taxRate Decimal(5,2) @default(19)`.
- `ProductVariant.basePrice Decimal(10,2)?` (sólo si la variante tiene precio propio; usa la `taxRate` del producto).
- Tabla `TaxSetting` (una fila): `rate Decimal(5,2)` vigente, `updatedAt`, `updatedById`, `lastCheckAt`, `lastCheckRate`, `lastCheckSource`, `pendingRate?`.
- Migración de datos: `basePrice = round(price / 1.19, 2)`, `taxRate = 19`; mismo cálculo para variantes con precio. `price` no se modifica.

## Cálculo (`services/tax.service.js`, función pura)
`finalPrice(base, rate) = Math.round(base * (1 + rate/100))` a peso entero. `basePriceFromFinal(final, rate)` para la migración. Una sola implementación, usada por el backend; el formulario sólo muestra una vista previa con la misma fórmula.

## Backend
- `admin-products.service.js` crea/edita con `basePrice` (entrada) y guarda `price = finalPrice(basePrice, taxRate)`. El validator acepta `basePrice` (mínimo $100) y ya no `price`. Variantes igual.
- Si `taxRate` del producto es 0 (exento), `price = basePrice`.
- `GET/PUT /admin/tax` (SUPER_ADMIN): leer la tasa y cambiarla. Al cambiarla, en una transacción se actualiza `TaxSetting` y se recalcula `price` de productos y variantes cuyo `taxRate` siga la tasa general; `OrderItem.price` no se toca (histórico). Se registra en el log (`tax.rate_changed`).
- `pricing.service.js` no cambia: sigue leyendo `product.price`.

## Revisión automática (`jobs/tax-check.js`, 1 vez al día, dentro de `maintenance.js`)
- Lee la fuente oficial (texto del Estatuto Tributario, art. 468, en el sitio de la DIAN) y extrae el porcentaje con un patrón estricto.
- Si el valor es válido y distinto de la tasa vigente: guarda `pendingRate`, avisa a Sentry y por correo, y el admin muestra un banner "La fuente oficial indica X %; tu tienda usa Y %. ¿Aplicar?". Aplicar es una acción manual del SUPER_ADMIN.
- Si la fuente falla, cambia de formato o devuelve un valor fuera de 0–30: sólo se registra el error. Nunca modifica precios.
- Se desactiva con `DISABLE_JOBS=true` y con timeout/reintento corto para no bloquear el job.

## Frontend
- `ProductFormModal.jsx`: campo "Precio sin IVA" + vista previa "IVA (19 %): $3.800 · Precio final: $23.800". Variantes con precio propio igual.
- Admin: pantalla/sección de IVA (sólo SUPER_ADMIN) con la tasa actual, última revisión y banner de cambio detectado. Endpoints nuevos en `src/lib/api.js`.
- Tienda: sin cambios (sigue mostrando `price`, "IVA incluido").

## Pruebas
- Unidad: `finalPrice`/`basePriceFromFinal` (redondeo, 0 %, 19 %), parser de la fuente (casos válidos, ruidosos y vacíos).
- Integración (Prisma mockeado): crear/editar producto y variante calcula `price`; `/admin/tax` exige SUPER_ADMIN; ADMIN recibe 403.
- `tests/db`: cambio de tasa recalcula productos y variantes en una transacción y no altera `OrderItem`; la migración conserva `price`.

## Fuera de alcance
Desglose de IVA en factura electrónica, impuesto al consumo, tasas por categoría o por país.

## Riesgos
- La fuente oficial no es una API: por eso sólo avisa, nunca aplica.
- Redondeo: el precio final es siempre entero en pesos; el round-trip base↔final puede variar en centavos de `basePrice`, nunca en `price`.
