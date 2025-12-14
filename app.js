


import { setLanguage, getCurrentLanguage } from './lang.js';
import { initChatbot } from './chatbot.js';

const { createClient } = supabase;
const SUPABASE_URL = "https://pptwtkcnxnnuybeqwpuw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwdHd0a2NueG5udXliZXF3cHV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4NDMsImV4cCI6MjA3OTIyMjg0M30.Fe2quguQhgnPc14r4GRg3j6vqUtVZ5IuSpAwow6Ih8c";
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export let currentUser = null;
// Helper to update currentUser from other modules to prevent stale state
export function setCurrentUser(user) {
    currentUser = user;
    checkViewPermissions(); // Re-check permissions when user updates
}

let currentView = 'view-phat-trien'; 
let userChannel = null; 
let adminNotificationChannel = null;
let presenceChannel = null;
let userNotificationChannel = null; // Notification channel
export const onlineUsers = new Map();
export const DEFAULT_AVATAR_URL = 'https://t4.ftcdn.net/jpg/05/49/98/39/360_F_549983970_bRCkYfk0P6PP5fKbMhZMIb07vs1cACai.jpg';
export const PLACEHOLDER_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/681px-Placeholder_view_vector.svg.png';
export const cache = {
    userList: [],
};

export const showLoading = (show) => document.getElementById('loading-bar').classList.toggle('hidden', !show);

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

export function showConfirm(message, title = 'Xác nhận hành động') {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        titleEl.textContent = title;
        messageEl.textContent = message;

        const cleanup = (result) => {
            modal.classList.add('hidden');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);

        modal.classList.remove('hidden');
    });
}

export function sanitizeFileName(fileName) {
    if (!fileName) return '';
    const lastDot = fileName.lastIndexOf('.');
    const nameWithoutExt = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
    const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';

    return nameWithoutExt
        .normalize('NFD') 
        .replace(/[\u0300-\u036f]/g, '') 
        .toLowerCase() 
        .replace(/\s+/g, '-') 
        .replace(/[^a-z0-9-.]/g, '') + 
        ext; 
}

export function updateSidebarAvatar(url) {
    const finalUrl = url || DEFAULT_AVATAR_URL;
    const desktopAvatar = document.getElementById('sidebar-avatar');
    const mobileAvatar = document.getElementById('mobile-header-avatar');
    const settingsMenuAvatar = document.getElementById('settings-menu-avatar');
    const settingsDesktopAvatar = document.getElementById('settings-desktop-avatar');
    
    if (desktopAvatar) desktopAvatar.src = finalUrl;
    if (mobileAvatar) mobileAvatar.src = finalUrl;
    if (settingsMenuAvatar) settingsMenuAvatar.src = finalUrl;
    if (settingsDesktopAvatar) settingsDesktopAvatar.src = finalUrl;
}

function updateNotificationBar() {
    const notificationBar = document.getElementById('notification-bar');
    if (!notificationBar || !currentUser) return;

    const now = new Date();
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dayOfWeek = days[now.getDay()];
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateString = `${dayOfWeek}, ${day}/${month}/${year}`;

    const ho_ten = currentUser.ho_ten || 'Guest';
    const phan_quyen = currentUser.phan_quyen || 'View';

    notificationBar.innerHTML = `
        <marquee behavior="scroll" direction="left" scrollamount="4">
            <span>${dateString}</span> - 
            Xin chào: <b>${ho_ten}</b> (${phan_quyen})
        </marquee>
    `;
}

export async function handleLogout() {
    if (userChannel) {
        await sb.removeChannel(userChannel);
        userChannel = null;
    }
    if (adminNotificationChannel) {
        await sb.removeChannel(adminNotificationChannel);
        adminNotificationChannel = null;
    }
    if (presenceChannel) {
        await sb.removeChannel(presenceChannel);
        presenceChannel = null;
    }
    if (userNotificationChannel) {
        await sb.removeChannel(userNotificationChannel);
        userNotificationChannel = null;
    }
    sessionStorage.clear();
    window.location.href = 'login.html';
}

export function checkViewPermissions() {
    if (!currentUser) return;

    // Always allow Settings
    const allowedViews = new Set(['view-cai-dat']);
    
    let userPermissions = [];

    // Priority 1: Admin always has full access, regardless of DB columns
    if (currentUser.phan_quyen === 'Admin') {
        userPermissions = ['view-phat-trien', 'view-ton-kho', 'view-chi-tiet', 'view-san-pham', 'view-don-hang'];
    } else {
        // Priority 2: For non-Admin, check the 'xem' column
        if (Array.isArray(currentUser.xem)) {
            userPermissions = currentUser.xem;
        } else if (typeof currentUser.xem === 'string') {
            try { userPermissions = JSON.parse(currentUser.xem); } catch(e) { userPermissions = []; }
        }
    }

    userPermissions.forEach(v => allowedViews.add(v));

    // Hide/Show Sidebar & Bottom Nav Buttons
    document.querySelectorAll('.nav-button').forEach(btn => {
        const viewId = btn.dataset.view;
        if (allowedViews.has(viewId)) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    });

    // If current view is not allowed, redirect to first allowed view
    if (!allowedViews.has(currentView)) {
        // Find first allowed view
        const firstAllowed = ['view-phat-trien', 'view-ton-kho', 'view-chi-tiet', 'view-san-pham', 'view-cai-dat'].find(v => allowedViews.has(v));
        if (firstAllowed) {
            showView(firstAllowed);
        }
    }
}

export async function showView(viewId, params = null) {
    // Translation keys for headers
    const viewHeaders = {
        'view-phat-trien': 'header_dashboard',
        'view-ton-kho': 'header_listing',
        'view-chi-tiet': 'header_detail',
        'view-san-pham': 'header_product',
        'view-cai-dat': 'header_setting',
        'view-don-hang': 'Orders' 
    };

    // Check permission before showing (except settings)
    if (viewId !== 'view-cai-dat') {
         // Admin bypass
         if (currentUser.phan_quyen === 'Admin') {
             // Admin is allowed everywhere
         } else {
             let userPermissions = [];
             if (Array.isArray(currentUser.xem)) {
                 userPermissions = currentUser.xem;
             } else if (typeof currentUser.xem === 'string') {
                 try { userPermissions = JSON.parse(currentUser.xem); } catch(e) {}
             }
             
             if (!userPermissions.includes(viewId)) {
                 showToast("Bạn không có quyền truy cập màn hình này.", "error");
                 return;
             }
         }
    }

    // Adjust Main Padding for Detail/Product View to use full width
    const mainContent = document.querySelector('main');
    if (mainContent) {
        if (viewId === 'view-chi-tiet' || viewId === 'view-san-pham') {
            mainContent.classList.remove('md:p-6');
            // Ensure no padding interferes with the grid
        } else {
            mainContent.classList.add('md:p-6');
        }
    }

    // Hide all views and clean up specific display classes (like md:block)
    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('md:block'); // Critical: remove layout override classes
    });

    const viewContainer = document.getElementById(viewId);
    
    if (!viewContainer) {
        console.error(`View with id ${viewId} not found.`);
        return;
    }

    const viewTitleEl = document.getElementById('view-title');
    if (viewTitleEl) {
        // Use data-i18n attribute for dynamic translation
        viewTitleEl.setAttribute('data-i18n', viewHeaders[viewId]);
        // Trigger immediate translation for this specific element to ensure no lag
        setLanguage(getCurrentLanguage());
    }

    // Handle desktop Settings View special display property (flex vs block)
    if(viewId === 'view-cai-dat' && window.innerWidth >= 768) {
        viewContainer.classList.remove('hidden');
        viewContainer.classList.add('md:block'); 
    } else {
        viewContainer.classList.remove('hidden');
    }

    // Remove active class from ALL nav buttons
    document.querySelectorAll('.nav-button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active class to ALL buttons corresponding to this view
    document.querySelectorAll(`.nav-button[data-view="${viewId}"]`).forEach(btn => {
        btn.classList.add('active');
    });

    currentView = viewId;

    try {
        if (viewId === 'view-cai-dat') {
            const { onShowCaiDatView } = await import('./caidat.js');
            await onShowCaiDatView();
        } else if (viewId === 'view-ton-kho') {
            const { onShowListingView } = await import('./listing.js');
            await onShowListingView();
        } else if (viewId === 'view-chi-tiet') {
            const { onShowDetailView } = await import('./detail.js');
            await onShowDetailView(params);
        } else if (viewId === 'view-san-pham') {
            const { onShowProductView } = await import('./product.js');
            await onShowProductView(params);
        } else if (viewId === 'view-phat-trien') {
            const { onShowDashboardView } = await import('./dashboard.js');
            await onShowDashboardView();
        }
    } catch (error) {
        console.error(error);
        showToast("Lỗi tải giao diện: " + error.message, 'error');
    }
}

function updateOnlineStatusUI() {
    const listEl = document.getElementById('online-users-list');
    const countEl = document.getElementById('online-user-count');
    const avatarStatusEl = document.getElementById('sidebar-avatar-status');
    const mobileStatusEl = document.getElementById('mobile-header-status');

    if (!listEl || !countEl) return;

    const selfPresence = onlineUsers.get(currentUser.gmail);
    const status = selfPresence ? (selfPresence.status || 'online') : 'offline';
    const statusColor = status === 'away' ? 'bg-yellow-400' : 'bg-green-500';
    
    if (avatarStatusEl) avatarStatusEl.className = `absolute -bottom-0.5 -right-0.5 block h-3 w-3 rounded-full ${statusColor} ring-2 ring-gray-900`;
    if (mobileStatusEl) mobileStatusEl.className = `absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ${statusColor} ring-1 ring-white`;

    const otherOnlineUsers = new Map(onlineUsers);
    otherOnlineUsers.delete(currentUser.gmail);

    countEl.textContent = otherOnlineUsers.size;
    
    if (otherOnlineUsers.size === 0) {
        listEl.innerHTML = `<li class="px-2 text-xs text-gray-400 nav-text transition-opacity duration-300">Empty list.</li>`;
    } else {
        listEl.innerHTML = '';
        const sortedUsers = [...otherOnlineUsers.values()].sort((a, b) => {
            const statusA = a.status || 'online';
            const statusB = b.status || 'online';
            if (statusA === 'online' && statusB !== 'online') return -1;
            if (statusA !== 'online' && statusB === 'online') return 1;
            return a.user_ho_ten.localeCompare(b.user_ho_ten);
        });

        for (const user of sortedUsers) {
            const status = user.status || 'online';
            const statusColor = status === 'away' ? 'bg-yellow-400' : 'bg-green-500';

            const li = document.createElement('li');
            li.innerHTML = `
                <div class="flex items-center gap-3 px-2 py-1 hover:bg-gray-800 rounded cursor-default">
                    <div class="relative flex-shrink-0">
                        <img src="${user.user_avatar_url || DEFAULT_AVATAR_URL}" alt="${user.user_ho_ten}" class="w-7 h-7 rounded-full object-cover border border-gray-600">
                        <span class="absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full ${statusColor} ring-1 ring-gray-900"></span>
                    </div>
                    <span class="nav-text text-sm font-medium transition-opacity duration-300 truncate text-gray-300">${user.user_ho_ten}</span>
                </div>
            `;
            listEl.appendChild(li);
        }
    }
}

// --- NOTIFICATION SYSTEM START ---

let notifications = [];
let contextMenuTargetId = null;

function playNotificationSound() {
    // Simple beep sound using AudioContext for broader compatibility
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const ctx = new AudioContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.value = 800; // Frequency in Hz
            gainNode.gain.value = 0.1; // Volume
            
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            oscillator.start();
            setTimeout(() => oscillator.stop(), 150); // Play for 150ms
        }
    } catch (e) {
        console.log("Audio playback failed", e);
    }
}

function formatNotificationTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    
    // Check if it's today
    const isToday = date.getDate() === now.getDate() &&
                    date.getMonth() === now.getMonth() &&
                    date.getFullYear() === now.getFullYear();
    
    if (isToday) {
        // Only show time
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        // Show time and full date
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth()+1).padStart(2, '0')}/${date.getFullYear()}`;
        return `${timeStr} ${dateStr}`;
    }
}

async function initNotificationSystem() {
    if (!currentUser) return;

    const btn = document.getElementById('btn-notification');
    const dropdown = document.getElementById('notification-dropdown');
    const markReadBtn = document.getElementById('btn-mark-read-all');

    // 1. Load initial notifications
    await fetchNotifications();

    // 2. Subscribe to Realtime changes with filter
    if (!userNotificationChannel) {
        userNotificationChannel = sb.channel('public:notifications')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'thong_bao',
                filter: `gui_den_gmail=eq.${currentUser.gmail}` // Filter by current user's email
            }, payload => {
                handleNewNotification(payload.new);
            })
            .subscribe();
    }

    // 3. Toggle Dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
        // Also close context menu
        hideContextMenu();
    });

    // 4. Mark all as read action
    markReadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markAllNotificationsAsRead();
    });
    
    // 5. Init Context Menu listeners
    const ctxMarkUnread = document.getElementById('ctx-mark-unread');
    const ctxDelete = document.getElementById('ctx-delete');
    
    if(ctxMarkUnread) ctxMarkUnread.onclick = () => {
        if(contextMenuTargetId) markAsUnread(contextMenuTargetId);
        hideContextMenu();
    };
    
    if(ctxDelete) ctxDelete.onclick = () => {
        if(contextMenuTargetId) deleteNotification(contextMenuTargetId);
        hideContextMenu();
    };
}

async function fetchNotifications() {
    try {
        const { data, error } = await sb
            .from('thong_bao')
            .select('*')
            .eq('gui_den_gmail', currentUser.gmail)
            .order('ngay_tao', { ascending: false })
            .limit(20);

        if (!error) {
            if (data.length === 0) {
                // ... (Auto-welcome logic unchanged) ...
                const welcomeMsg = {
                    gui_den_gmail: currentUser.gmail,
                    tieu_de: "Chào mừng bạn!",
                    noi_dung: "Chào mừng bạn đến với hệ thống quản lý WH-B4 CRM. Đây là trung tâm thông báo của bạn.",
                    loai: "success"
                };
                await sb.from('thong_bao').insert(welcomeMsg);
                const { data: newData } = await sb
                    .from('thong_bao')
                    .select('*')
                    .eq('gui_den_gmail', currentUser.gmail)
                    .order('ngay_tao', { ascending: false })
                    .limit(20);
                notifications = newData || [];
            } else {
                notifications = data;
            }
            updateNotificationUI();
        }
    } catch (e) {
        console.error("Error fetching notifications", e);
    }
}

function handleNewNotification(newNotif) {
    notifications.unshift(newNotif);
    updateNotificationUI();
    playNotificationSound(); // Play sound only, no toast
}

function updateNotificationUI() {
    const listEl = document.getElementById('notification-list');
    const badgeEl = document.getElementById('notification-badge');
    
    const unreadCount = notifications.filter(n => !n.da_xem).length;
    
    if (unreadCount > 0) {
        badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badgeEl.classList.remove('hidden');
    } else {
        badgeEl.classList.add('hidden');
    }

    if (notifications.length === 0) {
        listEl.innerHTML = `<div class="p-4 text-center text-gray-500 text-xs">Không có thông báo mới</div>`;
        return;
    }

    listEl.innerHTML = notifications.map(notif => {
        const bgClass = notif.da_xem ? 'bg-white dark:bg-gray-800' : 'bg-blue-50 dark:bg-gray-700/50';
        const iconColor = notif.loai === 'error' ? 'text-red-500' : (notif.loai === 'success' ? 'text-green-500' : 'text-blue-500');
        
        // Use new time formatter
        const timeStr = formatNotificationTime(notif.ngay_tao);
        
        const isApproval = notif.loai === 'admin_approval';
        const titleClass = isApproval ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100";
        const metadataStr = notif.metadata ? JSON.stringify(notif.metadata).replace(/"/g, '&quot;') : '{}';
        
        return `
            <div class="notification-item p-3 ${bgClass} hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors flex gap-3 relative select-none" 
                 data-id="${notif.id}" 
                 onclick="window.markSingleRead(${notif.id}, '${notif.loai}', ${metadataStr})">
                <div class="flex-shrink-0 mt-1">
                    <svg class="w-5 h-5 ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium ${titleClass} truncate">${notif.tieu_de}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">${notif.noi_dung}</p>
                    <p class="text-[10px] text-gray-400 mt-1 text-right">${timeStr}</p>
                </div>
                ${!notif.da_xem ? '<div class="flex-shrink-0 self-center"><div class="w-2 h-2 bg-blue-500 rounded-full"></div></div>' : ''}
            </div>
        `;
    }).join('');

    // Attach Context Menu Listeners (Right Click & Long Press)
    document.querySelectorAll('.notification-item').forEach(item => {
        const id = parseInt(item.dataset.id);

        // Desktop: Right Click
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, id);
        });

        // Mobile: Long Press
        let timer;
        const startPress = (e) => {
            timer = setTimeout(() => {
                const touch = e.touches ? e.touches[0] : e;
                showContextMenu(touch.clientX, touch.clientY, id);
            }, 500); // 500ms long press
        };
        const cancelPress = () => {
            clearTimeout(timer);
        };

        item.addEventListener('touchstart', startPress, {passive: true});
        item.addEventListener('touchend', cancelPress);
        item.addEventListener('touchmove', cancelPress); // Cancel if scrolling
    });
}

function showContextMenu(x, y, id) {
    const menu = document.getElementById('notification-context-menu');
    if (!menu) return;
    
    contextMenuTargetId = id;
    
    // Ensure menu doesn't go offscreen
    const menuWidth = 192; // w-48
    const menuHeight = 100; // Approx height
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let posX = x;
    let posY = y;

    if (x + menuWidth > winW) posX = winW - menuWidth - 10;
    if (y + menuHeight > winH) posY = winH - menuHeight - 10;

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
    menu.classList.remove('hidden');
}

function hideContextMenu() {
    const menu = document.getElementById('notification-context-menu');
    if (menu) menu.classList.add('hidden');
    contextMenuTargetId = null;
}

async function markAsUnread(id) {
    // Optimistic Update
    const idx = notifications.findIndex(n => n.id === id);
    if (idx !== -1) {
        notifications[idx].da_xem = false;
        updateNotificationUI();
        // DB Update
        await sb.from('thong_bao').update({ da_xem: false }).eq('id', id);
    }
}

async function deleteNotification(id) {
    // Optimistic Update
    const idx = notifications.findIndex(n => n.id === id);
    if (idx !== -1) {
        notifications.splice(idx, 1);
        updateNotificationUI();
        // DB Update
        await sb.from('thong_bao').delete().eq('id', id);
    }
}

// Global helper to mark single read (attached to window for onclick access)
window.markSingleRead = async (id, type, metadata = {}) => {
    // Optimistic update
    const idx = notifications.findIndex(n => n.id === id);
    if (idx !== -1 && !notifications[idx].da_xem) {
        notifications[idx].da_xem = true;
        updateNotificationUI();
        
        // DB Update
        await sb.from('thong_bao').update({ da_xem: true }).eq('id', id);
    }
    
    // Handle Redirection
    if (type === 'admin_approval') {
        await showView('view-cai-dat');
        import('./caidat.js').then(({ openAdminSettingsTab }) => {
             if (openAdminSettingsTab) openAdminSettingsTab();
        });
    }
    if (type === 'excel_import') {
        await showView('view-ton-kho');
    }
    if (metadata && metadata.view) {
        await showView(metadata.view);
    }
};

async function markAllNotificationsAsRead() {
    // Optimistic update
    notifications.forEach(n => n.da_xem = true);
    updateNotificationUI();

    await sb.from('thong_bao')
        .update({ da_xem: true })
        .eq('gui_den_gmail', currentUser.gmail)
        .eq('da_xem', false);
}

// --- NOTIFICATION SYSTEM END ---

async function loadSystemSettings() {
    const { applyDarkMode, applyTheme, applyFontSize } = await import('./caidat.js');
    
    const isDark = localStorage.getItem('darkMode') === 'true';
    const themeColor = localStorage.getItem('themeColor') || '#2563eb';
    const fontSize = localStorage.getItem('fontSize') || '3';

    applyDarkMode(isDark);
    applyTheme(themeColor);
    applyFontSize(fontSize);
}

document.addEventListener('DOMContentLoaded', async () => {
    // Init Language
    setLanguage(getCurrentLanguage());

    // Initialize UI Settings first to avoid flickering
    try {
        await loadSystemSettings();
    } catch(e) { console.log("System settings init pending"); }

    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const iconOpen = document.getElementById('sidebar-toggle-icon-open');
    const iconClose = document.getElementById('sidebar-toggle-icon-close');
    const navTexts = document.querySelectorAll('.nav-text');
    const sidebarFooter = document.getElementById('sidebar-footer');

    const setSidebarState = (isCollapsed) => {
        if (window.innerWidth < 768) return;

        if (isCollapsed) {
            sidebar.classList.remove('md:w-64');
            sidebar.classList.add('md:w-20');
            iconClose.classList.add('hidden');
            iconOpen.classList.remove('hidden');
            navTexts.forEach(text => text.classList.add('hidden'));
            sidebarFooter.classList.add('opacity-0', 'pointer-events-none');
            document.getElementById('user-details').classList.add('justify-center');
            document.getElementById('user-info-text').classList.add('hidden');
             document.querySelectorAll('#sidebar .nav-button').forEach(btn => {
                btn.classList.remove('px-6');
                btn.classList.add('justify-center', 'px-2');
                btn.querySelector('svg').classList.remove('mr-4');
            });
        } else {
            sidebar.classList.remove('md:w-20');
            sidebar.classList.add('md:w-64');
            iconOpen.classList.add('hidden');
            iconClose.classList.remove('hidden');
            navTexts.forEach(text => text.classList.remove('hidden'));
            sidebarFooter.classList.remove('opacity-0', 'pointer-events-none');
             document.getElementById('user-details').classList.remove('justify-center');
             document.getElementById('user-info-text').classList.remove('hidden');
             document.querySelectorAll('#sidebar .nav-button').forEach(btn => {
                btn.classList.add('px-6');
                btn.classList.remove('justify-center', 'px-2');
                btn.querySelector('svg').classList.add('mr-4');
            });
        }
    };

    const isSidebarCollapsed = sessionStorage.getItem('sidebarCollapsed') === 'true';
    if (window.innerWidth >= 768) {
        setSidebarState(isSidebarCollapsed);
    }

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.contains('md:w-20');
            sessionStorage.setItem('sidebarCollapsed', !isCollapsed);
            setSidebarState(!isCollapsed);
        });
    }

    function updateNetworkStatusIndicator(status, latency = null) {
        const wifiIcon = document.getElementById('wifi-icon');
        const latencyText = document.getElementById('latency-text');
        const offlineGroup = document.getElementById('wifi-offline-group');
        const onlineGroup = document.getElementById('wifi-online-group');
        const bar1 = document.getElementById('wifi-bar-1');
        const bar2 = document.getElementById('wifi-bar-2');
        const bar3 = document.getElementById('wifi-bar-3');

        if (!wifiIcon || !latencyText) return;
        
        wifiIcon.classList.remove('text-green-500', 'text-yellow-500', 'text-red-500', 'text-gray-400');
        latencyText.classList.remove('text-green-600', 'text-yellow-600', 'text-red-600', 'text-gray-500');
        [bar1, bar2, bar3].forEach(bar => bar.style.opacity = '1');

        switch (status) {
            case 'good':
                onlineGroup.classList.remove('hidden');
                offlineGroup.classList.add('hidden');
                wifiIcon.classList.add('text-green-500');
                latencyText.textContent = `${latency} ms`;
                latencyText.classList.add('text-green-600');
                break;
            case 'slow':
                onlineGroup.classList.remove('hidden');
                offlineGroup.classList.add('hidden');
                wifiIcon.classList.add('text-yellow-500');
                bar3.style.opacity = '0.3';
                latencyText.textContent = `${latency} ms`;
                latencyText.classList.add('text-yellow-600');
                break;
            case 'offline':
                onlineGroup.classList.add('hidden');
                offlineGroup.classList.remove('hidden');
                wifiIcon.classList.add('text-red-500');
                latencyText.textContent = 'offline';
                latencyText.classList.add('text-red-600');
                break;
            default:
                onlineGroup.classList.remove('hidden');
                offlineGroup.classList.add('hidden');
                wifiIcon.classList.add('text-gray-400');
                 [bar1, bar2, bar3].forEach(bar => bar.style.opacity = '0.3');
                latencyText.textContent = '-- ms';
                latencyText.classList.add('text-gray-500');
                break;
        }
    }

    async function checkNetworkLatency() {
        if (!navigator.onLine) {
            updateNetworkStatusIndicator('offline');
            return;
        }
        const startTime = Date.now();
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/`, {
                method: 'HEAD',
                headers: { 'apikey': SUPABASE_KEY },
                cache: 'no-store',
                signal: AbortSignal.timeout(5000)
            });
            const latency = Date.now() - startTime;
            if (latency < 400) updateNetworkStatusIndicator('good', latency);
            else updateNetworkStatusIndicator('slow', latency);
        } catch (error) {
            updateNetworkStatusIndicator('offline');
        }
    }
    
    checkNetworkLatency();
    window.addEventListener('online', checkNetworkLatency);
    window.addEventListener('offline', () => updateNetworkStatusIndicator('offline'));
    setInterval(checkNetworkLatency, 10000);

    try {
        const userJson = sessionStorage.getItem('loggedInUser');
        if (userJson) {
            currentUser = JSON.parse(userJson);
            
            document.getElementById('user-ho-ten').textContent = currentUser.ho_ten || 'User';
            document.getElementById('user-gmail').textContent = currentUser.gmail || '';
            updateSidebarAvatar(currentUser.anh_dai_dien_url);
            updateNotificationBar();
            
            // Check Permissions immediately
            checkViewPermissions();

            // Initialize Notification System
            initNotificationSystem();

            // Initialize Chatbot
            initChatbot();

            document.getElementById('app-loading').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');

            document.querySelectorAll('.nav-button').forEach(btn => {
                btn.addEventListener('click', () => showView(btn.dataset.view));
            });
            
            const lastView = sessionStorage.getItem('lastViewId') || 'view-phat-trien';
            await showView(lastView);
            
            userChannel = sb.channel('public:user')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user', filter: 'gmail=eq.'+currentUser.gmail }, payload => {
                    const updatedUser = payload.new;
                    const newSessionId = updatedUser.active_session_id;
                    if (newSessionId && currentUser.active_session_id && newSessionId !== currentUser.active_session_id) {
                        showToast("Tài khoản của bạn đã được đăng nhập từ một thiết bị khác.", 'error');
                        setTimeout(handleLogout, 2000);
                        return;
                    }
                    if (updatedUser.stt === 'Khóa') {
                        showToast("Tài khoản của bạn đã bị quản trị viên khóa.", 'error');
                        setTimeout(handleLogout, 2000);
                        return;
                    }
                    
                    // Check if permissions changed (Check all columns now)
                    const permChanged = 
                        JSON.stringify(updatedUser.xem) !== JSON.stringify(currentUser.xem) ||
                        JSON.stringify(updatedUser.them) !== JSON.stringify(currentUser.them) ||
                        JSON.stringify(updatedUser.sua) !== JSON.stringify(currentUser.sua) ||
                        JSON.stringify(updatedUser.xoa) !== JSON.stringify(currentUser.xoa) ||
                        JSON.stringify(updatedUser.nhap) !== JSON.stringify(currentUser.nhap) ||
                        JSON.stringify(updatedUser.xuat) !== JSON.stringify(currentUser.xuat);
                    
                    // Safety check: if updatedUser.mat_khau is missing (e.g. RLS), do not treat as changed
                    if(updatedUser.mat_khau && currentUser.mat_khau && updatedUser.mat_khau !== currentUser.mat_khau) {
                        showToast("Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.", 'info');
                        setTimeout(handleLogout, 3000);
                    } else {
                        // Just update local session data, DO NOT logout
                        sessionStorage.setItem('loggedInUser', JSON.stringify(updatedUser));
                        currentUser = updatedUser;
                        updateNotificationBar();
                        
                        if (permChanged) {
                            checkViewPermissions();
                            showToast("Quyền truy cập đã được cập nhật.", 'info');
                        }

                        if (presenceChannel) {
                            presenceChannel.track({ 
                                user_ho_ten: currentUser.ho_ten, 
                                user_avatar_url: currentUser.anh_dai_dien_url,
                                status: document.visibilityState === 'visible' ? 'online' : 'away'
                            });
                        }
                        // Update Profile UI dynamically if we are in Settings view
                        if(currentView === 'view-cai-dat') {
                             import('./caidat.js').then(module => {
                                 if(module.onShowCaiDatView) module.onShowCaiDatView();
                             });
                        }
                    }
                })
                .subscribe();
            
            if(currentUser.phan_quyen === 'Admin') {
                adminNotificationChannel = sb.channel('admin-notifications')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user' }, payload => {
                        if(payload.new.stt === 'Chờ Duyệt') {
                            // Instead of Toast, insert notification into DB
                            sb.from('thong_bao').insert({
                                gui_den_gmail: currentUser.gmail,
                                tieu_de: "Yêu cầu duyệt thành viên",
                                noi_dung: `Tài khoản ${payload.new.ho_ten} (${payload.new.gmail}) đang chờ duyệt.`,
                                loai: "admin_approval"
                            }).then(() => {
                                // Notification inserted, Realtime listener in userNotificationChannel will handle UI update
                            });
                            
                            if(currentView === 'view-cai-dat') {
                                import('./caidat.js').then(({ fetchUsers }) => fetchUsers());
                            }
                        }
                    })
                    .subscribe();
            }

            presenceChannel = sb.channel('online-users', { config: { presence: { key: currentUser.gmail } } });
            presenceChannel
                .on('presence', { event: 'sync' }, () => {
                    const state = presenceChannel.presenceState();
                    onlineUsers.clear();
                    for (const gmail in state) onlineUsers.set(gmail, state[gmail][0]);
                    updateOnlineStatusUI();
                })
                .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                    onlineUsers.set(key, newPresences[0]);
                    updateOnlineStatusUI();
                })
                .on('presence', { event: 'leave' }, ({ key }) => {
                    onlineUsers.delete(key);
                    updateOnlineStatusUI();
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await presenceChannel.track({ 
                            user_ho_ten: currentUser.ho_ten, 
                            user_avatar_url: currentUser.anh_dai_dien_url,
                            status: document.visibilityState === 'visible' ? 'online' : 'away'
                        });
                    }
                });
            
            document.addEventListener('visibilitychange', () => {
                if (!presenceChannel) return;
                presenceChannel.track({ 
                    user_ho_ten: currentUser.ho_ten, 
                    user_avatar_url: currentUser.anh_dai_dien_url,
                    status: document.visibilityState === 'visible' ? 'online' : 'away'
                });
            });

        } else {
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error("Initialization error:", error);
        sessionStorage.clear();
        window.location.href = 'login.html';
    }
    
    window.addEventListener('beforeunload', () => {
        if (currentView) sessionStorage.setItem('lastViewId', currentView);
    });
});
