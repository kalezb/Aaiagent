async function loadLibrary() {
  var grid = $("libGrid");
  if (!grid) return;
  clearLibraryObjectUrls();
  showLibGroupsView();
  grid.innerHTML = '<div class="empty-panel">正在读取图库...</div>';
  try {
    var data = await api("GET", "/media-library");
    state.libraryGroups = data.groups || [];
    grid.innerHTML = state.libraryGroups.length
      ? state.libraryGroups.map(renderLibraryCard).join("")
      : '<div class="empty-panel">还没有图库分组，先点右上角新建一个。</div>';
    bindLibraryCardEvents(grid);
    grid.querySelectorAll("img[data-media-src]").forEach(loadLibraryThumb);
  } catch (e) {
    grid.innerHTML = '<div class="empty-panel">图库读取失败：' + esc(e.message) + "</div>";
  }
}

function showLibGroupsView() {
  $("libGroupsView").hidden = false;
  $("libDetailView").hidden = true;
}

function showLibDetailView() {
  $("libGroupsView").hidden = true;
  $("libDetailView").hidden = false;
}

function bindLibraryCardEvents(scope) {
  scope.querySelectorAll("[data-lib-upload]").forEach(function (button) {
    button.addEventListener("click", function (e) { e.stopPropagation(); chooseLibraryImage(button.dataset.libUpload); });
  });
  scope.querySelectorAll("[data-lib-edit]").forEach(function (button) {
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      var group = state.libraryGroups.find(function (item) { return item.id === button.dataset.libEdit; });
      if (group) openLibraryGroupModal(group);
    });
  });
  scope.querySelectorAll("[data-lib-toggle]").forEach(function (button) {
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleLibGroup(button.dataset.libToggle, button.dataset.libNext === "1");
    });
  });
  scope.querySelectorAll("[data-lib-enter]").forEach(function (card) {
    card.addEventListener("click", function () { openGroupDetail(card.dataset.libEnter); });
  });
  scope.querySelectorAll("[data-lib-enter-btn]").forEach(function (btn) {
    btn.addEventListener("click", function (e) { e.stopPropagation(); openGroupDetail(btn.dataset.libEnterBtn); });
  });
  scope.querySelectorAll("[data-media-delete]").forEach(function (button) {
    button.addEventListener("click", function (e) { e.stopPropagation(); deleteLibraryAsset(button.dataset.mediaDelete); });
  });
  scope.querySelectorAll("[data-media-preview]").forEach(function (target) {
    target.addEventListener("click", function (e) {
      e.stopPropagation();
      openMediaPreview(target.dataset.mediaPreview, target.dataset.mediaTitle || target.alt);
    });
  });
}

async function openGroupDetail(groupId) {
  showLibDetailView();
  var grid = $("libDetailGrid");
  grid.innerHTML = '<div class="empty-panel">正在读取图片...</div>';
  try {
    var data = await api("GET", "/media-library/groups/" + encodeURIComponent(groupId) + "/assets");
    state.currentGroup = data.group;
    state.currentGroupAssets = data.assets || [];
    $("libDetailName").textContent = data.group.name;
    $("libDetailMeta").textContent = (data.assets || []).length + " 张图片";
    $("libDetailUploadButton").onclick = function () { chooseLibraryImage(groupId); };
    renderGroupDetailGrid();
  } catch (e) {
    grid.innerHTML = '<div class="empty-panel">读取失败：' + esc(e.message) + "</div>";
  }
}

function renderGroupDetailGrid() {
  var grid = $("libDetailGrid");
  var assets = state.currentGroupAssets || [];
  var groups = state.libraryGroups || [];
  if (!assets.length) {
    grid.innerHTML = '<div class="empty-panel">这个分组还没有图片，点右上角上传。</div>';
    return;
  }
  grid.innerHTML = assets.map(function (asset) {
    var groupOptions = groups.filter(function (g) { return g.id !== state.currentGroup.id; })
      .map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>"; }).join("");
    return '<div class="lib-detail-item">'
      + '<div class="lib-detail-img" data-media-preview="' + esc(asset.view_url) + '" data-media-title="' + esc(asset.file_name) + '">'
      + '<img data-media-src="' + esc(asset.view_url) + '" alt="' + esc(asset.file_name) + '" loading="lazy">'
      + "</div>"
      + '<div class="lib-detail-info">'
      + '<div class="lib-detail-name" title="' + esc(asset.file_name) + '">' + esc(asset.file_name) + "</div>"
      + '<div class="lib-detail-actions">'
      + '<button class="ghost-button small-button" data-media-preview="' + esc(asset.view_url) + '" data-media-title="' + esc(asset.file_name) + '">看大图</button>'
      + '<button class="ghost-button small-button danger-text" data-media-delete="' + esc(asset.id) + '">删除</button>'
      + "</div>"
      + '<div class="lib-detail-copy">'
      + '<select class="lib-copy-select" data-copy-asset="' + esc(asset.id) + '">'
      + '<option value="">复制到分组…</option>' + groupOptions
      + "</select>"
      + "</div>"
      + "</div></div>";
  }).join("");
  grid.querySelectorAll("img[data-media-src]").forEach(loadLibraryThumb);
  grid.querySelectorAll("[data-media-delete]").forEach(function (button) {
    button.addEventListener("click", function () { deleteLibraryAsset(button.dataset.mediaDelete); });
  });
  grid.querySelectorAll("[data-media-preview]").forEach(function (el) {
    el.addEventListener("click", function () { openMediaPreview(el.dataset.mediaPreview, el.dataset.mediaTitle); });
  });
  grid.querySelectorAll("[data-copy-asset]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      if (!sel.value) return;
      copyAssetToGroup(sel.dataset.copyAsset, sel.value);
    });
  });
}

async function copyAssetToGroup(assetId, targetGroupId) {
  try {
    await api("POST", "/media-library/copy-asset", { asset_id: assetId, target_group_id: targetGroupId });
    showToast("已复制到目标分组");
  } catch (e) {
    showToast("复制失败：" + e.message, "error");
  }
}

async function toggleLibGroup(id, on) {
  await api("PUT", "/media-library", { id: id, is_active: on });
  showToast(on ? "这组图打开了" : "这组图关掉了");
  await loadLibrary();
}

function renderLibraryCard(group) {
  var samples = group.samples || [];
  var total = Number(group.asset_count || 0);
  var first = samples[0];
  var thumb = first
    ? '<div class="lib-row-thumb"><img data-media-src="' + esc(first.view_url) + '" alt="" loading="lazy"></div>'
    : '<div class="lib-row-thumb lib-row-thumb-empty">无图</div>';
  return '<div class="lib-row" data-lib-enter="' + esc(group.id) + '">'
    + thumb
    + '<div class="lib-row-main">'
    + '<div class="lib-row-title"><b>' + esc(group.name || "未命名分组") + '</b>'
    + '<span class="status-chip ' + (group.is_active ? "on" : "") + '">' + (group.is_active ? "使用中" : "已关闭") + "</span></div>"
    + '<div class="lib-row-desc">' + total + " 张图 · " + esc(keywordText(group.trigger_keywords)) + "</div>"
    + "</div>"
    + '<div class="lib-row-actions">'
    + '<button class="ghost-button small-button" data-lib-upload="' + esc(group.id) + '">上传</button>'
    + '<button class="ghost-button small-button" data-lib-edit="' + esc(group.id) + '">编辑</button>'
    + '<button class="ghost-button small-button" data-lib-toggle="' + esc(group.id) + '" data-lib-next="' + (group.is_active ? "0" : "1") + '">' + (group.is_active ? "停用" : "启用") + "</button>"
    + '<button class="primary-button small-button" data-lib-enter-btn="' + esc(group.id) + '">查看图片</button>'
    + "</div></div>";
}

async function loadLibraryThumb(image) {
  try {
    var blob = await apiBlob(image.dataset.mediaSrc);
    var objectUrl = URL.createObjectURL(blob);
    state.libraryObjectUrls.push(objectUrl);
    image.src = objectUrl;
  } catch (error) {
    image.replaceWith(Object.assign(document.createElement("span"), {
      className: "empty-cover",
      textContent: "图片读取失败",
    }));
  }
}

function openLibraryGroupModal(group) {
  state.editingLibraryGroupId = group?.id || "";
  $("libraryGroupModalTitle").textContent = group ? "编辑分组" : "新建分组";
  $("libGroupName").value = group?.name || "";
  $("libGroupKeywords").value = keywordText(group?.trigger_keywords).replace("还没有设置对方要说的词", "");
  $("libGroupPersona").value = group?.persona_id || "";
  $("libGroupPlatform").value = group?.platform || "";
  $("libraryGroupModal").hidden = false;
  window.setTimeout(function () { $("libGroupName").focus(); }, 0);
}

async function saveLibraryGroup() {
  var name = $("libGroupName").value.trim();
  if (!name) { showToast("先写分组名字", "error"); return; }
  $("saveLibGroupButton").disabled = true;
  try {
    await api("POST", "/media-library/groups", {
      id: state.editingLibraryGroupId || "",
      name: name,
      trigger_keywords: $("libGroupKeywords").value.trim(),
      persona_id: $("libGroupPersona").value,
      platform: $("libGroupPlatform").value,
    });
    $("libraryGroupModal").hidden = true;
    state.editingLibraryGroupId = "";
    showToast("分组已保存");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("saveLibGroupButton").disabled = false;
  }
}

function chooseLibraryImage(groupId) {
  state.uploadGroupId = groupId;
  var input = $("libraryUploadInput");
  input.value = "";
  input.click();
}

async function uploadLibraryImage(file) {
  if (!file || !state.uploadGroupId) return;
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    showToast("只支持 JPG、PNG、WebP、GIF 图片", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("图片不能超过 8MB", "error");
    return;
  }
  try {
    var dataUrl = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("图片读取失败")); };
      reader.readAsDataURL(file);
    });
    await api("POST", "/media-library/upload", {
      group_id: state.uploadGroupId,
      file_name: file.name,
      content_type: file.type,
      data_base64: dataUrl,
    });
    showToast("图片已上传");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.uploadGroupId = "";
    $("libraryUploadInput").value = "";
  }
}

async function deleteLibraryAsset(assetId) {
  if (!assetId || !window.confirm("这张图要从图库里删掉吗？")) return;
  try {
    await api("DELETE", "/media-library/assets", { id: assetId });
    showToast("图片已删除");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function openMediaPreview(viewUrl, title) {
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = "";
  $("mediaPreviewTitle").textContent = title || "图片预览";
  $("mediaPreviewImage").removeAttribute("src");
  $("mediaPreviewModal").hidden = false;
  try {
    var blob = await apiBlob(viewUrl);
    state.previewObjectUrl = URL.createObjectURL(blob);
    $("mediaPreviewImage").src = state.previewObjectUrl;
  } catch (error) {
    showToast(error.message, "error");
    $("mediaPreviewModal").hidden = true;
  }
}

function closeMediaPreview() {
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = "";
  $("mediaPreviewImage").removeAttribute("src");
  $("mediaPreviewModal").hidden = true;
}
