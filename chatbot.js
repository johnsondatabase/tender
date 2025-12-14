
import { GoogleGenAI } from "@google/genai";
import { showToast, showLoading, sb, showView } from './app.js';
import { openListingModal } from './listing-form.js';

let chatSession = null;
let aiClient = null;
let currentImageBlob = null; 

// --- QUẢN LÝ API KEY ---
const DEFAULT_API_KEY = 'AIzaSyDMMoL4G5FDGPNUB2e84XNsNIQo68USVdQ'; // Key mặc định (fallback)

// Helper lấy API Key ưu tiên từ LocalStorage
const getApiKey = () => {
    const storedKey = localStorage.getItem('user_gemini_api_key');
    return storedKey && storedKey.trim().length > 10 ? storedKey : DEFAULT_API_KEY;
};

// --- TOOL DEFINITIONS ---

const searchListingsTool = {
    name: 'search_listings',
    description: 'Search for tender listings. Use this to find specific contracts by code, hospital, or status.',
    parameters: {
        type: 'OBJECT',
        properties: {
            keyword: { type: 'STRING', description: 'Search keyword (Hospital, Code, Province).' },
            status: { type: 'STRING', description: 'Filter by status: "Win", "Fail", "Waiting".' },
            year: { type: 'NUMBER', description: 'Filter by year.' },
            limit: { type: 'NUMBER', description: 'Max results (default 20).' }
        }
    }
};

const checkExpiringContractsTool = {
    name: 'check_expiring_contracts',
    description: 'Advanced check for contract expiration dates (ngay_ket_thuc) in "listing" table. Can check for "expired" (da het han), "expiring soon" (sap het han), or specific ranges like "next month" (thang sau), "next quarter".',
    parameters: {
        type: 'OBJECT',
        properties: {
            mode: { type: 'STRING', description: 'Mode: "expired" (already expired), "upcoming" (future expiration), "range" (specific date range).' },
            days: { type: 'NUMBER', description: 'For "upcoming" mode: number of days from now (e.g. 30, 60).' },
            start_date: { type: 'STRING', description: 'For "range" mode: Start date YYYY-MM-DD.' },
            end_date: { type: 'STRING', description: 'For "range" mode: End date YYYY-MM-DD.' }
        }
    }
};

const searchProductHistoryTool = {
    name: 'search_product_history',
    description: 'Search for a specific Product (Mã VT). RETURNS EXACT STATS MATCHING "PRODUCT VIEW" (Quota, Waiting, Win, Fail) and full bidding history.',
    parameters: {
        type: 'OBJECT',
        properties: {
            product_code: { type: 'STRING', description: 'Product Code (e.g., "VT-003").' }
        },
        required: ['product_code']
    }
};

const getStatsTool = {
    name: 'get_general_stats',
    description: 'Get SYSTEM-WIDE business statistics. Returns TWO types of Win Rates: 1. Contract Win Rate (based on listing count). 2. Revenue Win Rate (based on Total Won Value / Total Quota).',
    parameters: { type: 'OBJECT', properties: {} } 
};

const analyzePsrPerformanceTool = {
    name: 'analyze_psr_performance',
    description: 'Analyze Sales Representative (PSR) performance. Calculates TWO metrics per PSR: 1. Contract Success (Won Contracts / Total Contracts). 2. Sales Success (Won Value / Total Quota).',
    parameters: { type: 'OBJECT', properties: {} }
};

const getPsrProductsTool = {
    name: 'get_psr_products',
    description: 'Get detailed product performance for a specific PSR. Returns a list of products they bid on, including bid counts, win counts, and win rates (both by contract count and volume/quota). Use this to answer "What products does [PSR] sell?", "Which products did [PSR] bid on?", or "Win rate of [PSR] per product".',
    parameters: { 
        type: 'OBJECT', 
        properties: {
            psr_name: { type: 'STRING', description: 'Name of the PSR (e.g. "Le Van C")' }
        },
        required: ['psr_name']
    }
};

const navigateTool = {
    name: 'navigate_to',
    description: 'Navigate to a specific screen.',
    parameters: {
        type: 'OBJECT',
        properties: {
            view_id: { 
                type: 'STRING', 
                description: 'View ID: "view-phat-trien", "view-ton-kho", "view-chi-tiet", "view-san-pham", "view-cai-dat".' 
            }
        },
        required: ['view_id']
    }
};

const openAddFormTool = {
    name: 'open_add_listing_form',
    description: 'EXTRACT DATA FROM IMAGE AND OPEN FORM. Use this tool when the user uploads an image containing contract/listing data. You must extract fields like ma_thau, benh_vien, nam, tinh, etc. from the image text and pass them to this function.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING' },
            benh_vien: { type: 'STRING' },
            nam: { type: 'NUMBER' },
            tinh: { type: 'STRING' },
            khu_vuc: { type: 'STRING' },
            loai: { type: 'STRING' },
            nha_phan_phoi: { type: 'STRING' },
            ngay: { type: 'STRING' },
            ngay_ky: { type: 'STRING' },
            ngay_ket_thuc: { type: 'STRING' },
            nganh: { type: 'STRING' },
            psr: { type: 'STRING' },
            quan_ly: { type: 'STRING' },
            details: { 
                type: 'ARRAY', 
                items: {
                    type: 'OBJECT',
                    properties: { ma_vt: { type: 'STRING' }, quota: { type: 'NUMBER' } }
                }
            }
        }
    }
};

export function initChatbot() {
    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const closeBtn = document.getElementById('chatbot-close-btn');
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    const chatWindow = document.getElementById('chatbot-window');
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const fileInput = document.getElementById('chatbot-file-input');
    const removeImgBtn = document.getElementById('chatbot-remove-img');

    if (!toggleBtn || !chatWindow) return;

    // --- SETUP TƯƠNG TÁC GIAO DIỆN ---
    
    // 1. Giao diện & Hiển thị Mobile (Shopee Style)
    toggleBtn.classList.remove('hidden'); 
    toggleBtn.style.display = 'flex';     
    toggleBtn.style.zIndex = '9999';      
    
    // Đảm bảo cửa sổ chat đè lên nút toggle (z-index cao hơn)
    chatWindow.style.zIndex = '10000';

    // === FIX 1: Giảm kích thước trên mobile (w-12 h-12) và giữ nguyên desktop (md:w-16 md:h-16) ===
    toggleBtn.className = "fixed bottom-6 right-6 p-0 w-12 h-12 md:w-16 md:h-16 bg-[#9333ea] hover:bg-[#7e22ce] rounded-full shadow-2xl hover:scale-105 transition-transform flex items-center justify-center cursor-pointer border-2 border-white";
    toggleBtn.innerHTML = `
        <div class="relative flex items-center justify-center w-full h-full">
            <img src="https://cdn-icons-png.flaticon.com/128/69/69059.png" alt="Chatbot Icon" class="w-6 h-6 md:w-10 md:h-10 object-contain filter brightness-0 invert">
            <span class="absolute top-0 right-0 flex h-3.5 w-3.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 border-2 border-[#9333ea]"></span>
            </span>
        </div>
    `;

    // 2. Kéo thả LIÊN KẾT (Cửa sổ và Nút dính nhau)
    makeElementDraggable(toggleBtn, { isToggle: true, linkedEl: chatWindow });
    makeElementDraggable(chatWindow, { isWindow: true, linkedEl: toggleBtn });

    // 4. Co dãn kích thước cửa sổ (RESIZE) - GÓC TRÊN TRÁI
    initResizableTopLeft(chatWindow);

    // 5. MỚI: Thêm nút Cài đặt API Key
    injectSettingsUI();
    // ---------------------------------

    closeBtn.addEventListener('click', () => chatWindow.classList.add('hidden'));
    minimizeBtn.addEventListener('click', () => chatWindow.classList.add('hidden'));

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleImageSelect(file);
    });

    input.addEventListener('paste', (e) => {
        const items = (e.clipboardData || window.clipboardData).items;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                e.preventDefault();
                handleImageSelect(item.getAsFile());
                return;
            }
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    removeImgBtn.addEventListener('click', () => {
        currentImageBlob = null;
        document.getElementById('chatbot-image-preview').classList.add('hidden');
        fileInput.value = '';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        
        if (!text && !currentImageBlob) return;

        appendMessage(text, 'user', currentImageBlob);
        
        const userMessage = text; 
        const imageToSend = currentImageBlob;

        input.value = '';
        input.style.height = 'auto'; 
        currentImageBlob = null;
        document.getElementById('chatbot-image-preview').classList.add('hidden');
        fileInput.value = '';

        await sendMessageToAI(userMessage, imageToSend);
    });

    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Khởi tạo AI Client ban đầu
    try {
        const apiKey = getApiKey();
        aiClient = new GoogleGenAI({ apiKey: apiKey });
    } catch(e) {
        console.error("AI Init Failed", e);
    }

    renderSuggestions();
}

/**
 * Hàm thêm giao diện Cài đặt (Nút bánh răng + Modal)
 */
function injectSettingsUI() {
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    if (!minimizeBtn) return;

    // A. Tạo nút Cài đặt (Icon bánh răng)
    // Kiểm tra nếu chưa có thì mới tạo
    if (!document.getElementById('chatbot-settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'chatbot-settings-btn';
        settingsBtn.className = "text-white hover:text-gray-200 transition-colors mr-2 opacity-80 hover:opacity-100";
        settingsBtn.title = "Cài đặt API Key";
        // Icon Bánh răng (SVG)
        settingsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        `;
        settingsBtn.onclick = openSettingsModal;

        // Chèn vào trước nút minimize (trên header)
        minimizeBtn.parentNode.insertBefore(settingsBtn, minimizeBtn);
    }

    // B. Tạo Modal nhập Key (Ẩn mặc định)
    if (!document.getElementById('chatbot-settings-modal')) {
        const modal = document.createElement('div');
        modal.id = 'chatbot-settings-modal';
        // Style: Overlay đè lên toàn bộ nội dung cửa sổ chat
        modal.className = 'hidden absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center z-50 rounded-2xl p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl w-full shadow-2xl border border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-bold mb-2 text-gray-800 dark:text-white flex items-center gap-2">
                    🔑 Cài đặt API Key
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
                </p>
                
                <div class="space-y-3">
                    <input type="password" id="custom-api-key" 
                        placeholder="dán key vào đây (AIza...)" 
                        class="w-full text-sm border border-gray-300 dark:border-gray-600 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#9333ea] transition-all">
                    
                    <div class="flex justify-end gap-2 pt-2">
                        <button id="cancel-settings" class="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Đóng</button>
                        <button id="save-settings" class="px-4 py-2 text-xs font-medium bg-[#9333ea] text-white hover:bg-[#7e22ce] rounded-lg shadow-sm transition-colors">Lưu Key</button>
                    </div>
                </div>

                <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-center">
                     <button id="remove-key" class="text-[11px] text-red-500 hover:text-red-600 hover:underline">Xóa Key & Dùng mặc định</button>
                </div>
            </div>
        `;
        document.getElementById('chatbot-window').appendChild(modal);

        // Logic xử lý sự kiện
        document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
        
        document.getElementById('save-settings').onclick = () => {
            const key = document.getElementById('custom-api-key').value.trim();
            if (key) {
                localStorage.setItem('user_gemini_api_key', key);
                // Khởi tạo lại client với key mới ngay lập tức
                aiClient = new GoogleGenAI({ apiKey: key });
                chatSession = null; // Reset session để dùng config mới
                showToast('✅ Đã lưu API Key mới!', 'success');
                modal.classList.add('hidden');
            } else {
                showToast('Vui lòng nhập Key hợp lệ.', 'error');
            }
        };

        document.getElementById('remove-key').onclick = () => {
            if(confirm("Bạn có chắc muốn xóa Key cá nhân và quay về dùng Key hệ thống?")) {
                localStorage.removeItem('user_gemini_api_key');
                aiClient = new GoogleGenAI({ apiKey: DEFAULT_API_KEY });
                chatSession = null;
                document.getElementById('custom-api-key').value = '';
                showToast('Đã khôi phục API Key mặc định.', 'info');
                modal.classList.add('hidden');
            }
        };
    }
}

function openSettingsModal() {
    const modal = document.getElementById('chatbot-settings-modal');
    const input = document.getElementById('custom-api-key');
    if (modal && input) {
        // Điền key hiện tại (nếu có)
        input.value = localStorage.getItem('user_gemini_api_key') || '';
        modal.classList.remove('hidden');
    }
}

// ... (Các hàm còn lại giữ nguyên như cũ) ...

/**
 * Hàm thay đổi kích thước từ GÓC TRÊN TRÁI (Top-Left)
 * @param {HTMLElement} el - Phần tử cửa sổ chat
 */
function initResizableTopLeft(el) {
    // Tạo phần tử tay nắm (Handle) ở góc TRÊN TRÁI
    const handle = document.createElement('div');
    
    // Style: Góc trên trái, con trỏ chéo
    handle.className = 'absolute cursor-nwse-resize z-[100] flex items-center justify-center bg-transparent';
    handle.style.width = '24px';
    handle.style.height = '24px';
    handle.style.left = '0'; // Căn trái
    handle.style.top = '0';  // Căn trên
    
    // Icon góc vuông ở góc trên trái
    handle.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="text-gray-400 opacity-80 rotate-180">
            <path d="M11 1V11H1L11 1Z" fill="currentColor"/>
        </svg>
    `;

    el.appendChild(handle);

    // Kích thước tối thiểu
    el.style.minWidth = '300px'; // Giảm 1 chút cho màn hình bé
    el.style.minHeight = '400px';

    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const onMouseDown = (e) => {
        // Tắt tính năng resize trên Mobile để tránh lỗi
        if (window.innerWidth < 768) return;

        e.stopPropagation();
        e.preventDefault();

        isResizing = true;
        // Lấy tọa độ chuột ban đầu
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
        
        // Lấy thông số hình học ban đầu của cửa sổ
        const rect = el.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;

        // Reset style để dùng top/left thay vì bottom/right (tránh xung đột)
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = startLeft + 'px';
        el.style.top = startTop + 'px';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('touchend', onMouseUp);
        
        document.body.style.cursor = 'nwse-resize';
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;
        
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;

        // Tính toán khoảng dịch chuyển
        const dx = clientX - startX;
        const dy = clientY - startY;

        // Kích thước mới = Kích thước cũ - dịch chuyển (Kéo sang trái -> width tăng)
        const newWidth = startWidth - dx;
        const newHeight = startHeight - dy;

        // Cập nhật Width & Left (Nếu width > min)
        if (newWidth > 300) {
            el.style.width = `${newWidth}px`;
            el.style.left = `${startLeft + dx}px`; // Cửa sổ phải dịch chuyển theo chuột
        }

        // Cập nhật Height & Top (Nếu height > min)
        if (newHeight > 400) {
            el.style.height = `${newHeight}px`;
            el.style.top = `${startTop + dy}px`;   // Cửa sổ phải dịch chuyển theo chuột
        }
    };

    const onMouseUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.cursor = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onMouseDown);
}

/**
 * Hàm xử lý kéo thả di chuyển (Draggable) - HỖ TRỢ LIÊN KẾT 2 PHẦN TỬ
 */
function makeElementDraggable(el, options = {}) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;
    
    // Biến cho phần tử liên kết (nếu có)
    let linkedEl = options.linkedEl;
    let linkedInitialLeft, linkedInitialTop;

    const chatWindow = document.getElementById('chatbot-window');

    const onMouseDown = (e) => {
        // === QUAN TRỌNG: Tắt kéo thả cửa sổ chat trên mobile ===
        // Lý do: Để cửa sổ cố định ở đáy, tránh việc tính toán lại vị trí làm văng cửa sổ khi bàn phím bật lên
        if (options.isWindow && window.innerWidth < 768) return;

        if (e.button !== 0 && e.type !== 'touchstart') return;

        // Logic riêng cho Window: Chỉ kéo khi nắm vào Header
        if (options.isWindow) {
            const rect = el.getBoundingClientRect();
            const clickY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
            // Chỉ cho phép kéo ở phần header (60px đầu tiên)
            if (clickY - rect.top > 60 || ['INPUT', 'BUTTON', 'TEXTAREA', 'I', 'SVG', 'PATH'].includes(e.target.tagName)) return;
        }

        isDragging = true;
        hasMoved = false;
        
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        startX = clientX;
        startY = clientY;
        
        // --- CHUẨN BỊ PHẦN TỬ CHÍNH ---
        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';
        el.style.cursor = 'grabbing';
        
        // --- CHUẨN BỊ PHẦN TỬ LIÊN KẾT (NẾU CÓ) ---
        if (linkedEl) {
            const lRect = linkedEl.getBoundingClientRect();
            linkedInitialLeft = lRect.left;
            linkedInitialTop = lRect.top;
            
            // Chuyển sang fixed positioning để di chuyển mượt mà
            linkedEl.style.bottom = 'auto';
            linkedEl.style.right = 'auto';
            linkedEl.style.left = linkedInitialLeft + 'px';
            linkedEl.style.top = linkedInitialTop + 'px';
        }

        document.body.style.userSelect = 'none';

        if (e.type === 'touchstart') {
            document.addEventListener('touchmove', onMouseMove, { passive: false });
            document.addEventListener('touchend', onMouseUp);
        } else {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault(); 

        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        const dx = clientX - startX;
        const dy = clientY - startY;
        
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;

        // Di chuyển phần tử chính
        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;
        
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        // Giới hạn màn hình
        if (newLeft < 0) newLeft = 0;
        if (newLeft + elW > winW) newLeft = winW - elW;
        if (newTop < 0) newTop = 0;
        if (newTop + elH > winH) newTop = winH - elH;

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';

        // --- DI CHUYỂN PHẦN TỬ LIÊN KẾT ---
        if (linkedEl) {
            // Phần tử liên kết di chuyển cùng một lượng delta (dx, dy)
            let lNewLeft = linkedInitialLeft + dx;
            let lNewTop = linkedInitialTop + dy;
            
            // (Tùy chọn: Có thể thêm giới hạn màn hình cho linkedEl ở đây nếu muốn)
            linkedEl.style.left = lNewLeft + 'px';
            linkedEl.style.top = lNewTop + 'px';
        }
    };

    const onMouseUp = (e) => {
        isDragging = false;
        el.style.cursor = options.isWindow ? 'default' : 'grab';
        document.body.style.userSelect = '';
        
        if (e.type === 'touchend') {
             // === FIX CRITICAL MOBILE BUG ===
             // Prevent "Ghost Click" (simulated mouse events) on mobile devices.
             // This prevents the toggle logic from firing twice (Touch End -> Mouse Up),
             // which causes the window to open and close instantly.
             if (e.cancelable) e.preventDefault();

             document.removeEventListener('touchmove', onMouseMove);
             document.removeEventListener('touchend', onMouseUp);
        } else {
             document.removeEventListener('mousemove', onMouseMove);
             document.removeEventListener('mouseup', onMouseUp);
        }

        if (options.isToggle && !hasMoved) {
            // Debounce check: Prevent multiple executions within 300ms
            const now = Date.now();
            if (el.lastToggle && now - el.lastToggle < 300) return;
            el.lastToggle = now;

            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                // --- KHI MỞ CHAT: TỰ ĐỘNG CĂN VỊ TRÍ ---
                alignChatWindowToButton(el, chatWindow);
                
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        }
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onMouseDown, { passive: false });
}

// === FIX 2: Cập nhật hàm căn vị trí để KHÔNG BỊ ẨN KHI BẬT BÀN PHÍM ===
function alignChatWindowToButton(btn, win) {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    // === MOBILE (< 768px): CHẾ ĐỘ "BOTTOM SHEET" ===
    if (winW < 768) {
        // Thay vì căn giữa (center), ta sẽ ghim chặt xuống đáy màn hình (bottom: 0)
        // và reset top thành 'auto'. Khi bàn phím bật lên, viewport nhỏ lại,
        // bottom: 0 sẽ tự đẩy cửa sổ lên theo bàn phím, không bị che.
        win.style.position = 'fixed';
        win.style.top = 'auto'; // QUAN TRỌNG: Reset top để không bị cố định vị trí cũ
        win.style.bottom = '0'; // Ghim đáy
        win.style.left = '0';
        win.style.right = '0';
        
        // Kích thước full ngang, cao 85% màn hình
        win.style.width = '100%';
        win.style.height = '85vh'; 
        win.style.maxHeight = '100%';
        
        // Bo tròn góc trên cho đẹp
        win.style.borderRadius = '16px 16px 0 0';
        win.style.margin = '0';
        win.style.transform = 'none'; // Xóa transform nếu có

        // Đảm bảo z-index cao nhất
        win.style.zIndex = '10000';
        return;
    }

    // === DESKTOP: GIỮ NGUYÊN LOGIC CŨ ===
    const btnRect = btn.getBoundingClientRect();
    const winRect = win.getBoundingClientRect();
    
    // Top = Đỉnh nút - Chiều cao cửa sổ - 10px khoảng cách
    let newTop = btnRect.top - winRect.height - 10;
    
    // Left = Căn phải cửa sổ thẳng hàng với căn phải nút
    let newLeft = (btnRect.left + btnRect.width) - winRect.width;

    // Giới hạn không cho tràn màn hình
    if (newTop < 10) newTop = 10; 
    if (newLeft < 10) newLeft = 10; 
    
    win.style.bottom = 'auto';
    win.style.right = 'auto';
    win.style.top = newTop + 'px';
    win.style.left = newLeft + 'px';
    win.style.width = ''; // Reset width trên desktop
    win.style.height = ''; // Reset height trên desktop
    win.style.borderRadius = ''; // Reset border radius
}

function handleImageSelect(file) {
    if (!file.type.startsWith('image/')) {
        showToast('Vui lòng chọn file ảnh.', 'error');
        return;
    }
    currentImageBlob = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById('chatbot-image-preview').querySelector('img');
        img.src = e.target.result;
        document.getElementById('chatbot-image-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function renderSuggestions() {
    const suggestions = [
        "Doanh số toàn bộ phận",
        "Hiệu suất của các PSR",
        "Hồ sơ nào sắp hết hạn?",
        "Các sản phẩm nào dự thầu cao tỉ lệ thắng bao nhiêu?"
    ];
    const container = document.getElementById('chatbot-suggestions');
    if(container) {
        container.innerHTML = suggestions.map(s => `
            <button class="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-600 hover:text-blue-600 hover:border-blue-200 transition-colors whitespace-nowrap shadow-sm" onclick="document.getElementById('chatbot-input').value = '${s}'; document.getElementById('chatbot-form').dispatchEvent(new Event('submit'));">
                ${s}
            </button>
        `).join('');
    }
}

async function startNewSession() {
    try {
        const currentKey = getApiKey();
        
        chatSession = aiClient.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: `
                    You are "WH-B4 Assistant", an expert CRM Data Analyst.
                    
                    **KEY PRINCIPLE: DISTINGUISH METRICS**
                    - **Listing Win Rate (Tỉ lệ thắng thầu)**: Based on COUNT of contracts (Hồ sơ) in 'listing' table. (Win Count / Total Listings).
                    - **Product/Value Win Rate (Tỉ lệ thắng sản phẩm/Doanh số)**: Based on VOLUME in 'detail' table. (Total Won Value / Total Quota).
                    - ALWAYS distinguish these two when answering performance questions.
                    
                    **IMAGE INPUT HANDLING:** - If the user uploads an image (e.g., photo of a document, spreadsheet row, or form), ANALYZE it immediately.
                    - If the image contains tender/contract data (Hospital Name, Code, Year, Province, etc.), **EXTRACT** the data and **IMMEDIATELY CALL** the \`open_add_listing_form\` tool with the extracted data to pre-fill the form.
                    - Do not just describe the image. ACT on it.

                    **Tools:**
                    1. \`check_expiring_contracts\`: Finds listings expiring.
                    2. \`search_product_history\`: For Product stats.
                    3. \`get_psr_products\`: **CRITICAL**: Use this when asked about **which products a PSR sells** or **their win rates per product**. It returns detailed bid/win counts.
                    4. \`analyze_psr_performance\`: For Overall PSR Stats ranking.
                    5. \`get_general_stats\`: For Company Stats.
                    6. \`search_listings\`: For searching contracts.
                    7. \`open_add_listing_form\`: Use this to OPEN the form and PRE-FILL it with data extracted from an image or text.
                    
                    **Response Style:**
                    - Vietnamese language.
                    - Concise, data-driven.
                    - Use Markdown tables.
                `,
                tools: [
                    { functionDeclarations: [searchListingsTool, checkExpiringContractsTool, searchProductHistoryTool, getStatsTool, analyzePsrPerformanceTool, getPsrProductsTool, navigateTool, openAddFormTool] }
                ]
            }
        });
        console.log("Chat session initialized. Using Key:", currentKey.substring(0, 5) + "...");
    } catch(e) {
        console.error("Session Start Error", e);
        appendMessage("Lỗi khởi tạo AI. Vui lòng kiểm tra API Key.", 'ai');
    }
}

async function sendMessageToAI(text, imageFile) {
    const loadingId = appendThinking();
    
    try {
        if (!chatSession) await startNewSession();

        let response;
        
        if (imageFile) {
            const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(imageFile);
            });

            const imagePart = { inlineData: { mimeType: imageFile.type, data: base64Data } };
            // Gợi ý mạnh mẽ cho AI biết phải làm gì với ảnh
            const promptText = text || "Hãy trích xuất thông tin từ ảnh này và điền vào form tạo hồ sơ mới."; 
            const parts = [{ text: promptText }, imagePart];
            response = await chatSession.sendMessage({ message: parts });
        } else {
            response = await chatSession.sendMessage({ message: text });
        }

        const responseText = response.text || "";
        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
            removeThinking(loadingId);
            
            for (const call of functionCalls) {
                const fnName = call.name;
                const args = call.args;
                let result = { error: "Unknown function" };
                
                if (fnName === 'search_listings') {
                    let query = sb.from('listing')
                        .select('ma_thau, benh_vien, tinh_trang, ngay, nha_phan_phoi, tinh', { count: 'exact' })
                        .order('ngay', { ascending: false })
                        .limit(args.limit || 20); 

                    if (args.status) query = query.ilike('tinh_trang', `%${args.status}%`);
                    if (args.year) query = query.eq('nam', args.year);
                    if (args.keyword) {
                        const k = args.keyword;
                        query = query.or(`ma_thau.ilike.%${k}%,benh_vien.ilike.%${k}%,nha_phan_phoi.ilike.%${k}%,tinh.ilike.%${k}%`);
                    }
                    
                    appendMessage(`🔍 Đang tìm thầu...`, 'ai');
                    const { data, count } = await query;
                    
                    if (data && data.length > 0) {
                        result = { 
                            total_found: count,
                            showing: data.length,
                            message: `Tìm thấy tổng cộng ${count} kết quả. Dưới đây là ${data.length} hồ sơ mới nhất.`,
                            listings: data 
                        };
                    } else {
                        result = { message: "Không tìm thấy hồ sơ." };
                    }
                } 
                // --- FIX LOGIC KIỂM TRA HỒ SƠ HẾT HẠN ---
                else if (fnName === 'check_expiring_contracts') {
                    const mode = args.mode || 'upcoming';
                    const days = args.days || 30;
                    
                    // Lấy ngày hiện tại chuẩn YYYY-MM-DD
                    const todayStr = new Date().toISOString().split('T')[0];
                    
                    console.log(`[Debug AI] Mode: ${mode}, Today: ${todayStr}`);

                    let query = sb.from('listing')
                        .select('ma_thau, benh_vien, ngay_ket_thuc, tinh_trang, psr')
                        .order('ngay_ket_thuc', { ascending: true })
                        .limit(20);

                    let msg = "";

                    if (mode === 'expired') {
                        msg = `Kiểm tra các hồ sơ ĐÃ hết hạn (trước ${todayStr})...`;
                        query = query.lt('ngay_ket_thuc', todayStr);
                    } else if (mode === 'range') {
                        const start = args.start_date || todayStr;
                        const end = args.end_date || todayStr;
                        msg = `Kiểm tra hồ sơ hết hạn từ ${start} đến ${end}...`;
                        query = query.gte('ngay_ket_thuc', start).lte('ngay_ket_thuc', end);
                    } else {
                        // Mặc định: Sắp hết hạn (Upcoming)
                        const future = new Date();
                        future.setDate(future.getDate() + days);
                        const futureStr = future.toISOString().split('T')[0];
                        
                        msg = `Kiểm tra hồ sơ sắp hết hạn từ ${todayStr} đến ${futureStr}...`;
                        query = query.gte('ngay_ket_thuc', todayStr).lte('ngay_ket_thuc', futureStr);
                    }

                    appendMessage(`⏳ ${msg}`, 'ai');
                    const { data, error } = await query;

                    // Log để debug trong Console F12
                    console.log("[Debug AI] Query Result:", data);
                    console.log("[Debug AI] Query Error:", error);

                    if (error) {
                        result = { message: `Lỗi truy vấn: ${error.message}` };
                    } else if (!data || data.length === 0) {
                        result = { 
                            message: `Không tìm thấy hồ sơ nào trong khoảng thời gian này. Vui lòng kiểm tra lại định dạng cột ngày tháng trong cơ sở dữ liệu.` 
                        };
                    } else {
                         // Format ngày hiển thị cho đẹp
                        const formattedData = data.map(item => ({
                            ...item,
                            ngay_ket_thuc: item.ngay_ket_thuc ? item.ngay_ket_thuc.split('-').reverse().join('/') : 'N/A'
                        }));
                        result = { 
                            count: data.length,
                            listings: formattedData 
                        };
                    }
                }
                // ----------------------------------------
                else if (fnName === 'search_product_history') {
                    const pCode = args.product_code;
                    appendMessage(`📦 Đang tham khảo dữ liệu tổng hợp cho "${pCode}"...`, 'ai');
                    
                    const { data: prodStats } = await sb
                        .from('product_total')
                        .select('ma_vt, ten_vt, waiting, win, fail')
                        .ilike('ma_vt', `%${pCode}%`)
                        .limit(1)
                        .single();

                    const { data: history } = await sb
                        .from('detail')
                        .select('ma_thau, benh_vien, tinh_trang, quota, sl_trung, ngay_ky')
                        .ilike('ma_vt', `%${pCode}%`)
                        .order('ngay_ky', { ascending: false, nullsFirst: false }); 
                        
                    if (history && history.length > 0) {
                        let manWaiting = 0, manWin = 0, manFail = 0, manQuota = 0;
                        history.forEach(h => {
                            const q = h.quota || 0;
                            const w = h.sl_trung || 0;
                            manQuota += q;
                            if (h.tinh_trang === 'Win') manWin += w; 
                            else if (h.tinh_trang === 'Fail') manFail += q;
                            else if (h.tinh_trang === 'Waiting') manWaiting += q;
                        });

                        const finalSummary = prodStats ? {
                            source: "Product View (Official)",
                            product: prodStats.ma_vt,
                            name: prodStats.ten_vt,
                            waiting_quota: prodStats.waiting?.toLocaleString('vi-VN'),
                            win_revenue: prodStats.win?.toLocaleString('vi-VN'),
                            fail_quota: prodStats.fail?.toLocaleString('vi-VN'),
                            total_quota: (prodStats.waiting + prodStats.win + prodStats.fail)?.toLocaleString('vi-VN') 
                        } : {
                            source: "Calculated from Detail History",
                            product: pCode,
                            waiting_quota: manWaiting.toLocaleString('vi-VN'),
                            win_revenue: manWin.toLocaleString('vi-VN'),
                            fail_quota: manFail.toLocaleString('vi-VN'),
                            total_quota: manQuota.toLocaleString('vi-VN')
                        };

                        result = { 
                            summary: finalSummary,
                            history_count: history.length,
                            history_list: history.slice(0, 50) 
                        };
                    } else {
                        result = { message: `Không tìm thấy lịch sử cho sản phẩm ${pCode}.` };
                    }
                }
                else if (fnName === 'get_general_stats') {
                    // 1. Get Listing Stats (Count)
                    const { data: listingData } = await sb.from('listing').select('tinh_trang');
                    // 2. Get Detail Stats (Value)
                    const { data: details } = await sb.from('detail').select('quota, sl_trung, tinh_trang');

                    let listingStats = { total: 0, win: 0 };
                    if (listingData) {
                        listingStats.total = listingData.length;
                        listingStats.win = listingData.filter(i => i.tinh_trang === 'Win').length;
                    }

                    let valueStats = { quota: 0, waiting: 0, win_revenue: 0, fail: 0 };
                    if (details) {
                        details.forEach(d => {
                            const q = d.quota || 0;
                            const w = d.sl_trung || 0;
                            valueStats.quota += q;
                            if (d.tinh_trang === 'Waiting') valueStats.waiting += q;
                            else if (d.tinh_trang === 'Win') valueStats.win_revenue += w;
                            else if (d.tinh_trang === 'Fail') valueStats.fail += q;
                        });
                    }

                    const contractWinRate = listingStats.total > 0 ? ((listingStats.win / listingStats.total) * 100).toFixed(1) + '%' : '0%';
                    const valueWinRate = valueStats.quota > 0 ? ((valueStats.win_revenue / valueStats.quota) * 100).toFixed(1) + '%' : '0%';

                    result = { 
                        contract_stats: {
                            total_contracts: listingStats.total,
                            win_count: listingStats.win,
                            contract_win_rate: contractWinRate,
                            note: "Tỉ lệ thắng dựa trên số lượng hồ sơ thầu (Listing)"
                        },
                        value_stats: {
                            total_quota: valueStats.quota.toLocaleString('vi-VN'),
                            win_revenue: valueStats.win_revenue.toLocaleString('vi-VN'),
                            revenue_win_rate: valueWinRate,
                            note: "Tỉ lệ thắng dựa trên doanh số/giá trị (Product Volume)"
                        },
                        breakdown_value: {
                            waiting: valueStats.waiting.toLocaleString('vi-VN'),
                            fail: valueStats.fail.toLocaleString('vi-VN')
                        }
                    };
                }
                else if (fnName === 'analyze_psr_performance') {
                    appendMessage(`📊 Đang tính toán hiệu suất PSR (Hồ sơ & Doanh số)...`, 'ai');
                    
                    const { data: details, error } = await sb
                        .from('detail')
                        .select('psr, ma_thau, quota, sl_trung, tinh_trang');

                    if (error || !details || details.length === 0) {
                        result = { message: "Không tìm thấy dữ liệu chi tiết thầu." };
                    } else {
                        const stats = {};
                        
                        details.forEach(d => {
                            const psrName = d.psr || "Chưa phân công";
                            if (!stats[psrName]) {
                                stats[psrName] = { 
                                    // Value Metrics
                                    total_quota: 0, 
                                    win_revenue: 0,
                                    // Contract Metrics (Using Set to count unique contracts)
                                    contract_ids: new Set(),
                                    win_contract_ids: new Set()
                                };
                            }
                            
                            const q = d.quota || 0;
                            const w = d.sl_trung || 0;
                            
                            // Value Accumulation
                            stats[psrName].total_quota += q;
                            if (d.tinh_trang === 'Win') stats[psrName].win_revenue += w;

                            // Contract Counting
                            stats[psrName].contract_ids.add(d.ma_thau);
                            if (d.tinh_trang === 'Win') stats[psrName].win_contract_ids.add(d.ma_thau);
                        });

                        const report = Object.entries(stats).map(([psr, val]) => {
                            const totalContracts = val.contract_ids.size;
                            const winContracts = val.win_contract_ids.size;
                            const contractRate = totalContracts > 0 ? ((winContracts / totalContracts) * 100).toFixed(1) + '%' : '0%';
                            
                            const valueRate = val.total_quota > 0 ? ((val.win_revenue / val.total_quota) * 100).toFixed(1) + '%' : '0%';

                            return {
                                psr: psr,
                                contracts: {
                                    total: totalContracts,
                                    won: winContracts,
                                    win_rate: contractRate
                                },
                                value: {
                                    quota: val.total_quota.toLocaleString('vi-VN'),
                                    revenue: val.win_revenue.toLocaleString('vi-VN'),
                                    win_rate: valueRate
                                }
                            };
                        }).sort((a, b) => {
                            const revA = parseFloat(a.value.revenue.replace(/\./g, ''));
                            const revB = parseFloat(b.value.revenue.replace(/\./g, ''));
                            return revB - revA;
                        });

                        result = { 
                            note: "Báo cáo phân biệt rõ Tỉ lệ thắng theo Hồ sơ (Contracts) và Theo Doanh số (Value).",
                            psr_ranking: report 
                        };
                    }
                }
                else if (fnName === 'get_psr_products') {
                    const psrName = args.psr_name;
                    appendMessage(`🕵️‍♀️ Đang thống kê chi tiết sản phẩm của PSR "${psrName}"...`, 'ai');
                    
                    const { data: details, error } = await sb
                        .from('detail')
                        .select('ma_vt, quota, sl_trung, tinh_trang')
                        .ilike('psr', `%${psrName}%`); 
                    
                    if (error || !details || details.length === 0) {
                        result = { message: `Không tìm thấy dữ liệu thầu nào cho PSR "${psrName}".` };
                    } else {
                        const stats = {};
                        
                        details.forEach(d => {
                            const prod = d.ma_vt || "Unknown";
                            if (!stats[prod]) {
                                stats[prod] = { 
                                    bids: 0, // Number of times participated (lines in detail table)
                                    wins: 0, // Number of times status was 'Win'
                                    total_quota: 0, 
                                    total_won: 0 
                                };
                            }
                            
                            const q = d.quota || 0;
                            const w = d.sl_trung || 0;
                            
                            stats[prod].bids++;
                            stats[prod].total_quota += q;
                            
                            if (d.tinh_trang === 'Win') {
                                stats[prod].wins++;
                                stats[prod].total_won += w;
                            }
                        });

                        // Fetch Names for nicer display
                        const uniqueMaVts = Object.keys(stats);
                        const { data: productInfos } = await sb
                            .from('product')
                            .select('ma_vt, ten_vt')
                            .in('ma_vt', uniqueMaVts);
                        
                        const nameMap = {};
                        if (productInfos) {
                            productInfos.forEach(p => nameMap[p.ma_vt] = p.ten_vt);
                        }

                        const summaryList = uniqueMaVts.map(ma_vt => {
                            const s = stats[ma_vt];
                            // Contract Win Rate (Wins / Bids)
                            const contractWinRate = s.bids > 0 ? ((s.wins / s.bids) * 100).toFixed(1) : '0';
                            // Volume Win Rate (Won Value / Total Quota)
                            const volumeWinRate = s.total_quota > 0 ? ((s.total_won / s.total_quota) * 100).toFixed(1) : '0';

                            return {
                                ma_vt: ma_vt,
                                ten_vt: nameMap[ma_vt] || "Chưa có tên",
                                participation_count: s.bids,
                                win_count: s.wins,
                                total_quota: s.total_quota.toLocaleString('vi-VN'),
                                total_won_value: s.total_won.toLocaleString('vi-VN'),
                                contract_win_rate: `${contractWinRate}%`,
                                volume_win_rate: `${volumeWinRate}%`
                            };
                        }).sort((a, b) => {
                            // Sort by total quota descending
                            return parseFloat(b.total_quota.replace(/\./g,'')) - parseFloat(a.total_quota.replace(/\./g,''));
                        });

                        result = {
                            psr: psrName,
                            total_products_managed: uniqueMaVts.length,
                            product_performance: summaryList.slice(0, 30) // Limit top 30
                        };
                    }
                }
                else if (fnName === 'navigate_to') {
                    appendMessage(`🚀 Đang chuyển trang...`, 'ai');
                    await showView(args.view_id);
                    result = { success: true };
                }
                else if (fnName === 'open_add_listing_form') {
                    appendMessage(`📝 Đang phân tích và chuẩn bị form...`, 'ai');
                    
                    // 1. Auto-fill Time (Today/Year)
                    const now = new Date();
                    if (!args.ngay) args.ngay = now.toISOString().split('T')[0]; // YYYY-MM-DD
                    if (!args.nam) args.nam = now.getFullYear();

                    // 2. Smart Fill from History (Region, Province, Distributor based on Hospital)
                    if (args.benh_vien) {
                        try {
                            // Find the most recent entry for this hospital to guess details
                            // Use ilike for flexible matching (e.g. "Bạch Mai" -> "BV Bạch Mai")
                            const { data: history } = await sb
                                .from('listing')
                                .select('benh_vien, tinh, khu_vuc, loai, nha_phan_phoi, quan_ly, psr')
                                .ilike('benh_vien', `%${args.benh_vien}%`) 
                                .order('ngay', { ascending: false })
                                .limit(1)
                                .maybeSingle();

                            if (history) {
                                // Standardize hospital name if fuzzy match found
                                if (history.benh_vien) args.benh_vien = history.benh_vien;
                                
                                if (!args.tinh) args.tinh = history.tinh;
                                if (!args.khu_vuc) args.khu_vuc = history.khu_vuc;
                                if (!args.loai) args.loai = history.loai;
                                if (!args.nha_phan_phoi) args.nha_phan_phoi = history.nha_phan_phoi;
                                if (!args.quan_ly) args.quan_ly = history.quan_ly; // Bonus: Auto-fill Manager
                                if (!args.psr) args.psr = history.psr;             // Bonus: Auto-fill PSR
                                
                                appendMessage(`💡 Đã tìm thấy thông tin lịch sử của ${args.benh_vien}. Tự động điền: Tỉnh ${history.tinh}, NPP ${history.nha_phan_phoi}...`, 'ai');
                            }
                        } catch (err) {
                            console.log("Auto-fill error", err);
                        }
                    }

                    await showView('view-ton-kho');
                    setTimeout(() => openListingModal(args, false, true), 500);
                    result = { success: true, message: "Form opened with smart suggestions." };
                }

                const toolResponse = await chatSession.sendMessage({
                    message: [{
                        functionResponse: {
                            name: fnName,
                            response: { result: result }
                        }
                    }]
                });
                
                const finalResponseText = toolResponse.text;
                appendMessage(finalResponseText, 'ai');
                return; 
            }
        }

        removeThinking(loadingId);
        if (responseText) appendMessage(responseText, 'ai');

    } catch (error) {
        console.error("AI Error", error);
        removeThinking(loadingId);
        appendMessage("Xin lỗi, tôi gặp sự cố: " + error.message, 'ai');
    }
}

function appendMessage(text, sender, imageFile = null) {
    const messagesContainer = document.getElementById('chatbot-messages');
    const div = document.createElement('div');
    div.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`;
    
    let contentHtml = '';
    
    if (imageFile) {
        const url = URL.createObjectURL(imageFile);
        contentHtml += `<img src="${url}" class="max-w-[200px] rounded-lg mb-2 border border-gray-200 dark:border-gray-600 block">`;
    }
    
    // Sử dụng marked nếu có sẵn, nếu không thì dùng text thuần
    const formattedText = (sender === 'ai' && typeof marked !== 'undefined') ? marked.parse(text) : text;

    const bubbleClass = sender === 'user' 
        ? 'bg-[#2563eb] text-white p-3 rounded-2xl rounded-tr-none shadow-md max-w-[85%] text-sm' 
        : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-600 max-w-[85%] prose dark:prose-invert text-sm leading-relaxed';

    div.innerHTML = `
        <div class="${bubbleClass}">
            ${contentHtml}
            <div>${formattedText}</div>
        </div>
    `;
    
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendThinking() {
    const messagesContainer = document.getElementById('chatbot-messages');
    const id = 'thinking-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'flex justify-start animate-fade-in-up';
    div.innerHTML = `
        <div class="bg-white dark:bg-gray-700 p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2 border border-gray-100 dark:border-gray-600">
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
        </div>
    `;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
}

function removeThinking(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}
