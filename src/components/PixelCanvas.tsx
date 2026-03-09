import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { usePixelQuota } from '../hooks/usePixelQuota';
import UserSidebar from './UserSidebar';
import AdminPanel from './AdminPanel';
import '../styles/Canvas.css';

// Canvas config
const GRID_SIZE = 200; // 200x200 pixels
const PIXEL_SIZE = 4;  // Each pixel is 4px on the internal canvas
const CANVAS_PX = GRID_SIZE * PIXEL_SIZE; // 800px internal
const BG_COLOR = '#ffffff';
const GRID_COLOR = 'rgba(0, 0, 0, 0.70)'; // 70% de opacidad
const PIXEL_COLOR = '#000000';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;

// Icons for the legend
const MouseLeftIcon = () => <img src="/clicizquierdo.png" alt="Clic izquierdo" className="legend-img-icon" />;
const MouseRightIcon = () => <img src="/clicderecho.png" alt="Clic derecho" className="legend-img-icon" />;
const MouseMiddleIcon = () => <img src="/scrollwheel.png" alt="Arrastrar" className="legend-img-icon" />;
const MouseScrollIcon = () => <img src="/scroll.png" alt="Scroll" className="legend-img-icon" />;

interface PixelData {
  [key: string]: boolean; // "x,y" -> true
}

export default function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { user, initialize, loading: authLoading } = useAuthStore();
  const { remaining, total, cooldownText, loading: quotaLoading, decrementLocal, incrementLocal, refetch } = usePixelQuota();

  const [pixels, setPixels] = useState<PixelData>({});
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: -1, y: -1 });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'warn' } | null>(null);

  const isAdmin = user?.email === '0131juanpablo@gmail.com';

  // Initialize auth
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = '/auth';
    }
  }, [authLoading, user]);

  // Load all pixels from Supabase
  useEffect(() => {
    const loadPixels = async () => {
      const { data } = await supabase.from('pixels').select('x, y');
      if (data) {
        const pixelMap: PixelData = {};
        data.forEach(p => { pixelMap[`${p.x},${p.y}`] = true; });
        setPixels(pixelMap);
      }
    };
    loadPixels();
  }, []);

  // Subscribe to realtime pixel inserts/updates/deletes
  useEffect(() => {
    const channel = supabase
      .channel('pixels-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pixels' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object' && 'x' in payload.new && 'y' in payload.new) {
            const { x, y } = payload.new as { x: number; y: number };
            setPixels(prev => ({ ...prev, [`${x},${y}`]: true }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pixels' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object' && 'x' in payload.new && 'y' in payload.new) {
            const { x, y } = payload.new as { x: number; y: number };
            setPixels(prev => ({ ...prev, [`${x},${y}`]: true }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'pixels' },
        (payload) => {
          if (payload.old && typeof payload.old === 'object' && 'x' in payload.old && 'y' in payload.old) {
            const { x, y } = payload.old as { x: number; y: number };
            setPixels(prev => {
              const next = { ...prev };
              delete next[`${x},${y}`];
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // Draw grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * PIXEL_SIZE;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, CANVAS_PX);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(CANVAS_PX, pos);
      ctx.stroke();
    }

    // Draw pixels
    ctx.fillStyle = PIXEL_COLOR;
    Object.keys(pixels).forEach(key => {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
    });

    // Draw hover highlight
    if (mousePos.x >= 0 && mousePos.x < GRID_SIZE && mousePos.y >= 0 && mousePos.y < GRID_SIZE) {
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        mousePos.x * PIXEL_SIZE + 0.5,
        mousePos.y * PIXEL_SIZE + 0.5,
        PIXEL_SIZE - 1,
        PIXEL_SIZE - 1
      );
    }
  }, [pixels, mousePos]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Center canvas initially
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    
    // Un zoom inicial más modesto para que se vea más área de la cuadrícula si cabe
    setZoom(1); 
    
    const rect = wrapper.getBoundingClientRect();
    // Centrar basado en el tamaño físico del canvas renderizado
    setOffset({
      x: (rect.width - CANVAS_PX) / 2,
      y: (rect.height - CANVAS_PX) / 2,
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Convert screen coordinates to grid coordinates
  const screenToGrid = useCallback((clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return { x: -1, y: -1 };
    const rect = wrapper.getBoundingClientRect();
    const canvasX = (clientX - rect.left - offset.x) / zoom;
    const canvasY = (clientY - rect.top - offset.y) / zoom;
    const gridX = Math.floor(canvasX / PIXEL_SIZE);
    const gridY = Math.floor(canvasY / PIXEL_SIZE);
    return { x: gridX, y: gridY };
  }, [offset, zoom]);

  // Handle painting
  const paintPixel = useCallback(async (gridX: number, gridY: number) => {
    if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) return;

    if (remaining <= 0) {
      setToast({ message: '¡Sin píxeles! Espera a que se recargue tu cuota.', type: 'warn' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    if (!user) return;

    // Optimistic update
    setPixels(prev => ({ ...prev, [`${gridX},${gridY}`]: true }));
    decrementLocal();
    const isNowZero = (remaining - 1) <= 0;

    // Save to Supabase (upsert)
    const { error } = await supabase
      .from('pixels')
      .upsert(
        { x: gridX, y: gridY, user_id: user.id, painted_at: new Date().toISOString() },
        { onConflict: 'x,y' }
      );

    if (error) {
      console.error('Supabase insert error:', error);
      setToast({ message: `Error al guardar el píxel: ${error.message}`, type: 'error' });
      setTimeout(() => setToast(null), 3000);
      // Revert optimistic update
      setPixels(prev => {
        const next = { ...prev };
        delete next[`${gridX},${gridY}`];
        return next;
      });
      incrementLocal(); // Devolvemos el punto si falló la red
    } else if (isNowZero) {
      refetch();
    }
  }, [remaining, user, decrementLocal, incrementLocal, refetch]);

  // Handle deleting pixel
  const deletePixel = useCallback(async (gridX: number, gridY: number) => {
    if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) return;
    if (!user) return;

    if (remaining <= 0) {
      setToast({ message: 'No puedes recuperar píxeles mientras tu cuota total esté agotada.', type: 'warn' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    
    const key = `${gridX},${gridY}`;
    // Si no hay pixel dibujado ahi, no hacemos nada
    if (!pixels[key]) return;

    // Intentar borrar de supabase
    const { data, error } = await supabase
      .from('pixels')
      .delete()
      .match({ x: gridX, y: gridY, user_id: user.id })
      .select();

    if (error) {
      console.error('Supabase delete error:', error);
      setToast({ message: `Error: Sólo puedes borrar tus propios píxeles.`, type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } else {
      // Data = array con los records eliminados. Si es 0, no era suyo.
      if (data && data.length > 0) {
        // Optimistic delete local + devolver pixel
        setPixels(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        incrementLocal();
        refetch(); // Forzar refetch para arreglar cooldown dates
      } else {
        setToast({ message: `No puedes borrar los píxeles de otras personas.`, type: 'error' });
        setTimeout(() => setToast(null), 3000);
      }
    }
  }, [remaining, user, pixels, incrementLocal, refetch]);

  // Mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle button or shift+left = pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    const grid = screenToGrid(e.clientX, e.clientY);

    // Left click = paint
    if (e.button === 0) {
      paintPixel(grid.x, grid.y);
    } 
    // Right click = delete
    else if (e.button === 2) {
      e.preventDefault();
      deletePixel(grid.x, grid.y);
    }
  }, [offset, screenToGrid, paintPixel, deletePixel]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const grid = screenToGrid(e.clientX, e.clientY);
    setMousePos(grid);
  }, [isPanning, panStart, screenToGrid]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setMousePos({ x: -1, y: -1 });
  }, []);

  // Zoom with scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const prevZoom = zoom;
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom + delta * prevZoom));

    // Zoom towards mouse position
    const scale = newZoom / prevZoom;
    const newOffsetX = mouseX - (mouseX - offset.x) * scale;
    const newOffsetY = mouseY - (mouseY - offset.y) * scale;

    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }, [zoom, offset]);

  // Zoom buttons
  const zoomIn = () => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP * z));
  const zoomOut = () => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP * z));
  const zoomReset = () => {
    setZoom(1);
    const wrapper = wrapperRef.current;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      setOffset({
        x: (rect.width - CANVAS_PX) / 2,
        y: (rect.height - CANVAS_PX) / 2,
      });
    }
  };

  // Touch events for mobile
  const lastTouchRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        dist: Math.hypot(dx, dy),
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!lastTouchRef.current) return;

    if (e.touches.length === 1) {
      // Pan
      const touch = e.touches[0];
      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.hypot(dx, dy);
      const scale = newDist / lastTouchRef.current.dist;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * scale));

      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      const wrapper = wrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const mx = midX - rect.left;
        const my = midY - rect.top;
        const s = newZoom / zoom;
        setOffset(prev => ({
          x: mx - (mx - prev.x) * s,
          y: my - (my - prev.y) * s,
        }));
      }

      setZoom(newZoom);
      lastTouchRef.current = { x: midX, y: midY, dist: newDist };
    }
  }, [zoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // If it was a single tap (no significant movement), paint
    if (e.changedTouches.length === 1 && lastTouchRef.current && lastTouchRef.current.dist === 0) {
      const touch = e.changedTouches[0];
      const grid = screenToGrid(touch.clientX, touch.clientY);
      paintPixel(grid.x, grid.y);
    }
    lastTouchRef.current = null;
  }, [screenToGrid, paintPixel]);

  if (authLoading) {
    return (
      <div className="canvas-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3, borderTopColor: 'var(--accent-primary)' }} />
      </div>
    );
  }

  return (
    <div className="canvas-page">
      {/* Header */}
      <header className="canvas-header">
        <div className="header-left">
          <a href="/" className="header-back" id="canvas-back-btn">
            ← <span>Inicio</span>
          </a>
          <div className="header-logo">
            <div className="header-logo-grid">
              {[...'#7c3aed,#8b5cf6,#06b6d4,#a78bfa,#7c3aed,#8b5cf6,#06b6d4,#a78bfa,#7c3aed'.split(',')].map((c, i) => (
                <div key={i} className="header-logo-px" style={{ background: c }} />
              ))}
            </div>
            <span className="gradient-text">PixelDraw</span>
          </div>
        </div>

        <div className="header-center">
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={zoomOut} title="Alejar" id="zoom-out-btn">−</button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button className="zoom-btn" onClick={zoomIn} title="Acercar" id="zoom-in-btn">+</button>
            <button className="zoom-btn" onClick={zoomReset} title="Resetear zoom" id="zoom-reset-btn" style={{ fontSize: '0.7rem' }}>⟲</button>
          </div>

          <div className="pixel-counter">
            <span className="pixel-counter-icon">🎨</span>
            <span className={`pixel-counter-text ${remaining === 0 ? 'exhausted' : ''}`}>
              {remaining}/{total}
            </span>
            <span className="pixel-counter-label">píxeles</span>
          </div>

          {remaining === 0 && cooldownText && (
            <div className="cooldown-badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--error)' }}>
              ⏱️ Recarga en {cooldownText}
            </div>
          )}
        </div>

        <div className="header-right">
          {isAdmin && (
            <button className="admin-btn" onClick={() => setAdminPanelOpen(true)}>
              🛡️ <span>Panel</span>
            </button>
          )}
          <button className="account-btn" onClick={() => setSidebarOpen(true)} id="account-btn">
            👤 <span>Mi Cuenta</span>
          </button>
        </div>
      </header>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className={`canvas-wrapper ${isPanning ? 'panning' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
      >
        <canvas
          ref={canvasRef}
          id="pixel-canvas"
          width={CANVAS_PX}
          height={CANVAS_PX}
          style={{
            width: CANVAS_PX * zoom,
            height: CANVAS_PX * zoom,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
      </div>

      {/* Coordinates Display */}
      {mousePos.x >= 0 && mousePos.x < GRID_SIZE && mousePos.y >= 0 && mousePos.y < GRID_SIZE && (
        <div className="coords-display">
          ({mousePos.x}, {mousePos.y})
        </div>
      )}

      {/* Controls Legend */}
      <div className="controls-legend">
        <div className="controls-legend-title">🎮 Controles</div>
        <div className="controls-list">
          <div className="control-item">
            <div className="control-icon"><MouseLeftIcon /></div>
            <div className="control-desc">Pintar píxel (coste 1/50)</div>
          </div>
          <div className="control-item">
            <div className="control-icon"><MouseRightIcon /></div>
            <div className="control-desc">Borrar tu píxel (devuelve +1)</div>
          </div>
          <div className="control-item">
            <div className="control-icon"><MouseMiddleIcon /></div>
            <div className="control-desc">Arrastrar lienzo (o Shift+Clic)</div>
          </div>
          <div className="control-item">
            <div className="control-icon"><MouseScrollIcon /></div>
            <div className="control-desc">Acercar o alejar zoom</div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {sidebarOpen && (
        <UserSidebar
          remaining={remaining}
          total={total}
          cooldownText={cooldownText}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Admin Panel */}
      {isAdmin && adminPanelOpen && (
        <AdminPanel onClose={() => setAdminPanelOpen(false)} />
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
