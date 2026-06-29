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

  let meta = null;
  let encryptedBytes = null;
  let dataPromise = null;
  let currentName = "image";
  let objectUrl = null;

  const msg = (text) => {
    status.textContent = text || "";
  };

  function pageInfo() {
    const path = location.pathname;
    const marker = "/i/";
    const pos = path.indexOf(marker);

    if (pos < 0) {
      throw new Error("bad url");
    }

    const prefix = path.slice(0, pos);
    const rest = path.slice(pos + marker.length).split("/").filter(Boolean);

    if (!rest.length) {
      throw new Error("image name not found");
    }

    const imageName = decodeURIComponent(rest[0]);
    const encodedName = encodeURIComponent(imageName);

    return {
      imageName,
      listUrl: `${prefix}/i/`,
      metaUrls: [
        `../../data/${encodedName}.json`,
        `${prefix}/data/${encodedName}.json`,
        `/data/${encodedName}.json`
      ]
    };
  }

  async function fetchFirstJson(urls) {
    const errors = [];

    for (const url of urls) {
      try {
        const absoluteUrl = new URL(url, location.href).href;
        console.log("trying meta url:", url, absoluteUrl);

        const res = await fetch(url, { cache: "no-store" });

        if (res.ok) {
          return {
            json: await res.json(),
            url: res.url
          };
        }

        errors.push(`${url} (${res.status})`);
      } catch (error) {
        errors.push(`${url} (${error.message})`);
      }
    }

    throw new Error(`data not found: ${errors.join(" / ")}`);
  }

  async function fetchBytes(url) {
    console.log("trying bin url:", url);

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`bin not found: ${url} (${res.status})`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async function loadDataPackage() {
    if (meta && encryptedBytes) {
      return { meta, encryptedBytes };
    }

    const p = pageInfo();

    currentName = p.imageName;

    if (listLink) {
      listLink.href = p.listUrl;
    }

    const loaded = await fetchFirstJson(p.metaUrls);
    meta = loaded.json;

    if (!meta.dataFile) {
      throw new Error("bad meta: dataFile is missing");
    }

    currentName = meta.name || p.imageName;

    const binUrl = new URL(meta.dataFile, loaded.url).href;
    encryptedBytes = await fetchBytes(binUrl);

    if (typeof meta.source?.originalBytes === "number" && encryptedBytes.length !== meta.source.originalBytes) {
      console.warn(`bin size mismatch: ${encryptedBytes.length} != ${meta.source.originalBytes}`);
    }

    return { meta, encryptedBytes };
  }

  function ensureDataLoadingStarted() {
    if (!dataPromise) {
      dataPromise = loadDataPackage();
    }

    return dataPromise;
  }

  function hash128(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    let h3 = 0x9e3779b9;
    let h4 = 0x85ebca6b;

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

    return [
      h1 || 0x243f6a88,
      h2 || 0x85a308d3,
      h3 || 0x13198a2e,
      h4 || 0x03707344
    ];
  }

  function prng(seed) {
    let [a, b, c, d] = seed;

    return () => {
      const t = (a ^ (a << 11)) >>> 0;

      a = b;
      b = c;
      c = d;

      d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0;

      return d;
    };
  }

  function decryptBytes(password) {
    if (!meta || !encryptedBytes) {
      throw new Error("loading...");
    }

    let seed = hash128(`imgpass-v7\n${meta.id || meta.name}\n${password}`);

    for (let i = 0; i < (meta.rounds || 0); i++) {
      seed = hash128(seed.join(":") + ":" + i);
    }

    const next = prng(seed);
    const plain = new Uint8Array(encryptedBytes.length);

    for (let i = 0; i < encryptedBytes.length; i += 4) {
      const r = next();

      plain[i] = encryptedBytes[i] ^ (r & 255);

      if (i + 1 < encryptedBytes.length) {
        plain[i + 1] = encryptedBytes[i + 1] ^ ((r >>> 8) & 255);
      }

      if (i + 2 < encryptedBytes.length) {
        plain[i + 2] = encryptedBytes[i + 2] ^ ((r >>> 16) & 255);
      }

      if (i + 3 < encryptedBytes.length) {
        plain[i + 3] = encryptedBytes[i + 3] ^ ((r >>> 24) & 255);
      }
    }

    return plain;
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function waitForImageLoad(imageElement) {
    return new Promise((resolve, reject) => {
      imageElement.onload = () => resolve();
      imageElement.onerror = () => reject(new Error("wrong password or broken image"));
    });
  }

  async function showImage(password) {
    await ensureDataLoadingStarted();

    msg("opening...");

    const plainBytes = decryptBytes(password);
    const mime = meta.mime || "application/octet-stream";
    const blob = new Blob([plainBytes], { type: mime });

    revokeObjectUrl();

    objectUrl = URL.createObjectURL(blob);

    const loading = waitForImageLoad(img);

    img.src = objectUrl;
    openImage.href = objectUrl;

    await loading;

    viewer.hidden = false;
    card.classList.add("opened");

    msg("");
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();

    viewer.hidden = true;
    button.disabled = true;
    msg("loading...");

    setTimeout(async () => {
      try {
        await showImage(input.value);
      } catch (error) {
        console.error(error);

        revokeObjectUrl();

        img.removeAttribute("src");
        openImage.href = "#";

        msg(error.message || "failed");
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

    revokeObjectUrl();

    input.value = "";
    input.focus();
  });

  download.addEventListener("click", () => {
    if (!objectUrl) {
      return;
    }

    const a = document.createElement("a");

    a.download = currentName;
    a.href = objectUrl;
    a.click();
  });

  (async () => {
    try {
      if (location.protocol === "file:") {
        msg("use local server");
      } else {
        msg("loading...");
      }

      await ensureDataLoadingStarted();

      msg("");
    } catch (error) {
      console.error(error);
      msg(error.message || "failed");
    } finally {
      button.disabled = false;
    }
  })();
})();
