import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Eye, MousePointerClick, FolderOpen, TrendingUp,
  Users, AlertTriangle, CheckCircle, Clock, Zap, Activity
} from 'lucide-react';
import { api } from '../api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar
} from 'recharts';

function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [dailyStats, setDailyStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingPace, setUpdatingPace] = useState(false);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const [ov, daily, recent] = await Promise.all([
        api.getOverview(),
        api.getDailyStats(30),
        api.getRecentActivity(30),
      ]);
      setOverview(ov);
      setDailyStats(daily);
      setRecentActivity(recent);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePaceChange = async (ms) => {
    try {
      setUpdatingPace(true);
      const result = await api.updateSendInterval(ms);
      console.log('Pace updated:', result);
      await loadData(); // Refresh UI
    } catch (err) {
      console.error('Failed to update pace:', err);
      alert(`Failed to update sender pace: ${err.message}`);
    } finally {
      setUpdatingPace(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  const stats = overview || {};
  const capacity = stats.capacity || {};
  const queue = stats.queue || {};

  // Merge daily data for charts
  const chartData = (dailyStats?.dailyStats || []).map(d => {
    const tracking = (dailyStats?.dailyTracking || []).find(t => t.date === d.date) || {};
    return {
      date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sent: d.sent || 0,
      failed: d.failed || 0,
      opens: tracking.opens || 0,
      clicks: tracking.clicks || 0,
    };
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    return (
      <div style={{
        background: '#1a1a2e',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: 12,
      }}>
        <div style={{ color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span>{p.name}</span>
            <span style={{ fontWeight: 700 }}>{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      {/* Stat Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon purple"><Send size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Total Sent</div>
            <div className="stat-value">{(stats.total_sent || 0).toLocaleString()}</div>
            <div className="stat-change positive">
              {queue.queued > 0 ? `${queue.queued} in queue` : 'Queue empty'}
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green"><Eye size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Opens</div>
            <div className="stat-value">{(stats.total_opens || 0).toLocaleString()}</div>
            <div className="stat-change positive">{stats.open_rate || 0}% open rate</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue"><MousePointerClick size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Clicks</div>
            <div className="stat-value">{(stats.total_clicks || 0).toLocaleString()}</div>
            <div className="stat-change positive">{stats.click_rate || 0}% click rate</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange"><FolderOpen size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Campaigns</div>
            <div className="stat-value">{stats.total_campaigns || 0}</div>
            <div className="stat-change positive">{stats.active_campaigns || 0} active</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon pink"><Zap size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Daily Capacity Left</div>
            <div className="stat-value">{(capacity.remaining_daily || 0).toLocaleString()}</div>
            <div className="stat-change positive">{capacity.active_accounts || 0} active accounts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon red"><AlertTriangle size={20} /></div>
          <div className="stat-info">
            <div className="stat-label">Failed</div>
            <div className="stat-value">{stats.total_failed || 0}</div>
            <div className="stat-change negative">
              {stats.total_sent > 0
                ? `${((stats.total_failed / stats.total_sent) * 100).toFixed(1)}% failure rate`
                : 'No sends yet'}
            </div>
          </div>
        </div>
      </div>

      {/* Pace Control */}
      <div className="card" style={{ marginBottom: 28, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="stat-icon blue" style={{ width: 36, height: 36 }}><Activity size={18} /></div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Sender Pace</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Current gap: <span style={{ color: '#6366f1', fontWeight: 600 }}>{((queue.sendInterval || 35000) / 1000).toFixed(0)}s</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: '🚀 Fast', ms: 10000, desc: '10s' },
              { label: '⚖️ Normal', ms: 35000, desc: '35s' },
              { label: '🐢 Slow', ms: 60000, desc: '60s' },
              { label: '🛡️ Safe', ms: 300000, desc: '5m' }
            ].map((pace) => (
              <button
                key={pace.ms}
                className={`btn btn-sm ${queue.sendInterval === pace.ms ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePaceChange(pace.ms)}
                disabled={updatingPace || queue.sendInterval === pace.ms}
                title={`Gap: ${pace.desc}`}
                style={{ minWidth: 90, padding: '6px 10px' }}
              >
                {pace.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid-2" style={{ marginBottom: 28 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">📈 Send Volume</div>
              <div className="card-subtitle">Last 30 days</div>
            </div>
          </div>
          <div className="chart-container">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" fill="url(#sentGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" fill="transparent" strokeWidth={1.5} strokeDasharray="4 4" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <Activity size={32} style={{ color: '#64748b', marginBottom: 8 }} />
                <div className="empty-state-text">No send data yet</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">👁️ Opens & Clicks</div>
              <div className="card-subtitle">Last 30 days</div>
            </div>
          </div>
          <div className="chart-container">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="opens" name="Opens" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="clicks" name="Clicks" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <Eye size={32} style={{ color: '#64748b', marginBottom: 8 }} />
                <div className="empty-state-text">No tracking data yet</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">⚡ Recent Activity</div>
            <div className="card-subtitle">Live send feed</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={loadData}>
            <Activity size={14} /> Refresh
          </button>
        </div>
        <div className="live-feed">
          {recentActivity.length > 0 ? (
            recentActivity.map((item, i) => (
              <div key={i} className="feed-item">
                <div className={`feed-dot ${item.status}`} />
                <span className="feed-time">
                  {new Date(item.created_at).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className="feed-text">
                  {item.status === 'sent' ? '✉️' : '❌'} {item.recipient_email}
                  {item.subject ? ` — "${item.subject.substring(0, 40)}${item.subject.length > 40 ? '...' : ''}"` : ''}
                </span>
                <span className="feed-sender">{item.sender_email?.split('@')[0]}</span>
              </div>
            ))
          ) : (
            <div className="empty-state" style={{ padding: 32 }}>
              <Clock size={32} style={{ color: '#64748b', marginBottom: 8 }} />
              <div className="empty-state-text">No activity yet. Start a campaign to see live sends!</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
