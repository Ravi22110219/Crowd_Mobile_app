import { awsConfig } from '../config/awsConfig';
import { getAuthToken } from '../auth/cognitoAuth';

function getBaseUrl() {
  if (!awsConfig.apiBaseUrl) {
    throw new Error('API base URL is missing. Set EXPO_PUBLIC_API_BASE_URL.');
  }
  return awsConfig.apiBaseUrl.replace(/\/$/, '');
}

async function request(path, options = {}) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(body?.error || `Request failed with ${response.status}`);
  }

  return body;
}

async function adminRequest(path, options = {}) {
  const token = await getAuthToken();
  return request(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

export const airesqApi = {
  getCaptcha() {
    return request('/captcha');
  },

  createReport(payload) {
    return request('/reports', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getPublicReports() {
    return request('/reports/public');
  },

  getAdminReports(filter = 'all') {
    const query = filter && filter !== 'all' ? `?filter=${encodeURIComponent(filter)}` : '';
    return adminRequest(`/admin/reports${query}`);
  },

  updateReportStatus(id, status) {
    return adminRequest(`/admin/reports/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  deleteReport(id) {
    return adminRequest(`/admin/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }
};
