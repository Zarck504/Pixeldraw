-- TABLA DE USUARIOS BANEADOS
CREATE TABLE IF NOT EXISTS banned_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- PROTECCIÓN EN EL LIENZO PARA USUARIOS BANEADOS
-- Primero eliminamos la política anterior de inserción que permitía a todos los autenticados pintar
DROP POLICY IF EXISTS "Authenticated users can paint" ON pixels;
-- Y la reemplazamos por una que verifica que NO estén en la tabla banned_users
CREATE POLICY "Authenticated users can paint"
  ON pixels FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND 
    NOT EXISTS (SELECT 1 FROM banned_users WHERE user_id = auth.uid())
  );

-- Igual para actualizar (por si pintan encima)
DROP POLICY IF EXISTS "Authenticated users can paint over" ON pixels;
CREATE POLICY "Authenticated users can paint over"
  ON pixels FOR UPDATE
  USING (true)
  WITH CHECK (
    auth.uid() = user_id AND 
    NOT EXISTS (SELECT 1 FROM banned_users WHERE user_id = auth.uid())
  );

-- FUNCION 1: Obtener todos los usuarios y sus estadísticas (SOLO PARA ADMIN)
CREATE OR REPLACE FUNCTION get_admin_users_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios de administrador para poder leer auth.users
AS $$
DECLARE
    requester_email TEXT;
    result JSON;
BEGIN
    -- Verificar que el solicitante es el administrador autorizado
    requester_email := current_setting('request.jwt.claims', true)::json->>'email';
    
    IF requester_email != '0131juanpablo@gmail.com' THEN
        RAISE EXCEPTION 'No autorizado. Solo el administrador puede ver esto.';
    END IF;

    -- Consultar todos los usuarios, cruzar con pixels y banned_users
    SELECT COALESCE(json_agg(
        json_build_object(
            'id', u.id,
            'email', u.email,
            'username', u.raw_user_meta_data->>'username',
            'is_banned', EXISTS(SELECT 1 FROM banned_users b WHERE b.user_id = u.id),
            'used_pixels', (
                SELECT count(*) 
                FROM pixels p 
                WHERE p.user_id = u.id AND p.painted_at >= (now() - interval '12 hours')
            ),
            'oldest_pixel_at', (
                SELECT min(p.painted_at) 
                FROM pixels p 
                WHERE p.user_id = u.id AND p.painted_at >= (now() - interval '12 hours')
            )
        )
    ), '[]'::json) INTO result
    FROM auth.users u;

    RETURN result;
END;
$$;

-- FUNCION 2: Resetear los píxeles de un usuario (SOLO PARA ADMIN)
DROP FUNCTION IF EXISTS admin_reset_user_pixels(UUID);
DROP FUNCTION IF EXISTS admin_reset_user_pixels();
CREATE OR REPLACE FUNCTION admin_clear_user_pixels(p_target_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    requester_email TEXT;
BEGIN
    -- Validar autenticación admin
    requester_email := current_setting('request.jwt.claims', true)::json->>'email';
    IF requester_email != '0131juanpablo@gmail.com' THEN
        RAISE EXCEPTION 'No autorizado.';
    END IF;

    -- Envejecemos los píxeles pintados en las últimas 12h del usuario especifico 
    -- usando comillas explícitas para prevenir colisiones de nombres de columna
    UPDATE public.pixels 
    SET painted_at = now() - interval '13 hours' 
    WHERE public.pixels.user_id = p_target_uuid 
      AND public.pixels.painted_at >= (now() - interval '12 hours');

    RETURN TRUE;
END;
$$;

-- FUNCION 3: Banear / Desbanear a un usuario (SOLO PARA ADMIN)
CREATE OR REPLACE FUNCTION admin_toggle_ban_user(target_user_id UUID, ban BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    requester_email TEXT;
BEGIN
    -- Validar autenticación admin
    requester_email := current_setting('request.jwt.claims', true)::json->>'email';
    IF requester_email != '0131juanpablo@gmail.com' THEN
        RAISE EXCEPTION 'No autorizado.';
    END IF;

    IF ban THEN
        INSERT INTO banned_users (user_id) VALUES (target_user_id) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM banned_users WHERE user_id = target_user_id;
    END IF;

    RETURN TRUE;
END;
$$;
