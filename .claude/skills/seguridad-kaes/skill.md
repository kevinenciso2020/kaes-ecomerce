---
name: seguridad-kaes
description: Reglas de seguridad para manejar secretos, credenciales, cuentas admin, AGENTS.md/CLAUDE.md y commits. Úsala cuando se toquen .env, claves, tokens, contraseñas, configuración de auth, despliegues o rotación de credenciales.
---

# Seguridad para Kaes Store

## Secretos
- Nunca escribas secretos reales (contraseñas, API keys, tokens, cadenas de conexión) en AGENTS.md, CLAUDE.md, README, código, logs ni commits.
- Usa variables de entorno o un gestor de secretos. Los valores van en `.env`, y `.env` debe estar en `.gitignore`.
- Si encuentras un secreto expuesto, avisa de inmediato. No lo repitas en la respuesta: muestra solo los últimos 4 caracteres.
- Solo muestra ejemplos con placeholders como `<TU_API_KEY>`.

## Antes de cualquier commit
- Revisa los cambios buscando secretos (patrones de claves, `password=`, `token`, `BEGIN PRIVATE KEY`).
- Si el repo no tiene escáner, recomienda instalar `gitleaks` o `trufflehog` con un pre-commit hook.

## Credenciales y cuentas admin
- Nunca cambies, rotes ni elimines credenciales admin sin confirmación explícita del usuario en ese mismo turno.
- Antes de rotar, lista el plan: qué credencial, dónde se usa, qué servicios se afectan y cómo revertir.
- Ejecuta la rotación solo con el paso de confirmación. Al terminar, verifica que el acceso nuevo funcione y que el anterior ya no.
- Prefiere cuentas con mínimos privilegios y activa 2FA en cuentas admin.

## Acciones de riesgo (pedir confirmación)
- Borrar archivos o ramas, `git push --force`, cambios en `.env`, de producción o de auth.
- Desplegar a producción.
- Cualquier comando que envíe datos a un servicio externo.

## Respuesta esperada
- Explica el riesgo en una línea y ofrece la alternativa segura.
- Da el contenido completo del archivo corregido, no solo fragmentos.