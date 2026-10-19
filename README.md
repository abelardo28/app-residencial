# App Residencial

Aplicación web en React (Vite) para administrar un residencial o condominio. Tiene tres roles dentro de cada residencial: **residentes**, **vigilancia** y **administración**, y un **portal de empresa** aparte para quien vende el servicio y administra varias residencias.

La versión actual funciona sin backend: todos los datos viven en el navegador (`localStorage`) con información de ejemplo, así que puedes probar todos los flujos de inmediato. Si abres la app en dos pestañas (por ejemplo, residente en una y vigilante en otra), las notificaciones llegan en tiempo real de una a otra.

## Cómo ejecutarla

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # versión de producción en dist/
```

### Cuentas de demostración

| Acceso | Correo | Contraseña |
|---|---|---|
| Administración (pide código) | admin@residencial.mx | Demo#2026 |
| Vigilancia | caseta@residencial.mx | Demo#2026 |
| Residente | ana@correo.mx | Demo#2026 |
| Otro residencial (pide código) | admin@losrobles.mx | Demo#2026 |
| Portal de empresa (pide código) | empresa@residencial.cloud | Empresa#2026 |

Los correos y WhatsApp que enviaría el servidor aparecen en el **Buzón de prueba** (botón arriba a la derecha). Ahí están los códigos de verificación y la invitación pendiente de *Mariana López* (código `739154`) para probar la activación. Puedes restablecer los datos en **Configuración → Restablecer demo**.

La cámara (escáner QR y foto de placa) sólo funciona en `localhost` o con HTTPS.

## Funciones

### Control de acceso
- **Pases con QR y código corto** de 6 caracteres que expiran solos. Tres modos:
  - *Una sola entrada*: deja de servir después del primer uso.
  - *Varias entradas*: un número limitado de usos dentro de la vigencia.
  - *Recurrente*: para personal doméstico o trabajadores, con días y horario permitidos (por ejemplo, lunes, miércoles y viernes de 8:00 a 17:00).
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

Cada residencial muestra una foto de su fachada de fondo, con transparencia, en el encabezado de residentes, vigilancia y administración. El administrador la cambia o la quita en **Configuración → Foto de portada**. La demo incluye una ilustración de ejemplo (`public/portada-demo.jpg`).

## Inicio de sesión y seguridad

- **No hay registro abierto.** La empresa crea cada residencial y a su administrador; el administrador crea a residentes, vigilantes y otros administradores.
- **Activación con dos canales.** Al crear una cuenta no se asigna contraseña. Se envía un **enlace por correo** (token aleatorio de 256 bits) y un **código de 6 dígitos por WhatsApp**. Para activar se necesitan los dos, así que robar uno solo no basta. Vencen en 48 horas, sirven una vez y la invitación se anula tras 5 códigos incorrectos. Sólo se guardan sus hashes.
- **Contraseña robusta** creada por la propia persona: 10 caracteres o más, mayúsculas, minúsculas, número y símbolo, sin su nombre ni palabras comunes. Se guarda con PBKDF2-SHA256 (120 000 iteraciones y sal única).
- **Recuperación sólo por un administrador.** "¿Olvidaste tu contraseña?" explica que debe pedírselo a la administración. Al restablecer, la contraseña anterior deja de funcionar, se cierran sus sesiones y se envía un nuevo enlace + código.
- **Verificación en dos pasos** (código por WhatsApp y correo, 5 minutos) para administradores y personal de la empresa.
- **Bloqueo** de 15 minutos tras 5 contraseñas incorrectas, con aviso por correo. El administrador puede desbloquear.
- Mensaje de error genérico y tiempo de respuesta uniforme para no revelar qué correos existen.
- **Sesiones** de 8 horas máximo, cierre por 30 minutos de inactividad y cierre inmediato si la cuenta se suspende, se restablece o se suspende su residencial.
- **Auditoría**: inicios de sesión, intentos fallidos, bloqueos, invitaciones, restablecimientos y operaciones del portal.
- El portal de empresa tiene un acceso separado: las cuentas de residenciales no entran ahí y la cuenta de la empresa no entra por el acceso de residentes.

### Portal de empresa
- **Resumen**: residencias activas, ingreso mensual, cobrado del mes, por cobrar y actividad reciente.
- **Residencias**: alta de residencial con su administrador (recibe invitación), cambio de plan, suspensión o reactivación del servicio con motivo, y gestión de todas sus cuentas (reenviar invitación, restablecer contraseña, suspender, desbloquear).
- **Cobranza**: generar los cargos del mes, registrar pagos (transferencia, efectivo, tarjeta, Ecart Pay), enviar recordatorios, cancelar cargos y suspender morosos por días de atraso.
- **Planes**: precio mensual y número máximo de unidades.
- **Auditoría** filtrable por residencial, alertas y texto.

### Para producción
En la demo la seguridad corre en el navegador para poder probarla sin servidor. En producción todo esto debe vivir en el backend:
- Hash de contraseñas con **Argon2id** (o PBKDF2 con 600 000 iteraciones) y comparación en el servidor.
- Sesión en **cookie HttpOnly, Secure y SameSite=Strict**, con rotación y revocación del lado del servidor.
- Límite de intentos por cuenta **y por IP**, y CAPTCHA tras varios fallos.
- Correo con un proveedor transaccional (Amazon SES, SendGrid, Resend) con SPF, DKIM y DMARC.
- WhatsApp con la **WhatsApp Business Cloud API** usando plantillas de la categoría *Autenticación* aprobadas por Meta (`src/services/messaging.js` ya define los textos).
- Cuentas de la empresa separadas por dominio o subdominio (por ejemplo `empresa.tu-dominio.mx`) y, si se puede, llaves de seguridad (WebAuthn) para ellas.

## Análisis de competidores y diferenciadores

Revisé las apps más usadas en México y Latinoamérica: **Neivor**, **Vivook**, **Residentia** y **ComunidadFeliz**. Como referencia internacional, también **BuildingLink** y **ButterflyMX**. Casi todas cubren lo básico: QR de acceso, cobranza y avisos. Para diferenciarse, esta app agrega:

| Diferenciador | Por qué importa |
|---|---|
| **OCR de placas en el navegador** | La mayoría pide escribir la placa a mano o requiere cámaras LPR costosas. Aquí basta el celular del vigilante. |
| **Alerta de placa distinta** | Detecta suplantaciones: el pase indicaba una placa y llegó otra. |
| **Pases recurrentes con horario** | Personal doméstico, jardineros o niñeras sin generar un código cada día. |
| **Pases de varias entradas** | Fiestas, mudanzas o proveedores que entran y salen. |
| **Botón SOS** | Alerta inmediata a caseta y administración con el domicilio (emergencia médica, robo, incendio…). |
| **Paquetería con código de entrega** | El paquete se entrega sólo a quien tiene el código de 4 dígitos que recibió el residente. |
| **Reservas de áreas comunes sin choques** | Valida horario, aforo y empalmes, e informa el depósito. |
| **Reportes de mantenimiento con seguimiento** | Con foto, estados y comentarios entre residente y administración. |
| **Votaciones digitales** | Resultados en vivo y participación, útiles para asambleas. |
| **Transparencia financiera** | Los residentes ven ingresos, gastos por categoría y balance del mes, lo que suele reducir la morosidad. |
| **Confirmación de lectura y asistencia** | El administrador sabe quién leyó cada aviso y quién asistirá a la reunión. |

## Integraciones (para pasar a producción)

Copia `.env.example` a `.env` y completa los valores.

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL de tu backend. Si no se define, Ecart Pay y el envío de correo y WhatsApp funcionan en modo de prueba (buzón de prueba). |
| `VITE_VAPID_PUBLIC_KEY` | Llave pública VAPID para Web Push. |
| `VITE_ACCESS_SECRET` | Sólo para la demo. En producción la firma de los pases se hace en el servidor. |

### Ecart Pay (`src/services/ecartpay.js`)
Las llaves de Ecart Pay **nunca** deben estar en el navegador. El backend necesita:
1. `POST /payments/ecartpay/checkout`: crea la orden en Ecart Pay con tus llaves y devuelve `{ id, checkoutUrl }`.
2. `GET /payments/ecartpay/checkout/:id`: devuelve `{ status: 'paid' | 'pending' | 'failed' }`.
3. Un **webhook** de Ecart Pay que marque el pago como aprobado y envíe las notificaciones.

### Notificaciones push (`src/services/push.js`, `public/sw.js`)
El service worker ya muestra notificaciones y abre la sección correcta al tocarlas. Para enviarlas con la app cerrada, el backend debe guardar la suscripción (`POST /push/subscribe`) y mandar el push con la llave VAPID privada.

### Códigos de acceso (`src/services/access.js`)
En producción, la generación y validación de pases debe pasar al servidor (HMAC-SHA256 con una clave secreta), y el registro de usos debe ser atómico para que un código de un solo uso no pueda entrar dos veces.

### OCR (`src/services/ocr.js`)
Usa tesseract.js con los archivos servidos desde `public/ocr`, que se copian solos al ejecutar `npm run dev` o `npm run build`. Las fotos de cerca, de frente y con buena luz dan mejores resultados. Si después quieres más precisión con poca luz o en ángulo, se puede cambiar por un servicio de LPR (por ejemplo, Plate Recognizer) sin cambiar la pantalla.

### Datos (`src/data/store.jsx`)
Las operaciones están en `auth` (inicio de sesión, verificación y activación), `accounts` (alta y seguridad de cuentas), `platform` (portal de empresa) y `actions` (todo lo del residencial). Para conectar una API real, reemplaza cada función por la llamada correspondiente. Las pantallas no cambian.

## Estructura

```
src/
  App.jsx                rutas, permisos por rol y portal
  data/seed.js           datos de ejemplo (dos residenciales y la empresa)
  data/store.jsx         estado, sesión, cuentas, portal y acciones
  services/              security (hash, códigos), messaging (correo/WhatsApp), access, ocr, ecartpay, push
  components/            Layout, UI base, cuentas, buzón de prueba, escáner QR, captura de placa, SOS
  pages/auth/            inicio de sesión, verificación en dos pasos y activación
  pages/portal/          portal de empresa
  pages/                 una pantalla por sección del residencial
```
