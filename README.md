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

### Demo en GitHub Pages

Cada push a `main` publica la demo (todo en el navegador, sin servidor) con `.github/workflows/pages.yml`. Actívalo una vez en **Settings → Pages → Source: GitHub Actions**; queda en `https://USUARIO.github.io/app-residencial/`.

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
- **Conceptos de cobro** además de la cuota (_Pagos → Conceptos_): administración agrega, edita o elimina cargos como una cuota extraordinaria, una multa o el fondo de reserva. Cada uno se cobra **una vez** (con fecha límite) o **cada mes** (con mes de inicio y, si quiere, de fin), a todas las casas o sólo a algunas. El residente recibe un aviso, lo ve en su estado de cuenta y lo paga igual que la cuota (Ecart Pay, transferencia, efectivo o conciliación bancaria). Si un concepto ya tiene pagos, al eliminarlo deja de cobrarse pero los pagos se conservan.

### Cobranza automática

- **Referencia SPEI por casa**: cada casa tiene una referencia numérica de 7 dígitos con dígito verificador (`1` + número de casa + verificador). El residente la ve en _Pagos_ con botón para copiarla y la escribe en el campo «Referencia numérica» de su transferencia.
- **Conciliación bancaria**: en _Pagos → Conciliación_ administración sube el estado de cuenta en CSV (BBVA, Banorte, Santander y otros: las columnas se reconocen por nombre). Por cada abono:
  1. si la casa tiene comprobantes en revisión por el mismo monto, se aprueban;
  2. si no, el depósito se aplica a los meses más antiguos que debe cuando el monto coincide exacto;
  3. lo demás queda _por asignar_ para aplicarlo a mano o descartarlo.
     Subir el mismo archivo otra vez no duplica pagos. Hay un botón para descargar un CSV de ejemplo con los adeudos de la demo.
- **Recargos**: monto fijo por mes vencido con días de tolerancia configurables. Administración puede **condonar** el recargo de un mes (queda en la auditoría).
- **Restricción por adeudo** (opcional, según el reglamento): con N meses vencidos la casa no puede reservar áreas comunes ni crear pases recurrentes. El acceso a la vivienda y los pases de una sola visita nunca se bloquean.
- Las reglas están en `packages/shared/src/ledger.js` (estado de cuenta, recargos, conceptos, referencias), `bank.js` (lectura del CSV) y las operaciones `reconcileBank`, `assignBankMovement`, `ignoreBankMovement` y `waiveLateFee`.

### WhatsApp sin descargar la app

Los residentes escriben «Hola» al WhatsApp del residencial y un asistente con menú numerado les permite:

- **Crear un pase** para su visita (hoy o mañana) en dos mensajes, o directo con «pase Juan Pérez». La respuesta trae el código y un enlace que la visita abre para mostrar su QR en caseta; no necesita la app.
- **Ver su saldo** con los meses, recargos, la CLABE y su referencia SPEI.
- **Leer los avisos recientes** y **ver las visitas del día**.
- Recibir **avisos nuevos** y **recordatorios de pago** (se pueden dar de baja respondiendo BAJA y reactivar con ALTA).

Administración recibe un resumen (comprobantes por revisar, depósitos por asignar, adeudo, reportes) y vigilancia el enlace a su app. La persona se identifica por el teléfono registrado en su cuenta; las acciones pasan por las mismas reglas que la app (por ejemplo, las restricciones por adeudo).

En la demo y en desarrollo, el botón de WhatsApp de la barra superior abre un simulador: eliges a la persona y chateas como lo haría desde su teléfono.

**Para producción** (WhatsApp Cloud API de Meta):

1. En Meta for Developers registra el webhook `https://TU-API/api/v1/webhooks/whatsapp` con el token de `WHATSAPP_VERIFY_TOKEN` y suscríbete al campo `messages`.
2. Define `WHATSAPP_APP_SECRET` (clave secreta de la app): cada mensaje recibido se valida con su firma `X-Hub-Signature-256`.
3. Las respuestas del asistente se envían como texto (la persona acaba de escribir: ventana de 24 h). Los avisos y recordatorios inician la conversación, así que Meta exige plantillas aprobadas de categoría _Utilidad_:
   - `WHATSAPP_NOTICE_TEMPLATE` (por omisión `aviso_residencial`): variables `{{1}}` residencial, `{{2}}` título, `{{3}}` resumen.
   - `WHATSAPP_REMINDER_TEMPLATE` (por omisión `recordatorio_pago`): `{{1}}` nombre, `{{2}}` residencial, `{{3}}` saldo, `{{4}}` referencia.
4. En _Configuración → WhatsApp_ activa el asistente y escribe el número que verán los residentes.

### Caseta física: pluma, tags y cámaras

En _Caseta física_ administración da de alta los equipos de la caseta y los tags de los residentes:

- **Pluma**: se abre desde la app de vigilancia («Abrir pluma»), al registrar una visita con pase válido (configurable) y, si el residencial lo permite, desde la app del residente al llegar. Toda apertura queda en la bitácora.
- **Tags RFID**: un tag activo abre la pluma de residentes al pasar por el lector; uno bloqueado o desconocido no abre y avisa a caseta.
- **Cámaras de placas (LPR)**: la placa de un residente abre sola (configurable); la de una visita con pase avisa al vigilante para que la confirme; las demás sólo quedan registradas.
- **Modo sin internet en la tablet de caseta**: cada 5 minutos la tablet guarda los pases vigentes de las siguientes 24 h (sólo la huella SHA-256 de cada QR, no el QR). Sin conexión valida contra ese paquete, guarda las entradas en una cola y las envía con su hora real al volver el internet. Si una entrada resulta inválida (por ejemplo, el mismo pase usado dos veces), se registra igual y se avisa a administración.

Los equipos se conectan con el **agente de caseta** (`apps/gate-agent`), un programa de Node sin dependencias que corre en una computadora o Raspberry Pi de la caseta:

```bash
cd apps/gate-agent
cp .env.example .env   # pega los tokens que genera la app en Caseta física → Equipos → Token
npm start
```

- Recibe las órdenes de apertura en tiempo real por una conexión **saliente** (no hay que abrir puertos) y activa el relevador: `RELAY=shelly` (Shelly Gen1/Gen2), `RELAY=http` (cualquier controlador con URL) o `console` para probar.
- Una orden que llega tarde (más de 20 s) nunca abre la pluma.
- Lectores de tags tipo teclado USB (o Wiegand con convertidor): el agente lee el número y lo envía.
- Cámaras con LPR: configúralas para enviar sus avisos HTTP a `http://IP-DEL-AGENTE:8090/?key=LPR_KEY` (Hikvision ANPR, Dahua o JSON `{"plate":"ABC123A"}`).
- Cada equipo tiene su token; si se pierde la computadora, «Token» genera uno nuevo y el anterior deja de funcionar.

Para dejarlo corriendo al encender la computadora, crea un servicio de systemd con `ExecStart=/usr/bin/node /opt/gate-agent/src/index.js` y `EnvironmentFile=/opt/gate-agent/.env`.

### Áreas comunes

- Administración agrega, edita o elimina las áreas que se pueden reservar (_Reservaciones → Nueva área_ o el lápiz de cada una): nombre, horario, capacidad, depósito y reglas.
- Un área se puede **pausar** (por mantenimiento, por ejemplo): los residentes dejan de verla y las reservaciones ya hechas se mantienen. No se puede eliminar un área con reservaciones próximas; si tuvo reservaciones pasadas, se archiva para conservar el historial.

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
- **Cobranza**: generar los cargos del mes, registrar pagos (transferencia, efectivo, tarjeta, Ecart Pay), revisar los comprobantes que envían los residenciales (aprobar o rechazar con motivo), enviar recordatorios, cancelar cargos y suspender morosos por días de atraso. Los residenciales con cobro automático se cobran al generar los cargos.
- **Planes**: precio mensual y número máximo de unidades.
- **Auditoría** filtrable por residencial, alertas y texto.

### Suscripción desde la app del administrador

En **Configuración → Suscripción** el administrador ve sus cargos y los paga:

- **Tarjeta (Ecart Pay)**: el pago queda registrado al momento. Si marca _Cobrar automáticamente cada mes_, Ecart Pay guarda la tarjeta (la API sólo guarda su identificador, la marca y los últimos 4 dígitos) y cada cargo nuevo se cobra solo. Si la tarjeta se rechaza, se avisa por correo y en la app y se reintenta al día siguiente. Se puede pausar o quitar la tarjeta.
- **Transferencia**: muestra la cuenta de la empresa (`COMPANY_BANK_*`) y una referencia por cargo (`SUS-T1-202610`); el administrador sube el comprobante y la empresa lo aprueba o rechaza en Cobranza.
- **Recordatorios**: 3 días antes del vencimiento, por correo, WhatsApp (plantilla `WHATSAPP_SUBSCRIPTION_TEMPLATE` con las variables nombre, residencial, monto y vencimiento) y en la app. No se envían si hay cobro automático.
- **Servicio suspendido**: residentes y vigilancia no entran, pero el administrador sí, a una pantalla que sólo permite pagar. Si la suspensión fue por adeudo, el servicio se reactiva solo al quedar sin cargos vencidos.

Las tareas (cobro automático y recordatorios) corren cada hora en la API; cada cargo se intenta cobrar como máximo una vez al día. En la demo corren al abrirla y cada minuto: Las Palmas tiene el cargo del mes por vencer y Los Robles uno vencido para probar la suspensión.

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
| `COMPANY_BANK_CLABE`      | Cuenta de la empresa para que los residenciales transfieran su suscripción (con `COMPANY_BANK_NAME` y `COMPANY_BANK_HOLDER`). Sin ella sólo se ofrece el pago con tarjeta.                                                                      |
| `TRUST_PROXY`             | `true` detrás de nginx o un balanceador, para leer la IP real.                                                                                                                                                                                  |

En la APP (`apps/web/.env.example`): `VITE_DATA_MODE` (`api` o `demo`), `VITE_API_URL` (sólo si la API está en otro dominio; lo recomendado es servirla en el mismo bajo `/api`) y `VITE_VAPID_PUBLIC_KEY` para Web Push.

### Ecart Pay

1. La APP pide `POST /api/v1/tenant/payments/ecartpay/checkout` con los meses a pagar; la API calcula el monto (el cliente no lo decide) y crea el cobro.
2. El residente paga en el checkout de Ecart Pay.
3. La APP llama a `POST /api/v1/tenant/payments/ecartpay/:id/confirm`, o Ecart Pay avisa a `POST /api/v1/webhooks/ecartpay`. En ambos casos la API consulta el estado al proveedor y registra el pago aprobado una sola vez.

La suscripción usa el mismo flujo (`/api/v1/tenant/subscription/invoices/:id/checkout` y `/subscription/checkouts/:id/confirm`) con `save_card` para el cobro automático, y cobra la tarjeta guardada con `POST /charges`. Confirma esos dos campos con la documentación de tu cuenta de Ecart Pay antes de pasar a `live`.

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
      modules/              auth, accounts, tenant, platform, subscription, me, events, whatsapp, devices, dev (servicio + rutas)
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
  gate-agent/               agente de caseta: relevador de la pluma, lector de tags y cámara de placas
packages/
  shared/
    src/                    operaciones, validación, formato, vistas por rol, contrato REST,
                            cobranza (ledger, bank), asistente de WhatsApp (whatsapp), caseta física (gate)
    src/demo/               datos de ejemplo
    test/
docs/ARQUITECTURA.md
```
