export function fakeBaidu(window) {
  const maps=[],conversions=[],geocodes=[];
  class Point{constructor(lng,lat){this.lng=lng;this.lat=lat;}}
  class Map{
    constructor(id){this.host=window.document.getElementById(id);this.overlays=new Set();maps.push(this);}
    centerAndZoom(center,zoom){this.center=center;this.zoom=zoom;}
    getCenter(){return this.center;}getZoom(){return this.zoom;}
    setCenter(p){this.center=p;}setZoom(z){this.zoom=z;}panBy(x,y){this.pan=[x,y];}
    enableScrollWheelZoom(){}disableKeyboard(){}addControl(){}
    getViewport(points){return {center:points[0],zoom:17};}
    getPanes(){return {labelPane:this.host};}
    pointToOverlayPixel(p){return {x:p.lng,y:p.lat};}
    addOverlay(o){this.overlays.add(o);o.initialize(this);o.draw();}
    removeOverlay(o){o.element?.remove();this.overlays.delete(o);}
    clearOverlays(){for(const o of [...this.overlays])this.removeOverlay(o);}
    openInfoWindow(info,p){this.info=info;this.infoPoint=p;this.host.append(info.content);}
    closeInfoWindow(){this.info?.content.remove();this.info=null;}
    destroy(){this.destroyed=true;}
  }
  return {maps,conversions,geocodes,sdk:{Point,Map,Overlay:class{},Size:class{constructor(x,y){this.width=x;this.height=y;}},
    InfoWindow:class{constructor(content,options){this.content=content;this.options=options;}},
    Geocoder:class{getPoint(address,done,city){geocodes.push({address,city});done(address.includes('失败')?null:new Point(121.51,31.22));}},
    Convertor:class{translate(points,from,to,done){conversions.push({points,from,to});done({status:0,points:points.map(p=>new Point(p.lng+.006,p.lat+.006))});}},
  }};
}
