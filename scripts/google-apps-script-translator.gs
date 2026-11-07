/**
 * Google Apps Script - Private File Stream (PFS) Lyrics & Subtitle Translator
 * 
 * Fitur:
 * - Menggunakan LanguageApp.translate bawaan Google (gratis, tanpa API key berbayar).
 * - Proteksi akses: Hanya admin (via ADMIN_SECRET atau validasi session tier PFS).
 * - Menerjemahkan Lyrics (format segments: [{start, end, text}]).
 * - Menerjemahkan Subtitles (format WebVTT / SRT) dengan menjaga keutuhan timestamp.
 * - Mendukung chunking batch translation otomatis agar tidak melebihi limit 5000 karakter per request.
 * - Dapat berfungsi sebagai Web App webhook atau dieksekusi langsung via trigger.
 */

// Konfigurasi default (simpan ADMIN_SECRET di Project Settings > Script Properties)
var SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
var ADMIN_SECRET = SCRIPT_PROPERTIES.getProperty("ADMIN_SECRET") || "pfs_admin_secret_key_123";

/**
 * HTTP POST Handler (Web App Endpoint)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonReply({ error: "Missing payload" }, 400);
    }

    var payload = JSON.parse(e.postData.contents);

    // 1. Validasi Autentikasi Admin
    var isAuthorized = checkAdminAuth(payload);
    if (!isAuthorized) {
      return jsonReply({ error: "Forbidden: Hanya admin yang diizinkan menerjemahkan" }, 403);
    }

    var targetLang = (payload.targetLang || "id").trim().toLowerCase();
    var sourceLang = (payload.sourceLang || "").trim().toLowerCase(); // Kosong = auto-detect
    if (sourceLang === targetLang || sourceLang === "und") {
      sourceLang = "";
    }
    var type = payload.type || "lyrics"; // 'lyrics' | 'subtitle' | 'text'

    var translatedResult;

    if (type === "lyrics") {
      if (!Array.isArray(payload.segments)) {
        return jsonReply({ error: "Payload 'segments' array diperlukan untuk type lyrics" }, 400);
      }
      translatedResult = translateLyricsSegments(payload.segments, targetLang, sourceLang);
      return jsonReply({
        success: true,
        type: "lyrics",
        targetLang: targetLang,
        segments: translatedResult
      });
    } else if (type === "subtitle") {
      if (typeof payload.content !== "string") {
        return jsonReply({ error: "Payload 'content' string diperlukan untuk type subtitle" }, 400);
      }
      translatedResult = translateSubtitleContent(payload.content, targetLang, sourceLang);
      return jsonReply({
        success: true,
        type: "subtitle",
        targetLang: targetLang,
        content: translatedResult
      });
    } else if (type === "text") {
      var text = payload.text || "";
      var translatedText = LanguageApp.translate(text, sourceLang, targetLang);
      return jsonReply({
        success: true,
        type: "text",
        targetLang: targetLang,
        text: translatedText
      });
    } else {
      return jsonReply({ error: "Type tidak dikenali: gunakan 'lyrics', 'subtitle', atau 'text'" }, 400);
    }

  } catch (error) {
    return jsonReply({ error: error.message || "Internal error" }, 500);
  }
}

/**
 * Validasi hak akses Admin.
 * Mendukung 2 metode:
 * 1. Matching 'adminSecret' dengan Script Properties.
 * 2. Validasi session cookie 'pfsSession' ke server PFS (memeriksa access_tier >= 100).
 */
function checkAdminAuth(payload) {
  // Metode 1: Shared Secret Key
  if (payload.adminSecret && String(payload.adminSecret).trim() === String(ADMIN_SECRET).trim()) {
    return true;
  }

  // Metode 2: Cek ke server PFS langsung jika URL dan cookie diberikan
  if (payload.pfsUrl && payload.pfsSession) {
    try {
      var response = UrlFetchApp.fetch(payload.pfsUrl.replace(/\/+$/, "") + "/api/auth/me", {
        headers: {
          "Cookie": "pfs_session=" + payload.pfsSession
        },
        muteHttpExceptions: true
      });
      if (response.getResponseCode() === 200) {
        var user = JSON.parse(response.getContentText());
        return Number(user.access_tier) >= 100;
      }
    } catch (err) {
      Logger.log("Gagal memvalidasi sesi PFS: " + err);
    }
  }

  return false;
}

/**
 * Terjemahkan array segments lirik [{start, end, text}]
 */
function translateLyricsSegments(segments, targetLang, sourceLang) {
  if (!segments || segments.length === 0) return [];

  var lines = segments.map(function(s) {
    return (s && s.text) ? String(s.text).trim() : "";
  });

  var translatedLines = batchTranslateLines(lines, targetLang, sourceLang);

  return segments.map(function(seg, idx) {
    return {
      start: seg.start,
      end: seg.end,
      text: translatedLines[idx] !== undefined ? translatedLines[idx] : seg.text
    };
  });
}

/**
 * Terjemahkan subtitle WebVTT atau SRT dengan menjaga baris timestamp tetap utuh.
 */
function translateSubtitleContent(content, targetLang, sourceLang) {
  if (!content) return "";

  var lines = content.split(/\r?\n/);
  var textIndices = [];
  var textLines = [];

  var timestampRegex = /-->/;
  var isHeader = true;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line === "WEBVTT" || line.indexOf("X-TIMESTAMP-MAP") === 0 || line.indexOf("NOTE") === 0) {
      continue;
    }
    if (timestampRegex.test(line)) {
      isHeader = false;
      continue;
    }
    if (/^\d+$/.test(line)) {
      // Cue number (SRT)
      continue;
    }
    if (line === "") {
      continue;
    }

    if (!isHeader) {
      textIndices.push(i);
      textLines.push(lines[i]);
    }
  }

  if (textLines.length === 0) return content;

  var translatedTexts = batchTranslateLines(textLines, targetLang, sourceLang);

  for (var j = 0; j < textIndices.length; j++) {
    var lineIndex = textIndices[j];
    if (translatedTexts[j] !== undefined) {
      lines[lineIndex] = translatedTexts[j];
    }
  }

  return lines.join("\n");
}

/**
 * Batch translation untuk menghindari limit 5000 karakter per pemanggilan Google Translate.
 */
function batchTranslateLines(lines, targetLang, sourceLang) {
  if (!lines || lines.length === 0) return [];

  var DELIMITER = "\n⟦§⟧\n";
  var result = [];
  var currentBatch = [];
  var currentLength = 0;

  function doTranslate(text) {
    try {
      return LanguageApp.translate(text, sourceLang || "", targetLang);
    } catch (err) {
      if (sourceLang) {
        return LanguageApp.translate(text, "", targetLang);
      }
      throw err;
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i] || "";
    // Jika menambah baris ini melebihi 3500 karakter, terjemahkan batch saat ini dulu
    if (currentLength + line.length + DELIMITER.length > 3500 && currentBatch.length > 0) {
      var batchJoined = currentBatch.join(DELIMITER);
      var translatedBatch = doTranslate(batchJoined);
      var translatedSplit = translatedBatch.split(/\n?⟦§⟧\n?/);
      for (var k = 0; k < currentBatch.length; k++) {
        result.push(translatedSplit[k] !== undefined ? translatedSplit[k].trim() : currentBatch[k]);
      }
      currentBatch = [];
      currentLength = 0;
    }

    currentBatch.push(line);
    currentLength += line.length + DELIMITER.length;
  }

  if (currentBatch.length > 0) {
    var lastBatchJoined = currentBatch.join(DELIMITER);
    var lastTranslated = doTranslate(lastBatchJoined);
    var lastSplit = lastTranslated.split(/\n?⟦§⟧\n?/);
    for (var m = 0; m < currentBatch.length; m++) {
      result.push(lastSplit[m] !== undefined ? lastSplit[m].trim() : currentBatch[m]);
    }
  }

  return result;
}

/**
 * Helper JSON response
 */
function jsonReply(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * FUNGSI STANDALONE / TRIGGER:
 * Terjemahkan lirik langsung dari server PFS dan simpan kembali ke server PFS.
 * Dapat dipanggil langsung dari editor GAS.
 */
function translateAndSavePfsLyrics(pfsUrl, mediaId, targetLang, adminCookie) {
  var url = pfsUrl.replace(/\/+$/, "");
  
  // 1. Ambil lirik saat ini
  var getResp = UrlFetchApp.fetch(url + "/api/media/" + mediaId + "/lyrics", {
    headers: { "Cookie": "pfs_session=" + adminCookie },
    muteHttpExceptions: true
  });

  if (getResp.getResponseCode() !== 200) {
    throw new Error("Gagal ambil lirik: " + getResp.getContentText());
  }

  var data = JSON.parse(getResp.getContentText());
  var segments = data.segments || [];

  // 2. Terjemahkan segments
  var translatedSegments = translateLyricsSegments(segments, targetLang);

  // 3. Simpan lirik hasil terjemahan kembali (PUT /api/media/:id/lyrics)
  var putResp = UrlFetchApp.fetch(url + "/api/media/" + mediaId + "/lyrics", {
    method: "put",
    contentType: "application/json",
    headers: { "Cookie": "pfs_session=" + adminCookie },
    payload: JSON.stringify({
      language: targetLang,
      segments: translatedSegments
    }),
    muteHttpExceptions: true
  });

  if (putResp.getResponseCode() !== 200) {
    throw new Error("Gagal simpan lirik terjemahan: " + putResp.getContentText());
  }

  Logger.log("Sukses menerjemahkan lirik media " + mediaId + " ke " + targetLang);
  return JSON.parse(putResp.getContentText());
}
