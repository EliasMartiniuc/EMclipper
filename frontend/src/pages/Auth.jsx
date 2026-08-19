import React, { useState } from 'react';
import { Mail, Lock, User, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Auth({ type }) {
  const isLogin = type === 'login';
  
  // State variables for authentication fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

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
        setMessage('Registration successful! You can now log in.');
        navigate('/projects'); // usually auto logs in
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
        {message && <div style={{ color: 'green', marginBottom: '16px', fontWeight: 'bold' }}>{message}</div>}

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
    </div>
  );
}
