// ==UserScript==
// @name         98堂-115离线助手
// @name:zh-CN   98堂-115离线助手
// @name:en      98tang to 115 offline helper
// @namespace    https://github.com/Mr-jello/tang-to-115-assistant
// @version      2.3.0
// @description  从论坛提取 magnet / ed2k，按帖子标题清洗后在 115 指定父目录下创建子目录，并把离线任务保存到该子目录。若是压缩包，则可自动解压并删除原压缩包。
// @description:en Extract magnet/ed2k links from forum, create subfolder in 115 with cleaned post title under specified parent directory, and save offline tasks to the subfolder. If it's an archive file, it can be automatically extracted and the original archive can be deleted.
// @author       Mr-jello
// @license      Apache License 2.0
// @match        *://*.115.com/*
// @include      https://www.sehuatang.*
// @include      https://www.weterytrtrr.*
// @include      https://www.qweqwtret.*
// @include      https://www.retreytryuyt.*
// @include      https://www.qwerwrrt.*
// @include      https://www.5aylp.*
// @include      https://www.jq2t4.*
// @include      https://www.0krgb.*
// @include      https://www.1qyqs.*
// @include      https://xs5xs8.*
// @include      https://hjd2048.com.*
// @include      https://sehuatang.*
// @include      https://weterytrtrr.*
// @include      https://qweqwtret.*
// @include      https://retreytryuyt.*
// @include      https://qwerwrrt.*
// @include      https://5aylp.*
// @include      https://jq2t4.*
// @include      https://1qyqs.*
// @include      https://ds5hk.*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_cookie
// @grant        GM_setClipboard
// @connect      115.com
// @connect      webapi.115.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const config = {
    webDownloadFolderId: GM_getValue("webDownloadFolderId", ""),
    botDownloadUrl: GM_getValue("botDownloadUrl", ""),

    signUrl: "https://115.com/?ct=offline&ac=space&_=",
    addTaskUrl: "https://115.com/web/lixian/?ct=lixian&ac=add_task_url",
    addTaskUrls: "https://115.com/web/lixian/?ct=lixian&ac=add_task_urls",
    getUserUrl: "https://webapi.115.com/offine/downpath",

    addFolderUrl: "https://webapi.115.com/files/add",
    listFilesUrl: "https://webapi.115.com/files",

    enableAutoFolderByTitle: GM_getValue("enableAutoFolderByTitle", true),

    pushExtractUrl: "https://webapi.115.com/files/push_extract",
    extractInfoUrl: "https://webapi.115.com/files/extract_info",
    addExtractFileUrl: "https://webapi.115.com/files/add_extract_file",
    deleteFileUrl: "https://webapi.115.com/rb/delete",

    enableDeleteArchiveAfterExtract: GM_getValue(
      "enableDeleteArchiveAfterExtract",
      false,
    ),

    enableAutoExtractAfterDownload: GM_getValue(
      "enableAutoExtractAfterDownload",
      false,
    ),

    // 推送成功后，延迟多久开始第一次自动解压监控
    autoExtractStartDelaySec:
      Number(GM_getValue("autoExtractStartDelaySec", 10)) || 10,

    // 自动解压监控最多启动几轮
    // 每一轮都会去检查当前标题文件夹里有没有压缩包
    autoExtractStartRetryCount:
      Number(GM_getValue("autoExtractStartRetryCount", 3)) || 3,

    // 每一轮中，等待压缩包出现的检查次数
    autoExtractPollCount: Number(GM_getValue("autoExtractPollCount", 3)) || 3,

    // 每次等待压缩包出现的间隔秒数
    autoExtractPollIntervalSec:
      Number(GM_getValue("autoExtractPollIntervalSec", 20)) || 20,

    // 解压释放进度轮询，保持原来即可
    extractProgressPollCount:
      Number(GM_getValue("extractProgressPollCount", 80)) || 80,

    extractProgressPollIntervalSec:
      Number(GM_getValue("extractProgressPollIntervalSec", 10)) || 10,

    extractPassword: GM_getValue("extractPassword", ""),
  };

  const requireCookieNames = ["UID", "CID", "SEID"];

  const TITLE_CLEAN_CONFIG = {
    defaultRemoveWords: ["【ED2K】", "【自转】", "【自整理】", "压缩包"],
    defaultMaxLength: 80,
  };

  function uniqueArray(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function encodeForm(data) {
    return Object.keys(data)
      .map((key) => {
        const value = data[key] == null ? "" : String(data[key]);
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join("&");
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        onload: (res) => resolve(res),
        onerror: (err) => reject(err),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  async function gmJsonRequest(options) {
    const res = await gmRequest(options);

    try {
      return JSON.parse(res.responseText || res.response || "{}");
    } catch (e) {
      throw new Error("接口返回不是有效 JSON");
    }
  }

  function notify(message) {
    customNotify(message);

    try {
      if (
        typeof GM_notification === "function" &&
        typeof message === "string"
      ) {
        GM_notification({
          title: "115 归档下载",
          text: message,
          timeout: 3000,
        });
      }
    } catch (e) {}
  }

  function decodeHtmlEntities(text) {
    if (!text) return "";

    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getPostTitle() {
    const selectors = [
      "#thread_subject",
      "h1.ts #thread_subject",
      "h1.ts",
      "h1",
      ".thread-title",
      ".post-title",
      ".title",
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);

      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    return (document.title || "未命名任务").trim();
  }

  function sanitizeFolderName(title) {
    return sanitizeFolderNamePreview(
      title,
      GM_getValue("titleRemoveWords", ""),
      GM_getValue("titleMaxLength", TITLE_CLEAN_CONFIG.defaultMaxLength),
    );
  }

  function sanitizeFolderNamePreview(
    title,
    userRemoveWordsText,
    maxLengthValue,
  ) {
    let name = title || "未命名任务";

    try {
      name = name.normalize("NFKC");
    } catch (e) {}

    TITLE_CLEAN_CONFIG.defaultRemoveWords.forEach((word) => {
      name = name.split(word).join("");
    });

    const userRemoveWords = String(userRemoveWordsText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    userRemoveWords.forEach((word) => {
      name = name.split(word).join("");
    });

    name = name.replace(/\d+\s*配额/gi, "");

    try {
      name = name.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "");
    } catch (e) {}

    name = name.replace(/\//g, "");
    name = name.replace(/[\\:*?"<>|]/g, " ");
    name = name.replace(/[~`!@#$%^&+=\[\]{};'"，。！？、…￥（）()《》]/g, " ");
    name = name.replace(/【\s+/g, "【");
    name = name.replace(/\s+】/g, "】");
    name = name.replace(/【\s*】/g, "");
    name = name.replace(/\s+/g, " ").trim();

    const maxLength =
      Number(maxLengthValue) || TITLE_CLEAN_CONFIG.defaultMaxLength;

    if (name.length > maxLength) {
      name = name.slice(0, maxLength).trim();
    }

    return name || "未命名任务";
  }

  function extractLinksFromPage() {
    let rawLinks = [];

    const codeBlocks = document.querySelectorAll(
      '.blockcode [id*="code_"], .blockcode',
    );

    codeBlocks.forEach((code) => {
      const text = code.textContent || "";
      rawLinks = rawLinks.concat(matchLinks(text));
    });

    if (rawLinks.length === 0 && document.body) {
      rawLinks = matchLinks(document.body.innerText || "");
    }

    const normalizedLinks = rawLinks
      .map((link) => normalizeDownloadLink(link))
      .filter(Boolean);

    const uniqueLinks = uniqueArray(normalizedLinks);

    return uniqueLinks.filter((link) => isValidDownloadLink(link));
  }

  function matchLinks(text) {
    if (!text) return [];

    const normalizedText = decodeHtmlEntities(text)
      .replace(/\u200B/g, "")
      .replace(/\u200C/g, "")
      .replace(/\u200D/g, "")
      .replace(/\uFEFF/g, "");

    const links = [];

    const magnetLinks =
      normalizedText.match(/magnet:\?[^\s<>"'，。；、]+/gi) || [];
    links.push(...magnetLinks);

    const ed2kRegex =
      /ed2k:\/\/\|file\|[\s\S]*?\|\/(?=$|\s|[<>"'，。；、\])】）)])/gi;
    const ed2kLinks = normalizedText.match(ed2kRegex) || [];
    links.push(...ed2kLinks);

    return links;
  }

  function normalizeDownloadLink(link) {
    let value = decodeHtmlEntities(String(link || ""));

    value = value
      .replace(/\u200B/g, "")
      .replace(/\u200C/g, "")
      .replace(/\u200D/g, "")
      .replace(/\uFEFF/g, "")
      .trim();

    value = value.replace(/[)\]】》>，。；;、]+$/g, "");

    if (/^magnet:\?/i.test(value)) {
      value = value.replace(/&amp;/gi, "&");
    }

    if (/^ed2k:\/\//i.test(value)) {
      value = value.replace(/\s+/g, "%20");
    }

    return value;
  }

  function isValidDownloadLink(link) {
    if (!link) return false;

    if (/^magnet:\?/i.test(link)) {
      return /[?&]xt=/i.test(link);
    }

    if (/^ed2k:\/\//i.test(link)) {
      return /^ed2k:\/\/\|file\|.+\|\d+\|[a-f0-9]{32}\|\/$/i.test(link);
    }

    return false;
  }

  async function get115UserID() {
    const cachedUserID = GM_getValue("X_userID", "");

    if (cachedUserID) return cachedUserID;

    const resData = await gmJsonRequest({
      method: "GET",
      url: config.getUserUrl,
    });

    if (!resData.state) {
      throw new Error("获取 115 用户信息失败，请确认已经登录 115");
    }

    const userID =
      resData.data && resData.data[0] ? resData.data[0].user_id : "";

    if (!userID) {
      throw new Error("获取 115 用户信息失败：未找到 user_id");
    }

    GM_setValue("X_userID", userID);
    return userID;
  }

  async function get115SignData(timeout) {
    const res = await gmRequest({
      method: "GET",
      url: config.signUrl + timeout,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://115.com",
      },
    });

    if ((res.responseText || "").includes("<html")) {
      throw new Error("还没有登录 115，或者登录状态已经失效");
    }

    let signData;

    try {
      signData = JSON.parse(res.responseText || res.response || "{}");
    } catch (e) {
      throw new Error("获取 115 签名失败：返回不是有效 JSON");
    }

    if (!signData.sign) {
      throw new Error("获取 115 签名失败：sign 为空");
    }

    return {
      sign: signData.sign,
      time: signData.time || timeout,
    };
  }

  async function list115Files(cid, limit = 115) {
    const url =
      `${config.listFilesUrl}?aid=1&cid=${encodeURIComponent(cid)}` +
      `&o=user_ptime&asc=0&offset=0&show_dir=1&limit=${limit}` +
      `&natsort=1&record_open_time=1&format=json`;

    const resData = await gmJsonRequest({
      method: "GET",
      url,
    });

    if (!resData.state && !Array.isArray(resData.data)) {
      throw new Error(resData.error || resData.msg || "读取 115 目录失败");
    }

    return Array.isArray(resData.data) ? resData.data : [];
  }

  async function findChildFolder(parentCid, folderName) {
    const files = await list115Files(parentCid, 1150);

    const hit = files.find((item) => {
      const name = item.n || item.name || item.file_name || "";
      const isFolder = item.cid && !item.fid && !item.pc && !item.sha;

      return isFolder && String(name) === String(folderName);
    });

    return hit ? String(hit.cid) : "";
  }

  async function create115Folder(parentCid, folderName) {
    parentCid = String(parentCid || "").trim();
    folderName = String(folderName || "").trim();

    if (!parentCid) {
      throw new Error("父目录 ID 为空，请检查设置");
    }

    if (!folderName) {
      throw new Error("标题文件夹名称为空");
    }

    const existsCid = await findChildFolder(parentCid, folderName);

    if (existsCid) {
      return existsCid;
    }

    const body = encodeForm({
      pid: parentCid,
      cname: folderName,
    });

    const resData = await gmJsonRequest({
      method: "POST",
      url: config.addFolderUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://115.com",
      },
      data: body,
    });

    if (!resData.state) {
      const retryCid = await findChildFolder(parentCid, folderName);

      if (retryCid) {
        return retryCid;
      }

      throw new Error(resData.error || resData.msg || "创建标题文件夹失败");
    }

    const cid =
      resData.cid ||
      resData.file_id ||
      resData.id ||
      resData.folder_id ||
      (resData.data &&
        (resData.data.cid ||
          resData.data.file_id ||
          resData.data.id ||
          resData.data.folder_id));

    if (cid) {
      return String(cid);
    }

    const createdCid = await findChildFolder(parentCid, folderName);

    if (createdCid) {
      return createdCid;
    }

    throw new Error(
      "标题文件夹创建成功，但未能获取新目录 ID，已停止提交离线任务",
    );
  }

  async function addWebTorrents(urls, options = {}) {
    if (!config.webDownloadFolderId) {
      throw new Error("请先设置 115 父目录 ID");
    }

    if (!urls || urls.length === 0) {
      throw new Error("没有可提交的有效链接");
    }

    const parentFolderId = String(config.webDownloadFolderId).trim();
    const folderName = String(options.folderName || "").trim();

    const timeout = Date.now();
    const userID = await get115UserID();
    const signData = await get115SignData(timeout);

    let targetFolderId = parentFolderId;
    let targetFolderName = "";

    if (config.enableAutoFolderByTitle) {
      if (!folderName) {
        throw new Error("清洗后的标题为空，无法创建标题文件夹");
      }

      targetFolderName = folderName;
      targetFolderId = await create115Folder(parentFolderId, targetFolderName);

      if (!targetFolderId || targetFolderId === parentFolderId) {
        throw new Error(
          `标题文件夹 cid 异常，已停止提交任务。parentFolderId=${parentFolderId}, targetFolderId=${targetFolderId}`,
        );
      }
    }

    const isSingle = urls.length === 1;

    const encodedUrls = isSingle
      ? `url=${encodeURIComponent(urls[0])}`
      : urls
          .map((url, index) => `url[${index}]=${encodeURIComponent(url)}`)
          .join("&");

    const baseParams = encodeForm({
      uid: userID,
      sign: signData.sign,
      time: signData.time,
      wp_path_id: targetFolderId,
      savepath: "",
    });

    const body = `${baseParams}&${encodedUrls}`;

    const resData = await gmJsonRequest({
      method: "POST",
      url: isSingle ? config.addTaskUrl : config.addTaskUrls,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://115.com",
      },
      data: body,
    });

    if (isSingle) {
      if (resData.state === false) {
        throw new Error(
          `${resData.error_msg || resData.error || "添加离线任务失败"}；链接：${urls[0]}`,
        );
      }

      scheduleAutoExtractMonitor(
        targetFolderId,
        targetFolderName || "指定目录",
      );

      return targetFolderName
        ? `添加成功：${targetFolderName}，已启动自动解压监控`
        : "添加成功：指定目录，已启动自动解压监控";
    }

    const result = Array.isArray(resData.result) ? resData.result : [];

    if (!result.length && resData.state === false) {
      throw new Error(
        resData.error_msg || resData.error || "批量添加离线任务失败",
      );
    }

    const messages = result.map((item, index) => {
      if (item.state === true) {
        return targetFolderName
          ? `链接 ${index + 1}：添加成功 → ${targetFolderName}`
          : `链接 ${index + 1}：添加成功`;
      }

      return `链接 ${index + 1}：添加失败：${item.error_msg || item.error || "未知错误"}`;
    });

    scheduleAutoExtractMonitor(targetFolderId, targetFolderName || "指定目录");

    return messages.length
      ? messages
      : `批量添加完成：${targetFolderName || "指定目录"}`;
  }

  async function addBotTorrents(urls) {
    if (!/^(http|https):\/\/.+(\/)?$/i.test(config.botDownloadUrl)) {
      throw new Error("Bot 下载地址格式不正确");
    }

    const url =
      (config.botDownloadUrl.endsWith("/")
        ? config.botDownloadUrl
        : config.botDownloadUrl + "/") + "ghs/addTaskUrls";

    const formData = new FormData();
    formData.append("urls", JSON.stringify(urls));

    const res = await gmRequest({
      method: "POST",
      url,
      data: formData,
    });

    if (res.status !== 200) {
      throw new Error("请检查 Bot 下载地址是否正确");
    }

    const text = res.responseText || "";

    if (text.includes("成功")) return "添加" + text;

    try {
      const json = JSON.parse(text);

      if (json.success || json.state) {
        return json.message || "Bot 添加成功";
      }

      throw new Error(json.message || json.error || text);
    } catch (e) {
      throw new Error(text || "Bot 添加失败");
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function get115ItemName(item) {
    return item.n || item.name || item.file_name || "";
  }

  function get115PickCode(item) {
    return item.pc || item.pick_code || item.pickcode || "";
  }

  function get115FileId(item) {
    return item.fid || item.file_id || item.id || "";
  }

  function isArchiveFileItem(item) {
    const name = get115ItemName(item);
    const pickCode = get115PickCode(item);

    if (!name) return false;

    const isArchive =
      /\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(name) ||
      /\.part0*1\.rar$/i.test(name) ||
      /\.001$/i.test(name);

    if (!isArchive) return false;

    if (!pickCode) {
      extractStatus("发现疑似压缩包，但没有识别到 pick_code", {
        name,
        rawItem: item,
      });
      return false;
    }

    return true;
  }

  function isExtractInfoDir(item) {
    return Number(item.size || 0) === 0 && !item.ico;
  }

  function getExtractEntryName(item) {
    return item.file_name || item.name || item.n || "";
  }

  async function tryStartArchiveParse(pickCode) {
    try {
      const body = encodeForm({
        pick_code: pickCode,
        secret: config.extractPassword || "",
      });

      await gmJsonRequest({
        method: "POST",
        url: config.pushExtractUrl,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://115.com",
          Referer: "https://115.com/",
        },
        data: body,
      });
    } catch (e) {}
  }

  async function waitArchiveParsed(pickCode) {
    extractStatus("开始解析压缩包");

    await tryStartArchiveParse(pickCode);

    const maxCount = config.extractProgressPollCount;
    const intervalMs = config.extractProgressPollIntervalSec * 1000;

    for (let i = 0; i < maxCount; i++) {
      const url = `${config.pushExtractUrl}?pick_code=${encodeURIComponent(pickCode)}`;

      const resData = await gmJsonRequest({
        method: "GET",
        url,
        headers: {
          Accept: "*/*",
          Referer: "https://115.com/",
        },
      });

      if (!resData.state) {
        throw new Error(
          resData.message || resData.error || "压缩包解析状态查询失败",
        );
      }

      const status = resData.data && resData.data.extract_status;
      const unzipStatus = status ? Number(status.unzip_status) : 0;
      const progress = status ? Number(status.progress || 0) : 0;

      extractStatus(`压缩包解析进度：${progress}%`);
      notify(`压缩包解析中：${progress}%`);

      if (unzipStatus === 4 && progress >= 100) {
        extractStatus("压缩包解析完成");
        return true;
      }

      await sleep(intervalMs);
    }

    throw new Error("压缩包解析超时");
  }

  async function getArchiveRootEntries(pickCode) {
    const url =
      `${config.extractInfoUrl}?pick_code=${encodeURIComponent(pickCode)}` +
      `&file_name=&paths=${encodeURIComponent("文件")}` +
      `&page_count=999`;

    extractStatus("读取压缩包根目录", {
      url,
    });

    const resData = await gmJsonRequest({
      method: "GET",
      url,
      headers: {
        Accept: "*/*",
        Referer: "https://115.com/",
      },
    });

    const listCount =
      resData.data && Array.isArray(resData.data.list)
        ? resData.data.list.length
        : 0;

    extractStatus(`读取压缩包内容：${listCount} 项`, resData);

    if (!resData.state) {
      throw new Error(resData.message || resData.error || "读取压缩包内容失败");
    }

    const list =
      resData.data && Array.isArray(resData.data.list) ? resData.data.list : [];

    if (!list.length) {
      throw new Error("压缩包内容为空，或无法读取压缩包根目录");
    }

    return list;
  }

  function buildExtractBody(pickCode, targetFolderId, entries) {
    const params = {
      pick_code: pickCode,
      to_pid: targetFolderId,
      paths: "文件",
    };

    const extractDirs = [];
    const extractFiles = [];

    entries.forEach((item) => {
      const name = getExtractEntryName(item);
      if (!name) return;

      if (isExtractInfoDir(item)) {
        extractDirs.push(name);
      } else {
        extractFiles.push(name);
      }
    });

    if (!extractDirs.length && !extractFiles.length) {
      throw new Error("未找到可解压的文件或目录");
    }

    if (extractDirs.length) {
      params["extract_dir[]"] = extractDirs;
    }

    if (extractFiles.length) {
      params["extract_file[]"] = extractFiles;
    }

    return encodeFormWithArray(params);
  }

  function encodeFormWithArray(data) {
    const parts = [];

    Object.keys(data).forEach((key) => {
      const value = data[key];

      if (Array.isArray(value)) {
        value.forEach((item) => {
          parts.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(item == null ? "" : String(item))}`,
          );
        });
      } else {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(value == null ? "" : String(value))}`,
        );
      }
    });

    return parts.join("&");
  }

  async function delete115File(parentCid, fileItem) {
    const name = get115ItemName(fileItem);
    const fid = get115FileId(fileItem);

    if (!fid) {
      throw new Error(`无法删除压缩包，缺少 fid：${name}`);
    }

    const body = encodeFormWithArray({
      pid: parentCid,
      ignore_warn: 1,
      "fid[0]": fid,
    });

    extractStatus(`准备删除原压缩包：${name}`);

    const resData = await gmJsonRequest({
      method: "POST",
      url: config.deleteFileUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://115.com",
        Referer: "https://115.com/",
      },
      data: body,
    });

    if (!resData.state) {
      throw new Error(
        resData.error || resData.message || `删除原压缩包失败：${name}`,
      );
    }

    extractStatus(`已删除原压缩包：${name}`);
    notify(`已删除原压缩包：${name}`);

    return true;
  }

  async function submitExtractTask(pickCode, targetFolderId, entries) {
    const body = buildExtractBody(pickCode, targetFolderId, entries);

    extractStatus(`提交解压任务：${entries.length} 项`);

    const resData = await gmJsonRequest({
      method: "POST",
      url: config.addExtractFileUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        Referer: "https://115.com/",
      },
      data: body,
    });

    extractStatus("add_extract_file POST 返回", resData);

    if (!resData.state) {
      throw new Error(resData.message || resData.error || "提交解压任务失败");
    }

    const extractId = resData.data && resData.data.extract_id;

    if (!extractId) {
      throw new Error("提交解压任务成功，但没有返回 extract_id");
    }

    return String(extractId);
  }

  async function waitExtractDone(extractId) {
    const maxCount = config.extractProgressPollCount;
    const intervalMs = config.extractProgressPollIntervalSec * 1000;

    extractStatus("开始查询解压释放进度");

    for (let i = 0; i < maxCount; i++) {
      const url = `${config.addExtractFileUrl}?extract_id=${encodeURIComponent(extractId)}`;

      const resData = await gmJsonRequest({
        method: "GET",
        url,
        headers: {
          Accept: "*/*",
          Referer: "https://115.com/",
        },
      });

      if (!resData.state) {
        throw new Error(resData.message || resData.error || "查询解压进度失败");
      }

      const percent = Number((resData.data && resData.data.percent) || 0);

      extractStatus(`解压进度：${percent}%`);
      notify(`正在解压：${percent}%`);

      if (percent >= 100) {
        extractStatus("解压释放完成");
        return true;
      }

      await sleep(intervalMs);
    }

    throw new Error("解压进度等待超时");
  }

  async function extractArchiveToCurrentFolder(archiveItem, targetFolderId) {
    const name = get115ItemName(archiveItem);
    const pickCode = get115PickCode(archiveItem);

    if (!pickCode) {
      throw new Error(`压缩包缺少 pick_code：${name}`);
    }

    notify(`准备解压：${name}`);

    await waitArchiveParsed(pickCode);

    const entries = await getArchiveRootEntries(pickCode);

    const extractId = await submitExtractTask(
      pickCode,
      targetFolderId,
      entries,
    );

    await waitExtractDone(extractId);

    notify(`解压完成：${name}`);
    extractStatus(`解压完成：${name}`);

    if (config.enableDeleteArchiveAfterExtract) {
      try {
        await delete115File(targetFolderId, archiveItem);
      } catch (e) {
        extractStatus(`删除原压缩包失败：${name}，${e.message || e}`);
        notify(`删除原压缩包失败：${name}\n${e.message || e}`);
      }
    }

    return true;
  }

  async function waitArchivesInFolder(folderCid) {
    const maxCount = Number(config.autoExtractPollCount) || 3;
    const intervalMs = (Number(config.autoExtractPollIntervalSec) || 20) * 1000;

    for (let i = 0; i < maxCount; i++) {
      extractStatus(`检查压缩包：第 ${i + 1}/${maxCount} 次`);

      const files = await list115Files(folderCid, 1150);
      const archives = files.filter(isArchiveFileItem);

      if (archives.length > 0) {
        extractStatus(`发现 ${archives.length} 个压缩包`);
        return archives;
      }

      if (i < maxCount - 1) {
        extractStatus(
          `暂未发现压缩包，${Math.round(intervalMs / 1000)} 秒后继续`,
        );
        await sleep(intervalMs);
      }
    }

    return [];
  }

  function scheduleAutoExtractMonitor(folderCid, folderName) {
    if (!config.enableAutoExtractAfterDownload || !folderCid) return;

    const delaySec = Number(config.autoExtractStartDelaySec) || 10;
    const retryCount = Number(config.autoExtractStartRetryCount) || 3;

    extractStatus(`自动解压已准备：${folderName || folderCid}`);
    extractStatus(`${delaySec} 秒后开始检查压缩包，最多启动 ${retryCount} 轮`);

    let currentRound = 0;

    const run = () => {
      currentRound += 1;

      extractStatus(`开始第 ${currentRound}/${retryCount} 轮自动解压检查`);

      autoExtractArchivesInFolder(folderCid, folderName || "指定目录")
        .then((foundAndHandled) => {
          if (foundAndHandled) {
            extractStatus("自动解压流程完成");
            return;
          }

          if (currentRound < retryCount) {
            extractStatus(`本轮未发现压缩包，${delaySec} 秒后重试`);
            setTimeout(run, delaySec * 1000);
          } else {
            extractStatus("未发现可解压压缩包，自动解压监控结束");
          }
        })
        .catch((e) => {
          extractStatus(`自动解压失败：${e.message || e}`);
          notify("自动解压失败：" + (e.message || e));
        });
    };

    setTimeout(run, delaySec * 1000);
  }

  async function autoExtractArchivesInFolder(folderCid, folderName) {
    extractStatus(`检查目录：${folderName || folderCid}`);

    const archives = await waitArchivesInFolder(folderCid);

    if (!archives.length) {
      return false;
    }

    extractStatus(`进入解压队列：${archives.length} 个压缩包`);

    for (let i = 0; i < archives.length; i++) {
      const archive = archives[i];
      const name = get115ItemName(archive);

      try {
        extractStatus(
          `解压 ${i + 1}/${archives.length}：${name}${config.enableDeleteArchiveAfterExtract ? "，完成后将删除原压缩包" : ""}`,
        );
        await extractArchiveToCurrentFolder(archive, folderCid);
        extractStatus(`解压完成：${name}`);
      } catch (e) {
        extractStatus(`解压失败：${name}，${e.message || e}`);
      }
    }

    return true;
  }

  function injectTm115Styles() {
    if (document.getElementById("tm115_ui_styles")) return;

    const style = document.createElement("style");
    style.id = "tm115_ui_styles";
    style.textContent = `
      #tm115_float_entry {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 999999;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        color: #fff;
        font-size: 15px;
        font-weight: 800;
        background: linear-gradient(135deg, #e83d3d, #a51616);
        box-shadow: 0 12px 28px rgba(180, 20, 20, .35);
        transition: transform .18s ease, box-shadow .18s ease;
      }

      #tm115_float_entry:hover {
        transform: translateY(-2px) scale(1.04);
        box-shadow: 0 16px 34px rgba(180, 20, 20, .45);
      }

      .tm115-card {
        margin: 12px 0;
        padding: 14px;
        border: 1px solid rgba(212, 47, 47, .22);
        border-radius: 12px;
        background: linear-gradient(180deg, #fffafa, #fff);
        box-shadow: 0 8px 22px rgba(0,0,0,.06);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
        color: #333;
      }

      .tm115-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        font-size: 15px;
        font-weight: 800;
        color: #b91c1c;
      }

      .tm115-pill {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 999px;
        background: #fee2e2;
        color: #991b1b;
        font-size: 12px;
        font-weight: 700;
      }

      .tm115-preview-box {
        padding: 10px 12px;
        border-radius: 10px;
        background: #fff;
        border: 1px dashed rgba(212,47,47,.28);
        line-height: 1.7;
        word-break: break-all;
      }

      .tm115-preview-label {
        color: #777;
        font-size: 12px;
        margin-right: 6px;
      }

      .tm115-preview-path {
        color: #c01818;
        font-weight: 800;
      }

      .tm115-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .tm115-btn {
        border: none;
        border-radius: 9px;
        padding: 8px 13px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 800;
        color: #fff;
        background: linear-gradient(135deg, #d42f2f, #a51d1d);
        box-shadow: 0 6px 14px rgba(212,47,47,.2);
        transition: transform .14s ease, opacity .14s ease, box-shadow .14s ease;
      }

      .tm115-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px rgba(212,47,47,.28);
      }

      .tm115-btn.secondary {
        background: linear-gradient(135deg, #555, #222);
        box-shadow: 0 6px 14px rgba(0,0,0,.15);
      }

      .tm115-btn.ghost {
        color: #b91c1c;
        background: #fff;
        border: 1px solid rgba(212,47,47,.28);
        box-shadow: none;
      }

      .tm115-btn:disabled {
        opacity: .45;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      #tm115_modal_mask {
        position: fixed;
        inset: 0;
        z-index: 999998;
        background: rgba(0,0,0,.38);
        backdrop-filter: blur(3px);
        display: none;
      }

      #tm115_modal {
        position: fixed;
        right: 24px;
        bottom: 94px;
        z-index: 999999;
        width: min(520px, calc(100vw - 32px));
        max-height: calc(100vh - 130px);
        overflow: auto;
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 22px 60px rgba(0,0,0,.26);
        display: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
        color: #222;
      }

      .tm115-modal-header {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px;
        background: linear-gradient(135deg, #d42f2f, #7f1111);
        color: #fff;
        border-radius: 18px 18px 0 0;
      }

      .tm115-modal-title {
        font-size: 16px;
        font-weight: 900;
      }

      .tm115-modal-close {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        background: rgba(255,255,255,.18);
        color: #fff;
        font-size: 20px;
        line-height: 30px;
      }

      .tm115-modal-body {
        padding: 16px 18px 18px;
      }

      .tm115-field {
        margin-bottom: 14px;
      }

      .tm115-field label {
        display: block;
        margin-bottom: 6px;
        font-weight: 800;
        font-size: 13px;
        color: #333;
      }

      .tm115-help {
        margin-top: 5px;
        font-size: 12px;
        color: #777;
        line-height: 1.5;
      }

      .tm115-input,
      .tm115-textarea {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 10px 11px;
        outline: none;
        font-size: 13px;
        transition: border-color .15s ease, box-shadow .15s ease;
      }

      .tm115-textarea {
        min-height: 92px;
        resize: vertical;
        line-height: 1.55;
      }

      .tm115-input:focus,
      .tm115-textarea:focus {
        border-color: #d42f2f;
        box-shadow: 0 0 0 3px rgba(212,47,47,.12);
      }

      .tm115-switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid #eee;
        border-radius: 12px;
        background: #fafafa;
        margin-bottom: 14px;
      }

      .tm115-switch-row strong {
        display: block;
        font-size: 13px;
        margin-bottom: 2px;
      }

      .tm115-switch-row span {
        font-size: 12px;
        color: #777;
      }

      .tm115-switch {
        width: 46px;
        height: 26px;
        position: relative;
        flex: 0 0 auto;
      }

      .tm115-switch input {
        display: none;
      }

      .tm115-slider {
        position: absolute;
        inset: 0;
        cursor: pointer;
        background: #ccc;
        border-radius: 999px;
        transition: .18s;
      }

      .tm115-slider:before {
        content: "";
        position: absolute;
        width: 20px;
        height: 20px;
        left: 3px;
        top: 3px;
        border-radius: 50%;
        background: #fff;
        transition: .18s;
        box-shadow: 0 2px 5px rgba(0,0,0,.22);
      }

      .tm115-switch input:checked + .tm115-slider {
        background: #d42f2f;
      }

      .tm115-switch input:checked + .tm115-slider:before {
        transform: translateX(20px);
      }

      .tm115-modal-footer {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding-top: 4px;
      }

      .tm115-live-preview {
        padding: 10px 12px;
        border-radius: 12px;
        background: #fff7f7;
        border: 1px solid #fee2e2;
        font-size: 13px;
        line-height: 1.7;
        word-break: break-all;
        margin-bottom: 14px;
      }

      .tm115-notice {
        position: fixed;
        z-index: 1000000;
        left: 50%;
        top: 112px;
        transform: translateX(-50%);
        display: none;
        max-width: 760px;
        min-width: 260px;
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(30,30,30,.92);
        color: #fff;
        box-shadow: 0 12px 34px rgba(0,0,0,.28);
        font-size: 14px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
      }
    `;

    document.head.appendChild(style);
  }

  function findLinksAndCreateButtons() {
    const links = extractLinksFromPage();

    if (!links.length) return;

    createSettingButton();
    createDownloadButtons(links);
  }

  function createDownloadButtons(links) {
    if (document.getElementById("tm115_download_buttons")) return;

    const blockcode = document.querySelector(".blockcode");
    if (!blockcode) return;

    const rawTitle = getPostTitle();
    const cleanTitle = sanitizeFolderName(rawTitle);

    const container = document.createElement("div");
    container.id = "tm115_download_buttons";
    container.className = "tm115-card";

    container.innerHTML = `
      <div class="tm115-card-title">
        <span>115 归档下载</span>
        <span class="tm115-pill">${links.length} 个有效链接</span>
      </div>

      <div class="tm115-preview-box">
        <div>
          <span class="tm115-preview-label">原始标题</span>
          ${escapeHtml(rawTitle)}
        </div>
        <div>
          <span class="tm115-preview-label">保存目录</span>
          <span class="tm115-preview-path">${escapeHtml(cleanTitle)}</span>
        </div>
        <div>
          <span class="tm115-preview-label">父目录 ID</span>
          ${escapeHtml(config.webDownloadFolderId || "未设置")}
        </div>
      </div>

      <div class="tm115-actions" id="tm115_action_area"></div>
    `;

    const actionArea = container.querySelector("#tm115_action_area");

    if (config.webDownloadFolderId) {
      const webButton = createStyledButton("Web 下载到标题文件夹");
      webButton.addEventListener("click", () =>
        handleLinks(links, addWebTorrents),
      );
      actionArea.appendChild(webButton);
    } else {
      const setButton = createStyledButton("先设置 115 父目录");
      setButton.addEventListener("click", openSettingsPanel);
      actionArea.appendChild(setButton);
    }

    if (config.botDownloadUrl) {
      const botButton = createStyledButton("Bot 下载", "secondary");
      botButton.addEventListener("click", () =>
        handleLinks(links, addBotTorrents),
      );
      actionArea.appendChild(botButton);
    }

    const copyTitleButton = createStyledButton("复制清洗后标题", "ghost");
    copyTitleButton.addEventListener("click", () => {
      GM_setClipboard(cleanTitle);
      notify("已复制清洗后标题");
    });
    actionArea.appendChild(copyTitleButton);

    const copyLinksButton = createStyledButton("复制有效链接", "ghost");
    copyLinksButton.addEventListener("click", () => {
      GM_setClipboard(links.join("\n"));
      notify(`已复制 ${links.length} 个有效链接`);
    });
    actionArea.appendChild(copyLinksButton);

    const settingsButton = createStyledButton("打开设置", "ghost");
    settingsButton.addEventListener("click", openSettingsPanel);
    actionArea.appendChild(settingsButton);

    blockcode.parentNode.insertBefore(container, blockcode);
  }

  function createStyledButton(text, type = "primary") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.className = "tm115-btn";

    if (type === "secondary") {
      button.classList.add("secondary");
    }

    if (type === "ghost") {
      button.classList.add("ghost");
    }

    return button;
  }

  function createSettingButton() {
    injectTm115Styles();

    if (document.getElementById("tm115_float_entry")) return;

    const button = document.createElement("button");
    button.id = "tm115_float_entry";
    button.type = "button";
    button.textContent = "115";
    button.title = "打开 115 归档下载设置";
    button.addEventListener("click", openSettingsPanel);

    document.body.appendChild(button);

    renderSettingsPanel();
  }

  function renderSettingsPanel() {
    if (document.getElementById("tm115_modal")) return;

    const mask = document.createElement("div");
    mask.id = "tm115_modal_mask";
    mask.addEventListener("click", closeSettingsPanel);

    const modal = document.createElement("div");
    modal.id = "tm115_modal";

    const rawTitle = getPostTitle();
    const cleanTitle = sanitizeFolderName(rawTitle);
    const links = extractLinksFromPage();

    modal.innerHTML = `
      <div class="tm115-modal-header">
        <div>
          <div class="tm115-modal-title">115 归档下载设置</div>
          <div style="font-size:12px;opacity:.82;margin-top:3px;">标题清洗 / 目录归档 / 链接预览</div>
        </div>
        <button type="button" class="tm115-modal-close" id="tm115_modal_close">×</button>
      </div>

      <div class="tm115-modal-body">
        <div class="tm115-live-preview">
          <div><strong>当前标题：</strong>${escapeHtml(rawTitle)}</div>
          <div><strong>清洗结果：</strong><span id="tm115_preview_title">${escapeHtml(cleanTitle)}</span></div>
          <div><strong>有效链接：</strong>${links.length} 个</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_parent_cid">115 父目录 ID</label>
          <input id="tm115_parent_cid" class="tm115-input" value="${escapeHtml(GM_getValue("webDownloadFolderId", ""))}" placeholder="例如：2346520497446977052">
          <div class="tm115-help">脚本会在这个目录下创建“清洗后的标题文件夹”，然后把资源推送进去。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_bot_url">Bot 下载地址</label>
          <input id="tm115_bot_url" class="tm115-input" value="${escapeHtml(GM_getValue("botDownloadUrl", ""))}" placeholder="http(s)://">
          <div class="tm115-help">可选。留空则不显示 Bot 下载按钮。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_remove_words">标题删除词</label>
          <textarea id="tm115_remove_words" class="tm115-textarea" placeholder="一行一个，例如：广告词">${escapeHtml(GM_getValue("titleRemoveWords", ""))}</textarea>
          <div class="tm115-help">
            默认已内置删除：${TITLE_CLEAN_CONFIG.defaultRemoveWords.join("、")}、数字+配额、emoji、非法文件名符号。默认保留中文【】。
          </div>
        </div>

        <div class="tm115-field">
          <label for="tm115_title_max_length">标题最大长度</label>
          <input id="tm115_title_max_length" class="tm115-input" type="number" min="10" max="200" value="${escapeHtml(String(GM_getValue("titleMaxLength", 80)))}">
        </div>

        <div class="tm115-switch-row">
          <div>
            <strong>按标题创建子目录</strong>
            <span>开启后保存到：父目录 / 清洗后标题 / 文件</span>
          </div>
          <label class="tm115-switch">
            <input id="tm115_auto_folder" type="checkbox" ${GM_getValue("enableAutoFolderByTitle", true) ? "checked" : ""}>
            <span class="tm115-slider"></span>
          </label>
        </div>

        <div class="tm115-switch-row">
          <div>
            <strong>推送后自动解压</strong>
            <span>发现当前标题目录下的 zip / rar / 7z 后，自动解压到当前目录</span>
          </div>
          <label class="tm115-switch">
            <input id="tm115_auto_extract" type="checkbox" ${GM_getValue("enableAutoExtractAfterDownload", false) ? "checked" : ""}>
            <span class="tm115-slider"></span>
          </label>
        </div>

        <div class="tm115-switch-row">
          <div>
            <strong>解压后删除原压缩包</strong>
            <span>仅在解压进度达到 100% 后删除原 zip / rar / 7z 文件，默认关闭</span>
          </div>
          <label class="tm115-switch">
            <input id="tm115_delete_archive_after_extract" type="checkbox" ${GM_getValue("enableDeleteArchiveAfterExtract", false) ? "checked" : ""}>
            <span class="tm115-slider"></span>
          </label>
        </div>

        <div class="tm115-field">
          <label for="tm115_extract_start_delay">启动延迟秒数</label>
          <input id="tm115_extract_start_delay" class="tm115-input" type="number" min="1" max="120" value="${escapeHtml(String(GM_getValue("autoExtractStartDelaySec", 10)))}">
          <div class="tm115-help">推送成功后多久开始检查标题目录，默认 10 秒。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_extract_start_retry">启动检查轮数</label>
          <input id="tm115_extract_start_retry" class="tm115-input" type="number" min="1" max="20" value="${escapeHtml(String(GM_getValue("autoExtractStartRetryCount", 3)))}">
          <div class="tm115-help">如果本轮没发现压缩包，最多再启动几轮检查，默认 3 轮。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_extract_poll_count">每轮检查次数</label>
          <input id="tm115_extract_poll_count" class="tm115-input" type="number" min="1" max="50" value="${escapeHtml(String(GM_getValue("autoExtractPollCount", 3)))}">
          <div class="tm115-help">每轮等待压缩包出现的检查次数，默认 3 次。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_extract_poll_interval">每次检查间隔秒数</label>
          <input id="tm115_extract_poll_interval" class="tm115-input" type="number" min="5" max="300" value="${escapeHtml(String(GM_getValue("autoExtractPollIntervalSec", 20)))}">
          <div class="tm115-help">默认 20 秒。太短可能增加 115 请求压力。</div>
        </div>

        <div class="tm115-field">
          <label for="tm115_extract_password">默认解压密码</label>
          <input id="tm115_extract_password" class="tm115-input" value="${escapeHtml(GM_getValue("extractPassword", ""))}" placeholder="没有密码可留空">
          <div class="tm115-help">仅在需要密码的压缩包中尝试使用。第一版不会自动判断密码错误细节。</div>
        </div>

        <div class="tm115-modal-footer">
          <button type="button" class="tm115-btn" id="tm115_save_settings">保存设置</button>
          <button type="button" class="tm115-btn ghost" id="tm115_copy_preview_title">复制清洗标题</button>
          <button type="button" class="tm115-btn ghost" id="tm115_copy_preview_links">复制有效链接</button>
          <button type="button" class="tm115-btn secondary" id="tm115_close_settings">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(mask);
    document.body.appendChild(modal);

    modal
      .querySelector("#tm115_modal_close")
      .addEventListener("click", closeSettingsPanel);

    modal
      .querySelector("#tm115_close_settings")
      .addEventListener("click", closeSettingsPanel);

    modal
      .querySelector("#tm115_save_settings")
      .addEventListener("click", saveSettingsFromPanel);

    modal
      .querySelector("#tm115_copy_preview_title")
      .addEventListener("click", () => {
        const title =
          modal.querySelector("#tm115_preview_title").textContent || "";
        GM_setClipboard(title);
        notify("已复制清洗后标题");
      });

    modal
      .querySelector("#tm115_copy_preview_links")
      .addEventListener("click", () => {
        const currentLinks = extractLinksFromPage();
        GM_setClipboard(currentLinks.join("\n"));
        notify(`已复制 ${currentLinks.length} 个有效链接`);
      });

    ["tm115_remove_words", "tm115_title_max_length"].forEach((id) => {
      const el = modal.querySelector(`#${id}`);

      if (el) {
        el.addEventListener("input", updateSettingsPreview);
      }
    });
  }

  function openSettingsPanel() {
    injectTm115Styles();
    renderSettingsPanel();

    const mask = document.getElementById("tm115_modal_mask");
    const modal = document.getElementById("tm115_modal");

    if (mask) mask.style.display = "block";
    if (modal) modal.style.display = "block";

    updateSettingsPreview();
  }

  function closeSettingsPanel() {
    const mask = document.getElementById("tm115_modal_mask");
    const modal = document.getElementById("tm115_modal");

    if (mask) mask.style.display = "none";
    if (modal) modal.style.display = "none";
  }

  function updateSettingsPreview() {
    const modal = document.getElementById("tm115_modal");
    if (!modal) return;

    const removeWords = modal.querySelector("#tm115_remove_words")?.value || "";
    const maxLength =
      modal.querySelector("#tm115_title_max_length")?.value || 80;
    const previewEl = modal.querySelector("#tm115_preview_title");

    if (previewEl) {
      previewEl.textContent = sanitizeFolderNamePreview(
        getPostTitle(),
        removeWords,
        maxLength,
      );
    }
  }

  function saveSettingsFromPanel() {
    const modal = document.getElementById("tm115_modal");
    if (!modal) return;

    const parentCid =
      modal.querySelector("#tm115_parent_cid")?.value.trim() || "";
    const botUrl = modal.querySelector("#tm115_bot_url")?.value.trim() || "";
    const removeWords = modal.querySelector("#tm115_remove_words")?.value || "";
    const maxLength =
      Number(modal.querySelector("#tm115_title_max_length")?.value) || 80;
    const autoFolder = !!modal.querySelector("#tm115_auto_folder")?.checked;

    const autoExtract = !!modal.querySelector("#tm115_auto_extract")?.checked;
    const deleteArchiveAfterExtract = !!modal.querySelector(
      "#tm115_delete_archive_after_extract",
    )?.checked;
    const extractPassword =
      modal.querySelector("#tm115_extract_password")?.value || "";
    const autoExtractPollCount =
      Number(modal.querySelector("#tm115_extract_poll_count")?.value) || 3;
    const autoExtractStartDelaySec =
      Number(modal.querySelector("#tm115_extract_start_delay")?.value) || 10;
    const autoExtractStartRetryCount =
      Number(modal.querySelector("#tm115_extract_start_retry")?.value) || 3;
    const autoExtractPollIntervalSec =
      Number(modal.querySelector("#tm115_extract_poll_interval")?.value) || 20;

    GM_setValue("webDownloadFolderId", parentCid);
    GM_setValue("botDownloadUrl", botUrl);
    GM_setValue("titleRemoveWords", removeWords);
    GM_setValue("titleMaxLength", maxLength);
    GM_setValue("enableAutoFolderByTitle", autoFolder);
    GM_setValue("enableAutoExtractAfterDownload", autoExtract);
    GM_setValue("enableDeleteArchiveAfterExtract", deleteArchiveAfterExtract);
    GM_setValue("extractPassword", extractPassword);
    GM_setValue("autoExtractStartDelaySec", autoExtractStartDelaySec);
    GM_setValue("autoExtractStartRetryCount", autoExtractStartRetryCount);
    GM_setValue("autoExtractPollCount", autoExtractPollCount);
    GM_setValue("autoExtractPollIntervalSec", autoExtractPollIntervalSec);

    config.webDownloadFolderId = parentCid;
    config.botDownloadUrl = botUrl;
    config.enableAutoFolderByTitle = autoFolder;
    config.enableAutoExtractAfterDownload = autoExtract;
    config.enableDeleteArchiveAfterExtract = deleteArchiveAfterExtract;
    config.extractPassword = extractPassword;
    config.autoExtractStartDelaySec = autoExtractStartDelaySec;
    config.autoExtractStartRetryCount = autoExtractStartRetryCount;
    config.autoExtractPollCount = autoExtractPollCount;
    config.autoExtractPollIntervalSec = autoExtractPollIntervalSec;

    notify("设置已保存，页面即将刷新");
    setTimeout(() => window.location.reload(), 600);
  }

  function ensureExtractStatusPanel() {
    let panel = document.getElementById("tm115_extract_status_panel");

    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "tm115_extract_status_panel";
    panel.style.cssText = `
    position: fixed;
    right: 24px;
    bottom: 92px;
    z-index: 999998;
    width: 420px;
    max-height: 360px;
    overflow: auto;
    background: rgba(20,20,20,.92);
    color: #fff;
    border-radius: 14px;
    box-shadow: 0 18px 46px rgba(0,0,0,.32);
    font-size: 12px;
    line-height: 1.6;
    padding: 12px;
    display: none;
    font-family: Consolas, Monaco, "Microsoft YaHei", monospace;
  `;

    panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <strong style="font-size:13px;">115 自动解压状态</strong>
      <button id="tm115_extract_status_clear" style="
        border:none;
        border-radius:8px;
        padding:3px 8px;
        cursor:pointer;
        background:#d42f2f;
        color:#fff;
        font-size:12px;
      ">清空</button>
    </div>
    <div id="tm115_extract_status_body"></div>
  `;

    document.body.appendChild(panel);

    panel
      .querySelector("#tm115_extract_status_clear")
      .addEventListener("click", () => {
        const body = panel.querySelector("#tm115_extract_status_body");
        if (body) body.innerHTML = "";
      });

    return panel;
  }

  function extractStatus(message, data) {
    const panel = ensureExtractStatusPanel();
    const body = panel.querySelector("#tm115_extract_status_body");

    panel.style.display = "block";

    const time = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.style.cssText = `
    border-top: 1px solid rgba(255,255,255,.12);
    padding: 6px 0;
    word-break: break-all;
    white-space: pre-wrap;
  `;

    line.textContent = `[${time}] ${message}`;
    body.appendChild(line);

    panel.scrollTop = panel.scrollHeight;

    // 面板只展示关键信息，详细数据只留给 Console
    if (data !== undefined) {
      try {
        console.log("[115自动解压详情]", message, data);
      } catch (e) {}
    }
  }

  function customNotify(message) {
    injectTm115Styles();

    let box = document.getElementById("tm115_custom_notice");

    if (!box) {
      box = document.createElement("div");
      box.id = "tm115_custom_notice";
      box.className = "tm115-notice";
      document.body.appendChild(box);
    }

    box.innerHTML = "";

    if (Array.isArray(message)) {
      message.forEach((msg) => {
        const line = document.createElement("div");
        line.textContent = msg;
        box.appendChild(line);
      });
    } else {
      box.textContent = String(message);
    }

    box.style.display = "block";

    clearTimeout(box._tm115Timer);
    box._tm115Timer = setTimeout(() => {
      box.style.display = "none";
    }, 4200);
  }

  function handleLinks(links, addUrlFunction) {
    const rawTitle = getPostTitle();
    const cleanTitle = sanitizeFolderName(rawTitle);

    addUrlFunction(links, {
      rawTitle,
      folderName: cleanTitle,
    })
      .then((res) => customNotify(res))
      .catch((error) => {
        customNotify("添加链接失败：" + (error.message || error));
      });
  }

  function showCookie() {
    GM_cookie.list({ domain: ".115.com" }, function (cookieInfos, error) {
      if (!error) {
        const cookieOutputs = [];

        cookieInfos.forEach(function (cookieInfo) {
          if (requireCookieNames.includes(cookieInfo.name)) {
            cookieOutputs.push(`${cookieInfo.name}=${cookieInfo.value}`);
          }
        });

        alert(
          `Cookie 信息为：\n---------------------------\n${cookieOutputs.join("\n")}\n---------------------------\n内容已复制到剪切板！`,
        );

        GM_setClipboard(`${cookieOutputs.join(";")};`);
      } else {
        alert("获取 cookie 失败，请检查当前 Tampermonkey 是否支持 GM_cookie");
      }
    });
  }

  function initCopyCookieButton() {
    const btnGroupDiv = document.querySelector('div.left-tvf[rel="left_tvf"]');

    if (btnGroupDiv && !document.getElementById("tm115_copy_cookie")) {
      const copyButton = document.createElement("a");
      copyButton.id = "tm115_copy_cookie";
      copyButton.href = "javascript:;";
      copyButton.className = "button btn-line btn-upload";
      copyButton.innerHTML =
        '<i class="icon-operate ifo-copy"></i><span>复制Cookie</span>';
      copyButton.addEventListener("click", showCookie);
      btnGroupDiv.appendChild(copyButton);
    }
  }

  function getRequireFieldFromCookie(requireFields, cookie) {
    const resMap = new Map();

    if (!cookie) return resMap;

    const cookies = cookie.split(";");

    cookies.forEach(function (item) {
      const cookieItem = item.trim();
      if (!cookieItem) return;

      const index = cookieItem.indexOf("=");
      if (index <= 0) return;

      const key = cookieItem.slice(0, index).trim();
      const value = cookieItem.slice(index + 1).trim();

      if (requireFields.includes(key)) {
        resMap.set(key, value);
      }
    });

    return resMap;
  }

  function handleCookieLogin(requireCookieMap, validDuration) {
    requireCookieMap.forEach((value, key) => {
      GM_cookie.delete(
        { name: key, domain: ".115.com", path: "/" },
        function () {
          GM_cookie.set(
            {
              name: key,
              value,
              domain: ".115.com",
              path: "/",
              secure: false,
              httpOnly: false,
              expirationDate:
                Math.floor(Date.now() / 1000) + 60 * 60 * 24 * validDuration,
            },
            function (error) {
              if (error) {
                alert(
                  `设置 Cookie：[${key}] 失败，请检查当前 Tampermonkey 是否支持 GM_cookie`,
                );
              }
            },
          );
        },
      );
    });

    setTimeout(function () {
      location.reload();
    }, 1000);
  }

  function showCookieLoginInputDialog() {
    const inputCookie = prompt("请输入 Cookie：");
    const requireCookieMap = getRequireFieldFromCookie(
      requireCookieNames,
      inputCookie,
    );

    if (requireCookieMap.size !== requireCookieNames.length) {
      alert(
        `输入的 Cookie 需包含 [${requireCookieNames.join(", ")}]，请重新输入！`,
      );
      return;
    }

    const defaultValidDuration = 30;
    const inputValidDuration = prompt(
      "请输入 Cookie 有效天数：",
      defaultValidDuration,
    );
    const validDuration =
      parseInt(inputValidDuration, 10) || defaultValidDuration;

    handleCookieLogin(requireCookieMap, validDuration);
  }

  function initCookieLoginButton() {
    const loginFooter = document.querySelector(
      'div.login-footer[rel="login_footer"]',
    );

    if (loginFooter && !document.getElementById("tm115_cookie_login")) {
      const splitField = document.createElement("i");
      splitField.textContent = "|";

      const loginButton = document.createElement("a");
      loginButton.id = "tm115_cookie_login";
      loginButton.textContent = "使用 Cookie 登录";
      loginButton.href = "javascript:;";
      loginButton.addEventListener("click", showCookieLoginInputDialog);

      loginFooter.insertBefore(splitField, loginFooter.firstElementChild);
      loginFooter.insertBefore(loginButton, loginFooter.firstElementChild);
    }
  }

  function init() {
    injectTm115Styles();
    findLinksAndCreateButtons();
    initCookieLoginButton();
    initCopyCookieButton();
  }

  window.tm115ExtractDebug = {
    list115Files,
    waitArchivesInFolder,
    autoExtractArchivesInFolder,
    extractArchiveToCurrentFolder,
    waitArchiveParsed,
    getArchiveRootEntries,
    submitExtractTask,
    waitExtractDone,
    isArchiveFileItem,
    get115ItemName,
    get115PickCode,
  };

  init();

  const observer = new MutationObserver(() => init());

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
})();
