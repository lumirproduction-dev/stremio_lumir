const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const manifest = {
  id: "org.muj.helloworldaddon",
  version: "1.0.17",
  name: "Hello World Addon",
  description: "Search addon",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "helloworldmovies",
      name: "Search",
      extra: [{ name: "search", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);


// ---------------- CACHE ----------------

const cache = new Map();
const CACHE_TIME = 5 * 60 * 1000;

function getCache(key) {

  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() > item.expire) {
    cache.delete(key);
    return null;
  }

  console.log("CACHE HIT:", key);

  return item.data;

}

function setCache(key, data) {

  cache.set(key, {
    data,
    expire: Date.now() + CACHE_TIME
  });

}


// ---------------- FETCH WITH PROXY ----------------

async function fetchProxy(url) {

 

  const cached = getCache(url);
  if (cached) return cached;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url
  ];

  for (const proxy of proxies) {

    try {

      console.log("TRY:", proxy);

      const res = await axios.get(proxy, { timeout: 10000 });

      let data = res.data;

      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch {}
      }

      if (!data || typeof data !== "object") {
        throw new Error("Invalid API response");
      }

      setCache(url, data);

      return data;

    } catch (e) {

      console.log("PROXY FAIL:", proxy);

    }

  }

  throw new Error("All proxies failed");
}

// ---------------- CATALOG ----------------

builder.defineCatalogHandler(async ({ extra }) => {

  if (!extra || !extra.search) return { metas: [] };

  const query = extra.search.trim();

  const apiUrl =
    `https://api.hellspy.to/gw/search?query=${encodeURIComponent(query)}&offset=0&limit=64`;

  try {

    const data = await fetchProxy(apiUrl);

    const results = data.items || [];

    const metas = results.slice(0, 30).map(v => ({
      id: `pokusne_${v.id}`,
      type: "movie",
      name: v.title,
      poster: v.thumbs?.[0] || ""
    }));

    console.log("CATALOG RESULTS:", metas.length);

    return { metas };

  } catch (err) {

    console.error("CATALOG ERROR:", err.message);
    return { metas: [] };

  }

});


// ---------------- META ----------------

builder.defineMetaHandler(async ({ id }) => {

  const videoId = id.replace("pokusne_", "");

  const url = `https://pokusne.com/gw/video/${videoId}`;

  try {

    const data = await fetchProxy(url);

    return {
      meta: {
        id,
        type: "movie",
        name: data.title || id,
        poster: data.thumbnail || "",
        description: data.description || "",
        year: data.year || null
      }
    };

  } catch (err) {

    console.error("META ERROR:", err.message);

    return {
      meta: {
        id,
        type: "movie",
        name: `Video ${videoId}`
      }
    };

  }

});


// ---------------- STREAM ----------------

builder.defineStreamHandler(async ({ id }) => {

  const videoId = id.replace("pokusne_", "");

  const pageUrl = `https://pokusne.com/video/${videoId}`;

  try {

    const html = await fetchProxy(pageUrl);

    const $ = cheerio.load(html);

    const streams = [];

    $("video source, video").each((i, el) => {

      const src = $(el).attr("src") || $(el).attr("data-src");

      if (!src) return;

      if (src.includes(".mp4") || src.includes(".m3u8")) {

        streams.push({
          url: src.startsWith("http") ? src : `https://pokusne.com${src}`,
          title: `Stream ${i + 1}`
        });

      }

    });

    console.log("STREAMS FOUND:", streams.length);

    return { streams };

  } catch (err) {

    console.error("STREAM ERROR:", err.message);

    return { streams: [] };

  }

});

module.exports = builder.getInterface();
