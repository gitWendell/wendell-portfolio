// Preserve existing invite links while keeping the portfolio introduction readable.
const params = new URLSearchParams(window.location.search);
const ref = (params.get('ref') || '').toUpperCase();
if (/^[A-Z0-9]{1,12}$/.test(ref)) {
  for (const link of document.querySelectorAll('[data-explore]')) {
    link.href = `/explore.html?ref=${encodeURIComponent(ref)}`;
  }
  document.getElementById('invite-notice').hidden = false;
}
document.getElementById('year').textContent = new Date().getFullYear();
