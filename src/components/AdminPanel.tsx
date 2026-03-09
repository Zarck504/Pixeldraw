import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  is_banned: boolean;
  used_pixels: number;
  oldest_pixel_at: string | null;
}

interface Props {
  onClose: () => void;
}

export default function AdminPanel({ onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [banningUser, setBanningUser] = useState<AdminUser | null>(null);
  const [now, setNow] = useState(Date.now());

  // Clock for countdowns
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_admin_users_stats');
    if (error) {
      console.error('Error fetching admin stats:', error);
      alert('Error cargando usuarios. ¿Ejecutaste el script admin_setup.sql?');
    } else {
      setUsers(data as AdminUser[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleResetPixels = async (userId: string) => {
    if (!confirm('¿Estás seguro de restablecer los 50 píxeles de este usuario?')) return;
    const { error } = await supabase.rpc('admin_clear_user_pixels', { p_target_uuid: userId });
    if (error) {
      alert('Error restableciendo píxeles: ' + error.message);
    } else {
      loadUsers();
    }
  };

  const handleToggleBan = async (user: AdminUser) => {
    const { error } = await supabase.rpc('admin_toggle_ban_user', {
      target_user_id: user.id,
      ban: !user.is_banned,
    });
    if (error) {
      alert('Error cambiando estado de baneo: ' + error.message);
    } else {
      setBanningUser(null);
      loadUsers();
    }
  };

  const calculateCooldown = (user: AdminUser) => {
    if (user.used_pixels < 50 || !user.oldest_pixel_at) return null;
    const oldest = new Date(user.oldest_pixel_at).getTime();
    const unlockTime = oldest + 12 * 60 * 60 * 1000;
    const diff = unlockTime - now;
    if (diff <= 0) return null;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="admin-overlay" onClick={onClose} />
      <div className="admin-modal">
        <div className="admin-header">
          <h2>Panel de Administración</h2>
          <button className="admin-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="admin-content">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando usuarios...</div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Correo</th>
                    <th>Contraseña</th>
                    <th>Píxeles Disp.</th>
                    <th>Cooldown</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const cooldown = calculateCooldown(u);
                    const available = Math.max(0, 50 - u.used_pixels);
                    return (
                      <tr key={u.id} className={u.is_banned ? 'banned-row' : ''}>
                        <td className="font-mono">{u.username || 'N/A'}</td>
                        <td>{u.email}</td>
                        <td className="font-mono text-muted">••••••••</td>
                        <td>
                          <span className={available === 0 ? 'text-error font-bold' : ''}>
                            {available} / 50
                          </span>
                        </td>
                        <td className="font-mono text-warn">
                          {cooldown ? `⏱️ ${cooldown}` : '-'}
                        </td>
                        <td>
                          <div className="admin-actions">
                            <button className="action-btn edit" title="Editar usuario" onClick={() => alert('Función de editar perfil en desarrollo')}>
                              ✏️
                            </button>
                            <button className="action-btn reset" title="Restablecer píxeles" onClick={() => handleResetPixels(u.id)}>
                              🔋
                            </button>
                            <button 
                              className={`action-btn ${u.is_banned ? 'unban' : 'ban'}`} 
                              title={u.is_banned ? 'Quitar baneo' : 'Banear usuario'}
                              onClick={() => setBanningUser(u)}
                            >
                              {u.is_banned ? '✅' : '🔨'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '1rem' }}>No hay usuarios registrados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Double Confirmation Modal for Banning */}
      {banningUser && (
        <div className="admin-confirm-overlay">
          <div className="admin-confirm-modal">
            <h3>¿Estás completamente seguro?</h3>
            <p>
              Estás a punto de <strong>{banningUser.is_banned ? 'desbanear' : 'BANEAR'}</strong> al usuario{' '}
              <span className="font-bold">{banningUser.username || banningUser.email}</span>.
            </p>
            {!banningUser.is_banned && (
              <p className="text-error" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                Un usuario baneado no podrá pintar ni sobrescribir píxeles en el lienzo.
              </p>
            )}
            <div className="admin-confirm-actions">
              <button className="btn-cancel" onClick={() => setBanningUser(null)}>Cancelar</button>
              <button className="btn-danger" onClick={() => handleToggleBan(banningUser)}>
                {banningUser.is_banned ? 'Sí, Quitar Baneo' : 'Sí, Banear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
