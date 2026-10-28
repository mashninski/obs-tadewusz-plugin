// Старонка бягучага радка ў OBS. Што і калі паказваць, вырашае ядро; старонка паведамляе пра этапы паказу.
// Платнае паведамленне з голасам: старонка загадзя загружае аўдыя, падаўжае паказ на час гучання
// і пускае голас з эфектамі персанажа, калі плашка выехала. Гук ідзе ў OBS праз «Кіраваць гукам праз OBS».
import { boldParts } from '../../../shared/ticker-text.js';
import { personaById, playVoice, voiceDurationMs } from '../../../shared/voice-personas.js';
const card=document.querySelector('#card'),nick=document.querySelector('#nick'),viewport=document.querySelector('#viewport'),message=document.querySelector('#message');
const client=crypto.randomUUID(),params=new URLSearchParams(location.search),source=params.get('source'),preview=params.has('preview');
let current=null,generation=0,lastHeartbeat=0,exiting=false,visible=true,controller=null,audio=null,playback=null;
const retired=new Set(),effects=new Set();
const key=job=>JSON.stringify([job.id,job.attempt,job.generation]);
function retire(job){retired.add(key(job));if(retired.size>64)retired.delete(retired.values().next().value);}
const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Tadewusz':'1'},body:JSON.stringify(body)});if(!r.ok)throw Error('ticker_request');return r.json();};
const identity=job=>({client,id:job.id,attempt:job.attempt,generation:job.generation});
function configure(c){card.style.width=c.width+'px';card.style.height=c.height+'px';card.style.fontFamily=(['Segoe UI','Manrope'].includes(c.font)?'Onest':c.font)+', sans-serif';card.style.fontSize=c.size+'px';card.style.borderLeftColor=c.accent;card.style.setProperty('--accent',c.accent);card.style.setProperty('--opacity',c.opacity);}
function animations(){return [...new Set([...effects,...card.getAnimations({subtree:true})])];}
function animate(node,frames,options){const effect=node.animate(frames,options);effects.add(effect);return effect;}
function cancelEffects(list){list.forEach(a=>a.cancel());effects.clear();}
async function play(node,frames,options,job,valid){
  const finished=await animate(node,frames,options).finished.then(()=>true,()=>false);
  // Перапынены паказ — няўдача, ніколі не пацверджаны паказ (за яго не спісваюцца балы).
  if(!finished&&valid()){retire(job);hide();}
  return finished&&valid();
}
function hide(){
  // Спіс эфектаў бярэцца да display:none — пасля браўзер можа яго змяніць.
  const pending=animations();
  // Спачатку схаваць, потым зняць эфекты: плашка без анімацыі не павінна мільгануць.
  card.hidden=true;card.dataset.phase='hidden';generation++;current=null;exiting=false;
  controller?.abort();controller=null;cancelEffects(pending);silence();
}
function silence(){playback?.stop();playback=null;}
/** Аўдыя голасу для паведамлення (або null — тады толькі тэкст). */
async function loadVoice(job){
  const persona=job.audio==='ready'?personaById(job.voice):null;
  if(!persona)return null;
  try{
    audio??=new AudioContext();
    if(audio.state==='suspended')await audio.resume().catch(()=>{});
    const r=await fetch(`/ticker/audio?id=${encodeURIComponent(job.id)}`);if(!r.ok)return null;
    const buffer=await audio.decodeAudioData(await r.arrayBuffer());
    return {persona,buffer,ms:voiceDurationMs(buffer.duration*1000,persona)};
  }catch{return null;}
}
function wait(ms,signal){return new Promise(resolve=>{
  if(signal.aborted){resolve();return;}
  const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});
});}
function words(job){
  message.replaceChildren();const result=[];let word=null;
  for(const part of job.kind==='paid'?[{text:job.text,bold:false}]:boldParts(job.text)){
    for(const fragment of part.text.match(/\s+|\S+/gu)??[]){
      if(/^\s/u.test(fragment)){message.append(document.createTextNode(fragment));word=null;continue;}
      // Мяжа тлустага шрыфту ўнутры слова не разбівае слова на два.
      if(!word){word=document.createElement('span');word.className='ticker-word';message.append(word);result.push(word);}
      const node=document.createElement(part.bold?'strong':'span');node.textContent=fragment;word.append(node);
    }
  }
  return result;
}
async function exit(job,complete=false){
  if(exiting||!current||key(current)!==key(job))return;
  exiting=true;retire(job);controller?.abort();const g=generation;silence();
  card.dataset.phase='exit';animations().forEach(a=>{if(a.playState==='running'||a.pending)a.pause();});
  const opacity=getComputedStyle(card).opacity,transform=getComputedStyle(card).transform;
  const finished=await animate(card,[{transform,opacity},{transform:'translateX(-24px)',opacity:0}],{duration:950,easing:'cubic-bezier(.4,0,.6,1)',fill:'forwards'}).finished.then(()=>true,()=>false);
  if(g!==generation)return;
  if(!finished){hide();return;}
  const pending=animations();card.hidden=true;card.dataset.phase='hidden';cancelEffects(pending);
  if(!preview)await post('/ticker/ack',{...identity(job),phase:complete?'complete':'hidden'}).catch(()=>{});
  if(g===generation){current=null;exiting=false;}
}
export async function show(job,c,voiceConfig={volume:1}){
  hide();configure(c);current=job;const g=generation,signal=(controller=new AbortController()).signal;
  const valid=()=>g===generation&&!exiting&&!signal.aborted;
  const voice=preview?null:await loadVoice(job);if(!valid())return;
  nick.textContent=voice&&job.nick?`${job.nick} · ${voice.persona.name}`:job.nick;const tokens=words(job);message.style.transform='translateY(0)';
  await document.fonts.load(`${c.size}px ${card.style.fontFamily}`);
  await document.fonts.ready;if(!valid())return;
  // Для вымярэння плашка павінна быць паказаная, але CSS трымае яе празрыстай да свайго этапу.
  card.hidden=false;card.dataset.phase='layout';
  const overflow=Math.max(0,message.scrollHeight-viewport.clientHeight),scrollMs=overflow/c.speed*1000;
  const stagger=tokens.length>1?Math.min(140,4200/(tokens.length-1)):0;
  const revealMs=tokens.length?900+(tokens.length-1)*stagger:0,nickMs=job.nick?700:0;
  // Голас пачынаецца, калі плашка выехала (1,4 с), і пасля яго трэба 1,5 с цішыні да выхаду плашкі.
  const textMs=1400+nickMs+revealMs+10000+scrollMs+950,extraMs=voice?Math.max(0,1400+voice.ms+1500+950-textMs):0;
  const introMs=1400+nickMs+revealMs,duration=textMs+extraMs;
  if(duration>86400000){hide();return;}
  window.tickerMeasurement={overflow,duration,introMs,revealMs,nickMs,wordCount:tokens.length,viewport:viewport.clientHeight,body:message.scrollHeight};
  if(!preview){
    const accepted=await post('/ticker/ack',{...identity(job),phase:'layout',duration}).catch(()=>null);
    if(!valid())return;
    if(!accepted?.measured){hide();return;}
  }
  card.dataset.phase='plate';
  if(!await play(card,[{transform:'translateX(-102%)',opacity:0},{transform:'translateX(0)',opacity:1}],{duration:1400,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'},job,valid))return;
  if(voice){try{playback=playVoice(audio,voice.buffer,voice.persona,{volume:voiceConfig.volume});}catch{playback=null;}}
  if(job.nick){
    card.dataset.phase='nick';
    if(!await play(nick,[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:nickMs,easing:'cubic-bezier(.25,.1,.25,1)',fill:'forwards'},job,valid))return;
  }
  card.dataset.phase='words';
  await Promise.all(tokens.map((node,index)=>play(node,[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:900,delay:index*stagger,easing:'cubic-bezier(.25,.1,.25,1)',fill:'both'},job,valid)));
  if(!valid())return;
  card.dataset.phase='reading';
  await wait((overflow?5000:10000)+extraMs,signal);if(!valid())return;
  if(overflow){
    card.dataset.phase='scroll';
    if(!await play(message,[{transform:'translateY(0)'},{transform:`translateY(-${overflow}px)`}],{duration:scrollMs,easing:'linear',fill:'forwards'},job,valid))return;
    card.dataset.phase='reading-end';await wait(5000,signal);
  }
  if(valid())await exit(job,true);
}
addEventListener('obsSourceVisibleChanged',event=>{visible=event.detail.visible===true;if(!visible)hide();});
addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
if(preview){
  const c={width:960,height:190,font:'Onest',size:30,speed:18,accent:'#79d6b3',opacity:.94};
  show({id:'preview',nick:params.has('nick')?'test_viewer':'',text:params.get('text')||'Вітаем на трансляцыі! Дзякуй, што вы з намі.'},c);
}else{
  let polling=false;
  setInterval(async()=>{
    if(polling)return;polling=true;
    try{
      const state=await post('/ticker/heartbeat',{client,source,visible:visible&&!document.hidden,obs:!!window.obsstudio});lastHeartbeat=Date.now();
      if(!state.ready||!state.job){if(current&&!exiting)hide();return;}
      const job=state.job;
      if(retired.has(key(job)))return;
      if(current&&key(current)===key(job)){if(job.state==='exiting')exit(job).catch(hide);return;}
      if(job.state==='showing')show(job,state.config,state.voice).catch(()=>{if(current&&key(current)===key(job))hide();});
    }catch{hide();}finally{polling=false;}
  },250);
  setInterval(()=>{if(Date.now()-lastHeartbeat>1500)hide();},250);
}
