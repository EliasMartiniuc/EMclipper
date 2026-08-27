import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import { Lock, CheckCircle } from 'lucide-react';

function Settings() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // Password update state
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Listen for PASSWORD_RECOVERY event from Supabase
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');

    // Validation
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setPasswordError('Password must contain at least one uppercase letter.');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setPasswordError('Password must contain at least one number.');
      return;
    }

    setLoading('update-pwd');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess(true);
      setIsRecoveryMode(false);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 5000);
    } catch (err) {
      console.error(err);
      setPasswordError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setLoading('manage');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      if (!res.ok) {
        throw new Error('Failed to create portal session');
      }
      
      const data = await res.json();
      if (data.portal_url) {
        window.location.href = data.portal_url;
      }
    } catch (err) {
      console.error(err);
      alert('Could not open subscription manager. You may not have an active subscription.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmDelete = window.confirm(
      "Are you absolutely sure you want to delete your account? This action cannot be undone. All your projects, clips, and data will be permanently wiped."
    );
    
    if (!confirmDelete) return;
    
    setLoading('delete');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to delete account');
      }
      
      alert('Your account has been successfully deleted.');
      await signOut();
      navigate('/');
    } catch (err) {
      console.error(err);
      alert(`Error deleting account: ${err.message}`);
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setLoading('reset-pwd');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin + '/settings',
      });
      if (error) throw error;
      alert("Password reset email sent! Please check your inbox.");
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '100px' }}>
        <h2>Please log in to view settings.</h2>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '600px', marginTop: '60px' }}>
      <h2 style={{ marginBottom: '30px' }}>Account Settings</h2>

      {/* Password Recovery Form — shown when arriving from reset email */}
      {isRecoveryMode && (
        <div className="neu-panel" style={{ padding: '30px', marginBottom: '30px', border: '2px solid var(--accent-color)' }}>
          <h3 style={{ marginBottom: '20px', color: 'var(--accent-color)' }}>Set New Password</h3>
          <form onSubmit={handleUpdatePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="password"
                className="neu-input"
                placeholder="New Password"
                style={{ paddingLeft: '44px' }}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="password"
                className="neu-input"
                placeholder="Confirm New Password"
                style={{ paddingLeft: '44px' }}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Must be 8+ characters with at least one uppercase letter and one number.
            </p>
            {passwordError && (
              <div style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '0.9rem' }}>{passwordError}</div>
            )}
            <button
              type="submit"
              className="neu-btn-primary"
              style={{ width: '100%' }}
              disabled={loading === 'update-pwd'}
            >
              {loading === 'update-pwd' ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      )}

      {/* Password Updated Success Banner */}
      {passwordSuccess && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)',
          color: '#22c55e', padding: '16px 24px', borderRadius: '12px', marginBottom: '20px', fontWeight: 600
        }}>
          <CheckCircle size={20} />
          Password updated successfully!
        </div>
      )}
      
      <div className="neu-panel" style={{ padding: '30px', marginBottom: '30px' }}>
        <div style={{ marginBottom: '20px' }}>
          <strong>Email:</strong>
          <div style={{ marginTop: '5px', color: 'var(--text-primary)', fontWeight: '500' }}>{user.email}</div>
        </div>
        
        <div style={{ marginBottom: '30px' }}>
          <strong>Username:</strong>
          <div style={{ marginTop: '5px', color: 'var(--text-primary)', fontWeight: '500' }}>
            {user.user_metadata?.full_name || user.user_metadata?.name || 'User'}
          </div>
        </div>

        <div style={{ marginBottom: '30px', paddingTop: '20px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          <strong>Security:</strong>
          <div style={{ marginTop: '10px' }}>
            <button 
              className="neu-btn" 
              onClick={handleResetPassword}
              disabled={loading !== false}
              style={{ width: '100%' }}
            >
              {loading === 'reset-pwd' ? 'Sending...' : 'Send Password Reset Email'}
            </button>
          </div>
        </div>

        <button 
          className="neu-btn-primary" 
          onClick={handleManageSubscription}
          disabled={loading !== false}
          style={{ width: '100%', marginBottom: '15px' }}
        >
          {loading === 'manage' ? 'Loading...' : 'Manage Subscription'}
        </button>

        <button 
          className="neu-btn" 
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
          disabled={loading !== false}
          style={{ width: '100%' }}
        >
          Log Out
        </button>
      </div>

      <div className="neu-panel" style={{ padding: '30px', border: '1px solid #ff444433' }}>
        <h3 style={{ color: '#ff4444', marginBottom: '15px' }}>Danger Zone</h3>
        <p style={{ color: '#aaa', marginBottom: '20px', fontSize: '0.9rem' }}>
          Permanently delete your account, your projects, and all your clips. If you have an active paid subscription, it will be automatically cancelled.
        </p>
        <button 
          className="neu-btn" 
          onClick={handleDeleteAccount}
          disabled={loading !== false}
          style={{ width: '100%', backgroundColor: '#ff444422', color: '#ff4444', border: '1px solid #ff4444' }}
        >
          {loading === 'delete' ? 'Deleting...' : 'Delete Account'}
        </button>
      </div>
    </div>
  );
}

export default Settings;
