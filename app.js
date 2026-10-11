const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const today = new Date();
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const monthStart = iso(new Date(today.getFullYear(),today.getMonth(),1));
const nfCache = {};
const fmt = (n,c="TJS") => (nfCache[c] ??= new Intl.NumberFormat("ru-RU",{style:"currency",currency:c,maximumFractionDigits:2})).format(n);
const currencies = ["TJS","USD","EUR","RUB"];
const curGlyph = {TJS:"SM",USD:"$",EUR:"€",RUB:"₽"};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => matchMedia("(max-width:760px)").matches;
const categories = {
 expense:["Обед","Продукты","Транспорт","Дом","Здоровье","Покупки","Развлечения","Подписки","Образование","Прочее"],
 income:["Зарплата","Фриланс","Бонус","Подарок","Инвестиции","Прочий доход"],
 transfer:["Перевод"]
};
/* иконка и оттенок (hue) для каждой категории; для незнакомых — по хешу названия */
const CAT = {
 "Обед":["cup",28],"Продукты":["cart",140],"Транспорт":["bus",205],"Дом":["home",255],"Здоровье":["heart",350],"Покупки":["bag",320],
 "Развлечения":["game",285],"Подписки":["video",190],"Образование":["book",45],"Прочее":["dots",220],
 "Зарплата":["salary",150],"Фриланс":["laptop",175],"Бонус":["star",45],"Подарок":["gift",330],"Инвестиции":["invest",120],"Прочий доход":["money",200],
 "Перевод":["transfer",230]
};
const WALLET_ICON = {bank:"card",cash:"cash",electronic:"phone",savings:"safe"};
const WALLET_HUE = {bank:230,cash:150,electronic:190,savings:45};
const WALLET_LABEL = {bank:"Карта",cash:"Наличные",electronic:"Электронный",savings:"Накопления"};
/* банки: знак (символ в icons.js) и фирменные цвета; цвета приблизительные — поправьте при необходимости */
const BANKS = {
 alif:{name:"Алиф",c1:"#35c27a",c2:"#119a63"},
 dc:{name:"Душанбе Сити",c1:"#3b82f6",c2:"#1d4ed8"},
 humo:{name:"Хумо",c1:"#ffa03a",c2:"#f0561e"}
};
const seed = {
 theme:"light",baseCurrency:"TJS",paydays:[{name:"Основная зарплата",date:25,amount:0,currency:"TJS"},{name:"Дополнительный доход",date:15,amount:0,currency:"TJS"}],
 wallets:[],
 transactions:[],
 budgets:[]
};
let state;
try { state = JSON.parse(localStorage.getItem("finora-state")) || structuredClone(seed); } catch { state = structuredClone(seed); }
if (!localStorage.getItem("finora-clean-start-v1")) { const isDemo = state.transactions?.some(t => ["t1","t2","t3","t4","t5"].includes(t.id)) || state.wallets?.some(w => ["cash","bank","usd"].includes(w.id)); if (isDemo) state = structuredClone(seed); localStorage.setItem("finora-state", JSON.stringify(state)); localStorage.setItem("finora-clean-start-v1","1"); }
let currentView = "dashboard", lastAddedId = null, shownTheme = null;
const form = {type:"expense",walletId:"",toWalletId:"",category:"",recurring:false};
const counterMem = {};
function save(){localStorage.setItem("finora-state",JSON.stringify(state)); if(window.FinoraCloud) window.FinoraCloud.queueSave(state);}
function wallet(id){return state.wallets.find(w=>w.id===id)||state.wallets[0]||{name:"Удалённый кошелёк",currency:"TJS"};}
function rate(currency){if(currency===state.baseCurrency)return 1; const rates={TJS:1,USD:10.9,EUR:11.9,RUB:.12};return rates[currency]/(rates[state.baseCurrency]||1);}
function convert(n,c){return n*rate(c);}
function txBase(t){return convert(t.amount,t.currency);}
function monthTx(){return state.transactions.filter(t=>t.date?.slice(0,7)===iso(today).slice(0,7));}
function expenses(list=monthTx()){return list.filter(t=>t.type==="expense").reduce((a,t)=>a+txBase(t),0);}
function incomes(list=monthTx()){return list.filter(t=>t.type==="income").reduce((a,t)=>a+txBase(t),0);}
function totalBalance(){return state.wallets.reduce((a,w)=>a+convert(w.balance,w.currency),0);}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateLabel(d){return new Date(d+"T12:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"});}

/* ───── иконки и мелкие компоненты ───── */
function catMeta(name){if(CAT[name])return {icon:CAT[name][0],h:CAT[name][1]};let h=0;for(const ch of String(name))h=(h*31+ch.charCodeAt(0))%360;return {icon:"tag",h};}
function catIc(name,size=""){const m=catMeta(name);return `<span class="cat-ic ${size}" style="--h:${m.h}">${ic(m.icon)}</span>`;}
function bankTile(id,cls=""){const b=BANKS[id];return `<span class="cat-ic bank ${cls}" style="--b1:${b.c1};--b2:${b.c2}">${ic("bank-"+id)}</span>`;}
function walletGlyph(w){return BANKS[w.bank]?bankTile(w.bank,"xs"):ic(WALLET_ICON[w.type]||"wallet");}
function walletIc(w,size=""){if(BANKS[w.bank])return bankTile(w.bank,size);return `<span class="cat-ic ${size}" style="--h:${WALLET_HUE[w.type]??230}">${ic(WALLET_ICON[w.type]||"wallet")}</span>`;}
function cnt(v,cur,key,prefix=""){return `<span data-count="${v}" data-cur="${cur}" data-key="${key}" data-prefix="${prefix}">${prefix}${fmt(v,cur)}</span>`;}
function emptyHtml(icon,text,btn){return `<div class="empty">${ic(icon)}<div>${text}</div>${btn||""}</div>`;}
function sumBy(list,fn){return list.reduce((a,t)=>a+fn(t),0);}
function catSpend(mt){return categories.expense.map(c=>({name:c,value:sumBy(mt.filter(t=>t.type==="expense"&&t.category===c),txBase)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);}

function transactionHtml(t,deletable=false){
 const w=wallet(t.walletId),sign=t.type==="income"?"+":t.type==="expense"?"−":"↔",label=t.type==="transfer"?"Перевод":t.category;
 const del=deletable?`<button class="row-del" data-delete="${t.id}" aria-label="Удалить" title="Удалить">${ic("trash")}</button>`:"";
 const row=`<div class="transaction ${deletable?"swipe-fg":""} ${t.id===lastAddedId?"fresh":""}">${catIc(label)}<div class="tx-info"><div class="tx-title">${escapeHtml(t.note||label)}</div><div class="tx-sub">${escapeHtml(label)} · ${escapeHtml(w.name)} · ${dateLabel(t.date)}</div></div><div class="tx-amount ${t.type==="income"?"positive":t.type==="expense"?"negative":""}">${sign}${fmt(t.amount,t.currency)}</div>${del}</div>`;
 return deletable?`<div class="swipe" data-id="${t.id}"><button class="swipe-del" data-delete="${t.id}" aria-label="Удалить">${ic("trash")}</button>${row}</div>`:row;
}
function totalMonthlyDays(){return new Date(today.getFullYear(),today.getMonth()+1,0).getDate();}
function monthRemainingDays(){return Math.max(1,totalMonthlyDays()-today.getDate()+1);}
function nextIncomeDate(){const future=state.paydays.map(p=>{let d=new Date(today.getFullYear(),today.getMonth(),Math.min(p.date,totalMonthlyDays()));if(d<new Date(today.getFullYear(),today.getMonth(),today.getDate()))d=new Date(today.getFullYear(),today.getMonth()+1,Math.min(p.date,new Date(today.getFullYear(),today.getMonth()+2,0).getDate()));return { ...p,when:d};}).sort((a,b)=>a.when-b.when);return future[0]||null;}

function budgetItem(b){
 const used=sumBy(monthTx().filter(t=>t.type==="expense"&&t.category===b.category),txBase),lim=convert(b.limit,b.currency),p=used/Math.max(1,lim)*100,m=catMeta(b.category);
 const C=+(2*Math.PI*19).toFixed(2),cls=p>=100?"over":p>=80?"warn":"";
 return `<div class="ring-card"><div class="ring" style="--h:${m.h}"><svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="19"/><circle class="ring-fg ${cls}" cx="22" cy="22" r="19" style="--c:${C};stroke-dasharray:${C};stroke-dashoffset:${(C*(1-Math.min(1,p/100))).toFixed(2)}"/></svg><span class="cat-ic" style="--h:${m.h}">${ic(m.icon)}</span></div><div><div class="wallet-name">${escapeHtml(b.category)}</div><div class="wallet-sub"><b class="${p>=100?"negative":""}">${fmt(used)}</b> / ${fmt(lim)}</div></div></div>`;
}

/* ───── экраны ───── */
function renderDashboard(){
 const mt=monthTx(),spent=expenses(mt),earned=incomes(mt),bal=totalBalance(),days=monthRemainingDays(),base=state.baseCurrency;
 const regular=state.transactions.filter(t=>t.type==="expense"&&t.recurring).reduce((a,t)=>a+txBase(t),0);
 const next=nextIncomeDate(),daysPay=next?Math.max(0,Math.ceil((next.when-new Date(today.getFullYear(),today.getMonth(),today.getDate()))/86400000)):null;
 const avg=spent/Math.max(1,today.getDate()),reserved=regular,available=bal-reserved,dayLimit=Math.max(0,available/Math.max(1,daysPay??days));
 const bars=Array.from({length:6},(_,i)=>{const d=new Date(today.getFullYear(),today.getMonth()-5+i,1);const key=iso(d).slice(0,7);const v=state.transactions.filter(t=>t.type==="expense"&&t.date.slice(0,7)===key).reduce((a,t)=>a+txBase(t),0);return {label:d.toLocaleDateString("ru-RU",{month:"short"}).replace(".",""),value:v};});
 const maxBar=Math.max(1,...bars.map(b=>b.value));
 const recent=[...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
 return `<div class="card hero">
  <div class="metric-label">${ic("wallet")}<span>Баланс</span></div>
  <div class="hero-balance">${cnt(bal,base,"bal")}</div>
  <div class="chips"><span class="flow-chip">${ic("income")}${cnt(earned,base,"inc","+")}</span><span class="flow-chip">${ic("expense")}${cnt(spent,base,"exp","−")}</span></div>
  <div class="quick-actions">
   <button class="quick" data-add="expense">${ic("expense")}<span>Расход</span></button>
   <button class="quick" data-add="income">${ic("income")}<span>Доход</span></button>
   <button class="quick" data-add="transfer">${ic("transfer")}<span>Перевод</span></button>
  </div>
 </div>
 ${state.wallets.length?"":`<div class="card onboard"><div class="wallet-left"><span class="cat-ic lg" style="--h:230">${ic("wallet")}</span><div><h2>Первый кошелёк</h2><div class="metric-foot">Карта или наличные</div></div></div><button class="primary-btn" data-goto="wallets">${ic("plus")}<span>Создать</span></button></div>`}
 <div class="grid two-col">
  <div class="card forecast">
   <div class="section-head"><div class="metric-label">${ic("calendar")}<span>${daysPay===null?"До конца месяца":`До дохода · ${daysPay} дн.`}</span></div>${next?`<span class="pill">${dateLabel(iso(next.when))}</span>`:""}</div>
   <div class="big">${cnt(dayLimit,base,"day")}</div><div class="metric-foot">можно тратить в день</div>
   <div class="forecast-row">
    <div class="mini-stat"><small>${ic("target")}Останется</small><strong>${cnt(Math.max(0,available-avg*(daysPay??days)),base,"left")}</strong></div>
    <div class="mini-stat"><small>${ic("fire")}Тратишь</small><strong>${cnt(avg,base,"avg")}</strong></div>
   </div>
  </div>
  <div class="card"><div class="section-head"><h2>Расходы</h2><span class="pill">6 мес</span></div><div class="chart-bars">${bars.map((b,i)=>`<div class="bar-group" title="${escapeHtml(fmt(b.value,base))}"><div class="bar-track"><div class="bar ${i===5?"cur":""}" style="height:${Math.max(3,b.value/maxBar*100)}%;--i:${i}"></div></div><div class="bar-label">${escapeHtml(b.label)}</div></div>`).join("")}</div></div>
 </div>
 <div class="grid two-col">
  <div class="card"><div class="section-head"><h2>Недавние</h2><button class="text-btn" data-goto="transactions">Все ${ic("chevron")}</button></div><div class="transactions">${recent.map(t=>transactionHtml(t)).join("")||emptyHtml("list","Пока пусто")}</div></div>
  <div class="card"><div class="section-head"><h2>Кошельки</h2><button class="text-btn" data-goto="wallets">Все ${ic("chevron")}</button></div>${state.wallets.slice(0,4).map(w=>`<div class="balance-row"><div class="wallet-left">${walletIc(w)}<div><div class="wallet-name">${escapeHtml(w.name)}</div><div class="wallet-sub">${w.currency}</div></div></div><div class="wallet-amount">${fmt(w.balance,w.currency)}</div></div>`).join("")||emptyHtml("wallet","Нет кошельков",`<button class="primary-btn" data-goto="wallets">${ic("plus")}</button>`)}</div>
 </div>
 <div class="card"><div class="section-head"><h2>Бюджеты</h2><button class="text-btn" data-goto="budgets">Все ${ic("chevron")}</button></div>${state.budgets.length?`<div class="ring-grid">${state.budgets.slice(0,4).map(budgetItem).join("")}</div>`:emptyHtml("target","Лимитов нет",`<button class="primary-btn" data-goto="budgets">${ic("plus")}</button>`)}</div>`;
}
function renderTransactions(){
 const list=[...state.transactions].sort((a,b)=>b.date.localeCompare(a.date));
 return `<div class="card"><div class="section-head"><h2>История</h2><span class="pill">${list.length}</span></div>${list.length?`<div class="transactions">${list.map(t=>transactionHtml(t,true)).join("")}</div>`:emptyHtml("list","Операций нет",`<button class="primary-btn" data-add="expense">${ic("plus")}<span>Добавить</span></button>`)}</div>`;
}
function renderWallets(){
 const picks=(name,items,fn)=>`<div class="chip-row" data-pick="${name}">${items.map((v,i)=>fn(v,i)).join("")}</div><input type="hidden" name="${name}" value="${items[0]}">`;
 return `<div class="grid page-grid">${state.wallets.map(w=>`<div class="card"><div class="section-head"><div class="wallet-left">${walletIc(w,"lg")}<div><h2>${escapeHtml(w.name)}</h2><div class="wallet-sub">${WALLET_LABEL[w.type]||""} · ${w.currency}</div></div></div><button class="row-del always" data-delete-wallet="${w.id}" aria-label="Удалить" title="Удалить">${ic("trash")}</button></div><div class="metric-value">${cnt(w.balance,w.currency,"w"+w.id)}</div>${w.currency!==state.baseCurrency?`<div class="metric-foot">≈ ${fmt(convert(w.balance,w.currency))}</div>`:""}</div>`).join("")}
 <div class="card"><div class="section-head"><h2>Новый</h2><span class="cat-ic sm" style="--h:230">${ic("plus")}</span></div>
  <form id="walletForm" class="form">
   <div class="chip-row" id="bankPick">${Object.entries(BANKS).map(([id,b])=>`<button type="button" class="chip" data-v="${id}" title="${b.name}">${bankTile(id,"xs")}<span>${b.name}</span></button>`).join("")}</div><input type="hidden" name="bank" value="">
   <input class="input" name="name" required maxlength="40" placeholder="Название" aria-label="Название">
   ${picks("type",Object.keys(WALLET_ICON),(t,i)=>`<button type="button" class="chip icon-chip ${i?"":"selected"}" data-v="${t}">${ic(WALLET_ICON[t])}<span>${WALLET_LABEL[t]}</span></button>`)}
   <div class="chip-row" data-pick="currency">${currencies.map(c=>`<button type="button" class="chip ${c===state.baseCurrency?"selected":""}" data-v="${c}">${c}</button>`).join("")}</div><input type="hidden" name="currency" value="${state.baseCurrency}">
   <input class="input" name="balance" type="number" inputmode="decimal" step=".01" value="0" required aria-label="Баланс">
   <button class="primary-btn" type="submit">${ic("plus")}<span>Добавить</span></button>
  </form></div></div>`;
}
function renderBudgets(){
 return `<div class="grid two-col">
  <div class="card"><div class="section-head"><h2>Лимиты</h2></div>${state.budgets.length?`<div class="ring-grid">${state.budgets.map(budgetItem).join("")}</div>`:emptyHtml("target","Лимитов нет")}</div>
  <div class="card"><div class="section-head"><h2>Новый лимит</h2><span class="cat-ic sm" style="--h:230">${ic("plus")}</span></div>
   <form id="budgetForm" class="form">
    <div class="cat-grid" data-pick="category" style="margin:0">${categories.expense.map((c,i)=>{const m=catMeta(c);return `<button type="button" class="cat-tile ${i?"":"selected"}" data-v="${escapeHtml(c)}" style="--h:${m.h}"><span class="cat-ic sm" style="--h:${m.h}">${ic(m.icon)}</span><span>${escapeHtml(c)}</span></button>`;}).join("")}</div>
    <input type="hidden" name="category" value="${categories.expense[0]}">
    <input class="input" name="limit" type="number" inputmode="decimal" min="1" step=".01" required placeholder="Лимит" aria-label="Лимит">
    <div class="chip-row" data-pick="currency">${currencies.map(c=>`<button type="button" class="chip ${c===state.baseCurrency?"selected":""}" data-v="${c}">${c}</button>`).join("")}</div>
    <input type="hidden" name="currency" value="${state.baseCurrency}">
    <button class="primary-btn" type="submit">${ic("tick")}<span>Сохранить</span></button>
   </form></div>
  </div>
  <div class="card"><div class="section-head"><h2>Доходы</h2><span class="cat-ic sm" style="--h:150">${ic("salary")}</span></div>
   <form id="paydayForm">${state.paydays.map((p,i)=>`<div class="payday"><div class="wallet-name">${escapeHtml(p.name)}</div><div class="payday-fields"><label class="field-pill" title="День месяца">${ic("calendar")}<input name="day${i}" type="number" inputmode="numeric" min="1" max="31" value="${p.date}" aria-label="День месяца"></label><label class="field-pill" title="Сумма">${ic("money")}<input name="amount${i}" type="number" inputmode="decimal" min="0" step=".01" value="${p.amount}" aria-label="Сумма"></label><select class="input mini" name="currency${i}" aria-label="Валюта">${currencies.map(c=>`<option ${c===p.currency?"selected":""}>${c}</option>`).join("")}</select></div></div>`).join("")}<button class="primary-btn" type="submit" style="margin-top:12px">${ic("tick")}<span>Сохранить</span></button></form>
  </div>`;
}
function renderAnalytics(){
 const mt=monthTx(),total=expenses(mt),cats=catSpend(mt),base=state.baseCurrency,days=Math.max(1,today.getDate()),flow=incomes(mt)-total;
 const R=60,C=+(2*Math.PI*R).toFixed(2);let off=0;
 const segs=cats.map((c,i)=>{const len=c.value/total*C,h=catMeta(c.name).h,s=`<circle cx="75" cy="75" r="${R}" stroke="hsl(${h} 78% 58%)" style="--c:${C};--i:${i}" stroke-dasharray="${Math.max(.5,len-3).toFixed(2)} ${C}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;off+=len;return s;}).join("");
 return `<div class="grid metrics">
  <div class="card"><div class="metric-label">${ic("expense")}<span>Расходы</span></div><div class="metric-value negative">${cnt(total,base,"a-tot")}</div><div class="metric-foot">${mt.filter(t=>t.type==="expense").length} оп.</div></div>
  <div class="card"><div class="metric-label">${ic("fire")}<span>В день</span></div><div class="metric-value">${cnt(total/days,base,"a-avg")}</div></div>
  <div class="card"><div class="metric-label">${ic("transfer")}<span>Поток</span></div><div class="metric-value ${flow>=0?"positive":"negative"}">${cnt(flow,base,"a-flow")}</div></div>
 </div>
 <div class="card"><div class="section-head"><h2>Категории</h2><span class="pill">Месяц</span></div>${cats.length?`<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" stroke="var(--hair)"/>${segs}</svg><div class="donut-center"><b>${cnt(total,base,"d-tot")}</b></div></div><div class="legend">${cats.map(c=>{const h=catMeta(c.name).h,pc=Math.round(c.value/Math.max(1,total)*100);return `<div class="legend-row">${catIc(c.name,"sm")}<div class="grow"><div class="legend-top"><span>${escapeHtml(c.name)}<small>${pc}%</small></span><span>${fmt(c.value,base)}</span></div><div class="progress"><span style="width:${pc}%;background:hsl(${h} 78% 58%)"></span></div></div></div>`;}).join("")}</div></div>`:emptyHtml("chart","Данных нет")}</div>
 <div class="card"><div class="section-head"><h2>Валюты</h2></div>${currencies.map(c=>{const n=state.wallets.filter(w=>w.currency===c).reduce((a,w)=>a+w.balance,0);return n?`<div class="balance-row"><div class="wallet-left"><span class="cat-ic sm txt" style="--h:230">${curGlyph[c]}</span><div class="wallet-name">${c}</div></div><div class="wallet-amount">${fmt(n,c)}<div class="wallet-sub">≈ ${fmt(convert(n,c))}</div></div></div>`:"";}).join("")||emptyHtml("wallet","Нет кошельков")}</div>`;
}
function renderSettings(){
 return `<div class="card">
  <div class="settings-row"><div class="lead"><span class="cat-ic sm" style="--h:255">${ic(state.theme==="dark"?"moon":"sun")}</span></div><div class="segmented" id="themeSeg"><button type="button" data-theme-set="light" class="${state.theme==="light"?"selected":""}" aria-label="Светлая">${ic("sun")}</button><button type="button" data-theme-set="dark" class="${state.theme==="dark"?"selected":""}" aria-label="Тёмная">${ic("moon")}</button></div></div>
  <div class="settings-row"><div class="lead"><span class="cat-ic sm" style="--h:150">${ic("money")}</span></div><div class="chip-row">${currencies.map(c=>`<button type="button" class="chip ${state.baseCurrency===c?"selected":""}" data-base="${c}">${c}</button>`).join("")}</div></div>
 </div>
 <div class="card"><div class="section-head"><h2>Аккаунт</h2><span class="pill" id="cloudStatus">…</span></div>
  <p class="metric-foot" id="cloudHint" style="margin:0 0 14px"></p>
  <form id="cloudAuthForm" class="form">
   <label class="field-pill wide">${ic("mail")}<input id="cloudEmail" type="email" autocomplete="email" required placeholder="Email" aria-label="Email"></label>
   <label class="field-pill wide">${ic("lock")}<input id="cloudPassword" type="password" minlength="8" autocomplete="current-password" required placeholder="Пароль" aria-label="Пароль"></label>
   <div class="chip-row"><button class="primary-btn" type="submit" id="cloudLogin">${ic("login")}<span>Войти</span></button><button class="secondary-btn" type="button" id="cloudSignup">${ic("user")}<span>Регистрация</span></button><button class="secondary-btn" type="button" id="cloudLogout" hidden>${ic("logout")}<span>Выйти</span></button></div>
  </form>
  <div class="chip-row" style="margin-top:14px"><button class="secondary-btn" type="button" id="cloudPull">${ic("clouddown")}<span>Из облака</span></button><button class="secondary-btn" type="button" id="cloudPush">${ic("cloudup")}<span>В облако</span></button></div>
 </div>
 <div class="attrib">Иконки: Solar (CC BY 4.0) · Lucide (ISC)</div>`;
}
const views={dashboard:renderDashboard,transactions:renderTransactions,wallets:renderWallets,budgets:renderBudgets,analytics:renderAnalytics,settings:renderSettings};
const titles={dashboard:"Обзор",transactions:"Операции",wallets:"Кошельки",budgets:"Бюджеты",analytics:"Аналитика",settings:"Настройки"};

/* ───── отрисовка, анимации ───── */
function applyTheme(){
 document.documentElement.dataset.theme=state.theme;
 if(shownTheme!==state.theme){shownTheme=state.theme;$("#themeToggle").innerHTML=ic(state.theme==="dark"?"sun":"moon");document.querySelector('meta[name="theme-color"]')?.setAttribute("content",state.theme==="dark"?"#080a18":"#eceefb");}
}
function animateCounts(nav){
 $$("[data-count]").forEach(el=>{
  const to=Number(el.dataset.count),cur=el.dataset.cur,pre=el.dataset.prefix||"",key=currentView+":"+el.dataset.key;
  const from=nav?0:(counterMem[key]??to);counterMem[key]=to;
  if(reducedMotion||from===to){el.textContent=pre+fmt(to,cur);return;}
  const t0=performance.now(),dur=nav?850:600;
  const step=now=>{const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=pre+fmt(from+(to-from)*e,cur);if(p<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
 });
}
function updateSync(){
 const on=!!(window.FinoraCloud&&window.FinoraCloud.status().signedIn),b=$("#syncBadge");
 b.title=on?"Облако":"Локальный режим";b.firstElementChild.classList.toggle("on",on);
}
function render(nav=false){
 applyTheme();
 $("#pageTitle").textContent=titles[currentView];
 $("#todayLabel").textContent=today.toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"});
 const root=$("#viewRoot");
 root.innerHTML=views[currentView]();
 root.classList.toggle("enter",nav);
 lastAddedId=null;
 $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
 bindView();animateCounts(nav);updateSync();
}
function goto(v){currentView=v;render(true);window.scrollTo({top:0,behavior:reducedMotion?"auto":"smooth"});}
let toastTimer;
function toast(msg,o={}){
 const el=$("#toast");
 el.innerHTML=`${ic(o.icon||"check",o.icon==="warn"?"err":"")}<span>${escapeHtml(msg)}</span>${o.action?`<button type="button">${escapeHtml(o.action)}</button>`:""}`;
 if(o.action)el.querySelector("button").onclick=()=>{el.classList.remove("show");o.onAction?.();};
 el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),o.action?5200:2400);
}
function warn(msg){toast(msg,{icon:"warn"});}
/* изменение с возможностью отмены */
function undoable(msg,fn){
 const snap=structuredClone(state);fn();save();render();
 toast(msg,{icon:"trash",action:"Отменить",onAction:()=>{state=snap;save();render();}});
}

/* ───── добавление операции (нижняя панель) ───── */
let closing=false;
function openModal(type="expense"){
 if(!state.wallets.length){warn("Сначала создай кошелёк");if(currentView!=="wallets")goto("wallets");return;}
 const last=localStorage.getItem("finora-last-wallet"),w=state.wallets.find(x=>x.id===last)||state.wallets[0];
 Object.assign(form,{walletId:w.id,toWalletId:"",recurring:false});
 $("#date").value=iso(new Date());$("#amount").value="";$("#note").value="";
 $("#recurring").setAttribute("aria-pressed","false");
 setType(type);
 const bd=$("#modalBackdrop");closing=false;bd.classList.remove("closing");$("#transactionForm").style.transform="";bd.hidden=false;
 setTimeout(()=>$("#amount").focus({preventScroll:true}),isMobile()?420:120);
}
function closeModal(){
 const bd=$("#modalBackdrop");if(bd.hidden||closing)return;closing=true;bd.classList.add("closing");
 setTimeout(()=>{bd.hidden=true;bd.classList.remove("closing");closing=false;},reducedMotion?0:230);
}
function setType(type){
 form.type=type;
 $$("#typeSegments button").forEach(b=>b.classList.toggle("selected",b.dataset.type===type));
 form.category=type==="transfer"?"Перевод":(categories[type].includes(form.category)?form.category:categories[type][0]);
 renderSheet();
}
function renderSheet(){
 const w=wallet(form.walletId),keep=$$("#sheetBody .wallet-pick").map(e=>e.scrollLeft);
 const lab=$("#currencyLabel");if(lab.textContent!==w.currency){lab.textContent=w.currency;lab.classList.remove("bump");void lab.offsetWidth;lab.classList.add("bump");}
 const chip=(x,sel,attr)=>`<button type="button" class="chip ${sel?"selected":""}" ${attr}="${x.id}">${walletGlyph(x)}<span>${escapeHtml(x.name)}</span><small>${x.currency}</small></button>`;
 let html="";
 if(form.type!=="transfer"){
  const list=categories[form.type];
  html+=`<div class="cat-grid" style="grid-template-columns:repeat(${list.length<=6?list.length:5},1fr)">${list.map(c=>{const m=catMeta(c);return `<button type="button" class="cat-tile ${c===form.category?"selected":""}" data-cat="${escapeHtml(c)}" style="--h:${m.h}"><span class="cat-ic sm" style="--h:${m.h}">${ic(m.icon)}</span><span>${escapeHtml(c)}</span></button>`;}).join("")}</div>`;
 }
 if(form.type==="transfer")html+=`<div class="pick-label">${ic("expense")}Откуда</div>`;
 html+=`<div class="wallet-pick">${state.wallets.map(x=>chip(x,x.id===form.walletId,"data-wallet")).join("")}</div>`;
 if(form.type==="transfer"){
  const targets=state.wallets.filter(x=>x.id!==form.walletId&&x.currency===w.currency);
  if(!targets.some(x=>x.id===form.toWalletId))form.toWalletId=targets[0]?.id||"";
  html+=`<div class="pick-label">${ic("income")}Куда</div>`+(targets.length?`<div class="wallet-pick">${targets.map(x=>chip(x,x.id===form.toWalletId,"data-towallet")).join("")}</div>`:`<div class="hint">Нужен ещё кошелёк в ${w.currency}</div>`);
 }
 $("#sheetBody").innerHTML=html;
 $$("#sheetBody .wallet-pick").forEach((e,i)=>e.scrollLeft=keep[i]||0);
}
function shake(el){el.classList.remove("shake");void el.offsetWidth;el.classList.add("shake");}

/* ───── привязка событий экрана ───── */
function bindPicks(){
 $$("[data-pick]").forEach(box=>box.addEventListener("click",e=>{
  const b=e.target.closest("[data-v]");if(!b)return;
  box.querySelectorAll("[data-v]").forEach(x=>x.classList.toggle("selected",x===b));
  const input=box.closest("form").elements[box.dataset.pick];if(input)input.value=b.dataset.v;
 }));
}
function bindView(){
 $$("[data-goto]").forEach(b=>b.onclick=()=>goto(b.dataset.goto));
 $$("[data-add]").forEach(b=>b.onclick=()=>openModal(b.dataset.add));
 bindPicks();
 $$("[data-delete]").forEach(b=>b.onclick=e=>{e.stopPropagation();const t=state.transactions.find(x=>x.id===b.dataset.delete);if(!t)return;
  const row=b.closest(".swipe");if(row)row.classList.add("removing");
  setTimeout(()=>undoable("Операция удалена",()=>{const w=state.wallets.find(x=>x.id===t.walletId);if(w&&t.type==="expense")w.balance+=t.amount;if(w&&t.type==="income")w.balance-=t.amount;if(w&&t.type==="transfer"){w.balance+=t.amount;const dest=state.wallets.find(x=>x.id===t.toWalletId);if(dest)dest.balance-=t.amount;}state.transactions=state.transactions.filter(x=>x.id!==t.id);}),reducedMotion?0:230);});
 $$("[data-delete-wallet]").forEach(b=>b.onclick=()=>{const id=b.dataset.deleteWallet;if(state.transactions.some(t=>t.walletId===id||t.toWalletId===id))return warn("В кошельке есть операции");undoable("Кошелёк удалён",()=>{state.wallets=state.wallets.filter(w=>w.id!==id);});});
 const bp=$("#bankPick");if(bp)bp.addEventListener("click",e=>{const b=e.target.closest("[data-v]");if(!b)return;const f=bp.closest("form"),on=b.classList.contains("selected");
  /* повторный клик снимает выбор; иначе ставим название и тип «Карта» */
  setTimeout(()=>{bp.querySelectorAll("[data-v]").forEach(x=>x.classList.toggle("selected",x===b&&!on));f.elements.bank.value=on?"":b.dataset.v;
   if(!on){const names=Object.values(BANKS).map(x=>x.name);if(!f.elements.name.value||names.includes(f.elements.name.value))f.elements.name.value=BANKS[b.dataset.v].name;
    f.elements.type.value="bank";f.querySelectorAll('[data-pick="type"] [data-v]').forEach(x=>x.classList.toggle("selected",x.dataset.v==="bank"));}},0);});
 const wf=$("#walletForm");if(wf)wf.onsubmit=e=>{e.preventDefault();const f=new FormData(wf),name=f.get("name").trim();if(!name){shake(wf.elements.name);return;}state.wallets.push({id:crypto.randomUUID(),name,type:f.get("type"),currency:f.get("currency"),balance:Number(f.get("balance"))||0,icon:WALLET_ICON[f.get("type")],...(BANKS[f.get("bank")]?{bank:f.get("bank")}:{})});save();render();toast("Кошелёк добавлен");};
 const bf=$("#budgetForm");if(bf)bf.onsubmit=e=>{e.preventDefault();const f=new FormData(bf);const b={category:f.get("category"),limit:Number(f.get("limit")),currency:f.get("currency")};if(!b.limit||b.limit<=0){shake(bf.elements.limit);return;}const old=state.budgets.find(x=>x.category===b.category);if(old)Object.assign(old,b);else state.budgets.push(b);save();render();toast("Лимит сохранён");};
 const pf=$("#paydayForm");if(pf)pf.onsubmit=e=>{e.preventDefault();const f=new FormData(pf);state.paydays=state.paydays.map((p,i)=>({...p,date:Math.max(1,Math.min(31,Number(f.get("day"+i)||p.date))),amount:Math.max(0,Number(f.get("amount"+i)||0)),currency:f.get("currency"+i)||p.currency}));save();render();toast("Сохранено");};
 $$("[data-theme-set]").forEach(b=>b.onclick=()=>{state.theme=b.dataset.themeSet;save();applyTheme();render();});
 $$("[data-base]").forEach(b=>b.onclick=()=>{state.baseCurrency=b.dataset.base;save();render();});
 const cloudStatus=$("#cloudStatus"); if(cloudStatus && window.FinoraCloud){const cs=window.FinoraCloud.status();cloudStatus.textContent=cs.label;$("#cloudHint").textContent=cs.hint;const logout=$("#cloudLogout");if(logout)logout.hidden=!cs.signedIn;const login=$("#cloudLogin");if(login)login.disabled=!cs.configured;const signup=$("#cloudSignup");if(signup)signup.disabled=!cs.configured;}
 const authForm=$("#cloudAuthForm");if(authForm)authForm.onsubmit=async e=>{e.preventDefault();try{await window.FinoraCloud.signIn($("#cloudEmail").value,$("#cloudPassword").value);const remote=await window.FinoraCloud.pullState();state=remote||structuredClone(seed);localStorage.setItem("finora-state",JSON.stringify(state));save();render();toast(remote?"Данные загружены":"Вход выполнен");}catch(err){warn("Ошибка входа: "+(err.message||"проверь настройки"));}};
 const signup=$("#cloudSignup");if(signup)signup.onclick=async()=>{try{const result=await window.FinoraCloud.signUp($("#cloudEmail").value,$("#cloudPassword").value);if(result.session){const remote=await window.FinoraCloud.pullState();state=remote||structuredClone(seed);localStorage.setItem("finora-state",JSON.stringify(state));save();}render();toast(result.session?"Аккаунт создан":"Аккаунт создан. Теперь войди");}catch(err){warn("Ошибка регистрации: "+(err.message||"проверь настройки"));}};
 const logout=$("#cloudLogout");if(logout)logout.onclick=async()=>{try{await window.FinoraCloud.signOut();state=structuredClone(seed);localStorage.setItem("finora-state",JSON.stringify(state));render();toast("Вы вышли");}catch(err){warn("Ошибка выхода");}};
 const pull=$("#cloudPull");if(pull)pull.onclick=async()=>{try{if(!confirm("Заменить локальные данные данными из облака?"))return;const remote=await window.FinoraCloud.pullState();if(!remote){warn("В облаке пусто");return;}state=remote;localStorage.setItem("finora-state",JSON.stringify(state));render();toast("Загружено из облака",{icon:"clouddown"});}catch(err){warn("Не удалось загрузить: "+(err.message||"проверь вход и схему БД"));}};
 const push=$("#cloudPush");if(push)push.onclick=async()=>{try{await window.FinoraCloud.pushNow(state);toast("Сохранено в облаке",{icon:"cloudup"});}catch(err){warn("Не удалось сохранить: "+(err.message||"проверь вход и схему БД"));}};
}

/* ───── глобальные события ───── */
$("#sideNav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)goto(b.dataset.view);});
$("#quickAdd").onclick=()=>openModal("expense");$("#closeModal").onclick=closeModal;
$("#modalBackdrop").addEventListener("click",e=>{if(e.target===$("#modalBackdrop"))closeModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
$("#themeToggle").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";save();applyTheme();if(currentView==="settings")render();};
$("#typeSegments").addEventListener("click",e=>{const b=e.target.closest("[data-type]");if(b)setType(b.dataset.type);});
$("#recurring").onclick=e=>{form.recurring=!form.recurring;e.currentTarget.setAttribute("aria-pressed",String(form.recurring));};
$("#sheetBody").addEventListener("click",e=>{
 const cat=e.target.closest("[data-cat]"),w=e.target.closest("[data-wallet]"),to=e.target.closest("[data-towallet]");
 if(cat){form.category=cat.dataset.cat;$$("#sheetBody [data-cat]").forEach(x=>x.classList.toggle("selected",x===cat));}
 else if(w){form.walletId=w.dataset.wallet;renderSheet();}
 else if(to){form.toWalletId=to.dataset.towallet;$$("#sheetBody [data-towallet]").forEach(x=>x.classList.toggle("selected",x===to));}
});
$("#transactionForm").onsubmit=e=>{
 e.preventDefault();
 const amount=Number($("#amount").value),date=$("#date").value,note=$("#note").value.trim(),walletId=form.walletId,recurring=form.recurring,txType=form.type;
 if(!amount||amount<=0){shake($(".amount-field"));$("#amount").focus();return;}
 if(!walletId||!date){warn("Проверь кошелёк и дату");return;}
 const from=wallet(walletId),currency=from.currency;let id=crypto.randomUUID();
 if(txType==="transfer"){
  const toId=form.toWalletId;if(!toId||toId===walletId)return warn("Выбери кошелёк назначения");
  const to=wallet(toId);if(from.currency!==to.currency)return warn("Нужны кошельки в одной валюте");
  if(from.balance<amount)return warn("Недостаточно средств");
  from.balance-=amount;to.balance+=amount;
  state.transactions.push({id,type:"transfer",amount,currency:from.currency,category:"Перевод",walletId,date,note:note||`В ${to.name}`,recurring:false,toWalletId:toId});
 }else{
  if(txType==="expense")from.balance-=amount;else from.balance+=amount;
  state.transactions.push({id,type:txType,amount,currency,category:form.category,walletId,date,note,recurring});
 }
 localStorage.setItem("finora-last-wallet",walletId);lastAddedId=id;
 save();closeModal();render();
 toast(txType==="income"?"Доход сохранён":txType==="transfer"?"Перевод выполнен":"Расход сохранён");
};

/* ───── жесты: свайп строки влево — удалить; потянуть панель вниз — закрыть ───── */
let swipe=null,openRow=null;
function closeRow(){if(!openRow)return;openRow.classList.remove("open");openRow.querySelector(".swipe-fg").style.transform="";openRow=null;}
document.addEventListener("touchstart",e=>{
 const fg=e.target.closest(".swipe-fg");
 if(openRow&&(!fg||fg.parentElement!==openRow)&&!e.target.closest(".swipe-del"))closeRow();
 if(!fg){swipe=null;return;}
 const row=fg.parentElement;
 swipe={row,fg,x:e.touches[0].clientX,y:e.touches[0].clientY,base:row.classList.contains("open")?-64:0,lock:null,cur:0};
},{passive:true});
document.addEventListener("touchmove",e=>{
 if(!swipe)return;
 const dx=e.touches[0].clientX-swipe.x,dy=e.touches[0].clientY-swipe.y;
 if(!swipe.lock&&(Math.abs(dx)>7||Math.abs(dy)>7)){swipe.lock=Math.abs(dx)>Math.abs(dy)?"x":"y";if(swipe.lock==="x")swipe.row.classList.add("dragging");}
 if(swipe.lock!=="x")return;
 swipe.cur=Math.max(-90,Math.min(0,swipe.base+dx));swipe.fg.style.transform=`translateX(${swipe.cur}px)`;
},{passive:true});
function endSwipe(){
 if(!swipe)return;
 const {row,fg,lock,cur}=swipe;swipe=null;if(lock!=="x")return;
 row.classList.remove("dragging");const open=cur<-34;
 fg.style.transform=open?"translateX(-64px)":"";row.classList.toggle("open",open);openRow=open?row:null;
}
document.addEventListener("touchend",endSwipe);document.addEventListener("touchcancel",endSwipe);

let sheetDrag=null;
const sheet=$("#transactionForm");
["#sheetGrip","#sheetHead"].forEach(sel=>{
 const el=$(sel);
 el.addEventListener("touchstart",e=>{if(!isMobile())return;sheetDrag={y:e.touches[0].clientY,dy:0};sheet.classList.add("dragging");},{passive:true});
 el.addEventListener("touchmove",e=>{if(!sheetDrag)return;sheetDrag.dy=Math.max(0,e.touches[0].clientY-sheetDrag.y);sheet.style.transform=`translateY(${sheetDrag.dy}px)`;},{passive:true});
 const end=()=>{
  if(!sheetDrag)return;const far=sheetDrag.dy>110;sheetDrag=null;sheet.classList.remove("dragging");
  if(far)closeModal();else{sheet.style.transition="transform .3s var(--ease)";sheet.style.transform="";setTimeout(()=>sheet.style.transition="",320);}
 };
 el.addEventListener("touchend",end);el.addEventListener("touchcancel",end);
});

if("serviceWorker" in navigator && location.protocol!=="file:"){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}
render(true);
if(window.FinoraCloud) window.FinoraCloud.init().then(()=>{updateSync();if(currentView==="settings")render();}).catch(()=>{});
