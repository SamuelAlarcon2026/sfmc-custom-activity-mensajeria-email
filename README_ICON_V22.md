# Hotfix icono v22 - listo para copiar en el repo

Copia el contenido de este ZIP sobre la raíz de tu repositorio.

Incluye:
- `public/images/icon.png`
- `public/images/icon-v22.png`
- `public/images/icon-128.png`
- `public/images/icon-64.png`
- `src/routes/journey.js` con `metaData.icon` apuntando a:
  `${base}/images/icon-v22.png?v=icon-v22`

Después:
```bash
git add public/images src/routes/journey.js
git commit -m "chore: update Journey Builder activity icon"
git push
```

En Render:
Manual Deploy > Clear build cache & deploy

Comprueba:
https://sfmc-custom-activity-mensajeria-email.onrender.com/config.json

Debe aparecer:
"icon": "https://sfmc-custom-activity-mensajeria-email.onrender.com/images/icon-v22.png?v=icon-v22"

Si SFMC no refresca el icono, cambia temporalmente el endpoint del Installed Package a:
https://sfmc-custom-activity-mensajeria-email.onrender.com/config.json?v=icon-v22
