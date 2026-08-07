const POLICY_TEXT = /organization|doesn['’]t allow|blocked|administrator|策略|不允许/i;

export function isManagedPolicyBlock(data = {}) {
  const actualUrl = String(data.actualUrl || '');
  const visibleText = String(data.visibleText || '');
  return actualUrl.startsWith('chrome-error://') && POLICY_TEXT.test(visibleText);
}

export function classifyNavigationFailure(data = {}) {
  if (isManagedPolicyBlock(data)) return {
    code: 'navigation_blocked_by_policy',
    message: 'Chromium enterprise policy blocked the local evidence URL',
    requestedUrl: data.requestedUrl || null,
    actualUrl: data.actualUrl || null,
    browserVersion: data.browserVersion || null,
    executable: data.executable || null
  };
  const mainResponse = (data.resources || []).find((row) => row.type === 'response' && row.url === data.requestedUrl);
  if (mainResponse && Number(mainResponse.status) >= 400) return { code: 'navigation_http_error', message: `Navigation returned HTTP ${mainResponse.status}`, ...failureContext(data) };
  return { code: 'formal_page_bootstrap_timeout', message: 'Formal page did not expose its bootstrap API before the deadline', ...failureContext(data) };
}

function failureContext(data) {
  return {
    requestedUrl: data.requestedUrl || null,
    actualUrl: data.actualUrl || null,
    title: data.title || null,
    readyState: data.readyState || null,
    visibleText: String(data.visibleText || '').slice(0, 500),
    browserVersion: data.browserVersion || null,
    executable: data.executable || null
  };
}

export function buildNavigationFailureError(data = {}) {
  const details = classifyNavigationFailure(data);
  const error = new Error(`${details.code}: ${details.message}`);
  error.code = details.code;
  error.details = details;
  return error;
}

