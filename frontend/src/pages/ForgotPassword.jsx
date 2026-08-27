import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/update-password',
      });
      if (error) throw error;
      setMessage('Check your email for the password reset link.');
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
        <h2 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '1.75rem' }}>Reset Password</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '32px' }}>
          Enter your email to receive a reset link.
        </p>

        {message && (
          <div style={{ background: 'rgba(46, 213, 115, 0.1)', color: '#2ed573', padding: '12px', borderRadius: '12px', marginBottom: '24px', textAlign: 'center', fontSize: '0.9rem' }}>
            {message}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(255, 71, 87, 0.1)', color: '#ff4757', padding: '12px', borderRadius: '12px', marginBottom: '24px', textAlign: 'center', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>Email</label>
            <div className="neu-box" style={{ display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', borderRadius: '16px' }}>
              <Mail size={18} color="var(--text-muted)" />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ 
                  flexGrow: 1, 
                  border: 'none', 
                  background: 'transparent', 
                  padding: '14px 0',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontSize: '1rem'
                }} 
                placeholder="you@example.com"
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="neu-btn-primary" 
            disabled={loading}
            style={{ width: '100%', marginTop: '12px', padding: '14px' }}
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        <div style={{ marginTop: '32px', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
            <ArrowLeft size={16} /> Back to Log In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
