(function(){
  'use strict';
  window.AdminSecurity={
    ready:false,
    token:null,
    render(containerId,action){
      const el=document.getElementById(containerId);
      if(!el) return;
      const key=window.TURNSTILE_SITE_KEY;
      if(!key || key==='YOUR_TURNSTILE_SITE_KEY'){
        el.innerHTML='<div class="captcha-note">CAPTCHA is not configured yet.</div>';
        return;
      }
      const renderNow=()=>{
        if(!window.turnstile) return setTimeout(renderNow,100);
        window.turnstile.render(el,{sitekey:key,theme:'auto',action,callback:t=>{this.token=t;this.ready=true;},'expired-callback':()=>{this.token=null;this.ready=false;},'error-callback':()=>{this.token=null;this.ready=false;}});
      };
      renderNow();
    },
    getToken(){return this.token||'';},
    reset(){if(window.turnstile){document.querySelectorAll('[data-turnstile-widget]').forEach(el=>{try{window.turnstile.reset(el)}catch(e){}});}this.token=null;this.ready=false;}
  };
})();
