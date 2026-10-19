# App Residencial

Plataforma para administrar residenciales y condominios. Tiene tres roles dentro de cada residencial (**residentes**, **vigilancia** y **administración**) y un **portal de empresa** para quien vende el servicio y administra varias residencias.

El proyecto está dividido en tres partes (monorepo con npm workspaces):

| Parte                  | Carpeta           | Qué hace                                                                                                                                                                |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**                | `apps/api`        | Servidor Node.js (Fastify). Es la fuente de verdad: autenticación, permisos por rol, reglas de negocio, base de datos, envío de correo/WhatsApp y cobros con Ecart Pay. |
| **APP**                | `apps/web`        | Interfaz React (Vite) para celular y escritorio. Sólo muestra datos y llama a la API.                                                                                   |
| **Reglas compartidas** | `packages/shared` | Operaciones del residencial, validaciones, vistas por rol y el contrato REST. Las usan la API y el modo demo de la APP, así nunca se desalinean.                        |

La arquitectura y las decisiones de diseño están en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Cómo ejecutarla

Requiere Node.js 22.13 o más reciente.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # configuración de desarrollo (carga datos de ejemplo)
npm run dev                              # API en :3000 y APP en http://localhost:5173
```

En desarrollo, Vite reenvía `/api` a la API, así la APP y la API comparten origen y la cookie de sesión funciona sin configurar CORS.

Otros comandos:

```bash
npm run dev:demo     # sólo la APP, con los datos simulados en el navegador (sin servidor)
npm test             # pruebas de la API y de las reglas compartidas (node:test)
npm run lint         # oxlint
npm run format       # prettier
npm run check        # lint + formato + pruebas (lo mismo que corre CI)
npm run build        # APP para producción (usa la API)
npm run build:demo   # APP de demostración autónoma
npm run db:migrate   # aplica migraciones de la base de datos
npm run db:seed      # carga datos de ejemplo en una base vacía
docker compose up    # APP (nginx) + API en http://localhost:8080
```

### Cuentas de demostración

| Acceso                          | Correo                    | Contraseña   |
| ------------------------------- | ------------------------- | ------------ |
| Administración (pide código)    | admin@residencial.mx      | Demo#2026    |
| Vigilancia                      | caseta@residencial.mx     | Demo#2026    |
| Residente                       | ana@correo.mx             | Demo#2026    |
| Otro residencial (pide código)  | admin@losrobles.mx        | Demo#2026    |
| Portal de empresa (pide código) | empresa@residencial.cloud | Empresa#2026 |

Los correos y WhatsApp aparecen en el **Buzón de prueba** (botón arriba a la derecha): en modo demo vienen del navegador y con la API en desarrollo de `GET /api/v1/dev/outbox`. Ahí están los códigos de verificación y la invitación pendiente de _Mariana López_ (código `739154`) para probar la activación. En producción el buzón no existe y los mensajes se envían de verdad.

La cámara (escáner QR y foto de placa) sólo funciona en `localhost` o con HTTPS.

## Funciones

### Control de acceso

- **Pases con QR y código corto** de 6 caracteres que expiran solos. Tres modos:
  - _Una sola entrada_: deja de servir después del primer uso.
  - _Varias entradas_: un número limitado de usos dentro de la vigencia.
  - _Recurrente_: para personal doméstico o trabajadores, con días y horario permitidos (por ejemplo, lunes, miércoles y viernes de 8:00 a 17:00).
- El código va firmado (`RES1.<id>.<expira>.<firma>`), así que un QR inventado o alterado se rechaza.
- El residente puede compartir el pase (por WhatsApp, por ejemplo), descargarlo o cancelarlo en cualquier momento.
- **Caseta**: el vigilante escanea el QR con la cámara o escribe el código. Ve en pantalla si es válido y, si no, por qué (expirado, ya usado, fuera de horario, cancelado).
- **Lectura automática de placas (OCR)**: el vigilante toma la foto y la placa se escribe sola en el formulario (tesseract.js corre en el navegador). Siempre se puede corregir a mano, y si hay varias lecturas posibles se muestran como sugerencias.
- **Placa esperada**: si el residente indicó la placa y el vehículo llega con otra, se avisa al residente y a administración.
- Visitas sin pase, registro de salida y lista de quién está dentro en este momento.
- **Acceso general** (basura, pipa de agua, gas, jardinería…): se notifica a **todos** los residentes.
- Bitácora con foto, placa, horas de entrada y salida, y exportación a CSV.

### Pagos de mantenimiento

- Estado de cuenta mensual (pagado, en revisión, por pagar, vencido).
- Tres formas de pago:
  - **Ecart Pay**: el pago se aprueba en automático; se notifica al residente y a los administradores.
  - **Transferencia**: el residente sube su comprobante (imagen o PDF) y la referencia.
  - **Efectivo**: el residente lo reporta, o el administrador lo registra directamente.
- Los administradores reciben un aviso por cada comprobante. Al **aprobar o rechazar** (con motivo), el residente recibe la notificación.
- Morosidad por casa, recordatorios de pago individuales o masivos, y métricas de cobranza.

### Avisos y notificaciones

- Avisos por tipo: general, reunión, documento, bitácora, mantenimiento o urgente, con **archivos adjuntos**.
- Destinatarios: residentes, residentes y vigilancia, o sólo vigilancia.
- **Confirmación de lectura** (quién lo leyó) y **confirmación de asistencia** para reuniones.
- Centro de notificaciones en la app, avisos emergentes y notificaciones del sistema (service worker listo para Web Push).

## Foto de portada

Cada residencial muestra una foto de su fachada de fondo, con transparencia, en el encabezado de residentes, vigilancia y administración. El administrador la cambia o la quita en **Configuración → Foto de portada**. La demo incluye una ilustración de ejemplo (`apps/web/public/portada-demo.jpg`).

## Inicio de sesión y seguridad

Todo se aplica en la API; la APP no decide nada de seguridad.

- **No hay registro abierto.** La empresa crea cada residencial y a su administrador; el administrador crea a residentes, vigilantes y otros administradores.
- **Activación con dos canales.** Al crear una cuenta no se asigna contraseña. Se envía un **enlace por correo** (token aleatorio de 256 bits) y un **código de 6 dígitos por WhatsApp**. Para activar se necesitan los dos. Vencen en 48 horas, sirven una vez y la invitación se anula tras 5 códigos incorrectos. Sólo se guardan sus hashes.
- **Contraseñas** con **Argon2id** (parámetros recomendados por OWASP): 10 caracteres o más, mayúsculas, minúsculas, número y símbolo, sin el nombre ni palabras comunes.
- **Recuperación sólo por un administrador.** Al restablecer, la contraseña anterior deja de funcionar, se cierran sus sesiones y se envía un nuevo enlace + código.
- **Verificación en dos pasos** (código por WhatsApp y correo, 5 minutos) para administradores y personal de la empresa.
- **Bloqueo** de 15 minutos tras 5 contraseñas incorrectas, con aviso por correo, y **límite de intentos por IP** en las rutas de acceso.
- Mensaje de error genérico y tiempo de respuesta uniforme para no revelar qué correos existen.
- **Sesiones opacas en cookie HttpOnly, SameSite=Strict y Secure** (en producción). La base sólo guarda el hash del token. Máximo 8 horas, cierre por 30 minutos de inactividad y cierre inmediato si la cuenta se suspende o se restablece, o si se suspende su residencial.
- **Protección CSRF**: toda petición que modifica datos lleva un token que la API entrega al iniciar sesión.
- **Datos filtrados por rol en el servidor**: un residente no recibe pases, pagos, correos ni teléfonos de otras casas; los votos llegan anónimos; vigilancia no recibe pagos ni pases (valida códigos en el servidor).
- **Aislamiento entre residenciales**: cada consulta va acotada al residencial de la sesión.
- **Validación de entrada** con esquemas (zod) en cada ruta: los campos que no se declaran se descartan, así el cliente no puede fijar estados, autores ni montos.
- **QR firmados con HMAC-SHA256** con una clave que sólo tiene el servidor; el uso de un pase de una sola entrada es atómico (transacción).
- **Pagos con Ecart Pay verificados por el servidor**: el pago sólo se aprueba después de consultar el cobro con el proveedor (y el aviso por webhook se valida con firma).
- Cabeceras de seguridad (helmet), CORS restringido a la URL de la APP, configuración validada al arrancar (en producción no inicia sin claves propias).
- **Auditoría**: inicios de sesión, intentos fallidos, bloqueos, invitaciones, restablecimientos, cambios de configuración y operaciones del portal.
- El portal de empresa tiene un acceso separado: las cuentas de residenciales no entran ahí y la cuenta de la empresa no entra por el acceso de residentes.

### Portal de empresa

- **Resumen**: residencias activas, ingreso mensual, cobrado del mes, por cobrar y actividad reciente.
- **Residencias**: alta de residencial con su administrador (recibe invitación), cambio de plan, suspensión o reactivación del servicio con motivo, y gestión de todas sus cuentas (reenviar invitación, restablecer contraseña, suspender, desbloquear).
- **Cobranza**: generar los cargos del mes, registrar pagos (transferencia, efectivo, tarjeta, Ecart Pay), enviar recordatorios, cancelar cargos y suspender morosos por días de atraso.
- **Planes**: precio mensual y número máximo de unidades.
- **Auditoría** filtrable por residencial, alertas y texto.

## Análisis de competidores y diferenciadores

Revisé las apps más usadas en México y Latinoamérica: **Neivor**, **Vivook**, **Residentia** y **ComunidadFeliz**. Como referencia internacional, también **BuildingLink** y **ButterflyMX**. Casi todas cubren lo básico: QR de acceso, cobranza y avisos. Para diferenciarse, esta app agrega:

| Diferenciador                                 | Por qué importa                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **OCR de placas en el navegador**             | La mayoría pide escribir la placa a mano o requiere cámaras LPR costosas. Aquí basta el celular del vigilante. |
| **Alerta de placa distinta**                  | Detecta suplantaciones: el pase indicaba una placa y llegó otra.                                               |
| **Pases recurrentes con horario**             | Personal doméstico, jardineros o niñeras sin generar un código cada día.                                       |
| **Pases de varias entradas**                  | Fiestas, mudanzas o proveedores que entran y salen.                                                            |
| **Botón SOS**                                 | Alerta inmediata a caseta y administración con el domicilio (emergencia médica, robo, incendio…).              |
| **Paquetería con código de entrega**          | El paquete se entrega sólo a quien tiene el código de 4 dígitos que recibió el residente.                      |
| **Reservas de áreas comunes sin choques**     | Valida horario, aforo y empalmes, e informa el depósito.                                                       |
| **Reportes de mantenimiento con seguimiento** | Con foto, estados y comentarios entre residente y administración.                                              |
| **Votaciones digitales**                      | Resultados en vivo y participación, útiles para asambleas.                                                     |
| **Transparencia financiera**                  | Los residentes ven ingresos, gastos por categoría y balance del mes, lo que suele reducir la morosidad.        |
| **Confirmación de lectura y asistencia**      | El administrador sabe quién leyó cada aviso y quién asistirá a la reunión.                                     |

## Configuración e integraciones

La API valida su configuración al arrancar; todas las variables están documentadas en [`apps/api/.env.example`](apps/api/.env.example). Las más importantes para producción:

| Variable                  | Uso                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_SECRET`           | Clave para firmar los QR (32 caracteres o más). Obligatoria en producción.                                                                                                                                                                      |
| `APP_URL`                 | URL pública de la APP: enlaces de activación y CORS.                                                                                                                                                                                            |
| `MESSAGING_PROVIDER=live` | Envía correos con **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`) y WhatsApp con la **WhatsApp Business Cloud API** (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, plantilla de categoría _Autenticación_).                                         |
| `ECARTPAY_MODE=live`      | Cobros reales con Ecart Pay (`ECARTPAY_PUBLIC_KEY`, `ECARTPAY_PRIVATE_KEY`, `ECARTPAY_WEBHOOK_SECRET`). Las llaves sólo viven en el servidor. Revisa los endpoints en `apps/api/src/payments/ecartpay.js` contra la documentación de tu cuenta. |
| `TRUST_PROXY`             | `true` detrás de nginx o un balanceador, para leer la IP real.                                                                                                                                                                                  |

En la APP (`apps/web/.env.example`): `VITE_DATA_MODE` (`api` o `demo`), `VITE_API_URL` (sólo si la API está en otro dominio; lo recomendado es servirla en el mismo bajo `/api`) y `VITE_VAPID_PUBLIC_KEY` para Web Push.

### Ecart Pay

1. La APP pide `POST /api/v1/tenant/payments/ecartpay/checkout` con los meses a pagar; la API calcula el monto (el cliente no lo decide) y crea el cobro.
2. El residente paga en el checkout de Ecart Pay.
3. La APP llama a `POST /api/v1/tenant/payments/ecartpay/:id/confirm`, o Ecart Pay avisa a `POST /api/v1/webhooks/ecartpay`. En ambos casos la API consulta el estado al proveedor y registra el pago aprobado una sola vez.

### OCR de placas

Usa tesseract.js en el navegador con los archivos servidos desde `apps/web/public/ocr`, que se copian solos al ejecutar `dev` o `build`. Si se necesita más precisión con poca luz, se puede cambiar por un servicio de LPR (por ejemplo, Plate Recognizer) sin cambiar la pantalla.

### Notificaciones push

El service worker (`apps/web/public/sw.js`) ya muestra notificaciones y abre la sección correcta. Falta en la API guardar la suscripción y enviar el push con la llave VAPID privada para avisar con la app cerrada; con la app abierta los avisos llegan en tiempo real por SSE.

## Estructura

```
apps/
  api/
    src/
      app.js                composición: dependencias, plugins y rutas
      server.js             arranque y cierre ordenado
      config.js             variables de entorno validadas (zod)
      db/                   SQLite (node:sqlite), migraciones, semilla de demo
      repositories/         acceso a datos (SQL sólo aquí)
      modules/              auth, accounts, tenant, platform, me, events, dev (servicio + rutas)
      plugins/              seguridad (helmet, CORS, límites) y sesión/CSRF
      messaging/            plantillas y despachador de correo/WhatsApp
      payments/             adaptador de Ecart Pay
    test/                   pruebas de integración con app.inject()
  web/
    src/
      data/                 proveedor de datos: api/ (HTTP + SSE) y demo/ (simulación en el navegador)
      components/, pages/   pantallas (no saben si los datos vienen de la API o de la demo)
      services/             OCR y notificaciones del sistema
    deploy/nginx.conf       sirve la APP y reenvía /api
packages/
  shared/
    src/                    operaciones, validación, formato, vistas por rol, contrato REST
    src/demo/               datos de ejemplo
    test/
docs/ARQUITECTURA.md
```
