(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const input = $("password");
  const button = $("button");
  const status = $("status");
  const viewer = $("viewer");
  const img = $("image");
  const download = $("download");
  const retry = $("retry");
  const openImage = $("openImage");
  const listLink = $("listLink");
  const card = document.querySelector(".card");

  let data = null;
  let currentName = "image.png";
  let objectUrl = null;

  button.disabled = true;
  const msg = (text) => { status.textContent = text || ""; };

  function pageInfo() {
    const path = location.pathname;
    const marker = "/i/";
    const pos = path.indexOf(marker);
    if (pos < 0) throw new Error("bad url");

    const rest = path.slice(pos + marker.length).split("/").filter(Boolean);
    if (!rest.length) throw new Error("image name not found");

    const imageName = decodeURIComponent(rest[0]);

    // GitHub Pages の project pages / custom domain / index.html 直アクセスで壊れにくいよう、
    // ルート絶対パスではなく、画像ページからの相対パスで data を読む。
    return {
      imageName,
      listUrl: "../",
      dataUrl: `../../data/${encodeURIComponent(imageName)}.json`,
    };
  }

  function base64ToBytes(source) {
    const bin = atob(source);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hash128(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ k, 2654435761);
      h2 = Math.imul(h2 ^ k, 1597334677);
      h3 = Math.imul(h3 ^ k, 2246822507);
      h4 = Math.imul(h4 ^ k, 3266489909);
    }
    h1 = (h1 ^ (h1 >>> 16)) >>> 0;
    h2 = (h2 ^ (h2 >>> 15)) >>> 0;
    h3 = (h3 ^ (h3 >>> 16)) >>> 0;
    h4 = (h4 ^ (h4 >>> 15)) >>> 0;
    return [h1 || 0x243f6a88, h2 || 0x85a308d3, h3 || 0x13198a2e, h4 || 0x03707344];
  }

  function prng(seed) {
    let [a, b, c, d] = seed;
    return () => {
      const t = (a ^ (a << 11)) >>> 0;
      a = b; b = c; c = d;
      d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0;
      return d;
    };
  }

  function restore(password) {
    if (!data) throw new Error("data not loaded");
    const cipher = base64ToBytes(data.ciphertext);
    const expected = data.width * data.height * 4;
    if (cipher.length !== expected) throw new Error("bad data");

    let seed = hash128(`imgpass-v6\n${data.id || data.name}\n${password}`);
    for (let i = 0; i < (data.rounds || 0); i++) {
      seed = hash128(seed.join(":") + ":" + i);
    }

    const next = prng(seed);
    const plain = new Uint8ClampedArray(cipher.length);
    for (let i = 0; i < cipher.length; i += 4) {
      const r = next();
      plain[i] = cipher[i] ^ (r & 255);
      plain[i + 1] = cipher[i + 1] ^ ((r >>> 8) & 255);
      plain[i + 2] = cipher[i + 2] ^ ((r >>> 16) & 255);
      plain[i + 3] = cipher[i + 3] ^ ((r >>> 24) & 255);
    }
    return new ImageData(plain, data.width, data.height);
  }

  function revoke() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function imageDataToBlob(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/png");
    });
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    viewer.hidden = true;
    button.disabled = true;
    msg("opening...");

    setTimeout(async () => {
      try {
        const imageData = restore(input.value);
        const blob = await imageDataToBlob(imageData);
        revoke();
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        openImage.href = objectUrl;
        viewer.hidden = false;
        card.classList.add("opened");
        msg("");
      } catch (e) {
        console.error(e);
        msg(e.message || "failed");
      } finally {
        button.disabled = false;
      }
    }, 20);
  });

  retry.addEventListener("click", () => {
    viewer.hidden = true;
    card.classList.remove("opened");
    msg("");
    img.removeAttribute("src");
    openImage.href = "#";
    revoke();
    input.value = "";
    input.focus();
  });

  download.addEventListener("click", () => {
    if (!objectUrl) return;
    const a = document.createElement("a");
    a.download = currentName.toLowerCase().endsWith(".png") ? currentName : `${currentName}.png`;
    a.href = objectUrl;
    a.click();
  });

  (async () => {
    try {
      if (location.protocol === "file:") msg("use local server");
      const p = pageInfo();
      currentName = p.imageName;
      if (listLink) listLink.href = p.listUrl;

      const res = await fetch(p.dataUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`data not found: ${p.dataUrl} (${res.status})`);
      data = await res.json();
      currentName = data.name || p.imageName;
      button.disabled = false;
      msg("");
    } catch (e) {
      console.error(e);
      button.disabled = true;
      msg(e.message || "failed");
    }
  })();
})();
