import { useState, useEffect, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import '../styles/Auth.css';

export default function AuthForm() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const { signIn, signUp } = useAuthStore();

  // Check URL hash for #register
  useEffect(() => {
    if (window.location.hash === '#register') {
      setIsRegister(true);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    if (isRegister) {
      if (!username.trim()) {
        setError('El nombre de usuario es obligatorio');
        setSubmitting(false);
        return;
      }
      if (username.trim().length < 3) {
        setError('El nombre de usuario debe tener al menos 3 caracteres');
        setSubmitting(false);
        return;
      }
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        setSubmitting(false);
        return;
      }

      const result = await signUp(email, password, username.trim());
      if (result.error) {
        setError(result.error);
      } else {
        // Guardar email para mostrarlo en el modal y limpiar formulario
        setRegisteredEmail(email);
        setEmail('');
        setPassword('');
        setUsername('');
        setShowConfirmModal(true);
      }
    } else {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        window.location.href = '/canvas';
      }
    }

    setSubmitting(false);
  };

  const toggleMode = () => {
    setIsRegister(!isRegister);
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-bg" />

      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <a href="/" className="auth-logo">
              <div className="auth-logo-grid">
                <div className="auth-logo-px" style={{ background: '#7c3aed' }} />
                <div className="auth-logo-px" style={{ background: '#8b5cf6' }} />
                <div className="auth-logo-px" style={{ background: '#06b6d4' }} />
                <div className="auth-logo-px" style={{ background: '#a78bfa' }} />
                <div className="auth-logo-px" style={{ background: '#7c3aed' }} />
                <div className="auth-logo-px" style={{ background: '#8b5cf6' }} />
                <div className="auth-logo-px" style={{ background: '#06b6d4' }} />
                <div className="auth-logo-px" style={{ background: '#a78bfa' }} />
                <div className="auth-logo-px" style={{ background: '#7c3aed' }} />
              </div>
              <span className="gradient-text">PixelDraw</span>
            </a>
            <h1 className="auth-title">
              {isRegister ? 'Crear Cuenta' : 'Bienvenido de Vuelta'}
            </h1>
            <p className="auth-subtitle">
              {isRegister
                ? 'Regístrate para empezar a dibujar en el lienzo'
                : 'Inicia sesión para continuar dibujando'}
            </p>
          </div>

          {error && <div className="auth-alert error">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit} id="auth-form">
            {isRegister && (
              <div className="form-group">
                <label className="form-label" htmlFor="username">Nombre de usuario</label>
                <input
                  id="username"
                  className="form-input"
                  type="text"
                  placeholder="pixel_artist_01"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                className="form-input"
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Contraseña</label>
              <input
                id="password"
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary auth-submit"
              disabled={submitting}
              id="auth-submit-btn"
            >
              {submitting ? (
                <span className="spinner" />
              ) : isRegister ? (
                '🎨 Crear Cuenta'
              ) : (
                'Iniciar Sesión'
              )}
            </button>
          </form>

          <div className="auth-toggle">
            {isRegister ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
            <button className="auth-toggle-link" onClick={toggleMode} type="button">
              {isRegister ? 'Inicia Sesión' : 'Regístrate'}
            </button>
          </div>
        </div>

        <a href="/" className="auth-back">← Volver al inicio</a>
      </div>

      {/* Modal de confirmación de correo */}
      {showConfirmModal && (
        <div className="confirm-modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-icon">✉️</div>
            <h2 className="confirm-modal-title">¡Revisa tu correo!</h2>
            <p className="confirm-modal-body">
              Hemos enviado un enlace de confirmación a{' '}
              <strong className="confirm-modal-email">{registeredEmail}</strong>.
            </p>
            <p className="confirm-modal-hint">
              Debes confirmar tu cuenta antes de poder iniciar sesión. Si no ves el correo, revisa tu carpeta de spam.
            </p>
            <button
              className="btn btn-primary confirm-modal-btn"
              onClick={() => {
                setShowConfirmModal(false);
                setIsRegister(false);
              }}
              id="confirm-modal-ok-btn"
            >
              ✓ ¡Entendido, ya lo tengo!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
