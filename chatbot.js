
import { GoogleGenAI } from "@google/genai";
import { showToast, showLoading, sb, showView, currentUser } from './app.js';
import { openListingModal } from './listing-form.js';

let chatSession = null;
let aiClient = null;
let currentImageBlob = null;
let globalApiKeys = [];
let currentKeyIndex = 0;
let currentProcessingState = { active: false, canceled: false, loadingId: null };

// --- QUẢN LÝ API KEY ---
const DEFAULT_API_KEY = 'AIzaSyDMMoL4G5FDGPNUB2e84XNsNIQo68USVdQ'; 

async function fetchGlobalApiKey() {
    try {
        const { data, error } = await sb
            .from('app_config')
            .select('value')
            .eq('key', 'gemini_api_key')
            .maybeSingle(); 

        if (!error && data && data.value) {
            try {
                const parsed = JSON.parse(data.value);
                globalApiKeys = Array.isArray(parsed) ? parsed : [data.value];
            } catch (e) {
                globalApiKeys = [data.value];
            }
        }
    } catch (e) {
        console.warn("Could not fetch global API keys:", e);
    }
}

async function saveGlobalApiKey(newKey) {
    try {
        await fetchGlobalApiKey();
        if (!globalApiKeys.includes(newKey)) {
            globalApiKeys.push(newKey);
        }
        const { error } = await sb
            .from('app_config')
            .upsert({ key: 'gemini_api_key', value: JSON.stringify(globalApiKeys) });
        if (error) throw error;
        return true;
    } catch (e) {
        console.error("Error saving global API key:", e);
        return false;
    }
}

const getAllAvailableKeys = () => {
    let keys = [];
    const userKeysRaw = localStorage.getItem('user_gemini_api_key');
    if (userKeysRaw) {
        try {
            const parsed = JSON.parse(userKeysRaw);
            if (Array.isArray(parsed)) keys = [...keys, ...parsed];
            else keys.push(userKeysRaw);
        } catch (e) {
            keys.push(userKeysRaw);
        }
    }
    keys = [...keys, ...globalApiKeys];
    keys.push(DEFAULT_API_KEY);
    return [...new Set(keys.filter(k => k && k.trim().length > 10))];
};

// --- HELPERS FOR SMART MAPPING ---

async function findBestMatchInDB(tableName, columnName, inputValue) {
    if (!inputValue) return inputValue;
    const { data } = await sb.from(tableName).select(columnName);
    if (!data || data.length === 0) return inputValue;
    
    const input = inputValue.toLowerCase().trim();
    // Xử lý các trường hợp đặc biệt thường gặp
    if (input === 'sài gòn' || input === 'hcm' || input === 'tp hcm') return 'Hồ Chí Minh';
    if (input === 'hà nội' || input === 'hn') return 'Hà Nội';

    const uniqueValues = [...new Set(data.map(item => item[columnName]).filter(v => v))];
    
    // 1. Tìm khớp chính xác (không phân biệt hoa thường)
    const exactMatch = uniqueValues.find(val => val.toLowerCase() === input);
    if (exactMatch) return exactMatch;

    // 2. Tìm khớp chứa chuỗi (Fuzzy light)
    const partialMatch = uniqueValues.find(val => {
        const lowerVal = val.toLowerCase();
        return lowerVal.includes(input) || input.includes(lowerVal);
    });
    
    return partialMatch || inputValue;
}

// --- TOOL DEFINITIONS ---

const searchListingsTool = {
    name: 'search_listings',
    description: 'Tìm kiếm hồ sơ thầu. Luôn trả về thông tin PSR.',
    parameters: {
        type: 'OBJECT',
        properties: {
            keyword: { type: 'STRING', description: 'Từ khóa tìm kiếm (Tên BV, Mã thầu, Tỉnh...)' },
            status: { type: 'STRING', description: 'Lọc theo trạng thái: "Win", "Fail", "Waiting", "Listing".' },
            from_date: { type: 'STRING', description: 'Ngày bắt đầu (YYYY-MM-DD).' },
            to_date: { type: 'STRING', description: 'Ngày kết thúc (YYYY-MM-DD).' },
            limit: { type: 'NUMBER', description: 'Số lượng kết quả tối đa (mặc định 15).' }
        }
    }
};

const getStatsTool = {
    name: 'get_general_stats',
    description: 'Tính toán thống kê tổng quát (Quota, Listing, Waiting, Win, Fail).',
    parameters: {
        type: 'OBJECT',
        properties: {
            from_date: { type: 'STRING', description: 'Ngày bắt đầu (YYYY-MM-DD).' },
            to_date: { type: 'STRING', description: 'Ngày kết thúc (YYYY-MM-DD).' },
            filter_psr: { type: 'STRING', description: 'Tên PSR.' }
        }
    }
};

const getListingItemsTool = {
    name: 'get_listing_items',
    description: 'Lấy chi tiết danh sách vật tư/sản phẩm bên trong một mã thầu cụ thể.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING', description: 'Mã hồ sơ thầu chính xác.' }
        },
        required: ['ma_thau']
    }
};

const updateListingStatusTool = {
    name: 'update_listing_status',
    description: 'CẬP NHẬT trạng thái của hồ sơ thầu.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING', description: 'Mã hồ sơ thầu cần cập nhật.' },
            new_status: { type: 'STRING', description: 'Trạng thái mới: "Win", "Fail", "Waiting", "Listing".' }
        },
        required: ['ma_thau', 'new_status']
    }
};

const navigateSmartTool = {
    name: 'navigate_smart',
    description: 'Điều hướng đến các màn hình trong ứng dụng.',
    parameters: {
        type: 'OBJECT',
        properties: {
            view_id: { type: 'STRING', description: 'ID màn hình.' },
            search_term: { type: 'STRING', description: 'Từ khóa tìm kiếm.' }
        },
        required: ['view_id']
    }
};

const openAddFormTool = {
    name: 'open_add_listing_form',
    description: 'Mở form thêm mới hồ sơ thầu SAU KHI đã xác nhận đầy đủ thông tin với người dùng.',
    parameters: {
        type: 'OBJECT',
        properties: {
            benh_vien: { type: 'STRING', description: 'Tên bệnh viện.' },
            tinh: { type: 'STRING', description: 'Tỉnh/Thành phố.' },
            nha_phan_phoi: { type: 'STRING', description: 'Nhà phân phối.' },
            nganh: { type: 'STRING', description: 'Ngành hàng.' },
            loai: { type: 'STRING', description: 'Loại hình (Thầu tập trung, Mua sắm...)' },
            khoa: { type: 'STRING', description: 'Khoa phòng.' },
            quan_ly: { type: 'STRING', description: 'Người quản lý.' },
            nam: { type: 'NUMBER' },
            psr: { type: 'STRING', description: 'Tên nhân viên phụ trách (PSR).' },
            materials: { 
                type: 'ARRAY', 
                description: 'Danh sách vật tư trích xuất (nếu có)',
                items: {
                    type: 'OBJECT',
                    properties: {
                        ma_vt: { type: 'STRING' },
                        quota: { type: 'NUMBER' }
                    }
                }
            }
        }
    }
};

export async function initChatbot() {
    await fetchGlobalApiKey();

    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const headerToggleBtn = document.getElementById('header-chatbot-btn');
    const chatWindow = document.getElementById('chatbot-window');
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const fileInput = document.getElementById('chatbot-file-input');
    const removeImgBtn = document.getElementById('chatbot-remove-img');
    const closeBtn = document.getElementById('chatbot-close-btn');
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    const sendBtn = document.getElementById('chatbot-send-btn');

    function updateSendButton(isProcessing) {
        if (!sendBtn) return;
        if (isProcessing) {
            sendBtn.type = 'button';
            sendBtn.setAttribute('aria-label', 'Dừng xử lý');
            sendBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;
            sendBtn.classList.add('bg-red-500');
            sendBtn.classList.remove('bg-primary');
        } else {
            sendBtn.type = 'submit';
            sendBtn.setAttribute('aria-label', 'Gửi');
            sendBtn.innerHTML = `<svg class="w-4 h-4 transform rotate-90 translate-x-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>`;
            sendBtn.classList.remove('bg-red-500');
            sendBtn.classList.add('bg-primary');
        }
    }

    function cancelProcessing() {
        if (!currentProcessingState.active) return;
        currentProcessingState.canceled = true;
        // Remove thinking indicator if present
        if (currentProcessingState.loadingId) removeThinking(currentProcessingState.loadingId);
        currentProcessingState.loadingId = null;
        currentProcessingState.active = false;
        // Reset chatSession so next send will create a new one
        chatSession = null;
        updateSendButton(false);
        appendMessage("Đã dừng xử lý.", 'ai');
    }

    // sendBtn click: if processing -> cancel, otherwise allow submit via form
    if (sendBtn) {
        sendBtn.addEventListener('click', (e) => {
            if (currentProcessingState.active) {
                e.preventDefault();
                cancelProcessing();
            } else {
                // let form submit normally
            }
        });
    }

    // Enable/disable send button based on input or image presence (unless processing)
    function refreshSendButtonState() {
        if (!sendBtn) return;
        // If currently processing, keep as stop button and enabled
        if (currentProcessingState.active) {
            updateSendButton(true);
            sendBtn.disabled = false;
            sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            return;
        }
        const hasText = input && input.value && input.value.trim().length > 0;
        const hasImage = !!currentImageBlob;
        const shouldEnable = hasText || hasImage;
        sendBtn.disabled = !shouldEnable;
        if (shouldEnable) {
            sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        // ensure appearance is "send" (not red stop)
        updateSendButton(false);
    }

    const style = document.createElement('style');
    style.textContent = `
        #chatbot-messages table { display: block; overflow-x: auto; white-space: nowrap; max-width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 0.8rem; }
        #chatbot-messages th, #chatbot-messages td { border: 1px solid #e5e7eb; padding: 6px 10px; }
        #chatbot-messages th { background-color: #f3f4f6; font-weight: 600; text-align: left; }
        .dark #chatbot-messages th { background-color: #374151; border-color: #4b5563; color: #e5e7eb; }
        .dark #chatbot-messages td { border-color: #4b5563; color: #e5e7eb; }
        .ai-bubble-container { position: relative; group: inherit; }
        .report-btn { opacity: 0; transition: opacity 0.2s; position: absolute; bottom: -20px; left: 0; }
        .ai-bubble-container:hover .report-btn { opacity: 1; }
        @keyframes chatbot-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .chatbot-spinner { animation: chatbot-spin 1s linear infinite; }
    `;
    document.head.appendChild(style);

    if (!chatWindow) return;

    if (toggleBtn) {
        makeElementDraggable(toggleBtn, { isToggle: true, linkedEl: chatWindow });
        makeElementDraggable(chatWindow, { isWindow: true, linkedEl: toggleBtn });
    }

    if (headerToggleBtn) {
        headerToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                alignChatWindowToButton(headerToggleBtn, chatWindow);
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        });
    }

    initResizableTopLeft(chatWindow);
    injectSettingsUI();
    injectFeedbackUI(); 

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
        refreshSendButtonState();
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
        await sendMessageToAI(userMessage, imageToSend, { updateSendButton });
    });

    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        refreshSendButtonState();
    });

    renderSuggestions();
}

async function startNewSession() {
    const keys = getAllAvailableKeys();
    if (currentKeyIndex >= keys.length) {
        appendMessage("Tất cả API Key hiện tại đều đã hết lượt dùng hoặc không hợp lệ.", 'ai');
        return false;
    }
    try {
        const apiKey = keys[currentKeyIndex];
        aiClient = new GoogleGenAI({ apiKey: apiKey });
        const userName = currentUser ? currentUser.ho_ten : "Người dùng";
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const dayName = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][today.getDay()];
        
        const systemPrompt = `
        Bạn là trợ lý ảo Quản lý Thầu. Người dùng: ${userName}. Ngày: ${dayName}, ${dateStr}.
        
        QUY TẮC QUAN TRỌNG KHI TẠO HỒ SƠ MỚI:
        1. Khi người dùng muốn "tạo hồ sơ", "thêm mới", "lên deal", bạn KHÔNG ĐƯỢC gọi tool ngay lập tức.
        2. Bạn PHẢI kiểm tra xem người dùng đã cung cấp đủ 3 thông tin bắt buộc chưa:
           - Bệnh viện
           - Tỉnh
           - Nhà phân phối
        3. Nếu thiếu thông tin nào, hãy hỏi người dùng cung cấp thêm.
        4. Sau khi có đủ thông tin, hãy tóm tắt lại và hỏi xác nhận (Ví dụ: "Tôi đã có thông tin: BV Chợ Rẫy, Tỉnh HCM, NPP Harpharco. Bạn có muốn tạo form ngay không?").
        5. CHỈ gọi tool 'open_add_listing_form' KHI người dùng xác nhận đồng ý.
        
        Các chức năng khác (tìm kiếm, thống kê) thực hiện bình thường.
        Trả lời ngắn gọn, tạo bảng Markdown khi liệt kê.
        `;
        
        chatSession = aiClient.chats.create({
            model: 'gemini-3-flash-preview',
            config: {
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: [searchListingsTool, getListingItemsTool, updateListingStatusTool, getStatsTool, navigateSmartTool, openAddFormTool] }]
            }
        });
        return true;
    } catch(e) {
        return false;
    }
}

async function sendMessageToAI(text, imageFile, opts = {}) {
    const { updateSendButton } = opts;
    // mark processing state
    currentProcessingState.active = true;
    currentProcessingState.canceled = false;
    if (typeof updateSendButton === 'function') updateSendButton(true);
    const loadingId = appendThinking();
    currentProcessingState.loadingId = loadingId;
    const attemptSendMessage = async () => {
        if (!chatSession) {
            const ok = await startNewSession();
            if (!ok) throw new Error("NO_KEYS_AVAILABLE");
        }
        try {
            let response;
            if (imageFile) {
                const base64Data = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(imageFile);
                });
                const parts = [{ text: text || "Phân tích ảnh." }, { inlineData: { mimeType: imageFile.type, data: base64Data } }];
                response = await chatSession.sendMessage({ message: parts });
            } else {
                response = await chatSession.sendMessage({ message: text });
            }
            return response;
        } catch (err) {
            const errStr = String(err);
            if (errStr.includes("429") || errStr.includes("quota") || errStr.includes("403")) {
                currentKeyIndex++;
                chatSession = null;
                return await attemptSendMessage();
            }
            throw err;
        }
    };

    try {
        const response = await attemptSendMessage();
        // If user canceled during network wait, ignore response
        if (currentProcessingState.canceled) {
            // ensure cleanup done
            removeThinking(loadingId);
            currentProcessingState.loadingId = null;
            currentProcessingState.active = false;
            if (typeof updateSendButton === 'function') updateSendButton(false);
            return;
        }
        const responseText = response.text || "";
        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
            removeThinking(loadingId);
            for (const call of functionCalls) {
                const fnName = call.name;
                const args = call.args;
                let result = { success: false, message: "Error" };
                
                if (fnName === 'search_listings') {
                    // Enhanced search: look in listing table and also in detail.ma_vt for matches
                    let listings = [];
                    const limit = args.limit || 15;

                    try {
                        // Base listing query (apply status filter if present)
                        let baseQuery = sb.from('listing').select('*');
                        if (args.status) baseQuery = baseQuery.ilike('tinh_trang', `%${args.status}%`);

                        if (args.keyword) {
                            const kw = args.keyword;
                            // 1) Search directly in listing fields
                            const { data: listingData } = await baseQuery.or(`ma_thau.ilike.%${kw}%,benh_vien.ilike.%${kw}%`).limit(limit);
                            if (listingData && listingData.length > 0) listings = listings.concat(listingData);

                            // 2) Search in detail table for ma_vt matches, then fetch parent listings
                            const { data: detailMatches } = await sb.from('detail').select('ma_thau').ilike('ma_vt', `%${kw}%`);
                            if (detailMatches && detailMatches.length > 0) {
                                const maList = [...new Set(detailMatches.map(d => d.ma_thau).filter(Boolean))];
                                if (maList.length > 0) {
                                    const { data: listingsFromDetail } = await sb.from('listing').select('*').in('ma_thau', maList);
                                    if (listingsFromDetail && listingsFromDetail.length > 0) listings = listings.concat(listingsFromDetail);
                                }
                            }

                            // Deduplicate by ma_thau and apply limit
                            const map = new Map();
                            listings.forEach(l => { if (l && l.ma_thau) map.set(l.ma_thau, l); });
                            listings = Array.from(map.values()).slice(0, limit);
                        } else {
                            const { data } = await baseQuery.limit(limit);
                            if (data) listings = data;
                        }

                        result = listings.length > 0 ? { data: listings } : { message: "No data" };
                    } catch (e) {
                        result = { message: "Error searching listings: " + e.message };
                    }
                } else if (fnName === 'get_listing_items') {
                    // Return detail rows for a given ma_thau OR search by ma_vt
                    try {
                        if (args.ma_thau) {
                            const { data } = await sb.from('detail').select('*').eq('ma_thau', args.ma_thau);
                            result = data && data.length > 0 ? { data } : { message: "No data" };
                        } else if (args.ma_vt) {
                            const { data } = await sb.from('detail').select('*').ilike('ma_vt', `%${args.ma_vt}%`);
                            result = data && data.length > 0 ? { data } : { message: "No data" };
                        } else {
                            result = { message: "No parameters provided" };
                        }
                    } catch (e) {
                        result = { message: "Error fetching listing items: " + e.message };
                    }
                } else if (fnName === 'get_general_stats') {
                    const { data } = await sb.from('detail').select('quota, sl_trung, tinh_trang');
                    let stats = { Total_Quota: 0, Win: 0 };
                    data?.forEach(i => { stats.Total_Quota += i.quota; if(i.tinh_trang==='Win') stats.Win += i.sl_trung; });
                    result = { stats };
                } else if (fnName === 'navigate_smart') {
                    await showView(args.view_id);
                    result = { success: true };
                } else if (fnName === 'open_add_listing_form') {
                    // --- SMART MAPPING LOGIC (Dự đoán thông minh cho TẤT CẢ các trường) ---
                    // Thực hiện tìm kiếm mờ (fuzzy search) trong DB cho từng trường
                    const [matchedBenhVien, matchedTinh, matchedNpp, matchedNganh, matchedPsr, matchedLoai, matchedKhoa, matchedQuanLy] = await Promise.all([
                        findBestMatchInDB('listing', 'benh_vien', args.benh_vien),
                        findBestMatchInDB('tinh_thanh', 'tinh', args.tinh),
                        findBestMatchInDB('listing', 'nha_phan_phoi', args.nha_phan_phoi),
                        findBestMatchInDB('listing', 'nganh', args.nganh),
                        findBestMatchInDB('user', 'ho_ten', args.psr),
                        findBestMatchInDB('listing', 'loai', args.loai),
                        findBestMatchInDB('detail', 'khoa', args.khoa),
                        findBestMatchInDB('listing', 'quan_ly', args.quan_ly)
                    ]);
                    
                    const normalizedArgs = {
                        ...args,
                        benh_vien: matchedBenhVien,
                        tinh: matchedTinh,
                        nha_phan_phoi: matchedNpp,
                        nganh: matchedNganh,
                        psr: matchedPsr,
                        loai: matchedLoai,
                        khoa: matchedKhoa,
                        quan_ly: matchedQuanLy
                    };

                    await showView('view-ton-kho');
                    setTimeout(() => { if (window.openListingModal) window.openListingModal(normalizedArgs, false, true); }, 500);
                    result = { success: true, message: "Modal opened with smart matched data" };
                }
                
                const toolResponse = await chatSession.sendMessage({ message: [{ functionResponse: { name: fnName, response: { result: result } } }] });
                appendMessage(toolResponse.text, 'ai', null, text);
                return; 
            }
        }
        removeThinking(loadingId);
        currentProcessingState.loadingId = null;
        currentProcessingState.active = false;
        if (typeof updateSendButton === 'function') updateSendButton(false);
        if (responseText) appendMessage(responseText, 'ai', null, text);
    } catch (error) {
        removeThinking(loadingId);
        currentProcessingState.loadingId = null;
        currentProcessingState.active = false;
        if (typeof updateSendButton === 'function') updateSendButton(false);
        appendMessage("Lỗi kết nối AI.", 'ai');
    }
}

function appendMessage(text, sender, imageFile = null, originalQuestion = "") {
    const messagesContainer = document.getElementById('chatbot-messages');
    const div = document.createElement('div');
    div.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up mb-4`;
    
    let contentHtml = '';
    if (imageFile) {
        const url = URL.createObjectURL(imageFile);
        contentHtml += `<img src="${url}" class="max-w-[200px] rounded-lg mb-2 block">`;
    }
    
    const formattedText = (sender === 'ai' && typeof marked !== 'undefined') ? marked.parse(text) : text;
    const bubbleClass = sender === 'user' ? 'bg-[#2563eb] text-white p-3 rounded-2xl rounded-tr-none shadow-md max-w-[85%] text-sm' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-600 max-w-[95%] prose dark:prose-invert text-sm leading-relaxed relative';
    
    let reportHtml = '';
    if (sender === 'ai') {
        reportHtml = `
            <button class="report-btn text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-1 mt-1 px-1 rounded" onclick="window.openFeedbackModal(this)" data-q="${encodeURIComponent(originalQuestion)}" data-a="${encodeURIComponent(text)}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                Báo cáo
            </button>
        `;
    }

    div.innerHTML = `
        <div class="ai-bubble-container">
            <div class="${bubbleClass}">
                ${contentHtml}
                <div class="overflow-x-auto w-full">${formattedText}</div>
            </div>
            ${reportHtml}
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
    div.className = 'flex justify-start animate-fade-in-up mb-4';
    div.innerHTML = `
        <div class="bg-white dark:bg-gray-700 p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2 border border-gray-100 dark:border-gray-600">
            <svg class="chatbot-spinner w-4 h-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">Đang xử lý...</span>
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

function initResizableTopLeft(el) {
    const handle = document.getElementById('chatbot-resize-handle');
    if (!handle) return;
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    const onMouseDown = (e) => {
        if (window.innerWidth < 768) return;
        e.stopPropagation(); e.preventDefault();
        isResizing = true;
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
        const rect = el.getBoundingClientRect();
        startWidth = rect.width; startHeight = rect.height; startLeft = rect.left; startTop = rect.top;
        el.style.bottom = 'auto'; el.style.right = 'auto'; el.style.left = startLeft + 'px'; el.style.top = startTop + 'px';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'nwse-resize';
    };
    const onMouseMove = (e) => {
        if (!isResizing) return;
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
        const dx = clientX - startX; const dy = clientY - startY;
        if (startWidth - dx > 300) { el.style.width = `${startWidth - dx}px`; el.style.left = `${startLeft + dx}px`; }
        if (startHeight - dy > 400) { el.style.height = `${startHeight - dy}px`; el.style.top = `${startTop + dy}px`; }
    };
    const onMouseUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
    };
    handle.addEventListener('mousedown', onMouseDown);
}

function makeElementDraggable(el, options = {}) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;
    let linkedEl = options.linkedEl;
    let linkedInitialLeft, linkedInitialTop;

    const onMouseDown = (e) => {
        if (options.isWindow && window.innerWidth < 768) return;
        if (e.button !== 0 && e.type !== 'touchstart') return;
        if (options.isWindow) {
            const rect = el.getBoundingClientRect();
            const clickY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
            if (clickY - rect.top > 60 || ['INPUT', 'BUTTON', 'TEXTAREA', 'I', 'SVG', 'PATH'].includes(e.target.tagName)) return;
        }
        isDragging = true; hasMoved = false;
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        startX = clientX; startY = clientY;
        const rect = el.getBoundingClientRect();
        initialLeft = rect.left; initialTop = rect.top;
        el.style.bottom = 'auto'; el.style.right = 'auto'; el.style.left = initialLeft + 'px'; el.style.top = initialTop + 'px';
        if (linkedEl) {
            const lRect = linkedEl.getBoundingClientRect();
            linkedInitialLeft = lRect.left; linkedInitialTop = lRect.top;
            linkedEl.style.bottom = 'auto'; linkedEl.style.right = 'auto'; linkedEl.style.left = linkedInitialLeft + 'px'; linkedEl.style.top = linkedInitialTop + 'px';
        }
        document.body.style.userSelect = 'none';
        document.addEventListener(e.type === 'touchstart' ? 'touchmove' : 'mousemove', onMouseMove, { passive: false });
        document.addEventListener(e.type === 'touchstart' ? 'touchend' : 'mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault(); 
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const dx = clientX - startX; const dy = clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
        el.style.left = (initialLeft + dx) + 'px'; el.style.top = (initialTop + dy) + 'px';
        if (linkedEl) { linkedEl.style.left = (linkedInitialLeft + dx) + 'px'; linkedEl.style.top = (linkedInitialTop + dy) + 'px'; }
    };

    const onMouseUp = (e) => {
        isDragging = false;
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onMouseMove); document.removeEventListener('touchend', onMouseUp);
        if (options.isToggle && !hasMoved) {
            const chatWindow = document.getElementById('chatbot-window');
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
    if (window.innerWidth < 768) {
        win.style.position = 'fixed'; win.style.bottom = '0'; win.style.left = '0'; win.style.width = '100%'; win.style.height = '85vh'; win.style.borderRadius = '16px 16px 0 0'; win.style.zIndex = '10000';
        return;
    }
    const btnRect = btn.getBoundingClientRect();
    win.style.bottom = 'auto'; win.style.right = 'auto';
    win.style.top = Math.max(10, btnRect.top - win.offsetHeight - 10) + 'px';
    win.style.left = Math.max(10, (btnRect.left + btnRect.width) - win.offsetWidth) + 'px';
}

function handleImageSelect(file) {
    if (!file.type.startsWith('image/')) { showToast('Vui lòng chọn file ảnh.', 'error'); return; }
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
    const suggestions = ["Dữ liệu tuần này", "Thống kê tổng quát hôm nay", "Các hồ sơ sắp hết hạn"];
    const container = document.getElementById('chatbot-suggestions');
    if(container) container.innerHTML = suggestions.map(s => `<button class="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors shadow-sm" onclick="document.getElementById('chatbot-input').value = '${s}'; document.getElementById('chatbot-form').dispatchEvent(new Event('submit'));">${s}</button>`).join('');
}

function injectSettingsUI() {
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    if (!minimizeBtn) return;
    if (!document.getElementById('chatbot-settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'chatbot-settings-btn';
        settingsBtn.className = "text-white hover:text-gray-200 mr-2 opacity-80 hover:opacity-100";
        settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        settingsBtn.onclick = openSettingsModal;
        minimizeBtn.parentNode.insertBefore(settingsBtn, minimizeBtn);
    }
    if (!document.getElementById('chatbot-settings-modal')) {
        const modal = document.createElement('div');
        modal.id = 'chatbot-settings-modal';
        modal.className = 'hidden absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center z-[100] rounded-2xl p-4 backdrop-blur-sm';
        modal.innerHTML = `<div class="bg-white dark:bg-gray-800 p-5 rounded-xl w-full shadow-2xl border dark:border-gray-700"><h3 class="text-base font-bold mb-2 dark:text-white">🔑 Cài đặt API Key</h3><div class="space-y-3 mt-4"><input type="password" id="custom-api-key" placeholder="dán key vào đây..." class="w-full text-sm border p-2.5 rounded-lg dark:bg-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#9333ea]"><div class="flex justify-end gap-2 pt-2"><button id="cancel-settings" class="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 rounded-lg">Đóng</button><button id="save-settings" class="px-4 py-2 text-xs font-medium bg-[#9333ea] text-white rounded-lg shadow-sm">Lưu</button></div></div></div>`;
        document.getElementById('chatbot-window').appendChild(modal);
        document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
        document.getElementById('save-settings').onclick = async () => {
            const key = document.getElementById('custom-api-key').value.trim();
            if (key && key.length > 10) {
                // Kiểm tra trùng lặp
                const currentAvailableKeys = getAllAvailableKeys();
                if (currentAvailableKeys.includes(key)) {
                    showToast('API Key này đã tồn tại trong danh sách.', 'info');
                    return;
                }

                let userKeys = [];
                try {
                    const raw = localStorage.getItem('user_gemini_api_key');
                    if(raw) {
                        const parsed = JSON.parse(raw);
                        userKeys = Array.isArray(parsed) ? parsed : [raw];
                    }
                } catch(e) {}
                
                if (!userKeys.includes(key)) {
                    userKeys.push(key);
                    localStorage.setItem('user_gemini_api_key', JSON.stringify(userKeys));
                }
                
                if (currentUser && currentUser.phan_quyen === 'Admin') await saveGlobalApiKey(key);
                chatSession = null; currentKeyIndex = 0;
                showToast('✅ Đã thêm API Key!', 'success');
                modal.classList.add('hidden');
                document.getElementById('custom-api-key').value = '';
            } else { showToast('Key không hợp lệ.', 'error'); }
        };
    }
}

function openSettingsModal() {
    const modal = document.getElementById('chatbot-settings-modal');
    if (modal) modal.classList.remove('hidden');
}

// --- FEEDBACK SYSTEM ---

let currentFeedbackData = { question: "", answer: "" };

function injectFeedbackUI() {
    if (document.getElementById('chatbot-feedback-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'chatbot-feedback-modal';
    modal.className = 'hidden absolute inset-0 bg-black/60 flex items-center justify-center z-[110] rounded-2xl p-4 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 p-5 rounded-xl w-full max-w-[280px] shadow-2xl border dark:border-gray-700 animate-fade-in-up">
            <h3 class="text-sm font-bold mb-3 dark:text-white flex items-center gap-2 text-red-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                Báo cáo câu trả lời
            </h3>
            <p class="text-[11px] text-gray-500 mb-4">Bạn chưa hài lòng về điều gì?</p>
            <div class="grid gap-2">
                <button class="feedback-opt-btn w-full py-2 px-3 text-xs text-left bg-gray-50 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/30 border dark:border-gray-600 rounded-lg transition-colors" data-reason="Chưa thực hiện được">Chưa thực hiện được</button>
                <button class="feedback-opt-btn w-full py-2 px-3 text-xs text-left bg-gray-50 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/30 border dark:border-gray-600 rounded-lg transition-colors" data-reason="Sai kết quả">Sai kết quả</button>
                <button id="close-feedback" class="w-full py-2 px-3 text-xs text-center text-gray-400 hover:text-gray-600 mt-2">Hủy</button>
            </div>
        </div>
    `;
    document.getElementById('chatbot-window').appendChild(modal);

    document.getElementById('close-feedback').onclick = () => modal.classList.add('hidden');
    
    modal.querySelectorAll('.feedback-opt-btn').forEach(btn => {
        btn.onclick = async () => {
            const reason = btn.dataset.reason;
            await submitFeedback(reason);
            modal.classList.add('hidden');
        };
    });
}

window.openFeedbackModal = function(btn) {
    currentFeedbackData.question = decodeURIComponent(btn.dataset.q);
    currentFeedbackData.answer = decodeURIComponent(btn.dataset.a);
    const modal = document.getElementById('chatbot-feedback-modal');
    if (modal) modal.classList.remove('hidden');
};

async function submitFeedback(reason) {
    if (!currentUser) { showToast("Vui lòng đăng nhập.", "error"); return; }
    showLoading(true);
    try {
        const { error } = await sb.from('phan_hoi').insert({
            user_gmail: currentUser.gmail,
            user_name: currentUser.ho_ten,
            cau_hoi: currentFeedbackData.question,
            cau_tra_loi: currentFeedbackData.answer,
            ly_do: reason
        });
        if (error) throw error;
        showToast("Cảm ơn phản hồi của bạn!", "success");
    } catch (e) {
        console.error(e);
        showToast("Gửi báo cáo thất bại.", "error");
    } finally {
        showLoading(false);
    }
}
