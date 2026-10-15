/* Supply the exact public registry to the pose-local mage renderer. */
(()=>{'use strict';const registry=window.RpgHeroArtRegistry,api=window.RpgMageHeroFX;if(registry&&api)api.configure({entries:registry.keys.map(key=>registry.get(key))},{baseURL:new URL('./',document.currentScript?.src||location.href).href});})();
