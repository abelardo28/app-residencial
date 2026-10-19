# Arquitectura

## Resumen

```
 Navegador (APP React)                      Servidor (API Fastify)                    Servicios
┌──────────────────────────┐   HTTPS    ┌────────────────────────────────┐
│ páginas y componentes    │  /api/v1   │ plugins: helmet, CORS, límites │
│        │                 │ ─────────► │          sesión + CSRF         │
│ data/api/ApiProvider     │  cookie    │ rutas (zod) ─► servicios       │──► Resend (correo)
│   · /me/snapshot         │  HttpOnly  │   auth · accounts · tenant     │──► WhatsApp Cloud API
│   · acciones REST        │            │   platform · events            │──► Ecart Pay
│   · SSE /events          │ ◄───────── │ repositorios ─► SQLite         │
└──────────────────────────┘   avisos   └────────────────────────────────┘
              ▲                                       ▲
              └──────────── @residencial/shared ──────┘
                 operaciones · validación · vistas por rol · contrato REST
```

## Decisiones

### Reglas de negocio en un solo lugar

`packages/shared/src/operations.js` define cada operación del residencial (crear un pase, registrar una entrada, revisar un pago…) como una función pura con los roles que la pueden ejecutar. Recibe:

- `t`: ayudantes de escritura (`createTx`). Nunca muta objetos: crea nuevos, así se sabe qué cambió.
- `ctx`: `{ user, sign, trusted }`. `trusted` lleva lo que el servidor verificó (por ejemplo, que Ecart Pay confirmó un cobro).
- `input`: la entrada ya validada.

La API las ejecuta contra la base de datos; el modo demo de la APP, contra `localStorage`. Por eso la demo se comporta igual que producción y las reglas se prueban una sola vez (`packages/shared/test`).

### Contrato REST compartido

`packages/shared/src/routes.js` (`OPERATION_ROUTES`) dice el método y la ruta de cada operación. La API registra sus rutas recorriendo esa tabla y la APP genera su cliente con la misma tabla: agregar una operación es escribirla, darle un esquema en `apps/api/src/modules/tenant/schemas.js` y una entrada en la tabla. La API no arranca si una operación no tiene esquema.

### Capas de la API

- **Rutas** (`modules/*/routes.js`): validan la entrada con zod y llaman al servicio. No tienen lógica.
- **Servicios** (`modules/*/service.js`): casos de uso; abren transacciones, aplican permisos, escriben auditoría y mensajes.
- **Repositorios** (`repositories/`): el único lugar con SQL. Para cambiar a PostgreSQL sólo se reescriben aquí.
- **Plugins**: seguridad transversal (cabeceras, CORS, límites, sesión, CSRF, formato de errores).

`app.js` compone todo sin abrir puertos, así las pruebas usan `app.inject()` con una base en memoria.

### Datos

- Identidad, sesiones, invitaciones, cargos de suscripción, auditoría y bandeja de salida son tablas relacionales (`db/migrations/001_init.sql`).
- Los módulos operativos de cada residencial (pases, accesos, pagos, avisos…) son documentos JSON en `tenant_records`, siempre con `tenant_id`. La _unidad de trabajo_ (`tenantsRepository.unitOfWork`) carga sólo las colecciones que usa la operación y guarda sólo los elementos que cambiaron, dentro de una transacción `BEGIN IMMEDIATE`. Esto hace atómico, por ejemplo, el uso de un pase de una sola entrada.
- SQLite (`node:sqlite`, sin dependencias nativas extra) con WAL. Para varias instancias se recomienda PostgreSQL (JSONB para los documentos).

### Sesión

Token opaco aleatorio en una cookie `sid` HttpOnly, SameSite=Strict y Secure, con `path=/api`. La base guarda su SHA-256, la versión de sesión de la cuenta y un token CSRF. Suspender o restablecer una cuenta sube su versión y todas sus sesiones dejan de valer. La APP y la API se sirven en el mismo origen (Vite en desarrollo, nginx en producción), así no hace falta CORS para la cookie.

### Vistas por rol

`packages/shared/src/views.js` (`viewFor`) decide qué recibe cada rol. La API la aplica antes de responder `/me/snapshot`; el filtrado nunca depende de la APP.

### Tiempo real

`GET /api/v1/events` (Server-Sent Events) sólo avisa "cambió algo en tu residencial". La APP vuelve a pedir su vista, así el canal no puede filtrar datos de otro rol. Cada 25 s el servidor revisa que la sesión siga vigente y, si no, avisa y cierra. Con varias instancias, el emisor en memoria (`lib/events.js`) se reemplaza por Redis Pub/Sub o `LISTEN/NOTIFY`.

### Mensajes

Correos y WhatsApp se guardan en la tabla `outbox` en la misma transacción que el cambio (patrón _transactional outbox_) y un despachador los envía con reintentos. Así no se pierde un aviso si el proveedor falla, ni se envía uno de un cambio que se revirtió. En modo `live` el cuerpo (que lleva enlaces y códigos) se borra después de enviarlo.

### APP

`data/store.jsx` elige el proveedor según `VITE_DATA_MODE`. Los dos (`data/api/ApiProvider.jsx` y `data/demo/DemoProvider.jsx`) exponen exactamente la misma forma (`root`, `db`, `me`, `session`, `actions`, `auth`, `accounts`, `platform`…) y todas las acciones devuelven promesas. Las pantallas esperan el resultado antes de mostrar "listo" y, si algo falla, el proveedor muestra el motivo que dio la API.

## Pruebas

- `packages/shared/test`: reglas puras (roles, pagos duplicados, reservas empalmadas, firma de QR, vistas por rol, contraseñas).
- `apps/api/test`: integración HTTP con la base en memoria: inicio de sesión, bloqueo, verificación en dos pasos, CSRF, activación de un solo uso, restablecimiento, permisos por rol, aislamiento entre residenciales, campos protegidos, Ecart Pay verificado e idempotente, suspensión de residenciales.

## Pendientes conocidos

- Web Push con la app cerrada (falta guardar suscripciones y enviar con VAPID desde la API).
- Archivos (fotos, comprobantes) viajan como _data URL_ dentro de los registros. Para volumen real conviene guardarlos en un almacenamiento de objetos (S3, R2) y enviar sólo la URL.
- Los endpoints de Ecart Pay del adaptador `live` deben confirmarse con la documentación de la cuenta.
