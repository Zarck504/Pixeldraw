import { useAuthStore } from '../stores/authStore';

interface Props {
  remaining: number;
  total: number;
  cooldownText: string;
  onClose: () => void;
}

export default function UserSidebar({ remaining, total, cooldownText, onClose }: Props) {
  const { user, signOut } = useAuthStore();

  if (!user) return null;

  const username = user.user_metadata?.username || 'Usuario';
  const email = user.email || '';
  const percentage = (remaining / total) * 100;

  let barClass = '';
  if (percentage <= 0) barClass = 'empty';
  else if (percentage <= 20) barClass = 'low';

  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} />
      <aside className="sidebar-panel">
        <button className="sidebar-close" onClick={onClose} aria-label="Cerrar" id="sidebar-close-btn">
          ✕
        </button>

        <h2 className="sidebar-title">Mi Cuenta</h2>

        {/* Username */}
        <div className="sidebar-section">
          <div className="sidebar-label">Nombre de usuario</div>
          <div className="sidebar-value">{username}</div>
        </div>

        {/* Email */}
        <div className="sidebar-section">
          <div className="sidebar-label">Correo electrónico</div>
          <div className="sidebar-value">{email}</div>
        </div>

        {/* Password */}
        <div className="sidebar-section">
          <div className="sidebar-label">Contraseña</div>
          <div className="sidebar-value sidebar-password">••••••••••</div>
        </div>

        {/* Pixel Quota */}
        <div className="sidebar-section">
          <div className="sidebar-label">Cuota de píxeles</div>
          <div className="sidebar-quota">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span className="quota-number">{remaining}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>/ {total} disponibles</span>
            </div>
            <div className="quota-bar-container">
              <div
                className={`quota-bar ${barClass}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="quota-text">
              <span>{remaining > 0 ? 'Píxeles disponibles' : 'Sin píxeles'}</span>
              <span>{Math.round(percentage)}%</span>
            </div>

            {remaining === 0 && cooldownText && (
              <div
                className="sidebar-cooldown"
                style={{
                  background: 'rgba(239, 68, 68, 0.1) /* fondo rojo claro */',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                }}
              >
                <span className="sidebar-cooldown-icon">⏱️</span>
                <div>
                  <div className="sidebar-cooldown-text" style={{ color: 'var(--text-primary)' }}>Recarga total de píxeles en</div>
                  <div className="sidebar-cooldown-time" style={{ color: 'var(--error)' }}>{cooldownText}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-spacer" />

        <button className="sidebar-logout" onClick={signOut} id="sidebar-logout-btn">
          Cerrar Sesión
        </button>
      </aside>
    </>
  );
}
