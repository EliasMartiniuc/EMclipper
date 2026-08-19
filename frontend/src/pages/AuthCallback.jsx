import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '../supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const hash = window.location.hash;

    // Check for error in the URL hash (e.g. expired link)
    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const desc = params.get('error_description') || 'Verification failed.';
      setErrorMsg(desc.replace(/\+/g, ' '));
      setStatus('error');
      return;
    }

    // Check for access_token (successful verification)
    if (hash.includes('access_token=')) {
      // Supabase JS client auto-picks up the tokens from the URL hash
      // Wait a moment for the auth state to update
      const timer = setTimeout(() => {
        setStatus('success');
      }, 1500);
      return () => clearTimeout(timer);
    }

    // No hash at all — just redirect to home
    setStatus('success');
  }, []);

  const handleContinue = () => {
    navigate('/projects');
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '80px' }}>
      <div className="neu-card" style={{ 
        width: '100%', maxWidth: '460px', textAlign: 'center',
        padding: '48px 32px'
      }}>

        {status === 'verifying' && (
          <>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <Loader2 size={32} className="spinner" style={{ color: 'var(--accent-color)' }} />
            </div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>Verifying your email...</h2>
            <p style={{ color: 'var(--text-muted)' }}>Please wait a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c853, #00e676)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 28px',
              animation: 'popIn 0.5s ease'
            }}>
              <CheckCircle size={36} color="#fff" />
            </div>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '12px' }} className="kinetic-text">
              Email Verified!
            </h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '32px' }}>
              Your account has been successfully verified. You're all set to start creating clips!
            </p>
            <button
              className="neu-btn-primary"
              onClick={handleContinue}
              style={{ width: '100%', padding: '16px', fontSize: '1rem' }}
            >
              Go to My Projects
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #ff1744, #ff5252)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 28px',
              animation: 'popIn 0.5s ease'
            }}>
              <XCircle size={36} color="#fff" />
            </div>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '12px' }}>
              Verification Failed
            </h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '24px' }}>
              {errorMsg}
            </p>
            <button
              className="neu-btn-primary"
              onClick={() => navigate('/signup')}
              style={{ width: '100%', padding: '16px', fontSize: '1rem' }}
            >
              Try Again
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
