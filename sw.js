if(!self.define){let e,t={};const a=(a,s)=>(a=new URL(a+".js",s).href,t[a]||new Promise((t=>{if("document"in self){const e=document.createElement("script");e.src=a,e.onload=t,document.head.appendChild(e)}else e=a,importScripts(a),t()})).then((()=>{let e=t[a];if(!e)throw new Error(`Module ${a} didn’t register its module`);return e})));self.define=(s,i)=>{const r=e||("document"in self?document.currentScript.src:"")||location.href;if(t[r])return;let d={};const o=e=>a(e,r),l={module:{uri:r},exports:d,require:o};t[r]=Promise.all(s.map((e=>l[e]||o(e)))).then((e=>(i(...e),d)))}}define(["./workbox-e3490c72"],(function(e){"use strict";self.addEventListener("message",(e=>{e.data&&"SKIP_WAITING"===e.data.type&&self.skipWaiting()})),e.precacheAndRoute([{url:"assets/index-C0A3eB07.js",revision:null},{url:"assets/index-vF9psv4K.css",revision:null},{url:"assets/vanilla-picker-B6E6ObS_.js",revision:null},{url:"assets/workbox-window.prod.es5-B9K5rw8f.js",revision:null},{url:"icons/mftc-icon-192.png",revision:"3b46a2af9ad00da86f38a64f31e4fbdf"},{url:"index.html",revision:"c7f06793bb9ed9128c01fb176617d23d"},{url:"manifest.webmanifest",revision:"659e3ffe77048756e4e6eeb37edc0f99"},{url:"sample-protocol.json",revision:"1793dea16b44650a3ebdae993d7ac492"},{url:"simulator-data/aborted-test-early.txt",revision:"bc99f528ef0d7ee2666434c243cde136"},{url:"simulator-data/aborted-test-low-particle-count.txt",revision:"fe8be248beb515be07a6a1f81895de8f"},{url:"simulator-data/aborted-test-mid-test.txt",revision:"fa6085c98313ff2758eadd900bf4b627"},{url:"simulator-data/ambient-levels-wide-swing.txt",revision:"06de12fcbe9b3a1ae9fe8425b9585b16"},{url:"simulator-data/concentrations-only.txt",revision:"3026ece9569dee342401e39e73a86216"},{url:"simulator-data/external-control-responses.txt",revision:"eb2e0cfad4bdbebc38fc18e8ed79275d"},{url:"simulator-data/full-test-4-exercises.txt",revision:"eff5aca05bd0d3c34189d3ecc9316e8c"},{url:"simulator-data/full-test-8-exercises.txt",revision:"7f97cb68a7a161102afb137459094a7c"},{url:"simulator-data/startup-data.txt",revision:"cb15f9d528fcda9082df10db3b366cb5"},{url:"simulator-data/test-data.txt",revision:"c1023dad08169fb7b58fe8ccfe873f49"},{url:"simulator-data/test-sample-1-condensed.txt",revision:"fe1834f2d2695d24dbea445b75ff8ee5"},{url:"simulator-data/test-sample-1.txt",revision:"462a33e2b33b30f1a058f027059d8c27"},{url:"vite.svg",revision:"8e3a10e157f75ada21ab742c022d5430"},{url:"sample-protocol.json",revision:"1793dea16b44650a3ebdae993d7ac492"},{url:"vite.svg",revision:"8e3a10e157f75ada21ab742c022d5430"},{url:"icons/mftc-icon-192.png",revision:"3b46a2af9ad00da86f38a64f31e4fbdf"},{url:"simulator-data/aborted-test-early.txt",revision:"bc99f528ef0d7ee2666434c243cde136"},{url:"simulator-data/aborted-test-low-particle-count.txt",revision:"fe8be248beb515be07a6a1f81895de8f"},{url:"simulator-data/aborted-test-mid-test.txt",revision:"fa6085c98313ff2758eadd900bf4b627"},{url:"simulator-data/ambient-levels-wide-swing.txt",revision:"06de12fcbe9b3a1ae9fe8425b9585b16"},{url:"simulator-data/concentrations-only.txt",revision:"3026ece9569dee342401e39e73a86216"},{url:"simulator-data/external-control-responses.txt",revision:"eb2e0cfad4bdbebc38fc18e8ed79275d"},{url:"simulator-data/full-test-4-exercises.txt",revision:"eff5aca05bd0d3c34189d3ecc9316e8c"},{url:"simulator-data/full-test-8-exercises.txt",revision:"7f97cb68a7a161102afb137459094a7c"},{url:"simulator-data/startup-data.txt",revision:"cb15f9d528fcda9082df10db3b366cb5"},{url:"simulator-data/test-data.txt",revision:"c1023dad08169fb7b58fe8ccfe873f49"},{url:"simulator-data/test-sample-1-condensed.txt",revision:"fe1834f2d2695d24dbea445b75ff8ee5"},{url:"simulator-data/test-sample-1.txt",revision:"462a33e2b33b30f1a058f027059d8c27"},{url:"manifest.webmanifest",revision:"659e3ffe77048756e4e6eeb37edc0f99"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))}));
