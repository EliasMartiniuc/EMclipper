import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Video, LayoutDashboard, CreditCard, LogIn, UserPlus } from 'lucide-react';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Subscription from './pages/Subscription';
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import { UploadProvider } from './UploadContext';
import { AuthProvider, useAuth } from './AuthContext';
import { LogOut, Menu, X } from 'lucide-react';

function Navbar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const navLinks = [
    { path: '/', label: 'Home', icon: Video },
    { path: '/projects', label: 'Projects', icon: LayoutDashboard },
    { path: '/subscription', label: 'Subscription', icon: CreditCard },
  ];

  return (
    <nav style={{ padding: '24px 0', marginBottom: '40px', position: 'relative' }}>
      <div className="container nav-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="neu-box" style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-color)' }}>
            <Video size={24} strokeWidth={2.5} />
          </div>
          <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-primary)' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>EMclipper</h2>
          </Link>
        </div>

        {/* Desktop Links */}
        <div className="nav-links desktop-only">
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

        {/* Desktop Auth */}
        <div className="nav-auth desktop-only">
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {user.user_metadata?.full_name || user.email}
              </span>
              <button onClick={signOut} className="neu-btn" style={{ padding: '8px 16px' }}>
                <LogOut size={18} />
                Log Out
              </button>
            </div>
          ) : (
            <>
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
            </>
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

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="mobile-menu neu-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {navLinks.map(link => {
              const isActive = location.pathname === link.path || (link.path !== '/' && location.pathname.startsWith(link.path));
              return (
                <Link key={link.path} to={link.path} style={{ textDecoration: 'none' }} onClick={() => setIsMobileMenuOpen(false)}>
                  <button className={`neu-btn ${isActive ? 'active' : ''}`} style={{ width: '100%', justifyContent: 'flex-start' }}>
                    <link.icon size={18} />
                    {link.label}
                  </button>
                </Link>
              );
            })}
            
            <hr style={{ border: 'none', borderTop: '2px solid var(--shadow-dark)', margin: '8px 0' }} />
            
            {user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'center', padding: '8px' }}>
                  {user.user_metadata?.full_name || user.email}
                </span>
                <button onClick={() => { signOut(); setIsMobileMenuOpen(false); }} className="neu-btn" style={{ width: '100%', justifyContent: 'center' }}>
                  <LogOut size={18} />
                  Log Out
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Link to="/login" style={{ textDecoration: 'none' }} onClick={() => setIsMobileMenuOpen(false)}>
                  <button className="neu-btn" style={{ width: '100%', justifyContent: 'center' }}>
                    <LogIn size={18} />
                    Log In
                  </button>
                </Link>
                <Link to="/signup" style={{ textDecoration: 'none' }} onClick={() => setIsMobileMenuOpen(false)}>
                  <button className="neu-btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    <UserPlus size={18} />
                    Sign Up
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <UploadProvider>
        <Navbar />
        <main className="container" style={{ paddingBottom: '100px' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:videoId" element={<ProjectDetail />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/login" element={<Auth type="login" />} />
            <Route path="/signup" element={<Auth type="signup" />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
          </Routes>
        </main>
      </UploadProvider>
    </Router>
    </AuthProvider>
  );
}

export default App;
