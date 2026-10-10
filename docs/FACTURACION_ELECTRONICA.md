# Facturación electrónica DIAN (software propio)

La tienda emite **factura electrónica de venta** y **nota crédito** directamente ante la DIAN
(modalidad *software propio*, sin proveedor tecnológico), siguiendo el **Anexo Técnico de
Factura Electrónica v1.9** (Resolución 000165 de 2023) y la caja de herramientas v2026.

Está **apagada por defecto** (`EINVOICE_ENABLED=false`). Mientras esté apagada la tienda funciona
igual que antes; el checkout solo muestra la casilla opcional "¿Necesitas factura a tu nombre?".

## Cómo funciona

1. **Checkout:** el cliente puede dar su documento (CC, CE, NIT con DV automático, pasaporte,
   PEP o PPT) y su nombre o razón social. Si no lo da, se factura a **consumidor final**
   (`222222222222`).
2. **Pago aprobado:** cuando Wompi o MercadoPago confirman el pago, o el admin confirma manualmente,
   se crea la factura y se procesa en segundo plano. El webhook nunca espera a la DIAN.
3. **Emisión:** el sistema
   - toma el siguiente consecutivo sin huecos (bloqueo de fila en `invoice_sequences`);
   - separa base e IVA por línea, prorratea el cupón y agrega el envío como línea aparte;
   - genera el XML UBL 2.1 y calcula el CUFE (SHA-384);
   - lo firma con XAdES-EPES usando la política de firma DIAN v2;
   - lo comprime en un ZIP y lo envía por SOAP con WS-Security (`SendBillSync`).
4. **Respuesta DIAN:**
   - **Validada:** se arma el `AttachedDocument` y el PDF con el QR, y se envían al cliente por correo.
   - **Rechazada:** se avisa al admin por correo y en *Admin → Órdenes*; se corrige y se pulsa
     **Reintentar**. Se reenvía con el mismo número.
   - **Error de red o configuración:** se reintenta solo con espera creciente, hasta 10 intentos.
5. **Cancelación o reembolso** de una orden facturada: se emite una **nota crédito** de anulación
   (concepto 2) que referencia la factura. Una factura validada nunca se modifica.

El job de mantenimiento (cada 10 min) procesa los pendientes, consulta estados y reenvía correos
fallidos.

| Dónde | Qué |
|---|---|
| `backend/src/services/einvoice/` | `config`, `amounts`, `cufe`, `ubl-builder`, `signer`, `dian-client`, `pdf`, `einvoice.service` |
| `backend/src/data/divipola.json` | Códigos DANE oficiales (tablas 13.4.2 y 13.4.3 del anexo) |
| Tablas | `electronic_documents`, `invoice_sequences`; columnas `buyer*` en `orders`, `taxRate` en `order_items` |
| Admin | Detalle de orden → sección "Factura electrónica" (estado, CUFE, errores, PDF, XML, Reintentar) |
| Cliente | Correo con ZIP + PDF; botón "Descargar factura" en *Mis órdenes* |

## Trámites (lo que debes hacer tú)

1. **RUT:** actualiza el RUT agregando la responsabilidad **52 – Facturador electrónico**.
   Define con tu contador si eres responsable de IVA (régimen común) o del régimen simple.
2. **Certificado de firma digital** de la empresa (persona jurídica) o tuyo (persona natural), de una
   entidad certificadora acreditada por la ONAC: GSE, Certicámara, Andes SCD, etc. Te entregan un
   `.p12` o `.pfx` y su contraseña.
3. **Registro en el portal de habilitación:** entra a
   <https://catalogo-vpfe-hab.dian.gov.co> → *Registro / Habilitación* → modo de operación
   **"Software propio"**.
   - Nombre del software: el que quieras (ej. "KAES Tienda").
   - **PIN**: lo inventas tú (5 dígitos), guárdalo.
   - El portal te da el **Software ID** y el **TestSetId** (identificador del set de pruebas).
4. **Set de pruebas** (ver abajo). Al aprobarlo, el software queda **habilitado**.
5. **Resolución de numeración:** en el portal MUISCA solicita la autorización de numeración de
   facturación electrónica (formulario 1876). Obtienes el número de resolución, el prefijo, el rango
   desde/hasta y las fechas. Luego, en el portal de factura electrónica, **asocia el prefijo al
   software**. La **clave técnica** aparece en el portal y también la obtiene
   `npm run einvoice:check -- --remote`.

## Paso a paso técnico

### 1. Convertir el certificado

```bash
cd backend
EINVOICE_P12_PASSWORD='la-clave-del-p12' npm run einvoice:cert -- /ruta/certificado.p12
```

Imprime `EINVOICE_CERT_PEM_BASE64` y `EINVOICE_KEY_PEM_BASE64`. Son **secretos**: pégalos en Railway
y no los guardes en el repositorio.

### 2. Variables en Railway (servicio backend)

| Variable | Valor |
|---|---|
| `EINVOICE_ENV` | `2` en habilitación, `1` en producción |
| `EINVOICE_ISSUER_NIT` | NIT sin DV (el DV se calcula solo) |
| `EINVOICE_ISSUER_NAME` | Razón social exacta del RUT |
| `EINVOICE_ISSUER_TRADE_NAME` | Nombre comercial (KAES) |
| `EINVOICE_ISSUER_PERSON_TYPE` | `1` persona jurídica, `2` persona natural |
| `EINVOICE_ISSUER_TAX_LEVEL_CODE` | Responsabilidades del RUT separadas por `;` (`O-13`, `O-15`, `O-23`, `O-47`) o `R-99-PN` si no tienes ninguna de esas |
| `EINVOICE_ISSUER_TAX_SCHEME` | `01` si eres responsable de IVA, `ZZ` si no |
| `EINVOICE_ISSUER_ADDRESS`, `_DEPARTAMENTO`, `_MUNICIPIO`, `_POSTAL_ZONE` | Dirección del RUT |
| `EINVOICE_ISSUER_EMAIL` | Correo de recepción de facturas registrado en la DIAN |
| `EINVOICE_ISSUER_PHONE` | Teléfono |
| `EINVOICE_RESOLUTION_NUMBER`, `_START`, `_END` | Resolución (fechas `AAAA-MM-DD`) |
| `EINVOICE_PREFIX`, `EINVOICE_RANGE_FROM`, `EINVOICE_RANGE_TO` | Prefijo y rango autorizado |
| `EINVOICE_TECHNICAL_KEY` | Clave técnica del rango |
| `EINVOICE_SOFTWARE_ID`, `EINVOICE_SOFTWARE_PIN` | Del registro del software |
| `EINVOICE_TEST_SET_ID` | Solo habilitación |
| `EINVOICE_CERT_PEM_BASE64`, `EINVOICE_KEY_PEM_BASE64` | Del paso 1 |
| `EINVOICE_SHIPPING_TAX_RATE` | IVA del envío. `0` = excluido (transporte de carga, art. 476 ET). **Confírmalo con tu contador.** |
| `EINVOICE_PAYMENT_MEANS_CODE` | `ZZZ` (otro) por defecto |
| `EINVOICE_ALERT_EMAIL` | Quién recibe los avisos de rechazo (opcional) |

En el frontend (Vercel) configura `PUBLIC_LEGAL_NIT` con el NIT y su DV para las páginas legales.

**En habilitación** usa los datos de prueba que muestra el portal. La resolución de pruebas usa el
prefijo `SETP`, el rango `990000000–995000000` y la clave técnica que aparece en el set.

### 3. Verificar

```bash
npm run einvoice:check            # variables, certificado y resolución
npm run einvoice:check -- --remote  # además consulta los rangos en la DIAN
```

### 4. Enviar el set de pruebas (habilitación)

En el portal, abre el detalle de tu set de pruebas y mira cuántos documentos pide de cada tipo.
Luego, con `EINVOICE_ENV=2`:

```bash
npm run einvoice:habilitacion -- --facturas 8 --creditos 1 --debitos 1
```

El script genera documentos ficticios (consumidor final, cédula, NIT, tarifas 19 % y 0 %, envío),
los envía con `SendTestSetAsync` y consulta `GetStatusZip` hasta que la DIAN responda. Cuando el
portal muestre el set como **Aceptado**, el software queda habilitado. Si algún documento es
rechazado, el script imprime las reglas que fallaron.

### 5. Encender en producción

1. Cambia a `EINVOICE_ENV=1` y pon la resolución **real** (prefijo, rango, clave técnica).
2. Corre `npm run einvoice:check -- --remote` y verifica que aparezca ✅ en tu rango.
3. Pon `EINVOICE_ENABLED=true` y redespliega.
4. Haz una compra real pequeña y revisa en *Admin → Órdenes* que diga **Validada DIAN**. Revisa
   también el correo del cliente y la factura en <https://catalogo-vpfe.dian.gov.co>.

Para apagarla en cualquier momento: `EINVOICE_ENABLED=false`. Las órdenes pagadas mientras estuvo
apagada no se facturan automáticamente.

## Pruebas

- `npm test` incluye:
  - el CUFE contra el ejemplo oficial del anexo;
  - el desglose de montos;
  - la validación de factura, nota crédito, nota débito y AttachedDocument contra los **XSD oficiales
    de la DIAN** (`tests/fixtures/dian-xsd`);
  - la firma XAdES y WS-Security verificadas con `xml-crypto`;
  - el cliente SOAP con respuestas simuladas.
- `npm run test:db` cubre contra Postgres:
  - numeración concurrente sin huecos e idempotencia;
  - rechazo y reintento, errores de red y duplicados;
  - rango agotado, nota crédito y el flujo de habilitación.

`DIAN_UBL_Structures.xsd` restringe `@schemeID` de `ProviderID` a tipos de documento, pero el anexo y
los ejemplos oficiales ponen ahí el DV. Esa inconsistencia de la DIAN se ignora en las pruebas.

## Límites conocidos

- Las notas crédito son de **anulación total**. Las devoluciones parciales no están modeladas en la
  tienda.
- La nota débito existe solo para el set de pruebas: la tienda no la necesita en su operación.
- Las reglas de negocio que solo valida la DIAN (por ejemplo, que el NIT del adquiriente exista en el
  RUT) solo se pueden comprobar con el set de pruebas real.
