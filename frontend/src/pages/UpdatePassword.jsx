import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we have a hash in the URL (Supabase recovery flow uses hashes for implicit grant)
    // Or if the user is already logged in with a recovery session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        // If there's no session and no hash, they probably shouldn't be here
        if (!window.location.hash) {
          setError("No recovery session found. Please request a new password reset link.");
        }
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event == "PASSWORD_RECOVERY") {
        // The user clicked the recovery link, the session is active
        // We just let them stay on the page to set the password
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;
      
      alert("Password updated successfully!");
      navigate('/');
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="neu-card" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '1.75rem' }}>Set New Password</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '32px' }}>
          Please enter your new secure password.
        </p>

        {error && (
          <div style={{ background: 'rgba(255, 71, 87, 0.1)', color: '#ff4757', padding: '12px', borderRadius: '12px', marginBottom: '24px', textAlign: 'center', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>New Password</label>
            <div className="neu-box" style={{ display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', borderRadius: '16px' }}>
              <Lock size={18} color="var(--text-muted)" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={{ 
                  flexGrow: 1, 
                  border: 'none', 
                  background: 'transparent', 
                  padding: '14px 0',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontSize: '1rem'
                }} 
                placeholder="••••••••"
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="neu-btn-primary" 
            disabled={loading}
            style={{ width: '100%', marginTop: '12px', padding: '14px' }}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default UpdatePassword;
