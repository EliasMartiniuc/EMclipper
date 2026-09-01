import React, { useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../AuthContext';
import AnimatedButton from '../components/AnimatedButton';

export default function Contact() {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: user ? user.email : '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      setError('Please fill out all fields.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const { error: dbError } = await supabase.from('feedback').insert({
        name: formData.name,
        email: formData.email,
        message: formData.message,
        user_id: user ? user.id : null
      });

      if (dbError) throw dbError;

      // Wait a moment so the user sees the airplane animation finish
      setTimeout(() => {
        setSuccess(true);
        setFormData({ name: '', email: user ? user.email : '', message: '' });
        setIsSubmitting(false);
      }, 1500);
      
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError('There was an error submitting your feedback. Please try again later.');
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: 'clamp(24px, 5vw, 40px) auto', padding: '0 clamp(16px, 4vw, 24px)' }}>
      <div className="neu-box" style={{ padding: 'clamp(24px, 6vw, 40px)' }}>
        <h1 style={{ marginBottom: '16px', fontSize: '2rem', background: 'linear-gradient(135deg, var(--accent-color), #b1a5ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Contact Us
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', lineHeight: '1.6' }}>
          Have feedback, found a bug, or want to request a feature? Let us know below!
        </p>

        {success ? (
          <div style={{ padding: '24px', background: 'rgba(76, 175, 80, 0.1)', borderRadius: '16px', border: '1px solid rgba(76, 175, 80, 0.2)', textAlign: 'center' }}>
            <h3 style={{ color: '#4CAF50', margin: '0 0 8px 0' }}>Thank you!</h3>
            <p style={{ color: 'var(--text-primary)', margin: 0 }}>Your feedback has been received. We appreciate your help in improving EMclipper!</p>
            <button 
              className="neu-btn" 
              style={{ marginTop: '24px' }}
              onClick={() => setSuccess(false)}
            >
              Send Another Message
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {error && (
              <div style={{ padding: '12px', background: 'rgba(255, 59, 48, 0.1)', color: '#ff3b30', borderRadius: '12px', fontSize: '0.9rem' }}>
                {error}
              </div>
            )}
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                Your Name
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="John Doe"
                className="neu-input"
                style={{ width: '100%' }}
                required
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                Email Address
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="john@example.com"
                className="neu-input"
                style={{ width: '100%' }}
                required
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                Message
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                placeholder="How can we help you or improve the product?"
                className="neu-input"
                style={{ width: '100%', minHeight: '150px', resize: 'vertical' }}
                required
              />
            </div>
            
            <div style={{ marginTop: '12px' }}>
              <AnimatedButton isSubmitting={isSubmitting} isSuccess={success} />
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
