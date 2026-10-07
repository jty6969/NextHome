/* Nexthome - 百度地图找房页 */
(function (global) {
  'use strict';

  var App = global.App;
  var API = global.API;
  var Utils = App.Utils;
  var state = { list: [], filtered: [], config: null, map: null, markers: {}, selectedId: null };

  App.Router.register('/map', function () { render(); });

  function t(key, vars) { return App.I18n ? App.I18n.t(key, vars) : key; }
  function en() { return App.I18n && App.I18n.isEn(); }

  function render() {
    state.map = null;
    state.markers = {};
    state.selectedId = null;
    document.getElementById('page').innerHTML = '' +
      '<section>' +
        '<h2 style="font-size:20px;font-weight:700">' + t('map.title') + '</h2>' +
        '<p style="color:var(--text-light);margin-top:6px">' + t('map.subtitle') + '</p>' +
        '<div class="map-search-bar">' +
          '<input id="mapSearchInput" type="search" autocomplete="off" placeholder="' + t('map.searchPh') + '">' +
          '<button class="btn btn-primary" id="mapSearchBtn">' + t('map.searchBtn') + '</button>' +
          '<button class="btn btn-outline" id="mapClearBtn">' + t('map.clear') + '</button>' +
        '</div>' +
        '<div class="map-layout">' +
          '<div id="mapCanvas" class="map-canvas"><div class="map-fallback">' + t('map.loading') + '</div></div>' +
          '<aside class="map-result-panel">' +
            '<div class="map-result-head" id="mapResultHead">' + t('map.loading') + '</div>' +
            '<div class="map-result-list" id="mapResultList"></div>' +
          '</aside>' +
        '</div>' +
      '</section>';

    bindSearch();
    Promise.all([API.loadProperties(), loadMapConfig()]).then(function (results) {
      state.list = results[0] || [];
      state.config = results[1];
      filterListings();
      if (!state.config.enabled) {
        showMapConfigHint();
        return;
      }
      loadBaiduMap(state.config.ak).then(initMap).catch(function () {
        showMapFailure();
      });
    }).catch(function () {
      showMapFailure();
      state.list = [];
      filterListings();
    });
  }

  function loadMapConfig() {
    return fetch('/api/map/config').then(function (res) {
      if (!res.ok) throw new Error('map config failed');
      return res.json();
    });
  }

  function bindSearch() {
    var input = document.getElementById('mapSearchInput');
    document.getElementById('mapSearchBtn').onclick = filterListings;
    document.getElementById('mapClearBtn').onclick = function () { input.value = ''; filterListings(); };
    input.oninput = function () { filterListings(); };
    input.onkeydown = function (event) {
      if (event.key === 'Enter') { event.preventDefault(); filterListings(); }
    };
  }

  function normalizedText(p) {
    return [p.community, p.building, p.unit, p.city, p.district, p.address, p.title].join(' ').toLowerCase();
  }

  function filterListings() {
    var input = document.getElementById('mapSearchInput');
    if (!input) return;
    var query = input.value.trim().toLowerCase();
    state.filtered = query ? state.list.filter(function (p) { return normalizedText(p).indexOf(query) >= 0; }) : state.list.slice();
    renderResults(query);
    renderMarkers();
  }

  function renderResults(query) {
    var head = document.getElementById('mapResultHead');
    var listEl = document.getElementById('mapResultList');
    if (!head || !listEl) return;
    head.textContent = query ? (state.filtered.length + ' ' + t('map.results')) : t('map.allResults');
    if (!state.filtered.length) {
      listEl.innerHTML = '<div class="empty-state" style="padding:28px 12px"><p>' + t('map.noResults') + '</p><p style="font-size:12px;margin-top:6px">' + t('map.noResultsHint') + '</p></div>';
      return;
    }
    listEl.innerHTML = state.filtered.map(function (p) {
      var title = Utils.esc(p.community + ' ' + p.building + ' ' + p.unit);
      var active = p.id === state.selectedId ? ' active' : '';
      return '<button class="map-result-item' + active + '" data-prop-id="' + p.id + '">' +
        '<div class="map-result-name">' + title + '</div>' +
        '<div class="map-result-meta">' + App.I18n.wan(p.totalPrice) + ' · ' + p.area + 'm² · ' + App.I18n.rooms(p.rooms) + '<br>' + Utils.esc(p.address) + '</div>' +
      '</button>';
    }).join('');
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-prop-id]'), function (button) {
      button.onclick = function () { selectListing(button.getAttribute('data-prop-id')); };
    });
  }

  function loadBaiduMap(ak) {
    if (global.BMapGL) return Promise.resolve();
    if (global.__nexthomeBaiduMapLoader) return global.__nexthomeBaiduMapLoader;
    global.__nexthomeBaiduMapLoader = new Promise(function (resolve, reject) {
      var callbackName = '__nexthomeBaiduMapReady';
      var script = document.createElement('script');
      var timer = global.setTimeout(function () {
        cleanup();
        reject(new Error('Baidu Maps load timeout'));
      }, 15000);

      function cleanup() {
        global.clearTimeout(timer);
        script.onerror = null;
        try { delete global[callbackName]; } catch (err) { global[callbackName] = undefined; }
      }

      global[callbackName] = function () {
        cleanup();
        global.BMapGL ? resolve() : reject(new Error('BMapGL unavailable'));
      };
      script.src = 'https://api.map.baidu.com/api?v=1.0&type=webgl&ak=' + encodeURIComponent(ak) + '&callback=' + callbackName;
      script.async = true;
      script.onerror = function () {
        cleanup();
        reject(new Error('Baidu Maps load failed'));
      };
      document.head.appendChild(script);
    }).catch(function (err) {
      global.__nexthomeBaiduMapLoader = null;
      throw err;
    });
    return global.__nexthomeBaiduMapLoader;
  }

  function initMap() {
    var canvas = document.getElementById('mapCanvas');
    if (!canvas || !global.BMapGL) return;
    canvas.innerHTML = '';
    var center = state.config.center || { lng: 121.5147, lat: 31.2387, zoom: 11 };
    state.map = new global.BMapGL.Map('mapCanvas');
    state.map.centerAndZoom(new global.BMapGL.Point(center.lng, center.lat), center.zoom || 11);
    state.map.enableScrollWheelZoom(true);
    if (global.BMapGL.NavigationControl3D) state.map.addControl(new global.BMapGL.NavigationControl3D());
    if (global.BMapGL.ScaleControl) state.map.addControl(new global.BMapGL.ScaleControl());
    renderMarkers();
  }

  function renderMarkers() {
    if (!state.map || !global.BMapGL) return;
    state.map.clearOverlays();
    state.markers = {};
    var points = [];
    state.filtered.forEach(function (p) {
      if (!p.location || !Number.isFinite(p.location.lng) || !Number.isFinite(p.location.lat)) return;
      var point = new global.BMapGL.Point(p.location.lng, p.location.lat);
      var marker = new global.BMapGL.Marker(point);
      marker.addEventListener('click', function () { selectListing(p.id, true); });
      state.map.addOverlay(marker);
      state.markers[p.id] = { marker: marker, point: point };
      points.push(point);
    });
    if (points.length > 1) {
      var viewport = state.map.getViewport(points);
      state.map.centerAndZoom(viewport.center, Math.min(viewport.zoom, 15));
    } else if (points.length === 1) {
      state.map.centerAndZoom(points[0], 15);
    }
  }

  function selectListing(id, fromMarker) {
    var property = state.list.find(function (p) { return p.id === id; });
    if (!property) return;
    state.selectedId = id;
    renderResults(document.getElementById('mapSearchInput').value.trim());
    var markerInfo = state.markers[id];
    if (!markerInfo || !state.map || !global.BMapGL) return;
    state.map.centerAndZoom(markerInfo.point, 16);
    var content = '<div class="map-info-window">' +
      '<h4>' + Utils.esc(property.community + ' ' + property.building + ' ' + property.unit) + '</h4>' +
      '<p>' + App.I18n.wan(property.totalPrice) + ' · ' + property.area + 'm² · ' + App.I18n.rooms(property.rooms) + '</p>' +
      '<p>' + Utils.esc(property.address) + '</p>' +
      '<p style="color:#999">' + t('map.demoLocation') + '</p>' +
      '<a href="#/property/' + property.id + '">' + t('map.viewDetail') + ' →</a>' +
      '</div>';
    state.map.openInfoWindow(new global.BMapGL.InfoWindow(content, { width: 250, height: 150, title: t('map.location') }), markerInfo.point);
    if (!fromMarker) {
      var listItem = document.querySelector('[data-prop-id="' + id + '"]');
      if (listItem) listItem.scrollIntoView({ block: 'nearest' });
    }
  }

  function showMapConfigHint() {
    var canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    canvas.innerHTML = '<div class="map-fallback"><div><div class="empty-state-icon">🗺️</div><h3>' + t('map.configTitle') + '</h3><p style="margin-top:8px">' + t('map.configHint') + '</p></div></div>';
  }

  function showMapFailure() {
    var canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    canvas.innerHTML = '<div class="map-fallback"><div><div class="empty-state-icon">⚠️</div><p>' + t('map.mapFailed') + '</p></div></div>';
  }
})(window);
