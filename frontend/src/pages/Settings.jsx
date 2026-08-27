import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';

function Settings() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

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
