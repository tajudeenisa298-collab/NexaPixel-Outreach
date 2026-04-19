import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Send, FolderOpen, Users, BarChart3,
  Settings, Zap, Plus, RefreshCw, Mail
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import NewCampaign from './pages/NewCampaign';
import Accounts from './pages/Accounts';
import './index.css';

function Sidebar() {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">N</div>
        <div>
          <div className="sidebar-logo-text">NexaPixel</div>
          <div className="sidebar-logo-subtext">Outreach</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Main</div>
        <NavLink to="/" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} end>
          <LayoutDashboard size={18} />
          Dashboard
        </NavLink>
        <NavLink to="/campaigns" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <FolderOpen size={18} />
          Campaigns
        </NavLink>
        <NavLink to="/campaigns/new" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <Plus size={18} />
          New Campaign
        </NavLink>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">System</div>
        <NavLink to="/accounts" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <Mail size={18} />
          Sender Accounts
        </NavLink>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-capacity">
          <div className="sidebar-capacity-label">Send Engine</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} style={{ color: '#10b981' }} />
            <span className="sidebar-capacity-text">System Active</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PageHeader({ title, children }) {
  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      <div className="header-actions">{children}</div>
    </header>
  );
}

function AppContent() {
  const location = useLocation();

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    if (path === '/campaigns/new') return 'Create Campaign';
    if (path.startsWith('/campaigns/')) return 'Campaign Details';
    if (path === '/campaigns') return 'Campaigns';
    if (path === '/accounts') return 'Sender Accounts';
    return 'Dashboard';
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <PageHeader title={getPageTitle()} />
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/new" element={<NewCampaign />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/accounts" element={<Accounts />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
