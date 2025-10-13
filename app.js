// Supabase Configuration
const SUPABASE_URL = 'https://vazqhiicrtdsulvoubkb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhenFoaWljcnRkc3Vsdm91YmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNjQxNTEsImV4cCI6MjA3NTY0MDE1MX0.5uDJu5_i-PeS5CeDw7UuEX4akP6w6A0qggTxKRlUIFw';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentChatUser = null;
let messagesSubscription = null;
let shownNotificationIds = new Set(); // Gösterilen bildirim ID'leri
let allUsers = {};
let isFirstLoad = true;
let currentMessages = []; // Mevcut mesajları tutacak
let isLoadingMessages = false; // Çoklu yükleme engeli
let typingTimeout = null; // Typing timeout için

// Emoji data
const emojis = {
    frequent: ['😊', '😂', '❤️', '👍', '🎉', '🔥', '✨', '💯'],
    smileys: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
    gestures: ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
    other: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🔥', '⭐', '✨', '💫', '💥', '💢', '💦', '💨', '✅', '❌', '⚠️', '📢', '📣', '💯']
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initializeEmojiPicker();
    initializeMediaModal();
    initializeUserProfileModal();
    preventRightClick();
    
    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        const emojiPicker = document.getElementById('emojiPicker');
        const emojiBtn = document.querySelector('.emoji-btn');
        if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });
    
    // Typing indicator
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('input', handleTyping);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

async function checkAuth() {
    const userId = localStorage.getItem('userId');
    if (userId) {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (data) {
            currentUser = data;
            showChatContainer();
            updateOnlineStatus();
            loadOnlineUsers();
            loadConversations();
            startAutoRefresh();
            startNotificationChecker();
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('password', password)
        .single();

    if (error || !data) {
        await showAlert('E-posta veya şifre hatalı.', 'Giriş Başarısız', 'error');
        return;
    }

    currentUser = data;
    localStorage.setItem('userId', data.id);
    showChatContainer();
    updateOnlineStatus();
    loadOnlineUsers();
    loadConversations();
    startAutoRefresh();
    startNotificationChecker();
}

async function handleRegister(e) {
    e.preventDefault();
    
    const userData = {
        email: document.getElementById('registerEmail').value,
        password: document.getElementById('registerPassword').value,
        nickname: document.getElementById('registerNickname').value,
        birth_date: document.getElementById('registerBirthDate').value,
        gender: document.getElementById('registerGender').value
    };

    const { data, error } = await supabase
        .from('users')
        .insert([userData])
        .select();

    if (error) {
        await showAlert('Bu e-posta zaten kullanılıyor olabilir.', 'Kayıt Başarısız', 'error');
        return;
    }

    await showAlert('Şimdi giriş yapabilirsiniz.', 'Kayıt Başarılı', 'success');
    showLogin();
}

async function updateOnlineStatus() {
    if (!currentUser) return;
    
    await supabase
        .from('users')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', currentUser.id);
}

async function loadOnlineUsers() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .neq('id', currentUser.id)
        .gte('last_seen', fiveMinutesAgo)
        .order('last_seen', { ascending: false });

    if (data) {
        // Store all users for later reference
        data.forEach(user => {
            allUsers[user.id] = user;
        });
        
        // Her kullanıcı için okunmamış mesaj sayısını al
        const usersWithUnread = await Promise.all(
            data.map(async (user) => {
                const unreadCount = await getUnreadCount(user.id);
                return { ...user, unreadCount };
            })
        );
        
        displayOnlineUsers(usersWithUnread);
    }
}

// Okunmamış mesaj sayısını hesapla
async function getUnreadCount(userId) {
    const { count, error } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', userId)
        .eq('receiver_id', currentUser.id)
        .eq('read', false)
        .eq('receiver_deleted', false);
    
    return count || 0;
}

function displayOnlineUsers(users) {
    const onlineBar = document.getElementById('onlineBar');
    const label = onlineBar.querySelector('.online-label');
    onlineBar.innerHTML = '';
    onlineBar.appendChild(label);

    users.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';
        userDiv.onclick = () => openChat(user);
        
        const avatar = document.createElement('div');
        avatar.className = 'online-user-avatar';
        
        // 👇 YENİ: Profil resmi veya harf göster
        createAvatar(avatar, user);
        
        // OkunmamÄ±ÅŸ mesaj badge'i ekle
        if (user.unreadCount && user.unreadCount > 0 && 
            (!currentChatUser || currentChatUser.id !== user.id)) {
            const badge = document.createElement('div');
            badge.className = 'unread-badge';
            badge.textContent = user.unreadCount > 99 ? '99+' : user.unreadCount;
            avatar.appendChild(badge);
        }
        
        const info = document.createElement('div');
        info.className = 'online-user-info';
        
        const name = document.createElement('div');
        name.className = 'online-user-name';
        name.textContent = user.nickname;
        
        const details = document.createElement('div');
        details.className = 'online-user-details';
        const age = calculateAge(user.birth_date);
        const city = user.city || 'Şehir yok';
        details.textContent = `${age} • ${city}`;
        
        info.appendChild(name);
        info.appendChild(details);
        userDiv.appendChild(avatar);
        userDiv.appendChild(info);
        onlineBar.appendChild(userDiv);
    });
    
    // Butonları güncelle
    setTimeout(updateScrollButtons, 100);
}

async function loadConversations() {
    const { data, error } = await supabase
        .from('messages')
        .select(`
            *,
            sender:sender_id(id, nickname, birth_date, city, last_seen),
            receiver:receiver_id(id, nickname, birth_date, city, last_seen)
        `)
        .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });

    if (data && data.length > 0) {
        // Filter out messages deleted by current user
        const visibleMessages = data.filter(msg => {
            // Eğer ben gönderen isem ve sender_deleted = true ise gösterme
            if (msg.sender_id === currentUser.id && msg.sender_deleted) {
                return false;
            }
            // Eğer ben alan isem ve receiver_deleted = true ise gösterme
            if (msg.receiver_id === currentUser.id && msg.receiver_deleted) {
                return false;
            }
            return true;
        });

        const conversations = {};
        
        visibleMessages.forEach(msg => {
            const otherUserId = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id;
            if (!conversations[otherUserId]) {
                const otherUser = msg.sender_id === currentUser.id ? msg.receiver : msg.sender;
                conversations[otherUserId] = {
                    user: otherUser,
                    lastMessage: msg.message,
                    time: msg.created_at
                };
                // Store user for notifications
                allUsers[otherUserId] = otherUser;
            }
        });

        // Her konuşma için okunmamış mesaj sayısını al
        const conversationsWithUnread = await Promise.all(
            Object.values(conversations).map(async (conv) => {
                const unreadCount = await getUnreadCount(conv.user.id);
                return { ...conv, unreadCount };
            })
        );

        displayConversations(conversationsWithUnread);
    } else {
        document.getElementById('conversationsList').innerHTML = 
            '<div class="empty-state"><div class="empty-state-icon">💬</div><p>Henüz konuşma yok</p><p class="empty-state-hint">Online kullanıcılardan birine tıklayın</p></div>';
    }
}

function displayConversations(conversations) {
    const list = document.getElementById('conversationsList');
    list.innerHTML = '';

    if (conversations.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><p>Henüz konuşma yok</p><p class="empty-state-hint">Online kullanıcılardan birine tıklayın</p></div>';
        return;
    }

    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        if (currentChatUser && currentChatUser.id === conv.user.id) {
            item.classList.add('active');
        }
        
        // Click handler for opening chat
        item.onclick = (e) => {
            // Don't open chat if delete or download button is clicked
            if (e.target.classList.contains('conversation-delete-btn') || 
                e.target.classList.contains('conversation-download-btn')) {
                return;
            }
            openChat(conv.user);
        };

        const avatar = document.createElement('div');
        avatar.className = 'conversation-avatar';
        avatar.textContent = conv.user.nickname.charAt(0).toUpperCase();
        
        // Okunmamış mesaj badge'i ekle (ama şu anda konuştuğumuz kişiye gösterme)
        if (conv.unreadCount && conv.unreadCount > 0 && 
            (!currentChatUser || currentChatUser.id !== conv.user.id)) {
            const badge = document.createElement('div');
            badge.className = 'unread-badge';
            badge.textContent = conv.unreadCount > 99 ? '99+' : conv.unreadCount;
            avatar.appendChild(badge);
        }

        const info = document.createElement('div');
        info.className = 'conversation-info';

        const name = document.createElement('div');
        name.className = 'conversation-name';
        name.textContent = conv.user.nickname;

        const details = document.createElement('div');
        details.className = 'conversation-details';
        const age = calculateAge(conv.user.birth_date);
        const city = conv.user.city || 'Şehir yok';
        details.textContent = `${age} • ${city} • ${getLastSeenText(conv.user.last_seen)}`;

        const preview = document.createElement('div');
        preview.className = 'conversation-preview';
        preview.textContent = conv.lastMessage;

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'conversation-download-btn';
        downloadBtn.innerHTML = '💾';
        downloadBtn.title = 'Konuşmayı İndir';
        downloadBtn.onclick = (e) => {
            e.stopPropagation();
            downloadConversation(conv.user);
        };

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'conversation-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Konuşmayı Sil';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteConversation(conv.user);
        };

        // Elemanları birleştir
        info.appendChild(name);
        info.appendChild(details);
        info.appendChild(preview);
        item.appendChild(avatar);
        item.appendChild(info);
        item.appendChild(downloadBtn);
        item.appendChild(deleteBtn);
        list.appendChild(item);
    });
}

async function openChat(user) {
    // Clear typing status from previous chat
    await clearTypingStatus();
    
    currentChatUser = user;
    currentMessages = []; // Yeni sohbette mesajları sıfırla
    
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatInput').style.display = 'flex';
    document.getElementById('chatHeaderName').textContent = user.nickname;
    document.getElementById('chatHeaderAvatar').textContent = user.nickname.charAt(0).toUpperCase();
    
    // Update header details
    const age = calculateAge(user.birth_date);
    const city = user.city || 'Şehir belirtilmemiş';
    document.getElementById('chatHeaderAge').textContent = age;
    document.getElementById('chatHeaderCity').textContent = city;
    document.getElementById('chatHeaderStatus').textContent = getLastSeenText(user.last_seen);

    // Mark all messages from this user as read
    await markMessagesAsRead(user.id);

    await loadMessages();
    
    // Badge'leri güncelle (mesajlar okundu)
    loadConversations();
    loadOnlineUsers();

    // Subscribe to real-time messages
    if (messagesSubscription) {
        messagesSubscription.unsubscribe();
    }

    messagesSubscription = supabase
        .channel('messages')
        .on('postgres_changes', 
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages',
                filter: `sender_id=eq.${user.id},receiver_id=eq.${currentUser.id}`
            }, 
            () => {
                loadMessages();
            }
        )
        .subscribe();
}

async function loadMessages() {
    if (!currentChatUser || isLoadingMessages) return;
    
    isLoadingMessages = true;

    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChatUser.id}),and(sender_id.eq.${currentChatUser.id},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    isLoadingMessages = false;

    if (!data) return;

    // Filter out deleted messages for current user
    const filteredMessages = data.filter(msg => {
        // Eğer ben gönderen isem ve sender_deleted = true ise gösterme
        if (msg.sender_id === currentUser.id && msg.sender_deleted) {
            return false;
        }
        // Eğer ben alan isem ve receiver_deleted = true ise gösterme
        if (msg.receiver_id === currentUser.id && msg.receiver_deleted) {
            return false;
        }
        return true;
    });

    // Eğer mesajlar değişmemişse hiçbir şey yapma
    if (messagesAreEqual(currentMessages, filteredMessages)) {
        return;
    }

    // Yeni mesaj varsa ve scroll en alttaysa, sonra da scroll'u koru
    const container = document.getElementById('messagesContainer');
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;

    currentMessages = filteredMessages;
    displayMessages(filteredMessages);

    // Eğer kullanıcı en alttaysa veya yeni mesaj geldiyse scroll'u aşağı çek
    if (wasAtBottom) {
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 50);
    }
}

function messagesAreEqual(oldMessages, newMessages) {
    if (oldMessages.length !== newMessages.length) return false;
    
    // Son mesajların ID'lerini karşılaştır (hızlı kontrol)
    if (oldMessages.length > 0 && newMessages.length > 0) {
        const lastOld = oldMessages[oldMessages.length - 1];
        const lastNew = newMessages[newMessages.length - 1];
        
        // Son mesaj farklıysa değişiklik var demektir
        if (lastOld.id !== lastNew.id || lastOld.message !== lastNew.message) {
            return false;
        }
    }
    
    return true;
}

function displayMessages(messages) {
    const container = document.getElementById('messagesContainer');
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👋</div><h3>Yeni Konuşma</h3><p>İlk mesajı siz gönderin!</p></div>';
        return;
    }

    // Scroll pozisyonunu kaydet
    const scrollPos = container.scrollTop;
    const wasAtBottom = container.scrollHeight - scrollPos <= container.clientHeight + 100;

    // Container'ı temizle
    container.innerHTML = '';

    messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.sender_id === currentUser.id ? 'sent' : ''}`;
        messageDiv.dataset.messageId = msg.id; // Her mesaja unique ID ekle

		 // ↓ LONG PRESS İÇİN YENİ KOD ↓
    let pressTimer = null;
    let deleteBtn = null;

    // Mouse/Touch down
    messageDiv.addEventListener('mousedown', (e) => {
        // Eğer zaten bir buton varsa veya link/dosyaya tıklandıysa işlem yapma
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || 
            e.target.closest('.message-file') || e.target.closest('.message-image')) {
            return;
        }

        messageDiv.classList.add('pressing');
        pressTimer = setTimeout(() => {
            showDeleteButton(messageDiv, msg);
        }, 1200); // 2 saniye
    });

    // Mouse/Touch up veya leave
    const clearPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        messageDiv.classList.remove('pressing');
    };

    messageDiv.addEventListener('mouseup', clearPress);
    messageDiv.addEventListener('mouseleave', clearPress);
    messageDiv.addEventListener('touchend', clearPress);

    // Touch için ayrı event
    messageDiv.addEventListener('touchstart', (e) => {
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;

        messageDiv.classList.add('pressing');
        pressTimer = setTimeout(() => {
            showDeleteButton(messageDiv, msg);
        }, 1200);
    });
    // ↑ LONG PRESS KOD BİTİŞ ↑
	
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = msg.sender_id === currentUser.id ? 
            currentUser.nickname.charAt(0).toUpperCase() : 
            currentChatUser.nickname.charAt(0).toUpperCase();

        const content = document.createElement('div');
        content.className = 'message-content';

        // Handle different message types
        if (msg.message_type === 'image' && msg.file_url) {
            // Image message
            const img = document.createElement('img');
            img.src = msg.file_url;
            img.className = 'message-image';
            img.alt = msg.file_name || 'Image';
            img.onclick = () => openMediaModal(msg.file_url, msg.file_name, 'image');
            content.appendChild(img);
        } else if (msg.message_type === 'file' && msg.file_url) {
            // Check if it's a video file
            const isVideo = msg.file_name && (
                msg.file_name.toLowerCase().endsWith('.mp4') ||
                msg.file_name.toLowerCase().endsWith('.webm') ||
                msg.file_name.toLowerCase().endsWith('.ogg') ||
                msg.file_name.toLowerCase().endsWith('.mov')
            );

            if (isVideo) {
                // Video preview with modal
                const videoPreview = document.createElement('div');
                videoPreview.className = 'message-file';
                videoPreview.style.cursor = 'pointer';
                videoPreview.onclick = () => openMediaModal(msg.file_url, msg.file_name, 'video');
                
                const icon = document.createElement('div');
                icon.className = 'file-icon';
                icon.textContent = '🎬';
                
                const fileInfo = document.createElement('div');
                fileInfo.className = 'file-info';
                
                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = msg.file_name;
                
                const fileSize = document.createElement('div');
                fileSize.className = 'file-size';
                fileSize.textContent = formatFileSize(msg.file_size || 0) + ' • Video';
                
                fileInfo.appendChild(fileName);
                fileInfo.appendChild(fileSize);
                videoPreview.appendChild(icon);
                videoPreview.appendChild(fileInfo);
                content.appendChild(videoPreview);
            } else {
                // Regular file message
                const fileDiv = document.createElement('div');
                fileDiv.className = 'message-file';
                fileDiv.onclick = () => downloadFile(msg.file_url, msg.file_name);
                
                const icon = document.createElement('div');
                icon.className = 'file-icon';
                icon.textContent = getFileIcon(msg.file_name);
                
                const fileInfo = document.createElement('div');
                fileInfo.className = 'file-info';
                
                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = msg.file_name;
                
                const fileSize = document.createElement('div');
                fileSize.className = 'file-size';
                fileSize.textContent = formatFileSize(msg.file_size || 0);
                
                fileInfo.appendChild(fileName);
                fileInfo.appendChild(fileSize);
                fileDiv.appendChild(icon);
                fileDiv.appendChild(fileInfo);
                content.appendChild(fileDiv);
            }
        } else {
            // Text message
            const text = document.createElement('div');
            text.className = 'message-text';
            
            // Check for links
            const links = detectLinks(msg.message);
            if (links && links.length > 0) {
                // Convert links to clickable
                let messageWithLinks = msg.message;
                links.forEach(link => {
                    messageWithLinks = messageWithLinks.replace(
                        link, 
                        `<a href="${link}" target="_blank" style="color: inherit; text-decoration: underline;">${link}</a>`
                    );
                });
                text.innerHTML = messageWithLinks;
                
                // Add link preview for first link
                const firstLink = links[0];
                const preview = document.createElement('div');
                preview.className = 'link-preview';
                preview.onclick = () => window.open(firstLink, '_blank');
                preview.innerHTML = `
                    <div class="link-preview-content">
                        <div class="link-preview-title">🔗 Link</div>
                        <div class="link-preview-url">${firstLink}</div>
                    </div>
                `;
                content.appendChild(text);
                content.appendChild(preview);
            } else {
                text.textContent = msg.message;
                content.appendChild(text);
            }
        }

        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = new Date(msg.created_at).toLocaleTimeString('tr-TR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        content.appendChild(time);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        container.appendChild(messageDiv);
    });

    // Scroll pozisyonunu geri yükle
    if (!wasAtBottom) {
        container.scrollTop = scrollPos;
    } else {
        container.scrollTop = container.scrollHeight;
    }
}

// Show Delete Button
function showDeleteButton(messageDiv, msg) {
    // Zaten buton varsa tekrar ekleme
    if (messageDiv.querySelector('.message-delete-btn')) return;

    // Sadece kendi gönderdiğimiz mesajlar için
    if (msg.sender_id !== currentUser.id) return;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'message-delete-btn';
    deleteBtn.innerHTML = '🗑️ Mesajı Sil';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteMessage(msg, messageDiv);
    };

    // Message content'in içine değil, mesaj div'ine ekle
    messageDiv.style.position = 'relative';
    messageDiv.appendChild(deleteBtn);

    // 5 saniye sonra otomatik kapat
    setTimeout(() => {
        if (deleteBtn && deleteBtn.parentElement) {
            deleteBtn.remove();
        }
    }, 5000);
}

// Delete Message Function
async function deleteMessage(msg, messageDiv) {
    const confirmed = await showConfirm('Bu mesajı silmek istediğinizden emin misiniz?', 'Mesaj Sil', 'Sil', 'İptal');
    if (!confirmed) return;

    try {
        // Mesaj okunmamışsa (read = false) ve ben göndericisem -> Komple sil
        if (!msg.read && msg.sender_id === currentUser.id) {
            // Dosya varsa storage'dan sil
            if (msg.file_url) {
                const url = msg.file_url;
                const matches = url.match(/bucket\/([^?]+)/);
                if (matches) {
                    await supabase.storage
                        .from('bucket')
                        .remove([matches[1]]);
                }
            }

            // Mesajı tamamen sil
            const { error } = await supabase
                .from('messages')
                .delete()
                .eq('id', msg.id);

            if (error) throw error;

            // UI'dan kaldır
            if (messageDiv && messageDiv.parentElement) {
                messageDiv.style.animation = 'messageOut 0.3s ease';
                setTimeout(() => {
                    messageDiv.remove();
                    // Mesajları yeniden yükle
                    loadMessages();
                    loadConversations();
                }, 300);
            }

            showSuccessMessage('Mesaj kalıcı olarak silindi!');
        } else {
            // Okunmuşsa veya ben alıcıysam -> Soft delete
            const updateField = msg.sender_id === currentUser.id ? 'sender_deleted' : 'receiver_deleted';
            
            const { error } = await supabase
                .from('messages')
                .update({ [updateField]: true })
                .eq('id', msg.id);

            if (error) throw error;

            // UI'dan kaldır
            if (messageDiv && messageDiv.parentElement) {
                messageDiv.style.animation = 'messageOut 0.3s ease';
                setTimeout(() => {
                    messageDiv.remove();
                    loadMessages();
                    loadConversations();
                }, 300);
            }

            showSuccessMessage('Mesaj sizin için gizlendi!');
        }
    } catch (error) {
        console.error('Mesaj silme hatası:', error);
        await  showAlert('Mesaj silinirken bir hata oluştu!', 'HATA!', 'error');
    }
}

function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function markMessagesAsRead(senderId) {
    // Mark all unread messages from this sender to current user as read
    // (only if not deleted by receiver)
    const { error } = await supabase
        .from('messages')
        .update({ read: true })
        .eq('sender_id', senderId)
        .eq('receiver_id', currentUser.id)
        .eq('read', false)
        .eq('receiver_deleted', false);

    if (error) {
        console.error('Mesajlar okundu olarak işaretlenemedi:', error);
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || !currentChatUser) return;

    // Clear typing status before sending
    await clearTypingStatus();

    const { error } = await supabase
        .from('messages')
        .insert([{
            sender_id: currentUser.id,
            receiver_id: currentChatUser.id,
            message: message,
            message_type: 'text'
        }]);

    if (!error) {
        input.value = '';
        loadMessages();
        loadConversations();
    }
}

// Typing Indicator Functions
async function handleTyping() {
    if (!currentChatUser || !currentUser) return;

    // Set typing status
    await supabase
        .from('users')
        .update({ 
            typing_to: currentChatUser.id,
            typing_at: new Date().toISOString()
        })
        .eq('id', currentUser.id);

    // Clear previous timeout
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }

    // Set new timeout to clear typing status after 3 seconds of inactivity
    typingTimeout = setTimeout(async () => {
        await clearTypingStatus();
    }, 3000);
}

async function clearTypingStatus() {
    if (!currentUser) return;
    
    await supabase
        .from('users')
        .update({ 
            typing_to: null,
            typing_at: null
        })
        .eq('id', currentUser.id);
}

async function checkTypingStatus() {
    if (!currentChatUser) return;

    const threeSecondsAgo = new Date(Date.now() - 3000).toISOString();

    const { data } = await supabase
        .from('users')
        .select('typing_to, typing_at')
        .eq('id', currentChatUser.id)
        .eq('typing_to', currentUser.id)
        .gte('typing_at', threeSecondsAgo)
        .single();

    const statusElement = document.getElementById('chatHeaderStatus');
    if (data && data.typing_to && data.typing_at) {
        statusElement.textContent = 'yazıyor...';
        statusElement.style.color = 'var(--primary)';
        statusElement.style.fontStyle = 'italic';
    } else {
        statusElement.textContent = getLastSeenText(currentChatUser.last_seen);
        statusElement.style.color = 'var(--success)';
        statusElement.style.fontStyle = 'normal';
    }
}

// Emoji Picker Functions
function initializeEmojiPicker() {
    const categories = [
        { id: 'frequentEmojis', emojis: emojis.frequent },
        { id: 'smileysEmojis', emojis: emojis.smileys },
        { id: 'heartsEmojis', emojis: emojis.hearts },
        { id: 'gesturesEmojis', emojis: emojis.gestures },
        { id: 'otherEmojis', emojis: emojis.other }
    ];

    categories.forEach(category => {
        const container = document.getElementById(category.id);
        if (container) {
            category.emojis.forEach(emoji => {
                const emojiEl = document.createElement('div');
                emojiEl.className = 'emoji-item';
                emojiEl.textContent = emoji;
                emojiEl.onclick = () => insertEmoji(emoji);
                container.appendChild(emojiEl);
            });
        }
    });
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    input.value += emoji;
    input.focus();
}

// File Upload Functions
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        await showAlert('Maksimum 10MB yükleyebilirsiniz.', 'Dosya Çok Büyük', 'error');
        return;
    }

    // Show uploading indicator
    showUploadingIndicator(file.name);

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        // Basit path kullan - sadece dosya adı
        const filePath = fileName;

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from('bucket')  // Bucket isminizi buraya yazın
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error('Upload error:', error);
            throw new Error(error.message);
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('bucket')  // Bucket isminizi buraya yazın
            .getPublicUrl(filePath);

        const fileUrl = urlData.publicUrl;

        // Determine file type
        let fileType = 'file';
        if (file.type.startsWith('image/')) {
            fileType = 'image';
        } else if (file.type.startsWith('video/')) {
            fileType = 'file'; // Video'ları file olarak kaydet ama gösterimde ayırt edelim
        }

        // Save message with file
        const { error: msgError } = await supabase
            .from('messages')
            .insert([{
                sender_id: currentUser.id,
                receiver_id: currentChatUser.id,
                message: file.name,
                message_type: fileType,
                file_url: fileUrl,
                file_name: file.name,
                file_size: file.size
            }]);

        if (msgError) throw msgError;

        hideUploadingIndicator();
        loadMessages();
        loadConversations();
        
        // Reset file input
        event.target.value = '';

    } catch (error) {
        console.error('Dosya yükleme hatası:', error);
        await showAlert('Dosya yüklenirken bir hata oluştu:\n' + error.message, 'Hata', 'error');
        hideUploadingIndicator();
    }
}

function showUploadingIndicator(fileName) {
    const container = document.getElementById('messagesContainer');
    const indicator = document.createElement('div');
    indicator.id = 'uploadingIndicator';
    indicator.className = 'uploading-indicator';
    indicator.innerHTML = `
        <div class="uploading-spinner"></div>
        <div>
            <div style="font-weight: 600;">Yükleniyor...</div>
            <div style="font-size: 0.85em; color: var(--text-secondary);">${fileName}</div>
        </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
}

function hideUploadingIndicator() {
    const indicator = document.getElementById('uploadingIndicator');
    if (indicator) indicator.remove();
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const icons = {
        pdf: '📄',
        doc: '📝',
        docx: '📝',
        txt: '📝',
        zip: '🗜️',
        rar: '🗜️',
        mp3: '🎵',
        mp4: '🎬',
        webm: '🎬',
        ogg: '🎬',
        mov: '🎬',
        avi: '🎬',
        default: '📎'
    };
    return icons[ext] || icons.default;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Link Detection and Preview
function detectLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex);
}

async function fetchLinkPreview(url) {
    try {
        // For security and CORS reasons, we'll create a simple preview
        // In production, you'd want to use a backend service for this
        return {
            url: url,
            title: url,
            description: 'Link önizlemesi',
            image: null
        };
    } catch (error) {
        console.error('Link preview error:', error);
        return null;
    }
}

// Notification System
async function checkForNewMessages() {
    // İlk yüklemede bildirimleri atla ve mevcut mesajları kaydet
    if (isFirstLoad) {
        const { data } = await supabase
            .from('messages')
            .select('id')
            .eq('receiver_id', currentUser.id)
            .eq('receiver_deleted', false)
            .order('created_at', { ascending: false });
        
        if (data && data.length > 0) {
            // Tüm mevcut mesajları Set'e ekle
            data.forEach(msg => shownNotificationIds.add(msg.id));
        }
        isFirstLoad = false;
        return;
    }

    const { data, error } = await supabase
        .from('messages')
        .select(`
            *,
            sender:sender_id(id, nickname, birth_date, city)
        `)
        .eq('receiver_id', currentUser.id)
        .eq('read', false)
        .eq('receiver_deleted', false)
        .order('created_at', { ascending: false });

    if (data && data.length > 0) {
        data.forEach(message => {
            // Sadece daha önce gösterilmemiş mesajlar için bildirim göster
            if (!shownNotificationIds.has(message.id)) {
                // Sadece şu anda sohbet etmediğimiz kişilerden gelen mesajları göster
                if (!currentChatUser || currentChatUser.id !== message.sender_id) {
                    const sender = message.sender;
                    allUsers[sender.id] = sender;
                    showNotification(sender, message.message);
                }
                // Bu mesajı gösterildi olarak işaretle
                shownNotificationIds.add(message.id);
            }
        });
        
        loadConversations();
    }
}

function showNotification(user, message) {
    const container = document.getElementById('notificationsContainer');
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.onclick = () => {
        openChat(user);
        notification.remove();
    };

    const avatar = document.createElement('div');
    avatar.className = 'notification-avatar';
    avatar.textContent = user.nickname.charAt(0).toUpperCase();

    const content = document.createElement('div');
    content.className = 'notification-content';

    const title = document.createElement('div');
    title.className = 'notification-title';
    title.textContent = user.nickname;

    const messageText = document.createElement('div');
    messageText.className = 'notification-message';
    messageText.textContent = message;

    content.appendChild(title);
    content.appendChild(messageText);
    notification.appendChild(avatar);
    notification.appendChild(content);
    container.appendChild(notification);

    // Play notification sound
    playNotificationSound();

    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function startNotificationChecker() {
    // Check for new messages every 2 seconds
    setInterval(checkForNewMessages, 2000);
}

async function showProfile() {
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('profileContainer').style.display = 'block';

    // Load current user data
    document.getElementById('profileNickname').value = currentUser.nickname || '';
    document.getElementById('profileCity').value = currentUser.city || '';
    document.getElementById('profilePhone').value = currentUser.phone || '';
    document.getElementById('profileBirthDate').value = currentUser.birth_date || '';
    document.getElementById('profileInstagram').value = currentUser.instagram || '';
    document.getElementById('profileFacebook').value = currentUser.facebook || '';
    document.getElementById('profilePicture').value = currentUser.profile_picture || '';
}

async function handleProfileUpdate(e) {
    e.preventDefault();

    const updates = {
        nickname: document.getElementById('profileNickname').value,
        city: document.getElementById('profileCity').value,
        phone: document.getElementById('profilePhone').value,
        birth_date: document.getElementById('profileBirthDate').value,
        instagram: document.getElementById('profileInstagram').value,
        facebook: document.getElementById('profileFacebook').value,
        profile_picture: document.getElementById('profilePicture').value
    };

    const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', currentUser.id);

    if (!error) {
        await showAlert('Profil başarıyla güncellendi!', 'Başarılı', 'success');
        currentUser = { ...currentUser, ...updates };
        showChat();
    } else {
       await showAlert('Güncelleme başarısız!', 'Hata', 'error');
    }
}

function showChat() {
    document.getElementById('profileContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
}

function showChatContainer() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
}

function showLogin() {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

function showRegister() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function startAutoRefresh() {
    // Online status ve kullanıcıları her 10 saniyede güncelle
    setInterval(() => {
        updateOnlineStatus();
        loadOnlineUsers();
    }, 10000); // 10 saniye
    
    // Mesajları her 3 saniyede kontrol et (ama sadece değişiklik varsa render et)
    setInterval(() => {
        if (currentChatUser) {
            loadMessages();
        }
    }, 3000); // 3 saniye
    
    // Typing durumunu her 1 saniyede kontrol et
    setInterval(() => {
        if (currentChatUser) {
            checkTypingStatus();
        }
    }, 1000); // 1 saniye
}

// Helper Functions
// Helper function to create avatar with image or initial
function createAvatar(element, user) {
    if (!element || !user) return;
    
    const initial = user.nickname ? user.nickname.charAt(0).toUpperCase() : 'U';
    
    if (user.profile_picture) 
	{
        // Profil resmi varsa
        element.style.backgroundImage = `url(${user.profile_picture})`;
        element.textContent = ''; // Harfi gizle
        element.classList.add('avatar-with-image');
    } 
	else 
	{
        // Profil resmi yoksa
        element.textContent = initial;
        element.classList.remove('avatar-with-image');
    }
}

function calculateAge(birthDate) {
    if (!birthDate) return 'Yaş belirtilmemiş';
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return `${age} yaş`;
}

function getLastSeenText(lastSeen) {
    if (!lastSeen) return 'Son görülme bilinmiyor';
    
    const now = new Date();
    const last = new Date(lastSeen);
    
    // Milisaniye cinsinden fark
    const diffMs = now.getTime() - last.getTime();
    
    // Negatif değer kontrolü (gelecek zaman)
    if (diffMs < 0) return 'Online';
    
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 5) return 'Online';
    if (diffMins < 60) return `${diffMins} dakika önce`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} saat önce`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Dün';
    if (diffDays < 7) return `${diffDays} gün önce`;
    
    // 7 günden eski ise tam tarih göster
    return last.toLocaleDateString('tr-TR', { 
        day: 'numeric', 
        month: 'long',
        year: 'numeric'
    });
}

// Notification Sound
function playNotificationSound() {
    try {
        // Basit bildirim sesi oluştur (beep)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800; // Frekans (Hz)
        oscillator.type = 'sine'; // Sinüs dalgası
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Hacim
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.error('Ses çalınamadı:', error);
    }
}

// Prevent Right Click
function preventRightClick() {
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    // Also prevent common keyboard shortcuts for dev tools
    document.addEventListener('keydown', (e) => {
        // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
        if (e.key === 'F12' || 
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
            (e.ctrlKey && e.key === 'U')) {
            e.preventDefault();
            return false;
        }
    });
}

// Media Modal Functions
let currentMediaUrl = '';
let currentMediaName = '';
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

function initializeMediaModal() {
    const modal = document.getElementById('mediaModal');
    const modalContent = document.getElementById('mediaModalContent');
    const modalHeader = document.getElementById('mediaModalHeader');
    const closeBtn = document.getElementById('closeModalBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const downloadBtn = document.getElementById('downloadMediaBtn');

    // Close modal
    closeBtn.addEventListener('click', closeMediaModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeMediaModal();
        }
    });

    // Fullscreen toggle
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Download media
    downloadBtn.addEventListener('click', () => {
        downloadFile(currentMediaUrl, currentMediaName);
    });

    // Dragging functionality
    modalHeader.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (modal.style.display === 'flex') {
            if (e.key === 'Escape') {
                closeMediaModal();
            } else if (e.key === 'f' || e.key === 'F') {
                toggleFullscreen();
            }
        }
    });
}

function openMediaModal(url, name, type) {
    currentMediaUrl = url;
    currentMediaName = name;

    const modal = document.getElementById('mediaModal');
    const modalBody = document.getElementById('mediaModalBody');
    const modalContent = document.getElementById('mediaModalContent');

    // Reset position and fullscreen
    modalContent.classList.remove('fullscreen');
    modalContent.style.transform = 'none';
    xOffset = 0;
    yOffset = 0;

    // Clear previous content
    modalBody.innerHTML = '';

    // Add media based on type
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        img.alt = name;
        modalBody.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        modalBody.appendChild(video);
    }

    modal.style.display = 'flex';
}

function closeMediaModal() {
    const modal = document.getElementById('mediaModal');
    const modalBody = document.getElementById('mediaModalBody');
    
    // Stop video if playing
    const video = modalBody.querySelector('video');
    if (video) {
        video.pause();
    }

    modal.style.display = 'none';
    currentMediaUrl = '';
    currentMediaName = '';
}

function toggleFullscreen() {
    const modalContent = document.getElementById('mediaModalContent');
    modalContent.classList.toggle('fullscreen');
    
    // Reset position when entering fullscreen
    if (modalContent.classList.contains('fullscreen')) {
        modalContent.style.transform = 'none';
        xOffset = 0;
        yOffset = 0;
    }
}

function dragStart(e) {
    const modalContent = document.getElementById('mediaModalContent');
    if (modalContent.classList.contains('fullscreen')) return;

    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === document.getElementById('mediaModalHeader') || 
        e.target.className === 'media-modal-title') {
        isDragging = true;
        modalContent.classList.add('dragging');
    }
}

function drag(e) {
    if (isDragging) {
        e.preventDefault();
        
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        xOffset = currentX;
        yOffset = currentY;

        setTranslate(currentX, currentY);
    }
}

function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
    
    const modalContent = document.getElementById('mediaModalContent');
    modalContent.classList.remove('dragging');
}

function setTranslate(xPos, yPos) {
    const modalContent = document.getElementById('mediaModalContent');
    modalContent.style.transform = `translate(${xPos}px, ${yPos}px)`;
}

// User Profile Modal Functions
let profileDragOffset = { x: 0, y: 0 };
let isProfileDragging = false;
let profileInitialX, profileInitialY, profileCurrentX, profileCurrentY;

function initializeUserProfileModal() {
    const modal = document.getElementById('userProfileModal');
    const modalContent = document.getElementById('userProfileModalContent');
    const modalHeader = document.getElementById('userProfileModalHeader');
    const closeBtn = document.getElementById('closeProfileModalBtn');

    // Close modal
    closeBtn.addEventListener('click', closeUserProfileModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeUserProfileModal();
        }
    });

    // Dragging functionality
    modalHeader.addEventListener('mousedown', profileDragStart);
    document.addEventListener('mousemove', profileDrag);
    document.addEventListener('mouseup', profileDragEnd);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (modal.style.display === 'flex' && e.key === 'Escape') {
            closeUserProfileModal();
        }
    });
}

async function openUserProfileModal() {
    if (!currentChatUser) return;

    // Fetch latest user data
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', currentChatUser.id)
        .single();

    if (error || !data) {
        await showAlert('Profil bilgileri yüklenemedi!', 'Hata', 'error');
        return;
    }

    const user = data;
    const modal = document.getElementById('userProfileModal');
    const modalContent = document.getElementById('userProfileModalContent');

    // Reset position
    modalContent.style.transform = 'none';
    profileDragOffset = { x: 0, y: 0 };

    // Set profile data
    const avatar = document.getElementById('profileModalAvatar');
    avatar.textContent = user.nickname.charAt(0).toUpperCase();
    
    // Make avatar clickable if profile picture exists
    if (user.profile_picture) {
        avatar.style.backgroundImage = `url(${user.profile_picture})`;
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.textContent = '';
        avatar.onclick = () => openMediaModal(user.profile_picture, user.nickname + ' - Profil Resmi', 'image');
    } else {
        avatar.style.backgroundImage = 'none';
        avatar.textContent = user.nickname.charAt(0).toUpperCase();
        avatar.onclick = null;
        avatar.style.cursor = user.profile_picture ? 'pointer' : 'default';
    }

    document.getElementById('profileModalNickname').textContent = user.nickname;
    document.getElementById('profileModalAge').textContent = calculateAge(user.birth_date);
    document.getElementById('profileModalGender').textContent = user.gender || 'Belirtilmemiş';
    document.getElementById('profileModalCity').textContent = user.city || 'Belirtilmemiş';
    document.getElementById('profileModalEmail').textContent = user.email || 'Belirtilmemiş';
    document.getElementById('profileModalPhone').textContent = user.phone || 'Belirtilmemiş';
    document.getElementById('profileModalInstagram').textContent = user.instagram || 'Belirtilmemiş';
    document.getElementById('profileModalFacebook').textContent = user.facebook || 'Belirtilmemiş';
    document.getElementById('profileModalLastSeen').textContent = getLastSeenText(user.last_seen);

    modal.style.display = 'flex';
}

function closeUserProfileModal() {
    const modal = document.getElementById('userProfileModal');
    modal.style.display = 'none';
}

function profileDragStart(e) {
    profileInitialX = e.clientX - profileDragOffset.x;
    profileInitialY = e.clientY - profileDragOffset.y;

    if (e.target === document.getElementById('userProfileModalHeader') || 
        e.target.className === 'profile-modal-title') {
        isProfileDragging = true;
        const modalContent = document.getElementById('userProfileModalContent');
        modalContent.classList.add('dragging');
    }
}

function profileDrag(e) {
    if (isProfileDragging) {
        e.preventDefault();
        
        profileCurrentX = e.clientX - profileInitialX;
        profileCurrentY = e.clientY - profileInitialY;

        profileDragOffset.x = profileCurrentX;
        profileDragOffset.y = profileCurrentY;

        setProfileTranslate(profileCurrentX, profileCurrentY);
    }
}

function profileDragEnd(e) {
    profileInitialX = profileCurrentX;
    profileInitialY = profileCurrentY;
    isProfileDragging = false;
    
    const modalContent = document.getElementById('userProfileModalContent');
    modalContent.classList.remove('dragging');
}

function setProfileTranslate(xPos, yPos) {
    const modalContent = document.getElementById('userProfileModalContent');
    modalContent.style.transform = `translate(${xPos}px, ${yPos}px)`;
}

// Delete Conversation Functions
async function deleteConversation(user) {
    const confirmed = await showConfirm(
    `${user.nickname} ile olan konuşmayı silmek istediğinize emin misiniz?\n\nBu işlem sadece sizin için mesajları gizleyecektir.`,
    'Konuşmayı Sil',
    'Sil',
    'İptal'
);
    if (!confirmed) return;

    try {
        // Show loading indicator
        showLoadingIndicator('Konuşma siliniyor...');

        // 1. Get all messages between current user and this user
        const { data: messages, error: fetchError } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${user.id}),and(sender_id.eq.${user.id},receiver_id.eq.${currentUser.id})`);

        if (fetchError) throw fetchError;

        if (messages && messages.length > 0) {
            // 2. İki grup: Tamamen silinecekler ve sadece bayrak güncellenecekler
            const messagesToFullyDelete = [];
            const messagesToMarkAsDeleted = [];

            messages.forEach(msg => {
                const iAmSender = msg.sender_id === currentUser.id;
                const iAmReceiver = msg.receiver_id === currentUser.id;

                // Check if the other party already deleted this message
                if (iAmSender) {
                    // Ben gönderen: receiver_deleted'e bak
                    if (msg.receiver_deleted) {
                        // Karşı taraf da silmiş, tamamen sil
                        messagesToFullyDelete.push(msg);
                    } else {
                        // Sadece benim için sil
                        messagesToMarkAsDeleted.push({ id: msg.id, field: 'sender_deleted' });
                    }
                } else if (iAmReceiver) {
                    // Ben alan: sender_deleted'e bak
                    if (msg.sender_deleted) {
                        // Karşı taraf da silmiş, tamamen sil
                        messagesToFullyDelete.push(msg);
                    } else {
                        // Sadece benim için sil
                        messagesToMarkAsDeleted.push({ id: msg.id, field: 'receiver_deleted' });
                    }
                }
            });

            // 3. Update messages with deletion flags (soft delete)
            for (const msg of messagesToMarkAsDeleted) {
                const { error: updateError } = await supabase
                    .from('messages')
                    .update({ [msg.field]: true })
                    .eq('id', msg.id);

                if (updateError) {
                    console.error('Update error:', updateError);
                }
            }

            // 4. Fully delete messages where both parties deleted (hard delete)
            if (messagesToFullyDelete.length > 0) {
                // Delete files from storage first
                const filesToDelete = messagesToFullyDelete
                    .filter(msg => msg.file_url)
                    .map(msg => {
                        const url = msg.file_url;
                        const matches = url.match(/bucket\/([^?]+)/);
                        return matches ? matches[1] : null;
                    })
                    .filter(path => path !== null);

                if (filesToDelete.length > 0) {
                    const { error: storageError } = await supabase.storage
                        .from('bucket')
                        .remove(filesToDelete);
                    
                    if (storageError) {
                        console.error('Storage deletion error:', storageError);
                    }
                }

                // Delete messages from database
                const messageIds = messagesToFullyDelete.map(msg => msg.id);
                const { error: deleteError } = await supabase
                    .from('messages')
                    .delete()
                    .in('id', messageIds);

                if (deleteError) {
                    console.error('Delete error:', deleteError);
                }
            }
        }

        // 5. If currently chatting with this user, close the chat
        if (currentChatUser && currentChatUser.id === user.id) {
            currentChatUser = null;
            currentMessages = [];
            document.getElementById('chatHeader').style.display = 'none';
            document.getElementById('chatInput').style.display = 'none';
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👋</div><h3>Hoş Geldiniz!</h3><p>Bir konuşma seçin veya online kullanıcılardan birine tıklayın</p></div>';
        }

        // 6. Reload conversations list
        await loadConversations();

        hideLoadingIndicator();
        showSuccessMessage(`${user.nickname} ile olan konuşma sizin için gizlendi!`);

    } catch (error) {
        console.error('Konuşma silme hatası:', error);
        hideLoadingIndicator();
        await showAlert('Konuşma silinirken bir hata oluştu:\n' + error.message, 'Hata', 'error');
    }
}

// Download Conversation Function
async function downloadConversation(user) {
    try {
        showLoadingIndicator('Konuşma hazırlanıyor...');

        // 1. Tüm mesajları çek
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${user.id}),and(sender_id.eq.${user.id},receiver_id.eq.${currentUser.id})`)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Filter out deleted messages
        const visibleMessages = messages.filter(msg => {
            if (msg.sender_id === currentUser.id && msg.sender_deleted) return false;
            if (msg.receiver_id === currentUser.id && msg.receiver_deleted) return false;
            return true;
        });

        if (visibleMessages.length === 0) {
            hideLoadingIndicator();
            await showAlert('İndirilecek mesaj bulunamadı!', 'Uyarı', 'error');
            return;
        }

        // 2. Dosya içeriğini oluştur
        const now = new Date();
        const dateStr = now.toLocaleString('tr-TR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let content = '===========================================\n';
        content += `Konuşma: ${user.nickname}\n`;
        content += `Tarih: ${dateStr}\n`;
        content += `Toplam Mesaj: ${visibleMessages.length}\n`;
        content += '===========================================\n\n';

        visibleMessages.forEach(msg => {
            const time = new Date(msg.created_at).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const sender = msg.sender_id === currentUser.id ? 'Ben' : user.nickname;
            
            // Mesaj tipi kontrolü
            if (msg.message_type === 'image') {
                content += `[${time}] ${sender}: 📷 Resim gönderildi\n`;
            } else if (msg.message_type === 'file') {
                content += `[${time}] ${sender}: 📎 ${msg.file_name}\n`;
            } else {
                content += `[${time}] ${sender}: ${msg.message}\n`;
            }
        });

        content += '\n===========================================\n';
        content += 'Bu konuşma otomatik olarak indirilmiştir.\n';
        content += '===========================================\n';

        // 3. Dosya oluştur ve indir
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        // Dosya adı: KullaniciAdi_20250115_143045.txt
        const filename = `${user.nickname}_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}.txt`;
        
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        hideLoadingIndicator();
        showSuccessMessage(`${user.nickname} ile olan konuşma indirildi!`);

    } catch (error) {
        console.error('Konuşma indirme hatası:', error);
        hideLoadingIndicator();
        await showAlert('Konuşma indirilirken bir hata oluştu:\n' + error.message, 'Hata', 'error');
    }
}

function showLoadingIndicator(message) {
    const indicator = document.createElement('div');
    indicator.id = 'deleteLoadingIndicator';
    indicator.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--surface);
        padding: 30px 40px;
        border-radius: 15px;
        box-shadow: 0 10px 40px var(--shadow);
        z-index: 10001;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
    `;
    
    indicator.innerHTML = `
        <div class="uploading-spinner"></div>
        <div style="color: var(--text); font-weight: 600; font-size: 1.1em;">${message}</div>
    `;
    
    document.body.appendChild(indicator);

    // Add overlay
    const overlay = document.createElement('div');
    overlay.id = 'deleteOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 10000;
    `;
    document.body.appendChild(overlay);
}

function hideLoadingIndicator() {
    const indicator = document.getElementById('deleteLoadingIndicator');
    const overlay = document.getElementById('deleteOverlay');
    if (indicator) indicator.remove();
    if (overlay) overlay.remove();
}

function showSuccessMessage(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--success);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
        z-index: 10001;
        font-weight: 600;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function togglePanel() {
    const panel = document.getElementById('conversationsPanel');
    const overlay = document.getElementById('panelOverlay');
    const icon = document.getElementById('toggleIcon');
    const toggleBtn = document.getElementById('panelToggleBtn');
    
    if (!panel || !icon || !toggleBtn) {
        console.error('Elementler bulunamadı!');
        return;
    }
    
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobil: panel açıp kapatma
        panel.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
        
        if (panel.classList.contains('open')) {
            icon.textContent = '✕';
            toggleBtn.style.left = '280px'; // Panel genişliği
        } else {
            icon.textContent = '☰';
            toggleBtn.style.left = '10px';
        }
    } else {
        // Desktop: panel daraltma
        panel.classList.toggle('collapsed');
        
        if (panel.classList.contains('collapsed')) {
            icon.textContent = '☰';
            toggleBtn.style.left = '10px'; // ← Sola kay
        } else {
            icon.textContent = '✕';
            toggleBtn.style.left = '350px'; // ← Panel genişliğine dön
        }
    }
}

// Sayfa yüklendiğinde pozisyon ayarla
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('conversationsPanel');
    const icon = document.getElementById('toggleIcon');
    const toggleBtn = document.getElementById('panelToggleBtn');
    
    if (window.innerWidth <= 768) {
        panel.classList.add('collapsed');
        icon.textContent = '☰';
        if (toggleBtn) toggleBtn.style.left = '10px';
    }
});

// Pencere boyutu değişince pozisyonu güncelle
window.addEventListener('resize', () => {
    const panel = document.getElementById('conversationsPanel');
    const overlay = document.getElementById('panelOverlay');
    const icon = document.getElementById('toggleIcon');
    const toggleBtn = document.getElementById('panelToggleBtn');
    
    if (window.innerWidth > 768) {
        // Desktop'a geçince
        if (overlay) overlay.classList.remove('active');
        panel.classList.remove('open');
        
        // Buton pozisyonu
        if (panel.classList.contains('collapsed')) {
            icon.textContent = '☰';
            if (toggleBtn) toggleBtn.style.left = '10px';
        } else {
            icon.textContent = '✕';
            if (toggleBtn) toggleBtn.style.left = '320px';
        }
    } else {
        // Mobile'a geçince
        if (toggleBtn) {
            toggleBtn.style.left = panel.classList.contains('open') ? '280px' : '10px';
        }
    }
});

// Custom Alert Function
function showAlert(message, title = 'Bildirim', type = 'info') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customAlertModal');
        const titleEl = document.getElementById('alertTitle');
        const messageEl = document.getElementById('alertMessage');
        const okBtn = document.getElementById('alertOkBtn');
        const header = modal.querySelector('.custom-modal-header');
        
        // Set content
        titleEl.textContent = title;
        messageEl.textContent = message;
        
        // Set icon based on type
        const iconEl = header.querySelector('.custom-modal-icon');
        header.classList.remove('alert-header', 'error-header', 'success-header');
        
        switch(type) {
            case 'error':
                iconEl.textContent = '❌';
                header.classList.add('error-header');
                break;
            case 'success':
                iconEl.textContent = '✅';
                header.classList.add('success-header');
                break;
            default:
                iconEl.textContent = 'ℹ️';
                header.classList.add('alert-header');
        }
        
        // Show modal
        modal.style.display = 'flex';
        
        // Handle close
        const closeHandler = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', closeHandler);
            resolve();
        };
        
        okBtn.addEventListener('click', closeHandler);
        
        // ESC key support
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                okBtn.removeEventListener('click', closeHandler);
                document.removeEventListener('keydown', escHandler);
                resolve();
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// Custom Confirm Function
function showConfirm(message, title = 'Onay', confirmText = 'Evet', cancelText = 'İptal') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        
        // Set content
        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        
        // Show modal
        modal.style.display = 'flex';
        
        // Handle confirm
        const confirmHandler = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        // Handle cancel
        const cancelHandler = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        // Cleanup listeners
        const cleanup = () => {
            okBtn.removeEventListener('click', confirmHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            document.removeEventListener('keydown', escHandler);
        };
        
        okBtn.addEventListener('click', confirmHandler);
        cancelBtn.addEventListener('click', cancelHandler);
        
        // ESC key support
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                cancelHandler();
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// Online bar scroll fonksiyonu
function scrollOnlineBar(direction) {
    const onlineBar = document.getElementById('onlineBar');
    const scrollAmount = 300; // Piksel cinsinden kaydırma miktarı
    
    if (direction === 'left') {
        onlineBar.scrollBy({
            left: -scrollAmount,
            behavior: 'smooth'
        });
    } else {
        onlineBar.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
    }
    
    // Buton görünürlüğünü güncelle
    updateScrollButtons();
}

// Scroll butonlarının görünürlüğünü kontrol et
function updateScrollButtons() {
    const onlineBar = document.getElementById('onlineBar');
    const leftBtn = document.getElementById('scrollLeftBtn');
    const rightBtn = document.getElementById('scrollRightBtn');
    
    if (!onlineBar || !leftBtn || !rightBtn) return;
    
    // Sol butonu kontrol et
    if (onlineBar.scrollLeft <= 0) {
        leftBtn.classList.add('hidden');
    } else {
        leftBtn.classList.remove('hidden');
    }
    
    // Sağ butonu kontrol et
    const maxScroll = onlineBar.scrollWidth - onlineBar.clientWidth;
    if (onlineBar.scrollLeft >= maxScroll - 5) { // 5px tolerans
        rightBtn.classList.add('hidden');
    } else {
        rightBtn.classList.remove('hidden');
    }
}

// Online bar scroll event'i
document.addEventListener('DOMContentLoaded', () => {
    const onlineBar = document.getElementById('onlineBar');
    if (onlineBar) {
        onlineBar.addEventListener('scroll', updateScrollButtons);
        
        // İlk yüklemede butonları kontrol et
        setTimeout(updateScrollButtons, 500);
    }
});


// Mouse wheel ile yatay kaydırma
document.addEventListener('DOMContentLoaded', () => {
    const onlineBar = document.getElementById('onlineBar');
    
    if (onlineBar) {
        onlineBar.addEventListener('wheel', (e) => {
            // Yatay scroll varsa
            if (onlineBar.scrollWidth > onlineBar.clientWidth) {
                e.preventDefault();
                onlineBar.scrollLeft += e.deltaY;
            }
        });
    }
});

// Profile Picture Upload Functions
let currentProfilePictureFile = null;
let currentProfilePictureUrl = null;

// Galeriden dosya seçildiğinde
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('profilePictureFile');
    if (fileInput) {
        fileInput.addEventListener('change', handleProfilePictureSelect);
    }
});

async function handleProfilePictureSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Dosya tipi kontrolü
    if (!file.type.startsWith('image/')) {
        await showAlert('Lütfen bir resim dosyası seçin!', 'Geçersiz Dosya', 'error');
        return;
    }

    // Dosya boyutu kontrolü (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        await showAlert('Resim boyutu en fazla 5MB olabilir!', 'Dosya Çok Büyük', 'error');
        return;
    }

    // Önizleme göster
    const reader = new FileReader();
    reader.onload = (e) => {
        showProfilePicturePreview(e.target.result);
    };
    reader.readAsDataURL(file);

    // Dosyayı kaydet
    currentProfilePictureFile = file;
    
    // Supabase'e yükle
    await uploadProfilePicture(file);
}

function showProfilePicturePreview(imageUrl) {
    const placeholder = document.querySelector('.profile-picture-placeholder');
    const previewImage = document.getElementById('profilePreviewImage');
    const removeBtn = document.getElementById('removeProfilePicBtn');

    if (placeholder) placeholder.style.display = 'none';
    if (previewImage) {
        previewImage.src = imageUrl;
        previewImage.style.display = 'block';
    }
    if (removeBtn) removeBtn.style.display = 'flex';
}

async function uploadProfilePicture(file) {
    const uploadStatus = document.getElementById('uploadStatus');
    
    try {
        // Yükleme durumunu göster
        if (uploadStatus) uploadStatus.style.display = 'flex';

        // Benzersiz dosya adı oluştur
        const fileExt = file.name.split('.').pop();
        const fileName = `profile_${currentUser.id}_${Date.now()}.${fileExt}`;
        const filePath = `profiles/${fileName}`;

        // Eski profil resmini sil (varsa)
        if (currentUser.profile_picture) {
            const oldUrl = currentUser.profile_picture;
            const matches = oldUrl.match(/profiles\/([^?]+)/);
            if (matches) {
                await supabase.storage
                    .from('bucket')
                    .remove([`profiles/${matches[1]}`]);
            }
        }

        // Yeni resmi yükle
        const { data, error } = await supabase.storage
            .from('bucket')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        // Public URL al
        const { data: urlData } = supabase.storage
            .from('bucket')
            .getPublicUrl(filePath);

        currentProfilePictureUrl = urlData.publicUrl;

        // Veritabanını güncelle
        const { error: updateError } = await supabase
            .from('users')
            .update({ profile_picture: currentProfilePictureUrl })
            .eq('id', currentUser.id);

        if (updateError) throw updateError;

        // Mevcut kullanıcı bilgisini güncelle
        currentUser.profile_picture = currentProfilePictureUrl;

        // Yükleme durumunu gizle
        if (uploadStatus) uploadStatus.style.display = 'none';

        await showAlert('Profil resmi başarıyla güncellendi!', 'Başarılı', 'success');

    } catch (error) {
        console.error('Profil resmi yükleme hatası:', error);
        if (uploadStatus) uploadStatus.style.display = 'none';
        await showAlert('Profil resmi yüklenirken bir hata oluştu:\n' + error.message, 'Hata', 'error');
    }
}

function removeProfilePicture() {
    const placeholder = document.querySelector('.profile-picture-placeholder');
    const previewImage = document.getElementById('profilePreviewImage');
    const removeBtn = document.getElementById('removeProfilePicBtn');
    const fileInput = document.getElementById('profilePictureFile');

    if (placeholder) placeholder.style.display = 'flex';
    if (previewImage) {
        previewImage.style.display = 'none';
        previewImage.src = '';
    }
    if (removeBtn) removeBtn.style.display = 'none';
    if (fileInput) fileInput.value = '';

    currentProfilePictureFile = null;
    currentProfilePictureUrl = null;
}

// Camera Functions
let cameraStream = null;
let cameraVideo = null;
let cameraCanvas = null;

async function openCamera() {
    try {
        // Kamera modal oluştur
        const modal = document.createElement('div');
        modal.id = 'cameraModal';
        modal.className = 'camera-modal';
        modal.innerHTML = `
            <div class="camera-modal-content">
                <div class="camera-modal-header">
                    <div class="camera-modal-title">📸 Fotoğraf Çek</div>
                    <button class="modal-btn modal-close" onclick="closeCamera()">✕</button>
                </div>
                <div class="camera-preview">
                    <video id="cameraVideo" autoplay playsinline></video>
                    <canvas id="cameraCanvas"></canvas>
                </div>
                <div class="camera-controls" id="cameraControls">
                    <button class="camera-btn cancel" onclick="closeCamera()">İptal</button>
                    <button class="camera-btn capture" id="captureBtn" onclick="capturePhoto()">📷 Fotoğraf Çek</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        cameraVideo = document.getElementById('cameraVideo');
        cameraCanvas = document.getElementById('cameraCanvas');

        // Kamera erişimi iste
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'user', // Ön kamera (selfie)
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        cameraVideo.srcObject = cameraStream;

    } catch (error) {
        console.error('Kamera erişim hatası:', error);
        
        if (error.name === 'NotAllowedError') {
            await showAlert('Kamera erişimi reddedildi. Lütfen tarayıcı ayarlarından kamera iznini açın.', 'Erişim Reddedildi', 'error');
        } else if (error.name === 'NotFoundError') {
            await showAlert('Kamera bulunamadı. Lütfen cihazınızda kamera olduğundan emin olun.', 'Kamera Bulunamadı', 'error');
        } else {
            await showAlert('Kamera açılırken bir hata oluştu:\n' + error.message, 'Hata', 'error');
        }
        
        closeCamera();
    }
}

function capturePhoto() {
    if (!cameraVideo || !cameraCanvas) return;

    // Canvas boyutlarını video boyutlarına ayarla
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;

    // Video'dan fotoğraf çek
    const context = cameraCanvas.getContext('2d');
    context.drawImage(cameraVideo, 0, 0);

    // Video'yu gizle, canvas'ı göster
    cameraVideo.style.display = 'none';
    cameraCanvas.style.display = 'block';

    // Butonları değiştir
    const controls = document.getElementById('cameraControls');
    controls.innerHTML = `
        <button class="camera-btn cancel" onclick="closeCamera()">İptal</button>
        <button class="camera-btn retake" onclick="retakePhoto()">🔄 Tekrar Çek</button>
        <button class="camera-btn use" onclick="usePhoto()">✓ Kullan</button>
    `;
}

function retakePhoto() {
    if (!cameraVideo || !cameraCanvas) return;

    // Canvas'ı gizle, video'yu göster
    cameraCanvas.style.display = 'none';
    cameraVideo.style.display = 'block';

    // Butonları değiştir
    const controls = document.getElementById('cameraControls');
    controls.innerHTML = `
        <button class="camera-btn cancel" onclick="closeCamera()">İptal</button>
        <button class="camera-btn capture" onclick="capturePhoto()">📷 Fotoğraf Çek</button>
    `;
}

async function usePhoto() {
    if (!cameraCanvas) return;

    // Canvas'tan blob oluştur
    cameraCanvas.toBlob(async (blob) => {
        // Blob'u File'a çevir
        const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
        
        // Kamerayı kapat
        closeCamera();

        // Önizleme göster
        const reader = new FileReader();
        reader.onload = (e) => {
            showProfilePicturePreview(e.target.result);
        };
        reader.readAsDataURL(file);

        // Dosyayı yükle
        await uploadProfilePicture(file);
    }, 'image/jpeg', 0.9);
}

function closeCamera() {
    // Kamera stream'ini durdur
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    // Modal'ı kaldır
    const modal = document.getElementById('cameraModal');
    if (modal) {
        modal.remove();
    }

    cameraVideo = null;
    cameraCanvas = null;
}

// ESC tuşu ile kamerayı kapat
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const cameraModal = document.getElementById('cameraModal');
        if (cameraModal) {
            closeCamera();
        }
    }
});