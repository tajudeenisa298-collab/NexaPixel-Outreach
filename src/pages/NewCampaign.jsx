import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle,
  ArrowLeft, ArrowRight, Plus, Trash2, Eye
} from 'lucide-react';
import { api } from '../api';

function NewCampaign() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(1); // 1: name, 2: upload, 3: sequences, 4: review
  const [campaignName, setCampaignName] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sequences, setSequences] = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  
  const [importMethod, setImportMethod] = useState('csv'); // 'csv' or 'jarvis'
  const [jarvisVertical, setJarvisVertical] = useState('AI Music Videos');
  const [jarvisMinScore, setJarvisMinScore] = useState(0);

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return;
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setError('Please upload a .csv, .xlsx, or .xls file');
      return;
    }
    setFile(selectedFile);
    setError('');
    setPreview(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const data = await api.previewCampaign(formData);
      setPreview(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    handleFileSelect(droppedFile);
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

  const handleCreate = async () => {
    if (!campaignName.trim()) {
      setError('Campaign name is required');
      return;
    }
    if (importMethod === 'csv' && !file) {
      setError('Please upload a CSV/XLSX file');
      return;
    }

    setCreating(true);
    setError('');

    try {
      let data;
      if (importMethod === 'csv') {
        const formData = new FormData();
        formData.append('name', campaignName.trim());
        formData.append('file', file);
        if (sequences.length > 0) {
          formData.append('sequences', JSON.stringify(sequences));
        }
        data = await api.createCampaign(formData);
      } else {
        data = await api.importJarvisCampaign({
          name: campaignName.trim(),
          verticalName: jarvisVertical,
          minScore: jarvisMinScore,
          sequences
        });
      }

      setResult(data);
      setStep(5); // success
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1: return campaignName.trim().length > 0;
      case 2: return importMethod === 'csv' ? !!file : true;
      case 3: return true; // sequences are optional
      case 4: return true;
      default: return false;
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Progress Steps */}
      {step < 5 && (
        <div style={{ display: 'flex', marginBottom: 32, gap: 4 }}>
          {['Name', 'Upload', 'Follow-ups', 'Review'].map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: i + 1 <= step ? 'var(--accent-gradient)' : 'var(--bg-tertiary)',
                transition: 'var(--transition-base)',
                marginBottom: 8,
              }} />
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: i + 1 <= step ? 'var(--accent-primary-hover)' : 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ef4444',
        }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Step 1: Campaign Name */}
      {step === 1 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📝 Name Your Campaign</div>
          </div>
          <div className="input-group">
            <label className="input-label">Campaign Name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Q1 Design Agency Outreach"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              autoFocus
              style={{ fontSize: 16, padding: '14px 18px' }}
            />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Give your campaign a descriptive name so you can easily identify it later.
          </p>
        </div>
      )}

      {/* Step 2: Leads Import */}
      {step === 2 && (
        <div className="card">
          <div className="card-header" style={{ marginBottom: 16 }}>
            <div className="card-title">📥 Import Leads</div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <button
              className={`btn ${importMethod === 'csv' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setImportMethod('csv'); setError(''); }}
              style={{ flex: 1 }}
            >
              Upload CSV
            </button>
            <button
              className={`btn ${importMethod === 'jarvis' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setImportMethod('jarvis'); setError(''); }}
              style={{ flex: 1, border: importMethod === 'jarvis' ? '1px solid #10b981' : 'none' }}
            >
              🤖 Sync from Jarvis
            </button>
          </div>

          {importMethod === 'jarvis' && (
            <div style={{ padding: 20, background: 'rgba(16, 185, 129, 0.05)', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <h3 style={{ color: '#10b981', marginBottom: 16, fontSize: 16 }}>Direct Database Sync</h3>
              
              <div className="input-group">
                <label className="input-label" style={{ color: 'var(--text-secondary)' }}>Target Vertical</label>
                <select 
                  className="input" 
                  value={jarvisVertical} 
                  onChange={e => setJarvisVertical(e.target.value)}
                >
                  <option value="AI Music Videos">AI Music Videos</option>
                  <option value="Logistics Explainer">Logistics Explainer</option>
                  <option value="AI Commercials & Spec Ads">AI Commercials & Spec Ads</option>
                  <option value="AI Movie Trailers">AI Movie Trailers</option>
                  <option value="AI Movies / Creative Visions">AI Movies / Creative Visions</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label" style={{ color: 'var(--text-secondary)' }}>Minimum AI Score Tracker</label>
                <select 
                  className="input" 
                  value={jarvisMinScore} 
                  onChange={e => setJarvisMinScore(Number(e.target.value))}
                >
                  <option value="0">All QUALIFIED Leads</option>
                  <option value="50">Score &gt; 50</option>
                  <option value="75">Score &gt; 75</option>
                  <option value="90">Top Tier (Score &gt; 90)</option>
                </select>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
                <p>💡 Tip: You can insert the AI's First-Line Pain Point Intercept into your templates using <code>{`{{last_name}}`}</code> in the Follow-up section!</p>
              </div>
            </div>
          )}

          {importMethod === 'csv' && (
            <>
              <div
            className={`file-upload-zone ${dragOver ? 'dragover' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => handleFileSelect(e.target.files[0])}
            />

            {file ? (
              <>
                <FileSpreadsheet size={48} style={{ margin: '0 auto 16px', display: 'block', color: '#10b981' }} />
                <div className="file-upload-text" style={{ color: '#10b981', fontWeight: 600 }}>
                  ✅ {file.name}
                </div>
                <div className="file-upload-hint">
                  {(file.size / 1024).toFixed(1)} KB
                  {preview?.totalRows ? ` • ${preview.totalRows} rows detected` : ''}
                </div>
                <button
                  className="btn btn-sm btn-secondary"
                  style={{ marginTop: 12 }}
                  onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
                >
                  Choose Different File
                </button>
              </>
            ) : (
              <>
                <Upload size={48} style={{ margin: '0 auto 16px', display: 'block', color: 'var(--text-muted)' }} />
                <div className="file-upload-text">
                  Drag & drop your CSV or XLSX file here
                </div>
                <div className="file-upload-hint">
                  or click to browse • Max 50MB
                </div>
              </>
            )}
          </div>

          <div style={{
            marginTop: 16, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
            fontSize: 12, color: 'var(--text-muted)',
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Required headers:</strong>{' '}
            <code style={{ color: '#a78bfa' }}>recipient_email</code>,{' '}
            <code style={{ color: '#a78bfa' }}>first_name</code>,{' '}
            <code style={{ color: '#a78bfa' }}>last_name</code>,{' '}
            <code style={{ color: '#a78bfa' }}>subject</code>,{' '}
            <code style={{ color: '#a78bfa' }}>body</code>
          </div>

          {/* Preview Table */}
          {preview && preview.preview && preview.preview.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                <Eye size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Preview (Found {preview.validRows} total valid leads)
              </div>

              {preview.invalidRows > 0 && (
                <div style={{ padding: 12, background: 'var(--warning-bg)', borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
                  <strong style={{ color: '#f59e0b', display: 'block', marginBottom: 4 }}>⚠️ {preview.invalidRows} rows had errors and will be skipped:</strong>
                  {preview.errors.map((err, i) => <div key={i} style={{ color: 'var(--text-muted)' }}>• {err}</div>)}
                </div>
              )}

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Subject</th>
                      <th>Body Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row, i) => (
                      <tr key={i}>
                        <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.recipient_email}
                        </td>
                        <td>{row.first_name}</td>
                        <td>{row.last_name}</td>
                        <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.subject}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {row.body ? row.body.length : 0} chars
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* Step 3: Follow-up Sequences */}
      {step === 3 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">🔄 Follow-up Sequences (Optional)</div>
              <div className="card-subtitle">
                Set up automated follow-ups. Use {'{{first_name}}'}, {'{{last_name}}'} as placeholders.
              </div>
            </div>
          </div>

          {sequences.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-text">No follow-up steps added</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Follow-ups are optional. You can add them later from the campaign details page.
              </div>
              <button className="btn btn-secondary" onClick={addSequenceStep}>
                <Plus size={16} /> Add Follow-up Step
              </button>
            </div>
          ) : (
            <div>
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
                          <label className="input-label">Delay (days)</label>
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
                          placeholder="Re: Following up, {{first_name}}"
                          value={seq.subject_template}
                          onChange={e => updateSequence(index, 'subject_template', e.target.value)}
                        />
                      </div>

                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">Body</label>
                        <textarea
                          className="input"
                          placeholder="Hi {{first_name}}, just checking in on my previous email..."
                          value={seq.body_template}
                          onChange={e => updateSequence(index, 'body_template', e.target.value)}
                          rows={3}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={addSequenceStep}>
                <Plus size={16} /> Add Another Step
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">🚀 Review & Create</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Campaign Name</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{campaignName}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>File</span>
              <span style={{ fontWeight: 500, fontSize: 13 }}>📄 {file?.name}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Estimated Leads</span>
              <span style={{ fontWeight: 600 }}>{preview?.validRows || 'Unknown'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Follow-up Steps</span>
              <span style={{ fontWeight: 600 }}>{sequences.length}</span>
            </div>
          </div>

          <div style={{
            marginTop: 20, padding: 16, background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-md)',
            fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            💡 The campaign will be created in <strong>draft</strong> status. Start sending from the campaign details page.
          </div>
        </div>
      )}

      {/* Step 5: Success */}
      {step === 5 && result && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <CheckCircle size={64} style={{ color: '#10b981', margin: '0 auto 20px', display: 'block' }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Campaign Created! 🎉</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{result.validLeads}</strong> valid leads imported
          </p>
          {result.invalidLeads > 0 && (
            <p style={{ color: '#f59e0b', fontSize: 13, marginBottom: 8 }}>
              ⚠️ {result.invalidLeads} rows had errors and were skipped
            </p>
          )}
          {result.parseErrors?.length > 0 && (
            <div style={{ textAlign: 'left', marginTop: 16, padding: 12, background: 'var(--warning-bg)', borderRadius: 8, fontSize: 12, maxHeight: 150, overflowY: 'auto' }}>
              {result.parseErrors.map((err, i) => (
                <div key={i} style={{ color: '#f59e0b', marginBottom: 2 }}>• {err}</div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
            <button className="btn btn-primary btn-lg" onClick={() => navigate(`/campaigns/${result.id}`)}>
              View Campaign
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => {
              setStep(1);
              setCampaignName('');
              setFile(null);
              setPreview(null);
              setSequences([]);
              setResult(null);
            }}>
              Create Another
            </button>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      {step < 5 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button
            className="btn btn-secondary"
            onClick={() => step === 1 ? navigate('/campaigns') : setStep(step - 1)}
          >
            <ArrowLeft size={16} /> {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 4 ? (
            <button
              className="btn btn-primary"
              disabled={!canProceed()}
              onClick={() => setStep(step + 1)}
            >
              Next <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="btn btn-primary btn-lg"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? (
                <><div className="spinner" style={{ width: 16, height: 16 }} /> Creating...</>
              ) : (
                <>🚀 Create Campaign</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default NewCampaign;
