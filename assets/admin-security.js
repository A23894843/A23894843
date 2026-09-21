(function(){
  'use strict';
  const widgets=new Map();
  window.AdminSecurity={
    ready:false,
    token:null,
    error:null,
    render(containerId,action){
      const el=document.getElementById(containerId);
      if(!el) return;
      const key=window.TURNSTILE_SITE_KEY;
      if(!key || key==='YOUR_TURNSTILE_SITE_KEY'){
        el.innerHTML='<div class="captcha-note">CAPTCHA is not configured yet.</div>';
        this.error='sitekey-not-configured';
        return;
      }
      const renderNow=()=>{
        if(!window.turnstile) return setTimeout(renderNow,150);
        try{
          if(widgets.has(containerId)){
            try{window.turnstile.remove(widgets.get(containerId));}catch(e){}
            widgets.delete(containerId);
          }
          const id=window.turnstile.render(el,{
            sitekey:key,
            theme:'auto',
            action,
            callback:t=>{this.token=t;this.ready=true;this.error=null;},
            'expired-callback':()=>{this.token=null;this.ready=false;this.error='expired';},
            'timeout-callback':()=>{this.token=null;this.ready=false;this.error='timeout';},
            'error-callback':code=>{
              this.token=null;this.ready=false;this.error=String(code||'unknown');
              el.querySelector('.captcha-note')?.remove();
              const note=document.createElement('div');
              note.className='captcha-note error';
              note.textContent=`CAPTCHA could not connect (${code||'network/configuration error'}). Check the Turnstile hostname and network access.`;
              el.appendChild(note);
            }
          });
          widgets.set(containerId,id);
        }catch(error){
          this.token=null;this.ready=false;this.error=error?.message||'render-failed';
          el.innerHTML='<div class="captcha-note error">CAPTCHA could not be loaded. Try another network or browser.</div>';
        }
      };
      renderNow();
    },
    getToken(){return this.token||'';},
    reset(containerId){
      if(window.turnstile){
        if(containerId){
          const id=widgets.get(containerId);
          if(id!=null){try{window.turnstile.reset(id);}catch(e){}}
        }else{
          for(const id of widgets.values()){try{window.turnstile.reset(id);}catch(e){}}
        }
      }
      this.token=null;this.ready=false;this.error=null;
    }
  };
})();
