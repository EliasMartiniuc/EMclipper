import React from 'react';

export default function Terms() {
  return (
    <div className="neu-card" style={{ maxWidth: '800px', margin: '40px auto', padding: '40px' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '24px' }} className="kinetic-text">Terms of Service</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>Last Updated: August 27, 2026</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', lineHeight: '1.6' }}>
        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>1. Agreement to Terms</h2>
          <p>
            By accessing or using EMclipper ("the Service"), you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the Service.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>2. Description of Service</h2>
          <p>
            EMclipper is an AI-powered video editing platform that allows users to upload, process, and generate short-form clips from longer video content. We reserve the right to modify or discontinue the Service at any time without notice.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>3. User Accounts</h2>
          <p>
            When you create an account with us, you must provide accurate, complete, and current information. You are responsible for safeguarding the password that you use to access the Service and for any activities or actions under your password.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>4. Acceptable Use and Content Rules</h2>
          <p>You agree not to use the Service to upload, process, or distribute content that is:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>Illegal, abusive, harassing, or defamatory.</li>
            <li>Explicitly sexual or excessively violent (NSFW).</li>
            <li>Infringing on any patent, trademark, trade secret, copyright, or other proprietary rights of any party.</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            We reserve the right to terminate accounts that violate these rules immediately, without prior notice or refund.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>5. Intellectual Property</h2>
          <p>
            You retain all of your ownership rights in your uploaded videos. By uploading content to EMclipper, you grant us a worldwide, non-exclusive, royalty-free license to use, process, and store that content solely for the purpose of providing the Service to you. 
          </p>
          <p style={{ marginTop: '8px' }}>
            You represent and warrant that you own or have the necessary licenses, rights, consents, and permissions to use and authorize EMclipper to process your uploaded content.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>6. Payments, Subscriptions, and Refunds</h2>
          <p>
            Certain aspects of the Service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis (monthly or annually). Payments are processed securely via our third-party payment processor, Stripe.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>Refunds:</strong> Subscriptions can be cancelled at any time via the Settings page. Upon cancellation, you will retain access to the Service until the end of your current billing period. We do not provide refunds or credits for partial months of service.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>7. Limitation of Liability</h2>
          <p>
            In no event shall EMclipper, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
          </p>
          <p style={{ marginTop: '8px' }}>
            The Service is provided on an "AS IS" and "AS AVAILABLE" basis. We do not warrant that the Service will function uninterrupted, secure, or available at any particular time or location.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>8. Contact Us</h2>
          <p>
            If you have any questions about these Terms, please contact us at <strong>contact@emclipper.com</strong>.
          </p>
        </section>
      </div>
    </div>
  );
}
