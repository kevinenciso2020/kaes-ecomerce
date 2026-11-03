# Medios de pago: qué cuentas crear y dónde va cada llave

La tienda ya trae programados cuatro medios de pago. Cada uno **se activa solo** cuando pones sus
variables en Railway (servicio del backend → **Variables**). Si una variable falta, ese medio
simplemente no aparece en el checkout; la tienda no se rompe.

| # | Medio | Qué cubre | ¿Hay que crear cuenta? | Prioridad |
|---|-------|-----------|------------------------|-----------|
| 1 | **Wompi** | Tarjetas, PSE, **Nequi**, Botón Bancolombia, Daviplata, efectivo en corresponsales | Sí | Imprescindible |
| 2 | **Transferencia manual** | Nequi, Bancolombia y Bre-B, sin comisión, la apruebas tú | No | Recomendado |
| 3 | **Addi** | "Compra ahora, paga después" a cuotas, sin tarjeta | Sí (aliado) | Recomendado para ropa |
| 4 | **MercadoPago** | PSE, tarjetas, Efecty | Sí | Opcional |

> Las comisiones cambian; confírmalas en la web de cada proveedor antes de firmar.
> Documentos que casi todos piden: **cédula**, **RUT**, **certificación bancaria** (cuenta a tu nombre
> o al de la empresa) y, si eres empresa, **certificado de Cámara de Comercio**.

Las URLs de abajo usan el dominio de la API en producción `https://api.kaes-simplyeternal.co`.

---

## 1. Wompi (Bancolombia)

**Cuenta a crear:** "Comercio Wompi" en <https://comercios.wompi.co> (regístrate como persona natural
o jurídica y completa la validación de identidad y la cuenta bancaria donde te abonan).

**Nequi va incluido aquí:** el cliente elige Nequi dentro de Wompi, aprueba la notificación en su app
y el pedido se confirma solo. No necesitas una cuenta aparte de Nequi.

**Dónde están las llaves:** panel de Wompi → **Desarrolladores**.
Wompi tiene llaves de **prueba** (sandbox) y de **producción**; empieza con las de prueba.

| Variable en Railway | Dónde está en el panel | Empieza por |
|---|---|---|
| `WOMPI_PUBLIC_KEY` | Llaves del API → Llave pública | `pub_test_` / `pub_prod_` |
| `WOMPI_PRIVATE_KEY` | Llaves del API → Llave privada | `prv_test_` / `prv_prod_` |
| `WOMPI_INTEGRITY_SECRET` | Secretos para integración técnica → Integridad | `test_integrity_` / `prod_integrity_` |
| `WOMPI_EVENTS_SECRET` | Secretos para integración técnica → Eventos | `test_events_` / `prod_events_` |

**URL de eventos** (mismo panel, campo "URL de eventos"):
`https://api.kaes-simplyeternal.co/api/v1/payments/wompi/webhook`

El ambiente (prueba o producción) se detecta solo por la llave pública. Checklist de pruebas en
`docs/LANZAMIENTO.md` → sección 3.

---

## 2. Transferencia manual (Nequi, Bancolombia, Bre-B)

**No hay que crear ninguna cuenta.** Solo pones los datos donde quieres recibir la plata.

Cómo funciona para el cliente: elige "Transferencia", ve el valor exacto, la referencia (`KAES-XXXXXXXX`)
y tus cuentas, transfiere y sube un pantallazo del comprobante. Te llega un correo y en
**Admin → Órdenes** ves el comprobante con dos botones:

- **Aprobar transferencia** → la orden se confirma, baja el stock, se envía el email al cliente y se
  genera la factura (si está activa). Antes de aprobar, **revisa en tu app que el dinero llegó completo**.
- **Rechazar** (con motivo) → el cliente recibe un correo y puede subir otro comprobante.

Si el cliente no sube comprobante, el pedido se cancela solo en el mismo plazo que los demás
(`ORDER_EXPIRY_MINUTES`, 2 horas por defecto). Con el comprobante subido, el pedido espera hasta 3 días
a que lo revises.

| Variable | Qué poner | Ejemplo |
|---|---|---|
| `BANK_TRANSFER_ENABLED` | `true` para mostrarla en el checkout | `true` |
| `BANK_TRANSFER_HOLDER_NAME` | Titular de las cuentas | `KAES SAS` |
| `BANK_TRANSFER_HOLDER_DOC` | Cédula o NIT del titular | `CC 1.234.567.890` |
| `BANK_TRANSFER_NEQUI` | Celular de tu Nequi | `3001234567` |
| `BANK_TRANSFER_BANCOLOMBIA_TYPE` | `Ahorros` o `Corriente` | `Ahorros` |
| `BANK_TRANSFER_BANCOLOMBIA_NUMBER` | Número de cuenta | `12345678901` |
| `BANK_TRANSFER_BREB_KEY` | Tu llave Bre-B (la creas en la app de tu banco o Nequi) | `@kaes` o tu celular |
| `PAYMENTS_ALERT_EMAIL` | (opcional) correo que recibe "comprobante por revisar" | `pagos@kaes-simplyeternal.co` |

Solo se muestran las cuentas que tengan valor: puedes poner solo Nequi, por ejemplo.

---

## 3. Addi (compra ahora, paga después)

**Cuenta a crear:** "Aliado / comercio Addi". Entra a <https://co.addi.com> → sección para comercios
("Vende con Addi") y llena el formulario; un asesor te contacta, revisa tu negocio y firma contigo.
Addi te paga el total de la compra (menos su comisión, que se negocia) y el cliente le paga a Addi en
cuotas.

**Qué te entrega Addi** (primero para sandbox y luego para producción):

| Variable en Railway | Qué es |
|---|---|
| `ADDI_CLIENT_ID` | Client ID |
| `ADDI_CLIENT_SECRET` | Client Secret |
| `ADDI_ALLY_SLUG` | Identificador de tu tienda en Addi ("ally slug") |
| `ADDI_ENV` | `sandbox` mientras pruebas, `production` al salir |

**Qué le entregas tú a Addi:**

| Variable | Qué poner |
|---|---|
| `ADDI_CALLBACK_USER` | Un usuario que inventas (p. ej. `kaes-addi`) |
| `ADDI_CALLBACK_PASSWORD` | Una contraseña larga al azar (32+ caracteres) |
| URL de callback | `https://api.kaes-simplyeternal.co/api/v1/payments/addi/callback` |

Addi usa ese usuario y esa contraseña para avisarle a la tienda si aprobó el crédito. Opcional:
`ADDI_LOGO_URL` con la URL pública de tu logo.

> ⚠️ La integración sigue la documentación pública de Addi. Cuando te den acceso a su documentación
> de aliado, compártela para confirmar los campos (a veces piden datos extra del cliente, como la
> cédula). Prueba siempre en sandbox antes de pasar a producción.

---

## 4. MercadoPago (opcional)

**Cuenta a crear:** cuenta de vendedor en <https://www.mercadopago.com.co> y luego, en
<https://www.mercadopago.com.co/developers/panel>, **Tus integraciones → Crear aplicación**
(tipo "Pagos online", producto "Checkout Pro").

| Variable en Railway | Dónde está |
|---|---|
| `MP_ACCESS_TOKEN` | Tu aplicación → **Credenciales de producción** → Access Token (`APP_USR-…`). Para pruebas usa las credenciales de prueba |
| `MP_WEBHOOK_SECRET` | Tu aplicación → **Webhooks** → Configurar notificaciones → clave secreta |
| `MP_ENABLED` | `true` (o `false` para ocultarlo sin borrar el token) |

En Webhooks marca el evento **Pagos** y pon la URL:
`https://api.kaes-simplyeternal.co/api/v1/payments/webhook`

---

## Orden recomendado

1. **Wompi**: es el más completo y ya incluye Nequi. Con esta sola cuenta ya puedes lanzar.
2. **Transferencia manual**: cinco minutos llenando tus datos, sin comisión.
3. **Addi**: el trámite comercial toma unos días; súbelo cuando te den las credenciales.
4. **MercadoPago**: solo si tus clientes lo piden; duplica casi todo lo que ya cubre Wompi.

Después de poner o cambiar variables en Railway, el backend se reinicia solo. Comprueba qué medios
quedaron activos en `https://api.kaes-simplyeternal.co/api/v1/payments/methods`.
