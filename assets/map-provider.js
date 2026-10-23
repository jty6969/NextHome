/* Baidu adapter for the existing map UI. Coordinates remain provider-specific;
   no business data is rewritten and conversion uses Baidu's official API. */
(() => {
  'use strict';
  let loading=null, sequence=0;
  function loadBaidu(key, config={}) {
    if(window.BMapGL?.Map)return Promise.resolve(createBaiduAdapter(window.BMapGL,config));
    if(!loading)loading=new Promise((resolve,reject)=>{
      const callback=`__nexthomeBaiduReady${++sequence}`,script=document.createElement('script');
      let finished=false;
      const finish=error=>{
        if(finished)return;finished=true;clearTimeout(timer);delete window[callback];
        script.onerror=null;
        if(error){script.remove();reject(error);}else resolve();
      };
      const timer=setTimeout(()=>finish(new Error('地图加载失败，请重试。')),20000);
      window[callback]=()=>finish(window.BMapGL?.Map?null:new Error('地图加载失败，请重试。'));
      script.onerror=()=>finish(new Error('地图加载失败，请重试。'));
      // Send only this site's real origin; never spoof or bypass the AK whitelist.
      script.referrerPolicy='strict-origin-when-cross-origin';
      script.src=`https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(key)}&callback=${callback}`;
      document.head.append(script);
    }).finally(()=>{loading=null;});
    return loading.then(()=>createBaiduAdapter(window.BMapGL,config));
  }
  function createBaiduAdapter(B,config={}) {
    const point=p=>new B.Point(p[0],p[1]);
    const normalized=p=>({getLng:()=>p.lng,getLat:()=>p.lat});
    class Map {
      constructor(id,options={}){
        this.host=document.getElementById(id);this.raw=new B.Map(id);
        const c=config.center;
        this.raw.centerAndZoom(point(options.center||[c?.lng??104,c?.lat??35]),options.zoom||c?.zoom||5);
        this.raw.enableScrollWheelZoom(true);
        this.raw.disableKeyboard?.();
        if(B.ScaleControl)this.raw.addControl(new B.ScaleControl());
      }
      getCenter(){return normalized(this.raw.getCenter());}
      getZoom(){return this.raw.getZoom();}
      setCenter(p){this.raw.setCenter(point(p));}
      setZoom(z){this.raw.setZoom(z);}
      setZoomAndCenter(z,p){this.raw.centerAndZoom(point(p),z);}
      panBy(x,y){this.raw.panBy(x,y);}
      setFitView(markers,immediate,margins=[60,60,60,60],maximum=16){
        if(!markers.length)return;
        const view=this.raw.getViewport(markers.map(m=>point(m.options.position)),{margins});
        this.raw.centerAndZoom(view.center,Math.min(maximum,view.zoom));
      }
      destroy(){this.raw.closeInfoWindow();this.raw.clearOverlays();this.raw.destroy?.();this.host.replaceChildren();}
    }
    class Marker {
      constructor(options){this.options=options;this.map=null;this.overlay=null;}
      setMap(map){
        if(this.map&&this.overlay)this.map.raw.removeOverlay(this.overlay);
        this.map=map;if(!map)return;
        const options=this.options;
        const overlay=new B.Overlay();
        overlay.initialize=raw=>{
          const el=document.createElement('div');el.style.position='absolute';el.style.zIndex='20';
          el.append(options.content);raw.getPanes().labelPane.append(el);overlay.element=el;return el;
        };
        overlay.draw=()=>{
          const pixel=map.raw.pointToOverlayPixel(point(options.position));
          overlay.element.style.left=`${pixel.x+(options.offset?.x||0)}px`;
          overlay.element.style.top=`${pixel.y+(options.offset?.y||0)}px`;
        };
        this.overlay=overlay;map.raw.addOverlay(overlay);
      }
    }
    class InfoWindow {
      constructor(options){this.options=options;this.raw=new B.InfoWindow(options.content,{width:280,offset:new B.Size(options.offset?.x||0,options.offset?.y||0),enableAutoPan:true});}
      open(map,p){this.map=map;map.raw.openInfoWindow(this.raw,point(p));}
      close(){this.map?.raw.closeInfoWindow();}
    }
    class Geocoder {
      constructor(options={}){this.city=options.city||'';this.raw=new B.Geocoder();}
      getLocation(address,done){
        // getPoint has no accuracy/level metadata. Never accept a city/district-only
        // query as a property location, and label all returned points approximate.
        if(!/(?:\d|[一二三四五六七八九十]+)\s*(?:号|弄|巷)|小区|花园|花苑|公寓|大厦|广场|一品|residence|apartment|\d+\s+\S+\s+(?:road|street)/i.test(address)){done('complete',{geocodes:[]});return;}
        this.raw.getPoint(address,p=>done(p?'complete':'error',{geocodes:p?[{level:'地址参考点',location:normalized(p)}]:[]}),this.city);
      }
    }
    return {Map,Marker,InfoWindow,Geocoder,coordinateSystem:'bd09',
      Pixel:class {constructor(x,y){this.x=x;this.y=y;}},
      convertFrom(p,system,done){
        const from=system==='gps'?1:system==='amap'?3:system==='baidu'?5:null;
        if(from===5){done('complete',{locations:[normalized(point(p))]});return;}
        if(!from||!B.Convertor){done('error',{});return;}
        new B.Convertor().translate([point(p)],from,5,result=>done(result.status===0?'complete':'error',{locations:(result.points||[]).map(normalized)}));
      },
    };
  }
  window.NexthomeMaps={loadBaidu,createBaiduAdapter};
})();
