import React from 'react';
import { Check, Star } from 'lucide-react';

export default function Subscription() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      description: 'Perfect for getting started.',
      features: ['Up to 5 videos per month', 'Standard export quality', 'Watermarked clips'],
      cta: 'Current Plan',
      isPro: false,
    },
    {
      name: 'Pro',
      price: '$19/mo',
      description: 'For serious content creators.',
      features: ['Unlimited videos', '4K export quality', 'No watermarks', 'Custom subtitle fonts', 'Priority rendering'],
      cta: 'Upgrade to Pro',
      isPro: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      description: 'For agencies and large teams.',
      features: ['Dedicated rendering server', 'API Access', 'White-labeling', '24/7 Support'],
      cta: 'Contact Sales',
      isPro: false,
    }
  ];

  return (
    <div style={{ textAlign: 'center', marginTop: '40px' }}>
      <h1 className="kinetic-text" style={{ fontSize: '3rem', marginBottom: '16px' }}>Unlock EMclipper Pro</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', marginBottom: '60px' }}>
        Scale your content creation with unlimited AI clipping power.
      </p>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
        gap: '40px',
        alignItems: 'center'
      }}>
        {plans.map(plan => (
          <div key={plan.name} className="neu-card" style={{ 
            position: 'relative',
            transform: plan.isPro ? 'scale(1.05)' : 'none',
            zIndex: plan.isPro ? 10 : 1,
            boxShadow: plan.isPro ? '0 0 30px rgba(138,122,237,0.3), var(--neu-shadow)' : 'var(--neu-shadow)'
          }}>
            {plan.isPro && (
              <div style={{ 
                position: 'absolute', top: '-16px', left: '50%', transform: 'translateX(-50%)', 
                background: 'var(--accent-color)', color: 'white', padding: '6px 16px', 
                borderRadius: '20px', fontSize: '0.875rem', fontWeight: 'bold',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}>
                <Star size={14} fill="white" /> Most Popular
              </div>
            )}
            
            <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{plan.name}</h2>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '16px' }}>{plan.price}</div>
            <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>{plan.description}</p>
            
            <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left', marginBottom: '40px' }}>
              {plan.features.map(feat => (
                <li key={feat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ background: 'rgba(138,122,237,0.1)', padding: '4px', borderRadius: '50%', color: 'var(--accent-color)' }}>
                    <Check size={16} strokeWidth={3} />
                  </div>
                  {feat}
                </li>
              ))}
            </ul>

            <button className={plan.isPro ? 'neu-btn-primary' : 'neu-btn'} style={{ width: '100%' }}>
              {plan.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
