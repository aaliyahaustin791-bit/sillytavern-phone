/**
 * Phone Extension for SillyTavern
 * A fully functional smartphone simulation — calls, texts, social media, and web browser.
 * All data is scoped per-chat and never bleeds between conversations.
 */

// ============================================================
// STATE & DATA LAYER — per-chat isolation via ST's chat_metadata
// ============================================================
var STORAGE_KEY = 'phone_extension';
var phoneData = getEmptyPhoneData();
var activeApp = 'phone'; // phone, messages, social, browser, settings
var activeContactId = null;
var activeSocialTab = 'feed';

function loadPhoneData() {
    var m = typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null);
    if (!m || !m[STORAGE_KEY]) return getEmptyPhoneData();
    var e = getEmptyPhoneData();
    var k;
    for (k in e) { if (m[STORAGE_KEY][k] === undefined) m[STORAGE_KEY][k] = e[k]; }
    return m[STORAGE_KEY];
}

function savePhoneData(shouldSave) {
    if (shouldSave === undefined) shouldSave = true;
    phoneData._activeApp = activeApp;
    var m = typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null);
    if (!m) return;
    if (!m[STORAGE_KEY]) m[STORAGE_KEY] = {};
    Object.assign(m[STORAGE_KEY], phoneData);
    if (shouldSave) {
        if (typeof saveChatConditional === 'function') saveChatConditional(false);
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
    }
}

function getEmptyPhoneData() {
    return { contacts:[], messages:[], phoneCalls:[], social:{feed:[],savedPosts:[]},
        browser:{tabs:[],activeTabId:null,bookmarks:[],history:[]}, _activeApp:'phone', _nextSeq:1 };
}

function randId() { return Date.now().toString(36) + Math.random().toString(36).substring(2,9); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function fmtAgo(ts) { var d=Date.now()-ts; if(d<6e4) return 'just now'; if(d<36e5) return Math.floor(d/6e4)+'m'; if(d<864e5) return fmtTime(ts); return new Date(ts).toLocaleDateString(); }

// ============================================================
// EVENT SYNC — per-chat isolation
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
// PHONE APP
// ============================================================
var PhoneApp = {
    _dialPad: '',
    render: function() {
        var keypad = '';
        var keys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
        var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (var ki=0;ki<keys.length;ki++) {
            var k = keys[ki];
            var sub = '';
            if (k >= '2' && k <= '9') sub = '<small>' + letters[parseInt(k)-2] + '</small>';
            keypad += '<button class="pk" data-key="'+k+'"><span>'+k+'</span>'+sub+'</button>';
        }
        var recent = phoneData.phoneCalls.length === 0
            ? '<div class="pempty">No recent calls</div>'
            : phoneData.phoneCalls.slice().sort(function(a,b){return b.timestamp-a.timestamp;})
                .map(function(c) {
                    var co = phoneData.contacts.find(function(x){return x.id===c.contactId});
                    var nm = co ? co.name : 'Unknown';
                    var ph = co ? co.phone : 'Unknown number';
                    var ic = c.status==='missed' ? 'fa-circle-xmark pcm' : c.type==='outgoing' ? 'fa-arrow-up pco' : 'fa-arrow-down pci';
                    return '<div class="pii">' +
                        '<div class="pav"><i class="fa-solid '+ic+'"></i></div>' +
                        '<div class="pinf"><span class="pname">'+nm+' <small>(' + ph + ')</small></span>' +
                        '<span class="pdet">' + fmtTime(c.timestamp) + ' \u00B7 ' + (c.status==='missed' ? 'Missed' : c.duration+'s') + '</span></div></div>';
                }).join('');
        var contacts = phoneData.contacts.length === 0
            ? '<div class="pempty">No contacts<br><small>Add via dialer</small></div>'
            : phoneData.contacts.map(function(c) {
                return '<div class="pii">' +
                    '<div class="pav">' + c.name[0].toUpperCase() + '</div>' +
                    '<div class="pinf"><span class="pname">' + c.name + '</span>' +
                    '<span class="pdet">' + c.phone + '</span></div>' +
                    '<button class="pmbtn" data-call-c="'+c.id+'"><i class="fa-solid fa-phone"></i></button></div>';
            }).join('');
        return '<div class="pa" data-app="call">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-phone"></i> Phone</span>' +
            '<button class="pa-action" data-clear-calls="true"><i class="fa-solid fa-trash"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt active" data-section="dialer"><i class="fa-solid fa-keypad"></i> Dialer</button>' +
            '<button class="pt" data-section="recent"><i class="fa-solid fa-clock-rotate-left"></i> Recent</button>' +
            '<button class="pt" data-section="contacts"><i class="fa-solid fa-address-book"></i> Contacts</button></div>' +
            '<div class="pss active" data-section="dialer">' +
                '<div class="pdisp" id="pd"><span id="pdt"> </span></div>' +
                '<div class="ppad">'+keypad+'</div>' +
                '<div class="pcbar"><button class="pccb" data-call="true"><i class="fa-solid fa-phone"></i></button>' +
                '<button class="pbacks" data-backspace="true"><i class="fa-solid fa-delete-left"></i></button></div></div>' +
            '<div class="pss" data-section="recent">'+recent+'</div>' +
            '<div class="pss" data-section="contacts">'+contacts+'</div></div>';
    },
    addDigit: function(k) { if(this._dialPad.length<15){this._dialPad+=k;var e=document.getElementById('pdt');} },
    backspace: function() { this._dialPad=this._dialPad.slice(0,-1); var e=document.getElementById('pdt'); },
    startCall: function() {
        var num=this._dialPad.trim(); if(!num){toastr.info('Enter a number');return;}
        var co=phoneData.contacts.find(function(c){return c.phone===num;});
        if(!co){co={id:randId(),name:num,phone:num};phoneData.contacts.push(co);toastr.info(num+' added to contacts');}
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=20+Math.floor(Math.random()*260);
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();toastr.success('Call with '+co.name+' ('+dur+'s)');},2000);
        this._dialPad='';
    },
    callContact: function(cid) {
        var co=phoneData.contacts.find(function(c){return c.id===cid;});if(!co)return;
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=10+Math.floor(Math.random()*300);
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();toastr.success('Call with '+co.name+' ('+dur+'s)');},2000);
    },
    clearCalls: function() { phoneData.phoneCalls=[];savePhoneData();renderUI(); }
};

// ============================================================
// MESSAGES APP
// ============================================================
var MessagesApp = {
    render: function() {
        var isConvo = !!activeContactId;
        var convos = this._getConvos();
        return '<div class="pa" data-app="messages">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-brands fa-telegram"></i> Messages</span></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt ' + (!isConvo?'active':'') + '" data-msg-view="list">Conversations</button>' +
            '<button class="pt ' + (isConvo?'active':'') + '" data-msg-view="back">Back</button></div>' +
            (isConvo ? this._renderConvo() : this._renderConvoList(convos)) + '</div>';
    },
    _getConvos: function() {
        var m={};
        for(var i=0;i<phoneData.messages.length;i++){
            var msg=phoneData.messages[i];if(!m[msg.contactId])m[msg.contactId]=[];m[msg.contactId].push(msg);
        }
        var out=[];
        for(var cid in m){
            var co=phoneData.contacts.find(function(x){return x.id===cid});if(!co)continue;
            out.push({contact:co, msgs:m[cid], last:m[cid][m[cid].length-1]});
        }
        out.sort(function(a,b){return b.last.timestamp-a.last.timestamp});
        return out;
    },
    _renderConvoList: function(convos) {
        if(!convos.length) return '<div class="pempty">No conversations yet</div>';
        var html='';
        for(var ci=0;ci<convos.length;ci++){
            var v=convos[ci];
            html+='<div class="pii" data-open-c="'+v.contact.id+'">' +
                '<div class="pav">'+v.contact.name[0].toUpperCase()+'</div>' +
                '<div class="pinf"><div class="prow"><span class="pname">'+v.contact.name+'</span>' +
                '<span class="ptm">'+fmtAgo(v.last.timestamp)+'</span></div>' +
                '<span class="plast">'+v.last.text+'</span></div></div>';
        }
        return html;
    },
    _renderConvo: function() {
        var co=phoneData.contacts.find(function(c){return c.id===activeContactId;});
        if(!co) return '<div class="pempty">Contact not found</div>';
        var msgs=phoneData.messages.filter(function(m){return m.contactId===activeContactId}).sort(function(a,b){return a.timestamp-b.timestamp});
        var html='';
        for(var mi=0;mi<msgs.length;mi++){
            var m=msgs[mi];
            var cls=m.direction==='sent'?'sent':'received';
            html+='<div class="pm '+cls+'" style="justify-content:'+(m.direction==='sent'?'flex-end':'flex-start')+'">' +
                '<div class="pbub"><span class="ptx">'+m.text+'</span></div>' +
                '<span class="ptm">'+fmtTime(m.timestamp)+'</span></div>';
        }
        return '<div class="pch">'+co.name+'</div>' +
            '<div class="pmsgs" id="pmsgs">'+html+'</div>' +
            '<div class="pinbar"><input class="ptxt" id="pmi" placeholder="Type a message..." />' +
            '<button class="psbtn" data-send-c="'+activeContactId+'"><i class="fa-solid fa-paper-plane"></i></button></div>';
    },
    sendMsg: function(cid) {
        var inp=document.getElementById('pmi');
        var txt=inp?inp.value.trim():'';if(!txt)return;
        phoneData.messages.push({id:randId(),contactId:cid,text:txt,direction:'sent',timestamp:Date.now()});
        savePhoneData();renderUI();
        var co=phoneData.contacts.find(function(c){return c.id===cid;});
        if(co){
            var replies=["Got it! \uD83D\uDC4D","Interesting...","Tell me more!","Okay cool","Haha nice \uD83D\uDE02",
                "I'll think about it","Sure thing!","No way!","That's wild","LOL","Sounds good to me \uD83D\uDD99",
                "Yeah definitely","Hmm let me check","On my way!"];
            setTimeout(function(){
                var r=replies[Math.floor(Math.random()*replies.length)];
                phoneData.messages.push({id:randId(),contactId:cid,text:r,direction:'received',timestamp:Date.now()});
                savePhoneData();renderUI();
                setTimeout(function(){var el=document.getElementById('pmsgs');if(el)el.scrollTop=el.scrollHeight;},50);
            },1000+Math.random()*2000);
        }
    }
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
            '<button class="pt" data-st="compose">New Post</button></div>' +
            '<div class="pss active" data-section="feed">'+this._renderFeed()+'</div>' +
            '<div class="pss" data-section="saved">'+this._renderSaved()+'</div>' +
            '<div class="pss" data-section="compose">'+this._renderCompose()+'</div></div>';
    },
    _renderFeed: function() {
        if(!phoneData.social.feed.length) return '<div class="pempty">Nothing here yet<br><small>Compose a post!</small></div>';
        var sorted = phoneData.social.feed.slice().sort(function(a,b){return b.timestamp-a.timestamp;});
        var html='';
        for(var fi=0;fi<sorted.length;fi++) html+=this._renderPost(sorted[fi]);
        return html;
    },
    _renderSaved: function() {
        if(!phoneData.social.savedPosts.length) return '<div class="pempty">No saved posts yet</div>';
        var html='';
        for(var si=0;si<phoneData.social.savedPosts.length;si++) html+=this._renderPost(phoneData.social.savedPosts[si],true);
        return html;
    },
    _renderPost: function(post, isSaved) {
        var content = post.content.replace(/\n/g,'<br>');
        var heartClass = 'fa-regular fa-heart' + (post.liked?' fa-solid tpink':'');
        var rtClass = 'fa-regular fa-retweet' + (post.retweeted?' fa-solid tgreen':'');
        var savedIcon = isSaved ? '<i class="fa-solid fa-bookmark pbsave" style="color:#4fc3f7"></i>' : '';
        return '<div class="ppost">' +
            '<div class="ppost-hdr">' +
            '<div class="ppost-auth"><span class="paname">'+post.author+'</span>' +
            '<span class="pahnd">'+post.authorHandle+'</span></div>' + savedIcon + '</div>' +
            '<div class="ppost-ct">' + content + '</div>' +
            '<div class="ppost-acts">' +
            '<button class="paction" data-action="like" data-post-id="'+post.id+'">' +
            '<i class="'+heartClass+'"></i> ' + (post.likes||0) + '</button>' +
            '<button class="paction" data-action="rt" data-post-id="'+post.id+'">' +
            '<i class="'+rtClass+'"></i> ' + (post.retweets||0) + '</button>' +
            '<button class="paction" data-action="save" data-post-id="'+post.id+'">' +
            '<i class="fa-regular fa-bookmark"></i></button></div></div>';
    },
    _renderCompose: function() {
        return '<div class="cform">' +
            '<textarea class="ctxt" id="sci" placeholder="What is happening?" maxlength="500"></textarea>' +
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
        savePhoneData();renderUI();toastr.success('Post published!');
    },
    likePost: function(pid) {
        var arr=phoneData.social.feed.concat(phoneData.social.savedPosts);
        var p=arr.find(function(x){return x.id===pid});if(!p)return;
        p.liked=!p.liked;p.likes+=p.liked?1:-1;savePhoneData();renderUI();
    },
    retweetPost: function(pid) {
        var arr=phoneData.social.feed.concat(phoneData.social.savedPosts);
        var p=arr.find(function(x){return x.id===pid});if(!p)return;
        p.retweeted=!p.retweeted;p.retweets+=p.retweeted?1:-1;savePhoneData();renderUI();
    },
    savePost: function(pid) {
        var fed=phoneData.social.feed,sav=phoneData.social.savedPosts;
        var all=fed.concat(sav);
        var p=all.find(function(x){return x.id===pid});if(!p)return;
        var fromFeed=fed.indexOf(p)>-1;
        if(fromFeed){var i=fed.indexOf(p);if(i>-1)fed.splice(i,1);sav.push({});}
        else{var i=sav.indexOf(p);if(i>-1)sav.splice(i,1);fed.push(p);}
        savePhoneData();renderUI();
    }
};

// ============================================================
// WEB BROWSER APP
// ============================================================
var BrowserApp = {
    render: function() {
        return '<div class="pa" data-app="browser">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-globe"></i> Browser</span>' +
            '<button class="pa-action" data-urlbar="true"><i class="fa-solid fa-link"></i></button></div>' +
            '<div class="ptbar">'+this._renderTabs()+
            '<button class="ptadd" data-new-tab="true"><i class="fa-solid fa-plus"></i></button></div>' +
            this._renderContent() + '</div>';
    },
    _renderTabs: function() {
        if(!phoneData.browser.tabs.length) return '<div class="pempty">No tabs open</div>';
        var html='';
        for(var ti=0;ti<phoneData.browser.tabs.length;ti++){
            var t=phoneData.browser.tabs[ti];
            var a=t.id===phoneData.browser.activeTabId?' active':'';
            html+='<button class="ptr'+a+'" data-tid="'+t.id+'">' +
                '<span class="tt">'+(t.title||'New Tab')+'</span>' +
                '<button class="tclos" data-ctab="'+t.id+'"><i class="fa-solid fa-xmark"></i></button>' +
                '</button>';
        }
        return html;
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
        ];
        var lk='';
        for(var li=0;li<links.length;li++){
            lk+='<button class="ql" data-nav="'+links[li].u+'">' +
                '<div class="qli" style="background:'+links[li].c+'"><i class="'+links[li].i+'"></i></div><span>'+links[li].n+'</button>';
        }
        return '<div class="ntp"><h2><i class="fa-solid fa-globe"></i> Quick Browse</h2>' +
            '<div class="qlinks">'+lk+'</div>' +
            '<div class="sbox"><input class="sinput" id="bsearch" placeholder="Search Wikipedia..." />' +
            '<button class="sbtn" data-search="true"><i class="fa-solid fa-search"></i></button></div></div>';
    },
    openNewTab: function() {
        var id=randId();
        phoneData.browser.tabs.push({id:id,title:'New Tab',url:'',html:this._newTab(),ts:Date.now()});
        phoneData.browser.activeTabId=id;savePhoneData();renderUI();
    },
    navigateTo: function(tabId, url) {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===tabId;});if(!tab)return;
        tab.url=url;
        if(url.startsWith('w:')){
            tab.title=url.substring(2);
            tab.html='<div class="wpage"><div class="ws"><i class="fa-solid fa-spinner fa-spin"></i> Loading <b>'+url.substring(2)+'</b>...</div></div>';
        } else if (url.match(/^https?:\/\//)) {
            tab.title=url;
            tab.html='<iframe src="'+url+'" class="extframe" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>';
        } else {
            tab.title=url;
            tab.html='<div class="wpage"><div class="ws">Loading page: <b>'+url+'</b>...</div></div>';
        }
        phoneData.browser.history.push({id:randId(),url:url,title:tab.title,ts:Date.now()});
        savePhoneData();renderUI();
    },
    bookmarkUrl: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab||!tab.url){toastr.info('Navigate to a page first');return;}
        if(!phoneData.browser.bookmarks.includes(tab.url)){
            phoneData.browser.bookmarks.push(tab.url);savePhoneData();toastr.success('Bookmarked!');
        } else {toastr.info('Already bookmarked');}
    }
};

// ============================================================
// MAIN RENDER
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
    var btns=document.querySelectorAll('.dock-btn');
    for(var bi=0;bi<btns.length;bi++){
        btns[bi].classList.toggle('active',btns[bi].dataset.dock===activeApp);
    }
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindEvents() {
    // Dock
    var dockBtns = document.querySelectorAll('.dock-btn');
    for(var bi=0;bi<dockBtns.length;bi++){
        (function(b){b.onclick=function(){activeApp=b.dataset.dock;
            if(activeApp!=='messages')activeContactId=null;
            if(activeApp!=='social')activeSocialTab='feed';renderUI();};})(dockBtns[bi]);
    }

    // Phone
    var keys = document.querySelectorAll('[data-key]');
    for(var ki=0;ki<keys.length;ki++){(function(b){b.onclick=function(){PhoneApp.addDigit(b.dataset.key);};})(keys[ki]);}
    var backBtns = document.querySelectorAll('[data-backspace]');
    for(var bi2=0;bi2<backBtns.length;bi2++){(function(b){b.onclick=function(){PhoneApp.backspace();};})(backBtns[bi2]);}
    var callBtns = document.querySelectorAll('[data-call]');
    for(var ci=0;ci<callBtns.length;ci++){(function(b){b.onclick=function(){PhoneApp.startCall();};})(callBtns[ci]);}
    var clearBtn = document.querySelector('[data-clear-calls]');
    if(clearBtn) clearBtn.onclick=function(){PhoneApp.clearCalls();};
    var callContactBtns = document.querySelectorAll('[data-call-c]');
    for(var ci2=0;ci2<callContactBtns.length;ci2++){(function(b){b.onclick=function(){PhoneApp.callContact(b.dataset.callC);}})(callContactBtns[ci2]);}

    // Messages
    var msgViews = document.querySelectorAll('[data-msg-view]');
    for(var mi=0;mi<msgViews.length;mi++){(function(b){b.onclick=function(){activeContactId=null;renderUI();}})(msgViews[mi]);}
    var openConvoBtns = document.querySelectorAll('[data-open-c]');
    for(var oci=0;oci<openConvoBtns.length;oci++){(function(el){el.onclick=function(){activeContactId=el.dataset.openC;renderUI();}})(openConvoBtns[oci]);}
    var sendBtns = document.querySelectorAll('[data-send-c]');
    for(var si=0;si<sendBtns.length;si++){(function(b){b.onclick=function(){MessagesApp.sendMsg(b.dataset.sendC);}})(sendBtns[si]);}

    // Social
    var newPostBtn = document.querySelector('[data-new-post]');
    if(newPostBtn) newPostBtn.onclick=function(){renderUI();};
    var socialTabs = document.querySelectorAll('[data-st]');
    for(var stI=0;stI<socialTabs.length;stI++){(function(b){b.onclick=function(){activeSocialTab=b.dataset.st;renderUI();}})(socialTabs[stI]);}
    var postActions = document.querySelectorAll('[data-post-id]');
    for(var paI=0;paI<postActions.length;paI++){(function(b){b.onclick=function(e){e.stopPropagation();var id=b.dataset.postId;
        if(b.dataset.action==='like')SocialApp.likePost(id);
        else if(b.dataset.action==='rt')SocialApp.retweetPost(id);
        else if(b.dataset.action==='save')SocialApp.savePost(id);}})(postActions[paI]);}
    var csb = document.getElementById('csb');
    if(csb) csb.onclick=function(){SocialApp.submitPost();};
    var sci = document.getElementById('sci');
    if(sci) sci.addEventListener('input',function(){
        var cc=document.getElementById('cc');if(cc)cc.textContent=sci.value.length+'/500';
        var sb=document.getElementById('csb');if(sb)sb.disabled=sci.value.length===0;
    });

    // Browser
    var newTabBtn = document.querySelector('[data-new-tab]');
    if(newTabBtn) newTabBtn.onclick=function(){BrowserApp.openNewTab();};
    var tabBtns = document.querySelectorAll('[data-tid]');
    for(var tbI=0;tbI<tabBtns.length;tbI++){(function(b){b.onclick=function(){phoneData.browser.activeTabId=b.dataset.tid;savePhoneData();renderUI();}})(tabBtns[tbI]);}
    var closeBtns = document.querySelectorAll('[data-ctab]');
    for(var cbI=0;cbI<closeBtns.length;cbI++){(function(b){b.onclick=function(e){e.stopPropagation();var tid=b.dataset.ctab;
        phoneData.browser.tabs=phoneData.browser.tabs.filter(function(t){return t.id!==tid;});
        if(phoneData.browser.activeTabId===tid){phoneData.browser.activeTabId=phoneData.browser.tabs.length>0?phoneData.browser.tabs[phoneData.browser.tabs.length-1].id:null;}
        savePhoneData();renderUI();}})(closeBtns[cbI]);}
    var goBtn = document.querySelector('[data-gourl]');
    if(goBtn) goBtn.onclick=function(){var u=document.getElementById('burl');if(u&&phoneData.browser.activeTabId)BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);};
    
    var mkBtn = document.querySelector('[data-bookmark]');
    if(mkBtn) mkBtn.onclick=function(){BrowserApp.bookmarkUrl();};
    
    var navBtns = document.querySelectorAll('[data-nav]');
    for(var nvI=0;nvI<navBtns.length;nvI++){(function(el){el.onclick=function(){if(phoneData.browser.activeTabId)BrowserApp.navigateTo(phoneData.browser.activeTabId,el.dataset.nav);}})(navBtns[nvI]);}
    
    var searchBtn = document.querySelector('[data-search]');
    if(searchBtn) searchBtn.onclick=function(){var s=document.getElementById('bsearch');
        if(s&&phoneData.browser.activeTabId)BrowserApp.navigateTo(phoneData.browser.activeTabId,'w:'+s.value);};
        
    var urlBarBtn = document.querySelector('[data-urlbar]');
    if(urlBarBtn) urlBarBtn.onclick=function(){var bar=document.getElementById('pbar');
        if(bar) bar.style.display=bar.style.display==='flex'?'none':'flex';};

    // Settings
    var resetBtn = document.querySelector('[data-reset]');
    if(resetBtn) resetBtn.onclick=function(){if(confirm('Reset ALL phone data for this chat?')){
        phoneData=getEmptyPhoneData();savePhoneData();renderUI();toastr.success('Phone data reset');}};

    // Enter key shortcuts
    document.addEventListener('keydown',function(e){
        var m=document.getElementById('pmi');
        if(e.key==='Enter'&&m){var sb=document.querySelector('[data-send-c]');if(sb)MessagesApp.sendMsg(sb.dataset.sendC);}
        var u=document.getElementById('burl');
        if(e.key==='Enter'&&u&&phoneData.browser.activeTabId){BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);}
        var s=document.getElementById('bsearch');
        if(e.key==='Enter'&&s&&phoneData.browser.activeTabId){BrowserApp.navigateTo(phoneData.browser.activeTabId,'w:'+s.value);}
    },true);
}

// ============================================================
// INIT
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
        phoneData=loadPhoneData();
        activeApp=phoneData._activeApp||'phone';
        renderUI();
    },300);

    setTimeout(function(){
        // Try multiple selectors for different ST layouts (desktop/mobile)
        var cont=document.getElementById('chatformbuttonssend')
            ||document.getElementById('formbutton')
            ||document.getElementById('send_form')
            ||document.querySelector('#send_form .form-buttons')
            ||document.querySelector('.bottom-bar')
            ||document.querySelector('#move_send_buttons_div');
        var btn=document.createElement('button');btn.id='phone-toggle-btn';
        btn.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i>';
        btn.title='Toggle Phone';
        btn.onclick=function(){
            console.log('[Phone] Button clicked! popen before:', wrap.classList.contains('popen'));
            wrap.classList.toggle('popen');
            console.log('[Phone] popen after:', wrap.classList.contains('popen'));
            console.log('[Phone] wrap styles:', window.getComputedStyle(wrap).display, window.getComputedStyle(wrap).position, window.getComputedStyle(wrap).zIndex);
            if(wrap.classList.contains('popen'))renderUI();
        };
        if(cont){
            cont.insertBefore(btn,cont.firstChild);
        }else{
            // Fallback: always create a floating toggle button (works on any layout)
            if(!document.getElementById('phone-toggle-btn')){
                btn.style.position='fixed';
                btn.style.bottom='70px';
                btn.style.right='12px';
                btn.style.zIndex='9999';
                btn.style.width='48px';
                btn.style.height='48px';
                btn.style.borderRadius='50%';
                btn.style.background='rgba(79,195,247,.25)';
                btn.style.border='1px solid rgba(79,195,247,.3)';
                btn.style.color='#4fc3f7';
                btn.style.fontSize='20px';
                btn.style.cursor='pointer';
                btn.style.backdropFilter='blur(8px)';
                btn.style.boxShadow='0 4px 12px rgba(0,0,0,.4)';
                btn.style.display='flex';
                btn.style.alignItems='center';
                btn.style.justifyContent='center';
                document.body.appendChild(btn);
            }
        }
    },500);

    setInterval(function(){var e=document.querySelector('.ptime');if(e)e.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});},60000);
}

// ============================================================
// AUTO-START
// ============================================================
(function(){
    var initialized = false;
    function tryInit(){
        if(initialized) return;
        if(typeof toastr !== 'undefined'){
            initialized = true;
            injectPhone();
            console.log('[Phone Extension] Initialized successfully');
        }
    }
    // Try immediately
    tryInit();
    // Poll for up to 10 seconds
    if(!initialized){
        var attempts = 0;
        var poll = setInterval(function(){
            attempts++;
            tryInit();
            if(attempts >= 100) clearInterval(poll);
        }, 100);
    }
})();
