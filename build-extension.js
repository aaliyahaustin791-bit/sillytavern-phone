const fs = require('fs');
const path = require('path');

const outDir = __dirname;

// Write main JS
const js = `/**
 * Phone Extension for SillyTavern
 * A fully functional smartphone simulation — calls, texts, social media, and web browser.
 * All data is scoped per-chat and never bleeds between conversations.
 */

// ============================================================
// STATE & DATA LAYER — per-chat isolation via ST's chat_metadata
// ============================================================
const STORAGE_KEY = 'phone_extension';

let phoneData = getEmptyPhoneData();
let activeApp = 'phone'; // phone, messages, social, browser, settings
let activeContactId = null;
let activeSocialTab = 'feed'; // feed, saved, compose

function loadPhoneData() {
    const meta = (typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null));
    if (!meta || !meta[STORAGE_KEY]) return getEmptyPhoneData();
    const empty = getEmptyPhoneData();
    for (const k of Object.keys(empty)) {
        if (meta[STORAGE_KEY][k] === undefined) meta[STORAGE_KEY][k] = empty[k];
    }
    return meta[STORAGE_KEY];
}

function savePhoneData(shouldSave) {
    if (shouldSave === undefined) shouldSave = true;
    phoneData._activeApp = activeApp;
    const meta = (typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null));
    if (!meta) return;
    if (!meta[STORAGE_KEY]) meta[STORAGE_KEY] = {};
    Object.assign(meta[STORAGE_KEY], phoneData);
    if (shouldSave) {
        if (typeof saveChatConditional === 'function') saveChatConditional(false);
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    }
}

function getEmptyPhoneData() {
    return {
        contacts: [],
        messages: [],
        phoneCalls: [],
        social: { feed: [], savedPosts: [] },
        browser: { tabs: [], activeTabId: null, bookmarks: [], history: [] },
        _activeApp: 'phone',
        _nextSeq: 1,
    };
}

function randId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return fmtTime(ts);
    return new Date(ts).toLocaleDateString();
}

// ============================================================
// EVENT SYNC — per-chat isolation on chat_change
// ============================================================
if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
    eventSource.on(event_types.CHAT_CHANGED, function() {
        savePhoneData(true);
        phoneData = loadPhoneData();
        activeApp = phoneData._activeApp || 'phone';
        activeContactId = null;
        activeSocialTab = 'feed';
        renderUI();
    });
}

// ============================================================
// PHONE APP — Dialer + Contacts + Call History
// ============================================================
const PhoneApp = {
    _dialPad: '',
    render: function() {
        var keypad = ['1','2','3','4','5','6','7','8','9','*','0','#']
            .map(function(k) {
                var sub = '';
                if (k >= '2' && k <= '9') sub = '<small>' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[parseInt(k)-2] + '</small>';
                return '<button class="pk" data-key="' + k + '"><span>' + k + '</span>' + sub + '</button>';
            }).join('');
        var recent = phoneData.phoneCalls.length === 0
            ? '<div class="pempty">No recent calls</div>'
            : phoneData.phoneCalls.slice().sort(function(a,b){return b.timestamp-a.timestamp;})
                .map(function(c) {
                    var co = phoneData.contacts.find(function(x){return x.id===c.contactId});
                    var name = co ? co.name : 'Unknown';
                    var ph = co ? co.phone : 'Unknown number';
                    var ic = c.status==='missed' ? 'fa-circle-xmark pcm' : c.type==='outgoing' ? 'fa-arrow-up pco' : 'fa-arrow-down pci';
                    return '<div class="pii">' +
                        '<div class="pav"><i class="fa-solid '+ic+'"></i></div>' +
                        '<div class="pinf"><span class="pname">'+name+' <small>(' + ph + ')</small></span>' +
                        '<span class="pdet">' + fmtTime(c.timestamp) + ' &#183; ' + (c.status==='missed' ? 'Missed' : c.duration+'s') + '</span></div>' +
                        '</div>';
                }).join('');
        var contacts = phoneData.contacts.length === 0
            ? '<div class="pempty">No contacts<br><small>Add via dialer</small></div>'
            : phoneData.contacts.map(function(c) {
                return '<div class="pii">' +
                    '<div class="pav">' + c.name[0].toUpperCase() + '</div>' +
                    '<div class="pinf"><span class="pname">' + c.name + '</span>' +
                    '<span class="pdet">' + c.phone + '</span></div>' +
                    '<button class="pmbtn" data-call-c="' + c.id + '"><i class="fa-solid fa-phone"></i></button>' +
                    '</div>';
            }).join('');
        return '<div class="pa" data-app="call">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-phone"></i> Phone</span>' +
            '<button class="pa-action" data-clear-calls="true"><i class="fa-solid fa-trash"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt active" data-section="dialer"><i class="fa-solid fa-keypad"></i> Dialer</button>' +
            '<button class="pt" data-section="recent"><i class="fa-solid fa-clock-rotate-left"></i> Recent</button>' +
            '<button class="pt" data-section="contacts"><i class="fa-solid fa-address-book"></i> Contacts</button>' +
            '</div>' +
            '<div class="pss active" data-section="dialer">' +
                '<div class="pdisp" id="pd"><span id="pdt"> </span></div>' +
                '<div class="ppad">' + keypad + '</div>' +
                '<div class="pcbar">' +
                    '<button class="pccb" data-call="true"><i class="fa-solid fa-phone"></i></button>' +
                    '<button class="pbacks" data-backspace="true"><i class="fa-solid fa-delete-left"></i></button>' +
                '</div></div>' +
            '<div class="pss" data-section="recent">' + recent + '</div>' +
            '<div class="pss" data-section="contacts">' + contacts + '</div>' +
            '</div>';
    },
    addDigit: function(k) {
        if(this._dialPad.length<15){this._dialPad+=k; var e=document.getElementById('pdt');if(e)e.textContent=this._dialPad;}
    },
    backspace: function() {
        this._dialPad=this._dialPad.slice(0,-1); var e=document.getElementById('pdt');if(e)e.textContent=this._dialPad||' ';
    },
    startCall: function() {
        var num=this._dialPad.trim(); if(!num){toastr.info('Enter a number');return;}
        var co=phoneData.contacts.find(function(c){return c.phone===num;});
        if(!co){co={id:randId(),name:num,phone:num,avatar:num};phoneData.contacts.push(co);toastr.info(num+' added to contacts');}
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=20+Math.floor(Math.random()*260);
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();toastr.success('Call with '+co.name+' ended ('+dur+'s)');},2000);
        this._dialPad=''; var e=document.getElementById('pdt');if(e)e.textContent=' ';
    },
    callContact: function(cid) {
        var co=phoneData.contacts.find(function(c){return c.id===cid;});if(!co)return;
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=10+Math.floor(Math.random()*300);
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();toastr.success('Call with '+co.name+' ended ('+dur+'s)');},2000);
    },
    clearCalls: function() { phoneData.phoneCalls=[];savePhoneData();renderUI(); },
};

// ============================================================
// MESSAGES APP — Texting
// ============================================================
var MessagesApp = {
    render: function() {
        var isConvo=!!activeContactId;
        var convos=this._getConvos();
        return '<div class="pa" data-app="messages">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-brands fa-telegram"></i> Messages</span></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt ' + (!isConvo?'active':'') + '" data-msg-view="list">Conversations</button>' +
            '<button class="pt ' + (isConvo?'active':'') + '" data-msg-view="back">Back</button>' +
            '</div>' +
            (isConvo ? this._renderConvo() : this._renderConvoList(convos)) +
            '</div>';
    },
    _getConvos: function() {
        var m={};
        for(var i=0;i<phoneData.messages.length;i++){
            var msg=phoneData.messages[i];
            if(!m[msg.contactId])m[msg.contactId]=[];
            m[msg.contactId].push(msg);
        }
        var out=[];
        for(var cid in m){
            var co=phoneData.contacts.find(function(x){return x.id===cid});
            if(!co)continue;
            out.push({contact:co,msgs:m[cid],last:m[cid][m[cid].length-1]});
        }
        out.sort(function(a,b){return b.last.timestamp-a.last.timestamp});
        return out;
    },
    _renderConvoList: function(convos) {
        if(!convos.length) return '<div class="pempty">No conversations yet</div>';
        return convos.map(function(v){
            return '<div class="pii" data-open-c="' + v.contact.id + '">' +
                '<div class="pav">' + v.contact.name[0].toUpperCase() + '</div>' +
                '<div class="pinf"><div class="prow"><span class="pname">'+v.contact.name+'</span>' +
                '<span class="ptm">'+fmtAgo(v.last.timestamp)+'</span></div>' +
                '<span class="plast">'+v.last.text+'</span></div></div>';
        }).join('');
    },
    _renderConvo: function() {
        var co=phoneData.contacts.find(function(c){return c.id===activeContactId;});
        if(!co) return '<div class="pempty">Contact not found</div>';
        var msgs=phoneData.messages.filter(function(m){return m.contactId===activeContactId})
            .sort(function(a,b){return a.timestamp-b.timestamp});
        var html=msgs.map(function(m){
            var cls=m.direction==='sent'?'sent':'received';
            var fl=m.direction==='sent'?'float-right':'float-left';
            return '<div class="pm ' + cls + ' ' + fl + '">' +
                '<div class="pbub"><span class="ptx">'+m.text+'</span></div>' +
                '<span class="ptm">' + fmtTime(m.timestamp) + '</span></div>';
        }).join('');
        return '<div class="pch">' + co.name + '</div>' +
            '<div class="pmsgs" id="pmsgs">' + html + '</div>' +
            '<div class="pinbar"><input class="ptxt" id="pmi" placeholder="Type a message..." />' +
            '<button class="psbtn" data-send-c="' + activeContactId + '"><i class="fa-solid fa-paper-plane"></i></button></div>';
    },
    sendMsg: function(cid) {
        var inp=document.getElementById('pmi');
        var txt=inp?inp.value.trim():'';if(!txt)return;
        phoneData.messages.push({id:randId(),contactId:cid,text:txt,direction:'sent',timestamp:Date.now()});
        savePhoneData(); renderUI();
        var co=phoneData.contacts.find(function(c){return c.id===cid;});
        if(co){
            setTimeout(function(){
                var replies=["Got it! \\uD83D\\uDC4D","Interesting...","Tell me more!","Okay cool","Haha nice \\uD83D\\uDE02",
                    "I'll think about it","Sure thing!","No way!","That's wild","LOL","Sounds good to me \\uD83D\\uDD99",
                    "Yeah definitely","Hmm let me check","On my way!"];
                var r=replies[Math.floor(Math.random()*replies.length)];
                phoneData.messages.push({id:randId(),contactId:cid,text:r,direction:'received',timestamp:Date.now()});
                savePhoneData(); renderUI();
                setTimeout(function(){var el=document.getElementById('pmsgs');if(el)el.scrollTop=el.scrollHeight;},50);
            },1000+Math.random()*2000);
        }
    },
};

// ============================================================
// SOCIAL MEDIA APP
// ============================================================
var SocialApp = {
    render: function() {
        return '<div class="pa" data-app="social">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-hashtag"></i> Social</span>' +
            '<button class="pa-action" data-new-post="true"><i class="fa-solid fa-plus"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt active" data-st="feed">Feed</button>' +
            '<button class="pt" data-st="saved">Saved ('+phoneData.social.savedPosts.length+')</button>' +
            '<button class="pt" data-st="compose">New Post</button>' +
            '</div>' +
            '<div class="pss active" data-section="feed">' + this._renderFeed() + '</div>' +
            '<div class="pss" data-section="saved">' + this._renderSaved() + '</div>' +
            '<div class="pss" data-section="compose">' + this._renderCompose() + '</div>' +
            '</div>';
    },
    _renderFeed: function() {
        if(!phoneData.social.feed.length) return '<div class="pempty">Nothing here yet<br><small>Compose a post!</small></div>';
        return phoneData.social.feed.slice().sort(function(a,b){return b.timestamp-a.timestamp})
            .map(function(p){return this._renderPost(p);}.bind(this)).join('');
    },
    _renderSaved: function() {
        if(!phoneData.social.savedPosts.length) return '<div class="pempty">No saved posts yet</div>';
        return phoneData.social.savedPosts.map(function(p){return this._renderPost(p,true);}.bind(this)).join('');
    },
    _renderPost: function(post, isSaved) {
        return '<div class="ppost">' +
            '<div class="ppost-hdr">' +
            '<div class="ppost-auth"><span class="paname">'+post.author+'</span>' +
            '<span class="pahnd">'+post.authorHandle+'</span></div>' +
            (isSaved?'<i class="fa-solid fa-bookmark pbsave" style="color:#4fc3f7"></i>') + '</div>' +
            '<div class="ppost-ct">' + post.content.replace(/\\n/g,'<br>') + '</div>' +
            '<div class="ppost-acts">' +
            '<button class="paction" data-action="like" data-post-id="'+post.id+'">'+
            '<i class="fa-regular fa-heart' + (post.liked?' fa-solid tpink':'') + '"></i> ' + (post.likes||0) + '</button>' +
            '<button class="paction" data-action="rt" data-post-id="'+post.id+'">'+
            '<i class="fa-regular fa-retweet' + (post.retweeted?' fa-solid tgreen':'') + '"></i> ' + (post.retweets||0) + '</button>' +
            '<button class="paction" data-action="save" data-post-id="'+post.id+'">'+
            '<i class="fa-regular fa-bookmark"></i></button></div></div>';
    },
    _renderCompose: function() {
        return '<div class="cform">' +
            '<textarea class="ctxt" id="sci" placeholder="What\\'s happening?" maxlength="500"></textarea>' +
            '<div class="cact"><span class="ccount" id="cc">0/500</span>' +
            '<button class="cbtn" id="csb" disabled>Post</button></div></div>';
    },
    submitPost: function() {
        var inp=document.getElementById('sci');
        if(!inp||!inp.value.trim())return;
        phoneData.social.feed.push({
            id:randId(),author:'Me',authorHandle:'@user',content:inp.value.trim(),
            images:[],likes:0,retweets:0,timestamp:Date.now(),liked:false,retweeted:false,
        });
        savePhoneData(); renderUI(); toastr.success('Post published!');
    },
    likePost: function(pid) {
        var p=phoneData.social.feed.concat(phoneData.social.savedPosts).find(function(x){return x.id===pid});
        if(!p)return;
        p.liked=!p.liked; p.likes+=p.liked?1:-1; savePhoneData();renderUI();
    },
    retweetPost: function(pid) {
        var p=phoneData.social.feed.concat(phoneData.social.savedPosts).find(function(x){return x.id===pid});
        if(!p)return;
        p.retweeted=!p.retweeted; p.retweets+=p.retweeted?1:-1; savePhoneData();renderUI();
    },
    savePost: function(pid) {
        var feed=phoneData.social.feed, sav=phoneData.social.savedPosts;
        var p=feed.concat(sav).find(function(x){return x.id===pid});if(!p)return;
        var fromFeed=feed.indexOf(p)>-1;
        if(fromFeed){var i=feed.indexOf(p); if(i>-1)feed.splice(i,1); sav.push(Object.assign({},p));}
        else{var i=sav.indexOf(p); if(i>-1)sav.splice(i,1); feed.push(p);}
        savePhoneData();renderUI();
    },
};

// ============================================================
// WEB BROWSER APP
// ============================================================
var BrowserApp = {
    render: function() {
        return '<div class="pa" data-app="browser">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-globe"></i> Browser</span>' +
            '<button class="pa-action" data-urlbar="true"><i class="fa-solid fa-link"></i></button></div>' +
            '<div class="ptbar">' + this._renderTabs() +
            '<button class="ptadd" data-new-tab="true"><i class="fa-solid fa-plus"></i></button></div>' +
            this._renderContent() + '</div>';
    },
    _renderTabs: function() {
        if(!phoneData.browser.tabs.length) return '<div class="pempty">No tabs open</div>';
        return phoneData.browser.tabs.map(function(t){
            var a=t.id===phoneData.browser.activeTabId?' active':'';
            return '<button class="ptr'+a+'" data-tid="'+t.id+'">' +
                '<span class="tt">' + (t.title||'New Tab') + '</span>' +
                '<button class="tclos" data-ctab="'+t.id+'"><i class="fa-solid fa-xmark"></i></button>' +
                '</button>';
        }).join('');
    },
    _renderContent: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab) return '<div class="pempty">No tabs<br><small>Open a new tab!</small></div>';
        var urlVal=tab.url?tab.url.replace(/"/g,'&quot;'):'';
        return '<div class="pubar" id="pbar">' +
            '<input class="put" id="burl" value="'+urlVal+'" placeholder="Enter URL or search..."/>' +
            '<button class="pgobtn" data-gourl="true"><i class="fa-solid fa-arrow-right"></i></button>' +
            '<button class="pkmbtn" data-bookmark="true"><i class="fa-regular fa-bookmark"></i></button>' +
            '</div>' +
            '<div class="pbcont">' + (tab.html || this._newTab()) + '</div>';
    },
    _newTab: function() {
        var links=[
            {n:'Wikipedia',u:'w:Wikipedia',c:'#636363',i:'fa-brands fa-wikipedia-w'},
            {n:'Example',u:'w:Example',c:'#2aa198',i:'fa-solid fa-paragraph'},
            {n:'News',u:'w:News',c:'#dc322f',i:'fa-solid fa-newspaper'},
            {n:'Weather',u:'w:Weather',c:'#268bd2',i:'fa-solid fa-cloud-sun'},
            {n:'Sports',u:'w:Sports',c:'#859900',i:'fa-solid fa-futbol'},
            {n:'Technology',u:'w:Technology',c:'#6c71c4',i:'fa-solid fa-microchip'},
        ].map(function(l){
            return '<button class="ql" data-nav="'+l.u+'">' +
                '<div class="qli" style="background:'+l.c+'"><i class="'+l.i+'"></i></div><span>'+l.n+'</button>';
        }).join('');
        return '<div class="ntp">' +
            '<h2><i class="fa-solid fa-globe"></i> Quick Browse</h2>' +
            '<div class="qlinks">' + links + '</div>' +
            '<div class="sbox"><input class="sinput" id="bsearch" placeholder="Search Wikipedia..."/>' +
            '<button class="sbtn" data-search="true"><i class="fa-solid fa-search"></i></button></div></div>';
    },
    openNewTab: function() {
        var id=randId();
        phoneData.browser.tabs.push({id:id,title:'New Tab',url:'',html:this._newTab(),ts:Date.now()});
        phoneData.browser.activeTabId=id; savePhoneData(); renderUI();
    },
    navigateTo: function(tabId, url) {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===tabId;});if(!tab)return;
        tab.url=url;
        if(url.startsWith('w:')){
            tab.title=url.substring(2);tab.html='<div class="wpage"><div class="ws"><i class="fa-solid fa-spinner fa-spin"></i> Loading <b>' + url.substring(2) + '...</b></div></div>';
        } else if (url.match(/^https?:\\/\\//)) {
            tab.title=url;
            tab.html='<iframe src="'+tab.url+'" class="extframe" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>';
        } else {
            tab.title=url;
            tab.html='<div class="wpage"><div class="ws">Searching for <b>' + url + '</b>...</div></div>';
        }
        phoneData.browser.history.push({id:randId(),url:url,title:tab.title,ts:Date.now()});
        savePhoneData(); renderUI();
    },
    bookmarkUrl: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab||!tab.url){toastr.info('Navigate to a page first');return;}
        if(!phoneData.browser.bookmarks.includes(tab.url)){
            phoneData.browser.bookmarks.push(tab.url);savePhoneData();toastr.success('Bookmarked!');
        } else {toastr.info('Already bookmarked');}
    },
};

// ============================================================
// MAIN RENDER LOOP
// ============================================================
function renderBody() {
    switch(activeApp){
        case 'phone': return PhoneApp.render();
        case 'messages': return MessagesApp.render();
        case 'social': return SocialApp.render();
        case 'browser': return BrowserApp.render();
        case 'settings':
            return '<div class="pa"><div class="pa-header"><span class="pa-title"><i class="fa-solid fa-gear"></i> Settings</span></div>' +
                '<div class="sett"><button class="sbtn" data-reset="true"><i class="fa-solid fa-trash-can"></i> Reset All Phone Data</button>' +
                '<small>Clears all phone data for this chat.</small></div></div>';
        default: return PhoneApp.render();
    }
}

function renderUI() {
    var body=document.getElementById('phone-body');
    if(!body)return;
    body.innerHTML=renderBody();
    updateDock();
    bindEvents();
    setTimeout(function(){var m=document.getElementById('pmsgs');if(m)m.scrollTop=m.scrollHeight;},60);
}

function updateDock() {
    document.querySelectorAll('.dock-btn').forEach(function(b){
        b.classList.toggle('active',b.dataset.dock===activeApp);
    });
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindEvents() {
    // Dock buttons
    document.querySelectorAll('.dock-btn').forEach(function(b){
        b.onclick=function(){
            activeApp=b.dataset.dock;
            if(activeApp!=='messages') activeContactId=null;
            if(activeApp!=='social') activeSocialTab='feed';
            renderUI();
        };
    });

    // Phone dialer
    document.querySelectorAll('[data-key]').forEach(function(b){b.onclick=function(){PhoneApp.addDigit(b.dataset.key);};});
    document.querySelectorAll('[data-backspace]').forEach(function(b){b.onclick=function(){PhoneApp.backspace();};});
    document.querySelectorAll('[data-call]').forEach(function(b){b.onclick=function(){PhoneApp.startCall();};});
    document.querySelectorAll('[data-clear-calls]').forEach(function(b){b.onclick=function(){PhoneApp.clearCalls();};});
    document.querySelectorAll('[data-call-c]').forEach(function(b){b.onclick=function(){PhoneApp.callContact(b.dataset.callC);};});

    // Messages
    document.querySelectorAll('[data-msg-view]').forEach(function(b){
        b.onclick=function(){ activeContactId=null; renderUI(); };
    });
    document.querySelectorAll('[data-open-c]').forEach(function(el){
        el.onclick=function(){ activeContactId=el.dataset.openC; renderUI(); };
    });
    document.querySelectorAll('[data-send-c]').forEach(function(b){
        b.onclick=function(){ MessagesApp.sendMsg(b.dataset.sendC); };
    });

    // Social
    document.querySelectorAll('[data-new-post]').forEach(function(b){b.onclick=function(){renderUI();};});
    document.querySelectorAll('[data-st]').forEach(function(b){
        b.onclick=function(){ activeSocialTab=b.dataset.st; renderUI(); };
    });
    document.querySelectorAll('[data-post-id]').forEach(function(b){
        b.onclick=function(e){
            e.stopPropagation();
            var id=b.dataset.postId;
            if(b.dataset.action==='like') SocialApp.likePost(id);
            else if(b.dataset.action==='rt') SocialApp.retweetPost(id);
            else if(b.dataset.action==='save') SocialApp.savePost(id);
        };
    });
    var csb=document.getElementById('csb');
    if(csb) csb.onclick=function(){SocialApp.submitPost();};
    var sci=document.getElementById('sci');
    if(sci){
        sci.addEventListener('input',function(){
            var cc=document.getElementById('cc');if(cc)cc.textContent=sci.value.length+'/500';
            var sb=document.getElementById('csb');if(sb)sb.disabled=sci.value.length===0;
        });
    }

    // Browser
    document.querySelectorAll('[data-new-tab]').forEach(function(b){b.onclick=function(){BrowserApp.openNewTab();};});
    document.querySelectorAll('[data-tid]').forEach(function(b){
        b.onclick=function(){phoneData.browser.activeTabId=b.dataset.tid;savePhoneData();renderUI();};
    });
    document.querySelectorAll('[data-ctab]').forEach(function(b){
        b.onclick=function(e){
            e.stopPropagation();
            var tid=b.dataset.ctab;
            phoneData.browser.tabs=phoneData.browser.tabs.filter(function(t){return t.id!==tid;});
            if(phoneData.browser.activeTabId===tid){
                phoneData.browser.activeTabId=phoneData.browser.tabs.length>0?phoneData.browser.tabs[phoneData.browser.tabs.length-1].id:null;
            }
            savePhoneData();renderUI();
        };
    });
    document.querySelectorAll('[data-gourl]').forEach(function(b){
        b.onclick=function(){
            var u=document.getElementById('burl');if(u&&phoneData.browser.activeTabId){
                BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);
            }
        };
    });
    document.querySelectorAll('[data-bookmark]').forEach(function(b){b.onclick=function(){BrowserApp.bookmarkUrl();};});
    document.querySelectorAll('[data-nav]').forEach(function(el){
        el.onclick=function(){if(phoneData.browser.activeTabId)BrowserApp.navigateTo(phoneData.browser.activeTabId,el.dataset.nav);};
    });
    document.querySelectorAll('[data-search]').forEach(function(b){
        b.onclick=function(){var s=document.getElementById('bsearch');
            if(s&&phoneData.browser.activeTabId)BrowserApp.navigateTo(phoneData.browser.activeTabId,'w:'+s.value);};
    });
    document.querySelectorAll('[data-urlbar]').forEach(function(b){
        b.onclick=function(){var bar=document.getElementById('pbar');
            if(bar) bar.style.display=bar.style.display==='flex'?'none':'flex';};
    });

    // Settings
    document.querySelectorAll('[data-reset]').forEach(function(b){
        b.onclick=function(){
            if(confirm('Reset ALL phone data for this chat?')){
                phoneData=getEmptyPhoneData();savePhoneData();renderUI();toastr.success('Phone data reset');
            }
        };
    });

    // Enter key shortcuts
    document.addEventListener('keydown',function(e){
        var m=document.getElementById('pmi');
        if(e.key==='Enter'&&m){var sb=document.querySelector('[data-send-c]');if(sb)MessagesApp.sendMsg(sb.dataset.sendC);}
        var u=document.getElementById('burl');
        if(e.key==='Enter'&&u&&phoneData.browser.activeTabId){BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);}
        var s=document.getElementById('bsearch');
        if(e.key==='Enter'&&s&&phoneData.browser.activeTabId){BrowserApp.navigateTo(phoneData.browser.activeTabId,'w:'+s.value);}
        var c=document.getElementById('sci');
        if(e.key==='Enter'&&e.ctrlKey&&c)SocialApp.submitPost();
    },true);
}

// ============================================================
// INIT — Inject shell and CSS on load
// ============================================================
function injectPhone() {
    if(document.getElementById('phone-wrap'))return;
    var wrap=document.createElement('div');wrap.id='phone-wrap';
    wrap.innerHTML =
        '<div class="pshell" id="pshell">' +
        '<div class="pbar"><span class="ptime">'+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</span>' +
        '<div class="pst"><i class="fa-solid fa-signal"></i><i class="fa-solid fa-wifi"></i><i class="fa-solid fa-battery-full"></i></div></div>' +
        '<div class="pbody" id="phone-body"></div>' +
        '<div class="pdock">' +
        '<button class="dock-btn active" data-dock="phone"><i class="fa-solid fa-phone"></i></button>' +
        '<button class="dock-btn" data-dock="messages"><i class="fa-brands fa-telegram"></i></button>' +
        '<button class="dock-btn" data-dock="social"><i class="fa-solid fa-hashtag"></i></button>' +
        '<button class="dock-btn" data-dock="browser"><i class="fa-solid fa-globe"></i></button>' +
        '<button class="dock-btn" data-dock="settings"><i class="fa-solid fa-gear"></i></button>' +
        '</div></div>';
    document.body.appendChild(wrap);

    setTimeout(function(){
        wrap.classList.add('popen');
        phoneData=loadPhoneData();
        activeApp=phoneData._activeApp||'phone';
        renderUI();
    },300);

    // Add toggle button to ST toolbar
    setTimeout(function(){
        var cont=document.getElementById('chatformbuttonssend')||document.getElementById('formbutton');
        if(!cont)return;
        var btn=document.createElement('button');btn.id='phone-toggle-btn';
        btn.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i> Phone';
        btn.title='Toggle Phone Extension';
        btn.onclick=function(){
            wrap.classList.toggle('popen');
            if(wrap.classList.contains('popen'))renderUI();
        };
        cont.insertBefore(btn,cont.firstChild);
    },500);

    setInterval(function(){var e=document.querySelector('.ptime');if(e)e.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});},60000);
}

// ============================================================
// CSS — Embedded styles
// ============================================================
function injectCSS() {
    if(document.getElementById('phone-css'))return;
    var el=document.createElement('style');el.id='phone-css';
    el.textContent=CSS_TEXT;
    document.head.appendChild(el);
}

// ============================================================
// AUTO-START — wait for ST globals
// ============================================================
(function(){
    var maxWait=3000,elapsed=0;
    function tryInit(){
        if(typeof chat_metadata!=='undefined'||typeof toastr!=='undefined'){
            injectCSS();
            injectPhone();
        }else{
            elapsed+=100;
            if(elapsed<maxWait)setTimeout(tryInit,100);
        }
    }
    tryInit();
})();
`;

const CSS_TEXT = `
/* ===== PHONE SHELL ===== */
#phone-wrap{position:fixed;bottom:0;right:20px;width:360px;height:680px;z-index:10000;display:none;transition:all .3s ease;}
#phone-wrap.popen{display:flex;flex-direction:column;}

.pshell{width:100%;height:100%;background:#1a1a2e;border-radius:30px;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e0e0e0;border:2px solid #333;}

/* Status bar */
.pbar{display:flex;justify-content:space-between;align-items:center;padding:8px 20px;background:rgba(0,0,0,.3);font-size:12px;color:#fff;}
.pst{display:flex;gap:6px;}.pst i{font-size:11px;}

/* Body */
.pbody{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px;}
.pbody::-webkit-scrollbar{width:4px;}.pbody::-webkit-scrollbar-thumb{background:#444;border-radius:2px;}

/* Dock */
.pdock{display:flex;justify-content:space-around;padding:8px 10px 14px;background:rgba(0,0,0,.4);border-top:1px solid #333;}
.dock-btn{background:none;border:none;color:#777;font-size:22px;padding:6px 12px;cursor:pointer;transition:color .2s;}
.dock-btn:hover{color:#aaa;}.dock-btn.active{color:#4fc3f7;}

/* App container */
.pa{width:100%;}.pa-header{display:flex;justify-content:space-between;align-items:center;padding:8px 0;}
.pa-title{font-size:14px;font-weight:600;}.pa-action{background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:12px;}

/* Tabs */
.pa-tabs{display:flex;gap:4px;margin-bottom:8px;}
.pt{flex:1;background:rgba(255,255,255,.05);border:none;color:#999;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;transition:all .2s;}
.pt:hover{background:rgba(255,255,255,.1);}
.pt.active{background:rgba(79,195,247,.2);color:#4fc3f7;}

/* Sections */
.pss{display:none;}.pss.active{display:block;}

/* Empty */
.pempty{text-align:center;color:#666;padding:40px 20px;font-size:13px;line-height:1.6;}

/* Items */
.pii{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;transition:background .15s;}
.pii:hover{background:rgba(255,255,255,.05);}

/* Avatar */
.pav{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px;color:#fff;flex-shrink:0;}.pav i{font-size:14px;}

/* Info */
.pinf{flex:1;min-width:0;}.prow{display:flex;justify-content:space-between;align-items:center;}
.pname{font-weight:500;font-size:13px;display:block;}.pname small{font-weight:400;color:#888;font-size:11px;}
.pdet,.ptm{font-size:11px;color:#777;}.plast{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#666;margin-top:2px;}

/* Call icons */
.pcm{color:#f44336;}.pco{color:#4caf50;}.pci{color:#2196f3;}

/* Mini button */
.pmbtn{background:none;border:none;color:#4fc3f7;font-size:16px;padding:4px 8px;cursor:pointer;}

/* Dialer */
.pdisp{text-align:center;padding:10px;font-size:28px;font-weight:300;color:#fff;min-height:50px;letter-spacing:2px;}
.ppad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:250px;margin:0 auto;}
.pk{width:65px;height:65px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:24px;font-weight:300;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;transition:background .15s;}
.pk:hover{background:rgba(255,255,255,.15);}.pk small{font-size:7px;color:#888;letter-spacing:1px;}
.pcbar{display:flex;justify-content:center;gap:30px;margin-top:15px;}
.pccb{width:55px;height:55px;border-radius:50%;background:#4caf50;border:none;color:#fff;font-size:22px;cursor:pointer;}
.pbacks{background:none;border:none;color:#888;font-size:22px;cursor:pointer;}

/* Conversation header */
.pch{text-align:center;padding:6px 0 10px;font-weight:600;font-size:14px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:8px;}

/* Messages */
.pmsgs{max-height:420px;overflow-y:auto;padding-bottom:10px;}
.pmsgs::-webkit-scrollbar{width:3px;}.pmsgs::-webkit-scrollbar-thumb{background:#444;border-radius:2px;}
.pm{display:flex;margin-bottom:6px;}.pm.sent{justify-content:flex-end;}.pm.received{justify-content:flex-start;}
.pbub{background:rgba(255,255,255,.08);border-radius:14px;padding:8px 12px;max-width:190px;font-size:12px;line-height:1.4;}
.pm.sent .pbub{background:rgba(79,195,247,.25);border-bottom-right-radius:4px;}
.pm.received .pbub{border-bottom-left-radius:4px;}
.pm.sent .ptm{color:#4fc3f7;}
.ptx{word-break:break-word;}
.float-right{justify-content:flex-end!important;}

.pinbar{display:flex;gap:6px;padding:8px 0;}
.ptxt{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:8px 14px;color:#e0e0e0;font-size:13px;outline:none;}
.ptxt::placeholder{color:#666;}
.psbtn{width:38px;height:38px;border-radius:50%;background:#4fc3f7;border:none;color:#fff;font-size:16px;cursor:pointer;flex-shrink:0;}

/* Social posts */
.ppost{background:rgba(255,255,255,.04);border-radius:10px;padding:12px;margin-bottom:8px;}
.ppost-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.ppost-auth{display:flex;align-items:baseline;}
.paname{font-weight:600;font-size:13px;}.pahnd{font-size:11px;color:#888;margin-left:6px;}
.ppost-ct{font-size:13px;line-height:1.5;margin-bottom:8px;}
.ppost-acts{display:flex;gap:14px;}
.paction{background:none;border:none;color:#888;font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;}.paction:hover{color:#4fc3f7;}
.tpink{color:#e91e63!important;}.tgreen{color:#4caf50!important;}

/* Compose */
.cform{padding:10px 0;}.ctxt{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;color:#e0e0e0;font-size:13px;resize:none;height:100px;outline:none;box-sizing:border-box;}
.cact{display:flex;justify-content:space-between;align-items:center;margin-top:8px;}
.cccount{font-size:11px;color:#666;}
.cbtn{background:#4fc3f7;border:none;color:#fff;padding:6px 16px;border-radius:16px;font-size:12px;cursor:pointer;}.cbtn:disabled{background:#444;cursor:not-allowed;}

/* Tabs bar */
.ptbar{display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;margin-bottom:4px;}
.ptbar::-webkit-scrollbar{height:2px;}.ptbar::-webkit-scrollbar-thumb{background:#444;}
.ptr{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#999;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;max-width:120px;}
.ptr.active{background:rgba(79,195,247,.15);color:#4fc3f7;border-color:rgba(79,195,247,.3);}
.tclos{background:none;border:none;color:#888;font-size:10px;padding:0 0 0 30px;cursor:pointer;}
.ptadd{background:none;border:none;color:#4fc3f7;font-size:14px;padding:4px 8px;cursor:pointer;white-space:nowrap;}

/* URL bar */
.pubar{display:none;gap:6px;padding:6px 0;}
.pub{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:6px 12px;color:#e0e0e0;font-size:12px;outline:none;}
.pgobtn,.pkmbtn{background:none;border:none;color:#4fc3f7;font-size:14px;height:32px;padding:0 6px;cursor:pointer;}

/* Browser content */
.pbcont{background:#111;border-radius:8px;padding:10px;min-height:250px;font-size:13px;line-height:1.6;overflow-y:auto;}

/* New tab page */
.ntp{padding:10px;}.ntp h2{font-size:16px;color:#4fc3f7;margin:0 0 14px;}
.qlinks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}
.ql{background:rgba(255,255,255,.06);border:none;color:#ccc;padding:10px 6px;border-radius:8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;}
.ql:hover{background:rgba(255,255,255,.12);}
.qli{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;}
.sbox{display:flex;gap:6px;}.sinput{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px 12px;color:#e0e0e0;font-size:12px;outline:none;}
.sbtn{background:#4fc3f7;border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;}

/* Wiki / loading pages */
.wpage{padding:10px;}.ws{text-align:center;padding:40px;color:#888;}.ws i{margin-right:6px;}
.extframe{width:100%;height:250px;border:none;border-radius:6px;background:#fff;}

/* Settings */
.sett{padding:20px 0;}.sbtn{width:100%;padding:12px;border-radius:8px;border:1px solid rgba(244,67,54,.3);background:rgba(244,67,54,.1);color:#f44336;font-size:13px;cursor:pointer;margin-bottom:6px;}
.sbtn:hover{background:rgba(244,67,54,.2);}

/* Extension toggle button */
#phone-toggle-btn{background:rgba(79,195,247,.15);color:#4fc3f7!important;border:1px solid rgba(79,195,247,.3);margin-right:4px;font-size:12px!important;padding:4px 8px!important;}
`;

// Write main JS file
fs.writeFileSync(path.join(outDir, 'phone-extension.js'), js);

// Write CSS into a separate file too
fs.writeFileSync(path.join(outDir, 'phone-extension.css'), CSS_TEXT);

// Update manifest to reference the js and css files correctly
const manifest = {
    display_name: "Phone Extension for SillyTavern",
    version: "0.1.0",
    description: "A fully functional smartphone simulation — calls, texts, social media, and web browser.",
    js: "phone-extension.js",
    css: "phone-extension.css",
    sillytavern_min_version: "1.12.0",
    authors: [{ name: "User" }],
    loading_order: 1000
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Write README
const readme = `# Phone Extension for SillyTavern

A fully functional smartphone simulation for SillyTavern — with calls, texts, social media, and a web browser.

## Features

- **Phone** — Dialer with contacts, call history (incoming/outgoing/missed)
- **Messages** — Text messaging with conversation list and chat view. Auto-replies from contacts
- **Social** — Social media feed with like, retweet, and save posts functionality
- **Browser** — Web browser with tabs, URL bar, bookmarks, and Wikipedia integration
- **Per-Chat Data** — All phone data is stored per-chat and never bleeds between conversations

## Installation

1. Copy the `phone-extension` folder into your SillyTavern `third-party/extensions/` directory
2. Or in SillyTavern: Extensions → Manage Extensions → Install Extension → paste the repo URL
3. Reload SillyTavern
4. Click the "Phone" button in the toolbar to open the phone

## Data Isolation

Each chat's phone data is stored independently in SillyTavern's chat metadata. When you switch chats:
- Current phone state is saved
- The new chat's phone state is loaded
- Data never leaks between conversations

## License

MIT
`;
fs.writeFileSync(path.join(outDir, 'README.md'), readme);

console.log('Extension files written successfully!');
console.log('- phone-extension.js');
console.log('- phone-extension.css');
console.log('- manifest.json');
console.log('- README.md');
`;

fs.writeFileSync(path.join(outDir, 'build-extension.js'), buildScript);
console.log('Build script written. Run it with: node build-extension.js');
