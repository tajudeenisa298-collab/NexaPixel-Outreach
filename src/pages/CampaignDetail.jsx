import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, Send, Eye, MousePointerClick,
  CheckCircle, Clock, AlertTriangle, XCircle, RefreshCw,
  Calendar, Plus, Trash2
} from 'lucide-react';
import { api } from '../api';

function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSequenceModal, setShowSequenceModal] = useState(false);
  const [sequences, setSequences] = useState([]);

  const loadCampaign = async () => {
    try {
      const data = await api.getCampaign(id);
      setCampaign(data);
      setSequences(data.sequences || []);
    } catch (err) {
      console.error('Load campaign error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaign();
    const interval = setInterval(loadCampaign, 10000);
    return () => clearInterval(interval);
  }, [id]);

  const handleStart = async () => {
    try {
      await api.startCampaign(id);
      loadCampaign();
    } catch (err) { alert(err.message); }
  };

  const handlePause = async () => {
    try {
      await api.pauseCampaign(id);
      loadCampaign();
    } catch (err) { alert(err.message); }
  };

  const handleResume = async () => {
    try {
      await api.resumeCampaign(id);
      loadCampaign();
    } catch (err) { alert(err.message); }
  };

  const handleScheduleFollowups = async () => {
    try {
      await api.scheduleFollowups(id);
      alert('Follow-ups scheduled!');
    } catch (err) { alert(err.message); }
  };

  const handleRetryFailed = async () => {
    try {
      const res = await api.retryFailed(id);
      alert(res.message);
      loadCampaign();
    } catch (err) { alert(err.message); }
  };

  const handleSaveSequences = async () => {
    try {
      await api.updateSequences(id, sequences);
      setShowSequenceModal(false);
      loadCampaign();
    } catch (err) { alert(err.message); }
  };

  const addSequenceStep = () => {
    const nextStep = sequences.length + 1;
    setSequences([...sequences, {
      step_number: nextStep,
      delay_days: 2,
      subject_template: '',
      body_template: '',
      condition: 'no_open',
    }]);
  };

  const updateSequence = (index, field, value) => {
    const updated = [...sequences];
    updated[index][field] = value;
    setSequences(updated);
  };

  const removeSequence = (index) => {
    const updated = sequences.filter((_, i) => i !== index);
    updated.forEach((s, i) => s.step_number = i + 1);
    setSequences(updated);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent': return <CheckCircle size={14} style={{ color: '#10b981' }} />;
      case 'pending': return <Clock size={14} style={{ color: '#64748b' }} />;
      case 'queued': return <RefreshCw size={14} style={{ color: '#f59e0b' }} />;
      case 'sending': return <Send size={14} style={{ color: '#6366f1' }} />;
      case 'failed': return <XCircle size={14} style={{ color: '#ef4444' }} />;
      default: return <Clock size={14} style={{ color: '#64748b' }} />;
    }
  };

  const getStatusBadge = (status) => {
    const map = {
      draft: 'badge-neutral', active: 'badge-success', paused: 'badge-warning',
      completed: 'badge-info', cancelled: 'badge-error',
      pending: 'badge-neutral', queued: 'badge-warning', sending: 'badge-purple',
      sent: 'badge-success', failed: 'badge-error',
    };
    return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading campaign...</span>
      </div>
    );
  }

  if (!campaign) {
    return <div className="empty-state"><div className="empty-state-title">Campaign not found</div></div>;
  }

  const leads = campaign.leads || [];
  const openRate = campaign.sent_count > 0 ? ((campaign.open_count / campaign.sent_count) * 100).toFixed(1) : '0.0';
  const clickRate = campaign.sent_count > 0 ? ((campaign.click_count / campaign.sent_count) * 100).toFixed(1) : '0.0';
  const progress = campaign.total_leads > 0 ? ((campaign.sent_count / campaign.total_leads) * 100).toFixed(1) : '0';

  return (
    <div>
      {/* Back + Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/campaigns')}>
          <ArrowLeft size={16} /> Back to Campaigns
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {campaign.status === 'draft' && (
            <button className="btn btn-success" onClick={handleStart}><Play size={16} /> Start Campaign</button>
          )}
          {campaign.status === 'active' && (
            <button className="btn btn-secondary" onClick={handlePause}><Pause size={16} /> Pause</button>
          )}
          {campaign.status === 'paused' && (
            <button className="btn btn-success" onClick={handleResume}><Play size={16} /> Resume</button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowSequenceModal(true)}>
            <Calendar size={16} /> Follow-up Sequences
          </button>
          {(campaign.status === 'completed' || campaign.status === 'active') && sequences.length > 0 && (
            <button className="btn btn-primary" onClick={handleScheduleFollowups}>
              <Send size={16} /> Schedule Follow-ups
            </button>
          )}
          {leads.some(l => l.status === 'failed') && (
            <button className="btn btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }} onClick={handleRetryFailed}>
              <RefreshCw size={16} /> Retry Failed
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-info" style={{ textAlign: 'center', width: '100%' }}>
            <div className="stat-label">Total Leads</div>
            <div className="stat-value" style={{ fontSize: 24 }}>{campaign.total_leads}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info" style={{ textAlign: 'center', width: '100%' }}>
            <div className="stat-label">Sent</div>
            <div className="stat-value" style={{ fontSize: 24, color: '#6366f1' }}>{campaign.sent_count}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{progress}%</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info" style={{ textAlign: 'center', width: '100%' }}>
            <div className="stat-label">Opens</div>
            <div className="stat-value" style={{ fontSize: 24, color: '#10b981' }}>{campaign.open_count}</div>
            <div style={{ fontSize: 11, color: '#10b981' }}>{openRate}%</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info" style={{ textAlign: 'center', width: '100%' }}>
            <div className="stat-label">Clicks</div>
            <div className="stat-value" style={{ fontSize: 24, color: '#3b82f6' }}>{campaign.click_count}</div>
            <div style={{ fontSize: 11, color: '#3b82f6' }}>{clickRate}%</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info" style={{ textAlign: 'center', width: '100%' }}>
            <div className="stat-label">Status</div>
            <div style={{ marginTop: 8 }}>{getStatusBadge(campaign.status)}</div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {campaign.status === 'active' && (
        <div className="card" style={{ marginBottom: 28, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Sending Progress</span>
            <span style={{ color: 'var(--accent-primary-hover)', fontWeight: 600 }}>{progress}%</span>
          </div>
          <div className="progress-bar" style={{ height: 10 }}>
            <div className="progress-fill gradient" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📋 Leads ({leads.length})</div>
          <button className="btn btn-sm btn-secondary" onClick={loadCampaign}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="table-container" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Sent Via</th>
                <th>Opens</th>
                <th>Clicks</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id}>
                  <td>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 13 }}>
                        {lead.first_name} {lead.last_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lead.recipient_email}</div>
                    </div>
                  </td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lead.subject}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {getStatusIcon(lead.status)}
                      {getStatusBadge(lead.status)}
                    </div>
                  </td>
                  <td style={{ fontSize: 11 }}>{lead.sender_email || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Eye size={12} style={{ color: lead.open_count > 0 ? '#10b981' : '#64748b' }} />
                      <span style={{ color: lead.open_count > 0 ? '#10b981' : 'inherit' }}>{lead.open_count}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MousePointerClick size={12} style={{ color: lead.click_count > 0 ? '#3b82f6' : '#64748b' }} />
                      <span style={{ color: lead.click_count > 0 ? '#3b82f6' : 'inherit' }}>{lead.click_count}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {lead.sent_at ? new Date(lead.sent_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sequence Modal */}
      {showSequenceModal && (
        <div className="modal-overlay" onClick={() => setShowSequenceModal(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🔄 Follow-up Sequences</div>
              <button className="modal-close" onClick={() => setShowSequenceModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                Set up automated follow-up emails. Use {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'} as placeholders.
              </p>

              <div className="sequence-steps">
                {sequences.map((seq, index) => (
                  <div key={index}>
                    {index > 0 && <div className="sequence-connector" />}
                    <div className="sequence-step">
                      <div className="sequence-step-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="sequence-step-number">{seq.step_number}</div>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>Follow-up {seq.step_number}</span>
                        </div>
                        <button className="btn btn-sm btn-danger" onClick={() => removeSequence(index)}>
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label">Delay (days after previous)</label>
                          <input
                            type="number"
                            className="input"
                            value={seq.delay_days}
                            onChange={e => updateSequence(index, 'delay_days', parseInt(e.target.value) || 1)}
                            min="1"
                          />
                        </div>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label">Send Condition</label>
                          <select
                            className="input"
                            value={seq.condition}
                            onChange={e => updateSequence(index, 'condition', e.target.value)}
                          >
                            <option value="no_open">If no open</option>
                            <option value="no_click">If no click</option>
                            <option value="always">Always send</option>
                          </select>
                        </div>
                      </div>

                      <div className="input-group" style={{ marginBottom: 8 }}>
                        <label className="input-label">Subject</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="Re: Following up on my previous email, {{first_name}}"
                          value={seq.subject_template}
                          onChange={e => updateSequence(index, 'subject_template', e.target.value)}
                        />
                      </div>

                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">Body</label>
                        <textarea
                          className="input"
                          placeholder="Hi {{first_name}}, just checking in..."
                          value={seq.body_template}
                          onChange={e => updateSequence(index, 'body_template', e.target.value)}
                          rows={4}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={addSequenceStep}>
                <Plus size={16} /> Add Follow-up Step
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSequenceModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveSequences}>Save Sequences</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CampaignDetail;
