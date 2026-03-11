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
const GRID_COLOR = 'rgba(0, 0, 0, 0.70)';
const PIXEL_COLOR = '#000000';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;

// Threshold para distinguir tap vs arrastre en móvil (píxeles)
const TAP_THRESHOLD = 8;

// Icons for the legend (desktop)
const MouseLeftIcon = () => <img src="/clicizquierdo.png" alt="Clic izquierdo" className="legend-img-icon" />;
const MouseRightIcon = () => <img src="/clicderecho.png" alt="Clic derecho" className="legend-img-icon" />;
const MouseMiddleIcon = () => <img src="/scrollwheel.png" alt="Arrastrar" className="legend-img-icon" />;
const MouseScrollIcon = () => <img src="/scroll.png" alt="Scroll" className="legend-img-icon" />;

interface PixelData {
  [key: string]: boolean; // "x,y" -> true
}

type TouchMode = 'draw' | 'erase' | 'pan';

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
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'warn' | 'success' } | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [touchMode, setTouchMode] = useState<TouchMode>('draw');

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

  // Check if user is banned
  useEffect(() => {
    if (!user) return;
    const checkBan = async () => {
      const { data } = await supabase
        .from('banned_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      setIsBanned(!!data);
    };
    checkBan();
  }, [user]);

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

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // Draw grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * PIXEL_SIZE;
      ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, CANVAS_PX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(CANVAS_PX, pos); ctx.stroke();
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
    setZoom(1);
    const rect = wrapper.getBoundingClientRect();
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

  const showToast = useCallback((message: string, type: 'error' | 'warn' | 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Handle painting
  const paintPixel = useCallback(async (gridX: number, gridY: number) => {
    if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) return;

    if (isBanned) {
      showToast('⛔ Tu cuenta está suspendida. No puedes dibujar.', 'error');
      return;
    }

    if (remaining <= 0) {
      showToast('¡Sin píxeles! Espera a que se recargue tu cuota.', 'warn');
      return;
    }

    if (!user) return;

    // Optimistic update
    setPixels(prev => ({ ...prev, [`${gridX},${gridY}`]: true }));
    decrementLocal();
    const isNowZero = (remaining - 1) <= 0;

    const { error } = await supabase
      .from('pixels')
      .upsert(
        { x: gridX, y: gridY, user_id: user.id, painted_at: new Date().toISOString() },
        { onConflict: 'x,y' }
      );

    if (error) {
      console.error('Supabase insert error:', error);
      // Si el error es de RLS (usuario baneado)
      if (error.code === '42501' || error.message?.toLowerCase().includes('ban')) {
        setIsBanned(true);
        showToast('⛔ Tu cuenta ha sido suspendida. No puedes dibujar.', 'error');
      } else {
        showToast(`Error al guardar el píxel: ${error.message}`, 'error');
      }
      setPixels(prev => {
        const next = { ...prev };
        delete next[`${gridX},${gridY}`];
        return next;
      });
      incrementLocal();
    } else if (isNowZero) {
      refetch();
    }
  }, [remaining, user, isBanned, decrementLocal, incrementLocal, refetch, showToast]);

  // Handle deleting pixel
  const deletePixel = useCallback(async (gridX: number, gridY: number) => {
    if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) return;
    if (!user) return;

    if (isBanned) {
      showToast('⛔ Tu cuenta está suspendida.', 'error');
      return;
    }

    if (remaining <= 0) {
      showToast('No puedes recuperar píxeles mientras tu cuota total esté agotada.', 'warn');
      return;
    }

    const key = `${gridX},${gridY}`;
    if (!pixels[key]) return;

    const { data, error } = await supabase
      .from('pixels')
      .delete()
      .match({ x: gridX, y: gridY, user_id: user.id })
      .select();

    if (error) {
      showToast('Error: Sólo puedes borrar tus propios píxeles.', 'error');
    } else {
      if (data && data.length > 0) {
        setPixels(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        incrementLocal();
        refetch();
      } else {
        showToast('No puedes borrar los píxeles de otras personas.', 'error');
      }
    }
  }, [remaining, user, isBanned, pixels, incrementLocal, refetch, showToast]);

  // Mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    const grid = screenToGrid(e.clientX, e.clientY);

    if (e.button === 0) {
      paintPixel(grid.x, grid.y);
    } else if (e.button === 2) {
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

  const handleMouseUp = useCallback(() => { setIsPanning(false); }, []);
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

  // Touch events — with tap vs drag detection and mode support
  // Ref stores: start position, accumulated movement, pinch distance
  const lastTouchRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    dist: number;
    totalMoved: number;
  } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        dist: 0,
        totalMoved: 0,
      };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      lastTouchRef.current = {
        x: midX, y: midY,
        startX: midX, startY: midY,
        dist: Math.hypot(dx, dy),
        totalMoved: 0,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!lastTouchRef.current) return;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      const stepMoved = Math.hypot(dx, dy);

      // Siempre acumular movimiento para detectar si fue tap
      lastTouchRef.current = {
        ...lastTouchRef.current,
        x: touch.clientX,
        y: touch.clientY,
        totalMoved: lastTouchRef.current.totalMoved + stepMoved,
      };

      // Sólo pan si: modo pan activo, O si se movió más del umbral
      if (touchMode === 'pan' || lastTouchRef.current.totalMoved > TAP_THRESHOLD) {
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    } else if (e.touches.length === 2) {
      // Pinch zoom — siempre activo
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
      lastTouchRef.current = {
        ...lastTouchRef.current,
        x: midX, y: midY,
        dist: newDist,
        totalMoved: lastTouchRef.current.totalMoved + 1,
      };
    }
  }, [zoom, touchMode]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!lastTouchRef.current) return;

    // Solo ejecutar acción si fue tap (movimiento mínimo) y 1 dedo
    if (e.changedTouches.length === 1 && lastTouchRef.current.totalMoved < TAP_THRESHOLD) {
      const touch = e.changedTouches[0];
      const grid = screenToGrid(touch.clientX, touch.clientY);

      if (touchMode === 'draw') {
        paintPixel(grid.x, grid.y);
      } else if (touchMode === 'erase') {
        deletePixel(grid.x, grid.y);
      }
      // touchMode === 'pan': no action on tap
    }
    lastTouchRef.current = null;
  }, [touchMode, screenToGrid, paintPixel, deletePixel]);

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

      {/* Banner de cuenta baneada */}
      {isBanned && (
        <div className="banned-banner">
          <span className="banned-banner-icon">⛔</span>
          <div className="banned-banner-text">
            <strong>Tu cuenta ha sido suspendida.</strong>
            {' '}No puedes dibujar en el lienzo por violar las normas de la comunidad.
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className={`canvas-wrapper ${isPanning ? 'panning' : ''} ${isBanned ? 'with-banner' : ''}`}
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

      {/* Controls Legend (desktop only) */}
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

      {/* Mobile Toolbar — only visible on mobile */}
      <div className="mobile-toolbar">
        <button
          className={`mobile-tool-btn ${touchMode === 'draw' ? 'active draw' : ''}`}
          onClick={() => setTouchMode('draw')}
          id="mobile-tool-draw"
        >
          <span className="mobile-tool-icon">✏️</span>
          <span className="mobile-tool-label">Dibujar</span>
        </button>
        <button
          className={`mobile-tool-btn ${touchMode === 'erase' ? 'active erase' : ''}`}
          onClick={() => setTouchMode('erase')}
          id="mobile-tool-erase"
        >
          <span className="mobile-tool-icon">✕</span>
          <span className="mobile-tool-label">Borrar</span>
        </button>
        <button
          className={`mobile-tool-btn ${touchMode === 'pan' ? 'active pan' : ''}`}
          onClick={() => setTouchMode('pan')}
          id="mobile-tool-pan"
        >
          <span className="mobile-tool-icon">✋</span>
          <span className="mobile-tool-label">Mover</span>
        </button>
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
