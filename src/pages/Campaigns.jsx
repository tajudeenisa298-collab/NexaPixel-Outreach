import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  FolderOpen, Plus, Play, Pause, Trash2, Eye, Send,
  MousePointerClick, ChevronRight, Clock, CheckCircle, AlertTriangle
} from 'lucide-react';
import { api } from '../api';

function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadCampaigns = async () => {
    try {
      const data = await api.getCampaigns();
      setCampaigns(data);
    } catch (err) {
      console.error('Load campaigns error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
    const interval = setInterval(loadCampaigns, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async (id, e) => {
    e.stopPropagation();
    try {
      await api.startCampaign(id);
      loadCampaigns();
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePause = async (id, e) => {
    e.stopPropagation();
    try {
      await api.pauseCampaign(id);
      loadCampaigns();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleResume = async (id, e) => {
    e.stopPropagation();
    try {
      await api.resumeCampaign(id);
      loadCampaigns();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await api.deleteCampaign(id);
      loadCampaigns();
    } catch (err) {
      alert(err.message);
    }
  };

  const getStatusBadge = (status) => {
    const map = {
      draft: { class: 'badge-neutral', icon: <Clock size={10} />, label: 'Draft' },
      active: { class: 'badge-success', icon: <Play size={10} />, label: 'Active' },
      paused: { class: 'badge-warning', icon: <Pause size={10} />, label: 'Paused' },
      completed: { class: 'badge-info', icon: <CheckCircle size={10} />, label: 'Completed' },
      cancelled: { class: 'badge-error', icon: <AlertTriangle size={10} />, label: 'Cancelled' },
    };
    const cfg = map[status] || map.draft;
    return <span className={`badge ${cfg.class}`}>{cfg.icon} {cfg.label}</span>;
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading campaigns...</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} total
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/campaigns/new')}>
          <Plus size={16} /> New Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <FolderOpen size={48} className="empty-state-icon" />
            <div className="empty-state-title">No campaigns yet</div>
            <div className="empty-state-text">
              Create your first campaign to start sending personalized outreach emails.
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/campaigns/new')}>
              <Plus size={16} /> Create Campaign
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Sent</th>
                <th>Opens</th>
                <th>Clicks</th>
                <th>Open Rate</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(campaign => {
                const openRate = campaign.sent_count > 0
                  ? ((campaign.open_count / campaign.sent_count) * 100).toFixed(1)
                  : '0.0';
                const progress = campaign.total_leads > 0
                  ? ((campaign.sent_count / campaign.total_leads) * 100)
                  : 0;

                return (
                  <tr
                    key={campaign.id}
                    onClick={() => navigate(`/campaigns/${campaign.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: 'rgba(99,102,241,0.12)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <FolderOpen size={14} style={{ color: '#818cf8' }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                            {campaign.name}
                          </div>
                          {campaign.status === 'active' && (
                            <div className="progress-bar" style={{ width: 80, height: 4, marginTop: 4 }}>
                              <div className="progress-fill gradient" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{getStatusBadge(campaign.status)}</td>
                    <td>{campaign.total_leads?.toLocaleString()}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Send size={12} style={{ color: '#6366f1' }} />
                        {campaign.sent_count?.toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Eye size={12} style={{ color: '#10b981' }} />
                        {campaign.open_count?.toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MousePointerClick size={12} style={{ color: '#3b82f6' }} />
                        {campaign.click_count?.toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <span style={{ color: parseFloat(openRate) > 20 ? '#10b981' : 'var(--text-secondary)' }}>
                        {openRate}%
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        {campaign.status === 'draft' && (
                          <button className="btn btn-sm btn-success" onClick={(e) => handleStart(campaign.id, e)} title="Start sending">
                            <Play size={12} />
                          </button>
                        )}
                        {campaign.status === 'active' && (
                          <button className="btn btn-sm btn-secondary" onClick={(e) => handlePause(campaign.id, e)} title="Pause">
                            <Pause size={12} />
                          </button>
                        )}
                        {campaign.status === 'paused' && (
                          <button className="btn btn-sm btn-success" onClick={(e) => handleResume(campaign.id, e)} title="Resume">
                            <Play size={12} />
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(campaign.id, e)} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Campaigns;
