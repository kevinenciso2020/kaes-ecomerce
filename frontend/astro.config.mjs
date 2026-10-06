import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// Origen del API (PUBLIC_API_URL, obligatorio en el build) para connect-src.
const apiOrigin = (() => {
  try {
    return new URL(process.env.PUBLIC_API_URL).origin;
  } catch {
    return '';
  }
})();

export default defineConfig({
  // Dominio principal (p. ej. https://kaes-simplyeternal.co) para URLs
  // canónicas, Open Graph y sitemap. Sin él se usa el host de cada petición.
  site: process.env.SITE_URL || undefined,
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  security: {
    // Content Security Policy en un <meta> por página. Astro calcula el hash
    // de cada script que emite (incluida la hidratación de las islas React),
    // así que sólo se ejecuta JavaScript propio: un XSS inyectado no corre.
    // Los estilos permiten 'unsafe-inline' porque hay atributos style y
    // estilos de React/framer-motion (el riesgo real de XSS está en scripts).
    // frame-ancestors no se puede poner en <meta>: va como header en vercel.json.
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
        "img-src 'self' data: blob: https:",
        "font-src 'self' https://fonts.gstatic.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://checkout.wompi.co https://www.mercadopago.com.co",
      ],
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      },
    },
  },
});

// https://astro.build/config