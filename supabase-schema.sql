-- ============================================================
-- Ejecuta TODO este archivo en Supabase: Project → SQL Editor → New query
-- Pega el contenido completo y dale a "Run".
-- ============================================================

-- 1) Tabla donde vive todo el torneo (una sola fila con id = 1)
create table if not exists tournament_data (
  id int primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- 2) Fila inicial con el torneo vacío (no lo toques si ya existe)
insert into tournament_data (id, data)
values (
  1,
  '{
    "meta": {
      "name": "Jornadas de Futbolito 2026",
      "category": "Futbolito",
      "organizerName": "",
      "startDate": "",
      "endDate": "",
      "description": "Campeonato de futbolito jugado entre los equipos participantes.",
      "rules": "",
      "pointsWin": 3, "pointsDraw": 1, "pointsLoss": 0,
      "yellowLimit": 3, "redSuspensionMatches": 1, "playoffSpots": 4, "relegationSpots": 0,
      "adminEmail": ""
    },
    "teams": [],
    "players": [],
    "matches": [],
    "playoffMatches": []
  }'::jsonb
)
on conflict (id) do nothing;

-- 3) Seguridad: cualquiera puede LEER el torneo, pero solo alguien con
--    sesión iniciada (haber hecho login con el enlace de correo) puede EDITARLO.
alter table tournament_data enable row level security;

drop policy if exists "cualquiera puede leer" on tournament_data;
create policy "cualquiera puede leer"
  on tournament_data for select
  using (true);

drop policy if exists "solo con sesion puede editar" on tournament_data;
create policy "solo con sesion puede editar"
  on tournament_data for update
  using (auth.role() = 'authenticated');

-- 4) Activar actualizaciones en vivo (para que todos vean los cambios
--    del organizador sin tener que recargar la página).
alter publication supabase_realtime add table tournament_data;

-- Listo. Con esto la tabla y los permisos ya quedan configurados.
