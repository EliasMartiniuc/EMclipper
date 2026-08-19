import React, { useState } from 'react';
import { Mail, Lock, User, Loader2, CheckCircle, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Auth({ type }) {
  const isLogin = type === 'login';
  
  // State variables for authentication fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate('/projects');
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
            }
          }
        });
        if (error) throw error;
        setShowVerifyModal(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '60px' }}>
      <div className="neu-card" style={{ width: '100%', maxWidth: '450px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '8px' }} className="kinetic-text">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>
          {isLogin ? 'Log in to access your projects.' : 'Start turning your videos into viral shorts.'}
        </p>

        {error && <div style={{ color: 'red', marginBottom: '16px', fontWeight: 'bold' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {!isLogin && (
            <div style={{ position: 'relative' }}>
              <User size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                className="neu-input" 
                placeholder="Full Name" 
                style={{ paddingLeft: '48px' }}
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <Mail size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="email" 
              className="neu-input" 
              placeholder="Email Address" 
              style={{ paddingLeft: '48px' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={{ position: 'relative' }}>
            <Lock size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="password" 
              className="neu-input" 
              placeholder="Password" 
              style={{ paddingLeft: '48px' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="neu-btn-primary" style={{ marginTop: '12px', width: '100%', padding: '16px' }} disabled={loading}>
            {loading ? <Loader2 className="spinner" size={18} /> : (isLogin ? 'Log In' : 'Sign Up')}
          </button>

        </form>

        <div style={{ marginTop: '32px', color: 'var(--text-muted)' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <Link to={isLogin ? '/signup' : '/login'} style={{ color: 'var(--accent-color)', fontWeight: 'bold', textDecoration: 'none' }}>
            {isLogin ? 'Sign up here' : 'Log in here'}
          </Link>
        </div>
      </div>

      {/* Verification Email Modal */}
      {showVerifyModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div className="neu-card" style={{
            maxWidth: '420px', width: '90%', textAlign: 'center',
            padding: '40px 32px', position: 'relative',
            animation: 'slideUp 0.4s ease'
          }}>
            <button
              onClick={() => { setShowVerifyModal(false); navigate('/login'); }}
              style={{
                position: 'absolute', top: '16px', right: '16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: '4px'
              }}
            >
              <X size={20} />
            </button>

            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c853, #00e676)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <CheckCircle size={32} color="#fff" />
            </div>

            <h3 style={{ fontSize: '1.5rem', marginBottom: '12px', color: 'var(--text-primary)' }}>
              Check Your Email
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '8px' }}>
              We've sent a verification link to
            </p>
            <p style={{ color: 'var(--accent-color)', fontWeight: 'bold', marginBottom: '24px', wordBreak: 'break-all' }}>
              {email}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Click the link in the email to verify your account, then come back here to log in.
            </p>

            <button
              className="neu-btn-primary"
              onClick={() => { setShowVerifyModal(false); navigate('/login'); }}
              style={{ marginTop: '28px', width: '100%', padding: '14px' }}
            >
              Go to Login
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
