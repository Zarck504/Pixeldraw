-- =============================================
-- PixelDraw - Database Schema
-- Run this in the Supabase SQL Editor
-- =============================================

-- Tabla de píxeles del lienzo (200x200 = 40,000 posiciones)
CREATE TABLE IF NOT EXISTS pixels (
  x INT NOT NULL,
  y INT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  painted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (x, y)
);

-- Índice para consultar cuota del usuario (píxeles pintados en las últimas 12h)
CREATE INDEX IF NOT EXISTS idx_pixels_user_time ON pixels(user_id, painted_at);

-- Habilitar Row Level Security
ALTER TABLE pixels ENABLE ROW LEVEL SECURITY;

-- Cualquier persona (incluso no logueada) puede ver el lienzo
CREATE POLICY "Anyone can view the canvas"
  ON pixels FOR SELECT
  USING (true);

-- Solo usuarios autenticados pueden pintar
CREATE POLICY "Authenticated users can paint"
  ON pixels FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuarios autenticados pueden pintar encima (upsert)
CREATE POLICY "Authenticated users can paint over"
  ON pixels FOR UPDATE
  USING (true)
  WITH CHECK (auth.uid() = user_id);

-- Usuarios autenticados pueden borrar sus propios píxeles
CREATE POLICY "Authenticated users can delete"
  ON pixels FOR DELETE
  USING (auth.uid() = user_id);

-- Habilitar Realtime para la tabla pixels
ALTER PUBLICATION supabase_realtime ADD TABLE pixels;
