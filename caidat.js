


import { sb, cache, currentUser, setCurrentUser, showLoading, showToast, showConfirm, DEFAULT_AVATAR_URL, updateSidebarAvatar, sanitizeFileName, onlineUsers, handleLogout } from './app.js';
import { setLanguage, getCurrentLanguage } from './lang.js';

let selectedAvatarFile = null;
let isViewLoaded = false;
let currentEditingUserGmail = null;
let currentViewerUserGmail = null; // Track which user we are editing viewers for
let cachedPotentialViewers = null; // Cache distinct list

const APP_VIEWS = [
    { id: 'view-phat-trien', labelI18n: 'header_dashboard' }, 
    { id: 'view-ton-kho', labelI18n: 'header_listing' },     
    { id: 'view-chi-tiet', labelI18n: 'header_detail' },      
    { id: 'view-san-pham', labelI18n: 'header_product' }
];

const VIEW_TEMPLATE = `
<!-- Desktop Container for Shopee-like Layout -->
<div class="hidden md:flex container mx-auto max-w-6xl py-6 gap-6 h-full">
    
    <!-- Sidebar (Settings Navigation) -->
    <div class="w-64 flex-shrink-0 flex flex-col h-full">
        <!-- User Brief -->
        <div class="flex items-center gap-3 mb-6 px-2 flex-shrink-0">
            <img id="settings-desktop-avatar" src="" class="w-12 h-12 rounded-full border border-gray-200 dark:border-gray-600 object-cover">
            <div class="overflow-hidden">
                <p id="settings-desktop-name" class="font-bold text-gray-800 dark:text-gray-100 truncate">...</p>
                <a href="#" id="btn-settings-profile-edit" class="text-xs text-gray-500 dark:text-gray-400 hover:text-primary flex items-center">
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    <span data-i18n="btn_save">Sửa hồ sơ</span>
                </a>
            </div>
        </div>

        <!-- Menu List -->
        <div class="bg-white rounded-sm shadow-sm overflow-hidden flex-grow flex flex-col h-auto">
            <div id="desktop-settings-menu" class="p-0 flex-grow">
                <button id="btn-settings-profile" class="settings-row w-full hover:bg-gray-50 border-b-0 text-left px-4 py-3 flex items-center justify-start gap-3 group">
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                    <span class="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors" data-i18n="settings_profile">Hồ sơ Cá Nhân</span>
                </button>
                <button id="btn-settings-admin" class="settings-row w-full hover:bg-gray-50 border-b-0 text-left px-4 py-3 hidden flex items-center justify-start gap-3 group">
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    <span class="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors" data-i18n="settings_admin">Quản Lý Người Dùng</span>
                </button>
                <button id="btn-settings-system" class="settings-row w-full hover:bg-gray-50 border-b-0 text-left px-4 py-3 flex items-center justify-start gap-3 group">
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0 3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826 3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
                    <span class="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors" data-i18n="settings_system">Hệ Thống & Ngôn Ngữ</span>
                </button>
                <button id="btn-settings-about" class="settings-row w-full hover:bg-gray-50 border-b-0 text-left px-4 py-3 flex items-center justify-start gap-3 group">
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-orange-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors" data-i18n="settings_about">Giới Thiệu</span>
                </button>
                <button id="btn-settings-support" class="settings-row w-full hover:bg-gray-50 border-b-0 text-left px-4 py-3 flex items-center justify-start gap-3 group">
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-teal-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    <span class="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors" data-i18n="settings_support">Hỗ Trợ</span>
                </button>
                <!-- Desktop Logout Button (Aligned left) -->
                <button id="logout-btn-desktop" class="settings-row w-full hover:bg-red-50 border-b-0 text-left px-4 py-3 flex items-center justify-start gap-3 group text-red-600">
                    <svg class="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                    <span class="text-sm font-medium group-hover:text-red-700 transition-colors" data-i18n="nav_logout">Đăng Xuất</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Content Area (Card) -->
    <div class="flex-1 bg-white rounded-sm shadow-sm h-full overflow-y-auto relative">
        <!-- Dynamic Content injected here by JS -->
        <div id="desktop-settings-content-slot" class="h-full"></div>
    </div>
</div>

<!-- MOBILE LAYOUT (SWAP VIEW STYLE) -->
<div class="md:hidden h-full relative overflow-hidden bg-gray-50">
    
    <!-- 1. MENU LIST VIEW -->
    <div id="mobile-settings-list" class="absolute inset-0 flex flex-col transition-transform duration-300 transform translate-x-0 z-10">
        <!-- Header -->
        <div class="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-white mb-2 flex items-center gap-4 bg-primary flex-shrink-0">
                <img id="settings-menu-avatar" src="" class="w-16 h-16 rounded-full border-2 border-white object-cover bg-gray-200">
                <div class="overflow-hidden">
                    <h2 id="settings-menu-name" class="font-bold text-lg truncate">...</h2>
                    <p id="settings-menu-email" class="text-xs text-white/80 truncate">...</p>
                     <div class="mt-1 inline-flex items-center bg-black/20 rounded-full px-2 py-0.5">
                        <span id="settings-menu-role" class="text-[10px] font-medium">...</span>
                    </div>
                </div>
        </div>
        
        <!-- Menu Items -->
        <div class="flex-1 overflow-y-auto pb-24 px-2 space-y-2">
            <div class="space-y-1">
                <button id="btn-mobile-settings-profile" class="settings-row w-full bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
                    <div class="flex items-center gap-3">
                        <div class="p-2 bg-blue-50 rounded-full text-primary"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg></div>
                        <span class="text-sm font-medium text-gray-700" data-i18n="settings_profile">Hồ sơ Cá Nhân</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>

                <button id="btn-mobile-settings-admin" class="settings-row w-full bg-white rounded-lg shadow-sm p-4 flex justify-between items-center hidden">
                     <div class="flex items-center gap-3">
                        <div class="p-2 bg-purple-50 rounded-full text-purple-600"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg></div>
                        <span class="text-sm font-medium text-gray-700" data-i18n="settings_admin">Quản Lý Người Dùng</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
                
                <button id="btn-mobile-settings-system" class="settings-row w-full bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
                    <div class="flex items-center gap-3">
                         <div class="p-2 bg-green-50 rounded-full text-green-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0 3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826 3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg></div>
                        <span class="text-sm font-medium text-gray-700" data-i18n="settings_system">Hệ Thống</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>

                <button id="btn-mobile-settings-about" class="settings-row w-full bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
                    <div class="flex items-center gap-3">
                         <div class="p-2 bg-orange-50 rounded-full text-orange-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
                        <span class="text-sm font-medium text-gray-700" data-i18n="settings_about">Giới Thiệu</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>

                <button id="btn-mobile-settings-support" class="settings-row w-full bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
                    <div class="flex items-center gap-3">
                         <div class="p-2 bg-teal-50 rounded-full text-teal-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path></svg></div>
                        <span class="text-sm font-medium text-gray-700" data-i18n="settings_support">Hỗ Trợ</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
            </div>

            <button id="logout-btn" class="w-full bg-white border border-red-100 text-red-600 rounded-lg shadow-sm p-4 flex justify-center items-center font-medium mt-4 hover:bg-red-50">
                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                <span data-i18n="nav_logout">Đăng Xuất</span>
            </button>
        </div>
    </div>

    <!-- 2. DETAIL CONTENT VIEW (Hidden by default) -->
    <div id="mobile-settings-detail" class="absolute inset-0 flex flex-col bg-white transition-transform duration-300 transform translate-x-full z-20">
        <div class="flex items-center p-3 border-b bg-white shadow-sm flex-shrink-0">
            <button id="btn-mobile-back" class="p-2 mr-2 rounded-full hover:bg-gray-100 text-gray-600">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <h3 id="mobile-detail-title" class="font-bold text-gray-800 truncate text-lg">Chi Tiết</h3>
        </div>
        <!-- Content Slot -->
        <div id="mobile-settings-content-slot" class="flex-1 overflow-y-auto pb-24"></div>
    </div>
</div>

<!-- TEMPLATES CONTAINER (Hidden) -->
<div id="settings-templates-container" class="hidden">
    <!-- PROFILE TEMPLATE -->
    <div id="tpl-profile" class="p-4 md:p-8">
        <div class="border-b pb-2 mb-4 hidden md:block">
            <h2 class="text-xl font-medium text-gray-800 dark:text-gray-100" data-i18n="pro_title">Hồ sơ của tôi</h2>
        </div>
        <form id="profile-form" class="space-y-6 max-w-3xl">
            <div class="flex flex-col-reverse md:flex-row gap-8">
                <div class="flex-1 space-y-5">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                        <label class="text-sm text-gray-600 dark:text-gray-300 md:text-right md:mr-4" data-i18n="label_fullname">Họ và Tên</label>
                        <div class="md:col-span-2">
                            <input type="text" id="profile-ho-ten" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm transition-colors">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                        <label class="text-sm text-gray-600 dark:text-gray-300 md:text-right md:mr-4"><span data-i18n="label_old_pass">Mật khẩu cũ</span> <span class="text-red-500">*</span></label>
                        <div class="md:col-span-2">
                            <input type="password" id="profile-old-password" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                        <label class="text-sm text-gray-600 dark:text-gray-300 md:text-right md:mr-4" data-i18n="label_new_pass">Mật khẩu mới</label>
                        <div class="md:col-span-2">
                            <input type="password" id="profile-new-password" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                        <label class="text-sm text-gray-600 dark:text-gray-300 md:text-right md:mr-4" data-i18n="label_confirm_password">Xác nhận MK</label>
                        <div class="md:col-span-2">
                            <input type="password" id="profile-confirm-password" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
                        <div class="md:col-start-2 md:col-span-2">
                            <button type="submit" class="bg-primary hover-bg-primary text-white font-medium py-2.5 px-6 rounded-sm shadow-sm transition-opacity text-sm" data-i18n="btn_save">Lưu Thay Đổi</button>
                        </div>
                    </div>
                </div>

                <div class="w-full md:w-64 flex flex-col items-center justify-start md:border-l md:pl-8 dark:border-gray-700">
                    <div id="profile-image-paste-area" tabindex="0" class="w-24 h-24 rounded-full border-2 border-gray-200 dark:border-gray-600 overflow-hidden mb-4 relative group cursor-pointer">
                        <img id="profile-image-preview" src="" class="w-full h-full object-cover">
                        <div class="absolute inset-0 bg-black bg-opacity-30 hidden group-hover:flex items-center justify-center text-white text-xs">Sửa</div>
                    </div>
                    <label for="profile-image-upload" class="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-200 px-4 py-2 rounded-sm text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors shadow-sm">
                        <span data-i18n="btn_upload">Chọn Ảnh</span>
                        <input id="profile-image-upload" type="file" class="sr-only" accept="image/*">
                    </label>
                    <div class="mt-3 text-xs text-gray-400 text-center">
                        Max: 1 MB<br>Format: .JPEG, .PNG
                    </div>
                    <button type="button" id="profile-remove-image-btn" class="hidden mt-2 text-xs text-red-500 hover:underline">Xóa ảnh</button>
                    <input type="hidden" id="profile-current-avatar-url">
                </div>
            </div>
        </form>
    </div>

    <!-- ADMIN TEMPLATE -->
    <div id="tpl-admin" class="p-4 md:p-8 h-full flex flex-col">
        <div class="border-b pb-2 mb-4 hidden md:block">
            <h2 class="text-xl font-medium text-gray-800 dark:text-white" data-i18n="settings_admin">Quản lý Người Dùng</h2>
        </div>
        <div class="flex-1 border rounded-sm bg-gray-50 dark:bg-gray-900 dark:border-gray-700 overflow-hidden flex flex-col min-h-[300px]">
            <div class="bg-white dark:bg-gray-800 p-3 border-b dark:border-gray-700 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Danh sách tài khoản</div>
            <div id="user-list-body" class="overflow-y-auto p-0 flex-1 h-full"></div>
        </div>
    </div>

    <!-- SYSTEM TEMPLATE -->
    <div id="tpl-system" class="p-4 md:p-8">
            <div class="border-b pb-2 mb-4 hidden md:block">
            <h2 class="text-xl font-medium text-gray-800 dark:text-white" data-i18n="settings_system">Cấu hình Hệ Thống</h2>
        </div>
        <div class="space-y-6 max-w-2xl">
            <!-- Dark Mode (Same Row) -->
            <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-200"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg></div>
                    <div>
                        <p class="font-medium text-gray-800 dark:text-white text-base" data-i18n="sys_dark_mode">Chế độ tối</p>
                    </div>
                </div>
                <div class="relative inline-block w-12 align-middle select-none flex-shrink-0">
                    <input type="checkbox" id="toggle-dark-mode" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer transition-all duration-300 left-0"/>
                    <label for="toggle-dark-mode" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 dark:bg-gray-600 cursor-pointer"></label>
                </div>
                <style>
                    .toggle-checkbox:checked { right: 0; left: auto; border-color: var(--primary-color); }
                    .toggle-checkbox:checked + .toggle-label { background-color: var(--primary-color); }
                </style>
            </div>

            <hr class="border-gray-100 dark:border-gray-700">

            <!-- Language Selector (Same Row) -->
            <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-200">
                       <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.204 12.848a6 6 0 00-9.941-9.092m4.688 6.812a6 6 0 119.09-9.092m-7.09 7.09l1.83-5.49"></path></svg>
                    </div>
                    <div>
                        <p class="font-medium text-gray-800 dark:text-white text-base" data-i18n="sys_language">Ngôn ngữ</p>
                    </div>
                </div>
                <div class="flex gap-3">
                    <button class="lang-flag w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden shadow-sm border border-gray-200 opacity-50 grayscale" data-lang="vi" title="Tiếng Việt">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Flag_of_Vietnam.svg/125px-Flag_of_Vietnam.svg.png" class="w-full h-full object-cover">
                    </button>
                    <button class="lang-flag w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden shadow-sm border border-gray-200 opacity-50 grayscale" data-lang="en" title="English">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Flag_of_the_United_Kingdom_%281-2%29.svg/125px-Flag_of_the_United_Kingdom_%281-2%29.svg.png" class="w-full h-full object-cover">
                    </button>
                </div>
            </div>

            <hr class="border-gray-100 dark:border-gray-700">

            <!-- Font Size (Same Row) -->
            <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-200"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg></div>
                    <div>
                        <p class="font-medium text-gray-800 dark:text-white text-base" data-i18n="sys_font_size">Cỡ chữ</p>
                    </div>
                </div>
                <div class="w-32 md:w-48">
                    <input type="range" id="font-size-slider" min="1" max="5" step="1" value="3" class="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-600 z-20 relative">
                    <div class="flex justify-between px-1.5 mt-1">
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
                        <div class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
                    </div>
                </div>
            </div>

            <hr class="border-gray-100 dark:border-gray-700">
            
            <!-- Theme Color (Same Row) -->
            <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-200"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg></div>
                    <div>
                        <p class="font-medium text-gray-800 dark:text-white text-base" data-i18n="sys_theme">Màu chủ đạo</p>
                    </div>
                </div>
                <div class="flex gap-2 md:gap-3">
                    <button class="theme-color-btn w-6 h-6 md:w-8 md:h-8 rounded-full bg-blue-600 hover:scale-110 transition-transform ring-2 ring-offset-2 ring-transparent focus:ring-blue-600" data-color="#2563eb"></button>
                    <button class="theme-color-btn w-6 h-6 md:w-8 md:h-8 rounded-full bg-red-600 hover:scale-110 transition-transform ring-2 ring-offset-2 ring-transparent focus:ring-red-600" data-color="#dc2626"></button>
                    <button class="theme-color-btn w-6 h-6 md:w-8 md:h-8 rounded-full bg-green-600 hover:scale-110 transition-transform ring-2 ring-offset-2 ring-transparent focus:ring-green-600" data-color="#16a34a"></button>
                    <button class="theme-color-btn w-6 h-6 md:w-8 md:h-8 rounded-full bg-orange-500 hover:scale-110 transition-transform ring-2 ring-offset-2 ring-transparent focus:ring-orange-500" data-color="#f97316"></button>
                    <button class="theme-color-btn w-6 h-6 md:w-8 md:h-8 rounded-full bg-purple-600 hover:scale-110 transition-transform ring-2 ring-offset-2 ring-transparent focus:ring-purple-600" data-color="#9333ea"></button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- ABOUT TEMPLATE -->
    <div id="tpl-about" class="p-4 md:p-8">
            <div class="text-center py-10">
                <img src="https://images.seeklogo.com/logo-png/50/1/johnson-johnson-logo-png_seeklogo-500414.png" class="w-24 h-24 mx-auto mb-6 rounded-full bg-white p-1 border shadow-sm">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-white mb-2">WH-B4 CRM</h2>
                <p class="text-gray-500 dark:text-gray-400 mb-8">Phiên bản 1.0.0 (Beta)</p>
                
                <div class="max-w-md mx-auto bg-white dark:bg-gray-800 rounded-sm border border-gray-200 dark:border-gray-700 text-left overflow-hidden">
                    <div class="p-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                        <h3 class="font-semibold text-gray-700 dark:text-gray-200 text-sm uppercase" data-i18n="settings_about">Thông tin</h3>
                    </div>
                    <div class="p-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                        <div class="flex justify-between border-b dark:border-gray-700 border-dashed pb-2"><span>Developer</span><span class="font-medium text-gray-900 dark:text-white">Thai Trung Tin</span></div>
                        <div class="flex justify-between border-b dark:border-gray-700 border-dashed pb-2"><span>Liên hệ</span><span class="font-medium text-primary">tin.thai@example.com</span></div>
                        <div class="flex justify-between"><span>Nền tảng</span><span class="font-medium text-gray-900 dark:text-white">Supabase & JS Native</span></div>
                    </div>
                </div>
                <p class="text-xs text-gray-400 mt-8">© 2024 All rights reserved.</p>
            </div>
    </div>
    
    <!-- SUPPORT TEMPLATE -->
    <div id="tpl-support" class="p-4 md:p-8">
            <div class="flex flex-col items-center justify-center h-full py-20 text-center">
            <svg class="w-20 h-20 text-gray-200 dark:text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
            <h3 class="text-xl text-gray-800 dark:text-white font-medium" data-i18n="settings_support">Trung tâm hỗ trợ</h3>
            <p class="text-gray-500 dark:text-gray-400 text-sm mt-2 max-w-xs">Tính năng chat với hỗ trợ viên và gửi ticket đang được xây dựng.</p>
        </div>
    </div>
</div>

<!-- VIEWER CONFIGURATION MODAL (For User Management) -->
<div id="viewer-modal" class="hidden fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop p-4">
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-xl">
            <div>
                <h3 class="text-lg font-bold text-gray-800 dark:text-white">Cấu hình xem dữ liệu</h3>
                <p id="viewer-user-gmail" class="text-sm text-gray-500 dark:text-gray-400 mt-1"></p>
            </div>
            <button id="close-viewer-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
        <div class="p-3 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
            <input type="text" id="viewer-search" placeholder="Tìm kiếm người dùng/PSR..." class="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none">
        </div>
        <div class="flex-1 overflow-y-auto p-4 custom-scrollbar bg-white dark:bg-gray-800">
            <div id="viewer-list-container" class="space-y-2">
                <!-- Checkboxes injected here -->
                <div class="text-center text-gray-500 text-sm">Đang tải danh sách...</div>
            </div>
        </div>
        <div class="p-4 border-t dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800 rounded-b-xl">
            <button id="cancel-viewer-btn" class="px-4 py-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium text-sm">Hủy</button>
            <button id="save-viewer-btn" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md text-sm">Lưu cấu hình</button>
        </div>
    </div>
</div>
`;

// --- INITIALIZATION ---

export async function initCaiDatView() {
    // --- Navigation Event Listeners (Map buttons to Tabs) ---
    const mapBtnToTab = [
        { btn: 'btn-settings-profile', tab: 'profile', title: 'Hồ sơ Cá Nhân' },
        { btn: 'btn-settings-admin', tab: 'admin', title: 'Quản Lý Người Dùng' },
        { btn: 'btn-settings-system', tab: 'system', title: 'Cấu hình Hệ Thống' },
        { btn: 'btn-settings-about', tab: 'about', title: 'Giới Thiệu' },
        { btn: 'btn-settings-support', tab: 'support', title: 'Trung tâm Hỗ Trợ' },
        
        { btn: 'btn-mobile-settings-profile', tab: 'profile', title: 'Hồ sơ Cá Nhân' },
        { btn: 'btn-mobile-settings-admin', tab: 'admin', title: 'Quản Lý Người Dùng' },
        { btn: 'btn-mobile-settings-system', tab: 'system', title: 'Cấu hình Hệ Thống' },
        { btn: 'btn-mobile-settings-about', tab: 'about', title: 'Giới Thiệu' },
        { btn: 'btn-mobile-settings-support', tab: 'support', title: 'Trung tâm Hỗ Trợ' },
    ];

    mapBtnToTab.forEach(mapping => {
        const el = document.getElementById(mapping.btn);
        if(el) {
            el.onclick = () => openSettingsTab(mapping.tab, mapping.title);
        }
    });

    // Link Edit Profile button in desktop sidebar
    const btnEditProfile = document.getElementById('btn-settings-profile-edit');
    if(btnEditProfile) {
        btnEditProfile.onclick = (e) => {
            e.preventDefault();
            openSettingsTab('profile', 'Hồ sơ Cá Nhân');
        };
    }

    // Mobile Back Button
    const backBtn = document.getElementById('btn-mobile-back');
    if (backBtn) backBtn.onclick = closeSettingsDetail;

    // Logout listener (Both Mobile and Desktop)
    const logoutBtns = document.querySelectorAll('#logout-btn, #logout-btn-desktop');
    logoutBtns.forEach(btn => {
        btn.onclick = async () => {
            const confirmed = await showConfirm('Bạn có chắc chắn muốn đăng xuất?', 'Xác nhận');
            if (confirmed) {
                handleLogout();
            }
        };
    });

    // Global Popover Close
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.user-options-btn') && !e.target.closest('[id^="options-popover-"]')) {
            document.querySelectorAll('[id^="options-popover-"]').forEach(p => p.classList.add('hidden'));
        }
    });
    
    const pwResetForm = document.getElementById('password-reset-form');
    if (pwResetForm) {
        pwResetForm.onsubmit = handlePasswordReset;
    }

    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    if (cancelResetBtn) {
        cancelResetBtn.onclick = () => document.getElementById('password-reset-modal').classList.add('hidden');
    }
    
    // Permission Modal Listeners
    const closePermBtn = document.getElementById('close-perm-btn');
    const cancelPermBtn = document.getElementById('cancel-perm-btn');
    const savePermBtn = document.getElementById('save-perm-btn');
    
    if(closePermBtn) closePermBtn.onclick = closePermissionModal;
    if(cancelPermBtn) cancelPermBtn.onclick = closePermissionModal;
    if(savePermBtn) savePermBtn.onclick = savePermissions;

    // Viewer Modal Listeners
    const closeViewerBtn = document.getElementById('close-viewer-btn');
    const cancelViewerBtn = document.getElementById('cancel-viewer-btn');
    const saveViewerBtn = document.getElementById('save-viewer-btn');
    const viewerSearch = document.getElementById('viewer-search');

    if(closeViewerBtn) closeViewerBtn.onclick = closeViewerModal;
    if(cancelViewerBtn) cancelViewerBtn.onclick = closeViewerModal;
    if(saveViewerBtn) saveViewerBtn.onclick = saveViewers;
    if(viewerSearch) viewerSearch.addEventListener('input', filterViewerList);
}

// Function called by app.js every time the view is shown
export async function onShowCaiDatView() {
    if (!isViewLoaded) {
        try {
            // Inject HTML directly from JS
            const container = document.getElementById('view-cai-dat');
            if (container) {
                container.innerHTML = VIEW_TEMPLATE;
                // Trigger translation immediately after injection
                setLanguage(getCurrentLanguage());
                
                await initCaiDatView();
                isViewLoaded = true;
            }
        } catch (error) {
            console.error("Error loading settings view:", error);
            showToast("Lỗi tải giao diện cài đặt", "error");
            return;
        }
    }
    
    // Always reset to list view on Mobile when showing tab again
    if (window.innerWidth < 768) {
        closeSettingsDetail();
    }

    // Ensure we re-translate when showing the view again
    setLanguage(getCurrentLanguage());

    // On Desktop: If content slot is empty, open default tab (Profile)
    if (window.innerWidth >= 768) {
        const slot = document.getElementById('desktop-settings-content-slot');
        if (slot && (!slot.hasChildNodes() || slot.innerHTML.trim() === '')) {
            openSettingsTab('profile', 'Hồ sơ Cá Nhân');
        }
    }

    initProfileAvatarState();
    const nameInput = document.getElementById('profile-ho-ten');
    if(nameInput && currentUser) nameInput.value = currentUser.ho_ten || '';

    if (currentUser) {
        const isAdmin = currentUser.phan_quyen === 'Admin';
        const btnDesktopAdmin = document.getElementById('btn-settings-admin');
        const btnMobileAdmin = document.getElementById('btn-mobile-settings-admin');
        
        if(btnDesktopAdmin) btnDesktopAdmin.classList.toggle('hidden', !isAdmin);
        if(btnMobileAdmin) btnMobileAdmin.classList.toggle('hidden', !isAdmin);

        // Fetch if open
        const desktopSlot = document.getElementById('desktop-settings-content-slot');
        if (isAdmin && window.innerWidth >= 768 && desktopSlot && desktopSlot.querySelector('#user-list-body')) {
             fetchUsers();
        }
        
        const desktopName = document.getElementById('settings-desktop-name');
        const desktopAvatar = document.getElementById('settings-desktop-avatar');
        if(desktopName) desktopName.textContent = currentUser.ho_ten || 'User';
        if(desktopAvatar) desktopAvatar.src = currentUser.anh_dai_dien_url || DEFAULT_AVATAR_URL;
    }
}

function injectContent(tabName) {
    const templateId = `tpl-${tabName}`;
    const template = document.getElementById(templateId);
    if (!template) return;

    const isDesktop = window.innerWidth >= 768;
    let slot;

    if (isDesktop) {
        slot = document.getElementById('desktop-settings-content-slot');
    } else {
        slot = document.getElementById('mobile-settings-content-slot');
    }

    if(slot) {
        slot.innerHTML = '';
        const clone = template.cloneNode(true);
        clone.removeAttribute('id');
        slot.appendChild(clone);
    }
    
    attachDynamicListeners(tabName);
    setLanguage(getCurrentLanguage());
}

function openSettingsTab(tabName, title) {
    if (window.innerWidth < 768) {
        // Mobile Logic: Slide List out, Slide Detail in
        const listEl = document.getElementById('mobile-settings-list');
        const detailEl = document.getElementById('mobile-settings-detail');
        const titleEl = document.getElementById('mobile-detail-title');

        if (listEl && detailEl) {
            listEl.classList.add('-translate-x-full');
            detailEl.classList.remove('translate-x-full');
            detailEl.classList.add('translate-x-0');
        }
        
        if (titleEl) titleEl.textContent = title;
        injectContent(tabName);
        
    } else {
        // Desktop Logic
        const desktopMenu = document.getElementById('desktop-settings-menu');
        if (desktopMenu) {
            desktopMenu.querySelectorAll('.settings-row').forEach(row => {
                row.classList.remove('bg-primary-light', 'text-primary');
                row.classList.add('text-gray-700');
                // Reset icon colors
                const icon = row.querySelector('svg');
                if(icon) icon.classList.remove('text-primary');
                if(icon) icon.classList.add('text-gray-400');
                
                // Special handling for logout button color reset
                if(row.id === 'logout-btn-desktop') {
                    row.classList.remove('bg-primary-light', 'text-primary');
                    row.classList.add('text-red-600');
                    const logoutIcon = row.querySelector('svg');
                    if(logoutIcon) logoutIcon.classList.remove('text-primary');
                    if(logoutIcon) logoutIcon.classList.add('text-red-400');
                }
            });
            
            // Only activate if it's NOT logout button
            if (tabName !== 'logout') {
                const activeBtn = document.getElementById(`btn-settings-${tabName}`);
                if(activeBtn) {
                    activeBtn.classList.remove('text-gray-700');
                    activeBtn.classList.add('bg-primary-light', 'text-primary');
                     // Active icon color
                    const icon = activeBtn.querySelector('svg');
                    if(icon) icon.classList.remove('text-gray-400');
                    if(icon) icon.classList.add('text-primary');
                }
            }
        }
        injectContent(tabName);
    }
    
    if (tabName === 'admin') fetchUsers();
    if (tabName === 'system') initSystemSettings();
    if (tabName === 'profile') {
        initProfileAvatarState();
        const nameInput = document.getElementById('profile-ho-ten');
        if(nameInput && currentUser) nameInput.value = currentUser.ho_ten || '';
    }
}

function closeSettingsDetail() {
    if (window.innerWidth >= 768) return;
    
    const listEl = document.getElementById('mobile-settings-list');
    const detailEl = document.getElementById('mobile-settings-detail');
    
    if (listEl && detailEl) {
        listEl.classList.remove('-translate-x-full');
        detailEl.classList.remove('translate-x-0');
        detailEl.classList.add('translate-x-full');
    }
}

function attachDynamicListeners(tabName) {
    const isDesktop = window.innerWidth >= 768;
    const activeContainer = isDesktop
        ? document.getElementById('desktop-settings-content-slot') 
        : document.getElementById(`mobile-settings-content-slot`);

    if (!activeContainer) return;

    if (tabName === 'profile') {
        const form = activeContainer.querySelector('#profile-form');
        if (form) form.onsubmit = handleProfileUpdate;
        
        const imgUpload = activeContainer.querySelector('#profile-image-upload');
        if (imgUpload) imgUpload.onchange = (e) => processAvatarFile(e.target.files[0]);
        
        const removeBtn = activeContainer.querySelector('#profile-remove-image-btn');
        if (removeBtn) removeBtn.onclick = clearSelectedAvatar;
        
        const pasteArea = activeContainer.querySelector('#profile-image-paste-area');
        if (pasteArea) {
            pasteArea.onpaste = (e) => {
                e.preventDefault();
                const items = e.clipboardData.items;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        processAvatarFile(items[i].getAsFile());
                        return;
                    }
                }
            };
        }
        initProfileAvatarState();
    }

    if (tabName === 'admin') {
        // Refresh button removed as requested

        const userListBody = activeContainer.querySelector('#user-list-body');
        if (userListBody) {
            userListBody.onchange = e => {
                if(e.target.classList.contains('user-role-select')) handleRoleChange(e);
            };
            
            userListBody.onclick = e => {
                const resetBtn = e.target.closest('.reset-password-btn');
                if (resetBtn) {
                    openPasswordResetModal(resetBtn.dataset.gmail);
                    return;
                }
                const permBtn = e.target.closest('.permission-btn');
                if (permBtn) {
                    const gmail = permBtn.dataset.gmail;
                    const user = cache.userList.find(u => u.gmail === gmail);
                    if(user) openPermissionModal(user);
                    return;
                }
                const viewerBtn = e.target.closest('.viewer-config-btn');
                if (viewerBtn) {
                    const gmail = viewerBtn.dataset.gmail;
                    const user = cache.userList.find(u => u.gmail === gmail);
                    if(user) openViewerModal(user);
                    return;
                }
                const optionsBtn = e.target.closest('.user-options-btn');
                if (optionsBtn) {
                    const gmail = optionsBtn.dataset.gmail;
                    const safeGmail = gmail.replace(/[^a-zA-Z0-9]/g, '');
                    const popover = e.target.closest('div.relative').querySelector('[id^="options-popover-"]');
                    
                    if (popover) {
                        document.querySelectorAll('[id^="options-popover-"]').forEach(p => {
                            if (p !== popover) p.classList.add('hidden');
                        });
                        popover.classList.toggle('hidden');
                    }
                    e.stopPropagation();
                    return;
                }
                const statusBtn = e.target.closest('.user-status-option');
                if(statusBtn) {
                    handleUpdateUserStatus(statusBtn.dataset.gmail, statusBtn.dataset.status);
                    const popover = statusBtn.closest('[id^="options-popover-"]');
                    if(popover) popover.classList.add('hidden');
                    return;
                }
                const deleteBtn = e.target.closest('.user-delete-option');
                if(deleteBtn) {
                    handleDeleteUser(deleteBtn.dataset.gmail);
                    const popover = deleteBtn.closest('[id^="options-popover-"]');
                    if(popover) popover.classList.add('hidden');
                    return;
                }
            };
        }
        if (cache.userList.length > 0) renderUserList(cache.userList);
    }

    if (tabName === 'system') {
        const darkModeToggle = activeContainer.querySelector('#toggle-dark-mode');
        if (darkModeToggle) {
            const isDark = localStorage.getItem('darkMode') === 'true';
            darkModeToggle.checked = isDark;
            darkModeToggle.onchange = (e) => applyDarkMode(e.target.checked);
        }

        const fontSlider = activeContainer.querySelector('#font-size-slider');
        if (fontSlider) {
            const savedSize = localStorage.getItem('fontSize') || '3';
            fontSlider.value = savedSize;
            fontSlider.oninput = (e) => applyFontSize(e.target.value);
        }

        const colorBtns = activeContainer.querySelectorAll('.theme-color-btn');
        colorBtns.forEach(btn => {
            btn.onclick = () => applyTheme(btn.dataset.color);
        });
        
        // Language Listeners inside System Tab
        const langBtns = activeContainer.querySelectorAll('.lang-flag');
        langBtns.forEach(btn => {
            btn.onclick = () => {
                setLanguage(btn.dataset.lang);
            };
        });
        
        // Update initial state of flags
        setLanguage(getCurrentLanguage());
    }
}


// ... System Settings Logic and Data Handling (same as before) ...

function initSystemSettings() {
    // Handled in attachDynamicListeners
}

export function applyDarkMode(isDark) {
    if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
    }
}

export function applyFontSize(level) {
    let size = '100%';
    switch(String(level)) {
        case '1': size = '75%'; break;
        case '2': size = '87.5%'; break;
        case '3': size = '100%'; break;
        case '4': size = '112.5%'; break;
        case '5': size = '125%'; break;
        default: size = '100%';
    }
    document.documentElement.style.fontSize = size;
    localStorage.setItem('fontSize', level);
}

export function applyTheme(colorHex) {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', colorHex);
    let lightColor = colorHex; 
    if(colorHex === '#2563eb') lightColor = '#eff6ff';
    else if(colorHex === '#dc2626') lightColor = '#fef2f2';
    else if(colorHex === '#16a34a') lightColor = '#f0fdf4';
    else if(colorHex === '#f97316') lightColor = '#fff7ed';
    else if(colorHex === '#9333ea') lightColor = '#faf5ff';
    root.style.setProperty('--primary-bg-light', lightColor);
    localStorage.setItem('themeColor', colorHex);
}


// --- Logic (Data Handling) ---

async function handleProfileUpdate(e) {
    e.preventDefault();
    
    const form = e.target;
    const ho_ten = form.querySelector('#profile-ho-ten').value;
    const old_password = form.querySelector('#profile-old-password').value;
    const new_password = form.querySelector('#profile-new-password').value;
    const confirm_password = form.querySelector('#profile-confirm-password').value;
    let anh_dai_dien_url = form.querySelector('#profile-current-avatar-url').value;
    const old_anh_dai_dien_url = currentUser.anh_dai_dien_url;

    showLoading(true);

    try {
        const { data: userCheck, error: checkError } = await sb
            .from('user')
            .select('mat_khau')
            .eq('gmail', currentUser.gmail)
            .single();

        if (checkError || !userCheck) {
            throw new Error("Lỗi kết nối khi kiểm tra mật khẩu.");
        }
        
        if (userCheck.mat_khau !== old_password) {
            throw new Error("Mật khẩu cũ không chính xác.");
        }

        if (new_password) {
            if (new_password !== confirm_password) {
                throw new Error("Mật khẩu mới không khớp.");
            }
        }
        
        if (ho_ten !== currentUser.ho_ten) {
            const { count, error } = await sb
                .from('user')
                .select('ho_ten', { count: 'exact', head: true })
                .eq('ho_ten', ho_ten)
                .neq('gmail', currentUser.gmail);

            if (error) throw error;
            if (count > 0) throw new Error('Tên này đã được người dùng khác sử dụng.');
        }

        if (selectedAvatarFile) {
            const safeFileName = sanitizeFileName(`${currentUser.gmail}-${Date.now()}-${selectedAvatarFile.name}`);
            const filePath = `public/${safeFileName}`;
            const { error: uploadError } = await sb.storage.from('anh_dai_dien').upload(filePath, selectedAvatarFile);
            if (uploadError) throw new Error(`Lỗi tải ảnh lên: ${uploadError.message}`);
            const { data: urlData } = sb.storage.from('anh_dai_dien').getPublicUrl(filePath);
            anh_dai_dien_url = urlData.publicUrl;
        } 
        
        if ((selectedAvatarFile || !anh_dai_dien_url) && old_anh_dai_dien_url) {
            const oldFileName = old_anh_dai_dien_url.split('/').pop();
            // Optional: remove old file if needed
        }

        const updateData = { ho_ten, anh_dai_dien_url };
        if (new_password) updateData.mat_khau = new_password;

        const { data, error } = await sb.from('user').update(updateData).eq('gmail', currentUser.gmail).select().single();
        if (error) throw error;
        
        showToast("Cập nhật thông tin thành công!", "success");
        sessionStorage.setItem('loggedInUser', JSON.stringify(data));
        setCurrentUser(data);
        
        const userHoTenEl = document.getElementById('user-ho-ten');
        if(userHoTenEl) userHoTenEl.textContent = data.ho_ten || 'User';
        updateSidebarAvatar(data.anh_dai_dien_url);

        form.reset();
        const nameInput = form.querySelector('#profile-ho-ten');
        if(nameInput) nameInput.value = data.ho_ten;
        initProfileAvatarState();
        
        const menuAvatar = document.getElementById('settings-menu-avatar');
        const menuName = document.getElementById('settings-menu-name');
        if(menuAvatar) menuAvatar.src = data.anh_dai_dien_url || DEFAULT_AVATAR_URL;
        if(menuName) menuName.textContent = data.ho_ten;

        const desktopName = document.getElementById('settings-desktop-name');
        const desktopAvatar = document.getElementById('settings-desktop-avatar');
        if(desktopName) desktopName.textContent = data.ho_ten;
        if(desktopAvatar) desktopAvatar.src = data.anh_dai_dien_url || DEFAULT_AVATAR_URL;

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

export async function fetchUsers() {
    const { data, error } = await sb.from('user').select('*').order('ho_ten');
    if (error) {
        showToast("Không thể tải danh sách nhân viên.", 'error');
    } else {
        cache.userList = data;
        renderUserList(data);
    }
}

function renderUserList(users) {
    const isDesktop = window.innerWidth >= 768;
    const activeContainer = isDesktop 
            ? document.getElementById('desktop-settings-content-slot') 
            : document.getElementById('mobile-settings-content-slot'); // Target Content Slot
            
    if (!activeContainer) return;
    const userListContainer = activeContainer.querySelector('#user-list-body');
    if (!userListContainer) return;
    
    userListContainer.innerHTML = '';
    
    if (!users || users.length === 0) {
        userListContainer.innerHTML = `<p class="text-center text-gray-500 p-4">Không có người dùng nào.</p>`;
        return;
    }
    
    users.forEach(user => {
        const isCurrentUser = user.gmail === currentUser.gmail;
        const isAdmin = user.phan_quyen === 'Admin';
        const presenceInfo = onlineUsers.get(user.gmail);
        const status = presenceInfo ? (presenceInfo.status || 'online') : 'offline';
        const safeGmail = user.gmail.replace(/[^a-zA-Z0-9]/g, '');

        let onlineIndicatorHtml = '';
        if (status !== 'offline') {
            const statusColor = status === 'away' ? 'bg-yellow-400' : 'bg-green-500';
            onlineIndicatorHtml = `<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full ${statusColor} border-2 border-white dark:border-gray-800 ring-1 ring-gray-300 dark:ring-gray-600"></span>`;
        }
        
        let gmailClass = '';
        let statusText = user.stt || 'Chờ Duyệt';
        switch (statusText) {
            case 'Đã Duyệt': gmailClass = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'; break;
            case 'Khóa': gmailClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'; break;
            default: gmailClass = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'; statusText = 'Chờ Duyệt';
        }

        let statusOptionsHtml = '';
        if (user.stt === 'Khóa') {
            statusOptionsHtml += `<button class="user-status-option block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700" data-gmail="${user.gmail}" data-status="Đã Duyệt">Mở Khóa</button>`;
        } else {
            if (user.stt !== 'Đã Duyệt') {
                statusOptionsHtml += `<button class="user-status-option block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700" data-gmail="${user.gmail}" data-status="Đã Duyệt">Duyệt</button>`;
            }
            statusOptionsHtml += `<button class="user-status-option block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700" data-gmail="${user.gmail}" data-status="Khóa">Khóa</button>`;
        }

        const isPermDisabled = isCurrentUser || isAdmin;
        const permBtnClass = isPermDisabled 
            ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600" 
            : "bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-800/50 border-green-100 dark:border-green-800";
        
        // Parse viewers count
        let viewerCount = 0;
        try {
            if (user.viewer) {
                const viewers = JSON.parse(user.viewer);
                if (Array.isArray(viewers)) viewerCount = viewers.length;
            }
        } catch(e) {}

        const viewerBtnClass = "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-800/50 border-blue-100 dark:border-blue-800";

        const row = document.createElement('div');
        row.className = 'p-3 md:p-4 border-b border-gray-100 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors last:border-0 dark:border-gray-700';
        row.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4">
                <div class="flex-grow flex items-center gap-3 md:gap-4">
                        <div class="relative flex-shrink-0">
                        <img src="${user.anh_dai_dien_url || DEFAULT_AVATAR_URL}" alt="Avatar" class="w-10 h-10 rounded-full object-cover border dark:border-gray-600">
                        ${onlineIndicatorHtml}
                        </div>
                    <div class="overflow-hidden">
                        <p class="font-semibold text-gray-900 dark:text-gray-100 truncate">${user.ho_ten}</p>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-xs text-gray-500 dark:text-gray-400 truncate">${user.gmail}</span>
                            <span class="text-[10px] px-1.5 py-0.5 rounded-full ${gmailClass}" title="Trạng thái: ${statusText}">${statusText}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center justify-end gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t border-gray-50 sm:border-t-0 dark:border-gray-700 sm:dark:border-none flex-nowrap whitespace-nowrap">
                    <select data-gmail="${user.gmail}" class="user-role-select border border-gray-300 dark:border-gray-600 rounded p-1.5 text-xs sm:text-sm w-20 sm:w-24 bg-white dark:bg-gray-700 dark:text-gray-200 focus:ring-1 focus:ring-primary outline-none" ${isCurrentUser ? 'disabled' : ''}>
                        <option value="Admin" ${user.phan_quyen === 'Admin' ? 'selected' : ''}>Admin</option>
                        <option value="User" ${user.phan_quyen === 'User' ? 'selected' : ''}>User</option>
                        <option value="View" ${user.phan_quyen === 'View' ? 'selected' : ''}>View</option>
                    </select>
                    <button data-gmail="${user.gmail}" class="viewer-config-btn text-xs ${viewerBtnClass} font-medium px-3 py-2 rounded border transition-colors whitespace-nowrap" title="Cấu hình xem dữ liệu">
                        Data (${viewerCount})
                    </button>
                    <button data-gmail="${user.gmail}" class="reset-password-btn text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-800/50 font-medium px-3 py-2 rounded border border-indigo-100 dark:border-indigo-800 transition-colors whitespace-nowrap" ${isCurrentUser ? 'disabled' : ''}>
                        Đặt lại MK
                    </button>
                    <button data-gmail="${user.gmail}" class="permission-btn text-xs ${permBtnClass} font-medium px-3 py-2 rounded border transition-colors whitespace-nowrap" ${isPermDisabled ? 'disabled' : ''} data-i18n="btn_permission">
                        Phân quyền
                    </button>
                    <div class="relative">
                        <button data-gmail="${user.gmail}" class="user-options-btn p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" ${isCurrentUser ? 'disabled' : ''}>
                            <svg class="w-5 h-5 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>
                        </button>
                        <div id="options-popover-${safeGmail}" class="hidden absolute right-0 mt-2 w-40 bg-white dark:bg-gray-700 rounded-lg shadow-xl py-1 z-20 border border-gray-100 dark:border-gray-600 ring-1 ring-black ring-opacity-5">
                            ${statusOptionsHtml}
                            <div class="border-t border-gray-100 dark:border-gray-600 my-1"></div>
                            <button class="user-delete-option block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" data-gmail="${user.gmail}">Xóa Tài Khoản</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        userListContainer.appendChild(row);
    });
    setLanguage(getCurrentLanguage()); // Translate new buttons
}

// --- Viewer Modal Logic ---

async function fetchViewerSourceData() {
    if (cachedPotentialViewers) return cachedPotentialViewers;

    try {
        // Run in parallel for speed
        const [listingRes, userRes] = await Promise.all([
            sb.from('listing').select('psr'),
            sb.from('user').select('ho_ten')
        ]);

        const psrList = listingRes.data ? listingRes.data.map(l => l.psr).filter(p => p && p.trim()) : [];
        const userList = userRes.data ? userRes.data.map(u => u.ho_ten).filter(n => n && n.trim()) : [];

        // 3. Merge and Sort
        const combined = [...new Set([...psrList, ...userList])].sort((a, b) => a.localeCompare(b));
        
        cachedPotentialViewers = combined;
        return combined;
    } catch (e) {
        console.error("Error fetching viewer options", e);
        return [];
    }
}

async function openViewerModal(user) {
    currentViewerUserGmail = user.gmail;
    const modal = document.getElementById('viewer-modal');
    const titleUser = document.getElementById('viewer-user-gmail');
    const container = document.getElementById('viewer-list-container');
    const searchInput = document.getElementById('viewer-search');

    if (!modal || !container) return;

    titleUser.textContent = `${user.ho_ten} (${user.gmail})`;
    searchInput.value = ''; // Reset search
    container.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">Đang tải danh sách...</div>';
    modal.classList.remove('hidden');

    const options = await fetchViewerSourceData();
    
    // Parse current selection
    let currentSelection = [];
    try {
        if (user.viewer) {
            currentSelection = JSON.parse(user.viewer);
            if (!Array.isArray(currentSelection)) currentSelection = [];
        }
    } catch(e) { currentSelection = []; }

    renderViewerList(options, currentSelection);
}

function renderViewerList(options, selectedItems) {
    const container = document.getElementById('viewer-list-container');
    container.innerHTML = '';

    if (options.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 text-sm">Không có dữ liệu để chọn.</div>';
        return;
    }

    options.forEach(name => {
        const isChecked = selectedItems.includes(name);
        const div = document.createElement('div');
        div.className = 'viewer-item flex items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer';
        div.innerHTML = `
            <input type="checkbox" class="viewer-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700" value="${name}" ${isChecked ? 'checked' : ''}>
            <span class="ml-3 text-sm text-gray-700 dark:text-gray-200">${name}</span>
        `;
        div.onclick = (e) => {
            if (e.target.type !== 'checkbox') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
            }
        };
        container.appendChild(div);
    });
}

function filterViewerList() {
    const term = document.getElementById('viewer-search').value.toLowerCase();
    const items = document.querySelectorAll('.viewer-item');
    items.forEach(item => {
        const name = item.querySelector('span').textContent.toLowerCase();
        if (name.includes(term)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

function closeViewerModal() {
    document.getElementById('viewer-modal').classList.add('hidden');
    currentViewerUserGmail = null;
}

async function saveViewers() {
    if (!currentViewerUserGmail) return;

    const selected = [];
    document.querySelectorAll('.viewer-checkbox:checked').forEach(cb => {
        selected.push(cb.value);
    });

    showLoading(true);
    try {
        const { error } = await sb.from('user')
            .update({ viewer: JSON.stringify(selected) })
            .eq('gmail', currentViewerUserGmail);

        if (error) throw error;

        showToast("Cập nhật cấu hình xem thành công!", "success");
        closeViewerModal();
        fetchUsers(); // Refresh main list to update count
    } catch (e) {
        showToast("Lỗi khi lưu: " + e.message, "error");
    } finally {
        showLoading(false);
    }
}

// ... (Existing Permission Modal functions: openPermissionModal, closePermissionModal, savePermissions) ...

function openPermissionModal(user) {
    currentEditingUserGmail = user.gmail;
    const modal = document.getElementById('permission-modal');
    const title = document.getElementById('perm-user-gmail');
    const tbody = document.getElementById('perm-table-body');
    
    title.textContent = `${user.ho_ten} (${user.gmail})`;
    tbody.innerHTML = '';

    // Parse JSON columns (assuming they are stored as JSON strings or arrays)
    const safeParse = (data) => {
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch(e) { return []; }
        }
        return [];
    };

    const permissions = {
        xem: safeParse(user.xem),
        them: safeParse(user.them),
        sua: safeParse(user.sua),
        xoa: safeParse(user.xoa),
        nhap: safeParse(user.nhap), 
        xuat: safeParse(user.xuat)
    };

    const lang = getCurrentLanguage();
    const translations = {
        'header_dashboard': { vi: 'Tổng quan', en: 'Dashboard' },
        'header_listing': { vi: 'Danh sách', en: 'Listing' }, 
        'header_detail': { vi: 'Chi tiết', en: 'Detail' },
        'header_product': { vi: 'Sản phẩm', en: 'Product' }
    };

    APP_VIEWS.forEach(view => {
        const label = translations[view.labelI18n] ? translations[view.labelI18n][lang] : view.id;
        
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                ${label}
            </td>
            <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="xem" data-view="${view.id}" ${permissions.xem.includes(view.id) ? 'checked' : ''}>
            </td>
            <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="them" data-view="${view.id}" ${permissions.them.includes(view.id) ? 'checked' : ''}>
            </td>
            <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="sua" data-view="${view.id}" ${permissions.sua.includes(view.id) ? 'checked' : ''}>
            </td>
            <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="xoa" data-view="${view.id}" ${permissions.xoa.includes(view.id) ? 'checked' : ''}>
            </td>
             <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="nhap" data-view="${view.id}" ${permissions.nhap.includes(view.id) ? 'checked' : ''}>
            </td>
             <td class="px-4 py-4 whitespace-nowrap text-center">
                <input type="checkbox" class="perm-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" data-type="xuat" data-view="${view.id}" ${permissions.xuat.includes(view.id) ? 'checked' : ''}>
            </td>
        `;
        tbody.appendChild(tr);
    });

    modal.classList.remove('hidden');
}

function closePermissionModal() {
    document.getElementById('permission-modal').classList.add('hidden');
    currentEditingUserGmail = null;
}

async function savePermissions() {
    if (!currentEditingUserGmail) return;
    
    const permissions = {
        xem: [],
        them: [],
        sua: [],
        xoa: [],
        nhap: [],
        xuat: []
    };

    document.querySelectorAll('.perm-checkbox:checked').forEach(cb => {
        const type = cb.dataset.type;
        const viewId = cb.dataset.view;
        if(permissions[type]) {
            permissions[type].push(viewId);
        }
    });

    showLoading(true);
    try {
        const { error } = await sb.from('user').update({
            xem: JSON.stringify(permissions.xem),
            them: JSON.stringify(permissions.them),
            sua: JSON.stringify(permissions.sua),
            xoa: JSON.stringify(permissions.xoa),
            nhap: JSON.stringify(permissions.nhap),
            xuat: JSON.stringify(permissions.xuat)
        }).eq('gmail', currentEditingUserGmail);

        if (error) throw error;

        showToast("Cập nhật quyền thành công!", "success");
        closePermissionModal();
        fetchUsers(); // Refresh list
    } catch (e) {
        showToast("Lỗi khi lưu quyền: " + e.message, "error");
    } finally {
        showLoading(false);
    }
}

// ... (Rest of functions: handleRoleChange, handleUpdateUserStatus, handleDeleteUser, openPasswordResetModal, handlePasswordReset, initProfileAvatarState, clearSelectedAvatar, processAvatarFile) - same as before
async function handleRoleChange(e) {
    const gmail = e.target.dataset.gmail;
    const newRole = e.target.value;
    const originalRole = cache.userList.find(u => u.gmail === gmail)?.phan_quyen;
    if (!originalRole) return;
    const confirmed = await showConfirm(`Bạn có muốn đổi quyền của ${gmail} thành ${newRole}?`);
    if (!confirmed) {
        e.target.value = originalRole; 
        return;
    }
    showLoading(true);
    const { error } = await sb.from('user').update({ phan_quyen: newRole }).eq('gmail', gmail);
    showLoading(false);
    if (error) {
        showToast("Đổi quyền thất bại.", 'error');
        e.target.value = originalRole;
    } else {
        showToast("Đổi quyền thành công.", 'success');
        fetchUsers();
    }
}

async function handleUpdateUserStatus(gmail, newStatus) {
    showLoading(true);
    const { error } = await sb.from('user').update({ stt: newStatus }).eq('gmail', gmail);
    showLoading(false);
    if (error) {
        showToast(`Thay đổi trạng thái thất bại: ${error.message}`, 'error');
    } else {
        showToast("Cập nhật trạng thái thành công.", 'success');
        fetchUsers(); 
    }
}

async function handleDeleteUser(gmail) {
    const userToDelete = cache.userList.find(u => u.gmail === gmail);
    if (!userToDelete) return;
    const confirmed = await showConfirm(`Bạn có chắc muốn xóa vĩnh viễn tài khoản của ${userToDelete.ho_ten}? Hành động này không thể hoàn tác.`);
    if (!confirmed) return;
    showLoading(true);
    try {
        if (userToDelete.anh_dai_dien_url) {
            const oldFileName = userToDelete.anh_dai_dien_url.split('/').pop();
            await sb.storage.from('anh_dai_dien').remove([`public/${oldFileName}`]);
        }
        const { error } = await sb.from('user').delete().eq('gmail', gmail);
        if (error) throw error;
        showToast("Đã xóa tài khoản thành công.", 'success');
        fetchUsers();
    } catch (error) {
        showToast(`Lỗi khi xóa tài khoản: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function openPasswordResetModal(gmail) {
    document.getElementById('reset-user-gmail').value = gmail;
    document.getElementById('reset-user-gmail-display').textContent = gmail;
    document.getElementById('password-reset-modal').classList.remove('hidden');
}

async function handlePasswordReset(e) {
    e.preventDefault();
    const gmail = document.getElementById('reset-user-gmail').value;
    const new_password = document.getElementById('reset-new-password').value;
    showLoading(true);
    const { error } = await sb.from('user').update({ mat_khau: new_password }).eq('gmail', gmail);
    showLoading(false);
    if (error) {
        showToast("Đặt lại mật khẩu thất bại.", 'error');
    } else {
        showToast("Đặt lại mật khẩu thành công.", 'success');
        document.getElementById('password-reset-modal').classList.add('hidden');
        document.getElementById('password-reset-form').reset();
    }
}

export function initProfileAvatarState() {
    selectedAvatarFile = null;
    const currentAvatarUrl = currentUser?.anh_dai_dien_url;
    
    const activeContainer = window.innerWidth >= 768 
            ? document.getElementById('desktop-settings-content-slot') 
            : document.getElementById('mobile-settings-content-slot'); // Target Content Slot
            
    if (!activeContainer) return;

    const preview = activeContainer.querySelector('#profile-image-preview');
    const removeBtn = activeContainer.querySelector('#profile-remove-image-btn');
    const urlInput = activeContainer.querySelector('#profile-current-avatar-url');
    
    if (preview) preview.src = currentAvatarUrl || DEFAULT_AVATAR_URL;
    if (urlInput) urlInput.value = currentAvatarUrl || '';
    if (removeBtn) removeBtn.classList.toggle('hidden', !currentAvatarUrl);
    
    const menuAvatar = document.getElementById('settings-menu-avatar');
    const menuName = document.getElementById('settings-menu-name');
    const menuEmail = document.getElementById('settings-menu-email');
    const menuRole = document.getElementById('settings-menu-role');

    if(menuAvatar) menuAvatar.src = currentAvatarUrl || DEFAULT_AVATAR_URL;
    if(menuName) menuName.textContent = currentUser?.ho_ten || 'User';
    if(menuEmail) menuEmail.textContent = currentUser?.gmail || '';
    if(menuRole) menuRole.textContent = currentUser?.phan_quyen || 'View';

    const desktopName = document.getElementById('settings-desktop-name');
    const desktopAvatar = document.getElementById('settings-desktop-avatar');
    if(desktopName) desktopName.textContent = currentUser?.ho_ten || 'User';
    if(desktopAvatar) desktopAvatar.src = currentAvatarUrl || DEFAULT_AVATAR_URL;
}

function clearSelectedAvatar() {
    selectedAvatarFile = null;
    const activeContainer = window.innerWidth >= 768 
            ? document.getElementById('desktop-settings-content-slot') 
            : document.getElementById('mobile-settings-content-slot');

    if(!activeContainer) return;
    
    const imgUpload = activeContainer.querySelector('#profile-image-upload');
    if(imgUpload) imgUpload.value = '';
    const preview = activeContainer.querySelector('#profile-image-preview');
    if(preview) preview.src = DEFAULT_AVATAR_URL;
    const removeBtn = activeContainer.querySelector('#profile-remove-image-btn');
    if(removeBtn) removeBtn.classList.add('hidden');
    const urlInput = activeContainer.querySelector('#profile-current-avatar-url');
    if(urlInput) urlInput.value = '';
}

const processAvatarFile = (file) => {
    if (file && file.type.startsWith('image/')) {
        selectedAvatarFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            const activeContainer = window.innerWidth >= 768 
                ? document.getElementById('desktop-settings-content-slot') 
                : document.getElementById('mobile-settings-content-slot');
                
            if(activeContainer) {
                const preview = activeContainer.querySelector('#profile-image-preview');
                if (preview) preview.src = e.target.result;
                const removeBtn = activeContainer.querySelector('#profile-remove-image-btn');
                if (removeBtn) removeBtn.classList.remove('hidden');
                const urlInput = activeContainer.querySelector('#profile-current-avatar-url');
                if (urlInput) urlInput.value = 'temp-new-image';
            }
        };
        reader.readAsDataURL(file);
    }
};
export function openAdminSettingsTab() {
    // Helper function accessible from other modules
    if (document.getElementById('desktop-settings-menu') || document.getElementById('settings-menu')) {
         openSettingsTab('admin', 'Quản Lý Người Dùng');
    }
}
