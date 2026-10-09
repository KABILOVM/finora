/* Optional cloud adapter. Local mode remains functional without Supabase setup. */
(() => {
  const cfg = window.FINORA_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(cfg.url || "") &&
    !!cfg.anonKey && !String(cfg.anonKey).startsWith("YOUR_");
  let client = null, session = null, saveTimer = null, lastError = "";
  const state = { configured, ready: false };
  function makeClient() {
    if (!configured) throw new Error("Supabase ещё не настроен в supabase-config.js");
    if (!window.supabase?.createClient) throw new Error("Не загрузилась библиотека Supabase. Подключись к интернету и обнови страницу.");
    if (!client) client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }
  async function init() {
    if (!configured) { state.ready = true; return status(); }
    try {
      const c = makeClient();
      const { data, error } = await c.auth.getSession();
      if (error) throw error;
      session = data.session;
      c.auth.onAuthStateChange((_event, next) => { session = next; });
      state.ready = true;
    } catch (e) { lastError = e.message || String(e); }
    return status();
  }
  function status() {
    if (!configured) return { configured:false, signedIn:false, label:"Не настроено", hint:"Добавь URL и anon/publishable key проекта Supabase в supabase-config.js. Пока приложение работает локально.", ready:state.ready };
    if (!session) return { configured:true, signedIn:false, label:lastError?"Ошибка подключения":"Не выполнен вход", hint:lastError || "Войди или создай аккаунт. После настройки SQL схема включит защиту данных на уровне строк (RLS).", ready:state.ready };
    return { configured:true, signedIn:true, label:"Подключено", hint:`Вход выполнен: ${session.user.email || "аккаунт Supabase"}. Локальные изменения сохраняются автоматически и могут быть отправлены в облако.`, ready:state.ready, email:session.user.email };
  }
  async function signIn(email,password) {
    const c=makeClient(); const {data,error}=await c.auth.signInWithPassword({email,password}); if(error)throw error; session=data.session; lastError=""; return data;
  }
  async function signUp(email,password) {
    if(!email || !password || password.length<8) throw new Error("Укажи email и пароль не короче 8 символов");
    const c=makeClient(); const {data,error}=await c.auth.signUp({email,password}); if(error)throw error; if(data.session)session=data.session; return data;
  }
  async function signOut(){const c=makeClient();const {error}=await c.auth.signOut();if(error)throw error;session=null;}
  async function pullState(){const c=makeClient();if(!session)throw new Error("Сначала войди в аккаунт");const {data,error}=await c.from("user_finance_state").select("payload,updated_at").eq("user_id",session.user.id).maybeSingle();if(error)throw error;return data?.payload||null;}
  async function pushNow(payload){const c=makeClient();if(!session)throw new Error("Сначала войди в аккаунт");const row={user_id:session.user.id,payload,updated_at:new Date().toISOString()};const {error}=await c.from("user_finance_state").upsert(row,{onConflict:"user_id"});if(error)throw error;lastError="";return true;}
  function queueSave(payload){if(!configured||!session)return;clearTimeout(saveTimer);const snapshot=JSON.parse(JSON.stringify(payload));saveTimer=setTimeout(()=>pushNow(snapshot).catch(e=>{lastError=e.message||String(e);console.warn("Finora cloud sync:",lastError);}),900);}
  window.FinoraCloud={init,status,signIn,signUp,signOut,pullState,pushNow,queueSave};
})();
