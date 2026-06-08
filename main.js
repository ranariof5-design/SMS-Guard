//MAIN.JS guard - 111Integratd with serverGuard.js API via ngrok

//https://refute-yearbook-greeter.ngrok-free.dev
//https://unopprobrious-jason-demonstrational.ngrok-free.dev
const API_BASE = 'unopprobrious-jason-demonstrational.ngrok-free.dev';

const AppState = {
    isLoggedIn: false,
    currentUser: null,
    currentScreen: 'screen-login',
    previousScreen: null,
};

let _leafletMap = null;
let payrollHistory = [];
let payrollHistoryIndex = 0;

async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const isFormData = options.body instanceof FormData;
    const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        'ngrok-skip-browser-warning': 'true',
        ...options.headers
    };

    let response;
    try {
        response = await fetch(url, { ...options, headers });
    } catch (networkError) {
        console.error(`[API] Network error on ${endpoint}:`, networkError.message);
        throw new Error('Cannot reach the server. Check your ngrok tunnel.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
        console.error(
            `[API] Received HTML on ${endpoint} — ngrok tunnel may be expired or API_BASE is wrong.\n` +
            `      Current API_BASE: ${API_BASE}\n` +
            `      Update API_BASE at the top of main.js with your new ngrok URL.`
        );
        showApiBanner('Server unreachable — update the ngrok URL in main.js');
        throw new Error('Server unreachable – please update the ngrok URL in main.js.');
    }

    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        console.error(`[API] JSON parse error on ${endpoint}:`, parseError.message);
        throw new Error('Server returned an unexpected response.');
    }

    if (!response.ok || data.success === false) {
        throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
}

function showApiBanner(message) {
    let banner = document.getElementById('api-error-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'api-error-banner';
        banner.style.cssText = [
            'background:#E8003D', 'color:#fff', 'font-size:12px',
            'font-weight:600', 'padding:10px 16px', 'text-align:center',
            'position:sticky', 'top:0', 'z-index:500', 'letter-spacing:.5px'
        ].join(';');
        const homeContent = document.getElementById('screen-home')?.querySelector('.screen-content');
        if (homeContent) homeContent.prepend(banner);
    }
    banner.textContent = '⚠ ' + message;
    banner.style.display = 'block';
}
function hideApiBanner() {
    const b = document.getElementById('api-error-banner');
    if (b) b.style.display = 'none';
}

function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

function navigateTo(screenId) {
    const current = document.getElementById(AppState.currentScreen);
    const next = document.getElementById(screenId);
    if (!next) return;

    AppState.previousScreen = AppState.currentScreen;
    AppState.currentScreen = screenId;

    current?.classList.remove('active');
    next.classList.add('active');

    const bell = document.getElementById('nav-bell');
    if (bell) bell.classList.toggle('active', screenId === 'screen-notifications');

    const cpBtn = document.getElementById('nav-changepass');
    if (cpBtn) cpBtn.classList.toggle('active', screenId === 'screen-changepass');

    if (screenId === 'screen-location' && _leafletMap) {
        setTimeout(() => _leafletMap.invalidateSize(), 100);
    }
    if (screenId === 'screen-notifications' && AppState.currentUser) {
        apiFetch(`/api/notifications/mark-all-read/${AppState.currentUser.username}`, { method: 'PUT' })
            .then(() => fetchNotifications(AppState.currentUser.username))
            .catch(err => console.warn('Mark-all-read failed:', err.message));
    }
    window.scrollTo(0, 0);
}

function formatDate(d) {
    if (!d) return '—';
    let dateObj;
    if (d instanceof Date) {
        dateObj = d;
    } else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.trim())) {
        dateObj = parseLocalDateKey(d.trim().slice(0, 10));
    } else {
        dateObj = new Date(d);
    }
    if (!dateObj || isNaN(dateObj.getTime())) return '—';
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const yy = dateObj.getFullYear();
    return `${mm}/${dd}/${yy}`;
}

function formatAnnouncementDateTime(d) {
    if (!d) return '—';
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(dateObj.getTime())) return '—';
    let hours = dateObj.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mins = String(dateObj.getMinutes()).padStart(2, '0');
    return `${formatDate(dateObj)}  ${hours}:${mins} ${ampm}`;
}

const LEAVE_FUTURE_ONLY_MSG = 'You cannot leave on or before the current day. Add leave request after the current day.';

function getTodayLocal() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function toLocalDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalDateKey(key) {
    if (!key) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function isFutureLeaveDate(date) {
    return date > getTodayLocal();
}

function formatScheduleRange(startDate, endDate) {
    const hasStart = !!startDate;
    const hasEnd = !!endDate;
    if (!hasStart && !hasEnd) return '';
    const s = hasStart ? formatDate(startDate) : '';
    const e = hasEnd ? formatDate(endDate) : '';
    if (s && e) return `${s} – ${e}`;
    return s || e;
}

function formatTime(d) {
    if (!d) return '—';
    const dateObj = typeof d === 'string' && d.includes(':')
        ? new Date(`1970-01-01T${d.length === 5 ? d + ':00' : d}`)
        : (d instanceof Date ? d : null);
    if (!dateObj || isNaN(dateObj.getTime())) return d;
    let h = dateObj.getHours();
    const m = String(dateObj.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP'
    }).format(amount || 0);
}


function coordsFromGmapUrl(url) {
    if (!url) return null;
    try {
        // ── OpenStreetMap formats (from Leaflet panel) ──────────────
        // Format: ?mlat=lat&mlon=lon  (generated by AddScheduleModal)
        let m = url.match(/mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

        // Format: #map=zoom/lat/lon  (OSM share link)
        m = url.match(/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

        // ── Google Maps formats ───────────────────────────────────────────────
        // Format: /@lat,lon,zoom  (most common share link)
        m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

        // Format: ?q=lat,lon  or  &q=lat,lon
        m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

        // Format: ?ll=lat,lon
        m = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    } catch (_) { /* fall through */ }
    return null;
}

async function initLocationMap(locationName, gmapLink) {
    const mapDiv = document.getElementById('location-map');
    const loadingDiv = document.getElementById('map-loading-state');
    if (!mapDiv) return;

    if (_leafletMap) {
        _leafletMap.remove();
        _leafletMap = null;
    }

    if (loadingDiv) loadingDiv.style.display = 'flex';
    mapDiv.classList.add('hidden');

    let lat = 8.4818;
    let lon = 124.6472;
    let zoom = 15;

    const fromLink = coordsFromGmapUrl(gmapLink);
    if (fromLink) {
        lat = fromLink.lat;
        lon = fromLink.lon;
        zoom = 18;
        console.log('[Map] ✅ Coords from linkGMap:', lat, lon);
    } else {
        console.warn('[Map] linkGMap missing or unparseable — falling back to Nominatim.');
        try {
            const query = encodeURIComponent(locationName);
            const viewbox = '124.4,8.2,124.9,8.7'; // CDO metro bounding box
            const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/search` +
                `?q=${query}&format=json&limit=1&countrycodes=ph` +
                `&viewbox=${viewbox}&bounded=1`,
                { headers: { 'Accept-Language': 'en' } }
            );
            const geoData = await geoRes.json();

            if (geoData.length > 0) {
                lat = parseFloat(geoData[0].lat);
                lon = parseFloat(geoData[0].lon);
                zoom = 17;
                console.log('[Map] Coords from Nominatim:', lat, lon);
            } else {
                console.warn('[Map] Nominatim found nothing — using CDO default.');
            }
        } catch (err) {
            console.warn('[Map] Nominatim failed — using CDO default:', err.message);
        }
    }

    if (loadingDiv) loadingDiv.style.display = 'none';
    mapDiv.classList.remove('hidden');

    _leafletMap = L.map('location-map', {
        center: [lat, lon],
        zoom,
        zoomControl: true,
        scrollWheelZoom: true,
        tap: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(_leafletMap);

    const pinIcon = L.divIcon({
        className: '',
        html: `
            <div style="width:32px;height:40px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4));">
                <svg viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" width="32" height="40">
                    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.5 16 24 16 24S32 26.5 32 16C32 7.163 24.837 0 16 0z"
                          fill="#0C2A45"/>
                    <circle cx="16" cy="16" r="6" fill="#A7D9E6"/>
                </svg>
            </div>`,
        iconSize: [32, 40],
        iconAnchor: [16, 40],
        popupAnchor: [0, -42]
    });

    L.marker([lat, lon], { icon: pinIcon })
        .addTo(_leafletMap)
        .bindPopup(`<strong style="font-size:13px;">${locationName}</strong>`, { maxWidth: 200 })
        .openPopup();

    setTimeout(() => _leafletMap && _leafletMap.invalidateSize(), 150);
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showToast('Please enter your Personnel ID and password.');
        return;
    }

    const btn = document.getElementById('btn-do-login');
    const originalText = btn.textContent;
    btn.textContent = 'Logging in…';
    btn.disabled = true;

    try {
        const data = await apiFetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        AppState.isLoggedIn = true;
        AppState.currentUser = data.guard;
        localStorage.setItem('sms_guard_profile', JSON.stringify(data.guard));

        document.getElementById('top-nav').style.display = 'flex';
        document.getElementById('home-username').textContent = AppState.currentUser.fullname;
        hideApiBanner();

        loadDashboardData();
        navigateTo('screen-home');
        showToast(`Welcome back, ${AppState.currentUser.fullname}!`);
    } catch (error) {
        showToast(error.message || 'Invalid credentials.');
        document.getElementById('login-password').value = '';
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function logout() {
    AppState.isLoggedIn = false;
    AppState.currentUser = null;
    localStorage.removeItem('sms_guard_profile');

    if (_leafletMap) { _leafletMap.remove(); _leafletMap = null; }

    document.getElementById('top-nav').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';

    document.getElementById('home-schedule-location').textContent = 'Loading…';
    document.getElementById('home-schedule-address').textContent = '—';
    document.getElementById('home-schedule-supervisor').textContent = 'Supervisor: —';
    document.getElementById('home-schedule-time').textContent = '—';
    setText('home-timein-indicator', '—');
    const homeDates = document.getElementById('home-schedule-dates');
    if (homeDates) homeDates.textContent = '';
    const locDates = document.getElementById('loc-schedule-dates');
    if (locDates) locDates.textContent = '';
    navigateTo('screen-login');
    showToast('You have been logged out.');
}

function loadDashboardData() {
    if (!AppState.currentUser) return;
    const { username, id } = AppState.currentUser;

    Promise.all([
        fetchSchedule(username),
        fetchAttendanceToday(username),
        fetchNotifications(username),
        fetchAnnouncements()
    ]).catch(err => console.error('Dashboard parallel load error:', err));
}

async function fetchAttendanceToday(username) {
    try {
        const data = await apiFetch(`/api/attendance/today/${username}`);
        const attendance = data.attendance;
        if (attendance?.timeIn) {
            const timeIn = new Date(attendance.timeIn).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
            setText('home-timein-indicator', `Time in done (${timeIn})`);
            return;
        }
        setText('home-timein-indicator', 'Not yet timed in');
    } catch (_e) {
        setText('home-timein-indicator', 'Time in status unavailable');
    }
}

async function fetchSchedule(username) {
    try {
        const data = await apiFetch(`/api/schedule/${username}`);
        const s = data.schedule ?? null;

        if (!s) {
            setText('home-schedule-location', 'No upcoming shift');
            setText('home-schedule-time', '—');
            setText('loc-location-name', '—');
            return;
        }

        setText('home-schedule-location', s.post || '—');
        setText('home-schedule-address', s.location || '—');
        setText('home-schedule-time', s.shiftTime || '—');
        setText('home-schedule-supervisor', `Supervisor: ${s.supervisorName || 'Unassigned'}`);
        const homeDates = document.getElementById('home-schedule-dates');
        if (homeDates) homeDates.textContent = formatScheduleRange(s.startDate, s.endDate);

        setText('loc-location-name', s.post || '—');
        setText('loc-location-address', s.location || '—');
        setText('loc-shift-details', s.shift
            ? `${s.shift} (${s.shiftTime || ''})`
            : (s.shiftTime || '—')
        );
        const locDates = document.getElementById('loc-schedule-dates');
        if (locDates) locDates.textContent = formatScheduleRange(s.startDate, s.endDate);
        setText('loc-supervisor', s.supervisorName || 'Unassigned');


        if (s.lat && s.lng) {
            const syntheticLink = `?mlat=${s.lat}&mlon=${s.lng}`;
            initLocationMap(s.post, syntheticLink);
        } else if (s.post) {
            initLocationMap(s.post, s.linkGMap || null);
        }

    } catch (e) {
        console.warn('Schedule fetch failed:', e.message);
        setText('home-schedule-location', 'No upcoming shift');
        setText('home-schedule-time', '—');
        const homeDates = document.getElementById('home-schedule-dates');
        if (homeDates) homeDates.textContent = '';
        setText('loc-location-name', '—');
        const locDates = document.getElementById('loc-schedule-dates');
        if (locDates) locDates.textContent = '';

        const loadingDiv = document.getElementById('map-loading-state');
        if (loadingDiv) loadingDiv.textContent = 'Map unavailable';
    }
}

function isNotificationUnread(n) {
    return n && (n.isRead === false || n.isRead === 0 || n.isRead === '0');
}

async function fetchNotifications(username) {
    try {
        if (AppState.currentScreen === 'screen-notifications') {
            await apiFetch(`/api/notifications/mark-all-read/${username}`, { method: 'PUT' });
        }

        const data = await apiFetch(`/api/notifications/${username}`);
        renderNotifications(data.notifications);

        const countData = await apiFetch(`/api/notifications/unread-count/${username}`);
        const badge = document.getElementById('nav-notif-count');
        if (badge) {
            badge.textContent = countData.unread;
            if (countData.unread > 0) {
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('Notifications fetch failed:', e.message);
        const container = document.getElementById('notif-list');
        if (container) container.innerHTML =
            '<div class="notif-item"><div class="notif-body"><div class="notif-title" style="color:var(--danger);font-weight:400;font-size:12px;">Could not load notifications. Check server connection.</div></div></div>';
    }
}


function getNotifStatusMeta(type) {
    const map = {
        leave_pending: { label: 'Pending', className: 'pending' },
        leave_approved: { label: 'Approved', className: 'approved' },
        leave_declined: { label: 'Declined', className: 'declined' },
        incident_pending: { label: 'Pending', className: 'pending' },
        incident_investigating: { label: 'Investigating', className: 'investigating' },
        incident_resolved: { label: 'Resolved', className: 'resolved' },
        incident_dismissed: { label: 'Dismissed', className: 'declined' },
        payroll_released: { label: 'Paid', className: 'approved' }
    };
    return map[type] || null;
}

function renderNotifications(notifs) {
    const container = document.getElementById('notif-list');
    if (!container) return;

    if (!notifs || notifs.length === 0) {
        container.innerHTML = '<div class="notif-item"><div class="notif-body"><div class="notif-title" style="color:var(--text-muted);font-weight:400;">No notifications yet.</div></div></div>';
        return;
    }

    container.innerHTML = notifs.map(n => {
        let statusMeta = getNotifStatusMeta(n.type);
        // For incident updates, extract status from title if no separate status field
        if (n.type === 'incident_update') {
            if (n.status) {
                const incidentStatusMeta = getNotifStatusMeta(`incident_${n.status.toLowerCase()}`);
                if (incidentStatusMeta) {
                    statusMeta = incidentStatusMeta;
                }
            } else if (n.title) {
                // Extract status from title (e.g., "Incident Resolved: ..." -> "Resolved")
                const titleLower = n.title.toLowerCase();
                if (titleLower.includes('resolved')) {
                    statusMeta = getNotifStatusMeta('incident_resolved');
                } else if (titleLower.includes('pending')) {
                    statusMeta = getNotifStatusMeta('incident_pending');
                } else if (titleLower.includes('investigating')) {
                    statusMeta = getNotifStatusMeta('incident_investigating');
                } else if (titleLower.includes('dismissed')) {
                    statusMeta = getNotifStatusMeta('incident_dismissed');
                }
            }
        }
        const statusBadge = statusMeta
            ? `<span class="notif-status notif-status-${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>`
            : '';
        return `
        <div class="notif-item${isNotificationUnread(n) ? ' notif-unread' : ''}" data-notif-id="${n.id}" data-ref-id="${n.refId || ''}" data-ref-table="${escapeHtml(n.refTable || '')}" onclick="markAsRead(${n.id}, this)" style="cursor:pointer;">
            <div class="notif-icon-wrap" style="${isNotificationUnread(n) ? 'border-color:var(--teal);' : ''}">
                ${getNotifIcon(n.type)}
            </div>
            <div class="notif-body">
                <div class="notif-title-row">
                    <div class="notif-title"${isNotificationUnread(n) ? ' style="font-weight:700;"' : ''}>${escapeHtml(n.title)}</div>
                    ${statusBadge}
                </div>
                ${n.message ? `<div class="notif-time" style="margin-top:3px;color:var(--dark-navy);font-size:12px;">${escapeHtml(n.message)}</div>` : ''}
                <div class="notif-time">${formatDate(n.createdAt)}</div>
            </div>
        </div>`;
    }).join('');
}

async function markAsRead(id, el) {
    try {
        await apiFetch(`/api/notifications/mark-read/${id}`, { method: 'PUT' });
        el.classList.remove('notif-unread');
        const title = el.querySelector('.notif-title');
        if (title) title.style.fontWeight = '';
        fetchNotifications(AppState.currentUser.username);
    } catch (e) {
        console.error('Mark read failed:', e.message);
    }
}

function getNotifIcon(type) {
    const icons = {
        leave_pending: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        leave_approved: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        leave_declined: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        incident_pending: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
        incident_investigating: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        incident_resolved: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        incident_dismissed: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        payroll_released: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
        shift_reminder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        announcement: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5.882V19.24a1.76 1.76 0 0 1-3.417.592l-2.147-6.15M18 13a3 3 0 1 0 0-6M5.436 13.683A4.001 4.001 0 0 1 7 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 0 1-1.564-.317z"/></svg>`,
        incident_update: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    };
    return icons[type] || `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}

const HOME_ANNOUNCEMENTS_PREVIEW_LIMIT = 1;

function truncateText(text, maxLen) {
    if (!text) return '';
    const s = String(text).trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen).trim() + '…';
}

const MEMORANDUM_AVATAR_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;

function memorandumEntryHtml(a, { preview = false } = {}) {
    const message = preview ? truncateText(a.message, 120) : (a.message || '');
    const author = escapeHtml(a.postedBy || 'Admin');
    const when = formatAnnouncementDateTime(a.createdAt);

    const isImage = (filename) => /\.(jpg|jpeg|png|gif|webp)$/i.test(filename || '');
    const GUARD_API = API_BASE;

    let attachmentHtml = '';
    if (!preview && a.attachment) {
        if (isImage(a.attachment)) {
            attachmentHtml = `
                <div class="memorandum-attachment">
                    <img
                        src="${GUARD_API}/uploads/${escapeHtml(a.attachment)}"
                        alt="Attachment"
                        class="memorandum-attachment-img"
                        onclick="window.open('${GUARD_API}/uploads/${escapeHtml(a.attachment)}', '_blank')"
                    />
                </div>`;
        } else {
            const cleanName = escapeHtml(a.attachment.replace(/^\d+-/, ''));
            const ext = (a.attachment.split('.').pop() || '').toLowerCase();

            const fileIconMap = {
                pdf: { color: '#E8003D', label: 'PDF' },
                doc: { color: '#2B579A', label: 'DOC' },
                docx: { color: '#2B579A', label: 'DOCX' },
                ppt: { color: '#D24726', label: 'PPT' },
                pptx: { color: '#D24726', label: 'PPTX' },
                xls: { color: '#217346', label: 'XLS' },
                xlsx: { color: '#217346', label: 'XLSX' },
            };

            const fileMeta = fileIconMap[ext] || { color: '#6b8a9a', label: ext.toUpperCase() };

            attachmentHtml = `
                <div class="memorandum-attachment">
                    <a href="${GUARD_API}/uploads/${escapeHtml(a.attachment)}" 
                       target="_blank" 
                       download="${cleanName}"
                       class="memorandum-attachment-file">
                        <span style="
                            background: ${fileMeta.color};
                            color: white;
                            font-size: 9px;
                            font-weight: 800;
                            padding: 2px 5px;
                            border-radius: 4px;
                            letter-spacing: 0.5px;
                            flex-shrink: 0;
                        ">${fileMeta.label}</span>
                        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${cleanName}
                        </span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; opacity:0.5;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </a>
                </div>`;
        }
    }

    const messageHtml = message
        ? `<div class="memorandum-bubble">${escapeHtml(message)}</div>`
        : '';
    const bodyContent = `${messageHtml}${attachmentHtml}`;

    return `
        <div class="memorandum-entry">
            <div class="memorandum-entry-head">
                <div class="memorandum-avatar">${MEMORANDUM_AVATAR_SVG}</div>
                <div class="memorandum-meta">
                    <strong>${author}</strong>
                    <span class="memorandum-datetime">${when}</span>
                </div>
            </div>
            <div class="memorandum-body">${bodyContent}</div>
        </div>
    `;
}

function renderMemorandumEntries(announcements, container, { preview = false, limit = null } = {}) {
    if (!container) return;

    const list = limit != null ? announcements.slice(0, limit) : announcements;

    if (!announcements || announcements.length === 0) {
        container.innerHTML = `
            <div class="memorandum-entry">
                <div class="memorandum-body">
                    <div class="memorandum-bubble" style="color:var(--text-muted);">No announcements yet.</div>
                </div>
            </div>`;
        return;
    }

    container.innerHTML = list.map(a => memorandumEntryHtml(a, { preview })).join('');
}

function renderMemorandumError(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="memorandum-entry">
            <div class="memorandum-body">
                <div class="memorandum-bubble" style="color:var(--danger);font-size:12px;">Could not load announcements. Check server connection.</div>
            </div>
        </div>`;
}

async function fetchAnnouncements() {
    const fullContainer = document.getElementById('announcements-list');
    const previewContainer = document.getElementById('home-announcements-preview');
    const viewAllBtn = document.getElementById('btn-home-announcements-more');

    try {
        const data = await apiFetch('/api/announcements');
        const announcements = data.announcements || [];

        renderMemorandumEntries(announcements, fullContainer, { preview: false });
        renderMemorandumEntries(announcements, previewContainer, {
            preview: true,
            limit: HOME_ANNOUNCEMENTS_PREVIEW_LIMIT
        });

        if (viewAllBtn) {
            viewAllBtn.classList.toggle('hidden', announcements.length === 0);
        }
    } catch (e) {
        console.error('Announcements failed:', e.message);
        renderMemorandumError(fullContainer);
        renderMemorandumError(previewContainer);
        if (viewAllBtn) viewAllBtn.classList.add('hidden');
    }
}

// Updated for History List + Active Card logic
async function fetchPayroll(username) {
    try {
        const data = await apiFetch(`/api/payroll/history/${username}`);
        payrollHistory = Array.isArray(data.payrolls) ? data.payrolls : [];
        renderPayrollFromHistory();
    } catch (e) {
        console.error('Payroll failed:', e.message);
        payrollHistory = [];
        renderPayrollFromHistory();
    }
}

function renderPayrollFromHistory() {
    const historyContainer = document.getElementById('payroll-history-list');
    if (!historyContainer) return;

    // 1. Find the ACTIVE (Pending) payroll for the top card
    const current = payrollHistory.find(p => p.status === 'Pending');
    // 2. Filter the PAID records for the history list
    const paidRecords = payrollHistory.filter(p => p.status === 'Paid');

    // 3. Render Top Card (The Active/Pending one)
    if (current) {
        setText('pay-period', formatDate(current.date) || 'Current Period');
        setText('pay-gross', formatCurrency(current.grossPay));
        setText('pay-net', formatCurrency(current.netPay));
        setText('pay-deductions', `– ${formatCurrency(current.totalDeductions)}`);
        setText('pay-days', `${current.daysWorked || 0} days`);

        setText('det-late', `– ${formatCurrency(current.late)}`);
        setText('det-undertime', `– ${formatCurrency(current.undertime)}`);

        // Sum gov deductions + cash advances
        const govTotal = (current.sss || 0) + (current.philHealth || 0) + (current.pagIbig || 0) + (current.advanceCash || 0);
        setText('det-gov', `– ${formatCurrency(govTotal)}`);
    } else {
        setText('pay-period', 'No active period');
        setText('pay-gross', formatCurrency(0));
        setText('pay-net', formatCurrency(0));
        setText('pay-days', '0 days');
    }

    // 4. Render History List
    if (paidRecords.length === 0) {
        historyContainer.innerHTML = '<div class="recent-item" style="padding:20px; text-align:center;"><span class="recent-label text-muted-italic">No past records.</span></div>';
    } else {
        historyContainer.innerHTML = paidRecords.map(p => `
            <div class="quick-action-item" onclick="viewHistoryPayslip(${p.id})" style="cursor:pointer; display:flex; align-items:center; margin-bottom:10px; background:white; border:1px solid var(--border);">
                <div class="qa-icon navy" style="background:var(--success)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div style="flex:1; margin-left:12px;">
                    <div class="qa-label" style="font-size:14px; color:var(--dark-navy)">${formatDate(p.date)}</div>
                    <div style="font-size:11px; color:var(--text-muted)">Paid on: ${p.paidAt || 'N/A'}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:700; color:var(--success)">${formatCurrency(p.netPay)}</div>
                    <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase;">View Details</div>
                </div>
            </div>
        `).join('');
    }
}

function viewHistoryPayslip(id) {
    const p = payrollHistory.find(rec => rec.id === id);
    const netIsNegative = (p.netPay || 0) < 0;
    const netColor = netIsNegative ? '#ef4444' : '#22c55e';
    const netBg = netIsNegative ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)';
    if (!p) return;

    const modal = document.getElementById('modal-payslip');
    const content = document.getElementById('modal-payslip-content');

    content.innerHTML = `
        <div class="payroll-row"><span class="payroll-row-label"> ID</span><span class="payroll-row-value" style="font-family:monospace">${p.payrollId}</span></div>
        <div class="payroll-row"><span class="payroll-row-label">Period</span><span class="payroll-row-value">${formatDate(p.date)}</span></div>
        <div class="payroll-row"><span class="payroll-row-label">Gross Salary</span><span class="payroll-row-value">${formatCurrency(p.grossPay)}</span></div>
        <div class="payroll-row"><span class="payroll-row-label">Days Worked</span><span class="payroll-row-value">${p.daysWorked} days</span></div>
        
        <div style="border-top:1px solid rgba(255,255,255,0.1); border-bottom:1px solid rgba(255,255,255,0.1); margin:12px 0; padding:10px 0;">
            <div class="payroll-row"><span class="payroll-row-label" style="font-size:12px">Late</span><span class="payroll-row-value deduction" style="font-size:12px">-${formatCurrency(p.late)}</span></div>
            <div class="payroll-row"><span class="payroll-row-label" style="font-size:12px">Undertime</span><span class="payroll-row-value deduction" style="font-size:12px">-${formatCurrency(p.undertime)}</span></div>
            <div class="payroll-row"><span class="payroll-row-label" style="font-size:12px">Other Ded.</span><span class="payroll-row-value deduction" style="font-size:12px">-${formatCurrency((p.sss || 0) + (p.philHealth || 0) + (p.pagIbig || 0) + (p.advanceCash || 0))}</span></div>
        </div>
        
        <div class="payroll-row">...reference id...</div>
        ...other rows...
        <div class="net-pay-row" style="background:${netBg}">
            <span class="net-pay-label">Net Received</span>
            <span class="net-pay-value" style="color:${netColor}">${formatCurrency(p.netPay)}</span>
        </div>
        <div style="text-align:center; font-size:10px; color:rgba(255,255,255,0.4); margin-top:15px;">
            PAID ON: ${p.paidAt}
        </div>
    `;

    modal.style.display = 'flex';
}

function updateIncidentDateTime() {
    const now = new Date();
    setText('incident-date', formatDate(now));
    setText('incident-time', formatTime(now));
}

function setupPasswordRequirementHint() {
    const newInput = document.getElementById('cp-new');
    const hint = document.getElementById('password-req-hint');
    if (!newInput || !hint) return;

    newInput.addEventListener('input', () => {
        hint.classList.toggle('hidden', newInput.value.length < 5);
    });
}

async function handleChangePassword() {
    const current = document.getElementById('cp-current').value;
    const newPass = document.getElementById('cp-new').value;
    const confirm = document.getElementById('cp-confirm').value;

    if (!current || !newPass || !confirm) {
        showToast('Please fill in all password fields.');
        return;
    }
    if (newPass.length < 5) {
        showToast('New password must be at least 5 characters long.');
        return;
    }
    if (newPass !== confirm) {
        showToast('New passwords do not match.');
        return;
    }

    try {
        await apiFetch('/api/change-password', {
            method: 'PUT',
            body: JSON.stringify({
                username: AppState.currentUser.username,
                currentPassword: current,
                newPassword: newPass
            })
        });

        document.getElementById('cp-current').value = '';
        document.getElementById('cp-new').value = '';
        document.getElementById('cp-confirm').value = '';
        document.getElementById('password-req-hint')?.classList.add('hidden');

        showToast('Password changed successfully!');
        setTimeout(() => navigateTo('screen-home'), 1000);
    } catch (e) {
        showToast(e.message);
    }
}

async function handleSubmitIncident() {
    const title = document.getElementById('incident-title').value.trim();
    const desc = document.getElementById('incident-desc').value.trim();
    const severity = document.getElementById('incident-severity').value;
    const fileInput = document.getElementById('incident-file');

    if (!title) { showToast('Please enter an incident title.'); return; }
    if (!desc) { showToast('Please describe the incident.'); return; }

    const formData = new FormData();
    formData.append('guard_id', AppState.currentUser.id);
    formData.append('guardName', AppState.currentUser.fullname);
    formData.append('guardUsername', AppState.currentUser.username);
    formData.append('title', title);
    formData.append('severity', severity);
    formData.append('incident_date', new Date().toISOString().split('T')[0]);
    formData.append('incident_time', new Date().toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5));
    formData.append('description', desc);
    if (fileInput && fileInput.files && fileInput.files.length > 0) formData.append('attachment', fileInput.files[0]);

    const btn = document.getElementById('btn-submit-incident');
    btn.disabled = true;

    try {
        await apiFetch('/api/incident', {
            method: 'POST',
            body: formData,
            headers: {}
        });

        document.getElementById('incident-title').value = '';
        document.getElementById('incident-desc').value = '';
        document.getElementById('incident-severity').value = 'Low';
        updateSeverityStyle();

        const area = document.getElementById('file-upload-area');
        if (area) {
            area.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload a photo or documents
                <input type="file" id="incident-file" style="display:none;" accept="image/*,.pdf" />
            `;
        }

        showToast('Incident report submitted successfully!');
        fetchNotifications(AppState.currentUser.username);
        setTimeout(() => navigateTo('screen-home'), 1000);
    } catch (e) {
        showToast(e.message);
    } finally {
        btn.disabled = false;
    }
}

async function handleSubmitLeave() {
    const type = document.getElementById('leave-type').value;
    const start = document.getElementById('leave-start').value;
    const end = document.getElementById('leave-end').value;
    const reason = document.getElementById('leave-reason').value.trim();

    if (!type || !start || !end || !reason) {
        showToast('Please fill in all leave request fields.');
        return;
    }

    const startDate = parseLocalDateKey(start);
    const endDate = parseLocalDateKey(end);
    if (!startDate || !endDate) {
        showToast('Please select a valid date range.');
        return;
    }
    if (!isFutureLeaveDate(startDate) || !isFutureLeaveDate(endDate)) {
        showToast(LEAVE_FUTURE_ONLY_MSG);
        return;
    }
    if (endDate < startDate) {
        showToast('End date cannot be before start date.');
        return;
    }

    const daysCount = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    try {
        await apiFetch('/api/leave', {
            method: 'POST',
            body: JSON.stringify({
                guard_id: AppState.currentUser.id,
                guardUsername: AppState.currentUser.username,
                leave_type: type,
                start_date: start,
                end_date: end,
                days_count: daysCount,
                reason: reason
            })
        });

        document.getElementById('leave-type').value = '';
        document.getElementById('leave-reason').value = '';
        resetLeaveDatePicker();

        showToast('Leave request submitted successfully!');
        fetchNotifications(AppState.currentUser.username);
        setTimeout(() => navigateTo('screen-home'), 1000);
    } catch (e) {
        showToast(e.message);
    }
}

/* ============================================
   LEAVE DATE RANGE PICKER
   ============================================ */
let _leaveDatePickerReset = null;

function resetLeaveDatePicker() {
    if (_leaveDatePickerReset) _leaveDatePickerReset();
}

function setupLeaveDatePicker() {
    const picker = document.getElementById('leave-date-picker');
    const trigger = document.getElementById('leave-date-trigger');
    const display = document.getElementById('leave-date-display');
    const popup = document.getElementById('leave-calendar-popup');
    const instruction = document.getElementById('leave-calendar-instruction');
    const grid = document.getElementById('leave-calendar-grid');
    const monthLabel = document.getElementById('leave-cal-month-label');
    const btnPrev = document.getElementById('leave-cal-prev');
    const btnNext = document.getElementById('leave-cal-next');
    const startInput = document.getElementById('leave-start');
    const endInput = document.getElementById('leave-end');
    const durationEl = document.getElementById('leave-duration');
    if (!picker || !trigger || !popup || !grid || !startInput || !endInput) return;

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    const state = {
        step: 'start',
        start: null,
        end: null,
        viewYear: getTodayLocal().getFullYear(),
        viewMonth: getTodayLocal().getMonth()
    };

    function openPopup() {
        popup.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        if (!state.start) state.step = 'start';
        else if (!state.end) state.step = 'end';
        updateInstruction();
        renderCalendar();
    }

    function closePopup() {
        popup.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function updateInstruction() {
        instruction.textContent = state.step === 'start' ? 'Select start date' : 'Select end date';
    }

    function syncHiddenInputs() {
        startInput.value = state.start || '';
        endInput.value = state.end || '';
    }

    function updateTriggerDisplay() {
        if (state.start && state.end) {
            display.textContent = formatScheduleRange(
                parseLocalDateKey(state.start),
                parseLocalDateKey(state.end)
            );
            trigger.classList.remove('is-placeholder');
        } else if (state.start) {
            display.textContent = `${formatDate(parseLocalDateKey(state.start))} — …`;
            trigger.classList.remove('is-placeholder');
        } else {
            display.textContent = 'Select date range';
            trigger.classList.add('is-placeholder');
        }
    }

    function updateDurationDisplay() {
        if (!durationEl) return;
        if (!state.start || !state.end) {
            durationEl.style.display = 'none';
            return;
        }
        const startDate = parseLocalDateKey(state.start);
        const endDate = parseLocalDateKey(state.end);
        if (endDate < startDate) {
            durationEl.textContent = 'End date cannot be before start date.';
            durationEl.style.display = 'block';
            durationEl.style.background = '#ffeef3';
            durationEl.style.color = 'var(--red-accent)';
            return;
        }
        const days = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        durationEl.textContent = `Duration: ${days} day${days !== 1 ? 's' : ''}`;
        durationEl.style.display = 'block';
        durationEl.style.background = 'var(--teal-light)';
        durationEl.style.color = 'var(--teal)';
    }

    function monthHasSelectableDays(year, month) {
        const last = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= last; d++) {
            const date = new Date(year, month, d);
            if (isFutureLeaveDate(date)) return true;
        }
        return false;
    }

    function renderCalendar() {
        const today = getTodayLocal();
        const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();

        monthLabel.textContent = `${MONTHS[state.viewMonth]} ${state.viewYear}`;

        let prevMonth = state.viewMonth - 1;
        let prevYear = state.viewYear;
        if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
        btnPrev.disabled = !monthHasSelectableDays(prevYear, prevMonth);

        let nextMonth = state.viewMonth + 1;
        let nextYear = state.viewYear;
        if (nextMonth > 11) { nextMonth = 0; nextYear += 1; }
        btnNext.disabled = !monthHasSelectableDays(nextYear, nextMonth);

        grid.innerHTML = '';

        for (let i = 0; i < startWeekday; i++) {
            const empty = document.createElement('button');
            empty.type = 'button';
            empty.className = 'leave-cal-day is-empty';
            empty.disabled = true;
            empty.tabIndex = -1;
            grid.appendChild(empty);
        }

        const startDate = state.start ? parseLocalDateKey(state.start) : null;
        const endDate = state.end ? parseLocalDateKey(state.end) : null;

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(state.viewYear, state.viewMonth, day);
            const key = toLocalDateKey(date);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'leave-cal-day';
            btn.textContent = String(day);

            const allowed = isFutureLeaveDate(date);
            const beforeStart = state.step === 'end' && startDate && date < startDate;

            if (!allowed) btn.classList.add('is-disabled');
            if (beforeStart) btn.disabled = true;

            if (startDate && toLocalDateKey(startDate) === key) btn.classList.add('is-selected');
            if (endDate && toLocalDateKey(endDate) === key) btn.classList.add('is-selected');
            if (startDate && endDate && date > startDate && date < endDate) btn.classList.add('is-in-range');

            if (!allowed) {
                btn.addEventListener('click', e => {
                    e.preventDefault();
                    showToast(LEAVE_FUTURE_ONLY_MSG);
                });
            } else if (!beforeStart) {
                btn.addEventListener('click', () => selectDate(date, key));
            }

            grid.appendChild(btn);
        }
    }

    function selectDate(date, key) {
        if (!isFutureLeaveDate(date)) {
            showToast(LEAVE_FUTURE_ONLY_MSG);
            return;
        }

        if (state.step === 'start') {
            state.start = key;
            state.end = null;
            state.step = 'end';
            syncHiddenInputs();
            updateTriggerDisplay();
            updateInstruction();
            durationEl && (durationEl.style.display = 'none');
            renderCalendar();
            return;
        }

        const startDate = parseLocalDateKey(state.start);
        if (date < startDate) {
            showToast('End date cannot be before start date.');
            return;
        }

        state.end = key;
        state.step = 'start';
        syncHiddenInputs();
        updateTriggerDisplay();
        updateDurationDisplay();
        closePopup();
    }

    function resetPicker() {
        state.step = 'start';
        state.start = null;
        state.end = null;
        const today = getTodayLocal();
        state.viewYear = today.getFullYear();
        state.viewMonth = today.getMonth();
        syncHiddenInputs();
        updateTriggerDisplay();
        if (durationEl) durationEl.style.display = 'none';
        closePopup();
        updateInstruction();
    }

    _leaveDatePickerReset = resetPicker;

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        if (popup.classList.contains('hidden')) openPopup();
        else closePopup();
    });

    btnPrev.addEventListener('click', e => {
        e.stopPropagation();
        if (state.viewMonth === 0) {
            state.viewYear -= 1;
            state.viewMonth = 11;
        } else {
            state.viewMonth -= 1;
        }
        renderCalendar();
    });

    btnNext.addEventListener('click', e => {
        e.stopPropagation();
        if (state.viewMonth === 11) {
            state.viewYear += 1;
            state.viewMonth = 0;
        } else {
            state.viewMonth += 1;
        }
        renderCalendar();
    });

    document.addEventListener('click', e => {
        if (!picker.contains(e.target)) closePopup();
    });

    popup.addEventListener('click', e => e.stopPropagation());

    const today = getTodayLocal();
    state.viewYear = today.getFullYear();
    state.viewMonth = today.getMonth();
    updateTriggerDisplay();
}

/* ============================================
   DEDUCTION TOGGLE (PAYROLL)
   ============================================ */
function setupDeductionToggle() {
    const toggle = document.getElementById('deduction-toggle');
    const details = document.getElementById('deduction-details');
    if (!toggle || !details) return;

    let expanded = false;
    toggle.addEventListener('click', () => {
        expanded = !expanded;
        details.style.display = expanded ? 'block' : 'none';
        const icon = toggle.querySelector('svg');
        if (icon) {
            icon.style.transform = expanded ? 'rotate(180deg)' : '';
            icon.style.transition = 'transform 0.2s';
        }
    });
}

/* ============================================
   FILE UPLOAD AREA
   ============================================ */

function setupFileUpload() {
    const area = document.getElementById('file-upload-area');
    const input = document.getElementById('incident-file');
    if (!area || !input) return;

    input.style.display = 'none';
    area.appendChild(input);

    area.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
        if (input.files && input.files.length > 0) {
            area.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                </svg>
                <span style="flex:1;text-align:left;">${escapeHtml(input.files[0].name)}</span>
            `;
            input.style.display = 'none';
            area.appendChild(input);
            area.style.borderColor = 'var(--teal)';
            area.style.color = 'var(--teal)';
            area.style.display = 'flex';
            area.style.alignItems = 'center';
            area.style.gap = '10px';
            area.style.cursor = 'pointer';
        }
    });
}

function resetFileUploadArea() {
    const area = document.getElementById('file-upload-area');
    if (!area) return;
    area.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Upload a photo or documents
        <input type="file" id="incident-file" style="display:none;" accept="image/*,.pdf" />
    `;
    area.style.borderColor = '';
    area.style.color = '';
    area.style.justifyContent = '';
    setupFileUpload();
}

/* ============================================
   REFRESH BUTTON
   ============================================ */
function setupRefresh() {
    const btn = document.getElementById('nav-refresh');
    if (!btn) return;
    let spinning = false;
    btn.addEventListener('click', () => {
        if (spinning) return;
        spinning = true;
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = 'spin 0.5s linear';
        if (AppState.isLoggedIn) {
            loadDashboardData();
            showToast('Syncing data…');
        }
        setTimeout(() => {
            if (icon) icon.style.animation = '';
            spinning = false;
        }, 600);
    });
}

/* ============================================
   SEVERITY SELECT COLOUR
   ============================================ */
function updateSeverityStyle() {
    const sel = document.getElementById('incident-severity');
    if (!sel) return;
    sel.classList.remove('sev-low', 'sev-medium', 'sev-high');
    const map = { Low: 'sev-low', Medium: 'sev-medium', High: 'sev-high' };
    sel.classList.add(map[sel.value] || 'sev-low');
}

/* ============================================
   HELPERS
   ============================================ */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '—';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"');
}

/* ============================================
   EVENT BINDING & INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {

    /* --- LOGIN --- */
    document.getElementById('btn-do-login')?.addEventListener('click', login);
    ['login-username', 'login-password'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') login();
        });
    });

    /* --- LOGOUT --- */
    document.getElementById('nav-logout')?.addEventListener('click', logout);

    /* --- NAV / data-screen BUTTONS --- */
    document.querySelectorAll('[data-screen]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-screen');
            if (!target) return;
            if (target === 'screen-notifications' && AppState.currentScreen === 'screen-notifications') {
                navigateTo(AppState.previousScreen || 'screen-home');
            } else {
                navigateTo(target);
            }
        });
    });

    /* --- BACK BUTTONS --- */
    document.querySelectorAll('[data-back]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-back');
            if (target) navigateTo(target);
        });
    });

    /* --- HOME QUICK ACTIONS --- */
    document.getElementById('btn-go-incident')?.addEventListener('click', () => {
        updateIncidentDateTime();
        navigateTo('screen-incident');
    });
    document.getElementById('btn-go-leave')?.addEventListener('click', () => navigateTo('screen-leave'));
    document.getElementById('btn-go-payroll')?.addEventListener('click', () => {
        if (AppState.currentUser) fetchPayroll(AppState.currentUser.username);
        navigateTo('screen-payroll');
    });
    document.getElementById('pay-prev-month')?.addEventListener('click', () => {
        if (payrollHistoryIndex < payrollHistory.length - 1) {
            payrollHistoryIndex += 1;
            renderPayrollFromHistory();
        }
    });
    document.getElementById('pay-next-month')?.addEventListener('click', () => {
        if (payrollHistoryIndex > 0) {
            payrollHistoryIndex -= 1;
            renderPayrollFromHistory();
        }
    });
    document.getElementById('btn-go-location')?.addEventListener('click', () => navigateTo('screen-location'));
    document.getElementById('btn-home-announcements-more')?.addEventListener('click', () => navigateTo('screen-announcements'));
    document.getElementById('home-memorandum-card')?.addEventListener('click', e => {
        if (e.target.closest('.memorandum-view-all')) return;
        if (e.target.closest('.memorandum-entry')) navigateTo('screen-announcements');
    });

    /* --- FORM SUBMITS --- */
    document.getElementById('btn-change-pass')?.addEventListener('click', handleChangePassword);
    document.getElementById('btn-submit-incident')?.addEventListener('click', handleSubmitIncident);
    document.getElementById('btn-submit-leave')?.addEventListener('click', handleSubmitLeave);

    /* --- MISC UI SETUP --- */
    setupLeaveDatePicker();
    document.getElementById('incident-severity')?.addEventListener('change', updateSeverityStyle);
    updateSeverityStyle();
    setupDeductionToggle();
    setupFileUpload();
    setupRefresh();
    setupPasswordRequirementHint();

    // Always start at the login screen
    localStorage.removeItem('sms_guard_profile');
    document.getElementById('top-nav').style.display = 'none';
    navigateTo('screen-login');

    /* --- Spin keyframe --- */
    const spinStyle = document.createElement('style');
    spinStyle.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
    document.head.appendChild(spinStyle);

});
