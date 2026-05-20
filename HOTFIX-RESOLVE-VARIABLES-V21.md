# Hotfix v21 - Resolución de variables dinámicas

Problema corregido: Journey Builder estaba sustituyendo placeholders propios como `{{Nombre}}` dentro del HTML guardado en `inArguments` antes de llamar a `/execute`, por lo que el backend recibía `Hola ` en lugar de `Hola {{Nombre}}`.

Cambios:
- El frontend guarda subject, preheader, HTML y texto en Base64 dentro de `config.encodedContent`.
- El backend decodifica `config.encodedContent` en `/execute`, `/save`, `/validate` y `/publish`.
- Los valores de Journey/Contact Data siguen saliendo como argumentos planos `var_<Variable>`.
- Se añade fallback para usar `mapping.path` si Journey Builder lo envía ya resuelto.

Después de desplegar:
1. Verificar que `/config.json` contiene `/index.html?v=resolve-vars-v21`.
2. Forzar caché en Installed Package con `/config.json?v=resolve-vars-v21`.
3. Borrar la actividad antigua del canvas.
4. Arrastrar y configurar una actividad nueva.
5. Validar/activar el Journey.
