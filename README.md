# SFMC Private Relay Custom Activity

Custom Activity para Salesforce Marketing Cloud Journey Builder que envía emails mediante un relay privado, usando contenido creado en SFMC Content Builder y **snapshot al publicar**.

## Qué incluye esta v0.1

- Frontend de Custom Activity para Journey Builder.
- Backend Node.js/Express listo para Render.
- `config.json` generado dinámicamente con `PUBLIC_BASE_URL`.
- Endpoints:
  - `GET /config.json`
  - `GET /health`
  - `POST /save`
  - `POST /validate`
  - `POST /publish`
  - `POST /execute`
  - `POST /stop`
  - `POST /preview`
  - `POST /test`
  - `POST /webhook/relay`
- Snapshot del contenido en `/publish`.
- Renderizado de tokens `{{token}}`.
- Defaults tipo `{{firstName | default: "cliente"}}`.
- Integración con SFMC Content Builder vía REST API.
- Mock de relay para poder probar sin API real.
- Adapter HTTP para conectar el relay real cuando esté definido.
- Logs hacia las DEs:
  - `Relay_Email_SendLog`
  - `Relay_Email_Events`
  - `Relay_Email_ActivityConfig`

## Decisión de contenido

Esta versión usa **snapshot al publicar**:

```text
El usuario configura un Content Asset ID.
Al publicar el journey, el backend descarga el HTML desde Content Builder.
Se guarda un snapshot local persistente.
Cada ejecución usa ese snapshot, aunque el asset cambie después en SFMC.
```

Esto evita que un cambio accidental en Content Builder afecte journeys ya publicados.

## Requisitos en SFMC

Necesitas un Installed Package con estos componentes:

### 1. Journey Builder Activity

Configura el endpoint de la actividad como:

```text
https://TU-SERVICIO-RENDER.onrender.com/config.json
```

Cuando Render esté desplegado, ese endpoint devolverá la configuración completa de la Custom Activity.

### 2. API Integration Server-to-Server

Permisos mínimos recomendados:

- Assets: Read
- Data Extensions: Read
- Data Extensions: Write

Guarda estos datos para las variables de entorno:

```text
SFMC_CLIENT_ID
SFMC_CLIENT_SECRET
SFMC_AUTH_BASE_URL
SFMC_REST_BASE_URL
SFMC_ACCOUNT_ID opcional
```

### 3. JWT signing secret

Configura:

```text
JWT_SIGNING_SECRET
```

Debe corresponder al secreto con el que Journey Builder firma los payloads JWT de la Custom Activity. En muchos paquetes coincide con el client secret del componente/app, pero conviene revisarlo en el Installed Package.

## Requisitos en Render

## Fix Render: `EACCES: permission denied, mkdir '/data'`

Si ves este error en Render:

```text
Unable to initialize data directory: Error: EACCES: permission denied, mkdir '/data'
```

significa que `DATA_DIR=/data` está configurado, pero el servicio no tiene un persistent disk montado en `/data` o Render no lo ha aplicado al servicio actual.

Opciones:

1. Para desbloquear el deploy rápido, usa:

```bash
DATA_DIR=./data
```

Esto permite arrancar, pero el almacenamiento puede ser efímero en redeploys.

2. Para producción, crea/adjunta un persistent disk en Render:

```text
Mount path: /data
```

y entonces usa:

```bash
DATA_DIR=/data
```

Desde la versión `0.1.1`, la app no se cae si `/data` no es writable: hace fallback a un directorio escribible y lo muestra en `/health`. Aun así, para snapshots publicados en journeys reales, se recomienda persistent disk.

Crea un Web Service de Node.js.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Runtime:

```text
Node 20+
```

Añade un persistent disk:

```text
Mount path: /data
Size: 1 GB para empezar
```

Esto es importante porque los snapshots se guardan fuera del filesystem efímero.

## Variables de entorno

Copia `.env.example` y configura:

```bash
PUBLIC_BASE_URL=https://TU-SERVICIO-RENDER.onrender.com

JWT_SIGNING_SECRET=xxxxx
JWT_REQUIRED=true

DATA_DIR=/data

SFMC_CLIENT_ID=xxxxx
SFMC_CLIENT_SECRET=xxxxx
SFMC_AUTH_BASE_URL=https://xxxx.auth.marketingcloudapis.com
SFMC_REST_BASE_URL=https://xxxx.rest.marketingcloudapis.com
SFMC_ACCOUNT_ID=123456789

DE_SEND_LOG_KEY=Relay_Email_SendLog
DE_EVENTS_KEY=Relay_Email_Events
DE_ACTIVITY_CONFIG_KEY=Relay_Email_ActivityConfig

RELAY_MODE=mock
UI_ENDPOINTS_ALLOW_UNSIGNED=true
ENABLE_TEST_SEND=false
```

Cuando exista el relay real:

```bash
RELAY_MODE=http
RELAY_SEND_URL=https://relay.empresa.com/email/send
RELAY_AUTH_TOKEN=xxxxx
ENABLE_TEST_SEND=true # solo cuando quieras permitir test real desde el modal
```

## Convención de tokens

En el HTML de Content Builder usa tokens simples:

```html
Hola {{firstName}},
tu código es {{promoCode}}.
```

También puedes usar defaults:

```html
Hola {{firstName | default: "cliente"}},
```

Los tokens se mapean en la pantalla de la Custom Activity.

## Uso en Journey Builder

1. Arrastra la Custom Activity al journey.
2. Indica:
   - Nombre de actividad.
   - Content Asset ID.
   - Subject.
   - Preheader.
   - From Name.
   - From Email.
   - Reply-To.
   - Mapeos de tokens.
3. Valida.
4. Haz preview/test.
5. Publica el journey.

Al publicar, el backend hace el snapshot del HTML.

## Formato del mapeo de tokens

En la UI de esta v0.1 el mapeo se introduce como JSON:

```json
{
  "emailAddress": "{{Contact.Attribute.Profile.EmailAddress}}",
  "firstName": "{{Contact.Attribute.Profile.FirstName}}",
  "country": "{{Contact.Attribute.Profile.Country}}",
  "promoCode": "{{Contact.Attribute.Coupons.PromoCode}}"
}
```

`emailAddress` es obligatorio.

El backend transforma ese mapeo en `inArguments` para que Journey Builder resuelva los valores en cada contacto.

## Endpoint /execute

Journey Builder llamará a `/execute` para cada contacto.

El backend:

1. Valida JWT.
2. Recupera la configuración publicada.
3. Recupera el snapshot.
4. Sustituye tokens con los datos del contacto.
5. Construye el payload final.
6. Envía al relay.
7. Registra el resultado.
8. Responde a Journey Builder.

## Payload enviado al relay

Ejemplo:

```json
{
  "messageId": "sfmc-journey123-version4-activity789-003ABC123",
  "recipient": {
    "email": "laura@example.com",
    "contactKey": "003ABC123"
  },
  "sender": {
    "fromName": "Mi Marca",
    "fromEmail": "noreply@mi-marca.com",
    "replyTo": "soporte@mi-marca.com"
  },
  "content": {
    "subject": "Hola Laura",
    "preheader": "Tu promoción está disponible",
    "html": "<html>...</html>",
    "text": "Hola Laura..."
  },
  "tracking": {
    "openTracking": true,
    "clickTracking": true
  },
  "metadata": {
    "source": "SFMC",
    "businessUnitId": "123456789",
    "journeyId": "journey123",
    "journeyVersionId": "version4",
    "activityId": "activity789",
    "activityName": "Relay Email"
  }
}
```

## Webhooks del relay

El endpoint es:

```text
POST /webhook/relay
```

Payload esperado:

```json
{
  "providerMessageId": "relay-789",
  "messageId": "sfmc-journey123-version4-activity789-003ABC123",
  "eventType": "delivered",
  "eventDate": "2026-05-14T10:30:00Z",
  "recipient": "laura@example.com"
}
```

Se insertará en `Relay_Email_Events`.

## Desarrollo local

```bash
cp .env.example .env
npm install
npm run check
npm start
```

Con `RELAY_MODE=mock`, `/test` y `/execute` no enviarán emails reales.

## Limitaciones de esta v0.1

- El selector de assets es manual por `Content Asset ID`.
- La UI de mapeo usa JSON para acelerar el MVP.
- El snapshot se guarda en disco persistente de Render; para alta disponibilidad conviene migrarlo a Postgres/S3.
- El renderizador soporta tokens y defaults, no lógica AMPscript.
- No renderiza Dynamic Content nativo de SFMC.
- El tracking de opens/clicks depende del relay o de una futura capa de click wrapping.

## Siguiente iteración recomendada

- Selector visual de Content Builder.
- Escaneo automático de tokens desde el asset.
- UI visual para mapping.
- Snapshot en Postgres/S3.
- Click wrapping propio.
- Dashboard de logs.
- Reprocesamiento de fallidos.


## Nota de seguridad sobre Preview/Test

Los botones `Preview` y `Enviar test` se llaman desde el iframe del modal. En esta v0.1 se permite `UI_ENDPOINTS_ALLOW_UNSIGNED=true` para facilitar el MVP, porque esos botones no reciben el JWT de Journey Builder como `/publish` o `/execute`.

Para un endurecimiento real antes de producción:

```text
UI_ENDPOINTS_ALLOW_UNSIGNED=false
```

y sustituir esos botones por una validación basada en token de usuario, gateway autenticado o una capa propia de sesión. Además, `ENABLE_TEST_SEND=false` evita que el botón de test envíe al relay real aunque `RELAY_MODE=http`.

## Changelog

### 0.1.1

- Corrige fallo de deploy en Render cuando `DATA_DIR=/data` no es escribible.
- Añade fallback automático a un directorio writable.
- Añade `dataDir` en `/health`.
- Actualiza `.env.example` para usar `./data` como primer deploy seguro.
