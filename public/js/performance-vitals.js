(function(root){
  'use strict';
  function start(orgId){
    if(!orgId||!root.PerformanceObserver||!root.performance||Math.random()>.2)return;
    var values={LCP:0,CLS:0},interactions={},sent=false,clsWindow=0,clsStart=-1,clsLast=0;
    var path=(root.location&&root.location.pathname)||'/';
    var width=root.innerWidth||1024,device=width<680?'mobile':width<1024?'tablet':'desktop';
    function send(name,value){
      if(!Number.isFinite(value)||value<0||(value===0&&name!=='CLS'))return;
      var body=JSON.stringify({orgId:orgId,name:name,value:value,page:path,device:device});
      try{root.fetch('/api/performance-vitals',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});}catch(e){}
    }
    try{
      var nav=root.performance.getEntriesByType('navigation')[0];
      if(nav&&nav.responseStart>=nav.requestStart)send('TTFB',nav.responseStart-nav.requestStart);
      (root.performance.getEntriesByType('paint')||[]).forEach(function(p){if(p.name==='first-contentful-paint')send('FCP',p.startTime);});
      function observe(type,fn){try{var o=new root.PerformanceObserver(function(list){list.getEntries().forEach(fn);});o.observe(type==='event'?{type:type,buffered:true,durationThreshold:16}:{type:type,buffered:true});return o;}catch(e){return null;}}
      observe('largest-contentful-paint',function(e){values.LCP=e.startTime||e.renderTime||values.LCP;});
      observe('layout-shift',function(e){if(e.hadRecentInput)return;var at=e.startTime||0;if(clsStart<0||at-clsLast>1000||at-clsStart>5000){clsStart=at;clsWindow=0;}clsWindow+=e.value||0;clsLast=at;values.CLS=Math.max(values.CLS,clsWindow);});
      observe('event',function(e){if(e.interactionId&&e.duration)interactions[e.interactionId]=Math.max(interactions[e.interactionId]||0,e.duration);});
      function flush(){if(sent)return;sent=true;var durations=Object.keys(interactions).map(function(k){return interactions[k];}).sort(function(a,b){return a-b;});if(durations.length)values.INP=durations[Math.max(0,Math.ceil(durations.length*.98)-1)];send('LCP',values.LCP);send('INP',values.INP);send('CLS',values.CLS);}
      root.document.addEventListener('visibilitychange',function(){if(root.document.visibilityState==='hidden')flush();});
      root.addEventListener('pagehide',flush,{once:true});
    }catch(e){}
  }
  root.EffDeskPerformanceVitals={start:start};
})(typeof window!=='undefined'?window:this);
