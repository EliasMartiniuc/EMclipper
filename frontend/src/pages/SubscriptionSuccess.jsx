import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

export default function SubscriptionSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    // Optionally auto-redirect after a few seconds
    const timer = setTimeout(() => {
      navigate('/');
    }, 5000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div style={{ textAlign: 'center', marginTop: '60px', minHeight: '60vh' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
        <div style={{ background: 'rgba(138,122,237,0.1)', padding: '24px', borderRadius: '50%', color: 'var(--accent-color)' }}>
          <CheckCircle size={64} strokeWidth={2} />
        </div>
      </div>
      
      <h1 className="kinetic-text" style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
        Payment Successful!
      </h1>
      
      <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px auto' }}>
        Thank you for subscribing to EMclipper. Your account has been upgraded and your upload limit has been reset.
      </p>

      <Link to="/">
        <button className="neu-btn-primary" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
          Start Creating Clips
        </button>
      </Link>
    </div>
  );
}
