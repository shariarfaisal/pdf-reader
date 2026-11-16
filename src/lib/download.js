/**
 * Start a file download without leaving the SPA.
 *
 * A synthetic anchor click keeps the router (and the whole workspace state)
 * intact while the browser streams the response to disk — `window.location.href`
 * destroys the app if an export endpoint answers with an error body instead of
 * an attachment.
 */
export function triggerDownload(url) {
  if (!url) return false;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
