import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Video, LayoutDashboard, CreditCard, LogIn, UserPlus } from 'lucide-react';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Subscription from './pages/Subscription';
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import Settings from './pages/Settings';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import { UploadProvider, useUpload } from './UploadContext';
import { AuthProvider, useAuth } from './AuthContext';
import { LogOut, Menu, X, User, Settings as SettingsIcon } from 'lucide-react';

function Navbar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { subscriptionStatus } = useUpload();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = React.useState(false);

  const navigate = useNavigate();

  // Close dropdowns when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.profile-dropdown-container')) {
        setIsProfileDropdownOpen(false);
      }
      if (!event.target.closest('.mobile-menu') && !event.target.closest('.mobile-menu-btn')) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const handleMobileNav = (path) => {
    setTimeout(() => {
      setIsMobileMenuOpen(false);
      navigate(path);
    }, 150);
  };

  const handleMobileAction = (action) => {
    setTimeout(() => {
      setIsMobileMenuOpen(false);
      action();
    }, 150);
  };

  const navLinks = [
    { path: '/', label: 'Home', icon: Video },
    { path: '/projects', label: 'Projects', icon: LayoutDashboard },
    { path: '/subscription', label: 'Subscription', icon: CreditCard },
  ];

  return (
    <nav className="navbar-pill" style={{ 
      padding: '12px 24px', 
      margin: '24px auto 40px auto', 
      position: 'sticky', 
      top: '24px', 
      zIndex: 100,
      background: 'rgba(247, 247, 250, 0.5)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: '40px',
      boxShadow: 'var(--neu-shadow)',
      border: '1px solid rgba(255,255,255,0.4)'
    }}>
      <div className="nav-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '32px', width: '100%' }}>
        
        {/* Left Side: Logo */}
        <div>
          <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="neu-box" style={{ padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
              <img src="/logo.png" alt="EMclipper Logo" style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover' }} />
            </div>
            <h2 className="desktop-only" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>EMclipper</h2>
          </Link>
        </div>

        {/* Center: Desktop Links */}
        <div className="nav-links desktop-only" style={{ display: 'flex', gap: '12px' }}>
          {navLinks.map(link => {
            const isActive = location.pathname === link.path || (link.path !== '/' && location.pathname.startsWith(link.path));
            return (
              <Link key={link.path} to={link.path} style={{ textDecoration: 'none' }}>
                <button className={`neu-btn ${isActive ? 'active' : ''}`}>
                  <link.icon size={18} />
                  {link.label}
                </button>
              </Link>
            );
          })}
        </div>

        {/* Right Side: Auth & Hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Desktop Auth */}
          <div className="nav-auth desktop-only">
            {user ? (
              <div className="profile-dropdown-container" style={{ position: 'relative' }}>
                <button 
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)} 
                  className="neu-btn" 
                  style={{ width: '42px', height: '42px', padding: '0', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                  aria-label="User Profile"
                >
                  <User size={20} />
                </button>

                {isProfileDropdownOpen && (
                  <div className="neu-card profile-dropdown" style={{ 
                    position: 'absolute', 
                    top: '110%', 
                    right: 0, 
                    width: '220px', 
                    padding: '12px',
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '8px',
                    zIndex: 1000
                  }}>
                    <Link to="/settings" style={{ textDecoration: 'none' }} onClick={() => setIsProfileDropdownOpen(false)}>
                      <button className="neu-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
                        <SettingsIcon size={16} />
                        Settings
                      </button>
                    </Link>
                    <button onClick={() => { signOut(); setIsProfileDropdownOpen(false); }} className="neu-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
                      <LogOut size={16} />
                      Log Out
                    </button>
                    
                    <hr style={{ border: 'none', borderTop: '2px solid var(--shadow-dark)', margin: '4px 0' }} />
                    
                    <div style={{ padding: '8px 4px', fontSize: '0.85rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.user_metadata?.full_name || user.email}
                      {subscriptionStatus?.is_admin && (
                        <span style={{ marginLeft: '6px', background: 'var(--accent-color)', color: 'white', padding: '2px 6px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 'bold' }}>ADMIN</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '12px' }}>
                <Link to="/login" style={{ textDecoration: 'none' }}>
                  <button className="neu-btn">
                    <LogIn size={18} />
                    Log In
                  </button>
                </Link>
                <Link to="/signup" style={{ textDecoration: 'none' }}>
                  <button className="neu-btn-primary">
                    <UserPlus size={18} />
                    Sign Up
                  </button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Hamburger Button */}
          <button 
            className="neu-btn mobile-menu-btn" 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="mobile-menu neu-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
            {navLinks.map(link => {
              const isActive = location.pathname === link.path || (link.path !== '/' && location.pathname.startsWith(link.path));
              return (
                <button 
                  key={link.path} 
                  onClick={() => handleMobileNav(link.path)} 
                  className={`neu-btn ${isActive ? 'active' : ''}`} 
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  <link.icon size={18} />
                  {link.label}
                </button>
              );
            })}
            
            <hr style={{ border: 'none', borderTop: '2px solid var(--shadow-dark)', margin: '8px 0' }} />
            
            {user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button onClick={() => handleMobileNav('/settings')} className="neu-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
                  <SettingsIcon size={18} />
                  Settings
                </button>
                <button onClick={() => handleMobileAction(signOut)} className="neu-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
                  <LogOut size={18} />
                  Log Out
                </button>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'center', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {user.user_metadata?.full_name || user.email}
                  {subscriptionStatus?.is_admin && (
                    <span style={{ background: 'var(--accent-color)', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold' }}>ADMIN</span>
                  )}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button onClick={() => handleMobileNav('/login')} className="neu-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
                  <LogIn size={18} />
                  Log In
                </button>
                <button onClick={() => handleMobileNav('/signup')} className="neu-btn-primary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                  <UserPlus size={18} />
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();

  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function CookieBanner() {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (!consent) {
      setShow(true);
    } else if (consent === 'accepted') {
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('consent', 'update', {
          'analytics_storage': 'granted'
        });
      }
    }
  }, []);

  if (!show) return null;

  return (
    <div className="navbar-pill" style={{
      position: 'fixed', 
      bottom: '24px', 
      left: '50%', 
      transform: 'translateX(-50%)',
      padding: '20px 24px',
      display: 'flex', 
      flexDirection: 'column', 
      gap: '16px',
      alignItems: 'center', 
      justifyContent: 'center',
      zIndex: 9999,
      width: '95%',
      maxWidth: '800px',
      background: 'rgba(247, 247, 250, 0.5)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: '40px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.2), var(--neu-shadow)',
      border: '1px solid rgba(255,255,255,0.4)'
    }}>
      <div style={{ maxWidth: '800px', display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ flex: '1 1 300px' }}>
          <h3 style={{ marginBottom: '8px', fontSize: '1.1rem' }}>We use cookies 🍪</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>
            We use Google Analytics to understand how you use EMclipper so we can improve the platform. Do you accept these analytics cookies?
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="neu-btn"
            onClick={() => {
              localStorage.setItem('cookieConsent', 'declined');
              setShow(false);
            }}
          >
            Decline
          </button>
          <button 
            className="neu-btn-primary"
            onClick={() => {
              localStorage.setItem('cookieConsent', 'accepted');
              if (window.gtag) {
                window.gtag('consent', 'update', { 'analytics_storage': 'granted' });
              }
              setShow(false);
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="navbar-pill" style={{
      margin: '0 auto 40px auto',
      padding: '32px 24px',
      background: 'rgba(247, 247, 250, 0.5)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: '40px',
      boxShadow: 'var(--neu-shadow)',
      border: '1px solid rgba(255,255,255,0.4)',
      width: '95%',
      maxWidth: '1000px',
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      gap: '24px' 
    }}>
      {/* Logo & Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.png" alt="EMclipper Logo" style={{ width: '32px', height: '32px' }} />
        <span style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          EMclipper
        </span>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/" className="footer-link">Home</Link>
        <Link to="/subscription" className="footer-link">Pricing</Link>
        <Link to="/terms" className="footer-link">Terms of Service</Link>
        <Link to="/privacy" className="footer-link">Privacy Policy</Link>
      </div>

      {/* Divider & Copyright */}
      <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '100%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.05), transparent)' }}></div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          &copy; {new Date().getFullYear()} EMclipper. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <ScrollToTop />
        <CookieBanner />
        <UploadProvider>
        <Navbar />
        <main className="container" style={{ paddingBottom: '100px', minHeight: 'calc(100vh - 300px)' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:videoId" element={<ProjectDetail />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/login" element={<Auth type="login" />} />
            <Route path="/signup" element={<Auth type="signup" />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
          </Routes>
        </main>
        <Footer />
      </UploadProvider>
    </Router>
    </AuthProvider>
  );
}

export default App;
