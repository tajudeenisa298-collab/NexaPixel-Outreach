const API_BASE = '/api';

export async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  // Don't set content-type for FormData
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

export const api = {
  // Analytics
  getOverview: () => fetchApi('/analytics/overview'),
  getDailyStats: (days = 30) => fetchApi(`/analytics/daily?days=${days}`),
  // Accounts
  getAccounts: () => fetchApi('/accounts'),
  addAccount: (data) => fetchApi('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: (id) => fetchApi(`/accounts/${id}`, { method: 'DELETE' }),
  toggleAccountPause: (id, isPaused) => fetchApi(`/accounts/${id}/pause`, { method: 'PUT', body: JSON.stringify({ is_paused: isPaused }) }),

  // Analytics
  getRecentActivity: (limit = 50) => fetchApi(`/analytics/recent?limit=${limit}`),
  getTopPerforming: () => fetchApi('/analytics/top-performing'),

  // Campaigns
  getCampaigns: () => fetchApi('/campaigns'),
  getCampaign: (id) => fetchApi(`/campaigns/${id}`),
  previewCampaign: (formData) => fetchApi('/campaigns/preview', { method: 'POST', body: formData }),
  createCampaign: (formData) => fetchApi('/campaigns', { method: 'POST', body: formData }),
  importJarvisCampaign: (data) => fetchApi('/campaigns/import-jarvis', { method: 'POST', body: JSON.stringify(data) }),
  deleteCampaign: (id) => fetchApi(`/campaigns/${id}`, { method: 'DELETE' }),
  startCampaign: (id) => fetchApi(`/campaigns/${id}/start`, { method: 'POST' }),
  pauseCampaign: (id) => fetchApi(`/campaigns/${id}/pause`, { method: 'POST' }),
  resumeCampaign: (id) => fetchApi(`/campaigns/${id}/resume`, { method: 'POST' }),
  scheduleFollowups: (id) => fetchApi(`/campaigns/${id}/schedule-followups`, { method: 'POST' }),
  retryFailed: (id) => fetchApi(`/campaigns/${id}/retry-failed`, { method: 'POST' }),
  updateSequences: (id, sequences) => fetchApi(`/campaigns/${id}/sequences`, {
    method: 'PUT',
    body: JSON.stringify({ sequences }),
  }),
  // Settings
  getSettings: () => fetchApi('/settings'),
  updateSendInterval: (ms) => fetchApi('/settings/send-interval', { method: 'POST', body: JSON.stringify({ interval: ms }) }),
};
