(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const form = $("form"), input = $("password"), button = $("button"), status = $("status"), viewer = $("viewer"), img = $("image"), download = $("download"), retry = $("retry"), openImage = $("openImage"), card = document.querySelector(".card");
  let data = null, currentName = "image.png", objectUrl = null;
  const msg = t => status.textContent = t || "";

  function pageInfo(){
    const p = location.pathname, m = "/i/", i = p.indexOf(m);
    if(i < 0) throw Error("bad url");
    const prefix = p.slice(0, i), parts = p.slice(i + m.length).split("/").filter(Boolean);
    if(!parts.length) throw Error("bad url");
    const imageName = decodeURIComponent(parts[0]);
    return { imageName, dataUrl: `${prefix}/data/${encodeURIComponent(imageName)}.json` };
  }

  function b64bytes(s){ const bin = atob(s), out = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
  function hash128(str){
    let h1=0xdeadbeef,h2=0x41c6ce57,h3=0x9e3779b9,h4=0x85ebca6b;
    for(let i=0;i<str.length;i++){ const k=str.charCodeAt(i); h1=Math.imul(h1^k,2654435761); h2=Math.imul(h2^k,1597334677); h3=Math.imul(h3^k,2246822507); h4=Math.imul(h4^k,3266489909); }
    h1=(h1^h1>>>16)>>>0; h2=(h2^h2>>>15)>>>0; h3=(h3^h3>>>16)>>>0; h4=(h4^h4>>>15)>>>0;
    return [h1||0x243f6a88,h2||0x85a308d3,h3||0x13198a2e,h4||0x03707344];
  }
  function prng(seed){ let [a,b,c,d]=seed; return () => { const t=(a^(a<<11))>>>0; a=b; b=c; c=d; d=(d^(d>>>19)^t^(t>>>8))>>>0; return d; }; }
  function restore(pw){
    if(!data) throw Error("data not loaded");
    const cipher = b64bytes(data.ciphertext), need = data.width * data.height * 4;
    if(cipher.length !== need) throw Error("bad data");
    let seed = hash128(`imgpass-v6\n${data.id || data.name}\n${pw}`);
    for(let i=0;i<(data.rounds||0);i++) seed = hash128(seed.join(":") + ":" + i);
    const next = prng(seed), plain = new Uint8ClampedArray(cipher.length);
    for(let i=0;i<cipher.length;i+=4){ const r=next(); plain[i]=cipher[i]^(r&255); plain[i+1]=cipher[i+1]^((r>>>8)&255); plain[i+2]=cipher[i+2]^((r>>>16)&255); plain[i+3]=cipher[i+3]^((r>>>24)&255); }
    return new ImageData(plain, data.width, data.height);
  }
  function revoke(){ if(objectUrl){ URL.revokeObjectURL(objectUrl); objectUrl=null; } }
  function imageDataToBlob(imageData){ const c=document.createElement("canvas"); c.width=imageData.width; c.height=imageData.height; c.getContext("2d").putImageData(imageData,0,0); return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error("blob failed")),"image/png")); }

  form.addEventListener("submit", ev => { ev.preventDefault(); viewer.hidden=true; button.disabled=true; msg("opening..."); setTimeout(async()=>{ try{ const imageData=restore(input.value), blob=await imageDataToBlob(imageData); revoke(); objectUrl=URL.createObjectURL(blob); img.src=objectUrl; openImage.href=objectUrl; viewer.hidden=false; card.classList.add("opened"); msg(""); } catch(e){ console.error(e); msg(e.message || "failed"); } finally { button.disabled=false; } },20); });
  retry.addEventListener("click",()=>{ viewer.hidden=true; card.classList.remove("opened"); msg(""); img.removeAttribute("src"); openImage.href="#"; revoke(); input.value=""; input.focus(); });
  download.addEventListener("click",()=>{ if(!objectUrl) return; const a=document.createElement("a"); a.download=currentName.toLowerCase().endsWith(".png")?currentName:`${currentName}.png`; a.href=objectUrl; a.click(); });
  (async()=>{ try{ if(location.protocol === "file:") msg("use local server"); const p=pageInfo(); currentName=p.imageName; const res=await fetch(p.dataUrl,{cache:"no-store"}); if(!res.ok) throw Error(`data not found: ${p.dataUrl}`); data=await res.json(); currentName=data.name || p.imageName; msg(""); } catch(e){ console.error(e); msg(e.message || "failed"); } })();
})();
