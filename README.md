# Torneo de Futbolito — app independiente

Esta es la misma app que ya tenías en Claude, pero convertida en un sitio web
propio con base de datos real (Supabase) y login real por correo (enlace
mágico, sin contraseñas). Se despliega gratis en Vercel.

## Qué necesitas crear (todo gratis)

1. Una cuenta en **[supabase.com](https://supabase.com)** → base de datos + login.
2. Una cuenta en **[github.com](https://github.com)** → para guardar el código.
3. Una cuenta en **[vercel.com](https://vercel.com)** → para publicar el sitio.

## Paso 1 — Crear el proyecto en Supabase

1. Entra a supabase.com, crea una cuenta y luego un **New project**.
2. Ponle cualquier nombre y una contraseña de base de datos (guárdala, no la
   necesitarás para esta app, pero Supabase la pide).
3. Cuando el proyecto termine de crearse, ve a **SQL Editor** (menú
   izquierdo) → **New query**.
4. Abre el archivo `supabase-schema.sql` de esta carpeta, copia TODO su
   contenido, pégalo ahí y dale a **Run**. Esto crea la tabla del torneo y
   los permisos.
5. Ve a **Project Settings → API**. Ahí vas a ver:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public key** (una clave larga)

   Guarda esos dos valores, los necesitas en el Paso 3.

## Paso 2 — Subir el código a GitHub (sin usar terminal)

1. Entra a github.com, crea una cuenta si no tienes.
2. Haz clic en **New repository**. Ponle un nombre (ej. `torneo-futbolito`) y
   créalo como **Private** o **Public**, como prefieras.
3. Dentro del repo vacío, haz clic en **uploading an existing file**.
4. Arrastra TODOS los archivos y carpetas de este proyecto (menos la carpeta
   `node_modules` si la llegaras a tener) y dale a **Commit changes**.

## Paso 3 — Publicar en Vercel

1. Entra a vercel.com y crea una cuenta usando tu cuenta de GitHub (botón
   "Continue with GitHub"). Esto conecta ambas automáticamente.
2. Haz clic en **Add New → Project** y elige el repositorio que acabas de
   subir.
3. Antes de darle a "Deploy", abre **Environment Variables** y agrega:
   - `VITE_SUPABASE_URL` → pega el Project URL del Paso 1
   - `VITE_SUPABASE_ANON_KEY` → pega el anon public key del Paso 1
4. Dale a **Deploy** y espera un minuto. Al terminar te da una URL tipo
   `https://tu-proyecto.vercel.app` — esa es tu app ya publicada.

## Paso 4 — Conectar el login con tu URL final

1. Copia la URL que te dio Vercel.
2. En Supabase, ve a **Authentication → URL Configuration**.
3. En **Site URL** pega esa URL.
4. En **Redirect URLs** agrega esa misma URL (y opcionalmente
   `http://localhost:5173` si algún día pruebas el proyecto en tu compu).
5. Guarda los cambios.

## Paso 5 — Usar la app

1. Abre tu URL de Vercel.
2. Haz clic en **Hacer login**, escribe tu correo y pulsa "Enviar enlace de
   acceso".
3. Revisa tu correo (puede tardar 1-2 minutos) y haz clic en el enlace.
4. Volverás a la app ya con sesión iniciada. Como todavía nadie es
   organizador, verás un botón **"Registrarme como organizador"** en la
   barra lateral — haz clic ahí y listo: ese correo queda como el único que
   puede editar equipos, jugadores, partidos y sanciones.

Cualquier otra persona que abra la misma URL puede ver todo, pero solo podrá
editar si inicia sesión con exactamente ese mismo correo.

## Desarrollo local (opcional, si quieres probar en tu computadora)

```
npm install
cp .env.example .env   # y completa con tus valores de Supabase
npm run dev
```

## Notas importantes

- El login es real (Supabase envía el correo y verifica que sea tuyo), pero
  cualquier persona que también inicie sesión con SU propio correo real
  técnicamente podría llamar a la base de datos directamente y modificar
  datos, aunque la app solo le muestre botones de edición al correo
  organizador. Para un torneo amistoso esto es suficiente; si algún día
  necesitas más control, se pueden agregar permisos más finos en Supabase.
- Si quieres cambiar quién es el organizador, puedes hacerlo desde
  **Configuración → Correo del organizador** (estando logueado como
  organizador actual).
