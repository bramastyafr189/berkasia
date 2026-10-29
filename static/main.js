// Load processing libraries only when a user first starts a job.
let enginePromise;
const ensureEngine = () => enginePromise ||= import('./engine.js');
window.releaseOutput = () => {};
window.releaseSources = () => {};
window.localFetch = async (...args) => { await ensureEngine(); return window.localFetch(...args); };
import './motion.js';
import './mobile-nav.js';
import './i18n.js';
import './select.js';
import './app.js';
import './pdf.js';
