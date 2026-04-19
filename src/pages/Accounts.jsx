import { useState, useEffect } from 'react';
import { Mail, RefreshCw, CheckCircle, XCircle, AlertTriangle, Zap, Plus, Trash2, Pause, Play } from 'lucide-react';
import { api } from '../api';

function Accounts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newAcc, setNewAcc] = useState({ type: 'gmail', email: '', password: '', display_name: '' });

  const loadAccounts = async () => {
    try {
      const result = await api.getAccounts();
      setData(result);
    } catch (err) {
      console.error('Load accounts error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    const interval = setInterval(loadAccounts, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newAcc.email || !newAcc.password) return alert('Email and Password/API Key are required');
    setAdding(true);
    try {
      const res = await api.addAccount(newAcc);
      alert(res.message);
      setNewAcc({ type: 'gmail', email: '', password: '', display_name: '' });
      loadAccounts();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteAccount = async (id) => {
    if (!window.confirm('Are you sure you want to completely remove this sender account?')) return;
    try {
      await api.deleteAccount(id);
      loadAccounts();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTogglePause = async (id, currentPauseState) => {
    try {
      await api.toggleAccountPause(id, !currentPauseState);
      loadAccounts();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading accounts...</span>
      </div>
    );
  }

  const accounts = data?.accounts || [];
  const capacity = data?.capacity || {};
  const smtpAccounts = accounts.filter(a => a.type !== 'brevo');
  const brevoAccounts = accounts.filter(a => a.type === 'brevo');

  const totalDailyLimit = accounts.reduce((sum, a) => sum + a.daily_limit, 0);
  const totalDailySent = accounts.reduce((sum, a) => sum + a.daily_sent, 0);
  const usagePercent = totalDailyLimit > 0 ? ((totalDailySent / totalDailyLimit) * 100).toFixed(1) : 0;

  return (
    <div>
      {/* Capacity Overview */}
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-icon purple"><Mail size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Total Accounts</div>
            <div className="stat-value">{accounts.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Zap size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Active Accounts</div>
            <div className="stat-value">{capacity.active_accounts || 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><RefreshCw size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Sent Today</div>
            <div className="stat-value">{totalDailySent.toLocaleString()}</div>
            <div className="stat-change positive">of {totalDailyLimit.toLocaleString()} daily limit</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><AlertTriangle size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Remaining Capacity</div>
            <div className="stat-value">{(capacity.remaining_daily || 0).toLocaleString()}</div>
            <div className="stat-change positive">{usagePercent}% used</div>
          </div>
        </div>
      </div>

      {/* Daily Usage Bar */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Daily Capacity Usage</span>
          <span style={{ color: 'var(--accent-primary-hover)', fontWeight: 600 }}>
            {totalDailySent} / {totalDailyLimit} ({usagePercent}%)
          </span>
        </div>
        <div className="progress-bar" style={{ height: 12 }}>
          <div
            className="progress-fill gradient"
            style={{
              width: `${usagePercent}%`,
              background: parseFloat(usagePercent) > 80
                ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                : 'var(--accent-gradient)',
            }}
          />
        </div>
      </div>

      {/* Add Account Card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-title">➕ Add Sender Account</div>
            <div className="card-subtitle">Connect a new Gmail or Brevo account</div>
          </div>
        </div>
        <form onSubmit={handleAddAccount} style={{ padding: 20 }}>
          <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Platform</label>
              <select 
                className="input" 
                value={newAcc.type}
                onChange={e => setNewAcc({ ...newAcc, type: e.target.value })}
              >
                <option value="gmail">Google Workspace / Gmail</option>
                <option value="outlook">Outlook / Hotmail</option>
                <option value="zoho">Zoho Mail</option>
                <option value="smtp">Other Custom SMTP</option>
                <option value="brevo">Brevo API</option>
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Email Address</label>
              <input 
                type="email" 
                className="input" 
                placeholder="sales@company.com" 
                value={newAcc.email}
                onChange={e => setNewAcc({ ...newAcc, email: e.target.value })}
                required 
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">
                {newAcc.type === 'brevo' ? 'API Key' : 'App Password / SMTP Password'}
              </label>
              <input 
                type="password" 
                className="input" 
                placeholder={newAcc.type === 'brevo' ? 'xkeysib-...' : 'xxxx xxxx xxxx xxxx'}
                value={newAcc.password}
                onChange={e => setNewAcc({ ...newAcc, password: e.target.value })}
                required 
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Friendly Name (Optional)</label>
              <input 
                type="text" 
                className="input" 
                placeholder="John Doe" 
                value={newAcc.display_name}
                onChange={e => setNewAcc({ ...newAcc, display_name: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Connecting & Verifying...' : 'Connect Account'}
          </button>
        </form>
      </div>

      {/* SMTP Accounts */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-title">📧 SMTP Accounts ({smtpAccounts.length})</div>
            <div className="card-subtitle">Using App Passwords • 400/day limit per account default</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={loadAccounts}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="account-grid">
          {smtpAccounts.map(account => {
            const usage = account.daily_limit > 0
              ? ((account.daily_sent / account.daily_limit) * 100).toFixed(0)
              : 0;
            const isLimited = account.daily_sent >= account.daily_limit;
            const isPaused = account.is_paused === 1;
            const isActive = account.is_active && !isLimited && !isPaused;
            const typeLabel = account.type.charAt(0).toUpperCase() + account.type.slice(1);

            return (
              <div key={account.id} className="account-card" style={{ opacity: isPaused ? 0.7 : 1 }}>
                <div className={`account-avatar ${account.type === 'outlook' ? 'blue' : account.type === 'zoho' ? 'green' : 'gmail'}`}>{account.type.charAt(0).toUpperCase()}</div>
                <div className="account-info">
                  <div className="account-email">{account.email}</div>
                  <div className="account-stats">
                    {typeLabel} • {account.daily_sent}/{account.daily_limit} today • {account.hourly_sent}/{account.hourly_limit} this hour
                  </div>
                  <div className="progress-bar" style={{ height: 3, marginTop: 6, opacity: isPaused ? 0.5 : 1 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${usage}%`,
                        background: isPaused ? '#9ca3af' : isLimited ? '#ef4444' : parseFloat(usage) > 70 ? '#f59e0b' : '#10b981',
                      }}
                    />
                  </div>
                  {account.last_error && !isPaused && (
                    <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>
                      ⚠️ {account.last_error.substring(0, 50)}
                    </div>
                  )}
                  {isPaused && (
                     <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
                     ⏸️ Paused by user
                   </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleTogglePause(account.id, isPaused)} className="btn btn-sm" style={{ color: isPaused ? '#10b981' : '#f59e0b', background: isPaused ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', fontSize: 11, border: 'none' }}>
                      {isPaused ? <Play size={12} style={{ marginRight: 4 }} /> : <Pause size={12} style={{ marginRight: 4 }} />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" onClick={() => handleDeleteAccount(account.id)} className="btn btn-sm" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', fontSize: 11, border: 'none' }}>
                      <Trash2 size={12} style={{ marginRight: 4 }} /> Remove
                    </button>
                  </div>
                </div>
                <div
                  className={`account-status-dot ${isPaused ? 'inactive' : isActive ? 'active' : isLimited ? 'limited' : 'inactive'}`}
                  title={isPaused ? 'Paused' : isActive ? 'Active' : isLimited ? 'At daily limit' : 'Inactive'}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Brevo Accounts */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">🏢 Brevo Domain Accounts ({brevoAccounts.length})</div>
            <div className="card-subtitle">Using Brevo API • 300/day limit per account (free plan)</div>
          </div>
        </div>
        <div className="account-grid">
          {brevoAccounts.map(account => {
            const usage = account.daily_limit > 0
              ? ((account.daily_sent / account.daily_limit) * 100).toFixed(0)
              : 0;
            const isLimited = account.daily_sent >= account.daily_limit;
            const isPaused = account.is_paused === 1;
            const isActive = account.is_active && !isLimited && !isPaused;

            return (
              <div key={account.id} className="account-card" style={{ opacity: isPaused ? 0.7 : 1 }}>
                <div className="account-avatar brevo">B</div>
                <div className="account-info">
                  <div className="account-email">{account.email}</div>
                  <div className="account-stats">
                    {account.daily_sent}/{account.daily_limit} today
                    {account.display_name && ` • ${account.display_name}`}
                  </div>
                  <div className="progress-bar" style={{ height: 3, marginTop: 6, opacity: isPaused ? 0.5 : 1 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${usage}%`,
                        background: isPaused ? '#9ca3af' : isLimited ? '#ef4444' : parseFloat(usage) > 70 ? '#f59e0b' : '#3b82f6',
                      }}
                    />
                  </div>
                  {account.last_error && !isPaused && (
                    <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>
                      ⚠️ {account.last_error.substring(0, 50)}
                    </div>
                  )}
                  {isPaused && (
                     <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
                     ⏸️ Paused by user
                   </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleTogglePause(account.id, isPaused)} className="btn btn-sm" style={{ color: isPaused ? '#10b981' : '#f59e0b', background: isPaused ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', fontSize: 11, border: 'none' }}>
                      {isPaused ? <Play size={12} style={{ marginRight: 4 }} /> : <Pause size={12} style={{ marginRight: 4 }} />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" onClick={() => handleDeleteAccount(account.id)} className="btn btn-sm" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', fontSize: 11, border: 'none' }}>
                      <Trash2 size={12} style={{ marginRight: 4 }} /> Remove
                    </button>
                  </div>
                </div>
                <div
                  className={`account-status-dot ${isPaused ? 'inactive' : isActive ? 'active' : isLimited ? 'limited' : 'inactive'}`}
                  title={isPaused ? 'Paused' : isActive ? 'Active' : isLimited ? 'At daily limit' : 'Inactive'}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Accounts;
