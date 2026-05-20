# Hotfix v20 · Publish/Validate Journey Builder

Este parche corrige el error genérico de Journey Builder:

`A custom activity or entry source failed validation. Check to ensure that the activity or entry source publishes to a valid endpoint.`

Cambios:
- `/save`, `/validate` y `/publish` responden HTTP 200 por defecto para que Journey Builder no marque el endpoint como inválido por una validación de negocio.
- Los errores de configuración se devuelven como `warnings` y se registran en logs de Render.
- Se añade `ACTIVITY_VALIDATION_STRICT=true` para quien quiera volver a bloquear publicación desde backend con HTTP 400.
- Se mejora la extracción de `inArguments` cuando Journey Builder envuelve el payload en `activity.arguments.execute.inArguments`.
- Se añaden respuestas GET/HEAD útiles para `/save`, `/validate`, `/publish`, `/stop` y `/execute`.
- Se actualiza el cache-buster a `publish-validation-v20`.

Recomendado en Render:
`ACTIVITY_VALIDATION_STRICT=false` o no configurar esa variable.
