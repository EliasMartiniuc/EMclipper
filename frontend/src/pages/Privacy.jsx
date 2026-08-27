import React from 'react';

export default function Privacy() {
  return (
    <div className="neu-card" style={{ maxWidth: '800px', margin: '40px auto', padding: '40px' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '24px' }} className="kinetic-text">Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>Last Updated: August 27, 2026</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', lineHeight: '1.6' }}>
        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>1. Introduction</h2>
          <p>
            EMclipper respects your privacy and is committed to protecting your personal data. This Privacy Policy will inform you as to how we look after your personal data when you visit our website and tell you about your privacy rights and how the law protects you.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>2. Data We Collect</h2>
          <p>We may collect, use, store, and transfer different kinds of personal data about you which we have grouped together as follows:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li><strong>Identity Data:</strong> includes first name, last name, and username.</li>
            <li><strong>Contact Data:</strong> includes email address.</li>
            <li><strong>Financial Data:</strong> includes payment card details (processed securely by Stripe; we do not store your full card number).</li>
            <li><strong>Transaction Data:</strong> includes details about payments to and from you and other details of products and services you have purchased from us.</li>
            <li><strong>Content Data:</strong> includes the video files you upload to our servers for processing.</li>
            <li><strong>Technical Data:</strong> includes internet protocol (IP) address, your login data, browser type and version, and operating system.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>3. How We Use Your Data</h2>
          <p>We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>To register you as a new customer and manage your account.</li>
            <li>To process and deliver your video clips (including passing temporary video data to our AI sub-processors).</li>
            <li>To process your subscription payments.</li>
            <li>To improve our website, products/services, marketing, and customer relationships.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>4. Sub-processors and Third-Party Services</h2>
          <p>
            We use carefully selected third-party service providers (sub-processors) to operate our platform securely and efficiently. By using our service, you consent to data being processed by:
          </p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li><strong>Supabase:</strong> For secure database hosting and user authentication.</li>
            <li><strong>Stripe:</strong> For secure payment processing.</li>
            <li><strong>Cloudflare:</strong> For secure website routing, CDN, and DDoS protection.</li>
            <li><strong>Google Cloud Run:</strong> For secure, scalable backend server hosting.</li>
            <li><strong>DeepSeek & Groq:</strong> For processing AI language models (highlight generation) and rapidly transcribing subtitles.</li>
            <li><strong>Google Analytics:</strong> For understanding website traffic and usage patterns (only if you accept analytics cookies).</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>5. Data Security & Retention</h2>
          <p>
            We have put in place appropriate security measures to prevent your personal data from being accidentally lost, used, or accessed in an unauthorized way. 
          </p>
          <p style={{ marginTop: '8px' }}>
            We will only retain your personal data for as long as reasonably necessary to fulfill the purposes we collected it for. Uploaded video files are stored temporarily for processing and are automatically deleted from our main processing servers shortly after your clips are generated, unless saved to your specific project library.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>6. Your Legal Rights</h2>
          <p>
            Under certain circumstances, you have rights under data protection laws in relation to your personal data, including the right to:
          </p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>Request access to your personal data.</li>
            <li>Request correction of your personal data.</li>
            <li>Request erasure of your personal data (You can completely delete your account and all associated data at any time via your Settings page).</li>
            <li>Withdraw consent at any time (For example, declining tracking cookies or cancelling your account).</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>7. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or our privacy practices, please contact us at <strong>contact@emclipper.com</strong>.
          </p>
        </section>
      </div>
    </div>
  );
}
