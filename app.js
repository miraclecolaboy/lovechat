// app.js 閳?鐎瑰本鏆ｉ悧鍫礄閸ュ墽澧栭崢瀣級/娑撳﹣绱?+ 閸忋劌鐪☉鍫熶紖閸ュ墽澧栨０鍕潔閿?
(() => {
  // --------------- 闁板秶鐤?---------------
  const DEV_NOTE = '开发说明';
  const SUPABASE_URL = 'https://fjjbodkvytpekzzxerzr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqamJvZGt2eXRwZWt6enhlcnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MDAyMjMsImV4cCI6MjA4MDM3NjIyM30.ctMcySWOXS9SbBQBRVQjpK-6SlSxjSZ8aYmUx_Q3ee4';
  const SUPABASE_BUCKET = 'chat';
  const MAX_UPLOAD_SIZE_MB = 50;
  const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  const VIDEO_MAX_DURATION_SEC = 10 * 60;
  const VIDEO_MAX_LONG_EDGE = 640;
  const VIDEO_MAX_SHORT_EDGE = 360;
  const VIDEO_TARGET_FPS = 24;
  const VIDEO_VIDEO_BITRATE = 450 * 1024;
  const VIDEO_AUDIO_BITRATE = 64 * 1024;

  // supabase client閿涘牏鈥樻穱?SDK 瀹告彃婀?HTML 閸忓牆绱╅崗銉礆
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --------------- DOM 閸忓啰绀?---------------
  const loginView = document.getElementById('loginView');
  const app = document.getElementById('app');
  const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
  const tabs = Array.from(document.querySelectorAll('.tab.view'));
  const btnRegister = document.getElementById('btn-register');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');

  // messages tab
  const conversationsPanel = document.getElementById('conversationsPanel');
  const chatPanel = document.getElementById('chatPanel');
  const conversationsList = document.getElementById('conversationsList');
  const chatTitle = document.getElementById('chatTitle');
  const friendRemarkDisplay = document.getElementById('friendRemarkDisplay');
  const editRemarkBtn = document.getElementById('editRemarkBtn');
  const backToConvos = document.getElementById('backToConvos');
  if (backToConvos) {
  backToConvos.addEventListener('click', () => {
    showConversationsPanel(); // 閸掑洦宕查崶鐐扮窗鐠囨繂鍨悰?
  });
}

  const chatWindow = document.getElementById('chatWindow');
  const msgInput = document.getElementById('msgInput');
  const btnSendText = document.getElementById('btnSendText');

  // 閸ュ墽澧栨稉濠佺炊閸忓啰绀岄敍鍦歍ML 娑擃厼绨茬€涙ê婀敍?
  const imgUpload = document.getElementById('imgUpload');
  const btnSendImage = document.getElementById('btnSendImage');

  // contacts tab
  const newFriendInput = document.getElementById('newFriend');
  const btnAdd = document.getElementById('btn-add');
  const friendsList = document.getElementById('friendsList');

  // me tab
  const meAvatarWrap = document.getElementById('meAvatarWrap');
  const avatarInput = document.getElementById('avatarInput');
  const btnSaveAvatar = document.getElementById('btnSaveAvatar');
  const meNote = document.getElementById('meNote');

  // --------------- 閻樿埖鈧?---------------
  let currentUser = null;
  let currentFriend = null;
  let friends = [];

// 閺傛澘顤冪痪銏㈠仯
let unreadMap = {};
const storedUnread = localStorage.getItem('chat_unreadMap');
if (storedUnread) {
  try {
    unreadMap = JSON.parse(storedUnread);
  } catch(e) { unreadMap = {}; }
}

function updateConversationRedDot(friend) {
  const divs = conversationsList.querySelectorAll('.friend');
  divs.forEach(div => {
    const titleDiv = div.querySelector('div > div'); // 娴兼俺鐦介弽鍥暯
    if (titleDiv && titleDiv.textContent.includes(friend)) {
      const dot = div.querySelector('.red-dot');
      if (dot) dot.style.visibility = unreadMap[friend] ? 'visible' : 'hidden';
    }
  });
  // 閸氬本顒?localStorage
  localStorage.setItem('chat_unreadMap', JSON.stringify(unreadMap));
}


  let myAvatar = '';

  // avatar cache
  const avatarCache = {};
  const avatarPromises = {};

  // socket
  let socket = null;

  // throttle / mutex
  let _loadConvTimer = null;
  let _isLoadingConversations = false;
  function throttleLoadConversations() {
    if (_isLoadingConversations) return;
    if (_loadConvTimer) return;
    _loadConvTimer = setTimeout(() => {
      _loadConvTimer = null;
      loadConversations();
    }, 50);
  }

  // --------------- UI helpers ---------------
  function showLogin() { if(loginView) loginView.style.display='block'; if(app) app.style.display='none'; document.title='lovechat'; }
  function showApp() { if(loginView) loginView.style.display='none'; if(app) app.style.display='block'; }
  function switchTab(targetId){
    tabs.forEach(t => t.id === targetId ? t.classList.add('active') : t.classList.remove('active'));
    navBtns.forEach(b => b.dataset.target === targetId ? b.classList.add('active') : b.classList.remove('active'));
    if(targetId === 'tab-messages') throttleLoadConversations();
  }
  navBtns.forEach(b => b.addEventListener('click', ()=> switchTab(b.dataset.target)));

  function escapeHTML(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function truncate(s,n){ if(!s) return ''; return s.length>n ? s.slice(0,n-1) + '...' : s; }
  function formatTime(ts){ try{ const d=new Date(ts); return d.toLocaleTimeString(); }catch(e){ return ''; } }
  function runAfterUIReady(cb){ requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ setTimeout(() => { try{ cb(); }catch(e){ console.error(e); } },0); }); }); }

  // avatar
  function makeInitialsDiv(username, size=52){
    const d = document.createElement('div');
    d.className = 'avatar-initial';
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    const initials = (username||'?').trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase() || '?';
    d.textContent = initials;
    return d;
  }
  function makeAvatarDOM(username, url, size=52){
    const wrapper = document.createElement('div');
    wrapper.style.width = size + 'px';
    wrapper.style.height = size + 'px';
    wrapper.className = 'avatar-wrap';
    if(url && url.trim()){
      const img = document.createElement('img');
      img.src = url;
      img.alt = username;
      img.onerror = ()=>{ wrapper.innerHTML=''; wrapper.appendChild(makeInitialsDiv(username,size)); };
      wrapper.appendChild(img);
    } else wrapper.appendChild(makeInitialsDiv(username,size));
    return wrapper;
  }
  function renderMyAvatar(){ if(!meAvatarWrap) return; meAvatarWrap.innerHTML=''; meAvatarWrap.appendChild(makeAvatarDOM(currentUser,myAvatar,52)); }

  function showConversationsPanel(){ if(conversationsPanel) conversationsPanel.style.display=''; if(chatPanel) chatPanel.style.display='none'; if(chatPanel) chatPanel.classList.remove('chat-panel-full'); window.currentFriend = null; }
  function showChatPanelFull(){ if(conversationsPanel) conversationsPanel.style.display='none'; if(chatPanel) chatPanel.style.display=''; if(chatPanel) chatPanel.classList.add('chat-panel-full'); }

  // -------- avatar cache helpers ----------
  function getAvatarFromCache(u){
    if(!u) return '';
    if(avatarCache.hasOwnProperty(u)) return avatarCache[u];
    if(avatarPromises[u]) return '';
    avatarPromises[u] = fetch(`/user/${encodeURIComponent(u)}`)
      .then(r=>r.json())
      .then(j => { avatarCache[u] = (j && j.avatar) ? j.avatar : ''; delete avatarPromises[u]; renderContacts(); throttleLoadConversations(); return avatarCache[u]; })
      .catch(()=>{ delete avatarPromises[u]; avatarCache[u]=''; return ''; });
    return '';
  }
  function getAvatarForUser(u){ if(!u) return ''; if(avatarCache.hasOwnProperty(u)) return avatarCache[u]; getAvatarFromCache(u); return ''; }

  // --------------- Socket ---------------
  function connectSocket(){
  if(socket){ try{ socket.off(); socket.disconnect(); }catch(e){} socket=null; }
  socket = io();

  socket.on('connect', () => { if(currentUser) socket.emit('login', currentUser); });

  // 閸氬本顒為崥搴ｎ伂閺堫亣顕板☉鍫熶紖閸掔増婀伴崷?unreadMap閿涘牆銇囨禍?鐠侀缍?true閿?
socket.on('unread-counts', counts => {
  // counts 閺嶇厧绱? [{ from_user: 'Alice', count: 3 }, ...]
  counts.forEach(item => {
    if(item.count > 0){
      unreadMap[item.from_user] = true;
      updateConversationRedDot(item.from_user);
    }
  });
});

  socket.on('online-status', list => {
    // 绾喕绻氶崷銊у殠閸掓銆冮崗銊ョ湰閸欘垳鏁?
    window.onlineUsersList = list || [];
    renderContacts(); // 濮ｅ繑顐奸崷銊у殠閻樿埖鈧礁褰夐崠鏍厴閸掗攱鏌婃總钘夊几閸掓銆?
  });

// socket.on('receive-message', ...)
socket.on('receive-message', data => {
  if (!data || !data.from) return;
  addMessageToWindow(data.from, data.message);
  

 // 閺嶅洩顔囬張顏囶嚢
  unreadMap[data.from] = true;
  updateConversationRedDot(data.from);

  // 閺囧瓨鏌婂☉鍫熶紖閸掓銆?DOM
  updateConversationRedDot(data.from);

  //  濡楀矂娼伴柅姘辩叀
  if (Notification.permission === 'granted') {
    const n = new Notification(data.from, {
      body: data.message.length > 50 ? data.message.slice(0, 50) + '...' : data.message,
      icon: avatarCache[data.from] || '/favicon.png',
    });
    n.onclick = () => {
      window.focus();
      openConversation(data.from);
      n.close();
    };
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
   throttleLoadConversations();
});


    socket.on('online-status', list => { /* optional: set onlineUsers if you maintain that */ });
  }

  // --------------- Friends / Conversations ---------------
async function loadFriends(){
  if(!currentUser) return;
  try{
    const r = await fetch(`/friends/${encodeURIComponent(currentUser)}`);
    const list = await r.json();
    list.forEach(x=>{ if(x.avatar && x.avatar.trim()) avatarCache[x.friend]=x.avatar; });
    
    friends = (list||[]).map(x=>({
      friend: x.friend,
      avatar: x.avatar || '',
      remark: x.remark || ''
    }));

    renderContacts();    // 閳?**閺堚偓闁插秷顩﹂惃鍕叏婢跺秶鍋?*

  }catch(e){
    friends=[];
    renderContacts();    // 闁挎瑨顕ら弮鏈电瘍閸掗攱鏌婇敍鍫滅箽閹镐椒绔撮懛杈剧礆
  }
}

function renderContacts() {
  if (!friendsList) return;
  friendsList.innerHTML = '';

  // 閼惧嘲褰囪ぐ鎾冲閸︺劎鍤庨悽銊﹀煕閸掓銆?
  const onlineList = window.onlineUsersList || []; // window.onlineUsersList 娴兼艾婀?socket.on('online-status') 閺囧瓨鏌?

  friends.forEach(item => {
  const f = item.friend;
  const av = avatarCache[f] || item.avatar || '';
  const remark = item.remark || '';

  const div = document.createElement('div'); 
  div.className = 'friend';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.gap = '10px';
  left.style.alignItems = 'center';
  left.appendChild(makeAvatarDOM(f, av, 44));

  const txt = document.createElement('div');
  const name = document.createElement('div');
  name.innerHTML = `${escapeHTML(remark ? remark : f)} (${escapeHTML(f)})`;

  const sub = document.createElement('div');
  sub.className = 'small muted';
  
  // 閻╁瓨甯存担璺ㄦ暏閺堚偓閺傛壆娈戦崷銊у殠閸掓銆冮崚銈嗘焽
  if (window.onlineUsersList && Array.isArray(window.onlineUsersList)) {
    sub.textContent = window.onlineUsersList.includes(f) ? '在线' : '离线';
  } else {
    sub.textContent = '离线';
  }

  txt.appendChild(name);
  txt.appendChild(sub);

  left.appendChild(txt);
  div.appendChild(left);


    // 閻愮懓鍤幍鎾崇磻閼卞﹤銇?
    div.addEventListener('click', () => {
      switchTab('tab-messages');
      openConversation(f);
    });

    // 缂傛牞绶径鍥ㄦ暈閹稿鎸?
    const editBtn = document.createElement('button');
    editBtn.textContent = '备注';
    editBtn.className = 'edit-remark-btn';
    editBtn.style.marginLeft = 'auto';
    editBtn.style.padding = '4px 8px';
    editBtn.style.fontSize = '12px';
    editBtn.addEventListener('click', e => { e.stopPropagation(); editRemarkForFriend(f); });
    div.appendChild(editBtn);

    friendsList.appendChild(div);
  });
}

async function loadConversations() {
  if (!currentUser || _isLoadingConversations) return;
  _isLoadingConversations = true;
  conversationsList.innerHTML = '';

  try {
    if (!friends || !friends.length) await loadFriends();

    const promises = friends.map(async f => {
      try {
        const res = await fetch(`/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(f.friend)}`);
        const list = await res.json();
        const last = (list && list.length) ? list[list.length-1] : null;
        return { friend: f.friend, avatar: avatarCache[f.friend] || f.avatar || '', remark: f.remark, last };
      } catch (e) {
        return { friend: f.friend, avatar: avatarCache[f.friend] || f.avatar || '', remark: f.remark, last: null };
      }
    });

    const conv = await Promise.all(promises);
    conv.sort((a,b) => {
  const t1 = a.last ? a.last.ts : 0;
  const t2 = b.last ? b.last.ts : 0;
  return t2 - t1; // 閺堚偓閺傛澘婀崜?
});

    conv.forEach(c => {
      const div = document.createElement('div');
      div.className = 'friend';
      div.style.position = 'relative'; // 閸忔娊鏁敍姘卞閻愬湱绮风€电懓鐣炬担宥呯箑妞よ婀?relative 閻栬泛顔愰崳?

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '10px';
      left.appendChild(makeAvatarDOM(c.friend, c.avatar || '', 44));

      const tc = document.createElement('div');
      const title = document.createElement('div');
      title.innerHTML = `${escapeHTML(c.remark ? c.remark : c.friend)} (${escapeHTML(c.friend)})`;

      const preview = document.createElement('div');
      preview.className = 'small muted';
      preview.textContent = c.last ?
        ((c.last.from_user === currentUser ? '娴? ' : '') + truncate(c.last.message, 40))
        : '閺嗗倹妫ゅ☉鍫熶紖';

      tc.appendChild(title);
      tc.appendChild(preview);
      left.appendChild(tc);

      div.appendChild(left);

      // 缁俱垻鍋?
      const dot = document.createElement('div');
      dot.className = 'red-dot';
      dot.style.position = 'absolute';
      dot.style.top = '12px';
      dot.style.right = '12px';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = 'red';
      dot.style.visibility = unreadMap[c.friend] ? 'visible' : 'hidden';
      div.appendChild(dot);

      // 閻愮懓鍤幍鎾崇磻娴兼俺鐦?
      div.addEventListener('click', () => openConversation(c.friend));

      conversationsList.appendChild(div);
    });

  } catch (e) { console.error(e); }
  finally { _isLoadingConversations = false; }
}


function openConversation(friend) {
  currentFriend = friend;
 // 閹垫挸绱戞导姘崇樈鐏忚鲸鐖ｇ拋棰佽礋瀹歌尪顕?
  unreadMap[friend] = false;
  updateConversationRedDot(friend);

  if (!currentUser) return;
  if (socket && socket.connected) socket.emit('open-conversation', { user: currentUser, friend });

  const found = friends.find(x => x.friend === friend);
  if (friendRemarkDisplay) friendRemarkDisplay.textContent = (found && found.remark) ? found.remark : '';
  if (chatTitle) chatTitle.textContent = friend;
  if (chatWindow) chatWindow.innerHTML = '';

  fetch(`/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(friend)}`)
    .then(r => r.json())
    .then(list => {
      list.forEach(m => addMessageToWindow(m.from_user, m.message));
      chatWindow.scrollTop = chatWindow.scrollHeight;
    })
    .catch(() => { });

  showChatPanelFull();
}


  // --------------- 閸ュ墽澧栭崢瀣級 & 娑撳﹣绱?---------------
  // 鏉╂柨娲?Blob閿涘湞PEG閿涘绗栫亸浠嬪櫤閸樺缂夐崚?maxSizeMB
  function isImageFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    return /^image\//i.test(file.type || '') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name);
  }

  function isVideoFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    return /^video\//i.test(file.type || '') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(name);
  }

  function clampEven(value) {
    const num = Math.max(2, Math.round(value));
    return num % 2 === 0 ? num : num - 1;
  }

  function getTargetVideoSize(width, height) {
    const w = Math.max(2, Number(width) || VIDEO_MAX_LONG_EDGE);
    const h = Math.max(2, Number(height) || VIDEO_MAX_SHORT_EDGE);
    const longEdge = Math.max(w, h);
    const shortEdge = Math.min(w, h);
    const scale = Math.min(1, VIDEO_MAX_LONG_EDGE / longEdge, VIDEO_MAX_SHORT_EDGE / shortEdge);
    return {
      width: clampEven(w * scale),
      height: clampEven(h * scale),
    };
  }

  function pickRecorderMimeType() {
    if (!window.MediaRecorder) return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  function createVideoRecorder(stream, mimeType) {
    const options = {
      videoBitsPerSecond: VIDEO_VIDEO_BITRATE,
      audioBitsPerSecond: VIDEO_AUDIO_BITRATE,
    };
    if (mimeType) {
      try {
        return {
          recorder: new MediaRecorder(stream, { ...options, mimeType }),
          normalizedType: mimeType.split(';')[0] || 'video/webm',
        };
      } catch (e) {}
    }
    const fallback = new MediaRecorder(stream, options);
    return {
      recorder: fallback,
      normalizedType: (fallback.mimeType || 'video/webm').split(';')[0],
    };
  }

  function compressImage(file, maxSizeMB = 1) {
    return new Promise((resolve) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const ratio = img.width / img.height;
        let targetW = img.width;
        let targetH = img.height;

        // 闂勬劕鍩楅崓蹇曠閿涘矂浼╅崗宥嗙€径褍娴橀悧?
        const MAX_PIXELS = 2000 * 2000;
        while (targetW * targetH > MAX_PIXELS) {
          targetW *= 0.9;
          targetH = Math.round(targetW / ratio);
        }

        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        let quality = 0.92;
        function tryCompress() {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size / 1024 / 1024 <= maxSizeMB || quality <= 0.2) {
              resolve(blob);
            } else {
              quality -= 0.07;
              tryCompress();
            }
          }, 'image/jpeg', quality);
        }
        tryCompress();
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    const compressed = await compressImage(file);
    // 閻㈢喐鍨氱€瑰鍙忛弬鍥︽閸?
    let fileName = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
    fileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    const { data, error } = await client.storage.from(SUPABASE_BUCKET).upload(fileName, compressed, {
      contentType: 'image/jpeg',
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error);
      return null;
    }

    const { data: urlData } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(fileName);
    return urlData?.publicUrl || null;
  }

  function compressVideo(file) {
    return new Promise((resolve, reject) => {
      if (!window.MediaRecorder) {
        reject(new Error('Video compression is not supported in this browser.'));
        return;
      }

      const recorderMimeType = pickRecorderMimeType();
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = objectUrl;
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      let recorder = null;
      let finalMimeType = 'video/webm';
      let drawTimer = null;
      let canvasStream = null;
      let mixedStream = null;
      let audioContext = null;
      let audioSource = null;
      let audioDestination = null;
      let cleaned = false;
      let failed = false;
      let compressTimeout = null;

      function stopTracks(stream) {
        if (!stream) return;
        stream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }

      async function cleanup() {
        if (cleaned) return;
        cleaned = true;
        if (drawTimer) {
          clearInterval(drawTimer);
          drawTimer = null;
        }
        if (compressTimeout) {
          clearTimeout(compressTimeout);
          compressTimeout = null;
        }
        try { video.pause(); } catch (e) {}
        video.removeAttribute('src');
        video.load();
        stopTracks(mixedStream);
        stopTracks(canvasStream);
        if (audioSource) {
          try { audioSource.disconnect(); } catch (e) {}
        }
        if (audioDestination) {
          try { audioDestination.disconnect(); } catch (e) {}
        }
        if (audioContext && audioContext.state !== 'closed') {
          try { await audioContext.close(); } catch (e) {}
        }
        URL.revokeObjectURL(objectUrl);
      }

      video.onerror = async () => {
        await cleanup();
        reject(new Error('Failed to read video file.'));
      };

      video.onloadedmetadata = async () => {
        try {
          const duration = Number(video.duration || 0);
          if (!duration || !Number.isFinite(duration)) {
            await cleanup();
            reject(new Error('Failed to read video duration.'));
            return;
          }
          if (duration > VIDEO_MAX_DURATION_SEC + 1) {
            await cleanup();
            reject(new Error('Video duration cannot exceed 10 minutes.'));
            return;
          }

          const timeoutMs = Math.min(12 * 60 * 1000, Math.max(90 * 1000, duration * 1000 + 120 * 1000));
          compressTimeout = setTimeout(async () => {
            failed = true;
            try {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
            } catch (e) {}
            await cleanup();
            reject(new Error('Video compression timed out. Please try a shorter video.'));
          }, timeoutMs);

          const targetSize = getTargetVideoSize(video.videoWidth, video.videoHeight);
          const canvas = document.createElement('canvas');
          canvas.width = targetSize.width;
          canvas.height = targetSize.height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) {
            await cleanup();
            reject(new Error('Failed to initialize video canvas.'));
            return;
          }
          if (typeof canvas.captureStream !== 'function') {
            await cleanup();
            reject(new Error('Video compression is not supported by this browser. Please use Chrome or Edge.'));
            return;
          }

          canvasStream = canvas.captureStream(VIDEO_TARGET_FPS);
          const tracks = [...canvasStream.getVideoTracks()];

          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              audioContext = new AudioCtx();
              audioSource = audioContext.createMediaElementSource(video);
              audioDestination = audioContext.createMediaStreamDestination();
              audioSource.connect(audioDestination);
              audioDestination.stream.getAudioTracks().forEach((track) => tracks.push(track));
            }
          } catch (err) {
            console.warn('video audio capture failed:', err);
          }

          mixedStream = new MediaStream(tracks);
          try {
            const created = createVideoRecorder(mixedStream, recorderMimeType);
            recorder = created.recorder;
            finalMimeType = created.normalizedType || 'video/webm';
          } catch (err) {
            await cleanup();
            reject(new Error('Failed to start video encoder.'));
            return;
          }

          const chunks = [];
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onerror = async () => {
            failed = true;
            await cleanup();
            reject(new Error('Video compression failed.'));
          };
          recorder.onstop = async () => {
            await cleanup();
            if (failed) return;
            resolve(new Blob(chunks, { type: finalMimeType }));
          };

          function drawFrame() {
            if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.05)) {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
              return;
            }
            if (video.paused) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }

          drawFrame();
          drawTimer = setInterval(drawFrame, Math.max(16, Math.round(1000 / VIDEO_TARGET_FPS)));
          video.onended = () => {
            if (recorder && recorder.state !== 'inactive') recorder.stop();
          };

          if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          recorder.start(1000);
          await video.play();
        } catch (err) {
          failed = true;
          if (recorder && recorder.state !== 'inactive') recorder.stop();
          await cleanup();
          reject(new Error((err && err.message) ? err.message : 'Failed to start video compression.'));
        }
      };
    });
  }

  async function uploadMedia(file) {
    if (!file) throw new Error('No file selected.');
    const mediaIsImage = isImageFile(file);
    const mediaIsVideo = isVideoFile(file);
    if (!mediaIsImage && !mediaIsVideo) throw new Error('Only image/video files are supported.');

    let compressed = file;
    let mediaType = 'image';
    let contentType = file.type || '';
    let ext = 'jpg';

    if (mediaIsImage) {
      compressed = await compressImage(file);
      mediaType = 'image';
      contentType = 'image/jpeg';
      ext = 'jpg';
    } else {
      compressed = await compressVideo(file);
      mediaType = 'video';
      contentType = compressed.type || 'video/webm';
      ext = /mp4/i.test(contentType) ? 'mp4' : 'webm';
    }

    if (compressed.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(`Compressed file is still over ${MAX_UPLOAD_SIZE_MB}MB.`);
    }

    let fileName = `${mediaType}_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    fileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(fileName, compressed, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error('Upload to bucket failed.');
    }

    const { data: urlData } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(fileName);
    const url = urlData?.publicUrl || null;
    if (!url) throw new Error('Failed to get file URL.');
    return { url, type: mediaType };
  }

  function createMessageContentNode(text) {
    // 闂堢偟鈹栨穱婵囧Б
    if (!text && text !== '') return document.createTextNode('');

    const frag = document.createDocumentFragment();
    // URL 濮濓絽鍨敍鍫濈发缁犫偓閸楁洩绱濋柅鍌氭値婢堆冾樋閺?http(s) 闁剧偓甯撮敍?
    const urlRegex = /https?:\/\/[^\s]+/g;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const idx = match.index;
      // 娑斿澧犻惃鍕珮闁碍鏋冮張?
      if (idx > lastIndex) {
        const plain = text.slice(lastIndex, idx);
        frag.appendChild(document.createTextNode(plain));
      }

      // 閸掋倖鏌囬弰顖氭儊娑撳搫娴橀悧鍥懠閹恒儻绱欓幐澶嬪⒖鐏炴洖鎮曢敍?
      const urlForExt = url.split('#')[0].split('?')[0];
      const isImg = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(urlForExt);
      const isVideo = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(urlForExt);
      if (isImg) {
        const wrap = document.createElement('div');
        wrap.className = 'inline-img-wrap';
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'image';
        img.className = 'inline-msg-img';
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => {
          const modal = document.createElement('div');
          modal.style.position = 'fixed';
          modal.style.inset = '0';
          modal.style.background = 'rgba(0,0,0,0.6)';
          modal.style.display = 'flex';
          modal.style.alignItems = 'center';
          modal.style.justifyContent = 'center';
          modal.style.zIndex = 9999;
          const large = document.createElement('img');
          large.src = url;
          large.style.maxWidth = '90%';
          large.style.maxHeight = '90%';
          large.style.borderRadius = '8px';
          modal.appendChild(large);
          modal.addEventListener('click', () => document.body.removeChild(modal));
          document.body.appendChild(modal);
        });
        wrap.appendChild(img);
        frag.appendChild(wrap);
      } else if (isVideo) {
        const wrap = document.createElement('div');
        wrap.className = 'inline-video-wrap';
        wrap.style.maxWidth = '260px';

        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.className = 'inline-msg-video';
        video.style.width = '100%';
        video.style.maxHeight = '220px';
        video.style.borderRadius = '8px';
        video.style.background = '#000';

        wrap.appendChild(video);
        frag.appendChild(wrap);
      } else {
        // 閺咁噣鈧岸鎽奸幒銉︽▔缁€杞拌礋閸欘垳鍋ｉ柧鐐复
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;
        frag.appendChild(a);
      }

      lastIndex = idx + url.length;
    }
    // 閺堚偓閸氬海娈戦弬鍥ㄦ拱
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    // 婵″倹鐏夊▽鈩冩箒閸栧綊鍘ら崚棰佹崲娴?URL閿涘瞼娲块幒銉ㄧ箲閸ョ偞鏋冮張顒冨Ν閻?
    if (!frag.childNodes.length) return document.createTextNode(text);
    return frag;
  }

  // 鐏忓棙绉烽幁顖氬敶鐎圭懓鐣ㄩ崗銊﹁閺屾挸鍩屽鏃€鍦洪敍鍫滅瑝娴ｈ法鏁?innerHTML閿?
  function addMessageToWindow(sender, text) {
    if(!chatWindow) return;
    const isMe = sender === currentUser;
    const row = document.createElement('div');
    row.className = 'msg-row ' + (isMe ? 'msg-right' : 'msg-left');

    const avWrap = makeAvatarDOM(sender, isMe ? myAvatar : getAvatarForUser(sender), 44);
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + (isMe ? 'me' : 'you');

    const contentNode = createMessageContentNode(text || '');
    bubble.appendChild(contentNode);

    if (isMe) {
      row.style.justifyContent = 'flex-end';
      row.appendChild(bubble);
      row.appendChild(avWrap);
    } else {
      row.style.justifyContent = 'flex-start';
      row.appendChild(avWrap);
      row.appendChild(bubble);
    }
    chatWindow.appendChild(row);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  // --------------- 閸欐垿鈧焦绉烽幁顖ょ礄閺傚洦婀?閸ュ墽澧栭敍?---------------
  async function sendMessage(text) {
    if (!currentFriend) { alert('鐠囩兘鈧瀚ㄦ导姘崇樈'); return; }
    if (!text) return;
    const payload = { from: currentUser, to: currentFriend, message: text };
    if (socket && socket.connected) {
      socket.emit('send-message', payload);
    } else {
      fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
    }
    addMessageToWindow(currentUser, text);
    throttleLoadConversations();
    if(msgInput) msgInput.value = '';
  }

  async function handleMediaSelection(fileInput, file) {
    if (!currentUser || !currentFriend) {
      alert('请先选择会话');
      fileInput.value = '';
      return;
    }
    if (!isImageFile(file) && !isVideoFile(file)) {
      alert('仅支持图片或视频文件');
      fileInput.value = '';
      return;
    }

    const oldBtnText = btnSendImage ? btnSendImage.textContent : '';
    if (btnSendImage) {
      btnSendImage.disabled = true;
      btnSendImage.textContent = isVideoFile(file) ? '压缩中...' : '上传中...';
    }

    try {
      const uploaded = await uploadMedia(file);
      addMessageToWindow(currentUser, uploaded.url);
      const payload = { from: currentUser, to: currentFriend, message: uploaded.url, type: uploaded.type };
      if (socket && socket.connected) socket.emit('send-message', payload);
      else fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
      throttleLoadConversations();
    } catch (err) {
      alert((err && err.message) ? err.message : '上传失败');
    } finally {
      fileInput.value = '';
      if (btnSendImage) {
        btnSendImage.disabled = false;
        btnSendImage.textContent = oldBtnText || '发送图片/视频';
      }
    }
  }
  // --------------- 娴滃娆㈢紒鎴濈暰閿涙碍鏋冮張顒€褰傞柅?---------------
  if(btnSendText) btnSendText.addEventListener('click', () => sendMessage(msgInput.value.trim()));
  if(msgInput) msgInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') sendMessage(msgInput.value.trim()); });
  if(btnSendImage && imgUpload) btnSendImage.addEventListener('click', () => imgUpload.click());

  // --------------- 娴滃娆㈢紒鎴濈暰閿涙艾娴橀悧鍥偓澶嬪 & 閼奉亜濮╂稉濠佺炊 ---------------
  if(imgUpload) {
    imgUpload.addEventListener('change', async (e) => {
      const fileInput = e.target;
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      // 娑撳﹣绱堕獮鎯板箯閸欐牕鍙曞鈧?URL
      await handleMediaSelection(fileInput, file);
      return;
      /*
      if (!url) {
        alert('娑撳﹣绱舵径杈Е');
        fileInput.value = '';
        return;
      }
      // 閹绘帒鍙嗛崚棰佺窗鐠囨繄鐛ラ崣锝呰嫙娴ｆ粈璐熷☉鍫熶紖閸欐垿鈧緤绱欐稉?sendMessage 娣囨繃瀵旀稉鈧懛杈剧礆
      addMessageToWindow(currentUser, url);
      // 閸欐垿鈧礁鍩岄張宥呭閸?
      if (!currentUser || !currentFriend) { fileInput.value = ''; return; }
      const payload = { from: currentUser, to: currentFriend, message: url, type: 'image' };
      if (socket && socket.connected) socket.emit('send-message', payload);
      else fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
      fileInput.value = '';
      throttleLoadConversations();
      */
    });
  }

  // --------------- 缂傛牞绶径鍥ㄦ暈 / 濞ｈ濮炴總钘夊几 / 婢舵潙鍎氭穱婵嗙摠 / 濞夈劌鍞介惂璇茬秿缁涘绱欐穱婵堟殌閸樼喖鈧槒绶敍?---------------
  function editRemarkForFriend(f){
    const cur = friends.find(x=>x.friend===f); const curR = cur?cur.remark:'';
    const r = prompt('设置备注（留空则取消）', curR);
    if(r===null) return;
    fetch('/set-remark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:currentUser,friend:f,remark:r})})
      .then(res=>res.json()).then(j=>{ if(j.success){ loadFriends(); throttleLoadConversations(); } else alert('鐠佸墽鐤嗘径杈Е'); })
      .catch(()=>alert('鐠囬攱鐪版径杈Е'));
  }

  if(btnAdd) btnAdd.addEventListener('click', ()=> {
    const t = newFriendInput.value.trim();
    if(!t){ alert('鐠囩柉绶崗銉ャ偨閸欏鏁ら幋宄版倳'); return; }
    fetch('/add-friend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:currentUser,friend:t})})
      .then(r=>r.json()).then(res=>{ if(res.success){ newFriendInput.value=''; loadFriends(); throttleLoadConversations(); } else alert('添加失败: ' + (res.msg||'未知')); })
      .catch(()=>alert('添加好友失败'));
  });

  if(btnSaveAvatar) btnSaveAvatar.addEventListener('click', ()=> {
    const url = avatarInput.value.trim();
    fetch('/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser,avatar:url})})
      .then(r=>r.json()).then(res=>{ if(res.success){ myAvatar = url || ''; avatarCache[currentUser] = myAvatar; renderMyAvatar(); loadFriends(); throttleLoadConversations(); } else alert('娣囨繂鐡ㄦ径杈Е'); })
      .catch(()=>alert('保存头像失败'));
  });

  if(btnRegister) btnRegister.addEventListener('click', async () => {
    const u = document.getElementById('li-username').value.trim();
    const p = document.getElementById('li-password').value;
    const c = document.getElementById('li-code').value.trim();
    if(!u||!p){ alert('用户名/密码不能为空'); return; }
    if(!c){ alert('鐠囧嘲锝為崘娆撳€嬬拠椋庣垳'); return; }
    try {
      const r = await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,code:c})});
      const res = await r.json();
      alert(res.success? '注册成功，请登录' : ('注册失败: ' + (res.msg||'未知')));
    } catch(e) { alert('注册请求失败'); }
  });

  if(btnLogin) btnLogin.addEventListener('click', async () => {
    const u = document.getElementById('li-username').value.trim();
    const p = document.getElementById('li-password').value;
    if(!u||!p){ alert('用户名/密码不能为空'); return; }
    try {
      const r = await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const res = await r.json();
      if(res.success){
        currentUser = res.user.username;
        myAvatar = res.user.avatar || '';
        localStorage.setItem('chat_currentUser', currentUser);
        localStorage.setItem('chat_myAvatar', myAvatar || '');
        avatarCache[currentUser] = myAvatar;
        document.getElementById('meName').textContent = currentUser;
        avatarInput.value = myAvatar;
        renderMyAvatar();
        connectSocket();
        await loadFriends();
        throttleLoadConversations();
        meNote.value = DEV_NOTE;
        showApp();
        document.getElementById('li-password').value = '';
      } else alert('登录失败: ' + (res.msg||'未知'));
    } catch(e) { alert('登录请求失败'); }
  });


  // Auto-login
  (function tryAutoLogin(){
    const stored = localStorage.getItem('chat_currentUser');
    const storedAvatar = localStorage.getItem('chat_myAvatar') || '';
    if(stored){
      currentUser = stored;
      myAvatar = storedAvatar;
      avatarCache[currentUser] = myAvatar;
      document.getElementById('meName').textContent = currentUser;
      avatarInput.value = myAvatar;
      renderMyAvatar();
      connectSocket();
      loadFriends().then(()=>{ throttleLoadConversations(); 
          fetchUnreadOnLogin();
      });
      
      meNote.value = DEV_NOTE;
      showApp();
      document.getElementById('li-password').value = '';
    } else {
      showLogin();
    }
  })();

  // Logout
  if(btnLogout) btnLogout.addEventListener('click', ()=> {
    if(currentUser) localStorage.setItem('chat_lastUser', currentUser);
    localStorage.removeItem('chat_currentUser');
    localStorage.removeItem('chat_myAvatar');
    try{ if(socket){ socket.emit('logout', currentUser); socket.disconnect(); } }catch(e){}
    location.reload();
  });

  // Expose some globals for legacy code expecting them
  window.currentUser = currentUser;
  window.currentFriend = currentFriend;
  window.socket = socket;

})(); // end IIFE
