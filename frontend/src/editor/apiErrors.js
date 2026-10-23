export function apiErrorMessage(result, status) {
  if (typeof result.detail === 'string') return result.detail;
  if (Array.isArray(result.detail) && result.detail.length) {
    return result.detail.slice(0, 3).map((issue) => {
      const field = (issue.loc ?? []).filter((part) => part !== 'body').join('.');
      const message = (issue.msg || 'Invalid value').replace(/^Value error, /, '');
      return field ? `${field}: ${message}` : message;
    }).join('; ');
  }
  return `Request failed (HTTP ${status}). Please try again.`;
}
