import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Star, Zap, Crown, Upload } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../AuthContext';
import { useUpload } from '../UploadContext';

export default function Subscription() {
  const { user } = useAuth();
  const { subscriptionStatus, fetchSubscriptionStatus } = useUpload();
  const [loading, setLoading] = useState(null); // 'pro' or 'ultra' while loading
  const [searchParams] = useSearchParams();
  const success = searchParams.get('success');
  const cancelled = searchParams.get('cancelled');

  useEffect(() => {
    if (success) {
      // Refresh subscription status after successful checkout
      fetchSubscriptionStatus();
    }
  }, [success, fetchSubscriptionStatus]);

  const handleCheckout = async (plan) => {
    if (!user) {
      alert("Please log in first.");
      return;
    }
    setLoading(plan);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ plan })
      });
      
      if (!res.ok) {
        let errorMessage = `Server error: ${res.status}`;
        try {
          const errorData = await res.json();
          if (errorData.detail) errorMessage = errorData.detail;
        } catch (e) {}
        throw new Error(errorMessage);
      }
      
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert(`Checkout failed: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };


  const currentTier = subscriptionStatus?.tier || 'free';
  const uploadsUsed = subscriptionStatus?.uploads_used || 0;
  const uploadLimit = subscriptionStatus?.upload_limit || 2;
  const isAdmin = subscriptionStatus?.is_admin;

  const plans = [
    {
      name: 'Free',
      price: '€0',
      period: '',
      description: 'Try EMclipper risk-free.',
      features: ['2 video uploads (total)', 'AI highlight detection', 'Auto-generated subtitles', 'HD export quality'],
      tier: 'free',
      icon: Upload,
    },
    {
      name: 'Pro',
      price: '€14',
      period: '/month',
      description: 'For content creators who mean business.',
      features: ['26 video uploads per month', 'AI highlight detection', 'Auto-generated subtitles', 'HD export quality', 'Priority support'],
      tier: 'pro',
      icon: Zap,
    },
    {
      name: 'Ultra',
      price: '€24',
      period: '/month',
      description: 'Maximum power for agencies & pros.',
      features: ['70 video uploads per month', 'AI highlight detection', 'Auto-generated subtitles', 'HD export quality', 'Priority support', 'Early access to new features'],
      tier: 'ultra',
      icon: Crown,
    }
  ];

  return (
    <div style={{ textAlign: 'center', marginTop: '40px' }}>
      {success && (
        <div style={{ 
          background: 'rgba(34, 197, 94, 0.1)', 
          border: '1px solid rgba(34, 197, 94, 0.3)',
          color: '#22c55e', 
          padding: '16px 24px', 
          borderRadius: '12px', 
          marginBottom: '32px',
          fontWeight: 600,
          fontSize: '1.1rem'
        }}>
          🎉 Welcome to EMclipper {currentTier === 'ultra' ? 'Ultra' : 'Pro'}! Your subscription is now active.
        </div>
      )}
      
      {cancelled && (
        <div style={{ 
          background: 'rgba(255, 59, 48, 0.1)', 
          color: 'rgb(255, 59, 48)', 
          padding: '16px 24px', 
          borderRadius: '12px', 
          marginBottom: '32px',
          fontWeight: 600 
        }}>
          Checkout was cancelled. You can try again anytime.
        </div>
      )}

      <h1 className="kinetic-text" style={{ fontSize: '3rem', marginBottom: '16px' }}>Choose Your Plan</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', marginBottom: '20px' }}>
        Scale your content creation with AI-powered video clipping.
      </p>

      {/* Current usage indicator */}
      {user && subscriptionStatus && !isAdmin && (
        <div style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: '12px',
          background: 'rgba(138,122,237,0.08)',
          padding: '12px 24px',
          borderRadius: '24px',
          marginBottom: '48px',
          fontSize: '0.95rem'
        }}>
          <span style={{ fontWeight: 600 }}>
            Current plan: <span style={{ color: 'var(--accent-color)', textTransform: 'capitalize' }}>{currentTier}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span>
            {uploadsUsed} / {uploadLimit} uploads used
          </span>
        </div>
      )}

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
        gap: '32px',
        alignItems: 'stretch',
        maxWidth: '1000px',
        margin: '0 auto'
      }}>
        {plans.map(plan => {
          const isCurrent = currentTier === plan.tier;
          const PlanIcon = plan.icon;
          
          return (
            <div key={plan.name} className="neu-card sub-card" style={{ 
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }}>
              {plan.highlighted && (
                <div style={{ 
                  position: 'absolute', top: '-16px', left: '50%', transform: 'translateX(-50%)', 
                  background: 'var(--accent-color)', color: 'white', padding: '6px 16px', 
                  borderRadius: '20px', fontSize: '0.875rem', fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', gap: '4px',
                  whiteSpace: 'nowrap'
                }}>
                  <Star size={14} fill="white" /> Most Popular
                </div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                <PlanIcon size={24} color="var(--accent-color)" />
                <h2 style={{ fontSize: '1.5rem' }}>{plan.name}</h2>
              </div>
              
              <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '4px' }}>
                {plan.price}
                {plan.period && <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--text-muted)' }}>{plan.period}</span>}
              </div>
              <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>{plan.description}</p>
              
              <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left', marginBottom: '32px', flexGrow: 1 }}>
                {plan.features.map(feat => (
                  <li key={feat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                    <div style={{ background: 'rgba(138,122,237,0.1)', padding: '4px', borderRadius: '50%', color: 'var(--accent-color)', flexShrink: 0 }}>
                      <Check size={16} strokeWidth={3} />
                    </div>
                    {feat}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <button className="neu-btn" style={{ width: '100%', opacity: 0.5 }} disabled>
                  Current Plan
                </button>
              ) : plan.tier === 'free' ? (
                <button className="neu-btn" style={{ width: '100%', opacity: 0.5 }} disabled>
                  Free Forever
                </button>
              ) : (
                <button 
                  className="neu-btn-primary" 
                  style={{ width: '100%' }}
                  onClick={() => handleCheckout(plan.tier)}
                  disabled={loading !== null}
                >
                  {loading === plan.tier ? 'Redirecting...' : `Upgrade to ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
