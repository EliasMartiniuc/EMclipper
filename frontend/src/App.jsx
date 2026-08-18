import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Video, LayoutDashboard, CreditCard, LogIn, UserPlus } from 'lucide-react';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Subscription from './pages/Subscription';
import Auth from './pages/Auth';
import { UploadProvider } from './UploadContext';

function Navbar() {
  const location = useLocation();

  const navLinks = [
    { path: '/', label: 'Home', icon: Video },
    { path: '/projects', label: 'Projects', icon: LayoutDashboard },
    { path: '/subscription', label: 'Subscription', icon: CreditCard },
  ];

  return (
    <nav style={{ padding: '24px 0', marginBottom: '40px' }}>
      <div className="container nav-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="neu-box" style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-color)' }}>
            <Video size={24} strokeWidth={2.5} />
          </div>
          <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-primary)' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>EMclipper</h2>
          </Link>
        </div>

        <div className="nav-links">
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

        <div className="nav-auth">
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
      </div>
    </nav>
  );
}

function App() {
  return (
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
          </Routes>
        </main>
      </UploadProvider>
    </Router>
  );
}

export default App;
