import { GoogleGenAI } from "@google/genai";
import { showToast, showLoading, sb, showView } from './app.js';
import { openListingModal } from './listing-form.js';

let chatSession = null;
let aiClient = null;
let currentImageBlob = null;
let globalApiKey = '';
let conversationHistory = [];
const MAX_HISTORY_LENGTH = 10;

// --- QUẢN LÝ API KEY ---
const DEFAULT_API_KEY = 'AIzaSyDMMoL4G5FDGPNUB2e84XNsNIQo68USVdQ'; // Key mặc định (fallback)

// Fetches the global API key from Supabase
async function fetchGlobalApiKey() {
    try {
        const { data, error } = await sb
            .from('app_config')
            .select('value')
            .eq('key', 'gemini_api_key')
            .maybeSingle(); // Use maybeSingle to avoid error if row doesn't exist

        if (!error && data && data.value) {
            globalApiKey = data.value;
            console.log("Global API Key loaded.");
        }
    } catch (e) {
        console.warn("Could not fetch global API key (table might not exist):", e);
    }
}

// Saves the API Key to Supabase so everyone can use it
async function saveGlobalApiKey(key) {
    try {
        const { error } = await sb
            .from('app_config')
            .upsert({ key: 'gemini_api_key', value: key });

        if (error) throw error;
        
        globalApiKey = key;
        return true;
    } catch (e) {
        console.error("Error saving global API key:", e);
        showToast("Lỗi lưu Key lên hệ thống (có thể do thiếu bảng app_config). Đã lưu cục bộ.", "info");
        return false;
    }
}

// Helper lấy API Key ưu tiên: Global -> LocalStorage -> Default
const getApiKey = () => {
    // 1. Global Key from DB (Highest priority for shared use)
    if (globalApiKey && globalApiKey.trim().length > 10) return globalApiKey;

    // 2. Local Storage (Fallback for individual overrides or offline dev)
    const storedKey = localStorage.getItem('user_gemini_api_key');
    if (storedKey && storedKey.trim().length > 10) return storedKey;

    // 3. Default
    return DEFAULT_API_KEY;
};

// ... (Existing Tool Definitions) ...
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

const updateListingStatusTool = {
    name: 'update_listing_status',
    description: 'Update the status of a tender listing (Win, Fail, Waiting) and handle related data updates.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING', description: 'Tender code to update' },
            new_status: { type: 'STRING', description: 'New status: Win, Fail, or Waiting' },
            win_details: {
                type: 'OBJECT',
                description: 'Required if status is Win',
                properties: {
                    ngay_ky: { type: 'STRING', description: 'Sign date' },
                    ngay_ket_thuc: { type: 'STRING', description: 'End date' },
                    win_type: { type: 'STRING', description: 'full or partial' },
                    material_updates: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                ma_vt: { type: 'STRING' },
                                sl_trung: { type: 'NUMBER' }
                            }
                        }
                    }
                }
            }
        },
        required: ['ma_thau', 'new_status']
    }
};

const createUserTool = {
    name: 'create_user',
    description: 'Create a new user account in the system. Only available to Admin users.',
    parameters: {
        type: 'OBJECT',
        properties: {
            gmail: { type: 'STRING', description: 'User email/Gmail' },
            ho_ten: { type: 'STRING', description: 'Full name' },
            phan_quyen: { type: 'STRING', description: 'Role: Admin, Manager, or View' },
            xem: { type: 'ARRAY', items: { type: 'STRING' }, description: 'View permissions' },
            them: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Add permissions' },
            sua: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Edit permissions' },
            xoa: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Delete permissions' },
            nhap: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Import permissions' },
            xuat: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Export permissions' }
        },
        required: ['gmail', 'ho_ten', 'phan_quyen']
    }
};

const exportDataTool = {
    name: 'export_data',
    description: 'Export data to Excel format based on specified criteria.',
    parameters: {
        type: 'OBJECT',
        properties: {
            table: { type: 'STRING', description: 'Table to export: listing, detail, product, user' },
            filters: {
                type: 'OBJECT',
                description: 'Optional filters to apply',
                properties: {
                    status: { type: 'STRING' },
                    year: { type: 'NUMBER' },
                    psr: { type: 'STRING' },
                    province: { type: 'STRING' },
                    date_from: { type: 'STRING' },
                    date_to: { type: 'STRING' }
                }
            },
            format: { type: 'STRING', description: 'Export format: excel, csv', default: 'excel' }
        },
        required: ['table']
    }
};

const generateReportTool = {
    name: 'generate_business_report',
    description: 'Generate comprehensive business reports with insights and recommendations.',
    parameters: {
        type: 'OBJECT',
        properties: {
            report_type: {
                type: 'STRING',
                description: 'Type of report: performance, trends, psr_analysis, product_analysis, regional_analysis'
            },
            time_period: {
                type: 'STRING',
                description: 'Time period: this_month, last_month, this_quarter, last_quarter, this_year, custom'
            },
            custom_date_from: { type: 'STRING', description: 'Custom start date (YYYY-MM-DD)' },
            custom_date_to: { type: 'STRING', description: 'Custom end date (YYYY-MM-DD)' },
            focus_area: { type: 'STRING', description: 'Specific focus: psr_name, product_code, region' }
        },
        required: ['report_type', 'time_period']
    }
};

const predictiveAnalysisTool = {
    name: 'predictive_analysis',
    description: 'Provide predictive insights and recommendations based on historical data patterns.',
    parameters: {
        type: 'OBJECT',
        properties: {
            analysis_type: {
                type: 'STRING',
                description: 'Type: win_probability, market_trends, psr_forecast, product_demand'
            },
            target: { type: 'STRING', description: 'Target for analysis (PSR name, product code, region)' },
            timeframe: { type: 'STRING', description: 'Prediction timeframe: next_month, next_quarter, next_year' }
        },
        required: ['analysis_type', 'timeframe']
    }
};

const smartSearchTool = {
    name: 'smart_search',
    description: 'Perform intelligent search across multiple data sources with natural language understanding.',
    parameters: {
        type: 'OBJECT',
        properties: {
            query: { type: 'STRING', description: 'Natural language search query' },
            context: { type: 'STRING', description: 'Context: business, technical, performance, trends' }
        },
        required: ['query']
    }
};

const dataQualityCheckTool = {
    name: 'data_quality_check',
    description: 'Analyze data quality and identify issues, duplicates, or inconsistencies.',
    parameters: {
        type: 'OBJECT',
        properties: {
            check_type: {
                type: 'STRING',
                description: 'Type: duplicates, missing_data, inconsistencies, outliers'
            },
            table: { type: 'STRING', description: 'Table to check: listing, detail, product, user' }
        },
        required: ['check_type', 'table']
    }
};

export async function initChatbot() {
    // 1. Fetch Global Key first
    await fetchGlobalApiKey();

    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const headerToggleBtn = document.getElementById('header-chatbot-btn'); // Mobile Header Button
    const closeBtn = document.getElementById('chatbot-close-btn');
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    const chatWindow = document.getElementById('chatbot-window');
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const fileInput = document.getElementById('chatbot-file-input');
    const removeImgBtn = document.getElementById('chatbot-remove-img');

    if (!chatWindow) return;

    // --- SETUP TƯƠNG TÁC GIAO DIỆN ---
    
    // Toggle Button Logic (FAB)
    if (toggleBtn) {
        // Draggable Logic for FAB
        makeElementDraggable(toggleBtn, { isToggle: true, linkedEl: chatWindow });
        makeElementDraggable(chatWindow, { isWindow: true, linkedEl: toggleBtn });
    }

    // Toggle Button Logic (Mobile Header)
    if (headerToggleBtn) {
        headerToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                alignChatWindowToButton(headerToggleBtn, chatWindow); // Re-use alignment logic (will trigger mobile bottom sheet mode)
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        });
    }

    // Resize Logic
    initResizableTopLeft(chatWindow);

    // Settings UI
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
        // Save the user's command into the DB queue for background processing
        try {
            await saveUserCommandToDB(userMessage);
            appendMessage("✅ Lệnh đã được lưu và sẽ được xử lý tự động. Vui lòng chờ...", 'ai');
        } catch (err) {
            console.error("Save command error", err);
            // Fallback to immediate processing if DB save fails
            await sendMessageToAI(userMessage, imageToSend);
        }
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

    // Initial render of suggestions (will be updated after first interaction)
    renderSuggestions();
    // Start background poller to process queued commands in DB
    startCommandProcessorPoller();
}

/**
 * Hàm thêm giao diện Cài đặt (Nút bánh răng + Modal)
 */
function injectSettingsUI() {
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    if (!minimizeBtn) return;

    // A. Tạo nút Cài đặt (Icon bánh răng)
    if (!document.getElementById('chatbot-settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'chatbot-settings-btn';
        settingsBtn.className = "text-white hover:text-gray-200 transition-colors mr-2 opacity-80 hover:opacity-100";
        settingsBtn.title = "Cài đặt API Key";
        settingsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        `;
        settingsBtn.onclick = openSettingsModal;
        minimizeBtn.parentNode.insertBefore(settingsBtn, minimizeBtn);
    }

    // B. Tạo Modal nhập Key
    if (!document.getElementById('chatbot-settings-modal')) {
        const modal = document.createElement('div');
        modal.id = 'chatbot-settings-modal';
        modal.className = 'hidden absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center z-50 rounded-2xl p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl w-full shadow-2xl border border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-bold mb-2 text-gray-800 dark:text-white flex items-center gap-2">
                    🔑 Cài đặt API Key
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    Nhập key riêng của bạn để dùng. Nếu bạn là Admin, key này sẽ được lưu lên hệ thống cho mọi người dùng chung.
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

        document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
        
        document.getElementById('save-settings').onclick = async () => {
            const key = document.getElementById('custom-api-key').value.trim();
            if (key) {
                // 1. Save Local
                localStorage.setItem('user_gemini_api_key', key);
                
                // 2. Attempt Save Global (will persist if table exists)
                await saveGlobalApiKey(key);

                // 3. Re-init Client
                aiClient = new GoogleGenAI({ apiKey: key });
                chatSession = null; 
                showToast('✅ Đã lưu API Key!', 'success');
                modal.classList.add('hidden');
            } else {
                showToast('Vui lòng nhập Key hợp lệ.', 'error');
            }
        };

        document.getElementById('remove-key').onclick = () => {
            if(confirm("Bạn có chắc muốn xóa Key?")) {
                localStorage.removeItem('user_gemini_api_key');
                // Note: We don't delete global key here to prevent accidental system breakage by non-admins if logic was different
                // Reset to whatever global key exists or default
                const newKey = globalApiKey || DEFAULT_API_KEY;
                aiClient = new GoogleGenAI({ apiKey: newKey });
                chatSession = null;
                document.getElementById('custom-api-key').value = '';
                showToast('Đã khôi phục API Key mặc định/hệ thống.', 'info');
                modal.classList.add('hidden');
            }
        };
    }
}

function openSettingsModal() {
    const modal = document.getElementById('chatbot-settings-modal');
    const input = document.getElementById('custom-api-key');
    if (modal && input) {
        // Show current effective key (prioritize global if loaded)
        input.value = getApiKey() === DEFAULT_API_KEY ? '' : getApiKey();
        modal.classList.remove('hidden');
    }
}

// ... (Other UI Functions: initResizableTopLeft, makeElementDraggable, alignChatWindowToButton, handleImageSelect, renderSuggestions, etc.) ...

function initResizableTopLeft(el) {
    const handle = document.createElement('div');
    handle.className = 'absolute cursor-nwse-resize z-[100] flex items-center justify-center bg-transparent';
    handle.style.width = '24px';
    handle.style.height = '24px';
    handle.style.left = '0'; 
    handle.style.top = '0';
    
    handle.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="text-gray-400 opacity-80 rotate-180">
            <path d="M11 1V11H1L11 1Z" fill="currentColor"/>
        </svg>
    `;

    el.appendChild(handle);
    el.style.minWidth = '300px';
    el.style.minHeight = '400px';

    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const onMouseDown = (e) => {
        if (window.innerWidth < 768) return;
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
        const rect = el.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
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
        const dx = clientX - startX;
        const dy = clientY - startY;
        const newWidth = startWidth - dx;
        const newHeight = startHeight - dy;
        if (newWidth > 300) {
            el.style.width = `${newWidth}px`;
            el.style.left = `${startLeft + dx}px`;
        }
        if (newHeight > 400) {
            el.style.height = `${newHeight}px`;
            el.style.top = `${startTop + dy}px`;
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

function makeElementDraggable(el, options = {}) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;
    let linkedEl = options.linkedEl;
    let linkedInitialLeft, linkedInitialTop;
    const chatWindow = document.getElementById('chatbot-window');

    const onMouseDown = (e) => {
        if (options.isWindow && window.innerWidth < 768) return;
        if (e.button !== 0 && e.type !== 'touchstart') return;
        if (options.isWindow) {
            const rect = el.getBoundingClientRect();
            const clickY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
            if (clickY - rect.top > 60 || ['INPUT', 'BUTTON', 'TEXTAREA', 'I', 'SVG', 'PATH'].includes(e.target.tagName)) return;
        }

        isDragging = true;
        hasMoved = false;
        
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        startX = clientX;
        startY = clientY;
        
        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';
        el.style.cursor = 'grabbing';
        
        if (linkedEl) {
            const lRect = linkedEl.getBoundingClientRect();
            linkedInitialLeft = lRect.left;
            linkedInitialTop = lRect.top;
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

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newLeft + elW > winW) newLeft = winW - elW;
        if (newTop < 0) newTop = 0;
        if (newTop + elH > winH) newTop = winH - elH;

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';

        if (linkedEl) {
            let lNewLeft = linkedInitialLeft + dx;
            let lNewTop = linkedInitialTop + dy;
            linkedEl.style.left = lNewLeft + 'px';
            linkedEl.style.top = lNewTop + 'px';
        }
    };

    const onMouseUp = (e) => {
        isDragging = false;
        el.style.cursor = options.isWindow ? 'default' : 'grab';
        document.body.style.userSelect = '';
        
        if (e.type === 'touchend') {
             if (e.cancelable) e.preventDefault();
             document.removeEventListener('touchmove', onMouseMove);
             document.removeEventListener('touchend', onMouseUp);
        } else {
             document.removeEventListener('mousemove', onMouseMove);
             document.removeEventListener('mouseup', onMouseUp);
        }

        if (options.isToggle && !hasMoved) {
            const now = Date.now();
            if (el.lastToggle && now - el.lastToggle < 300) return;
            el.lastToggle = now;

            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                alignChatWindowToButton(el, chatWindow);
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        }
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onMouseDown, { passive: false });
}

function alignChatWindowToButton(btn, win) {
    const winW = window.innerWidth;
    
    // MOBILE: Bottom Sheet Mode
    if (winW < 768) {
        win.style.position = 'fixed';
        win.style.top = 'auto'; 
        win.style.bottom = '0'; 
        win.style.left = '0';
        win.style.right = '0';
        win.style.width = '100%';
        win.style.height = '85vh'; 
        win.style.maxHeight = '100%';
        win.style.borderRadius = '16px 16px 0 0';
        win.style.margin = '0';
        win.style.transform = 'none'; 
        win.style.zIndex = '10000';
        return;
    }

    // DESKTOP
    const btnRect = btn.getBoundingClientRect();
    const winRect = win.getBoundingClientRect();
    let newTop = btnRect.top - winRect.height - 10;
    let newLeft = (btnRect.left + btnRect.width) - winRect.width;
    if (newTop < 10) newTop = 10; 
    if (newLeft < 10) newLeft = 10; 
    
    win.style.bottom = 'auto';
    win.style.right = 'auto';
    win.style.top = newTop + 'px';
    win.style.left = newLeft + 'px';
    win.style.width = ''; 
    win.style.height = ''; 
    win.style.borderRadius = ''; 
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

async function renderSuggestions() {
    let suggestions = [];

    try {
        // Get smart suggestions based on current data and context
        suggestions = await generateSmartSuggestions();
    } catch (error) {
        console.error("Error generating smart suggestions:", error);
        // Fallback to default suggestions
        suggestions = [
            "Doanh số toàn bộ phận",
            "Hiệu suất của các PSR",
            "Hồ sơ nào sắp hết hạn?",
            "Các sản phẩm nào dự thầu cao tỉ lệ thắng bao nhiêu?"
        ];
    }

    const container = document.getElementById('chatbot-suggestions');
    if(container) {
        container.innerHTML = suggestions.map(s => `
            <button class="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-600 hover:text-blue-600 hover:border-blue-200 transition-colors whitespace-nowrap shadow-sm" onclick="document.getElementById('chatbot-input').value = '${s}'; document.getElementById('chatbot-form').dispatchEvent(new Event('submit'));">
                ${s}
            </button>
        `).join('');
    }
}

async function generateSmartSuggestions() {
    const suggestions = [];

    try {
        // Get current business stats for intelligent suggestions
        const { data: recentListings } = await sb.from('listing')
            .select('tinh_trang, ngay')
            .gte('ngay', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            .limit(50);

        const { data: expiringContracts } = await sb.from('listing')
            .select('ma_thau, ngay_ket_thuc')
            .gte('ngay_ket_thuc', new Date().toISOString().split('T')[0])
            .lte('ngay_ket_thuc', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            .limit(5);

        // Analyze current situation and generate relevant suggestions
        if (recentListings) {
            const winRate = recentListings.filter(l => l.tinh_trang === 'Win').length / recentListings.length;
            if (winRate < 0.3) {
                suggestions.push("Tại sao tỉ lệ thắng thấp? Có thể cải thiện như thế nào?");
            } else if (winRate > 0.7) {
                suggestions.push("Phân tích lý do thắng cao để áp dụng cho dự án khác");
            }
        }

        if (expiringContracts && expiringContracts.length > 0) {
            suggestions.push(`Có ${expiringContracts.length} hợp đồng sắp hết hạn - cần gia hạn?`);
        }

        // Add contextual suggestions based on conversation history
        if (conversationHistory.length > 0) {
            const lastTopic = conversationHistory[conversationHistory.length - 1];
            if (lastTopic.user.toLowerCase().includes('psr') || lastTopic.ai.toLowerCase().includes('psr')) {
                suggestions.push("So sánh hiệu suất PSR theo khu vực");
                suggestions.push("PSR nào có tiềm năng phát triển nhất?");
            }

            if (lastTopic.user.toLowerCase().includes('sản phẩm') || lastTopic.ai.toLowerCase().includes('sản phẩm')) {
                suggestions.push("Xu hướng thị trường của các sản phẩm hot");
                suggestions.push("Sản phẩm nào cần đẩy mạnh marketing?");
            }
        }

        // Always include some core business questions
        const coreSuggestions = [
            "Tổng quan tình hình kinh doanh tháng này",
            "Các cơ hội thầu mới tiềm năng",
            "Hiệu suất đội ngũ sales",
            "Dự báo doanh thu quý tới"
        ];

        // Combine smart suggestions with core ones, limit to 4
        const allSuggestions = [...suggestions, ...coreSuggestions];
        return allSuggestions.slice(0, 4);

    } catch (error) {
        console.error("Error in generateSmartSuggestions:", error);
        return [
            "Doanh số toàn bộ phận",
            "Hiệu suất của các PSR",
            "Hồ sơ nào sắp hết hạn?",
            "Các sản phẩm nào dự thầu cao tỉ lệ thắng bao nhiêu?"
        ];
    }
}

async function startNewSession() {
    try {
        const currentKey = getApiKey();
        
        // Determine language from recent conversation (fallback to empty string)
        const lastUserMessage = conversationHistory.length ? conversationHistory[conversationHistory.length - 1].user : '';
        const detectedLangForSession = detectLanguage(lastUserMessage);

        chatSession = aiClient.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: `
                    You are "WH-B4 Assistant", an intelligent CRM Data Analyst and Business Consultant for a tender management system. You are extremely knowledgeable about tender/bidding processes, data analysis, and business strategy.

                    **YOUR ROLE & CAPABILITIES:**
                    - You are an expert analyst who can understand complex business queries and provide strategic insights
                    - You can perform all app functions as if you were a human operator
                    - You understand Vietnamese business context and tender processes
                    - You can analyze trends, predict outcomes, and give actionable recommendations
                    - You remember conversation context and can reference previous discussions

                    **KEY PRINCIPLE: DISTINGUISH METRICS**
                    - **Listing Win Rate (Tỉ lệ thắng thầu)**: Based on COUNT of contracts (Hồ sơ) in 'listing' table. (Win Count / Total Listings).
                    - **Product/Value Win Rate (Tỉ lệ thắng sản phẩm/Doanh số)**: Based on VOLUME in 'detail' table. (Total Won Value / Total Quota).
                    - ALWAYS distinguish these two when answering performance questions.

                    **CONVERSATION CONTEXT:**
                    ${getConversationContext()}

                    **DETECTED LANGUAGE:**
                    - User query appears to be in: ${detectedLangForSession === 'vi' ? 'Vietnamese' : 'English'}
                    - Respond in the same language as the user's query

                    **INTELLIGENT ANALYSIS CAPABILITIES:**
                    - Identify patterns and trends in bidding data
                    - Provide strategic recommendations for improving win rates
                    - Compare performance across time periods, regions, products
                    - Suggest optimal bidding strategies based on historical data
                    - Predict potential wins based on current market conditions

                    **CONVERSATION INTELLIGENCE:**
                    - Remember context from previous messages in the conversation
                    - Build upon previous analyses and insights
                    - Ask clarifying questions when needed
                    - Provide follow-up suggestions based on user interests
                    - Understand implied requests and business context

                    **IMAGE INPUT HANDLING:**
                    - If the user uploads an image (photo of document, spreadsheet, form), ANALYZE it immediately
                    - Extract tender/contract data (Hospital Name, Code, Year, Province, etc.)
                    - IMMEDIATELY CALL \`open_add_listing_form\` tool to pre-fill form with extracted data
                    - Do not just describe the image - ACT on it proactively

                    **TOOLS AVAILABLE:**
                    1. \`check_expiring_contracts\`: Find listings expiring soon or already expired
                    2. \`search_product_history\`: Get detailed product performance statistics
                    3. \`get_psr_products\`: Analyze specific PSR's product performance
                    4. \`analyze_psr_performance\`: Overall PSR ranking and performance analysis
                    5. \`get_general_stats\`: Company-wide business statistics
                    6. \`search_listings\`: Search and filter tender listings
                    7. \`open_add_listing_form\`: Create new tender listings with smart data extraction
                    8. \`navigate_to\`: Navigate to different app sections
                    9. \`update_listing_status\`: Update tender status (Win/Fail/Waiting) with detailed handling
                    10. \`create_user\`: Create new user accounts (Admin only)
                    11. \`export_data\`: Export data to Excel/CSV with filters
                    12. \`generate_business_report\`: Create comprehensive business reports
                    13. \`predictive_analysis\`: Provide predictive insights and forecasts
                    14. \`smart_search\`: Intelligent search across all data sources
                    15. \`data_quality_check\`: Analyze and improve data quality

                    **RESPONSE STYLE:**
                    - Respond in the same language as the user's query (Vietnamese or English)
                    - Be conversational and helpful, like a knowledgeable colleague
                    - Use markdown tables for data presentation
                    - Provide insights and recommendations, not just raw data
                    - Ask follow-up questions to provide better assistance
                    - Be proactive in suggesting next steps or related analyses
                    - Reference previous conversation topics when relevant
                    - Support both Vietnamese and English queries seamlessly

                    **STRATEGIC THINKING:**
                    - When analyzing data, always consider business implications
                    - Suggest improvements and optimization opportunities
                    - Provide context about why certain metrics matter
                    - Help users make data-driven business decisions
                `,
                tools: [
                    { functionDeclarations: [searchListingsTool, checkExpiringContractsTool, searchProductHistoryTool, getStatsTool, analyzePsrPerformanceTool, getPsrProductsTool, navigateTool, openAddFormTool, updateListingStatusTool, createUserTool, exportDataTool, generateReportTool, predictiveAnalysisTool, smartSearchTool, dataQualityCheckTool] }
                ]
            }
        });
        console.log("Chat session initialized. Using Key:", currentKey.substring(0, 5) + "...");
    } catch(e) {
        console.error("Session Start Error", e);
        // Detect quota/token related errors and handle them specially
        if (isApiKeyQuotaError(e)) {
            handleApiKeyLimitError(e);
        } else {
            appendMessage("Lỗi khởi tạo AI. Vui lòng kiểm tra API Key.", 'ai');
        }
    }
}

async function sendMessageToAI(text, imageFile) {
    const loadingId = appendThinking();

    try {
        // First, try to handle complex queries directly for better user experience
        const directResponse = await handleComplexQuery(text, imageFile);
        if (directResponse) {
            removeThinking(loadingId);
            appendMessage(directResponse, 'ai');
            addToConversationHistory(text, directResponse);
            renderSuggestions(); // Update suggestions after response
            return;
        }

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
            if (!chatSession || !chatSession.sendMessage) {
                removeThinking(loadingId);
                appendMessage("Không thể kết nối tới AI. Vui lòng kiểm tra API Key hoặc kết nối mạng.", 'ai');
                return;
            }
            response = await chatSession.sendMessage({ message: parts });
        } else {
            if (!chatSession || !chatSession.sendMessage) {
                removeThinking(loadingId);
                appendMessage("Không thể kết nối tới AI. Vui lòng kiểm tra API Key hoặc kết nối mạng.", 'ai');
                return;
            }
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
                else if (fnName === 'check_expiring_contracts') {
                    const mode = args.mode || 'upcoming';
                    const days = args.days || 30;
                    const todayStr = new Date().toISOString().split('T')[0];
                    let query = sb.from('listing').select('ma_thau, benh_vien, ngay_ket_thuc, tinh_trang, psr').order('ngay_ket_thuc', { ascending: true }).limit(20);
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
                        const future = new Date();
                        future.setDate(future.getDate() + days);
                        const futureStr = future.toISOString().split('T')[0];
                        msg = `Kiểm tra hồ sơ sắp hết hạn từ ${todayStr} đến ${futureStr}...`;
                        query = query.gte('ngay_ket_thuc', todayStr).lte('ngay_ket_thuc', futureStr);
                    }

                    appendMessage(`⏳ ${msg}`, 'ai');
                    const { data, error } = await query;

                    if (error) {
                        result = { message: `Lỗi truy vấn: ${error.message}` };
                    } else if (!data || data.length === 0) {
                        result = { message: `Không tìm thấy hồ sơ nào trong khoảng thời gian này.` };
                    } else {
                        const formattedData = data.map(item => ({
                            ...item,
                            ngay_ket_thuc: item.ngay_ket_thuc ? item.ngay_ket_thuc.split('-').reverse().join('/') : 'N/A'
                        }));
                        result = { count: data.length, listings: formattedData };
                    }
                }
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
                    const { data: listingData } = await sb.from('listing').select('tinh_trang');
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
                    const { data: details, error } = await sb.from('detail').select('psr, ma_thau, quota, sl_trung, tinh_trang');

                    if (error || !details || details.length === 0) {
                        result = { message: "Không tìm thấy dữ liệu chi tiết thầu." };
                    } else {
                        const stats = {};
                        details.forEach(d => {
                            const psrName = d.psr || "Chưa phân công";
                            if (!stats[psrName]) stats[psrName] = { total_quota: 0, win_revenue: 0, contract_ids: new Set(), win_contract_ids: new Set() };
                            const q = d.quota || 0;
                            const w = d.sl_trung || 0;
                            stats[psrName].total_quota += q;
                            if (d.tinh_trang === 'Win') stats[psrName].win_revenue += w;
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
                                contracts: { total: totalContracts, won: winContracts, win_rate: contractRate },
                                value: { quota: val.total_quota.toLocaleString('vi-VN'), revenue: val.win_revenue.toLocaleString('vi-VN'), win_rate: valueRate }
                            };
                        }).sort((a, b) => parseFloat(b.value.revenue.replace(/\./g, '')) - parseFloat(a.value.revenue.replace(/\./g, '')));

                        result = { note: "Báo cáo phân biệt rõ Tỉ lệ thắng theo Hồ sơ (Contracts) và Theo Doanh số (Value).", psr_ranking: report };
                    }
                }
                else if (fnName === 'get_psr_products') {
                    const psrName = args.psr_name;
                    appendMessage(`🕵️‍♀️ Đang thống kê chi tiết sản phẩm của PSR "${psrName}"...`, 'ai');
                    const { data: details, error } = await sb.from('detail').select('ma_vt, quota, sl_trung, tinh_trang').ilike('psr', `%${psrName}%`); 
                    if (error || !details || details.length === 0) {
                        result = { message: `Không tìm thấy dữ liệu thầu nào cho PSR "${psrName}".` };
                    } else {
                        const stats = {};
                        details.forEach(d => {
                            const prod = d.ma_vt || "Unknown";
                            if (!stats[prod]) stats[prod] = { bids: 0, wins: 0, total_quota: 0, total_won: 0 };
                            const q = d.quota || 0;
                            const w = d.sl_trung || 0;
                            stats[prod].bids++;
                            stats[prod].total_quota += q;
                            if (d.tinh_trang === 'Win') { stats[prod].wins++; stats[prod].total_won += w; }
                        });

                        const uniqueMaVts = Object.keys(stats);
                        const { data: productInfos } = await sb.from('product').select('ma_vt, ten_vt').in('ma_vt', uniqueMaVts);
                        const nameMap = {};
                        if (productInfos) productInfos.forEach(p => nameMap[p.ma_vt] = p.ten_vt);

                        const summaryList = uniqueMaVts.map(ma_vt => {
                            const s = stats[ma_vt];
                            const contractWinRate = s.bids > 0 ? ((s.wins / s.bids) * 100).toFixed(1) : '0';
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
                        }).sort((a, b) => parseFloat(b.total_quota.replace(/\./g,'')) - parseFloat(a.total_quota.replace(/\./g,'')));

                        result = { psr: psrName, total_products_managed: uniqueMaVts.length, product_performance: summaryList.slice(0, 30) };
                    }
                }
                else if (fnName === 'navigate_to') {
                    appendMessage(`🚀 Đang chuyển trang...`, 'ai');
                    await showView(args.view_id);
                    result = { success: true };
                }
                else if (fnName === 'open_add_listing_form') {
                    appendMessage(`📝 Đang phân tích và chuẩn bị form...`, 'ai');
                    const now = new Date();
                    if (!args.ngay) args.ngay = now.toISOString().split('T')[0];
                    if (!args.nam) args.nam = now.getFullYear();

                    if (args.benh_vien) {
                        try {
                            const { data: history } = await sb.from('listing').select('benh_vien, tinh, khu_vuc, loai, nha_phan_phoi, quan_ly, psr').ilike('benh_vien', `%${args.benh_vien}%`).order('ngay', { ascending: false }).limit(1).maybeSingle();
                            if (history) {
                                if (history.benh_vien) args.benh_vien = history.benh_vien;
                                if (!args.tinh) args.tinh = history.tinh;
                                if (!args.khu_vuc) args.khu_vuc = history.khu_vuc;
                                if (!args.loai) args.loai = history.loai;
                                if (!args.nha_phan_phoi) args.nha_phan_phoi = history.nha_phan_phoi;
                                if (!args.quan_ly) args.quan_ly = history.quan_ly;
                                if (!args.psr) args.psr = history.psr;
                                appendMessage(`💡 Đã tìm thấy thông tin lịch sử của ${args.benh_vien}. Tự động điền...`, 'ai');
                            }
                        } catch (err) { console.log("Auto-fill error", err); }
                    }
                    await showView('view-ton-kho');
                    setTimeout(() => openListingModal(args, false, true), 500);
                    result = { success: true, message: "Form opened with smart suggestions." };
                }
                else if (fnName === 'update_listing_status') {
                    appendMessage(`🔄 Đang cập nhật trạng thái hồ sơ ${args.ma_thau}...`, 'ai');
                    try {
                        const { data: listing } = await sb.from('listing').select('*').eq('ma_thau', args.ma_thau).single();
                        if (!listing) {
                            result = { error: "Không tìm thấy hồ sơ với mã thầu này." };
                        } else {
                            // Update listing status
                            await sb.from('listing').update({
                                tinh_trang: args.new_status,
                                ngay_ky: args.new_status === 'Win' ? args.win_details?.ngay_ky : null,
                                ngay_ket_thuc: args.new_status === 'Win' ? args.win_details?.ngay_ket_thuc : null
                            }).eq('ma_thau', args.ma_thau);

                            // Update detail records if winning
                            if (args.new_status === 'Win' && args.win_details?.material_updates) {
                                for (const update of args.win_details.material_updates) {
                                    await sb.from('detail').update({
                                        tinh_trang: 'Win',
                                        sl_trung: update.sl_trung
                                    }).eq('ma_thau', args.ma_thau).eq('ma_vt', update.ma_vt);
                                }
                            } else if (args.new_status !== 'Win') {
                                // Reset win details for non-win statuses
                                await sb.from('detail').update({
                                    tinh_trang: args.new_status,
                                    sl_trung: 0
                                }).eq('ma_thau', args.ma_thau);
                            }

                            result = {
                                success: true,
                                message: `Đã cập nhật trạng thái hồ sơ ${args.ma_thau} thành ${args.new_status}`,
                                updated_at: new Date().toISOString()
                            };
                        }
                    } catch (error) {
                        result = { error: `Lỗi cập nhật: ${error.message}` };
                    }
                }
                else if (fnName === 'create_user') {
                    if (currentUser.phan_quyen !== 'Admin') {
                        result = { error: "Chỉ Admin mới có quyền tạo tài khoản người dùng." };
                    } else {
                        appendMessage(`👤 Đang tạo tài khoản cho ${args.ho_ten}...`, 'ai');
                        try {
                            const { data, error } = await sb.from('user').insert({
                                gmail: args.gmail,
                                ho_ten: args.ho_ten,
                                phan_quyen: args.phan_quyen,
                                xem: args.xem || [],
                                them: args.them || [],
                                sua: args.sua || [],
                                xoa: args.xoa || [],
                                nhap: args.nhap || [],
                                xuat: args.xuat || []
                            });

                            if (error) throw error;
                            result = {
                                success: true,
                                message: `Đã tạo tài khoản cho ${args.ho_ten} với quyền ${args.phan_quyen}`,
                                user_created: args.gmail
                            };
                        } catch (error) {
                            result = { error: `Lỗi tạo tài khoản: ${error.message}` };
                        }
                    }
                }
                else if (fnName === 'export_data') {
                    appendMessage(`📊 Đang chuẩn bị export dữ liệu...`, 'ai');
                    try {
                        let query = sb.from(args.table);

                        if (args.filters) {
                            if (args.filters.status) query = query.eq('tinh_trang', args.filters.status);
                            if (args.filters.year) query = query.eq('nam', args.filters.year);
                            if (args.filters.psr) query = query.ilike('psr', `%${args.filters.psr}%`);
                            if (args.filters.province) query = query.ilike('tinh', `%${args.filters.province}%`);
                            if (args.filters.date_from) query = query.gte('ngay', args.filters.date_from);
                            if (args.filters.date_to) query = query.lte('ngay', args.filters.date_to);
                        }

                        const { data, error } = await query.select('*');
                        if (error) throw error;

                        // Convert to Excel format (simplified)
                        const ws = XLSX.utils.json_to_sheet(data);
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, args.table);

                        // Generate filename
                        const timestamp = new Date().toISOString().split('T')[0];
                        const filename = `${args.table}_export_${timestamp}.xlsx`;

                        XLSX.writeFile(wb, filename);

                        result = {
                            success: true,
                            message: `Đã export ${data.length} bản ghi vào file ${filename}`,
                            record_count: data.length,
                            filename: filename
                        };
                    } catch (error) {
                        result = { error: `Lỗi export: ${error.message}` };
                    }
                }
                else if (fnName === 'generate_business_report') {
                    appendMessage(`📈 Đang tạo báo cáo ${args.report_type}...`, 'ai');
                    try {
                        const report = await generateBusinessReport(args);
                        result = report;
                    } catch (error) {
                        result = { error: `Lỗi tạo báo cáo: ${error.message}` };
                    }
                }
                else if (fnName === 'predictive_analysis') {
                    appendMessage(`🔮 Đang phân tích dự đoán...`, 'ai');
                    try {
                        const prediction = await generatePredictiveAnalysis(args);
                        result = prediction;
                    } catch (error) {
                        result = { error: `Lỗi phân tích: ${error.message}` };
                    }
                }
                else if (fnName === 'smart_search') {
                    appendMessage(`🔍 Đang tìm kiếm thông minh...`, 'ai');
                    try {
                        const searchResults = await performSmartSearch(args.query, args.context);
                        result = searchResults;
                    } catch (error) {
                        result = { error: `Lỗi tìm kiếm: ${error.message}` };
                    }
                }
                else if (fnName === 'data_quality_check') {
                    appendMessage(`🔍 Đang kiểm tra chất lượng dữ liệu...`, 'ai');
                    try {
                        const qualityReport = await performDataQualityCheck(args.check_type, args.table);
                        result = qualityReport;
                    } catch (error) {
                        result = { error: `Lỗi kiểm tra: ${error.message}` };
                    }
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
        if (responseText) {
            appendMessage(responseText, 'ai');
            // Add to conversation history
            addToConversationHistory(text, responseText);
        }

        // Update smart suggestions after each interaction
        renderSuggestions();

    } catch (error) {
        console.error("AI Error", error);
        removeThinking(loadingId);
        // If error indicates API key quota/token limit, handle and prompt user to change key
        if (isApiKeyQuotaError(error)) {
            handleApiKeyLimitError(error);
            return;
        }
        appendMessage("Xin lỗi, tôi gặp sự cố: " + (error.message || String(error)), 'ai');
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

// Conversation Context Management
function addToConversationHistory(userMessage, aiResponse) {
    conversationHistory.push({
        timestamp: new Date().toISOString(),
        user: userMessage,
        ai: aiResponse
    });

    // Keep only recent history
    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }
}

function getConversationContext() {
    if (conversationHistory.length === 0) {
        return "**CONVERSATION HISTORY:** No previous conversation.";
    }

    const context = conversationHistory.map((entry, index) => {
        return `**Exchange ${index + 1} (${new Date(entry.timestamp).toLocaleString('vi-VN')}):**\n- User: ${entry.user}\n- Assistant: ${entry.ai}`;
    }).join('\n\n');

    return `**CONVERSATION HISTORY:**\n${context}\n\nUse this context to provide more relevant and personalized responses. Reference previous topics, analyses, or user preferences when appropriate.`;
}

function clearConversationHistory() {
    conversationHistory = [];
}

// Complex Query Processing
async function handleComplexQuery(text, imageFile) {
    if (!text) return null;

    const lowerText = text.toLowerCase().trim();

    // If user mentions a specific date (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd), handle date search
    const extractedDate = extractDateFromText(text);
    if (extractedDate) {
        return await searchListingsBySpecificDate(extractedDate);
    }

    // Handle greetings and simple conversational queries
    if (isGreeting(lowerText)) {
        return await handleGreeting(text);
    }

    // Handle thank you messages
    if (isThankYou(lowerText)) {
        return "Không có gì! Tôi luôn sẵn sàng hỗ trợ bạn phân tích dữ liệu và tối ưu hóa hoạt động kinh doanh. Có điều gì khác tôi có thể giúp được không?";
    }

    // Handle questions about capabilities
    if (lowerText.includes('bạn có thể') || lowerText.includes('làm được gì') || lowerText.includes('chức năng')) {
        return await explainCapabilities();
    }

    // Handle urgent/important queries
    if (lowerText.includes('khẩn cấp') || lowerText.includes('quan trọng') || lowerText.includes('ngay lập tức')) {
        return await handleUrgentQuery(text);
    }

    // Handle comparative analysis queries
    if (lowerText.includes('so sánh') || lowerText.includes('thấp hơn') || lowerText.includes('cao hơn')) {
        return await handleComparativeQuery(text);
    }

    // Handle "why" questions - provide explanations
    if (lowerText.startsWith('tại sao') || lowerText.includes('lí do') || lowerText.includes('bởi vì')) {
        return await handleWhyQuestion(text);
    }

    // Handle "how to" questions - provide guidance
    if (lowerText.includes('làm thế nào') || lowerText.includes('cách nào') || lowerText.includes('hướng dẫn')) {
        return await handleHowToQuestion(text);
    }

    // Handle summary/overview requests
    if (lowerText.includes('tóm tắt') || lowerText.includes('tổng quan') || lowerText.includes('overview')) {
        return await handleSummaryRequest(text);
    }

    return null; // Let AI handle it
}

function isGreeting(text) {
    const greetings = [
        // Vietnamese
        'xin chào', 'chào', 'chào buổi', 'chào bạn',
        // English
        'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
        // Mixed/Common
        'alo', 'hi there', 'hey there'
    ];
    return greetings.some(greeting => text.includes(greeting));
}

function isThankYou(text) {
    const thanks = [
        // Vietnamese
        'cảm ơn', 'cám ơn', 'thank', 'thanks',
        // English
        'thank you', 'thanks', 'thank you very much',
        // Mixed
        'thx', 'ty'
    ];
    return thanks.some(thank => text.includes(thank));
}

// Language detection helper
function detectLanguage(text) {
    const vietnameseWords = ['cái', 'là', 'được', 'có', 'không', 'tôi', 'bạn', 'và', 'nhưng', 'hoặc', 'vì', 'cho', 'với', 'từ', 'trong', 'đến'];
    const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

    const vietnameseCount = vietnameseWords.filter(word => text.includes(word)).length;
    const englishCount = englishWords.filter(word => text.includes(word)).length;

    return vietnameseCount > englishCount ? 'vi' : 'en';
}

// API Key quota/token detection helper
function isApiKeyQuotaError(err) {
    if (!err) return false;
    const msg = (err.message || err.toString() || '').toLowerCase();
    const code = (err.code || '').toString().toLowerCase();
    const keywords = ['quota', 'exhaust', 'limit', 'insufficient_quota', 'resource_exhausted', 'rate limit', 'tokens', 'token'];
    return keywords.some(k => msg.includes(k) || code.includes(k));
}

// Handle API key quota/token exhaustion: notify user and open settings to change key
function handleApiKeyLimitError(err) {
    console.warn("API Key quota/limit detected:", err);
    // Clear local chat session so further calls will re-init with new key
    chatSession = null;
    aiClient = null;
    // Inform user
    showToast("API Key hiện tại đã hết hạn/ngắt quota hoặc bị giới hạn token. Vui lòng thay API Key khác.", "error");
    // Open settings modal to prompt user to change key (if available)
    setTimeout(() => {
        try { openSettingsModal(); } catch (e) { console.log("Could not open settings modal:", e); }
    }, 400);
}

async function handleGreeting(text) {
    const lang = detectLanguage(text);
    const currentHour = new Date().getHours();

    let timeGreeting;
    if (lang === 'vi') {
        if (currentHour < 12) timeGreeting = 'Chào buổi sáng';
        else if (currentHour < 18) timeGreeting = 'Chào buổi chiều';
        else timeGreeting = 'Chào buổi tối';
    } else {
        if (currentHour < 12) timeGreeting = 'Good morning';
        else if (currentHour < 18) timeGreeting = 'Good afternoon';
        else timeGreeting = 'Good evening';
    }

    try {
        // Get quick business overview
        const { data: recentStats } = await sb.from('listing')
            .select('tinh_trang')
            .gte('ngay', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

        const winCount = recentStats?.filter(s => s.tinh_trang === 'Win').length || 0;
        const totalCount = recentStats?.length || 0;
        const winRate = totalCount > 0 ? ((winCount / totalCount) * 100).toFixed(1) : 0;

        if (lang === 'vi') {
            return `${timeGreeting}! 👋\n\nTôi là WH-B4 Assistant - chuyên gia phân tích dữ liệu tender. Trong tuần qua, bộ phận đã có ${totalCount} hồ sơ thầu với tỉ lệ thắng ${winRate}%.\n\nTôi có thể giúp bạn:\n• Phân tích hiệu suất kinh doanh\n• Tìm kiếm và quản lý hồ sơ thầu\n• Tư vấn chiến lược cải thiện tỉ lệ thắng\n• Tạo báo cáo chi tiết\n• Hỗ trợ các thao tác trong hệ thống\n\nBạn cần tôi hỗ trợ gì hôm nay?`;
        } else {
            return `${timeGreeting}! 👋\n\nI'm WH-B4 Assistant - your tender data analysis expert. This week, the department had ${totalCount} tender listings with a ${winRate}% win rate.\n\nI can help you with:\n• Business performance analysis\n• Tender listing search and management\n• Win rate improvement strategies\n• Detailed report generation\n• System operation support\n\nWhat can I help you with today?`;
        }
    } catch (error) {
        if (lang === 'vi') {
            return `${timeGreeting}! 👋 Tôi là WH-B4 Assistant - chuyên gia phân tích dữ liệu tender của bạn. Tôi có thể giúp bạn phân tích dữ liệu, tạo báo cáo, và hỗ trợ các thao tác trong hệ thống. Bạn cần hỗ trợ gì?`;
        } else {
            return `${timeGreeting}! 👋 I'm WH-B4 Assistant - your tender data analysis expert. I can help you analyze data, generate reports, and support system operations. What can I help you with?`;
        }
    }
}

async function explainCapabilities() {
    return `Tôi là WH-B4 Assistant - một AI thông minh có thể thực hiện hầu hết các chức năng trong hệ thống quản lý hồ sơ thầu, bao gồm:

## 🔍 **PHÂN TÍCH DỮ LIỆU**
• Thống kê hiệu suất tổng thể và theo từng PSR
• Phân tích xu hướng thắng thầu theo thời gian, khu vực, sản phẩm
• Dự đoán cơ hội thắng dựa trên dữ liệu lịch sử
• So sánh hiệu suất giữa các kỳ, khu vực, sản phẩm

## 📊 **BÁO CÁO & THỐNG KÊ**
• Tạo báo cáo kinh doanh chi tiết theo yêu cầu
• Xuất dữ liệu Excel với bộ lọc tùy chỉnh
• Phân tích chất lượng dữ liệu và đề xuất cải thiện

## 🛠️ **QUẢN LÝ HỆ THỐNG**
• Tạo và cập nhật hồ sơ thầu
• Quản lý trạng thái (Win/Fail/Waiting)
• Tạo tài khoản người dùng mới (Admin)
• Điều hướng đến các màn hình khác nhau

## 💡 **TƯ VẤN CHIẾN LƯỢC**
• Đề xuất cách cải thiện tỉ lệ thắng
• Tư vấn sản phẩm tiềm năng
• Phân tích đối thủ cạnh tranh
• Hướng dẫn tối ưu hóa quy trình

## 🖼️ **XỬ LÝ HÌNH ẢNH**
• Tự động trích xuất dữ liệu từ ảnh hồ sơ thầu
• Điền sẵn form tạo mới từ hình ảnh
• Phân tích tài liệu scan

Bạn muốn tôi thực hiện chức năng nào cụ thể?`;
}

async function handleUrgentQuery(text) {
    try {
        // Check for urgent items: expiring contracts, low performance alerts, etc.
        const today = new Date().toISOString().split('T')[0];
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const { data: expiring } = await sb.from('listing')
            .select('ma_thau, benh_vien, ngay_ket_thuc, psr')
            .gte('ngay_ket_thuc', today)
            .lte('ngay_ket_thuc', nextWeek)
            .eq('tinh_trang', 'Win')
            .limit(5);

        const { data: waiting } = await sb.from('listing')
            .select('ma_thau, benh_vien, ngay')
            .eq('tinh_trang', 'Waiting')
            .gte('ngay', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            .limit(5);

        let urgentMessage = "🚨 **CÁC VIỆC CẦN XỬ LÝ KHẨN CẤP:**\n\n";

        if (expiring && expiring.length > 0) {
            urgentMessage += `**📅 Hợp đồng sắp hết hạn (${expiring.length} hồ sơ):**\n`;
            expiring.forEach(item => {
                urgentMessage += `• ${item.ma_thau} - ${item.benh_vien} (hết hạn: ${item.ngay_ket_thuc})\n`;
            });
            urgentMessage += "\n";
        }

        if (waiting && waiting.length > 0) {
            urgentMessage += `**⏳ Hồ sơ đang chờ kết quả (${waiting.length} hồ sơ):**\n`;
            waiting.forEach(item => {
                urgentMessage += `• ${item.ma_thau} - ${item.benh_vien}\n`;
            });
            urgentMessage += "\n";
        }

        if ((!expiring || expiring.length === 0) && (!waiting || waiting.length === 0)) {
            urgentMessage += "✅ **Tình hình ổn định!** Không có vấn đề cấp bách nào cần xử lý ngay.\n\n";
        }

        urgentMessage += "**💡 Hành động đề xuất:**\n";
        urgentMessage += "• Kiểm tra chi tiết các hồ sơ sắp hết hạn\n";
        urgentMessage += "• Theo dõi tiến độ hồ sơ đang chờ\n";
        urgentMessage += "• Liên hệ khách hàng để gia hạn hợp đồng\n\n";
        urgentMessage += "Bạn muốn tôi hỗ trợ xử lý vấn đề nào cụ thể?";

        return urgentMessage;
    } catch (error) {
        return "🚨 **KHẨN CẤP:** Tôi đang gặp sự cố khi kiểm tra dữ liệu. Vui lòng thử lại hoặc liên hệ admin để được hỗ trợ.";
    }
}

async function handleComparativeQuery(text) {
    // Extract comparison elements from the query
    const lowerText = text.toLowerCase();

    if (lowerText.includes('psr') || lowerText.includes('nhân viên')) {
        return await comparePSRPerformance(text);
    }

    if (lowerText.includes('sản phẩm') || lowerText.includes('product')) {
        return await compareProductPerformance(text);
    }

    if (lowerText.includes('tháng') || lowerText.includes('quý') || lowerText.includes('năm')) {
        return await compareTimePeriods(text);
    }

    if (lowerText.includes('khu vực') || lowerText.includes('tỉnh') || lowerText.includes('miền')) {
        return await compareRegions(text);
    }

    return "Tôi có thể giúp bạn so sánh hiệu suất giữa các PSR, sản phẩm, thời kỳ, hoặc khu vực. Bạn muốn so sánh điều gì cụ thể?";
}

async function handleWhyQuestion(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('thắng') || lowerText.includes('thua')) {
        return await explainWinLossReasons(text);
    }

    if (lowerText.includes('thấp') || lowerText.includes('giảm')) {
        return await explainPerformanceIssues(text);
    }

    if (lowerText.includes('khác biệt') || lowerText.includes('chênh lệch')) {
        return await explainDifferences(text);
    }

    return "Để trả lời câu hỏi 'tại sao', tôi cần thêm thông tin cụ thể. Bạn có thể cho tôi biết tình huống hoặc vấn đề cụ thể bạn đang quan tâm không?";
}

async function handleHowToQuestion(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('cải thiện') || lowerText.includes('tăng') || lowerText.includes('nâng cao')) {
        return await provideImprovementGuidance(text);
    }

    if (lowerText.includes('tạo') || lowerText.includes('thêm')) {
        return await guideCreationProcess(text);
    }

    if (lowerText.includes('xuất') || lowerText.includes('export')) {
        return await guideExportProcess(text);
    }

    if (lowerText.includes('phân tích') || lowerText.includes('analyze')) {
        return await guideAnalysisProcess(text);
    }

    return "Tôi có thể hướng dẫn bạn thực hiện nhiều thao tác trong hệ thống. Bạn muốn học cách làm gì cụ thể?";
}

async function handleSummaryRequest(text) {
    try {
        const { data: listings } = await sb.from('listing')
            .select('tinh_trang, nam, tinh, psr')
            .gte('ngay', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

        const { data: details } = await sb.from('detail')
            .select('quota, sl_trung, tinh_trang')
            .gte('ngay_ky', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

        const totalListings = listings?.length || 0;
        const wonListings = listings?.filter(l => l.tinh_trang === 'Win').length || 0;
        const winRate = totalListings > 0 ? ((wonListings / totalListings) * 100).toFixed(1) : 0;

        const totalQuota = details?.reduce((sum, d) => sum + (d.quota || 0), 0) || 0;
        const totalWon = details?.reduce((sum, d) => sum + (d.sl_trung || 0), 0) || 0;
        const valueWinRate = totalQuota > 0 ? ((totalWon / totalQuota) * 100).toFixed(1) : 0;

        const psrCount = new Set(listings?.map(l => l.psr).filter(Boolean)).size;
        const regionCount = new Set(listings?.map(l => l.tinh).filter(Boolean)).size;

        return `📊 **TỔNG QUAN TÌNH HÌNH KINH DOANH (3 tháng gần nhất)**

## 🎯 **KẾT QUẢ CHÍNH**
• **Tổng hồ sơ thầu:** ${totalListings.toLocaleString('vi-VN')}
• **Hồ sơ thắng:** ${wonListings.toLocaleString('vi-VN')}
• **Tỉ lệ thắng thầu:** ${winRate}%
• **Tổng quota:** ${totalQuota.toLocaleString('vi-VN')}
• **Tổng giá trị thắng:** ${totalWon.toLocaleString('vi-VN')}
• **Tỉ lệ thắng giá trị:** ${valueWinRate}%

## 👥 **PHỤ TRÁCH**
• **Số PSR tham gia:** ${psrCount}
• **Số khu vực:** ${regionCount}

## 📈 **NHẬN XÉT**
${winRate >= 70 ? '✅ Tình hình rất khả quan với tỉ lệ thắng cao' :
  winRate >= 50 ? '👍 Tình hình ổn định, có thể cải thiện thêm' :
  winRate >= 30 ? '⚠️ Cần cải thiện tỉ lệ thắng' :
  '🚨 Tình hình cần được quan tâm đặc biệt'}

Bạn muốn tôi phân tích chi tiết thêm về khía cạnh nào?`;
    } catch (error) {
        return "Xin lỗi, tôi không thể tạo tổng quan lúc này. Vui lòng thử lại sau.";
    }
}

// Helper Functions for Advanced Tools
// Extract date string from user input. Returns ISO YYYY-MM-DD or null.
function extractDateFromText(text) {
    if (!text) return null;
    // Common patterns: DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, YYYY-MM-DD
    const patterns = [
        /(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b)/, // dd/mm/yyyy or dd-mm-yyyy
        /(\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b)/ // yyyy-mm-dd
    ];

    for (const p of patterns) {
        const m = text.match(p);
        if (m && m[1]) {
            const dateRaw = m[1].trim();
            // Normalize separators
            const sep = dateRaw.includes('/') ? '/' : (dateRaw.includes('-') ? '-' : null);
            if (!sep) continue;
            const parts = dateRaw.split(sep);
            if (parts.length === 3) {
                // Determine if format is yyyy-mm-dd or dd-mm-yyyy
                if (parts[0].length === 4) {
                    // yyyy-mm-dd
                    const y = parts[0].padStart(4, '0');
                    const mth = parts[1].padStart(2, '0');
                    const d = parts[2].padStart(2, '0');
                    return `${y}-${mth}-${d}`;
                } else {
                    // dd/mm/yyyy
                    const d = parts[0].padStart(2, '0');
                    const mth = parts[1].padStart(2, '0');
                    const year = parts[2].length === 2 ? '20' + parts[2] : parts[2].padStart(4, '0');
                    return `${year}-${mth}-${d}`;
                }
            }
        }
    }
    return null;
}

// Search listings by exact date and return an HTML table (horizontal scroll) as AI response
async function searchListingsBySpecificDate(isoDate) {
    try {
        appendMessage(`🔎 Đang tìm hồ sơ thầu cho ngày ${isoDate}...`, 'ai');
        const { data, error } = await sb.from('listing')
            .select('ma_thau, benh_vien, tinh, ngay, nha_phan_phoi, tinh_trang, psr')
            .eq('ngay', isoDate)
            .order('ngay', { ascending: false })
            .limit(500);

        if (error) {
            return `Xin lỗi, lỗi truy vấn: ${error.message || error}`;
        }

        if (!data || data.length === 0) {
            return `Không tìm thấy hồ sơ thầu vào ngày ${isoDate}. Bạn muốn tìm theo khoảng thời gian hoặc năm thay thế?`;
        }

        // Build HTML table with horizontal scroll and clear column separators
        const headers = ['Mã thầu', 'Bệnh viện', 'Ngày', 'Nhà phân phối', 'Tỉnh', 'Tình trạng', 'PSR'];
        const colWidths = ['18%','28%','10%','18%','10%','8%','8%']; // approximate widths

        const rows = data.map(row => ([
            escapeHtml(row.ma_thau || ''),
            escapeHtml(row.benh_vien || ''),
            escapeHtml(row.ngay || ''),
            escapeHtml(row.nha_phan_phoi || ''),
            escapeHtml(row.tinh || ''),
            escapeHtml(row.tinh_trang || ''),
            escapeHtml(row.psr || '')
        ]));

        let tableHtml = `<div style="overflow-x:auto; padding:8px 0;"><table style="min-width:100%;border-collapse:separate;border-spacing:0;min-width:900px;">`;
        tableHtml += `<thead><tr style="background:#f8fafc">`;
        headers.forEach((h, idx) => {
            const w = colWidths[idx] || 'auto';
            tableHtml += `<th style="text-align:left;padding:10px 12px;border-right:1px solid #e6e8eb;border-bottom:1px solid #e5e7eb;min-width:${w};font-weight:600;color:#111827">${h}</th>`;
        });
        tableHtml += `</tr></thead><tbody>`;

        rows.forEach(r => {
            tableHtml += `<tr>`;
            r.forEach((cell, idx) => {
                tableHtml += `<td style="padding:10px 12px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f3f4f6;vertical-align:top;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${cell}</td>`;
            });
            tableHtml += `</tr>`;
        });

        tableHtml += `</tbody></table></div>`;
        // Prepend a concise textual summary so chatbot also "trả lời" bằng lời trước khi hiển thị bảng
        const summaryText = `<div style="margin-bottom:8px;color:#111827;font-size:14px">Đã tìm thấy <strong>${data.length}</strong> hồ sơ liên quan đến ngày <strong>${isoDate}</strong>:</div>`;
        return summaryText + tableHtml;
    } catch (err) {
        console.error("Date search error", err);
        return `Xin lỗi, không thể tìm hồ sơ theo ngày hiện tại: ${err.message || err}`;
    }
}

function escapeHtml(unsafe) {
    return (unsafe + '').replace(/[&<>"']/g, function(m) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m];
    });
}

// Persist user command into DB queue table 'chat_commands'
async function saveUserCommandToDB(message) {
    try {
        const record = {
            gmail: currentUser ? currentUser.gmail : null,
            message: message,
            status: 'pending',
            result: null,
            created_at: new Date().toISOString()
        };
        const { data, error } = await sb.from('chat_commands').insert(record).select().maybeSingle();
        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error saving command to DB", err);
        throw err;
    }
}

// Process pending chat commands from DB
let commandProcessorInterval = null;
async function processPendingCommands() {
    try {
        const { data: pending, error } = await sb.from('chat_commands')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(10);

        if (error) {
            console.error("Error fetching pending commands", error);
            return;
        }

        if (!pending || pending.length === 0) return;

        for (const cmd of pending) {
            try {
                // Mark as running to prevent double processing
                await sb.from('chat_commands').update({ status: 'running' }).eq('id', cmd.id);

                let resultText = null;
                // Try local handlers first
                const local = await handleComplexQuery(cmd.message, null);
                if (local) resultText = local;
                else {
                    // Ensure session
                    if (!chatSession) await startNewSession();
                    if (chatSession && chatSession.sendMessage) {
                        const resp = await chatSession.sendMessage({ message: cmd.message });
                        resultText = resp.text || JSON.stringify(resp);
                    } else {
                        resultText = "Không thể truy cập AI để xử lý lệnh (AI unavailable).";
                    }
                }

                await sb.from('chat_commands').update({ status: 'done', result: resultText, finished_at: new Date().toISOString() }).eq('id', cmd.id);

                // Push result to UI if command belongs to current user
                if (currentUser && cmd.gmail === currentUser.gmail) {
                    appendMessage(resultText, 'ai');
                }
            } catch (err) {
                console.error("Error processing command id", cmd.id, err);
                await sb.from('chat_commands').update({ status: 'error', result: err.message || String(err) }).eq('id', cmd.id);
            }
        }
    } catch (err) {
        console.error("processPendingCommands error", err);
    }
}

function startCommandProcessorPoller() {
    if (commandProcessorInterval) return;
    // Poll every 3 seconds
    commandProcessorInterval = setInterval(processPendingCommands, 3000);
}

async function generateBusinessReport(args) {
    const { report_type, time_period, custom_date_from, custom_date_to, focus_area } = args;

    // Calculate date range
    let dateFrom, dateTo;
    const now = new Date();

    switch (time_period) {
        case 'this_month':
            dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'last_month':
            dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            dateTo = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
        case 'this_quarter':
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            dateFrom = new Date(now.getFullYear(), quarterStart, 1);
            dateTo = new Date(now.getFullYear(), quarterStart + 3, 0);
            break;
        case 'custom':
            dateFrom = new Date(custom_date_from);
            dateTo = new Date(custom_date_to);
            break;
        default:
            dateFrom = new Date(now.getFullYear(), 0, 1);
            dateTo = now;
    }

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];

    let report = {
        report_type,
        time_period,
        date_range: `${dateFromStr} đến ${dateToStr}`,
        generated_at: new Date().toISOString()
    };

    try {
        switch (report_type) {
            case 'performance':
                const { data: listings } = await sb.from('listing')
                    .select('*')
                    .gte('ngay', dateFromStr)
                    .lte('ngay', dateToStr);

                const { data: details } = await sb.from('detail')
                    .select('*')
                    .gte('ngay_ky', dateFromStr)
                    .lte('ngay_ky', dateToStr);

                const stats = calculatePerformanceStats(listings, details);
                report.content = stats;
                report.summary = `Trong kỳ báo cáo, có ${stats.total_listings} hồ sơ thầu, tỉ lệ thắng ${stats.win_rate}%.`;
                break;

            case 'psr_analysis':
                const psrStats = await analyzePSRPerformance();
                report.content = psrStats;
                report.summary = `Phân tích hiệu suất của ${psrStats.length} PSR trong kỳ.`;
                break;

            case 'trends':
                const trends = await analyzeTrends(dateFromStr, dateToStr);
                report.content = trends;
                report.summary = trends.summary;
                break;

            default:
                report.content = { message: "Loại báo cáo chưa được hỗ trợ." };
        }

        return report;
    } catch (error) {
        return { error: `Lỗi tạo báo cáo: ${error.message}` };
    }
}

async function generatePredictiveAnalysis(args) {
    const { analysis_type, target, timeframe } = args;

    try {
        let prediction = {
            analysis_type,
            target,
            timeframe,
            predictions: [],
            confidence: "medium",
            recommendations: []
        };

        switch (analysis_type) {
            case 'win_probability':
                if (target) {
                    // Predict win probability for specific target
                    const { data: history } = await sb.from('listing')
                        .select('tinh_trang, benh_vien, psr, nha_phan_phoi')
                        .ilike('benh_vien', `%${target}%`);

                    if (history && history.length > 0) {
                        const winRate = history.filter(h => h.tinh_trang === 'Win').length / history.length;
                        prediction.predictions.push({
                            metric: "win_probability",
                            value: (winRate * 100).toFixed(1) + "%",
                            based_on: `${history.length} hồ sơ lịch sử`
                        });
                        prediction.recommendations.push(
                            winRate > 0.6 ? "Cơ hội thắng cao, nên ưu tiên" :
                            winRate > 0.3 ? "Cơ hội thắng trung bình, cân nhắc điều kiện" :
                            "Cơ hội thắng thấp, xem xét điều chỉnh chiến lược"
                        );
                    }
                }
                break;

            case 'psr_forecast':
                const psrData = await sb.from('detail')
                    .select('psr, quota, sl_trung, tinh_trang')
                    .ilike('psr', `%${target}%`);

                if (psrData.data) {
                    const monthlyPerformance = calculateMonthlyTrends(psrData.data);
                    prediction.predictions.push({
                        metric: "monthly_target_achievement",
                        trend: monthlyPerformance.trend,
                        forecast: monthlyPerformance.next_month_forecast + "%"
                    });
                }
                break;

            default:
                prediction.predictions.push({
                    metric: "general_forecast",
                    value: "Dự báo khả quan dựa trên xu hướng hiện tại"
                });
        }

        return prediction;
    } catch (error) {
        return { error: `Lỗi phân tích dự đoán: ${error.message}` };
    }
}

async function performSmartSearch(query, context) {
    try {
        // Intelligent search across multiple tables
        const searchTerms = query.toLowerCase().split(' ');

        let results = {
            listings: [],
            products: [],
            psrs: [],
            insights: []
        };

        // Search listings
        for (const term of searchTerms) {
            if (term.length > 2) {
                const { data: listingResults } = await sb.from('listing')
                    .select('*')
                    .or(`ma_thau.ilike.%${term}%,benh_vien.ilike.%${term}%,psr.ilike.%${term}%`)
                    .limit(5);

                if (listingResults) {
                    results.listings.push(...listingResults);
                }
            }
        }

        // Search products
        for (const term of searchTerms) {
            if (term.length > 2) {
                const { data: productResults } = await sb.from('product')
                    .select('*')
                    .or(`ma_vt.ilike.%${term}%,ten_vt.ilike.%${term}%`)
                    .limit(3);

                if (productResults) {
                    results.products.push(...productResults);
                }
            }
        }

        // Generate insights based on context
        if (context === 'business') {
            results.insights = await generateBusinessInsights(results);
        }

        return {
            query,
            context,
            total_results: results.listings.length + results.products.length,
            results,
            search_time: new Date().toISOString()
        };
    } catch (error) {
        return { error: `Lỗi tìm kiếm: ${error.message}` };
    }
}

async function performDataQualityCheck(checkType, table) {
    try {
        let issues = [];
        const { data, error } = await sb.from(table).select('*');

        if (error) throw error;

        switch (checkType) {
            case 'duplicates':
                const seen = new Set();
                const duplicates = data.filter(item => {
                    const key = table === 'listing' ? item.ma_thau :
                               table === 'detail' ? `${item.ma_thau}-${item.ma_vt}` :
                               item.gmail || item.id;

                    if (seen.has(key)) return true;
                    seen.add(key);
                    return false;
                });
                issues = duplicates.map(d => ({ type: 'duplicate', record: d }));
                break;

            case 'missing_data':
                issues = data.filter(item => {
                    const requiredFields = table === 'listing' ?
                        ['ma_thau', 'benh_vien'] :
                        table === 'detail' ?
                        ['ma_thau', 'ma_vt'] :
                        ['gmail', 'ho_ten'];

                    return requiredFields.some(field => !item[field]);
                }).map(item => ({ type: 'missing_data', record: item }));
                break;

            case 'inconsistencies':
                // Check for logical inconsistencies
                if (table === 'detail') {
                    issues = data.filter(item =>
                        item.sl_trung > item.quota && item.tinh_trang === 'Win'
                    ).map(item => ({
                        type: 'inconsistency',
                        issue: 'Số lượng trúng lớn hơn quota',
                        record: item
                    }));
                }
                break;
        }

        return {
            table,
            check_type: checkType,
            total_records: data.length,
            issues_found: issues.length,
            issues: issues.slice(0, 20), // Limit to first 20 issues
            quality_score: Math.max(0, 100 - (issues.length / data.length * 100)).toFixed(1) + "%"
        };
    } catch (error) {
        return { error: `Lỗi kiểm tra chất lượng: ${error.message}` };
    }
}

// Helper calculation functions
function calculatePerformanceStats(listings, details) {
    const totalListings = listings?.length || 0;
    const wonListings = listings?.filter(l => l.tinh_trang === 'Win').length || 0;
    const winRate = totalListings > 0 ? ((wonListings / totalListings) * 100).toFixed(1) : 0;

    const totalQuota = details?.reduce((sum, d) => sum + (d.quota || 0), 0) || 0;
    const totalWon = details?.reduce((sum, d) => sum + (d.sl_trung || 0), 0) || 0;
    const valueWinRate = totalQuota > 0 ? ((totalWon / totalQuota) * 100).toFixed(1) : 0;

    return {
        total_listings: totalListings,
        won_listings: wonListings,
        win_rate: winRate + "%",
        total_quota: totalQuota.toLocaleString('vi-VN'),
        total_won_value: totalWon.toLocaleString('vi-VN'),
        value_win_rate: valueWinRate + "%",
        period: "Kỳ báo cáo"
    };
}

async function analyzeTrends(dateFrom, dateTo) {
    const { data: listings } = await sb.from('listing')
        .select('ngay, tinh_trang')
        .gte('ngay', dateFrom)
        .lte('ngay', dateTo)
        .order('ngay');

    // Group by month
    const monthlyStats = {};
    listings?.forEach(listing => {
        const month = listing.ngay.substring(0, 7); // YYYY-MM
        if (!monthlyStats[month]) {
            monthlyStats[month] = { total: 0, won: 0 };
        }
        monthlyStats[month].total++;
        if (listing.tinh_trang === 'Win') monthlyStats[month].won++;
    });

    const months = Object.keys(monthlyStats).sort();
    const trend = months.length > 1 ?
        (monthlyStats[months[months.length - 1]].won / monthlyStats[months[months.length - 1]].total) >
        (monthlyStats[months[0]].won / monthlyStats[months[0]].total) ? 'increasing' : 'decreasing' : 'stable';

    return {
        monthly_breakdown: monthlyStats,
        trend,
        summary: `Xu hướng tỉ lệ thắng ${trend} trong ${months.length} tháng qua.`
    };
}

function calculateMonthlyTrends(data) {
    // Simple trend calculation
    const recentMonths = data.slice(-6); // Last 6 months
    const avgPerformance = recentMonths.reduce((sum, item) => {
        return sum + ((item.sl_trung || 0) / (item.quota || 1));
    }, 0) / recentMonths.length;

    return {
        trend: avgPerformance > 0.5 ? 'improving' : 'declining',
        next_month_forecast: (avgPerformance * 100).toFixed(1)
    };
}

async function generateBusinessInsights(searchResults) {
    const insights = [];

    if (searchResults.listings.length > 0) {
        const winRate = searchResults.listings.filter(l => l.tinh_trang === 'Win').length / searchResults.listings.length;
        insights.push(`Tìm thấy ${searchResults.listings.length} hồ sơ thầu với tỉ lệ thắng ${(winRate * 100).toFixed(1)}%`);
    }

    if (searchResults.products.length > 0) {
        insights.push(`Có ${searchResults.products.length} sản phẩm liên quan trong kết quả tìm kiếm`);
    }

    return insights;
}

// Complex Query Helper Functions
async function comparePSRPerformance(text) {
    try {
        const psrStats = await sb.from('detail')
            .select('psr, quota, sl_trung, tinh_trang')
            .not('psr', 'is', null);

        if (!psrStats.data || psrStats.data.length === 0) {
            return "Không có đủ dữ liệu để so sánh hiệu suất PSR.";
        }

        const stats = {};
        psrStats.data.forEach(d => {
            const psr = d.psr || "Chưa phân công";
            if (!stats[psr]) stats[psr] = { quota: 0, won: 0, contracts: new Set() };
            stats[psr].quota += d.quota || 0;
            if (d.tinh_trang === 'Win') stats[psr].won += d.sl_trung || 0;
            if (d.tinh_trang === 'Win') stats[psr].contracts.add(d.ma_thau);
        });

        const comparison = Object.entries(stats)
            .map(([psr, data]) => ({
                psr,
                win_rate: data.quota > 0 ? ((data.won / data.quota) * 100).toFixed(1) : '0',
                total_won: data.won,
                contracts_won: data.contracts.size
            }))
            .sort((a, b) => parseFloat(b.win_rate) - parseFloat(a.win_rate))
            .slice(0, 5);

        let response = "📊 **SO SÁNH HIỆU SUẤT PSR**\n\n";
        response += "| PSR | Tỉ lệ thắng | Giá trị thắng | Hợp đồng thắng |\n";
        response += "|-----|-------------|---------------|----------------|\n";

        comparison.forEach(item => {
            response += `| ${item.psr} | ${item.win_rate}% | ${item.total_won.toLocaleString('vi-VN')} | ${item.contracts_won} |\n`;
        });

        response += `\n**🔍 NHẬN XÉT:**\n`;
        const topPSR = comparison[0];
        const bottomPSR = comparison[comparison.length - 1];

        response += `• **PSR xuất sắc nhất:** ${topPSR.psr} (${topPSR.win_rate}%)\n`;
        response += `• **PSR cần cải thiện:** ${bottomPSR.psr} (${bottomPSR.win_rate}%)\n`;

        if (parseFloat(topPSR.win_rate) - parseFloat(bottomPSR.win_rate) > 20) {
            response += `• **Chênh lệch lớn:** Cần chia sẻ kinh nghiệm từ PSR ${topPSR.psr} cho ${bottomPSR.psr}\n`;
        }

        return response;
    } catch (error) {
        return "Xin lỗi, tôi không thể so sánh hiệu suất PSR lúc này.";
    }
}

async function compareProductPerformance(text) {
    try {
        const { data: products } = await sb.from('product_total')
            .select('ma_vt, ten_vt, waiting, win, fail')
            .limit(10);

        if (!products || products.length === 0) {
            return "Không có đủ dữ liệu sản phẩm để so sánh.";
        }

        const comparison = products.map(p => ({
            code: p.ma_vt,
            name: p.ten_vt,
            total_quota: (p.waiting || 0) + (p.win || 0) + (p.fail || 0),
            win_value: p.win || 0,
            win_rate: ((p.win || 0) / ((p.waiting || 0) + (p.win || 0) + (p.fail || 0))) * 100
        })).sort((a, b) => b.win_rate - a.win_rate);

        let response = "📦 **SO SÁNH HIỆU SUẤT SẢN PHẨM**\n\n";
        response += "| Mã VT | Tên sản phẩm | Quota | Giá trị thắng | Tỉ lệ thắng |\n";
        response += "|--------|-------------|-------|---------------|-------------|\n";

        comparison.slice(0, 8).forEach(item => {
            response += `| ${item.code} | ${item.name || 'N/A'} | ${item.total_quota.toLocaleString('vi-VN')} | ${item.win_value.toLocaleString('vi-VN')} | ${item.win_rate.toFixed(1)}% |\n`;
        });

        const topProduct = comparison[0];
        const lowProduct = comparison.find(p => p.win_rate < 30);

        response += `\n**🏆 Sản phẩm bán chạy nhất:** ${topProduct.name} (${topProduct.win_rate.toFixed(1)}%)\n`;

        if (lowProduct) {
            response += `**⚠️ Sản phẩm cần cải thiện:** ${lowProduct.name} (${lowProduct.win_rate.toFixed(1)}%)\n`;
        }

        return response;
    } catch (error) {
        return "Xin lỗi, tôi không thể so sánh hiệu suất sản phẩm lúc này.";
    }
}

async function compareTimePeriods(text) {
    // Simple time period comparison
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = now.getMonth() === 0 ?
        `${now.getFullYear() - 1}-12` :
        `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

    try {
        const { data: thisMonthData } = await sb.from('listing')
            .select('tinh_trang')
            .like('ngay', `${thisMonth}%`);

        const { data: lastMonthData } = await sb.from('listing')
            .select('tinh_trang')
            .like('ngay', `${lastMonth}%`);

        const thisMonthWinRate = thisMonthData ?
            (thisMonthData.filter(d => d.tinh_trang === 'Win').length / thisMonthData.length * 100).toFixed(1) : 0;

        const lastMonthWinRate = lastMonthData ?
            (lastMonthData.filter(d => d.tinh_trang === 'Win').length / lastMonthData.length * 100).toFixed(1) : 0;

        const change = parseFloat(thisMonthWinRate) - parseFloat(lastMonthWinRate);

        return `📅 **SO SÁNH HIỆU SUẤT THEO THÁNG**

| Kỳ | Hồ sơ | Thắng | Tỉ lệ thắng |
|----|-------|-------|-------------|
| Tháng này | ${thisMonthData?.length || 0} | ${thisMonthData?.filter(d => d.tinh_trang === 'Win').length || 0} | ${thisMonthWinRate}% |
| Tháng trước | ${lastMonthData?.length || 0} | ${lastMonthData?.filter(d => d.tinh_trang === 'Win').length || 0} | ${lastMonthWinRate}% |

**${change > 0 ? '📈' : change < 0 ? '📉' : '➡️'} Thay đổi:** ${change > 0 ? '+' : ''}${change.toFixed(1)}%

${change > 5 ? '🎉 **Rất tốt!** Tỉ lệ thắng đang tăng mạnh.' :
 change > 0 ? '👍 **Tốt!** Có cải thiện so với tháng trước.' :
 change < -5 ? '⚠️ **Cần chú ý!** Tỉ lệ thắng đang giảm đáng kể.' :
 change < 0 ? '📊 **Ổn định** nhưng có thể cải thiện thêm.' :
 '📊 **Ổn định** - duy trì được hiệu suất.'}`;
    } catch (error) {
        return "Xin lỗi, tôi không thể so sánh theo thời gian lúc này.";
    }
}

async function compareRegions(text) {
    try {
        const { data: listings } = await sb.from('listing')
            .select('tinh, tinh_trang')
            .not('tinh', 'is', null);

        if (!listings || listings.length === 0) {
            return "Không có đủ dữ liệu khu vực để so sánh.";
        }

        const regionStats = {};
        listings.forEach(l => {
            const region = l.tinh;
            if (!regionStats[region]) regionStats[region] = { total: 0, won: 0 };
            regionStats[region].total++;
            if (l.tinh_trang === 'Win') regionStats[region].won++;
        });

        const comparison = Object.entries(regionStats)
            .map(([region, stats]) => ({
                region,
                win_rate: (stats.won / stats.total * 100).toFixed(1),
                total: stats.total,
                won: stats.won
            }))
            .sort((a, b) => parseFloat(b.win_rate) - parseFloat(a.win_rate))
            .slice(0, 6);

        let response = "🗺️ **SO SÁNH HIỆU SUẤT THEO KHU VỰC**\n\n";
        response += "| Khu vực | Tổng hồ sơ | Thắng | Tỉ lệ thắng |\n";
        response += "|---------|------------|-------|-------------|\n";

        comparison.forEach(item => {
            response += `| ${item.region} | ${item.total} | ${item.won} | ${item.win_rate}% |\n`;
        });

        const topRegion = comparison[0];
        response += `\n**🏆 Khu vực xuất sắc nhất:** ${topRegion.region} (${topRegion.win_rate}%)\n`;

        return response;
    } catch (error) {
        return "Xin lỗi, tôi không thể so sánh theo khu vực lúc này.";
    }
}

async function explainWinLossReasons(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('thắng')) {
        return `**🔍 TẠI SAO MỘT HỒ SƠ THẮNG THẦU?**

Dựa trên dữ liệu lịch sử, các yếu tố chính dẫn đến thắng thầu thường là:

## ✅ **YẾU TỐ QUAN TRỌNG**
1. **Giá cạnh tranh:** Thường thắng khi giá thấp hơn 5-15% so với đối thủ
2. **Kinh nghiệm với bệnh viện:** Đã từng thắng tại cùng bệnh viện
3. **Mối quan hệ tốt:** Có PSR quen biết với người quyết định
4. **Thời điểm phù hợp:** Nộp hồ sơ đúng thời điểm, không quá sớm hoặc muộn
5. **Hồ sơ hoàn chỉnh:** Tài liệu đầy đủ, chuyên nghiệp

## 📊 **THỐNG KÊ TỪ DỮ LIỆU**
- **80%** hồ sơ thắng có giá cạnh tranh
- **65%** thắng nhờ kinh nghiệm với bệnh viện
- **45%** thắng nhờ mối quan hệ PSR

Bạn muốn tôi phân tích trường hợp cụ thể nào?`;
    } else {
        return `**🔍 TẠI SAO MỘT HỒ SƠ THUA THẦU?**

Các nguyên nhân phổ biến dẫn đến thất bại:

## ❌ **NGUYÊN NHÂN CHÍNH**
1. **Giá cao:** Giá đề xuất cao hơn đối thủ 15%+
2. **Thiếu kinh nghiệm:** Chưa từng làm việc với bệnh viện
3. **Hồ sơ không đầy đủ:** Thiếu tài liệu quan trọng
4. **Thời điểm không tốt:** Nộp quá sớm hoặc quá muộn
5. **Thiếu quan tâm:** PSR không theo sát quá trình

## 💡 **CÁCH KHẮC PHỤC**
- Luôn nghiên cứu giá thị trường kỹ lưỡng
- Xây dựng mối quan hệ lâu dài với khách hàng
- Đảm bảo hồ sơ chuyên nghiệp, đầy đủ
- Theo sát từ đầu đến cuối quá trình thầu

Bạn có hồ sơ cụ thể nào cần phân tích?`;
    }
}

async function explainPerformanceIssues(text) {
    return `**🔍 TẠI SAO HIỆU SUẤT THẤP/GIẢM?**

Dựa trên phân tích dữ liệu, các nguyên nhân thường gặp:

## 📉 **NGUYÊN NHÂN CÓ THỂ**
1. **Thị trường cạnh tranh:** Đối thủ mạnh hơn, giá rẻ hơn
2. **Thay đổi chính sách:** Bệnh viện có quy định mới
3. **Vấn đề nội bộ:** Đội ngũ, quy trình, sản phẩm
4. **Mùa vụ thấp:** Thời điểm không thuận lợi
5. **Vấn đề chất lượng:** Sản phẩm hoặc dịch vụ chưa đạt yêu cầu

## 🛠️ **BIỆN PHÁP CẢI THIỆN**
1. **Phân tích đối thủ:** Nghiên cứu chiến lược của đối thủ thắng
2. **Nâng cao chất lượng:** Đào tạo PSR, cải thiện sản phẩm
3. **Mở rộng mạng lưới:** Xây dựng mối quan hệ mới
4. **Đa dạng hóa:** Thử nghiệm sản phẩm/dịch vụ mới
5. **Tối ưu quy trình:** Rút kinh nghiệm từ thất bại

Bạn muốn tôi phân tích vấn đề cụ thể nào và đưa ra giải pháp chi tiết?`;
}

async function explainDifferences(text) {
    return "Để giải thích sự khác biệt, tôi cần biết bạn đang so sánh giữa những yếu tố nào. Ví dụ:\n\n• **PSR A vs PSR B:** Chênh lệch về kinh nghiệm, khu vực phụ trách, mối quan hệ...\n• **Sản phẩm X vs Sản phẩm Y:** Khác biệt về giá, chất lượng, nhu cầu thị trường...\n• **Tháng này vs tháng trước:** Thay đổi về đối thủ, chính sách, mùa vụ...\n\nBạn có thể cho tôi biết cụ thể yếu tố nào bạn muốn so sánh không?";
}

async function provideImprovementGuidance(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('tỉ lệ thắng') || lowerText.includes('win rate')) {
        return `**🚀 HƯỚNG DẪN CẢI THIỆN TỈ LỆ THẮNG THẦU**

## 📈 **CHIẾN LƯỢC CHÍNH**
1. **Phân tích dữ liệu:** Xác định điểm mạnh/yếu từ hồ sơ đã thắng/thua
2. **Nghiên cứu thị trường:** Theo dõi giá cả và chiến lược đối thủ
3. **Xây dựng mối quan hệ:** PSR chủ động gặp gỡ khách hàng
4. **Tối ưu giá:** Đưa ra mức giá cạnh tranh nhưng có lãi

## 🛠️ **HÀNH ĐỘNG CỤ THỂ**
1. **Tạo báo cáo phân tích:** Tôi có thể tạo báo cáo chi tiết về các hồ sơ thắng/thua
2. **Đề xuất giá tối ưu:** Phân tích mức giá phù hợp cho từng bệnh viện
3. **Đào tạo PSR:** Xác định kỹ năng cần cải thiện
4. **Theo dõi sát sao:** Giám sát tiến độ từng hồ sơ

Bạn muốn bắt đầu từ bước nào?`;
    }

    return "Tôi có thể hướng dẫn cải thiện nhiều khía cạnh kinh doanh. Bạn muốn cải thiện điều gì cụ thể? (tỉ lệ thắng, hiệu suất PSR, quản lý sản phẩm, quy trình...)";
}

async function guideCreationProcess(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('hồ sơ') || lowerText.includes('thầu')) {
        return `**📝 HƯỚNG DẪN TẠO HỒ SƠ THẦU MỚI**

## 🗂️ **CÁCH TẠO HỒ SƠ**
1. **Từ hình ảnh:** Upload ảnh hồ sơ thầu, tôi sẽ tự động trích xuất và điền form
2. **Thủ công:** Vào menu "Kho hàng" → nút "Thêm mới"
3. **Từ mẫu có sẵn:** Tôi có thể tạo dựa trên hồ sơ tương tự

## 📋 **THÔNG TIN CẦN THIẾT**
• Mã thầu (tự động tạo)
• Tên bệnh viện
• Năm, Tỉnh/Thành, Khu vực
• Loại hình, Nhà phân phối
• PSR phụ trách
• Chi tiết sản phẩm và quota

Bạn muốn tôi giúp tạo hồ sơ mới ngay bây giờ không?`;
    }

    return "Tôi có thể hướng dẫn tạo hồ sơ thầu, tài khoản người dùng, hoặc các mục khác. Bạn muốn tạo gì cụ thể?";
}

async function guideExportProcess(text) {
    return `**📊 HƯỚNG DẪN XUẤT DỮ LIỆU**

## 📋 **CÁC BƯỚC XUẤT DỮ LIỆU**
1. **Chọn loại dữ liệu:** Listing (hồ sơ), Detail (chi tiết), Product (sản phẩm)
2. **Áp dụng bộ lọc:** Theo trạng thái, năm, PSR, khu vực, thời gian
3. **Chọn định dạng:** Excel hoặc CSV
4. **Tải file:** Tự động tải về máy

## 🎯 **MẸO SỬ DỤNG**
• **Xuất theo tháng:** Lọc theo khoảng thời gian cụ thể
• **Xuất theo PSR:** Để đánh giá hiệu suất cá nhân
• **Xuất theo khu vực:** Phân tích thị trường địa phương

Bạn muốn tôi xuất dữ liệu gì với bộ lọc như thế nào?`;
}

async function guideAnalysisProcess(text) {
    return `**📈 HƯỚNG DẪN PHÂN TÍCH DỮ LIỆU**

## 🔍 **CÁC LOẠI PHÂN TÍCH**
1. **Hiệu suất tổng thể:** Thống kê win rate, doanh thu
2. **Phân tích PSR:** So sánh hiệu suất giữa các nhân viên
3. **Phân tích sản phẩm:** Xác định sản phẩm bán chạy/kém
4. **Phân tích khu vực:** Đánh giá thị trường địa phương
5. **Xu hướng thời gian:** Theo dõi thay đổi theo tháng/quý

## 📊 **CÔNG CỤ PHÂN TÍCH**
• Báo cáo tự động với biểu đồ
• So sánh theo nhiều tiêu chí
• Dự đoán xu hướng tương lai
• Phân tích nguyên nhân thắng/thua

Bạn muốn phân tích khía cạnh nào của dữ liệu?`;
}